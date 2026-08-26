# Effro - engineering orientation

This file is auto-loaded by Claude Code. Read it before doing anything, then ask
what task to do. Treat accuracy as the highest priority: if you're unsure how
something works, inspect the code rather than guessing.

## What Effro is
A privacy-first desktop app for knowledge workers (QA/ops/PM lean) who juggle
many streams of work. Its job is to sit calmly *alongside* the tools people
already use and pull the important bits into one place. Core ideas:
- Work is organised as **Areas -> Threads -> Entries**. Built-in entry types:
  entry (note/update), todo, decision, meeting, blockage. Users can add their
  own types (Risk, Question and so on), stored as type `custom` with a
  `custom_type_id`. A file, link, linked thread or filed folio appears in the
  timeline as its own card, stored as type `reference`. Threads can have
  attachments (file/link) and links to other threads.
- **Signals**: external items (meetings, emails, issues, PRs) pulled from
  integrations into a triage feed. The user "accepts" one onto a thread (as a
  meeting / to-do / note).
- **Insights**: the flagship reflective page - Reflect (Today / This week),
  Ahead, Balance. Productivity metrics, grounded AI narratives, heartbeat-derived
  working window.
- **Folio**: a deep-research workspace - capture a dive (links, notes, files,
  images) into a folio, then "pull it together" into one grounded, reading-first
  digest. Default-on, hideable via `EFFRO_FOLIO_ENABLED=false`.
- Guiding principles: (1) **Accurate** above all. (2) **Calm & positive** -
  never overwhelm an ADHD reader. (3) **well-designed, consistent, descriptive**,
  with tasteful animation and give-the-user-control affordances (dismissible
  cards, hide toggles).

## Where it lives
- GitHub: `github.com/Effroapp/effro`. Default branch `main`. Feature work lands
  on short-lived `feature/*` branches via PR.
- Current version lives in `src-tauri/tauri.conf.json`. That is the single
  source the release workflow reads, so never restate a version number here.
  Run `git tag` to see what has actually shipped: a clean tag is a full
  release, a hyphenated one is a release candidate. At the last sweep, v0.13.0
  was the newest full release and 0.14.0 was in release candidates.
  Next theme: **"connectivity & integrations"**.

## Architecture (three tiers)
1. **Desktop shell** - Tauri v2 (Rust) in `src-tauri/`. Spawns the backend as a
   sidecar, owns the window + updater + data-dir picker. Key file:
   `src-tauri/src/main.rs`. Config: `src-tauri/tauri.conf.json`. Capabilities:
   `src-tauri/capabilities/default.json`. NSIS installer hook:
   `src-tauri/installer/hooks.nsi`.
2. **Backend** - Python FastAPI, bundled into `effro-backend.exe` via PyInstaller
   (`scripts/build-backend.py`). Runs on **port 8000** (falls back 8001-8010).
   SQLAlchemy + SQLite. The default file is `<data dir>/effro.db`, overridable
   via the `DB_PATH` env var. The shell points `DB_PATH` at the user's app-data
   dir at runtime, and `docker-compose.yml` points it at `/data/department.db`,
   a name kept for backward compatibility with existing deployments.
3. **Frontend** - React + Vite + Tailwind. Dev server on **5173**, proxies
   `/api` and file routes to `http://localhost:8000`.

## Backend (`backend/`)
- `main.py` - app, router includes, and the migration block in `_init_db()`
  (additive `ALTER/CREATE TABLE IF NOT EXISTS` strings, also runs
  `Base.metadata.create_all`). No Alembic.
- `models.py` (SQLAlchemy models), `schemas.py` (Pydantic).
- `entry_text.py` - the entries vocabulary every layer agrees on. `TITLED_TYPES`
  (entry, decision, custom, blockage), the type labels, `fallback_title` and
  `entry_prompt_line`, which renders an entry for an AI prompt with its label in
  brackets so a Risk reads as `[Risk]` rather than `[custom]`. Every prompt
  builder uses it.
