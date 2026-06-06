"""
Daily dashboard nudges - gentle, calming usage reminders.

Routes (mounted under /api):
  GET  /nudges/today     - the nudge for today (deterministic daily rotation)
  POST /nudges/generate  - ask the AI to add a few new nudges to the pool

One nudge is surfaced per calendar day. The rotation is deterministic
(ordinal date % pool size) so it's stable across reloads within a day, and
shifts naturally as the AI grows the pool over time.
"""

import json
import logging
import random as _random
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import models
from database import get_db
from ai_provider import get_provider

log = logging.getLogger("effro.nudges")
router = APIRouter(tags=["nudges"])

# Don't let the AI balloon the pool indefinitely.
MAX_NUDGES = 40


@router.get("/nudges/today")
def get_today(db: Session = Depends(get_db)):
    """Return today's nudge. Stable for the whole calendar day."""
    nudges = (
        db.query(models.Nudge)
        .filter(models.Nudge.active == True)  # noqa: E712
        .order_by(models.Nudge.id)
        .all()
    )
    if not nudges:
        return {"text": None}
    idx = date.today().toordinal() % len(nudges)
    chosen = nudges[idx]
    return {"id": chosen.id, "text": chosen.text, "source": chosen.source}


@router.get("/nudges/random")
def get_random(exclude: Optional[int] = None, db: Session = Depends(get_db)):
    """
    Return a random active nudge, optionally excluding one id. Drives the
    "show another" refresh button on the dashboard banner - lets the user
    flick through the pool without waiting for the daily rotation.
    """
    q = db.query(models.Nudge).filter(models.Nudge.active == True)  # noqa: E712
    if exclude is not None:
        q = q.filter(models.Nudge.id != exclude)
    candidates = q.all()
    # If excluding leaves nothing (pool of one), fall back to whatever's there.
    if not candidates:
        only = (
            db.query(models.Nudge)
            .filter(models.Nudge.active == True)  # noqa: E712
            .first()
        )
        if not only:
            return {"text": None}
        return {"id": only.id, "text": only.text, "source": only.source}
    chosen = _random.choice(candidates)
    return {"id": chosen.id, "text": chosen.text, "source": chosen.source}


NUDGE_SYSTEM = """
You write gentle, calming usage reminders for Effro, a personal app for
keeping work organised across multiple areas, threads, and to-dos.

Each reminder nudges the user to keep the app current and lean on it - but
the tone is soft, warm, and unhurried. Never punchy, never demanding, no
exclamation marks, no urgency, no guilt.

Good examples:
- "Before a meeting, a five-minute skim of the related area is often all it takes to feel ready."
- "Little and often beats a big catch-up. A short note today saves a long one later."

Rules:
- Second person, present tense.
- One sentence each, under 20 words.
- Practical: reference real habits (updating areas, skimming threads, capturing
  notes, breaking down tasks, the weekly roundup) without naming UI buttons.
- Calm and reassuring, never instructive or pushy.
- Use commas or hyphens for punctuation, never em dashes.

Return a JSON array of strings only - no preamble, no markdown fences.
""".strip()


@router.post("/nudges/generate")
def generate(db: Session = Depends(get_db)):
    """Ask the AI to add a few fresh nudges. Endpoint wrapper around the
    reusable generator (also called by the scheduler)."""
    return generate_nudges(db)


def generate_nudges(db: Session, count: int = 5) -> dict:
    """
    Ask the configured AI to add `count` fresh nudges to the pool. Fails
    silently (adds nothing) when AI is unconfigured or unreachable - this is
    a nice-to-have, never a blocker. Returns {"added": n}.

    Reused by routers/nudges.py's endpoint and scheduler.py's daily top-up.
    """
    existing = [n.text for n in db.query(models.Nudge).all()]
    if len(existing) >= MAX_NUDGES:
        return {"added": 0, "reason": "pool is full"}

    provider = get_provider(db)
    user_msg = (
        f"Write {count} new reminders in the same spirit. Avoid repeating the "
        "meaning of any of these existing ones:\n"
        + "\n".join(f"- {t}" for t in existing[-20:])
    )
    try:
        text = provider.complete(
            system=NUDGE_SYSTEM,
            messages=[{"role": "user", "content": user_msg}],
            max_tokens=400,
        )
        items = json.loads(_strip_fences(text))
    except Exception as e:
        log.info("nudge generation skipped: %s", e)
        return {"added": 0, "reason": "ai unavailable"}

    seen = {t.strip().lower() for t in existing}
    added = 0
    for raw in items:
        s = (raw or "").strip()
        if not s or s.lower() in seen:
            continue
        db.add(models.Nudge(text=s, source="ai"))
        seen.add(s.lower())
        added += 1
        if len(existing) + added >= MAX_NUDGES:
            break
    if added:
        db.commit()
    return {"added": added}


def _strip_fences(text: str) -> str:
    """Drop ```json fences some providers add despite instructions."""
    t = (text or "").strip()
    if t.startswith("```"):
        lines = t.split("\n")
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        t = "\n".join(lines).strip()
    return t
