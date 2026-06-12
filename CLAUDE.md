# Effro — engineering orientation

This file is auto-loaded by Claude Code. Read it before doing anything, then ask
what task to do. Treat accuracy as the highest priority: if you're unsure how
something works, inspect the code rather than guessing.

## What Effro is
A privacy-first desktop app for knowledge workers (QA/ops/PM lean) who juggle
many streams of work. Its job is to sit calmly *alongside* the tools people
already use and pull the important bits into one place. Core ideas:
- Work is organised as **Areas -> Threads -> Entries**. Entry types: entry
  (note/update), todo, decision, meeting, blockage. Threads can have attachments
  (file/link) and links to other threads.
- **Signals**: external items (meetings, emails, issues, PRs) pulled from
  integrations into a triage feed; the user "accepts" one onto a thread (as a
  meeting / to-do / note).
- **Insights**: the flagship reflective page - Reflect (Today / This week),
  Ahead, Balance. Productivity metrics, grounded AI narratives, heartbeat-derived
  working window.
- **Folio**: a deep-research workspace - capture a dive (links, notes, files,
  images) into a folio, then "pull it together" into one grounded, reading-first
  digest. Default-on; hideable via `EFFRO_FOLIO_ENABLED=false`.
- Guiding principles: (1) **Accurate** above all; (2) **Calm & positive** -
  never overwhelm an ADHD reader; (3) **well-designed, consistent, descriptive**,
  with tasteful animation and give-the-user-control affordances (dismissible
  cards, hide toggles).

## Where it lives
- GitHub: `github.com/Effroapp/effro`. Default branch `main`. Feature work lands
  on short-lived `feature/*` branches via PR.
- Latest full release: **v0.12.1**. In development: **v0.13.0** (release
  candidates being cut). Next theme: **"connectivity & integrations"**.

## Architecture (three tiers)
1. **Desktop shell** - Tauri v2 (Rust) in `src-tauri/`. Spawns the backend as a
   sidecar, owns the window + updater + data-dir picker. Key file:
   `src-tauri/src/main.rs`. Config: `src-tauri/tauri.conf.json`. Capabilities:
   `src-tauri/capabilities/default.json`. NSIS installer hook:
   `src-tauri/installer/hooks.nsi`.
