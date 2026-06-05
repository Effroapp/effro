# Insights Redesign - Requirements Specification

**Status legend:** ✅ Built & verified · 🧪 Prototype (mock data) · 📋 Planned (not started)
**Prepared by:** Claude (Anthropic) · **Scope:** the reimagined Insights page
**Companion to:** root `REQUIREMENTS.md` (read that first for the base product).

> This document is the agreed specification for the Insights redesign. It is written
> to be *reviewed*: every functional requirement (FR) is testable, and every fact the
> page states has an explicit computation rule and a confidence level. Where the
> example copy in earlier discussion overstated what the data supports, this spec
> records the honest version instead.

---

## 1. Purpose & design philosophy

The Dashboard is **present tense** (what is true right now). Insights is the
**reflective, temporal** lens - past to future - the one view you cannot reconstruct
by looking at any single area.

It exists to help, specifically for people with ADHD / executive-function load, by
attacking three failure modes a per-area view structurally cannot:

1. **Time-blindness** - the past and future feel shapeless. → Make them *visible*.
2. **Out of sight, out of mind** (the dropped plate) → *Surface* what's gone quiet.
3. **Progress doesn't feel real** → Show a calm, concrete *ledger of what got done*.

**Hard constraint:** calm by default, no guilt mechanics. No breakable streaks, no
scores, no comparison to an "ideal", no nagging. The page states facts about what
*did* happen; it never reproaches the user for what didn't.

---

## 2. Scope & status

| Lens / surface | Job | Status |
|---|---|---|
| **Reflect → Today** ("wind-down") | End-of-day recap; permission to stop | ✅ Built & verified |
| Heartbeat / working-window infra | Honest "when did you start/stop" | ✅ Built & verified |
| **Reflect → This week** | Step-back: closed loops, rhythm, work/life balance, celebrations | 🧪 Prototype |
| **Ahead** | Timeline spine, load forecast, free-space pairing | 🧪 Prototype |
| **Balance** | Attention map, drift radar, "not on you" reframe | 🧪 Prototype |
| Live page replacement (`/insights`) | Promote prototype over the old page | 📋 Planned |

The redesign currently lives on the throwaway route **`/insights-proto`**
(`frontend/src/pages/InsightsPrototype.jsx`). The old `/insights` page is untouched.

---

## 3. Information architecture

- **FR-IA1** Insights presents **three lenses** - *Reflect*, *Ahead*, *Balance* - as
  tabs, with exactly one visible at a time (low cognitive load). 🧪
- **FR-IA2** A single **narrative line** sits above the tabs as "what to notice", so
  the user never has to decide where to look first. 🧪
- **FR-IA3** The **Reflect** lens has a secondary **Today / This week** scope toggle.
  *Today* is the wind-down ritual; *This week* is the step-back. ✅ (toggle) / 🧪 (week)
- **FR-IA4** Tab and scope are predictable, stable destinations (no surprise
  reordering); switching is instant.

---

## 4. The Today wind-down ✅

The flagship: open it at the end of the day and see, accurately, what you did, so you
can switch off. Endpoint `GET /api/insights/today`; UI in the Reflect → Today scope.

### 4.1 Functional requirements

- **FR-T1** The page shows a **headline count** of things done today and a set of
  **breakdown chips** (one per category with a non-zero count).
- **FR-T2** It shows a **"A good place to stop"** card containing a short, warm,
  grounded **narrative** (see §4.4).
- **FR-T3** It shows a **"Done today"** list of the concrete finished items, each with
  its area and the local time it happened.
- **FR-T4** Every number shown is computed from real rows for **the user's local day**
  (00:00-24:00 local), never UTC (see §4.6).
- **FR-T5** When nothing has been done and there's no presence yet, the page shows a
  calm message ("a quieter day, and that is completely fine"), never an error or an
  empty guilt-state.
