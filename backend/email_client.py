"""
Minimal SMTP email sender on the Python stdlib (smtplib + email.message) - no
new dependency, consistent with the no-heavy-deps policy. Config lives in
app_settings under 'smtp_config'; the password is Fernet-encrypted at rest.

Used for team invite emails (set-password links). Bring-your-own mail server:
the admin configures host/port/credentials in Settings, just like the AI and
storage providers.
"""
import json
import smtplib
import ssl
from email.message import EmailMessage

import models
from storage_backend import encrypt_secret, decrypt_secret

_CONFIG_KEY = "smtp_config"


def _get(db, key):
    row = db.query(models.AppSettings).filter(models.AppSettings.key == key).first()
    return row.value if row else None


def _set(db, key, value):
    row = db.query(models.AppSettings).filter(models.AppSettings.key == key).first()
    if row:
        row.value = value
    else:
        db.add(models.AppSettings(key=key, value=value))
    db.commit()


def _raw(db):
    raw = _get(db, _CONFIG_KEY)
    return json.loads(raw) if raw else None


def get_config(db) -> dict:
    """Safe view (never returns the password, only has_password)."""
    cfg = _raw(db) or {}
    return {
        "enabled": bool(cfg.get("enabled")),
        "host": cfg.get("host", ""),
        "port": int(cfg.get("port") or 587),
        "username": cfg.get("username", ""),
        "from_address": cfg.get("from_address", ""),
        "use_tls": bool(cfg.get("use_tls", True)),
        "has_password": bool(cfg.get("password_enc")),
    }


def save_config(db, *, enabled, host, port, username, from_address, use_tls, password=None) -> dict:
    cfg = _raw(db) or {}
    cfg["enabled"] = bool(enabled)
    cfg["host"] = (host or "").strip()
    cfg["port"] = int(port or 587)
    cfg["username"] = (username or "").strip()
    cfg["from_address"] = (from_address or "").strip()
    cfg["use_tls"] = bool(use_tls)
    # Only overwrite the password when a new one is supplied.
    if password:
        cfg["password_enc"] = encrypt_secret(password, db)
    _set(db, _CONFIG_KEY, json.dumps(cfg))
    return get_config(db)


def is_enabled(db) -> bool:
    c = get_config(db)
    return bool(c["enabled"] and c["host"] and c["from_address"])


def send_email(db, to_address: str, subject: str, body: str) -> None:
    """Send a plain-text email via the configured SMTP server. Raises on failure."""
    cfg = _raw(db)
    if not cfg or not is_enabled(db):
        raise ValueError("Email (SMTP) is not configured")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = cfg["from_address"]
    msg["To"] = to_address
    msg.set_content(body)

    host = cfg["host"]
    port = int(cfg.get("port") or 587)
    username = cfg.get("username") or ""
    password = decrypt_secret(cfg.get("password_enc") or "")
    use_tls = bool(cfg.get("use_tls", True))
    context = ssl.create_default_context()

    if port == 465:
        # Implicit TLS (SMTPS).
        with smtplib.SMTP_SSL(host, port, timeout=15, context=context) as s:
            if username:
                s.login(username, password)
            s.send_message(msg)
    else:
        # Plain + optional STARTTLS (587 submission / 25).
        with smtplib.SMTP(host, port, timeout=15) as s:
            if use_tls:
                s.starttls(context=context)
            if username:
                s.login(username, password)
            s.send_message(msg)
