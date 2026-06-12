"""
Connector registry + workspace connection policy.

One place that knows which per-user connectors exist, so the gate in main.py,
the admin policy API, the scheduler and the frontend (via /auth/me) can never
drift apart again.

Policy model (mirrors the licence pattern of "edition default + admin config,
resolved in one place"):
  - Desktop / unlicensed (licence not required): the gate is a no-op and every
    connector is available. Nothing here applies.
  - Licensed workspace: the EDITION sets the default (Pro: connectors on,
    Enterprise: connectors off), and an admin can override any single
    connector from Settings. Overrides live in app_settings under
    "connector_policy" as {"<key>": true|false} - absent key = edition default.

Sync jobs consult connector_enabled() too, so switching a connector off also
stops its background pull, not just the buttons.
"""
from __future__ import annotations

import json
import logging

from sqlalchemy.orm import Session

import licence_manager
import models

log = logging.getLogger("effro.connectors")

_POLICY_KEY = "connector_policy"

# The canonical list. Keys double as the URL segment (/api/<key>/...) and the
# frontend integration key, labels match the Settings cards. "sync" names the
# connector's signal-sync runner (module, function) - used by both the
# scheduler and POST /signals/sync-now, so a new connector is wired into both
# by its registry entry alone. Dropbox is storage-only: no sync.
CONNECTORS = (
    {"key": "microsoft", "label": "Microsoft 365", "sync": ("services_signals",  "run_microsoft_sync")},
    {"key": "google",    "label": "Google",        "sync": ("services_google",   "run_google_sync")},
    {"key": "jira",      "label": "Jira",          "sync": ("services_jira",     "run_jira_sync")},
    {"key": "icloud",    "label": "iCloud",        "sync": ("services_icloud",   "run_icloud_sync")},
    {"key": "github",    "label": "GitHub",        "sync": ("services_github",   "run_github_sync")},
    {"key": "dropbox",   "label": "Dropbox",       "sync": None},
    {"key": "telegram",  "label": "Telegram",      "sync": ("services_telegram", "run_telegram_sync")},
    {"key": "mail",      "label": "Email (IMAP)",  "sync": ("services_mail",     "run_mail_sync")},
)

CONNECTOR_KEYS = tuple(c["key"] for c in CONNECTORS)


def sync_runner(key: str):
    """The connector's signal-sync function (imported lazily - the service
    modules pull in their API clients), or None when it has no sync."""
    entry = next((c for c in CONNECTORS if c["key"] == key), None)
    if not entry or not entry.get("sync"):
        return None
    module_name, func_name = entry["sync"]
    import importlib
    return getattr(importlib.import_module(module_name), func_name)


# ─── Policy storage ───────────────────────────────────────────────────────────

def get_overrides(db: Session) -> dict:
    """The admin's explicit per-connector overrides ({key: bool}). Unknown keys
    are dropped on read so a stale row can never block or unlock anything."""
    row = db.query(models.AppSettings).filter(models.AppSettings.key == _POLICY_KEY).first()
    if not row or not row.value:
        return {}
    try:
        raw = json.loads(row.value)
        return {k: bool(v) for k, v in raw.items() if k in CONNECTOR_KEYS and isinstance(v, bool)}
    except Exception as e:
        log.warning("connector policy parse failed: %s", e)
        return {}


def save_overrides(db: Session, overrides: dict) -> dict:
    """Replace the override set. Values: True/False to pin a connector on/off,
    None to drop the override (back to the edition default). Unknown keys are
    rejected by the router before this is called."""
    current = get_overrides(db)
    for key, val in overrides.items():
        if val is None:
            current.pop(key, None)
        else:
            current[key] = bool(val)
    payload = json.dumps(current)
    row = db.query(models.AppSettings).filter(models.AppSettings.key == _POLICY_KEY).first()
    if row:
        row.value = payload
    else:
        db.add(models.AppSettings(key=_POLICY_KEY, value=payload))
    db.commit()
    return current


# ─── Resolution ───────────────────────────────────────────────────────────────

def edition_default(db: Session) -> bool:
    """The edition's default answer for "are personal connectors available?".
    Pro: yes. Enterprise: no (the admin opens up specific ones)."""
    ctx = licence_manager.current(db)
    return licence_manager.edition_caps(ctx).personal_connectors_allowed


def connector_enabled(db: Session, key: str) -> bool:
    """Effective availability of one connector on this instance. Desktop and
    unlicensed installs always get everything; on a licensed workspace the
    admin override wins, else the edition default."""
    if not licence_manager.licence_required():
        return True
    if key not in CONNECTOR_KEYS:
        return False
    overrides = get_overrides(db)
    if key in overrides:
        return overrides[key]
    return edition_default(db)


def enabled_map(db: Session) -> dict:
    """{key: bool} for every connector - what /auth/me hands the frontend."""
    if not licence_manager.licence_required():
        return {k: True for k in CONNECTOR_KEYS}
    default = edition_default(db)
    overrides = get_overrides(db)
    return {k: overrides.get(k, default) for k in CONNECTOR_KEYS}


def admin_status(db: Session) -> dict:
    """The full picture for the admin panel: each connector's label, the
    edition default, the explicit override (if any), and what is in effect."""
    default = edition_default(db)
    overrides = get_overrides(db)
    return {
        "edition_default": default,
        "connectors": [
            {
                "key": c["key"],
                "label": c["label"],
                "override": overrides.get(c["key"]),
                "enabled": overrides.get(c["key"], default),
            }
            for c in CONNECTORS
        ],
    }
