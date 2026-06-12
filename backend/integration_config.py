"""
Shared config store for credential-based integrations (GitHub, iCloud,
Telegram, Mail). One implementation of the load / save / clear / stamp-meta
cycle against app_settings, with the secret fields Fernet-encrypted at rest -
previously copy-pasted per client module, now parameterised by the settings
key and which fields are secret.

OAuth integrations (Microsoft, Google, Jira) keep their own storage: their
tokens live in dedicated tables with refresh flows, not here.
"""
from __future__ import annotations

import json
import logging

from sqlalchemy.orm import Session

import models

log = logging.getLogger("effro.integration_config")


def load(db: Session, key: str, *, secret_fields: tuple = ()) -> dict:
    """Read a config blob; secret fields come back decrypted. Returns {} on
    any parse/decrypt failure so callers degrade to 'not configured'."""
    row = db.query(models.AppSettings).filter(models.AppSettings.key == key).first()
    if not row or not row.value:
        return {}
    try:
        cfg = json.loads(row.value)
        for f in secret_fields:
            if cfg.get(f):
                from storage_backend import decrypt_secret
                cfg[f] = decrypt_secret(cfg[f])
        return cfg
    except Exception as e:
        log.warning("%s parse failed: %s", key, e)
        return {}


def save(db: Session, key: str, values: dict, *, secret_fields: tuple = ()) -> None:
    """Merge values into the stored blob (so meta like last_synced survives a
    credential update); secret fields are encrypted before they touch disk.
    A None value REMOVES that field - how a credential change drops state that
    must not outlive it (e.g. Telegram's poll cursor)."""
    from storage_backend import encrypt_secret
    row = db.query(models.AppSettings).filter(models.AppSettings.key == key).first()
    data = {}
    if row and row.value:
        try:
            data = json.loads(row.value)
        except Exception:
            data = {}
    for f, v in values.items():
        if v is None:
            data.pop(f, None)
        else:
            data[f] = encrypt_secret(v.strip(), db) if f in secret_fields and isinstance(v, str) else v
    payload = json.dumps(data)
    if row:
        row.value = payload
    else:
        db.add(models.AppSettings(key=key, value=payload))
    db.commit()


def set_meta(db: Session, key: str, **fields) -> None:
    """Stamp non-secret fields (login, last_synced, last_update_id...) without
    touching the encrypted credentials. No-op if nothing is stored yet."""
    row = db.query(models.AppSettings).filter(models.AppSettings.key == key).first()
    if not row or not row.value:
        return
    try:
        data = json.loads(row.value)
    except Exception:
        return
    data.update(fields)
    row.value = json.dumps(data)
    db.commit()


def clear(db: Session, key: str) -> None:
    db.query(models.AppSettings).filter(models.AppSettings.key == key).delete()
    db.commit()
