"""What an AI prompt is allowed to know about the user's work.

Every grounded AI feature - the area overview, the thread summary, the nightly
refresh and the weekly roundup - reads its material through this module. That is
the point of it. Before this existed each generator ran its own query, so a new
entry type or a new kind of content reached whichever prompt someone remembered
to update. Reference cards landed and immediately starved the area overview,
because three attached files are three of the most recent entries and the
summariser had no idea it should skip them. The weekly roundup counted to-dos
and listed decisions and nothing else, so a user's own Risk type, and every
Blocked item, was invisible in the one place meant to tell them how the week
went.

The rule that follows from that: **a prompt never queries entries directly.**
It calls one of these functions, and anything added to the app arrives in every
prompt at once. See the AI grounding section in CLAUDE.md, and
tests/test_ai_context.py, which fails when a new entry type is not accounted
for here.
"""
from collections import Counter
from datetime import datetime

from sqlalchemy.orm import Session

import models
from entry_text import REF_LABELS, entry_label, entry_prompt_line

# References are cards pointing at a file, a link, a thread or a folio. They are
# real activity and a summary should know they happened, but their content is a
# filename, so they crowd a prose summary out of its own budget. They are
# tallied rather than quoted.
PROSE_EXCLUDED_TYPES = ("reference",)

# How many of the week's entries the roundup quotes per area. Enough to
# characterise a week, short enough that ten areas still fit one prompt.
ROUNDUP_HIGHLIGHTS = 12

# How much of one entry a roundup highlight is worth.
ROUNDUP_SNIPPET_CHARS = 200


def recent_entries_for_prompt(
    db: Session,
    thread_ids: list[int],
    limit: int,
    *,
    top_level_only: bool = True,
) -> list[models.Entry]:
    """The most recent entries worth prompting on, newest first.

    References are left out. Subtasks are left out by default, because a
    summary wants the task, not its breakdown.
    """
    if not thread_ids:
        return []
    query = (
        db.query(models.Entry)
        .filter(
            models.Entry.thread_id.in_(thread_ids),
            models.Entry.type.notin_(PROSE_EXCLUDED_TYPES),
        )
    )
    if top_level_only:
        query = query.filter(models.Entry.parent_id.is_(None))
    return query.order_by(models.Entry.created_at.desc()).limit(limit).all()


def reference_tally(
    db: Session,
    thread_ids: list[int],
    since: datetime | None = None,
) -> dict[str, int]:
    """What was attached, linked or filed, as counts by kind.

    A summary that says "three files were attached" is accurate and costs one
    line. Quoting three filenames costs the budget and says less.
    """
    if not thread_ids:
        return {}
    query = db.query(models.Entry.ref_kind).filter(
        models.Entry.thread_id.in_(thread_ids),
        models.Entry.type == "reference",
    )
    if since is not None:
        query = query.filter(models.Entry.created_at >= since)
    counts = Counter(row.ref_kind for row in query.all() if row.ref_kind)
    return {REF_LABELS.get(kind, kind): n for kind, n in sorted(counts.items())}


def reference_line(tally: dict[str, int]) -> str:
    """A reference tally as one readable line, or empty when there is nothing."""
    if not tally:
        return ""
    return ", ".join(f"{label} x{n}" for label, n in tally.items())


def entries_logged(db: Session, thread_ids: list[int], since: datetime) -> dict[str, int]:
    """Everything written in the window, counted by its human label.

    Keyed by label rather than by the stored type, so a user's own type appears
    under its own name and a type added to the app appears here the day it
    exists, with nothing to remember.

    References are left to reference_tally rather than counted here as well.
    Both would be the same numbers under the same names, and a model reading
    "File attached: 1" in a list of things the user wrote would reasonably
    report it as something they wrote.
    """
    if not thread_ids:
        return {}
    rows = (
        db.query(models.Entry)
        .filter(
            models.Entry.thread_id.in_(thread_ids),
            models.Entry.parent_id.is_(None),
            models.Entry.created_at >= since,
            models.Entry.type.notin_(PROSE_EXCLUDED_TYPES),
        )
        .all()
    )
    counts = Counter(entry_label(e) for e in rows)
    return dict(sorted(counts.items()))


def week_highlights(
    db: Session,
    thread_ids: list[int],
    since: datetime,
    limit: int = ROUNDUP_HIGHLIGHTS,
) -> list[str]:
    """The week's entries that carry meaning, newest first, already labelled.

    To-dos are left out because the roundup counts them opened and completed,
    and a week of to-dos would be the whole list. Everything else is in:
    decisions, blocked items, meetings, updates and any type the user has made
    for themselves.
    """
    if not thread_ids:
        return []
    rows = (
        db.query(models.Entry)
        .filter(
            models.Entry.thread_id.in_(thread_ids),
            models.Entry.parent_id.is_(None),
            models.Entry.created_at >= since,
            models.Entry.type.notin_(PROSE_EXCLUDED_TYPES + ("todo",)),
        )
        .order_by(models.Entry.created_at.desc())
        .limit(limit)
        .all()
    )
    return [entry_prompt_line(e, ROUNDUP_SNIPPET_CHARS) for e in rows]


def in_hand(db: Session, thread_ids: list[int], limit: int = 8) -> list[str]:
    """What the user has pinned right now, newest pin first.

    Nothing else in the data says which of a hundred open items the person
    actually considers live, so a roundup written without it is guessing.
    """
    if not thread_ids:
        return []
    rows = (
        db.query(models.Entry)
        .filter(
            models.Entry.thread_id.in_(thread_ids),
            models.Entry.pinned_at.isnot(None),
        )
        .order_by(models.Entry.pinned_at.desc())
        .limit(limit)
        .all()
    )
    return [entry_prompt_line(e, ROUNDUP_SNIPPET_CHARS) for e in rows]
