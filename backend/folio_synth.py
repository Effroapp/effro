"""
Folio synthesis - "pull it together". Gather the readable text of a folio's
captures and turn it into one grounded digest: a short summary, key points,
sources, and open threads.

Two hard rules, because the whole tool rests on accuracy:
  1. Grounding. Everything in the summary, key points and sources must trace to
     a capture. The model is told not to invent facts, figures or names.
  2. Preserve the user's words. On a regenerate, the current digest (with any
     edits they made) is fed back as the settled base, and only the NEW captures
     are folded in. The model is told to keep the existing wording and change
     only what the new material requires. The result is a NEW version; the prior
     one is kept, so any refresh can be undone.

The prompt is a first pass, meant to be tuned against real captures (see the
build prompt). It is deliberately kept here, in one place, not scattered.
"""
from __future__ import annotations

import json
import logging
import re

log = logging.getLogger("effro.folio.synth")

_SYSTEM = (
    "You help someone make sense of a deep dive. You turn the things they "
    "captured into one clear digest, written as if the work is theirs, because "
    "it is. British English. Short active sentences. No em dashes and no "
    "semicolons. You never add facts, figures or names that are not in the "
    "captures. If something is unclear or missing, you put it under open "
    "threads rather than guessing."
)

_INSTRUCTIONS = (
    "Produce a JSON object with exactly these keys and no others:\n"
    '  "summary": a string of three to five sentences saying what the captures '
    "add up to and where they disagree.\n"
    '  "key_points": an array of short strings, the load-bearing facts, each '
    "traceable to a capture.\n"
    '  "sources": an array of short strings, the captures you drew on, each '
    "named by its domain or type.\n"
    '  "open_threads": an array of short strings, the real questions or gaps '
    "the captures leave to resolve. Use this for anything uncertain rather than "
    "guessing.\n"
    "Use only what is in the captures. Return only the JSON object, nothing else."
)

_REGEN_PREFIX = (
    "Here is the existing digest, which the person may have edited. Treat it as "
    "settled. Keep its wording and structure and change only what the new "
    "captures below require. Grounding still applies to anything new.\n\n"
    "EXISTING DIGEST (JSON):\n{prior}\n\n"
    "NEW CAPTURES since it was pulled together:\n"
)

_MAX_CAPTURE_CHARS = 8000     # per capture, so one huge file can't crowd the rest
_MAX_TOTAL_CHARS = 80000      # overall budget handed to the model


def _label(cap: dict) -> str:
    meta = cap.get("source_meta") or {}
    if cap["type"] == "link":
        return f"link {meta.get('domain') or ''}".strip()
    if cap["type"] == "image":
        return "image (read by vision)" if meta.get("vision_read") else "image"
    if cap["type"] == "file":
        return f"file {meta.get('original_name') or ''}".strip()
    return "note"


def _captures_block(captures: list[dict]) -> str:
    lines, total = [], 0
    for i, cap in enumerate(captures, 1):
        text = (cap.get("extracted_text") or "").strip()
        if not text:
            continue
        text = text[:_MAX_CAPTURE_CHARS]
        chunk = f"[{i}] {_label(cap)}:\n{text}"
        if total + len(chunk) > _MAX_TOTAL_CHARS:
            break
        lines.append(chunk)
        total += len(chunk)
    return "\n\n".join(lines)


def _coerce(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        out = []
        for v in value:
            if isinstance(v, str) and v.strip():
                out.append(v.strip())
            elif isinstance(v, dict):
                # tolerate {"point": "..."} / {"text": "..."} shapes
                for k in ("point", "text", "title", "source", "name"):
                    if isinstance(v.get(k), str) and v[k].strip():
                        out.append(v[k].strip()); break
        return out
    return []


def _parse(text: str) -> dict:
    """Robustly pull the JSON object out of a model response (tolerates code
    fences and leading prose)."""
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw).strip()
    try:
        obj = json.loads(raw)
    except Exception:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if not m:
            raise ValueError("The digest could not be read from the AI response.")
        obj = json.loads(m.group(0))
    if not isinstance(obj, dict):
        raise ValueError("The digest came back in an unexpected shape.")
    return {
        "summary": (obj.get("summary") or "").strip() if isinstance(obj.get("summary"), str) else "",
        "key_points": _coerce(obj.get("key_points")),
        "sources": _coerce(obj.get("sources")),
        "open_threads": _coerce(obj.get("open_threads")),
    }


def synthesize(provider, captures: list[dict], prior: dict | None = None,
               new_capture_ids: list[int] | None = None) -> dict:
    """Call the AI provider and return a parsed digest dict
    {summary, key_points, sources, open_threads}. Raises RuntimeError (provider
    failure) or ValueError (unparseable) for the caller to surface.

    GROUNDING IS PROMPT-ENFORCED, NOT VERIFIED. The system prompt instructs the
    model to use only the captures, but nothing here checks the output against
    them at runtime (there is no reliable non-LLM way to do that). Grounding is
    therefore only as strong as the configured model's instruction-following, so
    point Folio at a capable provider. The blast radius is contained: the digest
    is the user's own private summary of their own captures, shown only to them,
    rendered as escaped text, and every refresh keeps the prior version so a poor
    result is undoable. The 'open threads' section is the escape hatch for
    anything the captures leave uncertain."""
    if prior and new_capture_ids is not None:
        feed = [c for c in captures if c["id"] in set(new_capture_ids)]
        prior_json = json.dumps({
            "summary": prior.get("summary", ""),
            "key_points": prior.get("key_points", []),
            "sources": prior.get("sources", []),
            "open_threads": prior.get("open_threads", []),
        }, ensure_ascii=False, indent=2)
        body = _REGEN_PREFIX.format(prior=prior_json) + _captures_block(feed)
    else:
        body = "CAPTURES:\n" + _captures_block(captures)

    user = f"{body}\n\n{_INSTRUCTIONS}"
    text = provider.complete(system=_SYSTEM, messages=[{"role": "user", "content": user}], max_tokens=2000)
    return _parse(text)
