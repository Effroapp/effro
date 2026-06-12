"""
Telegram router - messages sent to a personal bot become Signals.

Credential-based (a BYO bot token from @BotFather), not OAuth, so it's
save/test rather than a redirect flow. The Bot API is polled outbound;
nothing inbound is exposed.

  GET    /telegram/config       - token masked + bot_username + is_configured
  PUT    /telegram/config       - persist the token (verifies + caches the bot)
  GET    /telegram/profile      - connected + bot_username + last_synced
  POST   /telegram/test         - verify the token
  DELETE /telegram/disconnect   - clear the token
  POST   /telegram/sync-now     - pull new messages into Signals
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import schemas
import telegram_client as tg
from database import get_db

log = logging.getLogger("effro.routers.telegram")
router = APIRouter(prefix="/telegram", tags=["telegram"])


@router.get("/config", response_model=schemas.TelegramConfigOut)
def get_telegram_config(db: Session = Depends(get_db)):
    cfg = tg.get_config(db)
    tok = cfg.get("token") or ""
    masked = ("•" * 8 + tok[-4:]) if len(tok) >= 4 else ("•" * 8 if tok else None)
    return schemas.TelegramConfigOut(
        token_masked=masked, bot_username=cfg.get("bot_username"), is_configured=bool(tok),
    )


@router.put("/config", response_model=schemas.TelegramConfigOut)
def save_telegram_config(payload: schemas.TelegramConfigIn, db: Session = Depends(get_db)):
    token = payload.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="token is required")
    # Verify with getMe BEFORE saving: a mistyped token otherwise sits there
    # looking connected and only fails later. Telegram rejecting it is a hard
    # no (nothing is stored, any previous token survives); Telegram being
    # unreachable is not the user's fault, so the save still goes through and
    # the Test button can verify later.
    me = None
    try:
        me = tg.get_me(token)
    except ConnectionError as e:
        log.warning("Telegram getMe on save skipped (unreachable): %s", e)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=f"Telegram rejected that token: {e}")
    tg.save_config(db, token=token)
    if me:
        # Cache the bot's username so the UI shows "Connected as @…" at once.
        tg.set_meta(db, bot_username=me.get("username"))
    return get_telegram_config(db)


@router.get("/profile", response_model=schemas.TelegramProfileOut)
def get_profile(db: Session = Depends(get_db)):
    cfg = tg.get_config(db)
    if not cfg.get("token"):
        return schemas.TelegramProfileOut(connected=False)
    return schemas.TelegramProfileOut(
        connected=True, bot_username=cfg.get("bot_username"), last_synced=cfg.get("last_synced"),
    )


@router.post("/test")
def test_telegram(db: Session = Depends(get_db)):
    ok, message = tg.test_connection(db)
    return {"ok": ok, "message": message}


@router.delete("/disconnect")
def disconnect(db: Session = Depends(get_db)):
    tg.clear_config(db)
    return {"ok": True}


@router.post("/sync-now")
def sync_now(db: Session = Depends(get_db)):
    from services_telegram import run_telegram_sync
    return run_telegram_sync(db)