- `routers/*.py` - areas, threads, entries, entry_types, attachments, generate, ingest,
  settings, storage, subtasks, ai_features, nudges, insights, signals, presence,
  prefs, folio, auth, account, admin, and per-integration: microsoft, jira,
  google, dropbox, icloud, github, telegram, mail. For the live list of
  endpoints, run the backend and read `http://localhost:8000/docs`.
- Integrations follow a repeatable pattern: `<name>_client.py` (API/OAuth client)
  + `services_<name>.py` (sync -> upserts into `signal_items`) +
  `routers/<name>.py` (config/profile/test/auth/sync-now). Credential-based
  ones (github, icloud, telegram, mail) persist config through
  `integration_config.py` (shared load/save/clear/set_meta, secrets
  Fernet-encrypted). Frontend cards share `CredentialIntegrationCard.jsx`.
- `routers/prefs.py` + the `user_prefs` table - durable per-user key/value
  state. `GET /api/prefs` returns everything for the current user as one dict,
  `PUT /api/prefs` merges a partial dict where a null value deletes a key. The
  desktop shell clears the webview's browsing data on every update, so anything
  that has to survive an update lives here rather than in localStorage:
  onboarding completion, display name, avatar, intro-panel dismissals. The
  frontend side is `hooks/usePrefs.js`, which keeps localStorage as a
  read-through cache with the backend as the source of truth.
- **Entries** carry three things worth knowing about.
  - *Titles*, on the types in `TITLED_TYPES` only. A To Do is already one line
    and a Meeting is named by its own title field, so neither takes one. A title
    is never required to save: leave it blank and the server writes
    `fallback_title(content)` with `title_source = 'fallback'`, stored so
    one-line contexts always have something to show but never rendered as a
    heading, since it would only echo the text beneath it. A title the user
    wrote is never overwritten: an AI suggestion (`POST /generate/title`, applied
    after the save) may only replace a fallback, and a content edit may only
    re-derive a fallback.
  - *Custom types*, stored as type `custom` with a `custom_type_id`. Label and
    colour only, global rather than per area, behaving as an Update underneath.
    Deleting a type converts its entries to Updates. The six colours are a
    separate muted family in `tailwind.config.js` (sage, seafoam, dusk, plum,
    heather, pebble), deliberately none of the built-in type colours, so a
    user's own type never reads as a Decision or a Blocker.
  - *Reference cards*, stored as type `reference` with `ref_kind` and `ref_id`.
    A file, link, linked thread or filed folio, shown in the timeline with the
    same shell and Notes control as any other card. `content` is a snapshot of
    the name, but display always resolves the live object, so a rename shows
    through, and a missing one renders a quiet gone state rather than crashing.
    Not client-creatable, and it takes notes and nothing else.
    **The card and the thing it points at share one life**: delete either and
    both go, including cards in other threads when a linked thread is deleted.
    A Folio is the exception, unfiled rather than destroyed. Everything that
    creates one of these objects goes through `references.py`, one function per
    object type, so the card cannot be forgotten by a new call site.
- `connectors.py` - the connector registry + workspace policy, the single
  source of truth consumed by the main.py connector gate, the scheduler, the
  admin API (`/admin/connectors`) and `/auth/me` ("connectors" map). On a
  licensed workspace each connector resolves as edition default (Pro: on,
  Enterprise: off) + per-connector admin override. Desktop ignores all of it.
- Storage backends: `storage_backend.py` (abstract + factory + Fernet
  `encrypt_secret`/`decrypt_secret`) and
  `storage_{nextcloud,googledrive,dropbox,s3,webdav}.py`. Backups:
  `storage_backup.py`.
- `scheduler.py` - APScheduler jobs (overview refresh at 12:00 + startup
  catch-up, nightly backup, integration syncs every 30 min).
- `ai_provider.py` - pluggable BYOK AI: `get_provider(db).complete(system=,
  messages=, max_tokens=)` and `.test() -> (ok, msg)`.
- `ai_context.py` - what a grounded prompt is allowed to know. Every AI
  feature reads its material through it. See **AI grounding** below, which
  is a rule and not a description.
- `entry_text.py` - the shared entries vocabulary: type labels, titles, and
  `entry_prompt_line()`, which is how an entry is written into a prompt.
