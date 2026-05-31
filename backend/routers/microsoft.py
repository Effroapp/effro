"""
Microsoft 365 integration router.

Exposes:
  GET    /microsoft/config              - returns the Azure app config (secret masked)
  PUT    /microsoft/config              - persist user-supplied Azure app credentials
  GET    /microsoft/profile             - "connected as <email>" view, no tokens
  GET    /microsoft/auth/login          - kicks off the OAuth flow (web flow)
  GET    /microsoft/auth/callback       - Microsoft → here on consent (web flow)
  POST   /microsoft/auth/exchange       - desktop flow: frontend posts {code, state}
  DELETE /microsoft/auth/disconnect     - drop tokens + profile
  GET    /microsoft/calendar/today      - on-demand today's events (Live Calendar Panel)
  POST   /microsoft/sync-now            - one-off manual sync (drives Signals)

Security boundary (see spec §6): the user registers the Azure app and signs in
through their own browser. Claude / the app only do the code↔token exchange
after consent.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

import models
import schemas
import microsoft_graph as graph
from database import get_db

log = logging.getLogger("trace.routers.microsoft")
router = APIRouter(prefix="/microsoft", tags=["microsoft"])


# ─── Azure config ────────────────────────────────────────────────────────────

@router.get("/config", response_model=schemas.MicrosoftConfigOut)
def get_microsoft_config(db: Session = Depends(get_db)):
    """Return the stored Azure app config. Secret is shown as bullets + last 4."""
    cfg = graph.get_config(db)
    secret = cfg.get("client_secret") or ""
    masked = None
    if secret:
        # 8 bullets + last 4 chars - same style as the AI key masking.
        masked = "•" * 8 + secret[-4:] if len(secret) >= 4 else "•" * 8
    return schemas.MicrosoftConfigOut(
        client_id=cfg.get("client_id"),
        client_secret_masked=masked,
        tenant_id=cfg.get("tenant_id", "common"),
        is_configured=bool(cfg.get("client_id") and cfg.get("client_secret")),
    )


@router.put("/config", response_model=schemas.MicrosoftConfigOut)
def save_microsoft_config(
    payload: schemas.MicrosoftConfigIn,
    db: Session = Depends(get_db),
):
    """Persist the user's Azure app credentials (client_secret encrypted)."""
    if not payload.client_id.strip() or not payload.client_secret.strip():
        raise HTTPException(status_code=400, detail="client_id and client_secret are required")
    graph.save_config(
        db,
        client_id=payload.client_id,
        client_secret=payload.client_secret,
        tenant_id=payload.tenant_id,
    )
    return get_microsoft_config(db)


# ─── Profile ─────────────────────────────────────────────────────────────────

@router.get("/profile", response_model=schemas.MicrosoftProfileOut)
def get_profile(db: Session = Depends(get_db)):
    """Minimal "connected as" view. Returns connected=false if no account linked."""
    integration = db.query(models.MicrosoftIntegration).first()
    if not integration:
        return schemas.MicrosoftProfileOut(connected=False)
    return schemas.MicrosoftProfileOut(
        connected=True,
        display_name=integration.display_name,
        email=integration.email,
        connected_at=integration.connected_at.isoformat() if integration.connected_at else None,
        last_synced=integration.last_synced.isoformat() if integration.last_synced else None,
    )


# ─── OAuth ───────────────────────────────────────────────────────────────────

@router.get("/auth/login")
def auth_login(db: Session = Depends(get_db)):
    """Step 1: mint a state, redirect the user's browser to Microsoft."""
    try:
        state = secrets.token_urlsafe(32)
        graph.add_state(db, state)
        auth_url = graph.get_auth_url(db, state=state)
    except ValueError as e:
        # Config missing - render the settings page with an error chip.
        return RedirectResponse(url=f"/settings?ms_error={str(e).replace(' ', '_')}")
    return RedirectResponse(url=auth_url)


