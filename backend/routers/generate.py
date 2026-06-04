"""
Smart Generate / AI extraction endpoints.

All AI calls go through the pluggable provider abstraction in ai_provider.py
- the user picks Claude / Groq / Gemini / Ollama / custom in
Settings → AI Engine, and this router stays provider-agnostic.

Error handling: `provider.complete()` raises RuntimeError with a user-readable
message (already translated by _friendly_error() in ai_provider.py). We wrap
that as HTTP 502 so the frontend gets a clean detail string.
"""
import json
from datetime import date as _date, datetime as _datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from ai_provider import get_provider

router = APIRouter(tags=["generate"])


def _provider_error(e: Exception) -> HTTPException:
    """Turn a provider RuntimeError into HTTP 502 with the readable message."""
    return HTTPException(status_code=502, detail=str(e))


def _derive_thread_title(content: str) -> str:
    """A short, clean thread title from an item's content, for when the model
    didn't supply one. Cuts on a word boundary so we never truncate mid-word."""
    text = " ".join((content or "").split())
    if not text:
        return "General notes"
    if len(text) <= 60:
        return text
    return text[:60].rsplit(" ", 1)[0] or text[:60]


def _normalise_item(item: dict) -> dict:
    """Make a raw model item safe to construct a ProcessedItem from.

    The model occasionally omits suggested_thread or returns null (an item it
    doesn't think belongs to any thread). Rather than 422 the whole batch, we
    derive a usable title from the content so the item stays actionable.
    """
    if not isinstance(item, dict):
        raise ValueError("each item must be a JSON object")
    item = dict(item)
    st = item.get("suggested_thread")
    if not isinstance(st, str) or not st.strip():
        item["suggested_thread"] = _derive_thread_title(item.get("content", ""))
    else:
        item["suggested_thread"] = st.strip()
    # Dates must be real ISO values or the entry endpoint rejects them. Models
    # often emit "null"/"none" or relative phrases ("Weeks 1-2", "in 5 weeks");
    # anything that isn't a strict ISO date/datetime becomes None so it can't
    # crash entry creation (it just won't carry a due date).
    dd = item.get("due_date")
    if isinstance(dd, str):
        s = dd.strip()
        try:
            _date.fromisoformat(s)
            item["due_date"] = s
        except ValueError:
            item["due_date"] = None
    elif dd is not None:
        item["due_date"] = None

    ma = item.get("meeting_at")
    if isinstance(ma, str):
        s = ma.strip()
        try:
            _datetime.fromisoformat(s)
            item["meeting_at"] = s
        except ValueError:
            item["meeting_at"] = None
    elif ma is not None:
        item["meeting_at"] = None
    return item


# Limits that keep the existing-threads context useful without bloating the
# prompt (and the token bill) on areas with lots of history.
_MAX_THREADS_CONTEXT = 30
_MAX_ENTRIES_PER_THREAD = 4
_ENTRY_SNIPPET_CHARS = 100
_DESC_SNIPPET_CHARS = 160


def _snippet(text: str, limit: int) -> str:
    text = " ".join((text or "").split())
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0] or text[:limit]


