# Effro. - Requirements Specification

**Version:** 1.0.0
**Prepared by:** Claude (Anthropic)
**Purpose:** This document captures the full agreed specification. Future Claude sessions should read this before extending the app.

---

## 1. Product Purpose

A self-hosted activity log for anyone juggling multiple parallel responsibilities - a tool for people who need to keep their hand on several spinning plates at once. Organise your world into **areas** (one per plate), break each area into **threads** of focused work, and keep a chronological record of todos, decisions, meetings, blockers, and notes inside every thread.

Replaces ad-hoc notes scattered across documents, chats, and inboxes with a single structured, searchable, audit-logged record of what is happening across all your areas - and why.

AI surfaces (optional, gated on an Anthropic API key) accelerate the chores: parsing messy input into structured items, regenerating area Overviews on a daily schedule, drafting a weekly status digest.

---

## 2. Areas

Areas are user-created - there is no fixed list. The app launches empty and prompts the user to create their first area from the sidebar.

Each area carries a name, a slug (auto-generated from the name), a chosen Lucide icon (optional), a free-text Overview (manually editable or AI-regenerated), and a status (`stable` / `active` / `review` / `blocked`).

> *Historical note:* version 1.0.0 originally seeded seven software-discipline areas (Documentation, Firmware, Software Test, Software Development, Algorithm, Design, Security) on first run for a specific deployment. The seed has since been removed in favour of empty defaults so the app reads as a general-purpose tool.

---

## 3. Data Model

### Area
| Field | Type | Notes |
|-------|------|-------|
| id | int (PK) | Auto-increment |
| name | string | Fixed at seed |
| slug | string | URL-safe, unique |
| status | enum | `stable`, `active`, `review`, `blocked` |
| summary | text | Free-text current situation; editable |
| created_at | datetime | |
| updated_at | datetime | Bumped on any change, including new threads/entries |

### Thread
| Field | Type | Notes |
|-------|------|-------|
| id | int (PK) | Auto-increment |
| area_id | int (FK) | Parent area |
| title | string | Editable |
| status | enum | `open`, `in-progress`, `resolved`, `parked` |
| description | text | Brief description; editable |
| created_at | datetime | |
| updated_at | datetime | Bumped on new entry or edit |

### Entry
| Field | Type | Notes |
|-------|------|-------|
| id | int (PK) | |
| thread_id | int (FK) | Parent thread |
| content | text | Supports Markdown |
| created_at | datetime | Used as the timeline timestamp |
| updated_at | datetime | |

### Attachment
| Field | Type | Notes |
|-------|------|-------|
| id | int (PK) | |
| thread_id | int (FK) | Parent thread |
| type | enum | `file`, `link` |
| name | string | Display label |
| stored_name | string | UUID filename on disk (files only) |
| original_name | string | Original upload filename (files only) |
| url | string | Target URL (links only) |
| size | int | Bytes (files only) |
| created_at | datetime | |

---

## 4. Views

### 4.1 Dashboard
- Full-width grid, no sidebar
- One card per area (7 total)
- Each card shows: area name, status badge, summary preview (truncated), active/total thread count, last updated (relative time)
- Coloured top stripe per card matching status colour
- Click card → navigates to Area View
- Summary stats in header: total threads, open threads, blocked area count

### 4.2 Area View
- Persistent left sidebar with all 7 areas + status dots + open thread count
- Main panel:
  - Area name heading + editable status badge (click to open dropdown)
  - Current Situation block: free-text summary, inline editable (click Edit or click text)
  - Threads section: sorted by last updated (descending)
  - Thread cards link to Thread View
  - "+ New Thread" button → opens New Thread modal
- New Thread modal fields: title (required), description, status selector

### 4.3 Thread View
- Breadcrumb: Dashboard > Area name > Thread title
- Persistent left sidebar
- Thread header: editable title (click pencil), editable status badge (dropdown), editable description (click text), delete thread button
- Two-column layout:
  - Left: Entry log (flex-1)
    - New entry composer at top (textarea + Add Entry button)
    - Entries displayed chronologically (oldest first)
    - Each entry: date/time header, markdown-rendered content, hover-reveal Edit and Delete buttons
    - Editing an entry opens the content as an editable textarea
  - Right: Attachments sidebar (w-72, sticky)
    - Files panel: list of files with name, size, download link; Upload button
    - Links panel: list of links with label + external link; Add Link button

---

## 5. Status System

