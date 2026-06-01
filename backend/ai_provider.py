"""
AI provider abstraction for Effro.

One factory, one interface, several adapters:

    from ai_provider import get_provider
    provider = get_provider(db)
    result = provider.complete(system="...", messages=[...], max_tokens=500)

Supported provider keys (see PROVIDER_PRESETS):
  - claude   → Anthropic (claude-sonnet-4 by default)
  - groq     → OpenAI-compatible (free tier, llama-3.1-8b-instant)
  - gemini   → OpenAI-compatible (Google Gemini via /openai endpoint)
  - ollama   → OpenAI-compatible (localhost:11434/v1)
  - custom   → OpenAI-compatible (user supplies base_url, model, api_key)

Adding a new provider:
  1. Pick a key, add a PROVIDER_PRESETS entry
  2. If it's a brand-new wire protocol (rare), subclass AIProvider
  3. Otherwise just rely on OpenAICompatProvider with the right base_url
"""

from __future__ import annotations
import json
import logging
from abc import ABC, abstractmethod
from typing import Optional
from sqlalchemy.orm import Session

log = logging.getLogger("trace.ai")


# ─── Provider presets ─────────────────────────────────────────────────────────
# Keyed by provider id. Each entry feeds:
#   - the factory (build the right adapter, fill in defaults)
#   - the GET /settings/ai/presets endpoint (frontend picker shows these)
# api_key is never stored here - these are descriptions only.

PROVIDER_PRESETS: dict[str, dict] = {
    "claude": {
        "label": "Claude",
        "adapter": "anthropic",
        "base_url": None,
        "default_model": "claude-sonnet-4-6",
        "needs_key": True,
        "needs_url": False,
        "key_prefix": "sk-ant-",
    },
    "groq": {
        "label": "Groq",
        "adapter": "openai_compat",
        "base_url": "https://api.groq.com/openai/v1",
        "default_model": "llama-3.1-8b-instant",
        "needs_key": True,
        "needs_url": False,
        "key_prefix": "gsk_",
    },
    "gemini": {
        "label": "Google Gemini",
        "adapter": "openai_compat",
        "base_url": "https://generativelanguage.googleapis.com/openai/",
        "default_model": "gemini-1.5-flash",
        "needs_key": True,
        "needs_url": False,
        "key_prefix": "AIza",
    },
    "ollama": {
        "label": "Ollama",
        "adapter": "openai_compat",
        "base_url": "http://localhost:11434/v1",
        "default_model": "llama3",
        "needs_key": False,
        "needs_url": False,
        "key_prefix": None,
    },
    "custom": {
        "label": "Custom / Enterprise",
        "adapter": "openai_compat",
        "base_url": None,        # user supplies
        "default_model": None,   # user supplies
        "needs_key": True,
        "needs_url": True,
        "key_prefix": None,
    },
}


# ─── Base class ───────────────────────────────────────────────────────────────

class AIProvider(ABC):
    """Abstract AI provider. All adapters implement `complete()`."""

    @abstractmethod
    def complete(
        self,
        system: str,
        messages: list[dict],
        max_tokens: int = 1000,
    ) -> str:
        """
        Call the model and return the assistant's text response.

        `messages` is a list of {"role": "user"|"assistant", "content": "..."}
        Raises `RuntimeError` with a user-readable message on failure
        (auth, network, rate limit, model-not-found, etc.).
        """
        ...

    def test(self) -> tuple[bool, str]:
        """
        Quick sanity-check used by the Settings → AI Engine "Test" button.
        Returns (ok, human_message). Default implementation asks the model
        to reply with the literal word "ok" - robust to small variations.
        """
        try:
            result = self.complete(
                system="You are a test. Reply with exactly the word: ok",
                messages=[{"role": "user", "content": "test"}],
                max_tokens=10,
            )
            if result.strip().lower().startswith("ok"):
                return True, "Connection successful"
            return True, f"Connected (response: {result.strip()[:40]})"
        except Exception as e:
            return False, str(e)


# ─── Anthropic adapter ────────────────────────────────────────────────────────

class AnthropicProvider(AIProvider):
    """Claude via the official `anthropic` SDK."""

    def __init__(self, api_key: str, model: str = "claude-sonnet-4-6"):
        self._api_key = api_key
        self._model = model

    def complete(self, system: str, messages: list[dict], max_tokens: int = 1000) -> str:
        try:
            from anthropic import Anthropic
            client = Anthropic(api_key=self._api_key)
            response = client.messages.create(
                model=self._model,
                max_tokens=max_tokens,
                system=system,
                messages=messages,
            )
            return response.content[0].text
        except ImportError:
            raise RuntimeError("Anthropic SDK not installed. Run: pip install anthropic")
        except Exception as e:
            raise RuntimeError(_friendly_error(e))


# ─── OpenAI-compatible adapter ────────────────────────────────────────────────
# One adapter, many providers - anything that speaks the OpenAI chat API
# (Groq, Gemini /openai endpoint, Ollama /v1, Azure OpenAI, OpenRouter, etc.)

class OpenAICompatProvider(AIProvider):
    """Any service exposing an OpenAI-compatible chat API."""

    def __init__(self, api_key: str, model: str, base_url: Optional[str] = None):
        # Ollama doesn't validate the key but the SDK requires a non-empty
        # string - "ollama" is the conventional placeholder.
        self._api_key = api_key or "ollama"
        self._model = model
        self._base_url = base_url

    def complete(self, system: str, messages: list[dict], max_tokens: int = 1000) -> str:
        try:
            from openai import OpenAI
            kwargs = {"api_key": self._api_key}
            if self._base_url:
                kwargs["base_url"] = self._base_url
            client = OpenAI(**kwargs)

            # OpenAI's chat schema prepends `system` as a regular message
            # (Anthropic takes it as a separate top-level arg).
            full_messages = [{"role": "system", "content": system}] + messages

            response = client.chat.completions.create(
                model=self._model,
                messages=full_messages,
                max_tokens=max_tokens,
            )
            return response.choices[0].message.content
        except ImportError:
            raise RuntimeError("openai package not installed. Run: pip install openai")
        except Exception as e:
            raise RuntimeError(_friendly_error(e))


