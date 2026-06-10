import os
import sys
import argparse

# ── CLI args + path resolution (must run before importing database) ──────────
# database.py reads DB_PATH at module-load time and uses it to construct the
# SQLAlchemy engine, so any env-var override needs to be in place BEFORE we
# `from database import …`. Docker continues to work because docker-compose
# already sets DB_PATH explicitly; the Tauri sidecar passes --data-dir.
parser = argparse.ArgumentParser(description="Effro. backend")
parser.add_argument("--port", type=int, default=None, help="Port to listen on")
parser.add_argument("--data-dir", type=str, default=None, help="Data directory path")
_args, _unknown = parser.parse_known_args()

# Path resolution - onedir-frozen vs. interpreter / Docker run
if getattr(sys, "frozen", False):
    # PyInstaller onedir: sys.executable is the launcher, _MEIPASS is _internal/
    _BUNDLE_DIR = os.path.dirname(sys.executable)
    _INTERNAL_DIR = sys._MEIPASS  # type: ignore[attr-defined]
    _DEFAULT_FRONTEND = os.path.join(_INTERNAL_DIR, "frontend", "dist")
else:
    _BUNDLE_DIR = os.path.dirname(os.path.abspath(__file__))
    _DEFAULT_FRONTEND = os.path.join(_BUNDLE_DIR, "..", "frontend", "dist")

if _args.data_dir:
    _DATA_DIR = _args.data_dir
else:
    _DATA_DIR = os.environ.get("DATA_DIR", os.path.join(_BUNDLE_DIR, "data"))

os.makedirs(_DATA_DIR, exist_ok=True)

# Propagate DB_PATH BEFORE the database module is imported.
_db_path = os.environ.get("DB_PATH", os.path.join(_DATA_DIR, "effro.db"))
os.environ["DB_PATH"] = _db_path

# One-time DB migration for the Trace -> Effro rebrand: if the new effro.db
# doesn't exist yet but a legacy trace.db does in this data dir, hand it to
# SQLite (which recovers any hot rollback-journal and checkpoints a WAL on open)
# and then rename it across. Done here, before database.py builds the engine, so
# the app opens the user's real data instead of creating an empty DB. Idempotent
# (no-op once effro.db exists); harmless for Docker (uses department.db, with no
# trace.db present).
_legacy_db = os.path.join(_DATA_DIR, "trace.db")
if not os.path.exists(_db_path) and os.path.exists(_legacy_db):
    try:
        import sqlite3
        _c = sqlite3.connect(_legacy_db)  # opening recovers any hot journal
        try:
            _c.execute("PRAGMA wal_checkpoint(TRUNCATE)")  # no-op in rollback mode
            _c.commit()
        finally:
            _c.close()
        os.replace(_legacy_db, _db_path)
        for _ext in ("-wal", "-shm", "-journal"):
            _src, _dst = _legacy_db + _ext, _db_path + _ext
            if os.path.exists(_src) and not os.path.exists(_dst):
                os.replace(_src, _dst)
        print(f"Migrated database {_legacy_db} -> {_db_path}", flush=True)
    except Exception as _e:
        print(f"DB migration failed ({_legacy_db} -> {_db_path}): {_e}",
              file=sys.stderr, flush=True)

UPLOAD_DIR = os.environ.get("UPLOAD_DIR", os.path.join(_DATA_DIR, "uploads"))
FRONTEND_DIST = os.environ.get("FRONTEND_DIST", _DEFAULT_FRONTEND)

# ── Now safe to import everything that depends on the env ───────────────────
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse

import models
from database import engine, SessionLocal
from auth_utils import SESSION_COOKIE
from dependencies import auth_enabled
import licence_manager
from routers import (
    auth as auth_router,
    account as account_router,
    admin as admin_router,
    areas, threads, entries, attachments, generate, ingest,
    settings as settings_router,
    storage as storage_router,
    subtasks as subtasks_router,
    ai_features as ai_features_router,
    nudges as nudges_router,
    insights as insights_router,
    microsoft as microsoft_router,
    signals as signals_router,
    jira as jira_router,
    google as google_router,
    dropbox as dropbox_router,
    icloud as icloud_router,
    github as github_router,
    presence as presence_router,
    folio as folio_router,
)