- **FR-T6** The feature works with **no AI provider configured** (template narrative)
  and degrades gracefully with no integrations connected.

### 4.2 Fact computation (the logic to review)

All windows are `[local_day_start, local_day_end)` unless noted. "Today (past)" means
`<= now`.

| Fact | Source rows | Exact rule | Confidence |
|---|---|---|---|
| **Todos done** | `entries` | `type='todo'` AND `completed` AND `parent_id IS NULL` AND `completed_at` in day. Subtasks excluded (count what the user calls "a todo"). | Exact |
| **Decisions made** | `entries` | `type='decision'` AND `created_at` in day | Exact |
| **Blockers cleared** | `audit_logs` | `field='status'` AND `old_value='blocked'` AND `new_value<>'blocked'` AND `occurred_at` in day; deduped per thread (latest wins) | Exact |
| **Threads resolved** | `audit_logs` | `field='status'` AND `new_value='resolved'` in day; deduped per thread | Exact |
| **Jira items filed** | `signal_items`+`entries` | `source='jira'` AND `status='assigned'` AND its `assigned_entry.created_at` in day | Exact (a real user action) |
| **Meetings attended** | `entries` | `type='meeting'` AND `meeting_at` in `[day_start, now]` | Exact |
| **Most progress (thread)** | `entries` | thread with most entries `created_at` in day; surfaced only if `count >= 2`; top 3 returned | Exact |
| **Threads created** | `threads` | `created_at` in day, grouped by area; **reported as a total** (see §4.5) | Exact (count) |
| **Headline count** | derived | sum of the breakdown chip counts | Exact |
| **Started / active hours / finish time** | `work_sessions` | from the heartbeat working-window (§4.3) | Honest, see §4.3 |

- **FR-T7** The **Done today** list = todos done + decisions + blockers cleared +
  threads resolved, sorted most-recent-first, each linking to its thread.

### 4.3 Working window & heartbeat ✅

We cannot claim "you started at 9:00" from edit timestamps alone (you might read for
an hour before writing). So presence is recorded directly.

- **FR-W1** While the app is open, the frontend pings `POST /api/heartbeat` on mount,
  on window focus, and every ~4 minutes while the tab is visible.
- **FR-W2** The backend stores **merged sessions**, not one row per ping: a ping
  within `SESSION_GAP_MINUTES` (30) of the last extends the current session;
  otherwise it opens a new one. (Table `work_sessions`; §5.)
- **FR-W3** The **day window** = first session start → last session end for the local
  day. Sessions shorter than `MIN_SESSION_SECONDS` (120) are **excluded from the span**
  so an isolated late-night check-in cannot report a 14-hour day.
- **FR-W4** "Active hours" = `now − first session start` (the day so far).
- **FR-W5** "Finishing at a reasonable hour lately" is asserted **only** when ≥3 of the
  last 7 days had presence and the last activity was ≤ 18:00 local on most of them.