# ─── Factory ──────────────────────────────────────────────────────────────────

def get_provider(db: Session) -> AIProvider:
    """
    Read AI config from app_settings and build the appropriate provider.

    Returns a `_UnconfiguredProvider` (which raises a clear RuntimeError when
    used) if the config is missing or incomplete, so AI features can degrade
    gracefully without crashing the whole request.
    """
    config = _read_config(db)
    return _build_provider(config)


def get_provider_from_config(config: dict) -> AIProvider:
    """
    Build a provider directly from an in-memory config dict, without touching
    the database. Used by the test endpoint so the user can verify a config
    BEFORE saving it.
    """
    return _build_provider(config)


def _build_provider(config: dict) -> AIProvider:
    provider = config.get("provider", "claude")
    model = config.get("model")
    api_key = config.get("api_key", "")
    base_url = config.get("base_url")

    preset = PROVIDER_PRESETS.get(provider, PROVIDER_PRESETS["custom"])

    # Fill in preset defaults where the user left fields blank.
    if not model:
        model = preset.get("default_model", "")
    if not base_url and preset.get("base_url"):
        base_url = preset["base_url"]

    adapter = preset.get("adapter", "openai_compat")

    if adapter == "anthropic":
        if not api_key:
            return _UnconfiguredProvider(
                "No Anthropic API key set. Open Settings → AI Engine to configure."
            )
        return AnthropicProvider(api_key=api_key, model=model or "claude-sonnet-4-6")

    # OpenAI-compatible: check required fields per preset
    if preset.get("needs_key") and not api_key:
        return _UnconfiguredProvider(
            f"No API key set for {preset['label']}. "
            "Open Settings → AI Engine to configure."
        )
    if preset.get("needs_url") and not base_url:
        return _UnconfiguredProvider(
            "No base URL set for custom provider. "
            "Open Settings → AI Engine to configure."
        )
    return OpenAICompatProvider(
        api_key=api_key or "ollama",
        model=model or "llama3",
        base_url=base_url,
    )


class _UnconfiguredProvider(AIProvider):
    """
    Placeholder returned when AI isn't configured (or is misconfigured).
    All calls raise RuntimeError with a clear message - the router layer
    turns this into a 502 with a user-readable body.
    """

    def __init__(self, message: str):
        self._message = message

    def complete(self, system: str, messages: list[dict], max_tokens: int = 1000) -> str:
        raise RuntimeError(self._message)

    def test(self) -> tuple[bool, str]:
        return False, self._message


# ─── Settings persistence ─────────────────────────────────────────────────────

_AI_CONFIG_KEY = "ai_config"


def _read_config(db: Session) -> dict:
    """Read AI config from app_settings. Returns empty dict if not set."""
    from models import AppSettings
    row = db.query(AppSettings).filter(AppSettings.key == _AI_CONFIG_KEY).first()
    if not row or not row.value:
        return {}
    try:
        return json.loads(row.value)
    except Exception:
        return {}


def write_config(db: Session, config: dict) -> None:
    """Upsert AI config in app_settings."""
    from models import AppSettings
    row = db.query(AppSettings).filter(AppSettings.key == _AI_CONFIG_KEY).first()
    if row:
        row.value = json.dumps(config)
    else:
        row = AppSettings(key=_AI_CONFIG_KEY, value=json.dumps(config))
        db.add(row)
    db.commit()


def read_config_for_api(db: Session) -> dict:
    """
    Return config in the shape the frontend wants: api_key masked, plus an
    `is_configured` boolean. We mask the key to its last 4 chars so the user
    can verify which key is loaded without it leaving the server in plaintext.
    """
    config = _read_config(db)
    raw_key = config.get("api_key", "")
    masked = (
        f"{'•' * max(0, len(raw_key) - 4)}{raw_key[-4:]}"
        if len(raw_key) > 4
        else ("•" * len(raw_key) if raw_key else None)
    )
    preset = PROVIDER_PRESETS.get(config.get("provider", "claude"), {})
    is_configured = bool(
        config.get("provider") and (
            (not preset.get("needs_key")) or config.get("api_key")
        )
    )
    return {
        "provider": config.get("provider", "claude"),
        "model": config.get("model"),
        "base_url": config.get("base_url"),
        "api_key_masked": masked,
        "is_configured": is_configured,
    }


# ─── Error translation ────────────────────────────────────────────────────────

def _friendly_error(exc: Exception) -> str:
    """
    Turn SDK / HTTP errors into something a non-technical user can act on.
    Falls back to the original message if no pattern matches.
    """
    msg = str(exc).lower()
    if "401" in msg or "authentication" in msg or "unauthorized" in msg:
        return "Invalid API key. Check your key in Settings → AI Engine."
    if "429" in msg or "rate limit" in msg:
        return "Rate limit reached. Wait a moment and try again."
    if "404" in msg or "not found" in msg:
        return "Model not found. Check the model name in Settings → AI Engine."
    if "connection" in msg or "connect" in msg or "refused" in msg:
        return "Could not reach the AI service. Check your network or that Ollama is running."
    if "timeout" in msg:
        return "AI service timed out. Try again."
    return f"AI request failed: {exc}"