# Effro. launches with no seeded areas - the user creates their own from the
# sidebar's "+ Add your first area" prompt. The previous seven-area software
# seed was removed when the product was broadened away from a single-team
# deployment; existing installations are unaffected because the seed only
# ever ran when the areas table was empty.
INITIAL_AREAS = []

# Hand-written starter set for the dashboard's daily nudge. Calm, second-person,
# never demanding. The AI can add more over time (source='ai'); these are the
# always-present baseline seeded on first run.
SEED_NUDGES = [
    "Keeping each area current quietly takes the strain off your next update - a sentence or two is plenty.",
    "Before a meeting, a five-minute skim of the related area is often all it takes to feel ready.",
    "Little and often beats a big catch-up. A short note today saves a long one later.",
    "Capture the thought while it's fresh - you can always tidy it up afterwards.",
    "Threads keep related work together, so nothing important quietly drifts out of view.",
    "When notes pile up, Smart Generate can turn the mess into clear next steps.",
    "Marking something done is worth the small moment - the closure adds up.",
    "If an area's gone quiet, a quick look might surface something waiting on you.",
    "Big tasks feel lighter once they're broken into a few honest steps.",
    "You don't need to record everything - just enough that future-you isn't left guessing.",
    "The weekly roundup reads your progress back to you, so you don't have to hold it all in your head.",
    "A calm two-minute check-in is usually enough to stay across everything.",
    "Jot the decision and the why - the reasoning is the part that's easiest to forget.",
    "Updating as you go means there's never a daunting backlog waiting for you.",
]


