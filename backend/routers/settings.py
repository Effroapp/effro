"""
Settings router - app-level configuration over HTTP.

Currently exposes:
  - GET  /settings/ai          → current AI config (api key masked)
  - PUT  /settings/ai          → save AI config
  - POST /settings/ai/test     → test a config without saving
  - GET  /settings/ai/presets  → catalogue of supported providers + their
                                 default models / URLs (used by the
                                 frontend picker)
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import licence_manager
import schemas
from database import get_db
from dependencies import get_current_user
from models import User
from ai_provider import (
    get_provider_from_config,
    write_config,
    read_config_for_api,
    _read_config,                # private, but the router is the only legit caller
    PROVIDER_PRESETS,
)

router = APIRouter(tags=["settings"])


@router.get("/settings/ai", response_model=schemas.AIConfigOut)
def get_ai_config(db: Session = Depends(get_db)):
    """Return current AI config with the API key masked to its last 4 chars."""
    return read_config_for_api(db)


@router.get("/settings/ai/presets")
def get_ai_presets():
    """
    Return the list of known provider presets for the frontend picker.

    Includes label, default_model, needs_key, needs_url, base_url, key_prefix
    - never the user's actual key (those live in app_settings).
    """
    return {
        k: {
            "label": v["label"],
            "default_model": v.get("default_model"),
            "needs_key": v.get("needs_key", True),
            "needs_url": v.get("needs_url", False),
            "base_url": v.get("base_url"),
            "key_prefix": v.get("key_prefix"),
        }
        for k, v in PROVIDER_PRESETS.items()
    }


@router.put("/settings/ai", response_model=schemas.AIConfigOut)
def update_ai_config(
    payload: schemas.AIConfig,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Save AI config.

    Edition lock (Enterprise / deploy-pinned): if EFFRO_AI_ENDPOINT pins the
    endpoint, writes are refused for everyone. Otherwise, on an Enterprise
    licence only an admin may set it, and only once - after the first save it is
    pinned and further changes are refused. Pro / desktop stay freely editable.

    The frontend may echo back the *masked* api_key (all bullets) when the
    user is editing other fields without changing the key. Detect that and
    preserve the stored key - otherwise the user would silently nuke their
    key by saving any other field.
    """
    ctx = licence_manager.current(db)
    caps = licence_manager.edition_caps(ctx)
    if licence_manager.ai_endpoint_env():
        raise HTTPException(
            status_code=403,
            detail="The AI endpoint is pinned by deployment policy and cannot be changed here.",
        )
    if caps.ai_endpoint_locked:
        if current_user.role != "admin":
            raise HTTPException(
                status_code=403,
                detail="Only an admin can change the AI configuration on this licence.",
            )
        if licence_manager.ai_pinned(db):
            raise HTTPException(
                status_code=403,
                detail="The AI configuration is locked for this licence and cannot be changed.",
            )

    raw_existing = _read_config(db)

    config = {
        "provider": payload.provider,
        "model": payload.model,
        "base_url": payload.base_url,
        "api_key": payload.api_key,
    }

    # Masked-echo detection: a key consisting entirely of bullets means
    # "don't touch the stored key".
    if payload.api_key and set(payload.api_key.strip()) == {"•"}:
        config["api_key"] = raw_existing.get("api_key", "")

    write_config(db, config)
    # Enterprise: lock after this one-time admin set (env-pin already returned above).
    if caps.ai_endpoint_locked:
        licence_manager.mark_ai_pinned(db)
    return read_config_for_api(db)


@router.post("/settings/ai/test", response_model=schemas.AITestResult)
def test_ai_connection(
    payload: schemas.AIConfig,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Test an AI config without saving it. Same masked-echo handling as PUT
    so users can "Test" a change without first wiping their stored key.
    """
    raw_existing = _read_config(db)

    config = {
        "provider": payload.provider,
        "model": payload.model,
        "base_url": payload.base_url,
        "api_key": payload.api_key,
    }
    if payload.api_key and set(payload.api_key.strip()) == {"•"}:
        # Reusing the STORED key for a test is admin-only: otherwise a non-admin
        # could send a masked key with base_url pointed at their own server and
        # exfiltrate the shared key. Non-admins must supply their own key to test.
        config["api_key"] = raw_existing.get("api_key", "") if current_user.role == "admin" else ""
    # A deploy-pinned endpoint applies to tests too, so nobody can probe the
    # stored key against an arbitrary URL.
    pinned = licence_manager.ai_endpoint_env()
    if pinned:
        config["base_url"] = pinned

    provider = get_provider_from_config(config)
    ok, message = provider.test()

    preset = PROVIDER_PRESETS.get(payload.provider, {})
    return schemas.AITestResult(
        ok=ok,
        message=message,
        provider=payload.provider,
        model=config.get("model") or preset.get("default_model"),
    )