2. **Backend** - Python FastAPI, bundled into `effro-backend.exe` via PyInstaller
   (`scripts/build-backend.py`). Runs on **port 8000** (falls back 8001-8010).
   SQLAlchemy + SQLite at `./data/department.db` (override via `DB_PATH` env; the
   shell points this at the user's app-data dir at runtime).
3. **Frontend** - React + Vite + Tailwind. Dev server on **5173**, proxies
   `/api` and file routes to `http://localhost:8000`.

## Backend (`backend/`)
- `main.py` - app, router includes, and the migration block in `_init_db()`
  (additive `ALTER/CREATE TABLE IF NOT EXISTS` strings; also runs
  `Base.metadata.create_all`). No Alembic.
- `models.py` (SQLAlchemy models), `schemas.py` (Pydantic).
- `routers/*.py` - areas, threads, entries, attachments, generate, ingest,
  settings, storage, subtasks, ai_features, nudges, insights, signals, presence,
  folio, and per-integration: microsoft, jira, google, dropbox, icloud, github.
- Integrations follow a repeatable pattern: `<name>_client.py` (API/OAuth client)
  + `services_<name>.py` (sync -> upserts into `signal_items`) +
  `routers/<name>.py` (config/profile/test/auth/sync-now). Credential-based
  ones (github, icloud, telegram, mail) persist config through
  `integration_config.py` (shared load/save/clear/set_meta, secrets
  Fernet-encrypted); frontend cards share `CredentialIntegrationCard.jsx`.
- `connectors.py` - the connector registry + workspace policy, the single
  source of truth consumed by the main.py connector gate, the scheduler, the
  admin API (`/admin/connectors`) and `/auth/me` ("connectors" map). On a
  licensed workspace each connector resolves as edition default (Pro: on,
  Enterprise: off) + per-connector admin override; desktop ignores all of it.
- Storage backends: `storage_backend.py` (abstract + factory + Fernet
  `encrypt_secret`/`decrypt_secret`) and
  `storage_{nextcloud,googledrive,dropbox,s3,webdav}.py`. Backups:
  `storage_backup.py`.
- `scheduler.py` - APScheduler jobs (overview refresh at 12:00 + startup
  catch-up, nightly backup, integration syncs every 30 min).
- `ai_provider.py` - pluggable BYOK AI: `get_provider(db).complete(system=,
  messages=, max_tokens=)` and `.test() -> (ok, msg)`.
- Secrets are **Fernet-encrypted** at rest (key in `app_settings`). All
  third-party config (OAuth client id/secret, PATs, app passwords) is
  **bring-your-own** - never a shared Effro app.

## Frontend (`frontend/src/`)
- `pages/` - Dashboard, Insights, ThreadView, AreaView, Signals, SystemSettings,
  ProcessView.
- `components/` - SettingsMenu, SystemSettings sections, IntegrationsPanel,
  ProviderLogos, SetupGuide, StorageSetupModal, IntroCard, Tooltip, OverviewCard,
  ThreadCard, the per-integration cards, etc.
- `api/` - `client.js` plus per-integration clients (microsoft, jira, google,
  dropbox, icloud, github), `storage.js`, `signals.js`, and `tauri.js` (the Tauri
  bridge - includes `isTauri()` and `openExternal()`).
- `hooks/` - useFont, useBionic, useHeartbeat, useAIConfigured, etc.
  `utils/bionic.jsx` (Bionic reading).

## Brand kit & design rules
- Tailwind tokens: `pitch` (dark), `paper` (light), `mint` (accent, used
  sparingly), plus `sage`, `sky-muted`, `mustard`, `terracotta`, `lavender`,
  `amber-muted`. Always support dark mode.
- Fonts: Geist (default), Geist Mono (meta/labels), Lexend (ADHD), OpenDyslexic,
  and a Bionic reading mode - driven by a `--font-body` CSS var via `useFont`.
  New reading prose should respect `BionicText`.
- Icons: **Lucide React** only.
- Copy: **no em dashes**, calm and plain, never alarmist. Intro/explainer copy
  follows the format **what it is -> how it helps -> why Effro does it**, shown
  as scannable icon-beats (see `IntroCard`), not walls of text.
- External links must use `openExternal()` from `api/tauri.js` (the desktop
  webview blocks `target="_blank"`; only localhost is allow-listed).

## Dev workflow & verification
- Backend venv: `backend/.venv` (run Python as
  `backend/.venv/Scripts/python.exe`). Deps in `backend/requirements.txt`
  (fastapi, sqlalchemy, pydantic, anthropic, openai, httpx, msal, webdavclient3,
  cryptography, apscheduler, icalendar, pypdf...). Avoid adding heavy new deps -
  the integrations deliberately use `httpx`/stdlib so the PyInstaller bundle
  stays clean (e.g. S3 is hand-rolled SigV4, no boto3).
- Frontend: `cd frontend` then `npm ci` / `npm install`; build with
  `npm run build` (CI uses `npm ci`, so keep `package-lock.json` in sync if you
  add deps).
- **How to verify without a full desktop run** (the preferred loop, since the
  Windows installer and live third-party accounts aren't reachable from the dev
  env):
  - Backend: `ast.parse` for syntax, then FastAPI `TestClient` against a temp DB
    (set `DB_PATH` to a temp file; the lifespan runs migrations). For services,
    seed a throwaway DB and call functions directly.
  - Frontend: `npm run build` must pass.
- Always **flag what you could NOT verify** (anything needing a live
  integration/storage account, or the actual Windows installer).

## Build & release
- GitHub Actions `desktop-release.yml` triggers on tags `v*.*.*`. A tag
  **containing a hyphen** (e.g. `v0.12.0-rc1`) builds a **prerelease** (does not
  touch "latest" / auto-update). A **clean** tag (e.g. `v0.12.0`) builds a **full
  release** -> becomes "latest" + the updater target -> auto-updates existing
  users. `desktop-beta.yml` builds on push to `main`.
- To cut a build: bump `version` in `src-tauri/tauri.conf.json` if needed,
  commit, then `git tag -a <tag> -m "..."` and push the tag. CI produces the
  signed NSIS installer + `.sig` + `latest.json`.
- Iterate via `-rcN` prereleases, test, then promote the identical commit to the
  clean tag.

## How to work
- **Commit/push only when asked.** If on `main`, branch first. End every commit
  message with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Make changes **app-wide and consistently** - if you change a pattern (a font,
  copy style, a component), apply it everywhere it appears, not just one screen.
- Prefer asking a focused question when a decision is genuinely the user's
  (architecture, privacy, scope, infra). Otherwise pick the sensible default,
  state it, and proceed.
- When done, give a tight summary and the installer/build link if a build was cut.

## Known constraints & gotchas
- Timezones: the client sends `tz_offset_min`; `meeting_at` is stored as naive
  **local** wall-clock, while `created_at/completed_at/occurred_at` are naive
  **UTC**. Be careful comparing them.
- iCloud **Drive** is not a viable storage target (Apple exposes no third-party
  API); iCloud Calendar/Mail work via CalDAV/IMAP with an app-specific password.
- No telemetry exists yet (planned for v0.12: PostHog EU, anonymous, opt-out).
  Don't write copy claiming usage data is collected until it is.
- There is some dead code in `SystemSettings.jsx` (old stacked integration
  sections, superseded by `IntegrationsPanel`) pending a cleanup sweep.

## Roadmap
- **v0.11.0 (shipped)**: Insights rework; integrations (Jira, Google
  Calendar+Gmail, iCloud Calendar+Mail, GitHub); five storage backends
  (Nextcloud, Google Drive, Dropbox, S3-compatible, WebDAV); tabbed Settings with
  ADHD-first intro cards + official icons + connected/Add; system-browser links;
  timeout-hardened installer.
- **v0.12.x (shipped)**: Effro rebrand (Trace -> Effro); auth / sessions / GDPR
  with optional Entra OIDC SSO (flag-gated, off on desktop); licensing + editions
  (community / enterprise, Ed25519-signed keys); "Load demo data".
- **v0.13.0 (in development)**: Folio - deep-research capture (link / note / file
  / image) pulled together into one grounded digest. Shipping enabled by default.
- **Next theme - connectivity & integrations**: inbound webhook + a small cloud
  relay (so Zapier/Make/native automations can push work items to the local app),
  then native integrations (Notion, Linear, Asana, Trello, Zoho, GitLab, the
  Atlassian suite incl. Confluence, Azure DevOps, Monday, ClickUp); telemetry
  (PostHog EU, opt-out); dead-code sweep + spec-doc sync.

## Authentication, sessions & GDPR (flag-gated)
Effro carries a full auth layer that is **off by default** so the desktop app
stays login-free, and **on** for hosted/Docker deployments. The switch is the
`EFFRO_AUTH_ENABLED` env var.
- **Off (unset/false - the Tauri desktop build):** `get_current_user` returns a
  synthetic local admin (`User(id=1, email="local@effro", display_name="Local
  user", role="admin")`) instead of 401. The dependency is still on every route,
  so audit attribution and every auth code path runs; the gate is simply open,
  and no login/setup UI is shown.
- **On (set in the Dockerfile - any server deployment):** real sessions are
  required. First run shows a setup page that creates the admin; everyone else
  logs in. Admins invite users from Settings -> Users. Optional Entra OIDC SSO.
- **Files:** backend `auth_utils.py` (argon2 hashing + session tokens),
  `routers/auth.py` (setup/login/logout/me/sessions/change-password),
  `dependencies.py` (`get_current_user`, `require_admin`), `routers/admin.py`
  (user management), `routers/account.py` (GDPR export + delete). Frontend
  `contexts/AuthContext.jsx`, `components/RequireAuth.jsx`, `pages/LoginPage.jsx`,
  `pages/SetupPage.jsx`.
- **Schema:** `users`, `user_sessions`, `password_reset_tokens`, plus
  `audit_logs.user_id` and a `deletion_log`. Added the **additive** way (models +
  `CREATE TABLE IF NOT EXISTS` / `ALTER` in `main.py _init_db`), NOT Alembic -
  the repo is deliberately Alembic-free and autogenerate against the live
  create_all DB would risk the user's data.
- **Always public (never gated):** `GET /api/health`, every integration's OAuth
  `/<name>/auth/login` + `/auth/callback` (providers redirect to them
  cookieless), and the auth endpoints themselves (setup/setup-status/login/
  logout, oidc/config + oidc/login + oidc/callback).
- **Cookies:** `effro_session`, HttpOnly + SameSite. Credentialed cross-origin
  requests need a concrete CORS origin (set via `EFFRO_CORS_ORIGINS` when auth is
  on), not `*`; desktop is same-origin so this only matters when hosted. On the
  desktop the backend port drifts (8000-8010) and clearing the WebView2 cache
  logs the cookie out - another reason desktop keeps the gate off.