def _build_threads_context(db: Session, area_id: int) -> tuple[str, list[str]]:
    """Read the area's existing threads + their recent entries and render an
    AI-readable digest, so the model can file items into the right existing
    thread instead of minting a duplicate.

    Returns (prompt_block, exact_titles). exact_titles is the list the model is
    told to match against verbatim.
    """
    threads = (
        db.query(models.Thread)
        .filter(models.Thread.area_id == area_id)
        .order_by(models.Thread.updated_at.desc())
        .limit(_MAX_THREADS_CONTEXT)
        .all()
    )
    if not threads:
        return "", []

    titles: list[str] = []
    lines: list[str] = []
    for t in threads:
        titles.append(t.title)
        # One-line context: prefer the user's description, fall back to the
        # AI overview/summary, so the model knows what the thread is about.
        context = _snippet(t.description or t.summary or "", _DESC_SNIPPET_CHARS)
        status = (t.status or "open").strip()
        header = f'- "{t.title}" [{status}]'
        if context:
            header += f" - {context}"
        lines.append(header)

        # A few recent top-level entries give the model concrete signal about
        # what already lives in the thread. Entries are ordered oldest-first, so
        # take the tail for the most recent.
        recent = [e for e in t.entries if e.parent_id is None][-_MAX_ENTRIES_PER_THREAD:]
        for e in recent:
            snip = _snippet(e.content, _ENTRY_SNIPPET_CHARS)
            if snip:
                lines.append(f"    - ({e.type}) {snip}")

    block = (
        "\n\nFor reference only, these threads already exist in this area (with "
        "recent items). Reuse one ONLY when an item is unmistakably part of that "
        "same line of work - then set suggested_thread to its EXACT title (match "
        "case and punctuation). If this input is about a different subject from "
        "the threads below, create new threads instead. Do NOT file an item into "
        "an existing thread just because a word or acronym overlaps; the item "
        "must genuinely continue that thread's work:\n" + "\n".join(lines)
    )
    return block, titles


@router.post("/generate/process", response_model=schemas.ProcessResponse)
def generate_process(payload: schemas.ProcessRequest, db: Session = Depends(get_db)):
    provider = get_provider(db)

    max_n = payload.max_items or 8
    max_n = max(1, min(8, max_n))  # keep each pass to a sane wave size

    base_system = f"""You extract structured work items from unstructured text for Effro., a personal log for tracking work across multiple parallel areas of responsibility.

HOW TO WORK:
1. First read the ENTIRE input as one connected piece and understand its overall subject, goal, and the work it describes. Form that understanding before extracting anything.
2. From that understanding, decide a small number of coherent threads that reflect THIS input's own topics. A thread is a strand of related work named for what it is about.
3. Then extract the work items and place each under the thread it genuinely belongs to, based on meaning - not on a single shared keyword.
Derive threads from the content of this text. Do not invent threads, and do not bend items toward a thread they are not really about.

Respond with a JSON array only. No preamble, no explanation, no markdown code fences.
Each item must have exactly these fields:
  type:             "todo" | "entry" | "decision" | "meeting"
  content:          string (clear and actionable; for meetings, the meeting subject/title)
  rationale:        string (one sentence explaining why you extracted this)
  suggested_thread: string (a short thread title this item belongs in; ALWAYS provide one, never null)
  due_date:         string | null (a STRICT ISO date YYYY-MM-DD only; never a relative phrase like "next week" or "Weeks 1-2"; use null if no exact date)
  meeting_at:       string | null (STRICT ISO datetime YYYY-MM-DDTHH:MM, meetings only, else null)
Maximum {max_n} items. Prioritise actionable items over contextual ones.
Group related items under the same suggested_thread, and prefer a few well-scoped threads over many tiny ones."""

    ics_addendum = """

This input is a parsed calendar invite (.ics). The FIRST item you return MUST be of type "meeting":
  - content: the meeting subject
  - meeting_at: the ISO start datetime (YYYY-MM-DDTHH:MM) parsed from the invite
  - suggested_thread: a sensible thread name for this meeting topic
  - rationale: brief note that this came from a calendar invite

Then continue extracting any other actionable items (todos / decisions / context entries) from the agenda or description as normal."""

    # Prefer the rich, DB-sourced context (descriptions + recent entries) when
    # we know the area id; fall back to the title-only list the client sends.
    threads_addendum = ""
    if payload.area_id is not None:
        threads_addendum, _ = _build_threads_context(db, payload.area_id)
    elif payload.existing_threads:
        # De-dupe + cap so we don't bloat the prompt on areas with hundreds of threads.
        seen = set()
        titles = []
        for t in payload.existing_threads:
            t = (t or "").strip()
            if not t or t.lower() in seen:
                continue
            seen.add(t.lower())
            titles.append(t)
            if len(titles) >= 40:
                break
        if titles:
            joined = "\n".join(f"  - {t}" for t in titles)
            threads_addendum = (
                "\n\nThreads that already exist in this area:\n"
                f"{joined}\n\n"
                "For each item, set suggested_thread to one of these EXACT titles "
                "if the item clearly belongs to that thread. Match case and "
                "punctuation exactly. Only invent a new title when none of the "
                "existing threads is a good fit."
            )

    # Continuation: tell the model what earlier waves already produced so this
    # pass returns only genuinely new items (and stops when there's nothing left).
    exclude_addendum = ""
    if payload.exclude:
        already = "\n".join(f"  - {_snippet(c, 140)}" for c in payload.exclude[:24] if (c or "").strip())
        if already:
            exclude_addendum = (
                "\n\nYou ALREADY extracted these items in earlier passes. Do NOT "
                "repeat any of them or restate the same point in different words. "
                "Return only NEW, distinct items not covered below. If nothing "
                "meaningful remains to extract, return an empty array [].\n" + already
            )

    system = (
        base_system
        + (ics_addendum if (payload.source_kind == "ics") else "")
        + threads_addendum
        + exclude_addendum
    )

    try:
        text = provider.complete(
            system=system,
            messages=[{
                "role": "user",
                "content": f"Area: {payload.area_name}\n\nText to process:\n{payload.input_text}",
            }],
            max_tokens=2000,
        )
    except RuntimeError as e:
        raise _provider_error(e)

    try:
        raw = json.loads(text)
        # Some models wrap the list in an object, e.g. {"items": [...]}.
        if isinstance(raw, dict):
            raw = raw.get("items") or raw.get("results") or raw.get("data") or []
        if not isinstance(raw, list):
            raise ValueError("expected a JSON array of items")
        items = [schemas.ProcessedItem(**_normalise_item(it)) for it in raw]
        return schemas.ProcessResponse(items=items)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to parse AI response: {str(e)}")


