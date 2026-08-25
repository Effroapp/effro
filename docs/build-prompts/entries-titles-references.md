# Build prompt for Claude Code

## Entries upgrade. Custom types, always-present titles, reference cards

Read `CLAUDE.md` first and follow it. Inspect the code before changing it. Where this prompt names a file or a function, confirm it still exists and still does what's described. If anything here contradicts what you find, stop and say so rather than guessing.

### Status

Phases 0 and 1 are on `main` (PR #63) and shipped in beta `0.14.0-beta.268`. Phases 2, 3 and 4 remain. Work continues on `feature/entries-titles-references`, rebased onto `main` before Phase 2 starts. The Phase 0 and Phase 1 sections below have been corrected to match what was built, so read them as a record of what exists, not as work to do.

### How to work on this

- Work on `feature/entries-titles-references`. Rebase it onto `main` before starting Phase 2.
- Do not commit or push at any point. I'll commit between phases.
- Do not bump the version in `src-tauri/tauri.conf.json`.
- The work is in five phases. At the end of each phase, stop. Post a short report with the files you changed, the checks you ran, and anything you could not verify. Wait for me to say continue.
- At every gate, `pytest` in `backend/tests` must pass and `npm run build` in `frontend` must pass. Also run the static pass for JSX components used but not imported (it caught a runtime crash the build missed in Phase 0), and `npm run lint` if the script exists. If it doesn't, note that in Known Debt rather than setting it up now.
- New UI for the composer or the card goes in its own component under `frontend/src/components/entries/`, never inline in `ThreadView.jsx`. That file is still around 1,500 lines and must not grow back.
- Every decision below has already been made. Don't re-open them. If you hit something this prompt doesn't cover, pick the sensible default, state it in your report, and carry on.
- All UI copy is in the copy table at the end. Use those strings exactly. If you need a string that isn't there, write it in the same register and list it in your report.
- British English everywhere, in copy, comments and docs. No em dashes and no semicolons in any copy or docs.

### Relationship to the formatting work

A separate formatting prompt was planned to add entry titles and user-set dates. This prompt now owns the `entries.title` column and all title behaviour. If a `title` column already exists on `entries` when you start, say so in the Phase 1 report and build on it rather than adding a second one. Don't touch user-set dates here.

### What we're building, in plain terms

1. A way for the user to create their own entry types (Risk, Question, Idea and so on) that sit alongside Update, To Do, Decision, Meeting and Blocked.
2. Every prose entry gets a title. The user can type one, ask for a suggested one, or leave it blank and have one written on save. Titles the user writes are never overwritten.
3. When a file, a link, a linked thread or a Folio lands on a thread, it appears in the timeline as its own card with a Notes field, and the card and the thing it points at share one life.

Plus a small prep step so all three don't collide in one very large file.

### Things to keep in mind throughout

- The timeline must go on reading as one calm list. New card kinds use the same shell, spacing, hover behaviour and Notes control as the existing cards.
- AI is a hint, never a gate. Nothing waits on an AI call before saving. Any AI failure is silent or a calm toast, never an error state on the entry.
- All AI calls go through `ai_provider.get_provider(db).complete(...)` on the backend, the way the thread summary suggestion in `backend/routers/threads.py` does.
- Every schema change is an additive string in the migration list inside `_init_db()` in `backend/main.py`, followed where needed by a guarded, idempotent backfill block in the same style as the existing ones. No Alembic.
- Don't rely on SQLite foreign key cascades for anything new. Do deletions explicitly in the routers.
- `created_at` on entries is naive UTC. Backfilled rows must match.
- Tailwind only generates classes it can see as literal strings in source. Any colour class for custom types must live in a static map in `frontend/src/utils/entityIcons.js`, never built with template strings.
- Apply changes app-wide. If a pattern changes, change it everywhere it appears.

---

## Phase 0. Pull the entry components out of ThreadView.jsx (done)

As built. `frontend/src/components/entries/` holds `EntryBlock.jsx`, `EntryNotes.jsx`, `MeetingBody.jsx` (carrying `toLocalInput`) and `TaskCheckbox.jsx` (moved down from `components/`, with `InHandStrip.jsx` repointed). `getDueDateClass` lives in `utils/status.js` because the open-task rows in ThreadView use it too. ThreadView keeps the composer, the sidebar, `FileItem`, `LinkItem`, `ThreadLinksList` and `ThreadSkeleton`.

The original instructions follow for the record.

`frontend/src/pages/ThreadView.jsx` holds the composer, the entry card, the meeting editor, the notes control, the checkbox, the attachments sidebar and the thread-links list. Phases 1 to 3 all touch the entry card. Move it out first.

- Create `frontend/src/components/entries/` and move these into their own files, keeping names and props exactly as they are. `EntryBlock.jsx`, `EntryNotes.jsx`, `TaskCheckbox.jsx`, and the meeting title and time editor. Move any helper only they use, such as `toLocalInput`, with them.
- Move, don't rewrite. No behaviour change in this phase.
- `ThreadView.jsx` imports them. Leave the composer, the sidebar and `ThreadLinksList` where they are.
- Check by hand in the running app. Add an Update, edit it, delete it, open and save Notes, edit a meeting title and time, tick and untick a To Do, break a To Do down and toggle a subtask.

Gate 0 report. The file list and the click-through result.

---

## Phase 1. Custom entry types (done)

As built, with one correction to the original spec. The palette below originally listed the built-in type colours, which would have made a custom type indistinguishable from Blocked or Decision. The palette is now six tokens added to `tailwind.config.js` for this purpose, in the same muted register and on hues the built-ins don't occupy. `sage`, `seafoam`, `dusk`, `plum`, `heather` and `pebble`. The backend `CUSTOM_COLOURS` list refuses the built-in colour keys and a test holds that line. Names avoid `teal`, `rose`, `slate` and `stone` because those are Tailwind's own scales. `clay` is out because CLAUDE.md reserves it for the person rather than the product.

The original instructions follow for the record.

### Data

Add to the migration list.

```
CREATE TABLE IF NOT EXISTS custom_entry_types (id INTEGER PRIMARY KEY, name VARCHAR(40) NOT NULL, colour VARCHAR(20) NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_entry_types_name ON custom_entry_types(lower(name))
ALTER TABLE entries ADD COLUMN custom_type_id INTEGER REFERENCES custom_entry_types(id) ON DELETE SET NULL
CREATE INDEX IF NOT EXISTS idx_entries_custom_type ON entries(custom_type_id)
```

Add a `CustomEntryType` model in `backend/models.py`. On `Entry` add `custom_type_id` and `custom_type = relationship("CustomEntryType", lazy="joined")` so the thread read path gets it without a second query per entry.

The stored `type` value for these entries is `custom`. Update the comment on `Entry.type`. Add `custom` to `valid_types` in `create_entry`. When `type` is `custom`, `custom_type_id` is required and must exist (422 otherwise). When `type` is anything else, `custom_type_id` is forced to null. The same rule applies on update when `type` changes.

Colour keys are `sage`, `seafoam`, `dusk`, `plum`, `heather` and `pebble`, and nothing that matches a built-in type colour. (The original text here named the built-in colours, which was wrong. See the note at the top of this phase.)

### API

New file `backend/routers/entry_types.py`, mounted under `/api` like the others.

| Route | Body | Returns |
|---|---|---|
| `GET /entry-types` | | list of `{id, name, colour, usage_count, created_at}` ordered by name |
| `POST /entry-types` | `{name, colour}` | 201 with the type |
| `PUT /entry-types/{id}` | `{name?, colour?}` | the type |
| `DELETE /entry-types/{id}` | | 200 with `{converted: n}` |

Validation. Trim the name. 1 to 24 characters. Reject a duplicate (case-insensitive) with a 409 and the detail from the copy table. Reject an unknown colour with a 422.

Delete converts every entry using the type to `type = 'entry'` and `custom_type_id = NULL`, then deletes the type. One audit row for the type (entity_type `entry_type`, action `deleted`, `new_value` the count). Create and rename also write an audit row.

`EntryOut` gains `custom_type_id: Optional[int]` and `custom_type: Optional[CustomEntryTypeOut]` where that is `{id, name, colour}`. `EntryCreate` and `EntryUpdate` gain `custom_type_id: Optional[int]`.

For the audit row written on entry creation, `field` stays the stored type and `new_value` carries the custom type's name when there is one.

### Frontend

`frontend/src/api/client.js`. Add `entryTypesApi` with `list`, `create`, `update` and `remove`.

`frontend/src/hooks/useEntryTypes.js`. Fetches once and caches at module level so the composer and QuickCapture share one list. Exposes `types`, `loading`, `refresh`, `create`, `update` and `remove`.

`frontend/src/utils/entityIcons.js`.

- Add a `dot` class to every `ENTITY` record for the timeline dot. Today the card picks the dot with `isDecision ? 'bg-amber-muted' : 'bg-mint'`. Switch it to read from the entity record so every type owns its dot.
- Add `CUSTOM_PALETTE`, keyed by colour, each holding the same `tint`, `badge`, `borderLeft` and `dot` class strings the built-ins use, written out literally.
- Add `ENTITY.custom` as a neutral default (label `Custom`, `Icon: Tag`, paper tints), used only when a custom entry somehow has no type attached.
- Add `entityForEntry(entry)`. Built-in types return their `ENTITY` record. `custom` returns `{ label: entry.custom_type.name, Icon: Tag, ...CUSTOM_PALETTE[entry.custom_type.colour] }`, falling back to `ENTITY.custom`. Leave `entityFor(type)` as it is for callers that only have a type string, and switch every call site that has an entry object in hand to `entityForEntry`.

The composer in `ThreadView.jsx`. The type row shows the built-ins as now, then each custom type as a pill in its own colour, then a final pill reading `Your own…` with a Plus icon. Picking a custom pill sets `entryType = 'custom'` and `customTypeId`. `addEntry` sends `custom_type_id` when the type is custom. When the row wraps on narrow widths, let it wrap with `flex-wrap`. No overflow menu.

The `Your own…` popover. Anchored to the pill, `max-w-sm`, closes on Esc and on outside click, and focus returns to the pill on close.

- Heading from the copy table.
- A list of the existing custom types. Each row has a colour dot, the name, a pencil that turns the name into an inline input (Enter saves, Esc cancels), and a bin that opens the existing `ConfirmDialog` with the copy from the table. Delete refreshes the list, resets the composer to Update if the deleted type was selected, and toasts.
- The empty state from the copy table when there are none yet.
- The add form below the list. A name input (placeholder from the table, `maxLength 24`, autofocus), six colour swatches as a radio group with the colour name as the accessible label and the first selected by default, then `Add` and `Cancel`. Enter in the name input adds. A duplicate name shows the server's message inline under the input. On success the list refreshes, the new type is selected in the composer, the popover closes and a toast confirms.

`QuickCapture.jsx`. Its local `ENTRY_TYPES` list gains the custom types (from the hook, loaded when the modal opens) and it sends `custom_type_id`. Extend the list, don't restructure the modal.

`EntryBlock.jsx`. A custom entry renders exactly like an Update (edit, delete, Notes, no checkbox) with its dot, left accent bar, badge and icon taken from `entityForEntry(entry)`.

Anywhere else a type filter or type picker exists (search the frontend for `'decision'` used in filters or pickers), custom types must appear in it too.

### AI

- `frontend/src/hooks/useEntryAI.js`. Path A (action detection) runs for `type === 'custom'` as well as `'entry'`.
- New backend module `backend/entry_text.py` with `entry_prompt_line(entry)`. It renders an entry as one line for AI prompts, prefixed with its label in square brackets, so `[Update] ...`, `[Decision] ...`, or `[Risk] ...` for a custom type named Risk. Switch every place the backend serialises entries into an AI prompt to use it. Known places are the thread summary suggestion in `routers/threads.py`, `_build_threads_context` in `routers/generate.py`, the area summary suggestion, the roundup and the Insights narratives. Search for `.content` inside prompt-building code to find any others.
- The extraction endpoint `/generate/process` keeps producing only the built-in types. It must not invent custom types.

### Tests

`backend/tests/test_entry_types.py`. Create and list. Duplicate rejected case-insensitively. Rename. Delete converts entries and returns the count. Creating an entry with `type custom` requires a valid `custom_type_id`. Thread GET returns `custom_type` on the entry.

Gate 1 report.

---

## Phase 2. Titles

### Which types carry a title

`entry`, `decision` and `custom`. Not `todo`, `meeting`, `blockage` or `reference`. Define `TITLED_TYPES` once in `backend/entry_text.py` and use it everywhere. To Dos and Meetings are already one line, and a Blocked entry carries the reason the user was required to give, so a title on those would duplicate what's already there.

### Data

Add to the migration list.

```
ALTER TABLE entries ADD COLUMN title TEXT
ALTER TABLE entries ADD COLUMN title_source VARCHAR(10)
```

`title_source` is `user`, `ai`, `fallback` or null. Null on types that don't carry a title.

Backfill block, guarded and idempotent. For every entry whose type is in `TITLED_TYPES` and whose `title` is null, set `title = fallback_title(content)` and `title_source = 'fallback'`. Do it in Python in batches, since the fallback needs markdown stripped. Log one INFO line with the count.

### The fallback rule

In `backend/entry_text.py`.

- `strip_markdown(text)`. Port the regexes from `stripMarkdown` in `frontend/src/utils/markdownEditing.js` so the two sides agree.
- `fallback_title(content)`. Strip markdown, take the first non-empty line, collapse whitespace, cut to 60 characters at a word boundary, and if nothing is left return the fallback string from the copy table.

### Backend behaviour

`EntryCreate` gains `title: Optional[str]` and `title_source: Optional[str]`. `EntryUpdate` gains the same. From the client the only accepted `title_source` value is `ai`. Anything else is treated as `user`.

Titles are trimmed, internal whitespace collapsed, and capped at 120 characters.

On create, for a titled type. If `title` is non-empty, store it with source `user`, or `ai` if the client marked it so. If empty or missing, store `fallback_title(content)` with source `fallback`. For any other type, `title` and `title_source` are null whatever the client sent.

On update, apply the content change first, then these rules in order.

- If the type is changing into a titled type and there's no title, compute the fallback. If it's changing out of one, null both fields.
- If `title` is present and `title_source` is `ai`, apply it only when the current source isn't `user`. Otherwise ignore it silently and return the entry as it is. A user-written title is never overwritten by AI.
- If `title` is present and non-empty from the user, store it with source `user`.
- If `title` is present but empty from the user, they've cleared it deliberately. Recompute the fallback with source `fallback`.
- If content changed and the current source isn't `user`, recompute the fallback with source `fallback`. The frontend then re-runs the suggestion pass, so an AI title never goes stale against edited content.
- Title changes write an audit row with `field = 'title'`.

New endpoint `POST /generate/title` in `routers/generate.py`. Body `{content: str}`. Returns `{title: str}`. Content under 20 characters after trimming is a 422. If no provider is configured, return 503 with the detail from the copy table. Cap the content sent to the model at 4,000 characters. `max_tokens 40`.

System prompt, exactly.

> You write a short title for one entry in a personal work log. Return only the title. Use only what is in the entry and add nothing new. At most 60 characters. Plain text, sentence case, no quotes, no trailing full stop, no emoji. If the entry is a question, the title can be the question.

Post-process the reply. Trim, strip surrounding quotes and any markdown, cut to 60 at a word boundary, drop a trailing full stop. If nothing is left, return 502 with the detail from the copy table.

### Frontend

`frontend/src/utils/entries.js`. Add `displayTitle(entry)`. Returns `entry.title` when present, otherwise the first line of `stripMarkdown(entry.content)` cut to 60. This is for one-line contexts only (lists, search results, activity rows, and later the In Hand strip). It is not used to invent a heading on To Do, Meeting or Blocked cards.

`frontend/src/api/titles.js`. `suggestTitle(content)` wraps `POST /generate/title`. `suggestAndApplyTitle(entry)` runs the post-save pass. It returns early unless `entry.title_source === 'fallback'`, the type is titled, and trimmed content is 20 characters or more. It calls `suggestTitle`, then `PUT /entries/{id}` with `{title, title_source: 'ai'}`, and returns the updated entry or null. Silent on any failure.

The composer.

- Build the Title input and its Suggest button as one component, `frontend/src/components/entries/TitleField.jsx`, and use it in both the composer and the card's inline editor. Don't add it inline to ThreadView.
- For titled types, the single-line Title input sits above the `MarkdownArea`. Placeholder from the table. `maxLength 120`. Enter moves focus to the content rather than submitting. Switching to a non-titled type hides the field but keeps its value in state in case they switch back.
- A `Suggest a title` ghost button sits at the right end of the Title input, using the same icon the app already uses for AI affordances (find it and reuse it). It shows once trimmed content reaches 20 characters. While a request is in flight it shows a spinner and is disabled. On success the input fills and local state records `titleFromAi = true`. If the user edits the field afterwards, that flag clears. On failure, a calm toast with the server's detail.
- Find how the frontend currently knows whether an AI engine is configured (the Settings AI tab or an AI status endpoint) and use it to hide the button when there's no engine. If nothing cheap exists, show the button and let a failure produce the toast.
- On submit, send `title` (trimmed, possibly empty) and `title_source: 'ai'` only when `titleFromAi` is still true.
- After a successful save, call `suggestAndApplyTitle` and, if it returns an entry, replace it in thread state. Wire this into `useEntryAI.onEntrySaved` as a third path so it sits with the other post-save hints.

`QuickCapture.jsx`. No Title field. After a successful create, call `suggestAndApplyTitle` and ignore the result. The modal has closed and the thread will show the title on next load.

`EntryBlock.jsx`, for titled types.

- Render the title as the card heading only when `title_source` is `user` or `ai`. A fallback title would just echo the first line of the content, so it stays hidden on the card. Use the same heading style the meeting title uses (`text-base font-medium`), above the markdown content.
- When the source is `ai`, show a small marker pill reading `suggested` in the header's muted uppercase style, with the tooltip from the table. Once the user edits the title the marker goes.
- Clicking the heading opens an inline single-line input pre-filled with the current title. Enter saves, Esc cancels, with the same small Save and Cancel pair the meeting editor uses. Saving sends `{title}` and the source becomes `user`. Clearing and saving recomputes the fallback on the server and the heading disappears again.
- When no heading is shown, an `Add a title` affordance appears in the card's hover actions next to Edit. It opens the same inline input, pre-filled with the fallback title so there's something to tweak rather than a blank.
- After a content edit is saved, if the returned entry has `title_source === 'fallback'`, run `suggestAndApplyTitle` and apply the result. Keep a ref of entry ids whose title input is currently open and skip those. The server guard covers everything else.
- When an AI title arrives after save, it fades in using the existing `animate-fade-in` class rather than snapping in.

Elsewhere. Search the frontend for `stripMarkdown(` and for `content` being sliced to make a label. Where the thing shown is a one-line label for an entry, switch to `displayTitle(entry)`. On the backend, `ActivityEvent.detail` for entry events uses the title when there is one.

### Tests

`backend/tests/test_entry_titles.py`. Create without a title gives a fallback. Create with a title gives `user`. Create with `title_source ai` gives `ai`. A To Do ignores the title. A content edit on a fallback title recomputes it. A content edit on a user title leaves it alone. An `ai` title is ignored when the source is `user`. Clearing a title recomputes the fallback. Type change into and out of titled types. `fallback_title` on markdown, on a long line, and on an empty result. `POST /generate/title` returns 422 on short content and 503 when unconfigured (monkeypatch `get_provider`). The backfill fills legacy rows once and leaves them alone on a second run.

Gate 2 report.

---

## Phase 3. Reference cards

### Data

The stored type is `reference`. Add to the migration list.

```
ALTER TABLE entries ADD COLUMN ref_kind VARCHAR(10)
ALTER TABLE entries ADD COLUMN ref_id INTEGER
CREATE INDEX IF NOT EXISTS idx_entries_ref ON entries(ref_kind, ref_id)
```

`ref_kind` is `file`, `link`, `thread` or `folio`. `ref_id` is the id of the `Attachment`, `ThreadLink` or `Folio` row. No foreign key, because it points at three tables (the same choice `audit_logs` makes). `content` holds a snapshot of the object's name at creation, which satisfies the not-null constraint and gives activity rows something to show. Display never uses it while the live object exists. `title` is null.

`reference` is a valid stored type but not a client-creatable one. `POST /threads/{id}/entries` with `type reference` is a 422 with the detail from the copy table.

### Creation

Replace `log_activity_entry` in `backend/audit.py` with `create_reference_entry(db, thread_id, ref_kind, ref_id, name, created_at=None)`. Best-effort like the old helper, so a failure never poisons the caller's transaction, but it returns the entry. It bumps the thread's and area's `updated_at` the way `create_entry` does.

Call sites.

- `routers/attachments.py` `upload_file`, kind `file`.
- `routers/attachments.py` `add_link`, kind `link`.
- `routers/threads.py` `add_thread_link`, kind `thread`, `ref_id` the link's id, on the from-thread only. The old verb text goes. The relationship kind is read live from the link row for display.
- `routers/folio.py` on create when `thread_id` is set, kind `folio`. On `PATCH` when `thread_id` changes, move the existing reference entry to the new thread (update its `thread_id`, set `created_at` to now, keep its notes), delete it when the new value is null, and create one when there wasn't one before.

Then search for every other place an `Attachment`, `ThreadLink` or Folio-with-thread row is created directly rather than through these routes. Known candidates are the Signals accept path in `routers/signals.py` (link and file modes), Telegram media, the demo data loader and the ingest path. Route them through one shared creation function per object type so the hook can't be missed, rather than pasting the call into each place. Remove `log_activity_entry` once nothing calls it.

### Shared life

Object to entry.

- `delete_attachment` also deletes the reference entry with the matching kind and `ref_id`.
- `delete_thread_link` likewise.
- `delete_folio` likewise.
- `delete_thread`. Before the delete, find every `ThreadLink` whose `to_thread_id` is this thread and delete the reference entries those links own in their from-threads. The cascade removes the link rows but would leave those cards orphaned.

Entry to object, in `delete_entry` when the type is `reference`. `delete_entry` needs the `current_user` dependency added so audit rows can record who did it.

- `file` and `link`. Pull the body of `delete_attachment` into `remove_attachment(db, attachment, performed_by)` (disk file, row, audit row, reference entry) and call it from both routes. It removes the entry itself, so `delete_entry` must not delete the entry a second time.
- `thread`. The same pattern with `remove_thread_link`.
- `folio`. Do not delete the Folio. Set its `thread_id` to null, write an audit row for the unfiling, then delete the entry.

Orphan guard on read. If a reference entry's object is missing, don't crash. Return `reference: null` and let the card render its gone state from the snapshot name.

### Read path

`EntryOut` gains `ref_kind`, `ref_id` and `reference: Optional[ReferenceOut]`. `ReferenceOut` carries `kind`, `id` and `name`, then per kind. For attachments `url`, `size`, `stored_name` and `sync_status`. For thread links `thread_id`, `thread_title`, `thread_status`, `area_name` and `link_kind`. For folios `folio_id`, `folio_title` and `capture_count`. Resolve them in `_thread_detail` in one batch per kind (collect the ids, three queries, map back), never one query per entry.

`update_entry` on a reference accepts `notes` only. If `content`, `title`, `type`, `completed`, `due_date` or `meeting_at` is present, return 400 with the detail from the copy table.

### Frontend

New `frontend/src/components/entries/ReferenceCard.jsx`, rendered by `EntryBlock` when `entry.type === 'reference'`. It uses the same outer shell as the other cards (timeline dot, border, hover behaviour, date in the header) so the timeline reads as one list.

- Header. The kind icon (`Paperclip` for file, `Link2` for link, the thread icon from `SECTION_ICONS` for thread, and whatever icon the Folio index uses for a folio) and a muted kind label from the copy table. For thread links the label is `Blocks` when `link_kind` is `blocks`, otherwise `Linked thread`.
- Body. The name as the primary line in `text-sm font-medium`, and it's a link. File opens the upload the same way the Files panel does. Link opens through the app's system-browser link handling. Thread is a router `Link` to `/thread/{id}`. Folio is a router `Link` to the folio route (find it in `App.jsx`). If `EFFRO_FOLIO_ENABLED` is off, the folio card renders without a link.
- Meta line under the name in the muted mono style. File shows the size formatted as the Files panel formats it. Link shows the hostname. Thread shows the area name. Folio shows the capture count from the copy table.
- Then `EntryNotes`, exactly as on other cards.
- Hover actions. Delete only. It opens `ConfirmDialog` with the per-kind copy from the table. On confirm, `DELETE /entries/{id}`, remove the entry from state, and remove the matching row from the sidebar's files, links or outgoing links state so the panels agree without a refetch.
- Gone state, when `reference` is null. The snapshot name in the muted style, the line from the copy table, no link, Delete only.

The sidebar Files, Links and Linked threads panels stay. After one of their remove actions succeeds, also drop the matching reference entry from `thread.entries` in local state (find it by `ref_kind` and `ref_id`). The `syncEntries()` refetch after an add can stay.

### AI

`entry_prompt_line` renders references as `[File attached] name`, `[Link added] name (host)`, `[Linked thread] name` and `[Folio filed] name`. References are excluded from action detection, decomposition and the Generate extraction.

### Migration for existing data

A guarded, idempotent backfill block that runs at start like the others.

1. Convert legacy text entries in place. `log_activity_entry` wrote deterministic strings. Read the exact formats from the three call sites before you change them. For each Attachment, look for an entry in the same thread with `type entry`, content exactly equal to the string the helper would have written for it, and `created_at` within 120 seconds after the attachment's. For each ThreadLink, the same using the to-thread's current title (older renames won't match, which is accepted). Set `type = 'reference'`, `ref_kind`, `ref_id` and `content = name`, and keep `notes` and `created_at`.
2. Create what's missing. For each Attachment, ThreadLink and Folio-with-thread that still has no reference entry, create one with `created_at` equal to the object's own `created_at` (naive UTC), `content` the name, no notes.
3. Log one INFO line with both counts. A second run must change nothing.

### Tests

`backend/tests/test_reference_entries.py`. File upload creates a reference entry. Add link creates one. Thread link creates one on the from-thread only. Folio create with `thread_id` creates one. Folio refile moves it and keeps notes. Folio unfile deletes it. Delete attachment deletes the entry. Delete a file entry deletes the attachment and the disk file. Delete a folio entry unfiles and keeps the Folio. Delete a to-thread removes the reference entries in from-threads. `PUT` on a reference accepts notes and rejects content. `POST` with `type reference` is a 422. Thread GET resolves `reference` with the live name after the to-thread is renamed. The backfill converts legacy text entries, creates missing ones, and does nothing on a second run.

Gate 3 report.

---

## Phase 4. Docs and wrap-up

- `CLAUDE.md`. Update the entry types line under "What Effro is". Add a short "Entries" note covering `TITLED_TYPES`, the title rules in three sentences, the reference type and the shared-life rule. Remove any mention of `log_activity_entry`. Add to Known Debt only if you skipped something.
- `README.md`. Add the new routes to the API table.
- Final report. Files touched, tests run, and what you could not verify (the Tauri build, cloud sync of attachments, Folio with the flag off, Telegram media).

---

## Copy table

Use these strings exactly.

| Where | String |
|---|---|
| Composer, custom type pill | `Your own…` |
| Popover heading | `Your entry types` |
| Popover empty state | `Nothing here yet. Add a type you'd use often.` |
| Add form, name placeholder | `Name, like Risk or Question` |
| Add form buttons | `Add` and `Cancel` |
| Colour names (accessible labels) | `Sage`, `Seafoam`, `Dusk`, `Plum`, `Heather`, `Pebble` |
| Duplicate name (server detail) | `You already have a type called {name}` |
| Delete type confirm, title | `Delete type` |
| Delete type confirm, message | `Delete "{name}"? The {n} entries using it will become Updates.` Singular `entry` when n is 1. `No entries use it yet.` when 0. |
| Toasts | `Type added`, `Type renamed`, `Type deleted` |
| Composer, title placeholder | `Title (optional)` |
| Suggest button | `Suggest a title` |
| AI unconfigured (server detail) | `AI isn't set up yet` |
| No title returned (server detail) | `No title came back` |
| Card marker | `suggested` |
| Card marker tooltip | `Written from the entry. Click the title to change it.` |
| Card hover affordance | `Add a title` |
| Title fallback when nothing usable | `Untitled` |
| Reference kind labels | `File`, `Link`, `Linked thread`, `Blocks`, `Folio` |
| Folio meta | `{n} captures`, singular `1 capture` |
| Gone state line | `This is no longer on the thread.` |
| Delete confirm, file | Title `Remove file`. Message `Remove this file? The file and this card both go.` |
| Delete confirm, link | Title `Remove link`. Message `Remove this link? The link and this card both go.` |
| Delete confirm, thread | Title `Unlink thread`. Message `Unlink this thread? The link and this card both go. The other thread is untouched.` |
| Delete confirm, folio | Title `Remove from thread`. Message `Remove this Folio from the thread? The Folio itself is kept.` |
| Reference create rejected (server detail) | `Reference entries are created by attaching things, not directly` |
| Reference edit rejected (server detail) | `Reference entries can only take notes` |

---

## Decisions already made

So you don't re-open them.

- Custom types are label and colour only. They behave like Updates underneath. No checkbox, no dates.
- Custom types are global, not per Area.
- Deleting a type that's in use converts its entries to Update. Renaming is free.
- Titles live on `entry`, `decision` and `custom` only.
- A title is never required to save. The fallback is written on the server so every client gets it.
- AI titles arrive after save and only ever replace fallback titles. User-written titles are never overwritten.
- Fallback titles are stored but not shown on the card.
- Reference entries live in the thread where the thing was attached. A thread link shows a card in the from-thread only.
- Reference entries and their objects share one life, except a Folio, where deleting the card unfiles the Folio and keeps it.
- Legacy activity text entries are converted in place, not duplicated.
- No FTS work here. The only FTS5 index in the app is `folio_fts`.
