from datetime import datetime, timezone

from sqlalchemy.orm import Session
import models


def create_reference_entry(db: Session, thread_id: int, ref_kind: str,
                           ref_id: int, name: str, created_at=None):
    """Put a reference card in a thread's timeline.

    A file, a link, a linked thread or a folio landing on a thread is something
    that happened, so it reads as a card in the timeline alongside the entries,
    with its own Notes. The card and the thing it points at share one life.

    `content` is a snapshot of the name at creation. It satisfies the not-null
    constraint and gives activity rows something to show, but the read path
    always resolves the live object, so a rename shows through.

    Best-effort, like the activity log it replaces: a failure here never
    poisons the caller's transaction. Returns the created Entry, or None.
    """
    try:
        entry = models.Entry(
            thread_id=thread_id,
            type="reference",
            ref_kind=ref_kind,
            ref_id=ref_id,
            content=name,
        )
        if created_at is not None:
            entry.created_at = created_at
        db.add(entry)

        # Something landing on a thread is activity, so the thread and its area
        # bubble up the same way they do when an entry is added.
        stamp = datetime.now(timezone.utc)
        thread = db.query(models.Thread).filter(models.Thread.id == thread_id).first()
        if thread:
            thread.updated_at = stamp
            area = db.query(models.Area).filter(models.Area.id == thread.area_id).first()
            if area:
                area.updated_at = stamp

        db.commit()
        db.refresh(entry)
        return entry
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        return None


def delete_reference_entry(db: Session, ref_kind: str, ref_id: int):
    """Remove the card that points at an object being deleted.

    The other half of the shared life. Best-effort for the same reason.
    """
    try:
        db.query(models.Entry).filter(
            models.Entry.type == "reference",
            models.Entry.ref_kind == ref_kind,
            models.Entry.ref_id == ref_id,
        ).delete(synchronize_session=False)
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


def log_audit(
    db: Session,
    entity_type: str,
    entity_id: int,
    area_id: int,
    action: str,
    thread_id: int = None,
    field: str = None,
    old_value: str = None,
    new_value: str = None,
    performed_by: int = None,
):
    """Record an audit row. `performed_by` is the acting user's id (current_user
    .id from the endpoint); left None for system/scheduler actions. Best-effort -
    a failed audit write never poisons the caller's transaction."""
    try:
        record = models.AuditLog(
            entity_type=entity_type,
            entity_id=entity_id,
            area_id=area_id,
            thread_id=thread_id,
            action=action,
            field=field,
            old_value=old_value,
            new_value=new_value,
            user_id=performed_by,
        )
        db.add(record)
        db.commit()
    except Exception:
        # Roll back so a failed audit write doesn't poison the caller's
        # transaction (was causing PendingRollbackError downstream).
        try:
            db.rollback()
        except Exception:
            pass
