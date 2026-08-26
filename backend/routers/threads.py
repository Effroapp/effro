from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timezone

import models
import schemas
from database import get_db
from entry_text import entry_prompt_line
from ai_context import recent_entries_for_prompt, reference_line, reference_tally
from dependencies import get_current_user
from audit import log_audit, delete_reference_entry
from references import (add_thread_link as create_thread_link,
                        remove_thread_link)

router = APIRouter(tags=["threads"])


def _compute_thread_summary_meta(thread: models.Thread, db: Session) -> tuple[bool, int]:
    """Mirror of the area version: stale if entries arrived after the summary
    was generated. (False, 0) when there's no summary baseline yet."""
    if not thread.summary_updated_at:
        return False, 0
    new_count = (
        db.query(func.count(models.Entry.id))
        .filter(
            models.Entry.thread_id == thread.id,
            models.Entry.created_at > thread.summary_updated_at,
        )
        .scalar()
    ) or 0
    return (new_count > 0), new_count


def _resolve_references(db: Session, entries) -> dict:
    """Look up what every reference card on this thread points at.

    One query per kind, never one per card. Returns {entry_id: ReferenceOut},
    leaving out any whose object has gone so the card can render its gone state
    from the snapshot name it kept.
    """
    wanted = {'file': {}, 'link': {}, 'thread': {}, 'folio': {}}
    for e in entries:
        if e.type == 'reference' and e.ref_kind in wanted and e.ref_id:
            wanted[e.ref_kind].setdefault(e.ref_id, []).append(e.id)

    out = {}

    attachment_ids = set(wanted['file']) | set(wanted['link'])
    if attachment_ids:
        for a in db.query(models.Attachment).filter(
                models.Attachment.id.in_(attachment_ids)).all():
            kind = 'link' if a.type == 'link' else 'file'
            for entry_id in wanted[kind].get(a.id, []):
                out[entry_id] = schemas.ReferenceOut(
                    kind=kind, id=a.id, name=a.name, url=a.url, size=a.size,
                    stored_name=a.stored_name, sync_status=a.sync_status,
                )

    if wanted['thread']:
        rows = (
            db.query(models.ThreadLink, models.Thread, models.Area)
            .join(models.Thread, models.ThreadLink.to_thread_id == models.Thread.id)
            .join(models.Area, models.Thread.area_id == models.Area.id)
            .filter(models.ThreadLink.id.in_(wanted['thread'].keys()))
            .all()
        )
        for link, to_thread, area in rows:
            for entry_id in wanted['thread'].get(link.id, []):
                out[entry_id] = schemas.ReferenceOut(
                    kind='thread', id=link.id, name=to_thread.title,
                    thread_id=to_thread.id, thread_title=to_thread.title,
                    thread_status=to_thread.status, area_name=area.name,
                    link_kind=link.kind,
                )

    if wanted['folio']:
        for f in db.query(models.Folio).filter(
                models.Folio.id.in_(wanted['folio'].keys())).all():
            name = f.title or 'Untitled folio'
            for entry_id in wanted['folio'].get(f.id, []):
                out[entry_id] = schemas.ReferenceOut(
                    kind='folio', id=f.id, name=name, folio_id=f.id,
                    folio_title=name, capture_count=len(f.captures or []),
                )

    return out


def _entries_out(thread: models.Thread, db: Session) -> list:
    """The thread's top-level entries, with reference cards resolved."""
    tops = [e for e in thread.entries if e.parent_id is None]
    resolved = _resolve_references(db, tops)
    out = []
    for e in tops:
        row = schemas.EntryOut.model_validate(e)
        if e.type == 'reference':
            row.reference = resolved.get(e.id)
        out.append(row)
    return out


def _thread_detail(thread: models.Thread, db: Session) -> schemas.ThreadDetail:
    """Build the full ThreadDetail: links, entries, and summary freshness."""
    outgoing = db.query(models.ThreadLink).filter(models.ThreadLink.from_thread_id == thread.id).all()
    incoming = db.query(models.ThreadLink).filter(models.ThreadLink.to_thread_id == thread.id).all()
    out_refs = [r for r in (_linked_ref(db, l, l.to_thread_id) for l in outgoing) if r is not None]
    in_refs  = [r for r in (_linked_ref(db, l, l.from_thread_id) for l in incoming) if r is not None]
    stale, new_count = _compute_thread_summary_meta(thread, db)
    return schemas.ThreadDetail(
        id=thread.id,
        area_id=thread.area_id,
        title=thread.title,
        status=thread.status,
        description=thread.description or "",
        summary=thread.summary or "",
        group_id=thread.group_id,
        created_at=thread.created_at,
        updated_at=thread.updated_at,
        entries=_entries_out(thread, db),
        attachments=[schemas.AttachmentOut.model_validate(a) for a in thread.attachments],
        outgoing_links=out_refs,
        incoming_links=in_refs,
        summary_updated_at=thread.summary_updated_at,
        summary_auto_generated=bool(thread.summary_auto_generated),
        summary_auto_update=bool(thread.summary_auto_update),
        summary_stale=stale,
        summary_new_count=new_count,
    )