@router.get("/auth/callback")
async def auth_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    error_description: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Step 2 (web flow): Microsoft redirects here after consent."""
    if error:
        log.warning("MS OAuth error: %s - %s", error, error_description)
        return RedirectResponse(url=f"/settings?ms_error={error}")

    if not state or not graph.pop_state(db, state):
        log.warning("MS OAuth callback with invalid/missing state")
        return RedirectResponse(url="/settings?ms_error=invalid_state")
    if not code:
        return RedirectResponse(url="/settings?ms_error=no_code")

    try:
        await _complete_auth(db, code)
    except Exception as e:
        log.error("MS OAuth completion failed: %s", e)
        # Surface the actual MSAL/Graph error in the ms_error param so the
        # user can act on it without opening DevTools. Common ones include
        # "Invalid client secret" (AADSTS7000215 - they copied the Secret
        # ID instead of the Value) and "AADSTS50011" (redirect URI
        # mismatch). Truncate to 400 chars to keep the URL reasonable.
        from urllib.parse import quote
        msg = quote(str(e)[:400], safe="")
        return RedirectResponse(url=f"/settings?ms_error={msg}")
    return RedirectResponse(url="/settings?ms_connected=true")


@router.post("/auth/exchange", response_model=schemas.MicrosoftProfileOut)
async def auth_exchange(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    """Desktop flow: the Tauri deep-link handler caught trace://auth/callback?...
    and POSTs {code, state} here for the token exchange.

    Scaffolded for v0.6.x - the desktop wiring (deep-link plugin + custom scheme)
    is not in v0.6.0; this endpoint is here so the frontend's flow is symmetric
    across builds and the v0.6.x landing is a one-liner.
    """
    code = (payload.get("code") or "").strip()
    state = (payload.get("state") or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")
    if state and not graph.pop_state(db, state):
        raise HTTPException(status_code=400, detail="Invalid OAuth state parameter")
    try:
        await _complete_auth(db, code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return get_profile(db)


async def _complete_auth(db: Session, code: str) -> None:
    """Shared tail of the OAuth flow: code → tokens → profile → DB."""
    token_result = graph.exchange_code_for_tokens(db, code)
    access_token = token_result["access_token"]
    refresh_token = token_result.get("refresh_token")
    expires_in = token_result.get("expires_in", 3600)

    profile = await graph.fetch_user_profile(access_token)
    ms_user_id = profile.get("id")
    if not ms_user_id:
        raise ValueError("Microsoft profile fetch returned no id")

    integration = (
        db.query(models.MicrosoftIntegration)
        .filter(models.MicrosoftIntegration.microsoft_user_id == ms_user_id)
        .first()
    )
    if not integration:
        integration = models.MicrosoftIntegration(microsoft_user_id=ms_user_id)
        db.add(integration)
        db.flush()

    graph.store_tokens(
        db,
        integration=integration,
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=expires_in,
    )
    integration.display_name = profile.get("displayName")
    integration.email = profile.get("mail") or profile.get("userPrincipalName")
    integration.last_synced = datetime.utcnow()
    db.commit()
    log.info("Microsoft account connected: %s", integration.email)


@router.delete("/auth/disconnect")
def auth_disconnect(db: Session = Depends(get_db)):
    """Wipe the integration row (tokens + profile). Idempotent."""
    deleted = db.query(models.MicrosoftIntegration).delete()
    db.commit()
    return {"deleted": deleted}


# ─── Calendar passthrough (Live Calendar Panel) ─────────────────────────────

@router.get("/calendar/today")
async def calendar_today(db: Session = Depends(get_db)):
    """On-demand fetch for the Live Calendar Panel. Local-tz day boundary."""
    access_token = graph.get_valid_access_token(db)
    if not access_token:
        raise HTTPException(status_code=404, detail="Microsoft account not connected")
    try:
        events = await graph.fetch_todays_events(access_token)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Calendar fetch failed: {e}")
    return {"events": events, "source": "microsoft_graph"}


# ─── Sync ─────────────────────────────────────────────────────────────────────

@router.post("/sync-now")
def sync_now(db: Session = Depends(get_db)):
    """Run the same job as the 30-min scheduler, on demand."""
    # Late import to avoid a circular at module load (scheduler imports routers
    # for its AI provider tests).
    from services_signals import run_microsoft_sync
    result = run_microsoft_sync(db)
    return result
