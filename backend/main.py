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
_db_path = os.environ.get("DB_PATH", os.path.join(_DATA_DIR, "trace.db"))
os.environ["DB_PATH"] = _db_path

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
from routers import (
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
                    "occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP"
                    ")"
                ))
                conn.execute(_text(
                    "INSERT INTO audit_logs_new "
                    "(id, entity_type, entity_id, area_id, thread_id, action, field, old_value, new_value, occurred_at) "
                    "SELECT id, entity_type, entity_id, area_id, thread_id, action, field, old_value, new_value, occurred_at "
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
    try:
        import scheduler
        scheduler.start()
    except Exception as e:
        # Don't let a scheduler bug take the whole API down
        import logging
        logging.getLogger("trace").warning("Scheduler failed to start: %s", e)
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


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routers
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