@router.get("/threads/all", response_model=list[schemas.AllThreadSummary])
def list_all_threads(db: Session = Depends(get_db)):
    rows = (
        db.query(models.Thread, models.Area.name)
        .join(models.Area, models.Thread.area_id == models.Area.id)
        .order_by(models.Thread.updated_at.desc())
        .all()
    )
    return [
        schemas.AllThreadSummary(
            id=t.id,
            area_id=t.area_id,
            area_name=area_name,
            title=t.title,
            status=t.status,
            updated_at=t.updated_at,
        )
        for t, area_name in rows
    ]


def _linked_ref(db: Session, link: models.ThreadLink, other_thread_id: int):
    row = (
        db.query(models.Thread, models.Area.name)
        .join(models.Area, models.Thread.area_id == models.Area.id)
        .filter(models.Thread.id == other_thread_id)
        .first()
    )
    if not row:
        return None
    other, area_name = row
    return schemas.LinkedThreadRef(
        link_id=link.id,
        thread_id=other.id,
        thread_title=other.title,
        thread_status=other.status,
        area_id=other.area_id,
        area_name=area_name,
        kind=link.kind,
    )


@router.get("/threads/{thread_id}", response_model=schemas.ThreadDetail)
def get_thread(thread_id: int, db: Session = Depends(get_db)):
    thread = db.query(models.Thread).filter(models.Thread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    # Only top-level entries - subtasks (parent_id set) are nested under their
    # parent todo, so excluding them here keeps them from rendering twice.
    return _thread_detail(thread, db)


@router.post("/threads/auto-update-all", status_code=200)
def set_thread_auto_update_all(payload: schemas.ThreadUpdate, db: Session = Depends(get_db)):
    """Turn summary auto-update on/off for EVERY thread at once."""
    enabled = bool(payload.auto_update)
    db.query(models.Thread).update(
        {models.Thread.summary_auto_update: enabled},
        synchronize_session=False,
    )
    db.commit()
    return {"updated": True, "enabled": enabled}


@router.post("/threads/{thread_id}/summary/suggest", response_model=schemas.SummarySuggestion)
def suggest_thread_summary(thread_id: int, db: Session = Depends(get_db)):
    thread = db.query(models.Thread).filter(models.Thread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    # Through ai_context, so a run of attached files cannot push the
    # thread's actual work out of its own summary.
    recent_entries = recent_entries_for_prompt(db, [thread.id], 15)
    entry_lines = "\n".join(
        entry_prompt_line(e, 200) for e in recent_entries
    ) or "(no entries yet)"
    refs = reference_line(reference_tally(db, [thread.id]))
    if refs:
        entry_lines += f"\nAttached: {refs}"

    system = (
        "You write a concise status summary for a single thread of work.\n"
        "Output exactly 2 sentences. No preamble, no formatting, no bullet points.\n"
        "Sentence 1: the current state - what's happening, what's in motion.\n"
        "Sentence 2: what's next or blocking - risks, pending decisions, what to watch.\n"
        "Tone: direct, factual, suitable for a status board. Avoid filler like 'currently' or 'we are', and do not open with \"Overall\", \"It's worth noting\", \"Additionally\" or \"In summary\".\n"
        "Use commas or hyphens for punctuation, never em dashes."
    )
    user_msg = (
        f"Thread: {thread.title}\n"
        f"Current status: {thread.status}\n"
        f"Description: {thread.description or '(none)'}\n"
        f"Existing summary: {thread.summary or '(none)'}\n\n"
        f"Recent activity:\n{entry_lines}"
    )

    from ai_provider import get_provider
    provider = get_provider(db)
    try:
        text = provider.complete(
            system=system,
            messages=[{"role": "user", "content": user_msg}],
            max_tokens=300,
        )
        return schemas.SummarySuggestion(summary=text.strip())
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/threads/{thread_id}/links", response_model=schemas.LinkedThreadRef, status_code=201)
def add_thread_link(thread_id: int, payload: schemas.ThreadLinkCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    if payload.to_thread_id == thread_id:
        raise HTTPException(status_code=422, detail="Cannot link a thread to itself")

    valid_kinds = {"blocks", "relates_to"}
    if payload.kind not in valid_kinds:
        raise HTTPException(status_code=422, detail=f"kind must be one of {valid_kinds}")

    from_thread = db.query(models.Thread).filter(models.Thread.id == thread_id).first()
    to_thread = db.query(models.Thread).filter(models.Thread.id == payload.to_thread_id).first()
    if not from_thread or not to_thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    existing = (
        db.query(models.ThreadLink)
        .filter(
            models.ThreadLink.from_thread_id == thread_id,
            models.ThreadLink.to_thread_id == payload.to_thread_id,
            models.ThreadLink.kind == payload.kind,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Link already exists")

    link = create_thread_link(db, thread_id, payload.to_thread_id, payload.kind,
                              to_thread.title)

    log_audit(
        db, entity_type="thread_link", entity_id=link.id,
        area_id=from_thread.area_id, thread_id=thread_id,
        action="created", field=payload.kind, new_value=to_thread.title,
        performed_by=current_user.id,
    )
    db.commit()

    return _linked_ref(db, link, link.to_thread_id)


@router.delete("/links/{link_id}", status_code=204)
def delete_thread_link(link_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    link = db.query(models.ThreadLink).filter(models.ThreadLink.id == link_id).first()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")

    # The card and the link share one life, so the panel's remove and deleting
    # the card do exactly the same work.
    remove_thread_link(db, link, performed_by=current_user.id)


@router.put("/threads/{thread_id}", response_model=schemas.ThreadDetail)
def update_thread(
    thread_id: int, payload: schemas.ThreadUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)
):
    thread = db.query(models.Thread).filter(models.Thread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    if payload.title is not None and payload.title != thread.title:
        log_audit(db, entity_type='thread', entity_id=thread.id, area_id=thread.area_id,
                  thread_id=thread.id, action='updated', field='title', old_value=thread.title, new_value=payload.title,
                  performed_by=current_user.id)
        thread.title = payload.title
    elif payload.title is not None:
        thread.title = payload.title

    if payload.description is not None and payload.description != thread.description:
        log_audit(db, entity_type='thread', entity_id=thread.id, area_id=thread.area_id,
                  thread_id=thread.id, action='updated', field='description', old_value=thread.description or '', new_value=payload.description,
                  performed_by=current_user.id)
        thread.description = payload.description
    elif payload.description is not None:
        thread.description = payload.description

    if payload.status is not None:
        valid = {"open", "in-progress", "resolved", "parked", "blocked"}
        if payload.status not in valid:
            raise HTTPException(status_code=422, detail=f"status must be one of {valid}")
        if payload.status != thread.status:
            log_audit(db, entity_type='thread', entity_id=thread.id, area_id=thread.area_id,
                      thread_id=thread.id, action='updated', field='status', old_value=thread.status, new_value=payload.status,
                      performed_by=current_user.id)
            db.add(models.ActivityEvent(event_type="status_changed", thread_id=thread.id, detail=f"→ {payload.status}"))
        thread.status = payload.status

    if payload.summary is not None and payload.summary != thread.summary:
        log_audit(db, entity_type='thread', entity_id=thread.id, area_id=thread.area_id,
                  thread_id=thread.id, action='updated', field='summary',
                  old_value=(thread.summary or '')[:200], new_value=payload.summary[:200],
                  performed_by=current_user.id)
        thread.summary = payload.summary
        thread.summary_updated_at = datetime.utcnow()  # naive UTC for staleness comparison
        thread.summary_auto_generated = False
    elif payload.summary is not None:
        thread.summary = payload.summary

    if payload.auto_update is not None:
        thread.summary_auto_update = bool(payload.auto_update)

    thread.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(thread)
    return _thread_detail(thread, db)


@router.put("/threads/{thread_id}/group", response_model=schemas.ThreadDetail)
def set_thread_group(thread_id: int, payload: schemas.ThreadGroupAssign, db: Session = Depends(get_db)):
    """File a thread into a custom group, or clear its group with group_id=null.
    The group must belong to the same area as the thread."""
    thread = db.query(models.Thread).filter(models.Thread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    if payload.group_id is not None:
        group = db.query(models.ThreadGroup).filter(models.ThreadGroup.id == payload.group_id).first()
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        if group.area_id != thread.area_id:
            raise HTTPException(status_code=422, detail="Group belongs to a different area")

    thread.group_id = payload.group_id
    thread.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(thread)
    return _thread_detail(thread, db)


@router.get("/threads/{thread_id}/audit", response_model=list[schemas.AuditLogEntry])
def get_thread_audit(thread_id: int, db: Session = Depends(get_db)):
    thread = db.query(models.Thread).filter(models.Thread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    return (
        db.query(models.AuditLog)
        .filter(models.AuditLog.thread_id == thread_id)
        .order_by(models.AuditLog.occurred_at.desc())
        .all()
    )


@router.delete("/threads/{thread_id}", status_code=204)
def delete_thread(thread_id: int, db: Session = Depends(get_db)):
    thread = db.query(models.Thread).filter(models.Thread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    # Other threads link to this one, and their cards live in their own
    # timelines. The cascade takes the link rows but knows nothing about the
    # cards, so clear those first or they are left pointing at nothing.
    inbound = db.query(models.ThreadLink).filter(
        models.ThreadLink.to_thread_id == thread_id).all()
    for link in inbound:
        delete_reference_entry(db, 'thread', link.id)

    db.delete(thread)
    db.commit()
