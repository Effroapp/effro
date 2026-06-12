"""
Telegram sync engine - messages sent to the user's bot become Signals
(source='telegram', kind='message'). Mirrors services_github.

external_id is 'tg:{chat_id}:{message_id}' (unique per chat). last_update_id is
persisted in the config so the next getUpdates call confirms what we've seen
and Telegram stops re-sending it; the (source, external_id) upsert makes a
re-fetch harmless anyway. Never creates entries automatically.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

from sqlalchemy.orm import Session

import models
import telegram_client as tg

log = logging.getLogger("effro.services.telegram")


def _sender(msg: dict) -> str | None:
    frm = msg.get("from") or {}
    name = " ".join(p for p in (frm.get("first_name"), frm.get("last_name")) if p)
    if frm.get("username"):
        return f"{name} (@{frm['username']})" if name else f"@{frm['username']}"
    return name or None


# Service events (someone joined, a message was pinned...) arrive as message
# updates too; they are chat plumbing, not captures, and stay out of Signals.
_SERVICE_KEYS = (
    "new_chat_members", "left_chat_member", "new_chat_title", "new_chat_photo",
    "delete_chat_photo", "group_chat_created", "supergroup_chat_created",
    "channel_chat_created", "pinned_message", "message_auto_delete_timer_changed",
)


def _message_text(msg: dict) -> str | None:
    """The readable content of a message: text, a media caption, or a label
    for media-only messages so they still surface (the user can open Telegram
    for the actual file). Unknown future content types degrade to a generic
    label rather than vanishing - with getUpdates, a skipped message is
    confirmed to Telegram and can never be re-fetched."""
    if msg.get("text"):
        return msg["text"]
    if msg.get("caption"):
        return msg["caption"]
    for kind, label in (("photo", "Photo"), ("document", "Document"), ("voice", "Voice message"),
                        ("video", "Video"), ("video_note", "Video message"), ("audio", "Audio"),
                        ("sticker", "Sticker"), ("poll", "Poll"), ("location", "Location"),
                        ("contact", "Contact")):
        if msg.get(kind):
            return f"({label})"
    if any(k in msg for k in _SERVICE_KEYS):
        return None
    return "(Message)"


def run_telegram_sync(db: Session) -> dict:
    cfg = tg.get_config(db)
    token = cfg.get("token")
    if not token:
        return {"skipped": True, "reason": "not_connected"}

    offset = None
    last_seen = cfg.get("last_update_id")
    if isinstance(last_seen, int):
        offset = last_seen + 1

    try:
        updates = tg.fetch_updates(token, offset=offset)
    except RuntimeError as e:
        # An invalid/revoked token reads as auth; transient network errors land
        # here too - either way the next run retries from the same offset.
        log.warning("Telegram sync: fetch failed: %s", e)
        return {"skipped": True, "reason": "auth_error", "error": str(e)}
    except Exception as e:
        log.warning("Telegram sync: fetch failed: %s", e)
        return {"skipped": True, "reason": "network_error", "error": str(e)}

    # Pairing: the first chat that messages the bot becomes its owner, and
    # everything else is ignored. Bots are publicly messageable - without this,
    # anyone who finds the bot could push items into the triage feed.
    paired_chat_id = cfg.get("paired_chat_id")

    added = updated = 0
    ignored_chats = 0
    max_update_id = last_seen if isinstance(last_seen, int) else None
    for upd in updates:
        if not isinstance(upd, dict):
            log.warning("Telegram sync: skipping malformed update: %r", upd)
            continue
        uid = upd.get("update_id")
        if isinstance(uid, int):
            max_update_id = uid if max_update_id is None else max(max_update_id, uid)
        msg = upd.get("message")
        if not msg:
            continue
        chat_id = (msg.get("chat") or {}).get("id")
        message_id = msg.get("message_id")
        text = _message_text(msg)
        if chat_id is None or message_id is None or not text or not text.strip():
            continue
        if paired_chat_id is None:
            paired_chat_id = chat_id
        elif chat_id != paired_chat_id:
            ignored_chats += 1
            continue

        ext_id = f"tg:{chat_id}:{message_id}"
        sent = msg.get("date")
        fields = {
            "title": " ".join(text.split())[:500],
            "starts_at": datetime.utcfromtimestamp(sent) if isinstance(sent, int) else None,
            "ends_at": None,
            "location": None,
            "organizer": _sender(msg),
            "is_all_day": False,
        }
        # Private bot chats have no public web URL, so raw_json carries no
        # link field - the Signals card simply shows no "Open in" action.
        raw = json.dumps({"chat_id": chat_id, "message_id": message_id,
                          "text": text[:2000], "from": msg.get("from")})
        existing = (
            db.query(models.SignalItem)
            .filter(models.SignalItem.source == "telegram", models.SignalItem.external_id == ext_id)
            .first()
        )
        if existing:
            if existing.status == "pending":
                for k, v in fields.items():
                    setattr(existing, k, v)
                existing.raw_json = raw
                updated += 1
        else:
            db.add(models.SignalItem(source="telegram", external_id=ext_id, kind="message",
                                     status="pending", raw_json=raw, **fields))
            added += 1
    db.commit()

    try:
        from services_signals import _suggest_areas_for_pending
        suggested = _suggest_areas_for_pending(db)
    except Exception as e:
        log.warning("Telegram sync: AI suggestion pass failed: %s", e)
        suggested = 0

    meta: dict = {"last_synced": datetime.utcnow().isoformat()}
    if isinstance(max_update_id, int):
        meta["last_update_id"] = max_update_id
    if paired_chat_id is not None:
        meta["paired_chat_id"] = paired_chat_id
    tg.set_meta(db, **meta)
    if ignored_chats:
        log.warning("Telegram sync: ignored %d message(s) from unpaired chats", ignored_chats)
    log.info("Telegram sync: +%d new, %d updated, %d AI-suggested", added, updated, suggested)
    return {"added": added, "updated": updated, "ai_suggested": suggested, "skipped": False}
