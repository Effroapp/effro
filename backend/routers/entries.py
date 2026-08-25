from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime, timezone, date
from typing import Optional

import models
import schemas
from database import get_db
from dependencies import get_current_user
from audit import log_audit
from entry_text import (TITLED_TYPES, clean_title, entry_display_title,
                        entry_label, fallback_title)

router = APIRouter(tags=["entries"])

# Types a client may create. 'reference' is stored but not client-creatable,
# so it is deliberately absent.
VALID_TYPES = {"entry", "todo", "decision", "meeting", "blockage", "custom"}


def resolve_title(entry_type: str, content: str, raw_title, raw_source):
    """The (title, title_source) a newly created entry should carry.

    A title is never required to save. When the user leaves it blank the server
    writes the entry's own first line, so every client gets one without having
    to derive it, and an AI suggestion later has something to replace.
    """
    if entry_type not in TITLED_TYPES:
        return None, None
    cleaned = clean_title(raw_title)
    if not cleaned:
        return fallback_title(content), 'fallback'
    # 'ai' is the only source a client may claim. Everything else is the user.
    return cleaned, ('ai' if raw_source == 'ai' else 'user')


def _apply_title_rules(entry, payload, was_type, was_source, content_changed):
    """Settle an entry's title after an update, in a fixed order.

    The load-bearing rule is that a title the user wrote is never overwritten.
    An AI suggestion may only replace a fallback, and a content edit may only
    re-derive a fallback, so someone who has bothered to name an entry keeps
    that name whatever else happens to it.
    """
    now_titled = entry.type in TITLED_TYPES

    # A type change decides first, since it can remove the concept entirely.
    if entry.type != was_type:
        if not now_titled:
            entry.title = None
            entry.title_source = None
            return
        if not entry.title:
            entry.title = fallback_title(entry.content)
            entry.title_source = 'fallback'

    if not now_titled:
        entry.title = None
        entry.title_source = None
        return

    if payload.title is not None:
        cleaned = clean_title(payload.title)
        if payload.title_source == 'ai':
            # Suggestions arrive after the save and lose to a real title.
            if was_source != 'user' and cleaned:
                entry.title = cleaned
                entry.title_source = 'ai'
            return
        if cleaned:
            entry.title = cleaned
            entry.title_source = 'user'
        else:
            # Cleared on purpose, so fall back rather than leaving it blank.
            entry.title = fallback_title(entry.content)
            entry.title_source = 'fallback'
        return

    # No title in the payload. A content edit re-derives anything not written
    # by the user, and the client then re-runs the suggestion pass, so an AI
    # title never goes stale against the text it was written from.
    if content_changed and entry.title_source != 'user':
        entry.title = fallback_title(entry.content)
        entry.title_source = 'fallback'


def resolve_custom_type(db: Session, entry_type: str, custom_type_id):
    """The custom_type_id an entry of this type should carry.

    A custom entry must name a type that exists. Every other type carries none,
    whatever the client sent, so a type change can never leave a stale label
    hanging off an Update.
    """
    if entry_type != "custom":
        return None
    if custom_type_id is None:
        raise HTTPException(
            status_code=422,
            detail="custom_type_id is required when type is custom",
        )
    exists = db.query(models.CustomEntryType).filter(
        models.CustomEntryType.id == custom_type_id).first()
    if not exists:
        raise HTTPException(status_code=422, detail="Unknown custom_type_id")
    return custom_type_id