def _init_db():
    """Create all tables and seed initial areas if the database is empty."""
    from sqlalchemy import text
    models.Base.metadata.create_all(bind=engine)
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    # Safe migration: add new columns to existing databases
    with engine.connect() as conn:
        for sql in [
            "ALTER TABLE entries ADD COLUMN type VARCHAR(20) DEFAULT 'entry'",
            "ALTER TABLE entries ADD COLUMN completed BOOLEAN DEFAULT 0",
            "ALTER TABLE entries ADD COLUMN completed_at DATETIME",
            "ALTER TABLE entries ADD COLUMN due_date DATE",
            "ALTER TABLE activity_events ADD COLUMN detail VARCHAR(200)",
            "CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY, entity_type VARCHAR(50), entity_id INTEGER, area_id INTEGER REFERENCES areas(id) ON DELETE CASCADE, thread_id INTEGER REFERENCES threads(id) ON DELETE SET NULL, action VARCHAR(50), field VARCHAR(100), old_value TEXT, new_value TEXT, occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
            "ALTER TABLE audit_logs ADD COLUMN area_id INTEGER REFERENCES areas(id) ON DELETE CASCADE",
            "ALTER TABLE areas ADD COLUMN icon VARCHAR(64)",
            "ALTER TABLE entries ADD COLUMN meeting_at DATETIME",
            "ALTER TABLE entries ADD COLUMN notes TEXT",
            # AI engine config + future generic app settings
            "CREATE TABLE IF NOT EXISTS app_settings (key VARCHAR(100) PRIMARY KEY, value TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
            # Cloud storage / sync log + per-attachment sync state
            "CREATE TABLE IF NOT EXISTS storage_sync_logs (id INTEGER PRIMARY KEY, event_type VARCHAR(30) DEFAULT 'backup', status VARCHAR(20) NOT NULL, provider VARCHAR(30), remote_path VARCHAR(500), size_bytes INTEGER, error_message TEXT, occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
            "ALTER TABLE attachments ADD COLUMN remote_path VARCHAR(500)",
            "ALTER TABLE attachments ADD COLUMN sync_status VARCHAR(20) DEFAULT 'local'",
            # Task decomposition - subtasks are entries with a parent_id
            "ALTER TABLE entries ADD COLUMN parent_id INTEGER REFERENCES entries(id) ON DELETE CASCADE",
            "ALTER TABLE entries ADD COLUMN time_estimate_minutes INTEGER",
            "ALTER TABLE entries ADD COLUMN subtask_order INTEGER",
            "ALTER TABLE entries ADD COLUMN decomp_dismissed BOOLEAN DEFAULT 0",
            # Daily dashboard nudges
            "CREATE TABLE IF NOT EXISTS nudges (id INTEGER PRIMARY KEY, text TEXT NOT NULL, source VARCHAR(20) DEFAULT 'seed', active BOOLEAN DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
            # Signals / Microsoft 365 integration
            "CREATE TABLE IF NOT EXISTS microsoft_integrations (id INTEGER PRIMARY KEY, microsoft_user_id VARCHAR(256) NOT NULL UNIQUE, access_token_enc TEXT NOT NULL, refresh_token_enc TEXT, token_expiry DATETIME, display_name VARCHAR(256), email VARCHAR(256), job_title VARCHAR(256), department VARCHAR(256), office_location VARCHAR(256), avatar_data_uri TEXT, connected_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_synced DATETIME)",
            "CREATE TABLE IF NOT EXISTS signal_items (id INTEGER PRIMARY KEY, source VARCHAR(30) NOT NULL, external_id VARCHAR(256) NOT NULL, kind VARCHAR(30) NOT NULL, title VARCHAR(500) NOT NULL, starts_at DATETIME, ends_at DATETIME, location VARCHAR(500), organizer VARCHAR(255), is_all_day BOOLEAN DEFAULT 0 NOT NULL, status VARCHAR(20) DEFAULT 'pending' NOT NULL, suggested_area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL, suggested_thread_id INTEGER REFERENCES threads(id) ON DELETE SET NULL, assigned_entry_id INTEGER REFERENCES entries(id) ON DELETE SET NULL, raw_json TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_items_source_external ON signal_items(source, external_id)",
            "CREATE INDEX IF NOT EXISTS idx_signal_items_status ON signal_items(status)",
            # Jira integration
            "CREATE TABLE IF NOT EXISTS jira_integrations (id INTEGER PRIMARY KEY, atlassian_user_id VARCHAR(256) NOT NULL UNIQUE, cloud_id VARCHAR(256) NOT NULL, cloud_name VARCHAR(256), access_token_enc TEXT NOT NULL, refresh_token_enc TEXT, token_expiry DATETIME, display_name VARCHAR(256), email VARCHAR(256), avatar_url VARCHAR(500), connected_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_synced DATETIME)",
            # Google Drive/Docs integration
            "CREATE TABLE IF NOT EXISTS google_integrations (id INTEGER PRIMARY KEY, google_user_id VARCHAR(256) NOT NULL UNIQUE, access_token_enc TEXT NOT NULL, refresh_token_enc TEXT, token_expiry DATETIME, display_name VARCHAR(256), email VARCHAR(256), avatar_url VARCHAR(500), connected_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_synced DATETIME)",
            # Dropbox storage backend
            "CREATE TABLE IF NOT EXISTS dropbox_integrations (id INTEGER PRIMARY KEY, dropbox_account_id VARCHAR(256) NOT NULL UNIQUE, access_token_enc TEXT NOT NULL, refresh_token_enc TEXT, token_expiry DATETIME, display_name VARCHAR(256), email VARCHAR(256), connected_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
            # External provenance on Entry (Signals → committed meetings)
            "ALTER TABLE entries ADD COLUMN external_id VARCHAR(256)",
            "CREATE INDEX IF NOT EXISTS idx_entries_external_id ON entries(external_id)",
            # Area summary freshness + auto-update opt-in
            "ALTER TABLE areas ADD COLUMN summary_updated_at DATETIME",
            "ALTER TABLE areas ADD COLUMN summary_auto_generated BOOLEAN DEFAULT 0",
            "ALTER TABLE areas ADD COLUMN summary_auto_update BOOLEAN DEFAULT 0",
            # Thread AI Overview — same shape as areas
            "ALTER TABLE threads ADD COLUMN summary TEXT DEFAULT ''",
            "ALTER TABLE threads ADD COLUMN summary_updated_at DATETIME",
            "ALTER TABLE threads ADD COLUMN summary_auto_generated BOOLEAN DEFAULT 0",
            "ALTER TABLE threads ADD COLUMN summary_auto_update BOOLEAN DEFAULT 0",
            "ALTER TABLE threads ADD COLUMN position INTEGER",
            # Work sessions - heartbeat-derived presence, powers the Insights wind-down
            "CREATE TABLE IF NOT EXISTS work_sessions (id INTEGER PRIMARY KEY, started_at DATETIME NOT NULL, ended_at DATETIME NOT NULL, ping_count INTEGER DEFAULT 1)",
            # ── Authentication (flag-gated via EFFRO_AUTH_ENABLED) ──────────────
            "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email VARCHAR(320) NOT NULL UNIQUE, display_name VARCHAR(200), password_hash VARCHAR(512), role VARCHAR(20) NOT NULL DEFAULT 'member', is_active BOOLEAN NOT NULL DEFAULT 1, sso_subject VARCHAR(320), sso_provider VARCHAR(320), created_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_login_at DATETIME)",
            "ALTER TABLE users ADD COLUMN avatar TEXT",
            "CREATE TABLE IF NOT EXISTS user_sessions (id VARCHAR(64) PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL, last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP, ip_address VARCHAR(64), user_agent VARCHAR(512), is_active BOOLEAN NOT NULL DEFAULT 1)",
            "CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id)",
            "CREATE TABLE IF NOT EXISTS password_reset_tokens (id VARCHAR(64) PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL, used BOOLEAN NOT NULL DEFAULT 0)",
            "ALTER TABLE audit_logs ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
            # GDPR account-deletion tombstone
            "CREATE TABLE IF NOT EXISTS deletion_log (id INTEGER PRIMARY KEY, email_hash VARCHAR(64) NOT NULL, deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP, reason VARCHAR(200))",
            # ── Folio (flag-gated via EFFRO_FOLIO_ENABLED) ──────────────────────
            # The folios/captures/digests/topics tables are ORM models created by
            # create_all above. This standalone FTS5 index is the only raw add:
            # the folio router keeps it in sync per folio (title + every capture's
            # extracted_text + the current digest). folio_id is UNINDEXED so it is
            # stored for lookup but not tokenised. No-ops harmlessly (try/except
            # below) if a build's SQLite lacks FTS5 - search just returns nothing.
            "CREATE VIRTUAL TABLE IF NOT EXISTS folio_fts USING fts5(folio_id UNINDEXED, title, body)",
        ]:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass

    # Backfill area_id for any existing audit_log rows that pre-date the column
    try:
        from sqlalchemy import text as _text
        with engine.connect() as conn:
            conn.execute(_text(
                "UPDATE audit_logs SET area_id = "
                "(SELECT area_id FROM threads WHERE threads.id = audit_logs.thread_id) "
                "WHERE area_id IS NULL AND thread_id IS NOT NULL"
            ))
            conn.commit()
    except Exception:
        pass

    # Rebuild audit_logs if thread_id was created with NOT NULL (older schemas).
    # Area-only audits (status/summary change) pass thread_id=None and would
    # otherwise raise IntegrityError, poisoning the surrounding transaction.
    try:
        from sqlalchemy import text as _text
        with engine.connect() as conn:
            info = conn.execute(_text("PRAGMA table_info(audit_logs)")).fetchall()
            thread_col = next((c for c in info if c[1] == "thread_id"), None)
            # PRAGMA table_info columns: (cid, name, type, notnull, dflt_value, pk)
            if thread_col is not None and thread_col[3] == 1:
                conn.execute(_text("PRAGMA foreign_keys=OFF"))
                # user_id is added by the ALTER above before this rebuild runs, so
                # it already exists on the source table; carry it through (and keep
                # it last-before-occurred_at to match the model) or it would be
                # silently dropped for users whose DB still triggers this rebuild.
                conn.execute(_text(
                    "CREATE TABLE audit_logs_new ("
                    "id INTEGER PRIMARY KEY, "
                    "entity_type VARCHAR(50) NOT NULL, "
                    "entity_id INTEGER NOT NULL, "
                    "area_id INTEGER REFERENCES areas(id) ON DELETE CASCADE, "
                    "thread_id INTEGER REFERENCES threads(id) ON DELETE SET NULL, "
                    "action VARCHAR(50) NOT NULL, "
                    "field VARCHAR(100), "
                    "old_value TEXT, "
                    "new_value TEXT, "
                    "user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, "
                    "occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP"
                    ")"
                ))
                conn.execute(_text(
                    "INSERT INTO audit_logs_new "
                    "(id, entity_type, entity_id, area_id, thread_id, action, field, old_value, new_value, user_id, occurred_at) "
                    "SELECT id, entity_type, entity_id, area_id, thread_id, action, field, old_value, new_value, user_id, occurred_at "
                    "FROM audit_logs"
                ))
                conn.execute(_text("DROP TABLE audit_logs"))
                conn.execute(_text("ALTER TABLE audit_logs_new RENAME TO audit_logs"))
                conn.execute(_text("PRAGMA foreign_keys=ON"))
                conn.commit()
    except Exception:
        pass

    db = SessionLocal()
    try:
        if db.query(models.Area).count() == 0:
            for data in INITIAL_AREAS:
                db.add(models.Area(**data))
            db.commit()
        # Seed the daily nudge pool on first run (idempotent - only when empty).
        if db.query(models.Nudge).count() == 0:
            for text in SEED_NUDGES:
                db.add(models.Nudge(text=text, source="seed"))
            db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_db()
    # Licence-required provisioning: seed (or re-surface) the one-time setup
    # token while no users exist, and print it to the container logs - the only
    # place it is ever shown. /auth/setup requires it; it is consumed atomically
    # by the first admin's creation. No-op on desktop / licence-off.
    try:
        _db = SessionLocal()
        try:
            _tok = licence_manager.ensure_setup_token(_db)
        finally:
            _db.close()
        if _tok:
            print(f"[effro] First-run setup token (required by /setup): {_tok}", flush=True)
    except Exception as e:
        import logging
        logging.getLogger("effro").warning("Setup-token seeding failed: %s", e)
    try:
        import scheduler
        scheduler.start()
    except Exception as e:
        # Don't let a scheduler bug take the whole API down
        import logging
        logging.getLogger("effro").warning("Scheduler failed to start: %s", e)
    yield
    try:
        import scheduler
        scheduler.shutdown()
    except Exception:
        pass


