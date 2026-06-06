"""
Subtask router - nested to-dos under a parent to-do.

Subtasks are stored as Entry rows of type 'todo' with parent_id pointing at
the parent to-do. Completion reuses the existing `completed` boolean +
`completed_at` timestamp (no separate status string).

Routes (mounted under /api in main.py):
  POST   /entries/{entry_id}/subtasks         - bulk-create from approved breakdown
  GET    /entries/{entry_id}/subtasks         - list a to-do's subtasks
  PATCH  /entries/{entry_id}/subtasks/reorder - update sibling ordering
  PATCH  /subtasks/{subtask_id}/complete      - toggle completion
  DELETE /subtasks/{subtask_id}               - remove a subtask
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db

log = logging.getLogger("effro.subtasks")
router = APIRouter(tags=["subtasks"])


@router.post("/entries/{entry_id}/subtasks")
def create_subtasks(
    entry_id: int,
    body: schemas.SubtaskBulkCreate,
    db: Session = Depends(get_db),
):
    """Bulk-create subtasks under a parent to-do (the decomposition approve path)."""
    parent = db.query(models.Entry).filter(models.Entry.id == entry_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent entry not found")
    if parent.type != "todo":
        raise HTTPException(status_code=400, detail="Only to-do entries can have subtasks")

    created = []
    for i, s in enumerate(body.subtasks):
        subtask = models.Entry(
            thread_id=parent.thread_id,
            type="todo",
            content=s.title,
            completed=False,
            parent_id=entry_id,
            time_estimate_minutes=s.time_estimate_minutes,
            subtask_order=s.subtask_order if s.subtask_order is not None else i,
        )
        db.add(subtask)
        created.append(subtask)

    # Approving a breakdown counts as resolving the decomposition prompt -
    # mark dismissed so the "Break this down" affordance doesn't reappear.
    parent.decomp_dismissed = True
    db.commit()
    for s in created:
        db.refresh(s)

    return {"subtasks": [schemas.EntryOut.model_validate(s).model_dump() for s in created]}


@router.get("/entries/{entry_id}/subtasks")
def get_subtasks(entry_id: int, db: Session = Depends(get_db)):
    """Return all subtasks for a given parent to-do, in order."""
    parent = db.query(models.Entry).filter(models.Entry.id == entry_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Entry not found")

    subtasks = (
        db.query(models.Entry)
        .filter(models.Entry.parent_id == entry_id)
        .order_by(models.Entry.subtask_order)
        .all()
    )
    return {"subtasks": [schemas.EntryOut.model_validate(s).model_dump() for s in subtasks]}


@router.patch("/entries/{entry_id}/subtasks/reorder")
def reorder_subtasks(
    entry_id: int,
    body: schemas.ReorderRequest,
    db: Session = Depends(get_db),
):
    """Update subtask display ordering."""
    for item in body.order:
        subtask = (
            db.query(models.Entry)
            .filter(
                models.Entry.id == item.subtask_id,
                models.Entry.parent_id == entry_id,
            )
            .first()
        )
        if subtask:
            subtask.subtask_order = item.subtask_order
    db.commit()
    return {"ok": True}


@router.patch("/subtasks/{subtask_id}/complete")
def toggle_subtask_complete(subtask_id: int, db: Session = Depends(get_db)):
    """Toggle a subtask between complete and open. Maintains completed_at."""
    subtask = (
        db.query(models.Entry)
        .filter(
            models.Entry.id == subtask_id,
            models.Entry.parent_id.isnot(None),
        )
        .first()
    )
    if not subtask:
        raise HTTPException(status_code=404, detail="Subtask not found")

    subtask.completed = not subtask.completed
    subtask.completed_at = datetime.now(timezone.utc) if subtask.completed else None
    db.commit()
    db.refresh(subtask)
    return schemas.EntryOut.model_validate(subtask).model_dump()


@router.delete("/subtasks/{subtask_id}")
def delete_subtask(subtask_id: int, db: Session = Depends(get_db)):
    """Remove a subtask. Leaves the parent to-do untouched."""
    subtask = (
        db.query(models.Entry)
        .filter(
            models.Entry.id == subtask_id,
            models.Entry.parent_id.isnot(None),
        )
        .first()
    )
    if not subtask:
        raise HTTPException(status_code=404, detail="Subtask not found")
    db.delete(subtask)
    db.commit()
    return {"ok": True}