- Secrets are **Fernet-encrypted** at rest (key in `app_settings`). All
  third-party config (OAuth client id/secret, PATs, app passwords) is
  **bring-your-own** - never a shared Effro app.

## AI grounding (a rule, not a description)
Effro's AI features are grounded: the weekly roundup, the area overview, the
thread summary, the nightly refresh and the Insights wind-down all describe the
user's real work back to them. Their whole value is being right. A summary that quietly stops seeing
part of the app is worse than no summary, because the user has no way to tell.

**The rule: an AI prompt never queries entries directly. It calls
`backend/ai_context.py`.** That module is the single place that decides what a
prompt sees, so anything added to the app reaches every prompt at once instead
of reaching whichever one someone remembered to update.

It exists because that failed twice.
- Reference cards landed, and the area overview immediately started describing
  threads as filenames. Three attached files are three of the most recent
  entries, and the summariser had no idea it should skip them.
- The weekly roundup only ever counted to-dos and listed decisions. Blocked
  items, meetings, updates and every type a user had made for themselves were
  invisible in the one place meant to tell them how their week went.

What that means in practice.
- Gather through `recent_entries_for_prompt()`, `entries_logged()`,
  `week_highlights()`, `reference_tally()` and `in_hand()`. If you need
  something they do not give you, add it there rather than querying around it.
- Render an entry with `entry_prompt_line()` from `entry_text.py`, never raw
  `content`. It prefixes the entry's human label, so the model can tell a
  Decision from a Blocked item from a user's own Risk without being taught the
  taxonomy, and a new type is understood the moment it exists.
- Count by label, not by a hardcoded `type ==` list. `entries_logged()` is
  keyed by label for exactly this reason.
- References are tallied, never quoted. A summary should know three files were
  attached and should not spend its budget on three filenames.
- `backend/tests/test_ai_context.py` is the guard. It seeds one entry of every
  type, plus a user-defined type, a reference and a pin, and asserts each one
  reaches a prompt. Extend it whenever you add a kind of content.

Insights is the exception that proves the rule. Its narrative is a **rewording
of a deterministic template**, so the model never sees an entry and cannot sum
or relabel anything, and a numeric guard rejects any output that introduces a
number the draft did not have. That design stays. What still applies is the
counting underneath it: the Today panel had five hardcoded types, so a day
spent logging a user's own type read as a blank day. Count by type there too,
and give a user-defined type its own chip under its own name and colour.

**When you add anything that carries meaning** - an entry type, a field a user
writes into, a new object like Folio, a new way to attach something - decide
what the roundup and the summaries should say about it, and wire it through
`ai_context.py` in the same change. Leaving it for later means shipping an app
whose AI describes a version of itself that no longer exists.

## Frontend (`frontend/src/`)
- `pages/` - Dashboard, Insights, AreaView, ThreadView, Signals, ProcessView,
  FolioIndex, FolioView, LogView, SystemSettings, plus the auth pages
  LoginPage, SetupPage and SetPasswordPage.
- `components/` - SettingsMenu, IntegrationsPanel, ProviderLogos, SetupGuide,
  StorageSetupModal, IntroPanel, Tooltip, OverviewCard, ThreadCard,
  OnboardingWizard, the per-integration cards, etc.
- `api/` - `client.js` plus per-integration clients (microsoft, jira, google,
  dropbox, icloud, github, telegram, mail), `nudges.js`, `prefs.js`,
  `settings.js`, `signals.js`, `storage.js`, `tasks.js`, and `tauri.js` (the
  Tauri bridge - includes `isTauri()` and `openExternal()`).
- `hooks/` - useFont, useBionic, useHeartbeat, useAIConfigured, usePrefs, etc.
  `utils/bionic.jsx` (Bionic reading).

## Docs (`docs/`)
One line each, purpose only. Read the file for the detail, and treat the code
as the authority where the two disagree.
- `AZURE_SETUP.md` - registering the Entra app behind the Microsoft 365
  integration, and the redirect-URI troubleshooting that goes with it.
- `JIRA_SETUP.md` - registering the Atlassian OAuth app behind the Jira
  integration.
- `desktop-build.md` - building, signing and releasing the Windows desktop app,
  including the toolchain pins and the release workflow.