app = FastAPI(title="Effro.", version="1.0.0", lifespan=lifespan)


@app.get("/api/health")
async def health():
    """Liveness probe used by the Tauri shell to know when to show the window."""
    return JSONResponse({"status": "ok"})


# ── Auth gate (flag-gated, default-deny) ─────────────────────────────────────
# When EFFRO_AUTH_ENABLED is on, every /api and /uploads request requires a
# valid session cookie EXCEPT an explicit public allowlist: the health probe,
# the auth endpoints that create a session, and the OAuth redirect endpoints the
# provider / system browser hit with no cookie. Default-deny means a new
# endpoint is protected unless deliberately exempted here. When the flag is off
# (the desktop build) this is a no-op and the app runs login-free.
from datetime import datetime as _dt

_PUBLIC_API_EXACT = {
    "/api/health",
    "/api/auth/setup",
    "/api/auth/setup/status",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/me",               # self-gates via get_current_user
    "/api/auth/set-password",     # consumes an emailed single-use token
    "/api/auth/oidc/config",
    "/api/auth/oidc/login",
    "/api/auth/oidc/callback",
}
# Per-integration OAuth redirect endpoints (browser/provider hits, no cookie).
# github + icloud are PAT/app-password based and have no redirect, so nothing
# of theirs is public.
_OAUTH_PUBLIC_INTEGRATIONS = ("microsoft", "google", "jira", "dropbox")


