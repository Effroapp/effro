"""
Jira Cloud integration router.

GET    /jira/config              - Azure-style: get masked app credentials
PUT    /jira/config              - save client_id + client_secret (encrypted)
GET    /jira/profile             - "connected as <email> @ <cloud>" or {connected:false}
GET    /jira/auth/login          - redirect to Atlassian consent page
GET    /jira/auth/callback       - Atlassian → here after consent
DELETE /jira/auth/disconnect     - wipe integration row
POST   /jira/sync-now            - on-demand sync (assigned + mentioned + sprint)
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

import models
import schemas
import jira_client as jira
from database import get_db

log = logging.getLogger("effro.routers.jira")
router = APIRouter(prefix="/jira", tags=["jira"])


# ─── Config ──────────────────────────────────────────────────────────────────

@router.get("/config", response_model=schemas.JiraConfigOut)
def get_jira_config(db: Session = Depends(get_db)):
    cfg = jira.get_config(db)
    secret = cfg.get("client_secret") or ""
    masked = ("•" * 8 + secret[-4:]) if len(secret) >= 4 else ("•" * 8 if secret else None)
    return schemas.JiraConfigOut(
        client_id=cfg.get("client_id"),
        client_secret_masked=masked,
        is_configured=bool(cfg.get("client_id") and cfg.get("client_secret")),
    )


@router.put("/config", response_model=schemas.JiraConfigOut)
def save_jira_config(payload: schemas.JiraConfigIn, db: Session = Depends(get_db)):
    if not payload.client_id.strip() or not payload.client_secret.strip():
        raise HTTPException(status_code=400, detail="client_id and client_secret are required")
    jira.save_config(db, client_id=payload.client_id, client_secret=payload.client_secret)
    return get_jira_config(db)


# ─── Profile ─────────────────────────────────────────────────────────────────

@router.get("/profile", response_model=schemas.JiraProfileOut)
def get_profile(db: Session = Depends(get_db)):
    integration = db.query(models.JiraIntegration).first()
    if not integration:
        return schemas.JiraProfileOut(connected=False)
    return schemas.JiraProfileOut(
        connected=True,
        display_name=integration.display_name,
        email=integration.email,
        cloud_name=integration.cloud_name,
        avatar_url=integration.avatar_url,
        connected_at=integration.connected_at.isoformat() if integration.connected_at else None,
        last_synced=integration.last_synced.isoformat() if integration.last_synced else None,
    )


# ─── OAuth ───────────────────────────────────────────────────────────────────

@router.get("/auth/login")
def auth_login(db: Session = Depends(get_db)):
    """Step 1: redirect user to Atlassian consent page."""
    try:
        state = secrets.token_urlsafe(32)
        jira.add_state(db, state)
        url = jira.get_auth_url(db, state=state)
    except ValueError as e:
        return RedirectResponse(url=f"/settings?jira_error={quote(str(e))}")
    return RedirectResponse(url=url)


@router.get("/auth/callback")
async def auth_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    error_description: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Step 2: Atlassian redirects here after user consent."""
    if error:
        log.warning("Jira OAuth error: %s — %s", error, error_description)
        return RedirectResponse(url=f"/settings?jira_error={quote(error)}")

    if not state or not jira.pop_state(db, state):
        log.warning("Jira callback with invalid state")
        return RedirectResponse(url="/settings?jira_error=invalid_state")

    if not code:
        return RedirectResponse(url="/settings?jira_error=no_code")

    try:
        await _complete_auth(db, code)
    except Exception as e:
        log.error("Jira auth completion failed: %s", e)
        return RedirectResponse(url=f"/settings?jira_error={quote(str(e)[:300])}")

    return RedirectResponse(url="/settings?jira_connected=true")


async def _complete_auth(db: Session, code: str) -> None:
    """Exchange code → tokens → profile → cloud ID → persist."""
    token_result = await jira.exchange_code(db, code)
    access_token = token_result["access_token"]
    refresh_token = token_result.get("refresh_token")
    expires_in = token_result.get("expires_in", 3600)

    # Resolve the cloud site — take the first one (single-cloud assumption)
    resources = await jira.fetch_accessible_resources(access_token)
    if not resources:
        raise ValueError(
            "No Atlassian Cloud sites accessible. "
            "Make sure your app has permission to at least one Jira Cloud site."
        )
    site = resources[0]
    cloud_id = site.get("id", "")
    cloud_name = site.get("name") or site.get("url", "")

    # Fetch the user profile
    profile = await jira.fetch_current_user(access_token, cloud_id)
    atlassian_user_id = profile.get("accountId", "")
    if not atlassian_user_id:
        raise ValueError("Could not retrieve Atlassian user account ID.")

    integration = (
        db.query(models.JiraIntegration)
        .filter(models.JiraIntegration.atlassian_user_id == atlassian_user_id)
        .first()
    )
    if not integration:
        integration = models.JiraIntegration(
            atlassian_user_id=atlassian_user_id,
            cloud_id=cloud_id,
        )
        db.add(integration)
        # NB: no db.flush() here. The integration row has NOT NULL token
        # columns that store_tokens() populates below. Flushing now would
        # fire the INSERT before access_token_enc is set and crash with an
        # IntegrityError. We set every field first, then commit() once.

    jira.store_tokens(
        db,
        integration=integration,
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=expires_in,
    )
    integration.cloud_id = cloud_id
    integration.cloud_name = cloud_name
    integration.display_name = profile.get("displayName")
    integration.email = (
        profile.get("emailAddress")
        or (profile.get("email"))
    )
    integration.avatar_url = (
        (profile.get("avatarUrls") or {}).get("48x48")
    )
    integration.last_synced = datetime.utcnow()
    db.commit()
    log.info("Jira connected: %s @ %s", integration.email, cloud_name)


@router.delete("/auth/disconnect")
def auth_disconnect(db: Session = Depends(get_db)):
    deleted = db.query(models.JiraIntegration).delete()
    db.commit()
    return {"deleted": deleted}


# ─── On-demand sync ───────────────────────────────────────────────────────────

@router.post("/sync-now")
def sync_now(db: Session = Depends(get_db)):
    from services_jira import run_jira_sync
    return run_jira_sync(db)
