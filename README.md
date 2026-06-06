# Effro.

> Stay across everything. — [effro.io](https://effro.io)

A self-hosted activity log for anyone juggling multiple parallel responsibilities. Organise your world into **areas** (one per spinning plate), break each area into **threads** of focused work, and keep a chronological record of todos, decisions, meetings, blockers, and notes inside every thread. AI surfaces help where they materially save time - parse messy input into structured items, regenerate area summaries automatically, draft a weekly status digest in one click. Self-hosted, single Docker container, your data on a disk you own.

*Effro* is Welsh for "awake, alert" - what the app is meant to keep you.

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

On first run, the database is created automatically. The app launches empty - add your first area from the sidebar (`+ Add your first area`). All data persists in the `./data/` directory.

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
├── backend/                  Python FastAPI application
│   ├── main.py               App entry point - initialises DB, mounts routers, serves frontend
│   ├── database.py           SQLAlchemy engine and session factory
│   ├── models.py             ORM models: Area, Thread, Entry, Attachment
│   ├── schemas.py            Pydantic schemas for request/response validation
│   ├── requirements.txt      Python dependencies
│   └── routers/
│       ├── areas.py          GET/PUT areas; GET/POST threads per area
│       ├── threads.py        GET/PUT/DELETE threads
│       ├── entries.py        POST/PUT/DELETE log entries
│       └── attachments.py    File upload + link add/delete
│
├── frontend/                 React + Vite application
│   ├── index.html            HTML entry point (loads Google Fonts)
│   ├── vite.config.js        Vite config with /api proxy for dev mode
│   ├── tailwind.config.js    Effro tokens - paper/pitch/accent palettes, Geist + Lexend fonts
│   ├── postcss.config.js     PostCSS for Tailwind
│   └── src/
│       ├── main.jsx          React root mount
│       ├── App.jsx           Router + theme provider + shell layout
│       ├── index.css         Tailwind base + custom CSS (grid texture, markdown prose, scrollbars)
│       ├── api/
│       │   └── client.js     All API calls - thin fetch wrapper over every endpoint
│       ├── hooks/
│       │   └── useTheme.js   Dark/light mode toggle; persists to localStorage
│       ├── utils/
│       │   └── status.js     Status config (colours, labels) for areas and threads
│       ├── components/
│       │   ├── Sidebar.jsx       Left nav - area list with status dots
│       │   ├── StatusBadge.jsx   Coloured pill badge for area/thread status
│       │   ├── ThemeToggle.jsx   Sun/Moon button
│       │   ├── Modal.jsx         Reusable overlay dialog
│       │   ├── ConfirmDialog.jsx Destructive action confirmation
│       │   ├── Toast.jsx         In-app notification system
│       │   └── ThreadCard.jsx    Area view card linking to a thread
│       └── pages/
│           ├── Dashboard.jsx   Area grid with status, counts, AI-generated overviews
│           ├── AreaView.jsx    Single area - Overview, thread list, new thread modal
│           ├── ThreadView.jsx  Full thread - entry timeline, files, links, linked threads
│           ├── LogView.jsx     Audit log viewer
│           └── ProcessView.jsx Smart Generate - AI extracts items from notes / .eml / .ics / PDFs
│
├── data/                     Runtime data (git-ignored, Docker volume mount)
│   ├── department.db         SQLite database (filename kept for backward compatibility)
│   └── uploads/              Uploaded files
│
├── Dockerfile                Multi-stage: Node builds frontend; Python serves everything
├── docker-compose.yml        Single-service compose with ./data volume mount
├── .gitignore
├── README.md                 This file
└── REQUIREMENTS.md           Full product specification
```

---

## Development (without Docker)

For local development you run the backend and frontend separately, with Vite proxying API calls to FastAPI.

### Backend

```bash
cd backend

# Create a virtual environment
python -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate

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

---

## API Reference

All endpoints are prefixed with `/api`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/areas` | List all areas with thread counts |
| POST | `/areas` | Create a new area |
| GET | `/areas/:id` | Get a single area |
| PUT | `/areas/:id` | Update area status, summary, or icon |
| POST | `/areas/:id/summary/suggest` | AI-generated 2-sentence Overview |
| GET | `/areas/:id/threads` | List threads for an area |
| POST | `/areas/:id/threads` | Create a new thread |
| GET | `/threads/:id` | Get thread with all entries and attachments |
| PUT | `/threads/:id` | Update thread title, status, or description |
| DELETE | `/threads/:id` | Delete thread (cascades to entries and attachments) |
| POST | `/threads/:id/entries` | Add a log entry |
| PUT | `/entries/:id` | Edit an entry |
| DELETE | `/entries/:id` | Delete an entry |
| POST | `/threads/:id/attachments/file` | Upload a file (multipart) |
| POST | `/threads/:id/attachments/link` | Add a URL link |
| POST | `/threads/:id/links` | Link to another thread (blocks / relates_to) |
| DELETE | `/links/:id` | Remove a thread-to-thread link |
| DELETE | `/attachments/:id` | Remove an attachment |
| POST | `/ingest/parse` | Parse a dropped file (PDF / EML / ICS / text) into plain text |
| POST | `/generate/process` | AI extracts structured items from unstructured text |
| POST | `/generate/refine` | AI re-suggests a rejected item with feedback |
| POST | `/generate/roundup` | AI weekly status digest |
| GET | `/roundup` | Pre-roundup data (stale areas + per-area activity) |
| GET | `/audit` | Global audit log |
| GET | `/threads/:id/audit` | Per-thread audit log |
| GET | `/areas/:id/audit` | Per-area audit log |
| GET | `/activity` | Recent activity feed |
| GET | `/todos/upcoming` | Upcoming todos across all areas |

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

---

## Extending

This codebase is designed to be extended in future Claude sessions.
Start any extension session with:
> "Read README.md and REQUIREMENTS.md, then [your request]."

The `REQUIREMENTS.md` contains the full product specification.
