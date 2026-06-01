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
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import schemas
from database import get_db
from ai_provider import get_provider

router = APIRouter(tags=["generate"])


def _provider_error(e: Exception) -> HTTPException:
    """Turn a provider RuntimeError into HTTP 502 with the readable message."""
    return HTTPException(status_code=502, detail=str(e))


@router.post("/generate/process", response_model=schemas.ProcessResponse)
def generate_process(payload: schemas.ProcessRequest, db: Session = Depends(get_db)):
    provider = get_provider(db)

    base_system = """You extract structured work items from unstructured text for Effro., a personal log for tracking work across multiple parallel areas of responsibility.
Respond with a JSON array only. No preamble, no explanation, no markdown code fences.
Each item must have exactly these fields:
  type:             "todo" | "entry" | "decision" | "meeting"
  content:          string (clear and actionable; for meetings, the meeting subject/title)
  rationale:        string (one sentence explaining why you extracted this)
  suggested_thread: string (a short thread title this item belongs in)
  due_date:         string | null (ISO date YYYY-MM-DD if applicable, else null)
  meeting_at:       string | null (ISO datetime YYYY-MM-DDTHH:MM if known, meetings only, else null)
Maximum 8 items. Prioritise actionable items over contextual ones."""

    ics_addendum = """

This input is a parsed calendar invite (.ics). The FIRST item you return MUST be of type "meeting":
  - content: the meeting subject
  - meeting_at: the ISO start datetime (YYYY-MM-DDTHH:MM) parsed from the invite
  - suggested_thread: a sensible thread name for this meeting topic
  - rationale: brief note that this came from a calendar invite

Then continue extracting any other actionable items (todos / decisions / context entries) from the agenda or description as normal."""

    threads_addendum = ""
    if payload.existing_threads:
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

    system = base_system + (ics_addendum if (payload.source_kind == "ics") else "") + threads_addendum

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
        items = json.loads(text)
        return schemas.ProcessResponse(items=[schemas.ProcessedItem(**item) for item in items])
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
