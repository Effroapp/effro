from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime, timezone, date

import models
import schemas
from database import get_db
from dependencies import get_current_user
from audit import log_audit

router = APIRouter(tags=["entries"])


@router.post("/threads/{thread_id}/entries", response_model=schemas.EntryOut, status_code=201)
def create_entry(
    thread_id: int, payload: schemas.EntryCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    thread = db.query(models.Thread).filter(models.Thread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    valid_types = {"entry", "todo", "decision", "meeting", "blockage"}
    if payload.type not in valid_types:
        raise HTTPException(status_code=422, detail=f"type must be one of {valid_types}")

    entry = models.Entry(
        thread_id=thread_id,
        content=payload.content,
        type=payload.type,
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
        db.add(models.ActivityEvent(event_type="entry_added", thread_id=thread_id, detail=entry.content[:80]))
        db.commit()
    except Exception:
        pass

    log_audit(db, entity_type='entry', entity_id=entry.id, area_id=thread.area_id,
              thread_id=thread_id, action='created', field=entry.type, new_value=entry.type,
              performed_by=current_user.id)

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

    if payload.content is not None and payload.content != entry.content:
        log_audit(db, entity_type='entry', entity_id=entry.id, area_id=entry_area_id,
                  thread_id=entry.thread_id, action='updated', field='content',
                  old_value=entry.content, new_value=payload.content,
                  performed_by=current_user.id)
        entry.content = payload.content
    elif payload.content is not None:
        entry.content = payload.content

    if payload.type is not None and payload.type != entry.type:
        log_audit(db, entity_type='entry', entity_id=entry.id, area_id=entry_area_id,
                  thread_id=entry.thread_id, action='updated', field='type',
                  old_value=entry.type, new_value=payload.type,
                  performed_by=current_user.id)
        entry.type = payload.type
    elif payload.type is not None:
        entry.type = payload.type

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
def delete_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = db.query(models.Entry).filter(models.Entry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
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
