"""
Telegram client - turns messages sent to a personal bot into Signals.

Auth is a BYO bot token (made in a minute with @BotFather) - the Telegram Bot
API is polled with getUpdates, so nothing inbound is needed: no webhook, no
public endpoint, no relay. That keeps the integration local-first like the
rest of Effro. Token stored encrypted in app_settings; no refresh needed.
"""
from __future__ import annotations

import json
import logging
from typing import Optional

import httpx
from sqlalchemy.orm import Session

import integration_config

log = logging.getLogger("effro.telegram")

API_BASE = "https://api.telegram.org"
_TG_CONFIG_KEY = "telegram_config"


# ─── Config (shared store, token encrypted at rest) ──────────────────────────

def get_config(db: Session) -> dict:
    return integration_config.load(db, _TG_CONFIG_KEY, secret_fields=("token",))


def save_config(db: Session, *, token: str) -> None:
    # A (re)saved token resets the poll cursor and the chat pairing: update_id
    # sequences are per-bot, so a stale last_update_id from another bot would
    # silently confirm-and-discard the new bot's messages forever. Resetting is
    # always safe - the (source, external_id) upsert absorbs any re-reads.
    integration_config.save(db, _TG_CONFIG_KEY, {
        "token": token,
        "last_update_id": None,
        "paired_chat_id": None,
        "bot_username": None,
    }, secret_fields=("token",))


def clear_config(db: Session) -> None:
    integration_config.clear(db, _TG_CONFIG_KEY)


def set_meta(db: Session, **fields) -> None:
    """Stamp non-secret fields (bot_username, last_update_id, last_synced)
    without touching the token."""
    integration_config.set_meta(db, _TG_CONFIG_KEY, **fields)


def _token(db: Session) -> Optional[str]:
    return get_config(db).get("token")


# ─── Bot API ─────────────────────────────────────────────────────────────────

def _redact(token: str, text: str) -> str:
    """Telegram puts the token in the URL, and httpx error strings embed the
    URL - scrub it before any message can reach a log or the UI."""
    return text.replace(token, "<token>") if token else text


def _call(token: str, method: str, *, params: Optional[dict] = None, timeout: float = 20.0) -> dict:
    """One Bot API call. Telegram wraps everything in {ok, result|description}.
    Raises RuntimeError when Telegram rejects the call (auth, bad request) and
    ConnectionError when Telegram cannot be reached - both with token-free
    messages, so callers can log or show them safely."""
    try:
        with httpx.Client(timeout=timeout) as client:
            r = client.get(f"{API_BASE}/bot{token}/{method}", params=params or {})
    except Exception as e:
        raise ConnectionError(_redact(token, f"Could not reach Telegram: {e}")) from None
    try:
        body = r.json()
    except Exception:
        raise RuntimeError(f"Telegram returned a non-JSON response (HTTP {r.status_code}).")
    if not body.get("ok"):
        raise RuntimeError(_redact(token, body.get("description") or f"Telegram error (HTTP {r.status_code}).") )
    return body.get("result")


def get_me(token: str) -> dict:
    """The bot's own identity; doubles as the auth check."""
    return _call(token, "getMe")


def fetch_updates(token: str, *, offset: Optional[int] = None, limit: int = 100) -> list[dict]:
    """Pull pending updates. Passing offset=N+1 confirms everything up to N,
    so Telegram stops re-sending it - the caller persists last_update_id.
    Only message updates are requested; edits/joins/etc. stay out of Signals."""
    params: dict = {"limit": str(limit), "allowed_updates": json.dumps(["message"])}
    if offset is not None:
        params["offset"] = str(offset)
    return _call(token, "getUpdates", params=params) or []


def test_connection(db: Session) -> tuple[bool, str]:
    token = _token(db)
    if not token:
        return False, "A Telegram bot token is required."
    try:
        me = get_me(token)
        name = me.get("username") or me.get("first_name") or "your bot"
        return True, f"Connected to Telegram as @{name}."
    except ConnectionError as e:
        return False, str(e)                  # already reads "Could not reach Telegram: ..."
    except RuntimeError as e:
        return False, f"Telegram rejected the token: {e}"
    except Exception as e:
        return False, _redact(token, f"Could not reach Telegram: {e}")