@router.post("/generate/refine", response_model=schemas.RefineResponse)
def generate_refine(payload: schemas.RefineRequest, db: Session = Depends(get_db)):
    provider = get_provider(db)

    system = """You refine a single work item based on rejection feedback.
Return a JSON object only with fields: type, content, rationale, suggested_thread, due_date.
No preamble, no markdown."""

    try:
        text = provider.complete(
            system=system,
            messages=[{
                "role": "user",
                "content": f"Original item: {json.dumps(payload.item)}\nRejection reason: {payload.rejection_reason}\nArea: {payload.area_name}",
            }],
            max_tokens=500,
        )
    except RuntimeError as e:
        raise _provider_error(e)

    try:
        refined = json.loads(text)
        return schemas.RefineResponse(item=refined)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to parse AI response: {str(e)}")


@router.post("/generate/roundup", response_model=schemas.RoundupResponse)
def generate_roundup(payload: schemas.RoundupRequest, db: Session = Depends(get_db)):
    provider = get_provider(db)

    prompt = f"""You are writing a weekly status update summarising activity across the user's areas of work.
Write in a professional, direct tone suitable for sharing or keeping as a personal record.
Be concise. Use plain prose with no markdown formatting. Use dashes for list items if needed.
Use commas or hyphens for punctuation, never em dashes.

Structure:
1. One short executive paragraph (3-4 sentences) summarising the week across all areas.
2. One line per area. Format: "Area Name - [summary]".
   Non-movers: "Area Name - No activity this week."
   Active areas: include status, tasks opened vs completed, any decisions made, key activity.

Data for the 7 days ending {payload.generated_at}:
{json.dumps(payload.areas, indent=2)}"""

    try:
        text = provider.complete(
            system="",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2500,
        )
    except RuntimeError as e:
        raise _provider_error(e)

    return schemas.RoundupResponse(text=text)