- **FR-W6** If there are no sessions yet, all time-based facts are **omitted** (the
  narrative simply doesn't mention hours). No guessing.

### 4.4 Narrative generation - the grounding pipeline ✅

The narrative must be *smart* (warm, varied) **and** *accurate*. Accuracy wins ties.

- **FR-N1** A **deterministic template** is assembled from the computed facts. It is
  the single source of truth and is always 100% accurate by construction.
- **FR-N2** If an AI provider is configured, the AI is asked **only to reword the
  template draft** more warmly. It is **never** handed raw figures to synthesise, sum,
  or relabel.
- **FR-N3** **Numeric backstop:** if the AI output contains any integer not present in
  the draft, it is rejected and the template is used instead. (Guards against invented
  or summed numbers.)
- **FR-N4** The AI prompt forbids: inventing/changing numbers or names, introducing
  nouns not in the draft, mentioning undone work or tomorrow, and em dashes.
- **FR-N5** The response reports `ai_generated: true|false` so the UI/telemetry knows
  which path produced the text.
- **FR-N6** The narrative is 2-3 short sentences and ends by gently giving permission
  to stop.

> **Design history:** an earlier version let the AI synthesise from raw numbers; it
> summed five per-area thread counts into "31 discussions" and invented "7 threads".
> FR-N2/FR-N3 exist specifically to make that class of error impossible.

### 4.5 Accuracy rules & non-goals (deliberately NOT claimed)

- **NG-1 No time-on-task.** There is no per-task timer. We never say "spent 2 hours on
  Quality." Per-area effort is reported as **counts** ("created N threads"); duration
  exists only for the whole-day window from the heartbeat.
- **NG-2 No "you closed" for Jira.** When a Jira issue goes Done upstream we only know
  it was dismissed (possibly by someone else). We report Jira items **you filed** today
  (your action), not Jira completions.
- **NG-3 Threads-created reported as a total**, not per-area, in the narrative draft -
  so there is nothing for the AI to sum incorrectly. (Per-area detail may appear in a
  visual breakdown later, computed directly, never via the narrative.)
- **NG-4 No streaks, scores, or comparison to a target.**
- **NG-5 The balance/working-window surface only ever flags _over_-work, gently.** A
  short day is never criticised; the celebrated behaviour is *stopping*.

### 4.6 Timezone / local day ✅

- **FR-TZ1** All timestamps are stored naive-UTC (existing convention).
- **FR-TZ2** The client passes `tz_offset_min` = `Date.getTimezoneOffset()` (minutes;
  UTC+1 → −60). The server computes the local day window via `local = utc − offset`
  and `utc = local + offset`, and formats all local time labels with the same offset.
- **FR-TZ3** "Today" is therefore the user's local calendar day, not a UTC day.

### 4.7 Empty & edge states

- **FR-E1** No items + no presence → kind "quieter day" narrative; "Done today" shows
  "Nothing logged yet today, and that's fine."
- **FR-E2** Items present but no heartbeat → narrative omits hours, keeps the rest.
- **FR-E3** AI configured but call fails or returns junk → silent fallback to template.
- **FR-E4** Loading → skeleton; load error → quiet "Could not load today's recap."

### 4.8 API contract ✅

`GET /api/insights/today?tz_offset_min=<int>` → `TodayInsights`:

| Field | Type | Meaning |
|---|---|---|
| `date` | str | local `YYYY-MM-DD` covered |
| `started_at` / `last_active_at` | datetime? | first/last presence today (UTC) |
| `active_hours` | float? | span start→now, hours |
| `headline_count` | int | sum of breakdown counts |
| `breakdown` | `[{type,label,count}]` | hero chips |
| `done_items` | `[{id,type,content,area_name,thread_id,at}]` | "Done today" list |
| `meetings_count` / `meetings` | int / list | meetings attended today |
| `threads_progressed` | `[{thread_id,title,area_name,count}]` | top progress |
| `threads_created` | `[{area_name,count}]` | created today, by area |
| `jira_connected` / `jira_filed_today` / `jira_pending` | bool / int / int | Jira facts |
| `narrative` | str | the wind-down sentence(s) |
| `ai_generated` | bool | AI-reworded (true) or template (false) |

`POST /api/heartbeat` → `{ "ok": true }`. No body required.

### 4.9 Acceptance criteria

- [ ] Every figure in the narrative and chips matches a hand-count of the underlying
  rows for the local day.
- [ ] With AI on, repeated loads vary the wording but never the numbers; no number
  appears that isn't in the computed facts.
- [ ] With AI off (or failing), the template narrative renders and is accurate.
- [ ] A single isolated ping hours after the main block does **not** extend the
  reported day length (FR-W3).
- [ ] No heartbeat → no hours claim anywhere.
- [ ] Crossing local midnight rolls "today" over correctly for the user's timezone.
- [ ] Nothing-done day shows the calm message, never an error or guilt-state.

---

## 5. Data model additions

### WorkSession ✅ (`work_sessions`)
| Field | Type | Notes |
|---|---|---|
| id | int (PK) | |
| started_at | datetime | naive UTC; first ping of the session |
| ended_at | datetime | naive UTC; last ping of the session |
| ping_count | int | pings merged into this session |

Created via `Base.metadata.create_all` and an additive `CREATE TABLE IF NOT EXISTS` in
`main.py` (no destructive migration). No other tables changed.

---

## 6. Reflect (week), Ahead, Balance - prototype requirements 🧪

These are designed and visually prototyped (mock data); the requirements below are the
intended behaviour to build against next. Each will follow the §4.4 grounding pipeline
and §4.5 non-goals.

### 6.1 Reflect → This week 🧪
- **FR-R1** "Loops closed" headline + breakdown for the last 7 local days (same sources
  as §4.2, week window).
- **FR-R2** **Worth noticing** - earned celebrations only: a blocker cleared, a thread
  resolved, a *return to a quiet area* (re-engagement), decisions made. If nothing
  qualifies, the section is absent (never a sad empty-state).
- **FR-R3** **Your days** - per-day working-window bars (§4.3) over recent days;
  healthy (≤9h) reads calm/sage, longer reads gently amber (never alarm-red). Celebrates
  a steady pace and stopping earlier; flags only sustained over-work.
- **FR-R4** **Your rhythm** - 14-day activity (entries/day), weekends de-emphasised.
- **FR-R5** **Closed this week** - the concrete finished items.

### 6.2 Ahead 🧪
- **FR-A1** **Load forecast** - count of meetings + due todos for next week, framed as
  "so it doesn't ambush you" (no pressure).
- **FR-A2** **Timeline spine** - next ~10 local days with meetings and due todos placed
  on a single axis; "now" marked.
- **FR-A3** **A good window** - pair free calendar time with a quiet area, as an
  optional suggestion ("if you have the energy"), never a directive.

### 6.3 Balance 🧪
- **FR-B1** **Attention map** - share of activity across areas + per-area sparklines.
- **FR-B2** **Drift radar** - areas quiet ≥ N days, surfaced calmly ("when you have the
  energy"), never nagged.
- **FR-B3** **Not on you** - open work waiting on other people (via blockage / thread
  links), reframed as weight the user can set down.

---

## 7. Design system & copy rules

- Brand tokens only (no raw Tailwind palette); status colours `sage / sky-muted /
  mustard / amber-muted / terracotta / lavender`; `mint` used sparingly as the accent.
- Lucide icons; `PageHeader` spec; entry types via `entityIcons`.
- **Copy:** no em dashes (commas or hyphens); calm, second person; never demanding.
- Celebrations may use a faint `mint` wash; gentle nudges use dashed muted borders;
  reassurance ("not on you") uses `sky-muted`. Drift/overwork use `mustard`, never
  `terracotta`, to avoid alarm.

---

## 8. Privacy & calm principles

- All data is local (SQLite). The heartbeat records only timestamps of presence - no
  content, no activity detail, no external transmission.
- The narrative is generated by the user's configured AI provider (or not at all);
  the same privacy posture as existing AI surfaces applies.
- The page must never increase anxiety: no countdowns of failure, no red overdue
  shaming, no "you're behind". Every reminder ends in agency ("when you have energy").

---

## 9. Open items / future

- Promote `/insights-proto` to the live `/insights` route (replace the old page). 📋
- Wire Reflect-week, Ahead, Balance to real aggregates (§6). 📋
- Record Jira done-transitions in the sync so "resolved" can be attributed honestly
  (today it is silently dismissed; see NG-2). 📋
- Optional: a "feel-good" taste on the Dashboard greeting linking into Insights. 📋
- Consider whether the Today headline should count decisions as "made" rather than
  folding them into "done". (Open copy decision.)
```