def _is_public_api_path(path: str) -> bool:
    if path in _PUBLIC_API_EXACT:
        return True
    # Invite / reset links carry the token in the path.
    if path.startswith("/api/auth/reset-token/"):
        return True
    for name in _OAUTH_PUBLIC_INTEGRATIONS:
        if path in (f"/api/{name}/auth/login", f"/api/{name}/auth/callback"):
            return True
    return False


def _has_valid_session(token) -> bool:
    if not token:
        return False
    db = SessionLocal()
    try:
        # Join User and require it active too: a suspended / GDPR-deleted user
        # (User.is_active=False) must not pass the gate on a session that has not
        # yet expired. Mirrors the same check in dependencies.get_current_user.
        return db.query(models.UserSession).join(models.User).filter(
            models.UserSession.id == token,
            models.UserSession.is_active == True,  # noqa: E712
            models.UserSession.expires_at > _dt.utcnow(),
            models.User.is_active == True,  # noqa: E712
        ).first() is not None
    finally:
        db.close()


# ── Connector gate (flag-gated; Enterprise disables per-user connectors) ─────
# When a licence is required and its edition disallows personal connectors
# (Enterprise), the per-user integration connect/config/test/sync endpoints are
# refused with 403. The public OAuth *callbacks* (provider hits, no cookie) and
# plain GET reads (so the UI can show "managed by your admin") are left alone.
# Defined BEFORE licence_gate so it is INNER to both it and auth_gate: 401
# (not signed in) then 402 (read-only) then 403 (connector) is the precedence.
_CONNECTOR_INTEGRATIONS = ("microsoft", "google", "jira", "github", "icloud", "dropbox")


