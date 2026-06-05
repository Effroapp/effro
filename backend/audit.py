from sqlalchemy.orm import Session
import models


def log_activity_entry(db: Session, thread_id: int, content: str):
    """Record a thread activity as a visible timeline Entry (e.g. a file
    attached, a link added, a thread linked). Kept consistent across all of
    those so the timeline always reflects what happened. Best-effort - a
    failure here never poisons the caller's transaction.

    Returns the created Entry, or None on failure.
    """
    try:
        entry = models.Entry(thread_id=thread_id, type="entry", content=content)
        db.add(entry)
        db.commit()
        db.refresh(entry)
        return entry
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        return None


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
):
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