- `INSIGHTS_REDESIGN_SPEC.md` - the design record for the Insights page.
- `LICENSING_AND_EDITIONS_SPEC.md` - the design record for licences, editions
  and the first-run setup token.

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
  as scannable icon-beats (see `IntroPanel`), not walls of text.
- External links must use `openExternal()` from `api/tauri.js` (the desktop
  webview blocks `target="_blank"`, only localhost is allow-listed).

## Dev workflow & verification
- Backend venv: `backend/.venv` (run Python as
  `backend/.venv/Scripts/python.exe`). Deps in `backend/requirements.txt`
  (fastapi, sqlalchemy, pydantic, anthropic, openai, httpx, msal, webdavclient3,
  cryptography, apscheduler, icalendar, pypdf...). Avoid adding heavy new deps -
  the integrations deliberately use `httpx`/stdlib so the PyInstaller bundle
  stays clean (e.g. S3 is hand-rolled SigV4, no boto3).
- Frontend: `cd frontend` then `npm ci` / `npm install`. Build with
  `npm run build` (CI uses `npm ci`, so keep `package-lock.json` in sync if you
  add deps).
- **How to verify without a full desktop run** (the preferred loop, since the
  Windows installer and live third-party accounts aren't reachable from the dev
  env):
  - Backend: `ast.parse` for syntax, then FastAPI `TestClient` against a temp DB
    (set `DB_PATH` to a temp file, the lifespan runs migrations). For services,
    seed a throwaway DB and call functions directly.
  - Frontend: `npm run build` must pass, then
    `node scripts/check-jsx-imports.mjs` from the repo root (a component
    used but never imported compiles happily and throws at runtime) and
    `node scripts/check-icon-names.mjs` from `frontend/` (every icon the
    pickers list has to resolve to a real Lucide component).
- **Backend tests** live in `backend/tests` and run under pytest. Install the
  dev deps once with
  `backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt`,
  then run `backend/.venv/Scripts/python.exe -m pytest backend/tests`. pytest is
  deliberately kept out of `requirements.txt` so neither the PyInstaller bundle
  nor the Docker image picks it up. The suite must be green before you open a
  PR, and backend work is expected to extend it.
- Always **flag what you could NOT verify** (anything needing a live
  integration/storage account, or the actual Windows installer).

## Build & release
- GitHub Actions `desktop-release.yml` triggers on tags `v*.*.*`. A tag
  **containing a hyphen** (e.g. `v0.12.0-rc1`) builds a **prerelease** (does not
  touch "latest" / auto-update). A **clean** tag (e.g. `v0.12.0`) builds a **full
  release** -> becomes "latest" + the updater target -> auto-updates existing
  users. `desktop-beta.yml` builds on push to `main`.
- To cut a build: bump `version` in `src-tauri/tauri.conf.json`, which is the
  authoritative one the workflow reads, and keep the other files that carry a
  version in step (see the release section of `docs/desktop-build.md` for the
  list). Commit, then `git tag -a <tag> -m "..."` and push the tag. CI produces
  the signed NSIS installer + `.sig` + `latest.json`.
- Iterate via `-rcN` prereleases, test, then promote the identical commit to the
  clean tag.

## How to work
- **Commit/push only when asked.** If on `main`, branch first. End every commit
  message with a `Co-Authored-By:` trailer crediting the model that actually
  wrote the change, using the name that model reports for itself, in the form
  `Co-Authored-By: <model name> <noreply@anthropic.com>`. Do not hardcode a
  model name in this file. It goes stale the moment the model changes, and a
  stale trailer puts a false attribution into the git history.
- **Rebasing and force-pushing an unmerged feature branch is allowed.** Tidy a
  branch into the commits it should have had rather than leave a trail of
  fixups behind it. Always flag it in the handover summary, so a rewrite is
  something the reader is told about rather than something they discover.
  `main`, and anything already merged or shared, is never rewritten.
- Make changes **app-wide and consistently** - if you change a pattern (a font,
  copy style, a component), apply it everywhere it appears, not just one screen.
- Prefer asking a focused question when a decision is genuinely the user's
  (architecture, privacy, scope, infra). Otherwise pick the sensible default,
  state it, and proceed.