def _is_connector_action(path: str, method: str) -> bool:
    for name in _CONNECTOR_INTEGRATIONS:
        if path.startswith(f"/api/{name}/"):
            if path.endswith("/auth/callback"):
                return False                 # public provider redirect - never block
            if path.endswith("/auth/login"):
                return True                  # initiating a personal connection (GET redirect)
            return method in ("POST", "PUT", "PATCH", "DELETE")  # config/exchange/test/sync/disconnect
    return False


@app.middleware("http")
async def connector_gate(request, call_next):
    if licence_manager.licence_required() and _is_connector_action(request.url.path, request.method):
        db = SessionLocal()
        try:
            allowed = licence_manager.edition_caps(licence_manager.current(db)).personal_connectors_allowed
        finally:
            db.close()
        if not allowed:
            return JSONResponse(
                {
                    "detail": "Personal integrations are disabled on this licence. "
                              "Your administrator manages connections.",
                    "code": "connectors_disabled",
                },
                status_code=403,
            )
    return await call_next(request)


# ── Licence gate (flag-gated; read-only on expiry / invalid / missing) ───────
# When EFFRO_LICENCE_REQUIRED is on and the licence is in the read-only state
# (over-grace, invalid signature, or required-but-missing), block mutating /api
# requests with 402 - while keeping reads, data export, the auth flows, and
# licence renewal open, so the customer can always reach + export their data and
# paste a new key. Defined BEFORE auth_gate so it is INNER to it: auth's 401
# takes precedence over the licence 402. No-op when the flag is off (desktop).
def _licence_write_allowed(path: str) -> bool:
    # Auth flows (login / logout / set-password / sessions) and pasting a
    # renewal key must work even in read-only.
    return path.startswith("/api/auth/") or path == "/api/admin/licence"


def _is_connector_get_write(path: str, method: str) -> bool:
    # The integration OAuth /auth/login (mints a state row) and /auth/callback
    # (stores tokens) are GET handlers that WRITE, so the verb-based check below
    # would let them run in read-only. Treat them as writes for the gate.
    if method != "GET":
        return False
    if not (path.endswith("/auth/login") or path.endswith("/auth/callback")):
        return False
    return any(path.startswith(f"/api/{n}/") for n in _CONNECTOR_INTEGRATIONS)


@app.middleware("http")
async def licence_gate(request, call_next):
    if licence_manager.licence_required():
        path = request.url.path
        method = request.method
        mutating = method in ("POST", "PUT", "PATCH", "DELETE") or _is_connector_get_write(path, method)
        if mutating and path.startswith("/api/") and not _licence_write_allowed(path):
            db = SessionLocal()
            try:
                read_only = licence_manager.state(licence_manager.current(db)) == "read_only"
            finally:
                db.close()
            if read_only:
                return JSONResponse(
                    {
                        "detail": "This workspace is read-only because the licence has "
                                  "expired or is invalid. An admin can renew it in Settings.",
                        "code": "licence_read_only",
                    },
                    status_code=402,
                )
    return await call_next(request)


