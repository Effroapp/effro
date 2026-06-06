"""
GitHub router - review requests, assigned issues/PRs, and mentions into Signals.

Credential-based (personal access token), not OAuth, so it's save/test rather
than a redirect flow.

  GET    /github/config       - token masked + login + is_configured
  PUT    /github/config       - persist the token (verifies + caches login)
  GET    /github/profile      - connected + login + last_synced
  POST   /github/test         - verify the token
  DELETE /github/disconnect   - clear the token
  POST   /github/sync-now     - pull actionable items into Signals
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import schemas
import github_client as gh
from database import get_db

log = logging.getLogger("effro.routers.github")
router = APIRouter(prefix="/github", tags=["github"])


@router.get("/config", response_model=schemas.GithubConfigOut)
def get_github_config(db: Session = Depends(get_db)):
    cfg = gh.get_config(db)
    tok = cfg.get("token") or ""
    masked = ("•" * 8 + tok[-4:]) if len(tok) >= 4 else ("•" * 8 if tok else None)
    return schemas.GithubConfigOut(
        token_masked=masked, login=cfg.get("login"), is_configured=bool(tok),
    )


@router.put("/config", response_model=schemas.GithubConfigOut)
def save_github_config(payload: schemas.GithubConfigIn, db: Session = Depends(get_db)):
    if not payload.token.strip():
        raise HTTPException(status_code=400, detail="token is required")
    gh.save_config(db, token=payload.token)
    # Cache the login so the UI can show "Connected as …" without a round-trip.
    try:
        user = gh.fetch_user(payload.token.strip())
        gh.set_meta(db, login=user.get("login"))
    except Exception as e:
        log.warning("GitHub user lookup after save failed: %s", e)
    return get_github_config(db)


@router.get("/profile", response_model=schemas.GithubProfileOut)
def get_profile(db: Session = Depends(get_db)):
    cfg = gh.get_config(db)
    if not cfg.get("token"):
        return schemas.GithubProfileOut(connected=False)
    return schemas.GithubProfileOut(connected=True, login=cfg.get("login"), last_synced=cfg.get("last_synced"))


@router.post("/test")
def test_github(db: Session = Depends(get_db)):
    ok, message = gh.test_connection(db)
    return {"ok": ok, "message": message}


@router.delete("/disconnect")
def disconnect(db: Session = Depends(get_db)):
    gh.clear_config(db)
    return {"ok": True}


@router.post("/sync-now")
def sync_now(db: Session = Depends(get_db)):
    from services_github import run_github_sync
    return run_github_sync(db)
