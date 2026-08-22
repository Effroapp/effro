# Effro.

> Stay across everything. [effro.io](https://effro.io)

A desktop-first personal knowledge and work-tracking app, also deployable self-hosted via Docker. Organise your world into **areas** (one per spinning plate), break each area into **threads** of focused work, and keep a chronological record of todos, decisions, meetings, blockers, and notes inside every thread. AI surfaces help where they materially save time - parse messy input into structured items, regenerate area summaries automatically, draft a weekly status digest in one click. Your data stays on a disk you own.

*Effro* is Welsh for "awake, alert" - what the app is meant to keep you.

---

## Two ways to run it

- **Desktop app (Windows).** A Tauri shell that bundles the backend and runs
  entirely on your machine, with no login. Installers are published on the
  [releases page](https://github.com/Effroapp/effro/releases). Building one
  yourself is covered in [docs/desktop-build.md](docs/desktop-build.md).
- **Self-hosted server.** The Docker image below. Authentication is enforced
  here, so the first run asks you to create an admin account.

---

## Quick Start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) or Docker Engine + Docker Compose installed
- Git installed
- Port `8080` free on your machine

### Run with Docker

```bash
# Clone your repo (or navigate to the project directory)
cd effro

# Build and start the container
docker compose up --build -d

# The app is now available at:
# http://localhost:8080
```

On first run the database is created automatically and the app shows a setup page, because `docker-compose.yml` sets `EFFRO_AUTH_ENABLED=true`. Create the admin account there and everyone after that signs in. The app then launches empty, so add your first area from the sidebar (`+ Add your first area`). All data persists in the `./data/` directory.

### Stop the container

```bash
docker compose down
```

### Rebuild after code changes

```bash
docker compose up --build -d
```

---

## Project Structure

```
effro/
│
├── backend/        Python FastAPI application, SQLAlchemy models, routers,
│                   integration clients, storage backends, scheduler
│   └── tests/      pytest suite (see Development below)
├── frontend/       React + Vite + Tailwind single-page app
├── src-tauri/      Tauri v2 desktop shell (Rust): window, updater, sidecar
├── scripts/        Backend PyInstaller build, icon generation, demo seed
├── docs/           Build and integration guides, plus design specs
├── data/           Runtime data (git-ignored, Docker volume mount)
│
├── Dockerfile          Multi-stage: Node builds frontend, Python serves everything
├── docker-compose.yml  Single-service compose with ./data volume mount
├── CLAUDE.md           Engineering orientation, kept current
└── REQUIREMENTS.md     The original specification, kept as a historical record
```

A file-by-file map of the backend, frontend and desktop shell lives in
[CLAUDE.md](CLAUDE.md). It is the one that is maintained, so this README
deliberately stops at the top level rather than repeating it.

---

## Development (without Docker)

For local development you run the backend and frontend separately, with Vite proxying API calls to FastAPI.

### Backend

```bash
cd backend

# Create a virtual environment
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create the data directory
mkdir -p ../data/uploads

# Run the dev server
DB_PATH=../data/department.db UPLOAD_DIR=../data/uploads uvicorn main:app --reload --port 8000
# (DB filename kept for backward compatibility; rename freely on fresh installs)
```

API is available at `http://localhost:8000`
Interactive API docs at `http://localhost:8000/docs`

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start Vite dev server (proxies /api → localhost:8000)
npm run dev
```

Frontend is available at `http://localhost:5173`

### Tests

The backend has a pytest suite. Test-only dependencies live in a separate file
so neither the PyInstaller bundle nor the Docker image picks them up.

```bash
pip install -r backend/requirements-dev.txt
python -m pytest backend/tests
```

---

## API Reference

All endpoints are prefixed with `/api`. FastAPI generates the full, always
current reference from the code itself: start the backend and open
`http://localhost:8000/docs`. There is no hand-maintained copy here, because a
hand-maintained copy goes stale.

The routers, grouped by what they cover:

| Group | Covers |
|-------|--------|
| `areas`, `threads`, `entries`, `attachments`, `subtasks` | The core Areas to Threads to Entries model, plus files, links and thread groups |
| `generate`, `ingest`, `ai_features` | Smart Generate, file parsing, the weekly roundup, task decomposition |
| `insights`, `presence`, `nudges` | The Insights page, the heartbeat-derived working window, daily nudges |
| `signals` | The triage feed that integrations write into |
| `folio` | Deep-research dives and their digests |
| `prefs` | Durable per-user state (onboarding, display name, avatar, intro dismissals) |
| `auth`, `account`, `admin` | Sessions, GDPR export and erasure, user management, licence and connector policy |
| `settings`, `storage` | AI provider configuration and the five storage backends |
| `microsoft`, `jira`, `google`, `dropbox`, `icloud`, `github`, `telegram`, `mail` | Per-integration config, auth and sync |

Uploaded files are served at `/uploads/:stored_name`.

---

## Data

All data lives in `./data/` and is never committed to git.

- `./data/department.db` - SQLite database (filename kept for backward compatibility). Back this up to preserve your records.
- `./data/uploads/` - Uploaded files. Include this in any backup.

**Backup:**
```bash
cp -r ./data ./data_backup_$(date +%Y%m%d)
```

---

## Technology

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | React 18 + Vite | Fast, familiar, tree-shakeable |
| Styling | Tailwind CSS v3 | Utility-first, dark mode via `class` |
| Routing | React Router v6 | Standard SPA routing |
| Icons | Lucide React | Consistent, lightweight |
| Markdown | react-markdown | Renders entry content |
| Dates | date-fns | Lightweight date formatting |
| Backend | Python FastAPI | Fast, typed, auto-generates API docs |
| ORM | SQLAlchemy 2 | Clean Python models, migrations-ready |
| Database | SQLite | Zero-config, single file, perfect at this scale |
| Container | Docker (multi-stage) | Reproducible builds; Node builds frontend, Python serves everything |
| Desktop shell | Tauri v2 (Rust) | Small installer, native updater, backend runs as a bundled sidecar |

---

## Extending

[CLAUDE.md](CLAUDE.md) is the engineering orientation and the file to read
first. It is loaded automatically by Claude Code and covers the architecture,
the conventions, the verification loop and the release process.

`REQUIREMENTS.md` is the original specification. It is kept as a historical
record and no longer describes the current app, so treat it as background
rather than as a source of truth.