### Area statuses
| Value | Label | Colour |
|-------|-------|--------|
| `stable` | Stable | Green (#22C55E) |
| `active` | Active | Signal blue (#0EA5E9) |
| `review` | Review | Amber (#F59E0B) |
| `blocked` | Blocked | Red (#EF4444) |

### Thread statuses
| Value | Label | Colour |
|-------|-------|--------|
| `open` | Open | Signal blue (#0EA5E9) |
| `in-progress` | In Progress | Amber (#F59E0B) |
| `resolved` | Resolved | Green (#22C55E) |
| `parked` | Parked | Violet (#8B5CF6) |

---

## 6. Design

### Aesthetic direction
Warm, calm, professional. Paper-and-ink restraint with a single muted-indigo accent. High information density with intentional whitespace. Tailored for sustained-focus use; backgrounds and palette stay legible without shouting.

### Palette (Tailwind config: `paper` + `pitch` + `accent`)
| Token | Dark value | Light value |
|-------|-----------|-------------|
| Background | `#0F0E0C` (pitch) | `#F7F4ED` (paper) |
| Surface | `#181714` (pitch-700) | `#EFECE3` (paper-200) |
| Border | `#38352F` (pitch-400) | `#D4CFC2` (paper-400) |
| Text primary | `#EDEAE3` (pitch-50) | `#14130F` (paper-900) |
| Text secondary | `#A8A49E` (pitch-100) | `#4A4845` (paper-700) |
| Accent | `#5B5BD6` (accent-500) | `#4F4FC7` (accent-600) |

### Typography
| Role | Font | Source |
|------|------|--------|
| Brand, headings, UI | Geist | Google Fonts |
| Body alternative (ADHD-friendly) | Lexend | Google Fonts |
| Timestamps, IDs, code | Geist Mono | Google Fonts |

### Theme
- Dark/light toggle with `useTheme` hook
- Defaults to dark on first load
- Persists preference to `localStorage`
- Implemented via Tailwind `darkMode: 'class'` - `dark` class on `<html>`

---

## 7. Infrastructure

### Stack
| Layer | Technology |
|-------|-----------|
| Runtime | Single Docker container |
| Web framework | FastAPI (Python 3.11) |
| ORM | SQLAlchemy 2 |
| Database | SQLite (file: `/data/department.db`) |
| File storage | Local disk (`/data/uploads/`) |
| Frontend build | React 18 + Vite |
| Styling | Tailwind CSS v3 |
| Container | Multi-stage Dockerfile |

### Ports
- Container exposes `8000` internally
- Mapped to `8080` on the host

### Volumes
- `./data:/data` - persists DB and uploaded files

### Env vars
| Variable | Default | Purpose |
|----------|---------|---------|
| `DB_PATH` | `/data/department.db` | SQLite file path |
| `UPLOAD_DIR` | `/data/uploads` | File upload directory |
| `FRONTEND_DIST` | `/app/frontend/dist` | Built React static files |

---

## 8. Access Control

Version 1.0 - single user, no authentication. The app is intended to run on a private homelab network (LAN or Tailscale). Do not expose port 8080 to the public internet without adding authentication first.

**Future consideration:** Add HTTP Basic Auth or session-based auth when multi-user access or public exposure is required.

---

## 9. File Uploads

- Max file size: 50 MB
- Stored with UUID filenames to prevent collisions
- Original filename preserved in `Attachment.original_name`
- Served at `/uploads/<stored_name>`
- Deleted from disk when the attachment record is deleted

---

## 10. Known Limitations and Future Scope

| Item | Notes |
|------|-------|
| Authentication | Not implemented in v1.0 |
| Search | No cross-area or cross-thread search yet |
| Tags/labels on threads | Not implemented |
| Markdown in summary | Summary is plain text; could be extended |
| Pagination | Thread and entry lists are not paginated |
| Audit trail | No history of status changes |
| Export | No CSV/PDF export |
| Notifications | No alerts or reminders |
| Mobile layout | Optimised for desktop; usable on mobile but not designed for it |

---

## 11. Extension Guide (for future Claude sessions)

Before making changes in a new chat:
1. Read this file (`REQUIREMENTS.md`)
2. Read `README.md` for the full folder structure and dev setup
3. Identify which file(s) need to change
4. Make targeted edits rather than regenerating files wholesale

**Backend entry point:** `backend/main.py`
**All API endpoints:** `backend/routers/`
**All shared data types:** `backend/schemas.py`
**Database models:** `backend/models.py`
**Frontend routing:** `frontend/src/App.jsx`
**All API calls:** `frontend/src/api/client.js`
**Colour/status config:** `frontend/src/utils/status.js`
