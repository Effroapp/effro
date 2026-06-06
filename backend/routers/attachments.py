import os
import uuid
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from audit import log_audit, log_activity_entry

router = APIRouter(tags=["attachments"])

UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "./data/uploads")
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


def _ensure_upload_dir():
    os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.post(
    "/threads/{thread_id}/attachments/file",
    response_model=schemas.AttachmentOut,
    status_code=201,
)
async def upload_file(
    thread_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    thread = db.query(models.Thread).filter(models.Thread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    _ensure_upload_dir()

    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File exceeds 50 MB limit")

    # Generate a unique stored filename to avoid collisions
    ext = os.path.splitext(file.filename or "file")[1]
    stored_name = f"{uuid.uuid4().hex}{ext}"
    dest = os.path.join(UPLOAD_DIR, stored_name)

    with open(dest, "wb") as f:
        f.write(contents)

    attachment = models.Attachment(
        thread_id=thread_id,
        type="file",
        name=file.filename or stored_name,
        stored_name=stored_name,
        original_name=file.filename,
        size=len(contents),
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)

    try:
        db.add(models.ActivityEvent(event_type="file_uploaded", thread_id=thread_id, detail=(attachment.original_name or "")[:80]))
        db.commit()
    except Exception:
        pass

    log_audit(db, entity_type='attachment', entity_id=attachment.id, area_id=thread.area_id,
              thread_id=thread_id, action='created', field='file',
              new_value=attachment.original_name or attachment.name)

    # Log the activity on the timeline so it reads as something that happened.
    log_activity_entry(db, thread_id, f"Attached a file: **{attachment.name}**")

    # Queue background upload to the configured remote backend. The local
    # write has already succeeded - this is best-effort sync that won't block
    # the response. If no cloud is configured the task is a no-op.
    background_tasks.add_task(
        _upload_to_remote,
        attachment_id=attachment.id,
        local_path=dest,
        stored_name=stored_name,
    )

    return attachment


def _upload_to_remote(attachment_id: int, local_path: str, stored_name: str) -> None:
    """
    Upload a locally-saved attachment to the configured cloud backend.

    Runs AFTER the HTTP response has been sent - failures are logged but
    never affect the user. Creates its own DB session because the request's
    session was closed when FastAPI sent the response (P2 in the storage
    prompt's pitfalls list).
    """
    from database import SessionLocal
    from storage_backend import get_storage_backend
    db = SessionLocal()
    try:
        backend = get_storage_backend(db)
        if backend.provider_name == "local":
            return  # No cloud configured - local-only is the desired state.
        with open(local_path, "rb") as f:
            data = f.read()
        remote_path = backend.upload_bytes(data, f"attachments/{stored_name}")
        att = (
            db.query(models.Attachment)
            .filter(models.Attachment.id == attachment_id)
            .first()
        )
        if att:
            att.remote_path = remote_path
            att.sync_status = "synced"
            db.commit()
    except Exception as e:
        import logging
        logging.getLogger("effro.storage").warning(
            "Remote upload failed for attachment %d: %s", attachment_id, e
        )
        try:
            att = (
                db.query(models.Attachment)
                .filter(models.Attachment.id == attachment_id)
                .first()
            )
            if att:
                att.sync_status = "failed"
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


@router.post(
    "/threads/{thread_id}/attachments/link",
    response_model=schemas.AttachmentOut,
    status_code=201,
)
def add_link(
    thread_id: int,
    payload: schemas.LinkCreate,
    db: Session = Depends(get_db),
):
    thread = db.query(models.Thread).filter(models.Thread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    attachment = models.Attachment(
        thread_id=thread_id,
        type="link",
        name=payload.name,
        url=payload.url,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)

    try:
        db.add(models.ActivityEvent(event_type="link_added", thread_id=thread_id, detail=attachment.name[:80]))
        db.commit()
    except Exception:
        pass

    log_audit(db, entity_type='attachment', entity_id=attachment.id, area_id=thread.area_id,
              thread_id=thread_id, action='created', field='link', new_value=attachment.name)

    link_md = f"[**{attachment.name}**]({attachment.url})" if attachment.url else f"**{attachment.name}**"
    log_activity_entry(db, thread_id, f"Added a link: {link_md}")

    return attachment


@router.delete("/attachments/{attachment_id}", status_code=204)
def delete_attachment(attachment_id: int, db: Session = Depends(get_db)):
    attachment = (
        db.query(models.Attachment)
        .filter(models.Attachment.id == attachment_id)
        .first()
    )
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    # Save data for audit log before deletion
    thread_id = attachment.thread_id
    att_type = attachment.type
    att_name = attachment.name
    area_id = db.query(models.Thread.area_id).filter(models.Thread.id == thread_id).scalar()

    # Delete physical file if applicable
    if attachment.type == "file" and attachment.stored_name:
        path = os.path.join(UPLOAD_DIR, attachment.stored_name)
        if os.path.exists(path):
            os.remove(path)

    db.delete(attachment)
    db.commit()

    log_audit(db, entity_type='attachment', entity_id=attachment_id, area_id=area_id,
              thread_id=thread_id, action='deleted', field=att_type, old_value=att_name)