@app.middleware("http")
async def auth_gate(request, call_next):
    if auth_enabled() and request.method != "OPTIONS":
        path = request.url.path
        if (path.startswith("/api/") or path.startswith("/uploads/")) \
                and not _is_public_api_path(path):
            if not _has_valid_session(request.cookies.get(SESSION_COOKIE)):
                return JSONResponse({"detail": "Not authenticated"}, status_code=401)
    return await call_next(request)


# CORS: with cookie auth, credentialed cross-origin requests need a concrete
# origin (not "*"). Desktop/dev are same-origin, so "*" without credentials is
# fine there; a hosted deployment sets EFFRO_CORS_ORIGINS to its web origin(s).
# Added AFTER auth_gate so CORS is outermost (handles OPTIONS preflight and adds
# headers to the gate's 401s).
_cors_origins = os.environ.get("EFFRO_CORS_ORIGINS", "").strip()
if auth_enabled() and _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in _cors_origins.split(",") if o.strip()],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

# API routers
# Auth first - it is always public and creates the sessions everything else uses.
app.include_router(auth_router.router, prefix="/api")
app.include_router(account_router.router, prefix="/api")
app.include_router(admin_router.router, prefix="/api")
app.include_router(areas.router, prefix="/api")
app.include_router(threads.router, prefix="/api")
app.include_router(entries.router, prefix="/api")
app.include_router(attachments.router, prefix="/api")
app.include_router(generate.router, prefix="/api")
app.include_router(ingest.router, prefix="/api")
app.include_router(settings_router.router, prefix="/api")
app.include_router(storage_router.router, prefix="/api")
app.include_router(subtasks_router.router, prefix="/api")
app.include_router(ai_features_router.router, prefix="/api")
app.include_router(nudges_router.router, prefix="/api")
app.include_router(insights_router.router, prefix="/api")
app.include_router(microsoft_router.router, prefix="/api")
app.include_router(signals_router.router, prefix="/api")
app.include_router(jira_router.router, prefix="/api")
app.include_router(google_router.router, prefix="/api")
app.include_router(dropbox_router.router, prefix="/api")
app.include_router(icloud_router.router, prefix="/api")
app.include_router(github_router.router, prefix="/api")
app.include_router(presence_router.router, prefix="/api")
app.include_router(folio_router.router, prefix="/api")

# Serve uploaded files at /uploads/<stored_name>
if os.path.exists(UPLOAD_DIR):
    app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


# Serve the compiled React app (production only).
#
# StaticFiles' html=True mode only falls back to index.html for DIRECTORY
# paths, not arbitrary client-side routes - so a hard navigation to
# /settings, /insights, /signals, /thread/123 etc. would 404. This bit
# the Microsoft 365 OAuth flow in v0.6.0-0.6.2: the auth_login handler's
# error branch issues `RedirectResponse(url="/settings?ms_error=...")`,
# and the resulting hard navigation hit the static mount's 404.
#
# Fix: a SPAStaticFiles subclass catches the 404 and serves index.html.
# React Router then picks up the path on the client side. /api/* paths
# are still handled by the routers above this mount, so this only affects
# unmatched non-API paths (i.e. genuine SPA routes).
if os.path.exists(FRONTEND_DIST):
    from fastapi.responses import FileResponse
    from starlette.exceptions import HTTPException as StarletteHTTPException

    class SPAStaticFiles(StaticFiles):
        async def get_response(self, path, scope):
            try:
                return await super().get_response(path, scope)
            except StarletteHTTPException as e:
                # 404 on /api/* stays a genuine 404 - this is what makes
                # bad API calls obvious during development. SPA paths fall
                # back to index.html so React Router can take it from there.
                if e.status_code == 404 and not path.startswith("api/") and not path.startswith("uploads/"):
                    return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
                raise

    app.mount("/", SPAStaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
