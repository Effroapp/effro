# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for the Effro. backend.
Run from the repo root:
    pyinstaller backend/effro-backend.spec
Output lands in dist/effro-backend/ (onedir mode — fast launch, no per-launch
temp extraction, no AV false-positives from --onefile bootloader behaviour).

The binary name (effro-backend.exe) must match what the Tauri shell resolves
as the sidecar (see BACKEND_DIR_NAME in src-tauri/src/main.rs) and what
scripts/build-backend.py stages under src-tauri/binaries/.
"""

import os
from PyInstaller.utils.hooks import collect_data_files

block_cipher = None

# SPECPATH is the directory containing this .spec file (PyInstaller injects
# it into the spec's globals). Everything is anchored relative to that so
# the spec is callable from any CWD.
BACKEND_DIR = SPECPATH
REPO_ROOT = os.path.dirname(BACKEND_DIR)
RUN_SCRIPT = os.path.join(BACKEND_DIR, 'run.py')
frontend_dist = os.path.join(REPO_ROOT, 'frontend', 'dist')

if not os.path.exists(frontend_dist):
    raise RuntimeError(
        f"frontend/dist not found at {frontend_dist}. Run `npm run build` "
        "in the frontend/ directory before invoking PyInstaller, or just run "
        "`python scripts/build-backend.py` which does both in order."
    )


a = Analysis(
    [RUN_SCRIPT],
    pathex=[BACKEND_DIR],
    binaries=[],
    datas=[
        # Bundle the built React app inside the binary
        (frontend_dist, 'frontend/dist'),
        # Bundle icalendar timezone data
        *collect_data_files('icalendar'),
    ],
    hiddenimports=[
        # SQLAlchemy dialects + internals — PyInstaller can't always see these
        'sqlalchemy.dialects.sqlite',
        'sqlalchemy.dialects.sqlite.pysqlite',
        'sqlalchemy.pool',
        'sqlalchemy.pool.impl',
        'sqlalchemy.sql.default_comparator',
        'sqlalchemy.ext.declarative',
        # APScheduler — discovered via string at runtime
        'apscheduler.schedulers.background',
        'apscheduler.triggers.cron',
        'apscheduler.triggers.interval',
        'apscheduler.triggers.date',
        'apscheduler.executors.pool',
        'apscheduler.jobstores.sqlalchemy',
        # Timezone data for APScheduler's Europe/Brussels cron
        'pytz',
        'tzdata',
        # Uvicorn internals
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.loops.auto',
        'uvicorn.loops.asyncio',
        # Anthropic SDK + its transport stack
        'anthropic',
        'httpx',
        'httpcore',
        'anyio',
        'anyio._backends._asyncio',
        'anyio._backends._trio',
        # FastAPI / Starlette
        'starlette.routing',
        'starlette.staticfiles',
        'starlette.middleware.cors',
        'multipart',
        'multipart.multipart',
        'python_multipart',
        # PDF + ical ingest
        'pypdf',
        'icalendar',
        # aiofiles — used by static file serving
        'aiofiles',
        'aiofiles.os',
        'aiofiles.threadpool',
        # Effro's own backend modules (PyInstaller doesn't always discover them
        # when run.py imports them indirectly through `from main import app`).
        # IMPORTANT: every new router gets a line here. Static analysis worked
        # in earlier releases but v0.6.0 shipped with routers/microsoft.py
        # silently absent from the bundle, which 404'd /api/microsoft/auth/login
        # while sibling routes appeared to work. Belt-and-braces from here.
        'main',
        'database',
        'models',
        'schemas',
        'audit',
        'ingest',
        'scheduler',
        'ai_provider',
        'storage_backend',
        'storage_backup',
        'storage_nextcloud',
        'microsoft_graph',
        'services_signals',
        'jira_client',
        'services_jira',
        'routers',
        'routers.areas',
        'routers.threads',
        'routers.entries',
        'routers.attachments',
        'routers.generate',
        'routers.ingest',
        'routers.settings',
        'routers.storage',
        'routers.subtasks',
        'routers.ai_features',
        'routers.nudges',
        'routers.insights',
        'routers.microsoft',
        'routers.signals',
        'routers.jira',
        # MSAL + its lazy-loaded crypto helpers (Microsoft Graph OAuth).
        # PyInstaller doesn't always catch msal's internal `importlib.import_module`
        # calls.
        'msal',
        'msal.application',
        'msal.token_cache',
        'msal.authority',
        'msal.oauth2cli',
        # Auth: passlib lazily imports its argon2 backend BY NAME, and that
        # backend pulls in argon2-cffi - neither is visible to static analysis,
        # so without these the bundled exe ModuleNotFounds on the first hash.
        'passlib.handlers.argon2',
        'argon2',
        'argon2.low_level',
        # New auth backend modules (directly imported by main; listed for parity
        # with the per-router belt-and-braces convention above).
        'auth_utils',
        'dependencies',
        'routers.auth',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # We never ship these — keeps the bundle slim
        'matplotlib', 'numpy', 'pandas', 'PIL', 'tkinter',
        'PyQt5', 'wx', 'gi', 'gtk',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,   # onedir mode — keep deps separate
    name='effro-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    # NOTE: set console=True during initial packaging so tracebacks/print
    # output are visible. Flip to False once you've confirmed the bundle
    # boots cleanly under Tauri.
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='effro-backend',
)