@router.post("/threads/{thread_id}/entries", response_model=schemas.EntryOut, status_code=201)
def create_entry(
    thread_id: int, payload: schemas.EntryCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    thread = db.query(models.Thread).filter(models.Thread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    if payload.type == 'reference':
        raise HTTPException(
            status_code=422,
            detail="Reference entries are created by attaching things, not directly",
        )
    if payload.type not in VALID_TYPES:
        raise HTTPException(status_code=422, detail=f"type must be one of {VALID_TYPES}")

    custom_type_id = resolve_custom_type(db, payload.type, payload.custom_type_id)
    title, title_source = resolve_title(
        payload.type, payload.content, payload.title, payload.title_source)

    entry = models.Entry(
        thread_id=thread_id,
        content=payload.content,
        type=payload.type,
        custom_type_id=custom_type_id,
        title=title,
        title_source=title_source,
        due_date=payload.due_date,
        meeting_at=payload.meeting_at,
        notes=payload.notes,
    )
    db.add(entry)

    # Bump thread and area updated_at so activity bubbles up
    thread.updated_at = datetime.now(timezone.utc)
    area = db.query(models.Area).filter(models.Area.id == thread.area_id).first()
    if area:
        area.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(entry)

    try:
        db.add(models.ActivityEvent(event_type="entry_added", thread_id=thread_id,
                                    detail=entry_display_title(entry)[:80]))
        db.commit()
    except Exception:
        pass

    # The field stays the stored type; the value carries the label the user
    # actually chose, so an audit trail reads "Risk" rather than "custom".
    log_audit(db, entity_type='entry', entity_id=entry.id, area_id=thread.area_id,
              thread_id=thread_id, action='created', field=entry.type,
              new_value=entry_label(entry), performed_by=current_user.id)

    return entry


@router.put("/entries/{entry_id}", response_model=schemas.EntryOut)
def update_entry(
    entry_id: int, payload: schemas.EntryUpdate, db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    entry = db.query(models.Entry).filter(models.Entry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    # Get area_id for audit logging
    entry_area_id = db.query(models.Thread.area_id).filter(models.Thread.id == entry.thread_id).scalar()

    if entry.type == 'reference':
        # A reference card says what it points at. Its name, type and dates all
        # come from the live object, so the only thing worth writing here is a
        # note about it.
        touched = [f for f in ('content', 'title', 'type', 'completed', 'due_date',
                               'meeting_at')
                   if getattr(payload, f, None) is not None]
        if touched:
            raise HTTPException(
                status_code=400,
                detail="Reference entries can only take notes",
            )

    # Remembered before anything is applied, so the title rules below can tell
    # a content edit from a title edit from a type change.
    was_type = entry.type
    was_title = entry.title
    was_source = entry.title_source
    content_changed = payload.content is not None and payload.content != entry.content

    if payload.content is not None and payload.content != entry.content:
        log_audit(db, entity_type='entry', entity_id=entry.id, area_id=entry_area_id,
                  thread_id=entry.thread_id, action='updated', field='content',
                  old_value=entry.content, new_value=payload.content,
                  performed_by=current_user.id)
        entry.content = payload.content
    elif payload.content is not None:
        entry.content = payload.content

    if payload.type is not None:
        if payload.type not in VALID_TYPES:
            raise HTTPException(status_code=422, detail=f"type must be one of {VALID_TYPES}")
        if payload.type != entry.type:
            log_audit(db, entity_type='entry', entity_id=entry.id, area_id=entry_area_id,
                      thread_id=entry.thread_id, action='updated', field='type',
                      old_value=entry.type, new_value=payload.type,
                      performed_by=current_user.id)
        entry.type = payload.type
        # A type change re-resolves the custom link, so switching away from a
        # custom type clears it and switching to one demands a valid id.
        wanted = payload.custom_type_id if payload.custom_type_id is not None else entry.custom_type_id
        entry.custom_type_id = resolve_custom_type(db, entry.type, wanted)
    elif payload.custom_type_id is not None:
        entry.custom_type_id = resolve_custom_type(db, entry.type, payload.custom_type_id)

    newly_completed = False
    if payload.completed is not None:
        if payload.completed and not entry.completed:
            entry.completed_at = datetime.now(timezone.utc)
            newly_completed = True
            log_audit(db, entity_type='entry', entity_id=entry.id, area_id=entry_area_id,
                      thread_id=entry.thread_id, action='completed',
                      performed_by=current_user.id)
        elif not payload.completed and entry.completed:
            entry.completed_at = None
            log_audit(db, entity_type='entry', entity_id=entry.id, area_id=entry_area_id,
                      thread_id=entry.thread_id, action='uncompleted',
                      performed_by=current_user.id)
        entry.completed = payload.completed

    if payload.due_date is not None and str(payload.due_date) != str(entry.due_date):
        log_audit(db, entity_type='entry', entity_id=entry.id, area_id=entry_area_id,
                  thread_id=entry.thread_id, action='updated', field='due_date',
                  old_value=str(entry.due_date) if entry.due_date else None,
                  new_value=str(payload.due_date),
                  performed_by=current_user.id)
        entry.due_date = payload.due_date
    elif payload.due_date is not None:
        entry.due_date = payload.due_date

    if payload.meeting_at is not None and payload.meeting_at != entry.meeting_at:
        log_audit(db, entity_type='entry', entity_id=entry.id, area_id=entry_area_id,
                  thread_id=entry.thread_id, action='updated', field='meeting_at',
                  old_value=entry.meeting_at.isoformat() if entry.meeting_at else None,
                  new_value=payload.meeting_at.isoformat(),
                  performed_by=current_user.id)
        entry.meeting_at = payload.meeting_at
    elif payload.meeting_at is not None:
        entry.meeting_at = payload.meeting_at

    # notes - distinguish "user cleared notes" (empty string) from "untouched"
    # (None). Audit-log only when the value actually changed.
    if payload.notes is not None and (payload.notes or "") != (entry.notes or ""):
        old_excerpt = (entry.notes or "")[:200]
        new_excerpt = (payload.notes or "")[:200]
        log_audit(db, entity_type='entry', entity_id=entry.id, area_id=entry_area_id,
                  thread_id=entry.thread_id, action='updated', field='notes',
                  old_value=old_excerpt, new_value=new_excerpt,
                  performed_by=current_user.id)
        entry.notes = payload.notes or None

    _apply_title_rules(entry, payload, was_type, was_source, content_changed)
    if (entry.title or None) != (was_title or None):
        log_audit(db, entity_type='entry', entity_id=entry.id, area_id=entry_area_id,
                  thread_id=entry.thread_id, action='updated', field='title',
                  old_value=was_title, new_value=entry.title,
                  performed_by=current_user.id)

    entry.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(entry)

    if newly_completed:
        try:
            db.add(models.ActivityEvent(event_type="todo_completed", thread_id=entry.thread_id, detail=entry.content[:80]))
            db.commit()
        except Exception:
            pass

    return entry


@router.delete("/entries/{entry_id}", status_code=204)
def delete_entry(entry_id: int, db: Session = Depends(get_db),
                 current_user: models.User = Depends(get_current_user)):
    entry = db.query(models.Entry).filter(models.Entry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    # A reference card and the thing it points at share one life, so deleting
    # the card takes the object with it. The exception is a Folio, which is
    # unfiled rather than destroyed: it is a workspace of its own and the user
    # is only saying it does not belong on this thread.
    if entry.type == 'reference':
        _delete_reference_target(db, entry, current_user.id)
        return

    db.delete(entry)
    db.commit()


def _delete_reference_target(db: Session, entry, performed_by: int):
    """Delete a reference card by deleting what it points at."""
    from references import remove_attachment, remove_thread_link  # noqa: PLC0415

    if entry.ref_kind in ('file', 'link'):
        attachment = db.query(models.Attachment).filter(
            models.Attachment.id == entry.ref_id).first()
        if attachment:
            # This removes the card too, so it must not be deleted twice.
            remove_attachment(db, attachment, performed_by=performed_by)
            return

    elif entry.ref_kind == 'thread':
        link = db.query(models.ThreadLink).filter(
            models.ThreadLink.id == entry.ref_id).first()
        if link:
            remove_thread_link(db, link, performed_by=performed_by)
            return

    elif entry.ref_kind == 'folio':
        folio = db.query(models.Folio).filter(
            models.Folio.id == entry.ref_id).first()
        if folio:
            thread_id = folio.thread_id
            folio.thread_id = None
            db.commit()
            log_audit(db, entity_type='folio', entity_id=folio.id, area_id=None,
                      thread_id=thread_id, action='updated', field='thread_id',
                      old_value=str(thread_id), new_value=None,
                      performed_by=performed_by)

    # The object was already gone, or it was a folio, which we keep. Either
    # way the card itself still has to go.
    db.delete(entry)
    db.commit()


@router.get("/todos/upcoming", response_model=list[schemas.UpcomingTodo])
def get_upcoming_todos(limit: int = Query(default=10, le=50), db: Session = Depends(get_db)):
    rows = (
        db.query(models.Entry, models.Thread, models.Area)
        .join(models.Thread, models.Entry.thread_id == models.Thread.id)
        .join(models.Area, models.Thread.area_id == models.Area.id)
        .filter(
            models.Entry.type == "todo",
            models.Entry.completed == False,
        )
        .order_by(
            models.Entry.due_date.asc().nulls_last(),
            models.Entry.created_at.asc(),
        )
        .limit(limit)
        .all()
    )

    return [
        schemas.UpcomingTodo(
            id=entry.id,
            thread_id=thread.id,
            thread_title=thread.title,
            area_id=area.id,
            area_name=area.name,
            content=entry.content,
            due_date=entry.due_date,
        )
        for entry, thread, area in rows
    ]


# ── In Hand (the pinned strip on the dashboard) ───────────────────────────────
# One nullable timestamp on the entry carries the whole feature: membership,
# sort order and the row's age. Completed todos are filtered out of the strip
# rather than unpinned, so unticking one in its thread quietly returns it with
# its age intact.

def _in_hand_query(db: Session):
    """Entries currently showing in the strip, newest pin first."""
    return (
        db.query(models.Entry, models.Thread, models.Area)
        .join(models.Thread, models.Entry.thread_id == models.Thread.id)
        .join(models.Area, models.Thread.area_id == models.Area.id)
        .filter(
            models.Entry.pinned_at.isnot(None),
            # A ticked todo leaves the strip but keeps its pin.
            models.Entry.completed == False,
        )
        .order_by(models.Entry.pinned_at.desc())
    )


@router.get("/pinned", response_model=list[schemas.PinnedEntryOut])
def list_pinned_entries(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Every pinned entry. No cap and no paging - the strip shows them all."""
    return [
        schemas.PinnedEntryOut(
            id=entry.id,
            type=entry.type,
            content=entry.content,
            title=entry.title,
            completed=entry.completed,
            pinned_at=entry.pinned_at,
            thread_id=thread.id,
            thread_name=thread.title,
            area_id=area.id,
            area_name=area.name,
        )
        for entry, thread, area in _in_hand_query(db).all()
    ]


@router.post("/entries/{entry_id}/pin", response_model=schemas.PinToggleOut)
def toggle_entry_pin(
    entry_id: int, payload: Optional[schemas.PinToggle] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Pin or unpin an entry. One endpoint, because the control is one control."""
    entry = db.query(models.Entry).filter(models.Entry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    thread = db.query(models.Thread).filter(models.Thread.id == entry.thread_id).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    pinning = entry.pinned_at is None
    if pinning:
        # Undo passes the stamp the row had, so it comes back with its age and
        # its place in the order rather than as a brand new pin.
        restore = payload.restore_pinned_at if payload else None
        entry.pinned_at = restore or datetime.now(timezone.utc)
    else:
        entry.pinned_at = None
    db.commit()
    db.refresh(entry)

    log_audit(db, entity_type='entry', entity_id=entry.id, area_id=thread.area_id,
              thread_id=entry.thread_id, action='pinned' if pinning else 'unpinned',
              performed_by=current_user.id)

    return schemas.PinToggleOut(
        id=entry.id,
        pinned=pinning,
        pinned_at=entry.pinned_at,
        # The live strip count, which the pin toast reads out.
        count=_in_hand_query(db).count(),
        thread_name=thread.title,
    )
