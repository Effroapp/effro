"""
Authentication primitives kept in one place so password hashing and session
token generation never get scattered across routers.

Passwords are hashed with Argon2 (via passlib); session ids are 256 bits of
OS randomness from the stdlib `secrets`. Fernet (cryptography) is already
bundled for encrypting third-party secrets and is not used here.
"""
import secrets
from datetime import datetime, timedelta

from passlib.context import CryptContext

# Name of the cookie that carries the session id. HttpOnly + SameSite are set
# by the auth router when it issues the cookie.
SESSION_COOKIE = "effro_session"
# How long a session stays valid without re-login.
SESSION_EXPIRY_DAYS = 30

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

# A fixed Argon2 hash of random input. Login verifies the submitted password
# against this when the account is missing / passwordless / inactive, so every
# failure path pays the same hashing cost and timing can't reveal whether an
# account exists (user-enumeration oracle).
DUMMY_PASSWORD_HASH = pwd_context.hash(secrets.token_hex(16))


def hash_password(plain: str) -> str:
    """Return an Argon2 hash for a plaintext password."""
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Check a plaintext password against a stored Argon2 hash."""
    return pwd_context.verify(plain, hashed)


def generate_session_token() -> str:
    """A 256-bit random token (64 hex chars) used as a session / reset id."""
    return secrets.token_hex(32)


def session_expiry() -> datetime:
    """Naive-UTC expiry timestamp SESSION_EXPIRY_DAYS from now."""
    return datetime.utcnow() + timedelta(days=SESSION_EXPIRY_DAYS)