- When done, give a tight summary and the installer/build link if a build was cut.

## Known constraints & gotchas
- Timezones: the client sends `tz_offset_min`. `meeting_at` is stored as naive
  **local** wall-clock, while `created_at/completed_at/occurred_at` are naive
  **UTC**. Be careful comparing them.
- iCloud **Drive** is not a viable storage target (Apple exposes no third-party
  API). iCloud Calendar/Mail work via CalDAV/IMAP with an app-specific password.
- No telemetry exists yet. It sits under the next theme in the roadmap below,
  not against any shipped version. Don't write copy claiming usage data is
  collected until it is.

## Known debt
Work that is owed but not scheduled. Add to this rather than let it live only
in someone's head.
- `frontend/src/pages/SystemSettings.jsx` wants breaking up. It is over 1500
  lines and carries every settings tab in one file.
- The frontend has no test runner. `package.json` carries only dev, build and
  preview, so the dashboard styling hook, the status-line composer and the zone
  collapse migration are covered by hand rather than by unit tests.
- There is no `npm run lint` script and no ESLint config. `npm run build` only
  catches what breaks the bundle, so an undefined identifier compiles happily
  and throws at runtime. `scripts/check-jsx-imports.mjs` covers the specific
  case that bit us (a JSX component used but never imported) and is worth
  running at every gate, but it is a stopgap, not a linter.

## Roadmap
- **v0.11.0 (shipped)**: Insights rework. Integrations (Jira, Google
  Calendar+Gmail, iCloud Calendar+Mail, GitHub). Five storage backends
  (Nextcloud, Google Drive, Dropbox, S3-compatible, WebDAV). Tabbed Settings
  with ADHD-first intro cards + official icons + connected/Add. System-browser
  links. Timeout-hardened installer.
- **v0.12.x (shipped)**: Effro rebrand (Trace -> Effro). Auth / sessions / GDPR
  with optional Entra OIDC SSO (flag-gated, off on desktop). Licensing +
  editions (pro / enterprise, Ed25519-signed keys). "Load demo data".
- **v0.13.0 (shipped)**: Folio - deep-research capture (link / note / file /
  image) pulled together into one grounded digest. Enabled by default.
- **0.14.0 (release candidates)**: In Hand, the pinned entries strip on the
  dashboard. The entries upgrade: user-defined entry types, titles on prose
  entries, and reference cards for files, links, linked threads and folios.
  Area page redesign and thread grouping.
  In-house text formatting across every freeform box. A stable area Description
  that grounds the area overviews and the weekly roundup. Folio index views,
  area and thread linking, and digest image editing. A visible updater progress
  bar. Durable user preferences, which moves onboarding, profile and intro
  dismissals off localStorage so a desktop update no longer wipes them.
- **Next theme - connectivity & integrations**: inbound webhook + a small cloud
  relay (so Zapier/Make/native automations can push work items to the local app),
  then native integrations (Notion, Linear, Asana, Trello, Zoho, GitLab, the
  Atlassian suite incl. Confluence, Azure DevOps, Monday, ClickUp). Telemetry
  (PostHog EU, opt-out). Dead-code sweep + spec-doc sync.

## Authentication, sessions & GDPR (flag-gated)
Effro carries a full auth layer that is **off by default** so the desktop app
stays login-free, and **on** for hosted/Docker deployments. The switch is the
`EFFRO_AUTH_ENABLED` env var.
- **Off (unset/false - the Tauri desktop build):** `get_current_user` returns a
  synthetic local admin (`User(id=1, email="local@effro", display_name="Local
  user", role="admin")`) instead of 401. The dependency is still on every route,
  so audit attribution and every auth code path runs. The gate is simply open,
  and no login/setup UI is shown.
- **On (set in the Dockerfile - any server deployment):** real sessions are
  required. First run shows a setup page that creates the admin. Everyone else
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
  on), not `*`. Desktop is same-origin so this only matters when hosted. On the
  desktop the backend port drifts (8000-8010) and clearing the WebView2 cache
  logs the cookie out - another reason desktop keeps the gate off.
