import re
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timezone, timedelta

import models
import schemas
from database import get_db
from audit import log_audit

router = APIRouter(tags=["areas"])


def _slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "area"


def _unique_slug(db: Session, base: str) -> str:
    slug = base
    suffix = 2
    while db.query(models.Area).filter(models.Area.slug == slug).first():
        slug = f"{base}-{suffix}"
        suffix += 1
    return slug


def _compute_summary_meta(area: models.Area, db: Session) -> tuple[bool, int]:
    """
    Is the summary out of sync with the area's activity, and by how much?

    Stale = there's an entry created, or a thread touched, AFTER the summary
    was last generated. `new_count` is the number of entries newer than the
    summary. Returns (False, 0) when the summary has never been generated
    (no baseline to compare against — we don't cry wolf on legacy summaries).
    """
    if not area.summary_updated_at:
        return False, 0
    new_count = (
        db.query(func.count(models.Entry.id))
        .join(models.Thread, models.Entry.thread_id == models.Thread.id)
        .filter(
            models.Thread.area_id == area.id,
            models.Entry.created_at > area.summary_updated_at,
        )
        .scalar()
    ) or 0
    newer_thread = (
        db.query(models.Thread.id)
        .filter(
            models.Thread.area_id == area.id,
            models.Thread.updated_at > area.summary_updated_at,
        )
        .first()
    )
    return (new_count > 0 or newer_thread is not None), new_count


def _summary_meta_fields(area: models.Area, db: Session) -> dict:
    stale, new_count = _compute_summary_meta(area, db)
    return dict(
        summary_updated_at=area.summary_updated_at,
        summary_auto_generated=bool(area.summary_auto_generated),
        summary_auto_update=bool(area.summary_auto_update),
        summary_stale=stale,
        summary_new_count=new_count,
    )


def _area_detail(area: models.Area, db: Session) -> schemas.AreaDetail:
    return schemas.AreaDetail(
        id=area.id, name=area.name, slug=area.slug, status=area.status,
        summary=area.summary or "", icon=area.icon,
        created_at=area.created_at, updated_at=area.updated_at,
        **_summary_meta_fields(area, db),
    )


def _area_summary(area: models.Area, db: Session) -> schemas.AreaSummary:
    """Build an AreaSummary including computed thread counts."""
    thread_count = (
        db.query(func.count(models.Thread.id))
        .filter(models.Thread.area_id == area.id)
        .scalar()
    )
    open_count = (
        db.query(func.count(models.Thread.id))
        .filter(
            models.Thread.area_id == area.id,
            models.Thread.status.in_(["open", "in-progress"]),
        )
        .scalar()
    )
    return schemas.AreaSummary(
        id=area.id,
        name=area.name,
        slug=area.slug,
        status=area.status,
        summary=area.summary or "",
        icon=area.icon,
        created_at=area.created_at,
        updated_at=area.updated_at,
        thread_count=thread_count,
        open_thread_count=open_count,
        **_summary_meta_fields(area, db),
    )


@router.get("/areas", response_model=list[schemas.AreaSummary])
def list_areas(db: Session = Depends(get_db)):
    areas = db.query(models.Area).order_by(models.Area.id).all()
    return [_area_summary(a, db) for a in areas]


@router.post("/areas", response_model=schemas.AreaSummary, status_code=201)
def create_area(payload: schemas.AreaCreate, db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name is required")

    base_slug = _slugify(name)
    slug = _unique_slug(db, base_slug)

    area = models.Area(
        name=name,
        slug=slug,
        status="stable",
        summary=(payload.summary or "").strip(),
        icon=(payload.icon or None),
    )
    db.add(area)
    db.commit()
    db.refresh(area)

    log_audit(
        db, entity_type="area", entity_id=area.id, area_id=area.id,
        action="created", field=None, old_value=None, new_value=name,
    )
    db.commit()

    return _area_summary(area, db)


@router.get("/areas/{area_id}", response_model=schemas.AreaDetail)
def get_area(area_id: int, db: Session = Depends(get_db)):
    area = db.query(models.Area).filter(models.Area.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Area not found")
    return _area_detail(area, db)


@router.post("/areas/auto-update-all", status_code=200)
def set_auto_update_all(payload: schemas.AreaUpdate, db: Session = Depends(get_db)):
    """Turn the per-area summary auto-update on/off for EVERY area at once.
    Used by the 'apply to all areas' choice on the Overview card."""
    enabled = bool(payload.auto_update)
    db.query(models.Area).update(
        {models.Area.summary_auto_update: enabled},
        synchronize_session=False,
    )
    db.commit()
    return {"updated": True, "enabled": enabled}


@router.put("/areas/{area_id}", response_model=schemas.AreaDetail)
def update_area(area_id: int, payload: schemas.AreaUpdate, db: Session = Depends(get_db)):
    area = db.query(models.Area).filter(models.Area.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Area not found")

    if payload.status is not None:
        valid = {"stable", "active", "review", "blocked"}
        if payload.status not in valid:
            raise HTTPException(status_code=422, detail=f"status must be one of {valid}")
        if payload.status != area.status:
            log_audit(db, entity_type='area', entity_id=area.id, area_id=area.id,
                      action='updated', field='status', old_value=area.status, new_value=payload.status)
        area.status = payload.status

    if payload.summary is not None and payload.summary != area.summary:
        log_audit(db, entity_type='area', entity_id=area.id, area_id=area.id,
                  action='updated', field='summary',
                  old_value=(area.summary or '')[:200], new_value=payload.summary[:200])
        area.summary = payload.summary
        # A summary saved through the UI is, by definition, a manual update:
        # stamp it now and clear the auto-generated flag so the card reads
        # "Updated …" rather than "Auto-generated …".
        area.summary_updated_at = datetime.utcnow()
        area.summary_auto_generated = False
    elif payload.summary is not None:
        area.summary = payload.summary

    if payload.icon is not None and payload.icon != area.icon:
        log_audit(db, entity_type='area', entity_id=area.id, area_id=area.id,
                  action='updated', field='icon',
                  old_value=area.icon, new_value=payload.icon or None)
        area.icon = payload.icon or None

    if payload.auto_update is not None:
        area.summary_auto_update = bool(payload.auto_update)

    area.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(area)
    return _area_detail(area, db)


@router.post("/areas/{area_id}/summary/suggest", response_model=schemas.SummarySuggestion)
def suggest_area_summary(area_id: int, db: Session = Depends(get_db)):
    area = db.query(models.Area).filter(models.Area.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Area not found")

    threads = (
        db.query(models.Thread)
        .filter(models.Thread.area_id == area.id)
        .order_by(models.Thread.updated_at.desc())
        .limit(10)
        .all()
    )

    thread_blocks = []
    for t in threads:
        recent_entries = (
            db.query(models.Entry)
            .filter(models.Entry.thread_id == t.id)
            .order_by(models.Entry.created_at.desc())
            .limit(3)
            .all()
        )
        entry_lines = "\n".join(
            f"  - [{e.type}] {e.content[:180]}" for e in recent_entries
        ) or "  (no entries)"
        thread_blocks.append(
            f"Thread: {t.title} [{t.status}]\n{entry_lines}"
        )

    context = "\n\n".join(thread_blocks) if thread_blocks else "(no threads yet)"

    system = (
        "You write concise status summaries for an area of someone's work.\n"
        "Output exactly 2 sentences. No preamble, no formatting, no bullet points.\n"
        "Sentence 1: the current state - what's happening right now, what's in motion.\n"
        "Sentence 2: what's next or blocking - risks, pending decisions, what to watch.\n"
        "Tone: direct, factual, suitable for a status board. Avoid filler like 'currently' or 'we are'.\n"
        "Use commas or hyphens for punctuation, never em dashes."
    )

    user_msg = (
        f"Area: {area.name}\n"
        f"Current status: {area.status}\n"
        f"Existing summary: {area.summary or '(none)'}\n\n"
        f"Recent activity:\n{context}"
    )

    # Use the configured AI provider (Claude / Groq / Gemini / Ollama / custom)
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


@router.get("/areas/{area_id}/threads", response_model=list[schemas.ThreadSummary])
def list_area_threads(area_id: int, db: Session = Depends(get_db)):
    area = db.query(models.Area).filter(models.Area.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Area not found")

    threads = (
        db.query(models.Thread)
        .filter(models.Thread.area_id == area_id)
        .order_by(models.Thread.updated_at.desc())
        .all()
    )

    result = []
    for t in threads:
        entry_count = (
            db.query(func.count(models.Entry.id))
            .filter(models.Entry.thread_id == t.id)
            .scalar()
        )
        attachment_count = (
            db.query(func.count(models.Attachment.id))
            .filter(models.Attachment.thread_id == t.id)
            .scalar()
        )
        result.append(
            schemas.ThreadSummary(
                id=t.id,
                area_id=t.area_id,
                title=t.title,
                status=t.status,
                description=t.description or "",
                created_at=t.created_at,
                updated_at=t.updated_at,
                entry_count=entry_count,
                attachment_count=attachment_count,
            )
        )
    return result


@router.post("/areas/{area_id}/threads", response_model=schemas.ThreadSummary, status_code=201)
def create_thread(area_id: int, payload: schemas.ThreadCreate, db: Session = Depends(get_db)):
    area = db.query(models.Area).filter(models.Area.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Area not found")

    valid = {"open", "in-progress", "resolved", "parked"}
    if payload.status not in valid:
        raise HTTPException(status_code=422, detail=f"status must be one of {valid}")

    thread = models.Thread(
        area_id=area_id,
        title=payload.title,
        description=payload.description or "",
        status=payload.status or "open",
    )
    db.add(thread)
    db.flush()  # ensure thread.id is assigned before logging event

    # Bump area updated_at so dashboard reflects new activity
    area.updated_at = datetime.now(timezone.utc)
    db.add(models.ActivityEvent(event_type="thread_created", thread_id=thread.id, detail=thread.title[:80]))
    db.commit()
    db.refresh(thread)

    log_audit(db, entity_type='thread', entity_id=thread.id, area_id=area_id,
              thread_id=thread.id, action='created', field='title', new_value=thread.title)

    return schemas.ThreadSummary(
        id=thread.id,
        area_id=thread.area_id,
        title=thread.title,
        status=thread.status,
        description=thread.description or "",
        created_at=thread.created_at,
        updated_at=thread.updated_at,
        entry_count=0,
        attachment_count=0,
    )


def _build_audit_context(rows):
    return [
        schemas.AuditLogWithContext(
            id=audit.id,
            entity_type=audit.entity_type,
            entity_id=audit.entity_id,
            action=audit.action,
            field=audit.field,
            old_value=audit.old_value,
            new_value=audit.new_value,
            occurred_at=audit.occurred_at,
            thread_id=thread.id if thread else None,
            thread_title=thread.title if thread else None,
            area_id=area.id,
            area_name=area.name,
        )
        for audit, thread, area in rows
    ]


@router.get("/audit", response_model=list[schemas.AuditLogWithContext])
def get_global_audit(
    limit: int = Query(default=200, le=500),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(models.AuditLog, models.Thread, models.Area)
        .outerjoin(models.Thread, models.AuditLog.thread_id == models.Thread.id)
        .join(models.Area, models.AuditLog.area_id == models.Area.id)
        .order_by(models.AuditLog.occurred_at.desc())
        .limit(limit)
        .all()
    )
    return _build_audit_context(rows)


@router.get("/areas/{area_id}/audit", response_model=list[schemas.AuditLogWithContext])
def get_area_audit(area_id: int, db: Session = Depends(get_db)):
    area = db.query(models.Area).filter(models.Area.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Area not found")
    rows = (
        db.query(models.AuditLog, models.Thread, models.Area)
        .outerjoin(models.Thread, models.AuditLog.thread_id == models.Thread.id)
        .join(models.Area, models.AuditLog.area_id == models.Area.id)
        .filter(models.AuditLog.area_id == area_id)
        .order_by(models.AuditLog.occurred_at.desc())
        .all()
    )
    return _build_audit_context(rows)


@router.get("/roundup", response_model=schemas.RoundupData)
def get_roundup_data(db: Session = Depends(get_db)):
    cutoff = datetime.utcnow() - timedelta(days=7)
    generated_at = datetime.utcnow().strftime("%Y-%m-%d")

    areas = db.query(models.Area).order_by(models.Area.id).all()
    area_data = []

    for area in areas:
        active_thread_count = (
            db.query(func.count(models.Thread.id))
            .filter(
                models.Thread.area_id == area.id,
                models.Thread.status.in_(["open", "in-progress"]),
            )
            .scalar()
        ) or 0

        area_thread_ids = [
            row.id for row in db.query(models.Thread.id).filter(models.Thread.area_id == area.id).all()
        ]

        todos_created = 0
        todos_completed = 0
        decisions = []

        if area_thread_ids:
            todos_created = (
                db.query(func.count(models.Entry.id))
                .filter(
                    models.Entry.thread_id.in_(area_thread_ids),
                    models.Entry.type == 'todo',
                    models.Entry.created_at >= cutoff,
                )
                .scalar()
            ) or 0

            todos_completed = (
                db.query(func.count(models.Entry.id))
                .filter(
                    models.Entry.thread_id.in_(area_thread_ids),
                    models.Entry.type == 'todo',
                    models.Entry.completed == True,
                    models.Entry.completed_at >= cutoff,
                )
                .scalar()
            ) or 0

            decision_rows = (
                db.query(models.Entry.content)
                .filter(
                    models.Entry.thread_id.in_(area_thread_ids),
                    models.Entry.type == 'decision',
                    models.Entry.created_at >= cutoff,
                )
                .all()
            )
            decisions = [row.content[:200] for row in decision_rows]

        recent_event_rows = (
            db.query(models.ActivityEvent)
            .join(models.Thread, models.ActivityEvent.thread_id == models.Thread.id)
            .filter(
                models.Thread.area_id == area.id,
                models.ActivityEvent.occurred_at >= cutoff,
            )
            .order_by(models.ActivityEvent.occurred_at.desc())
            .limit(10)
            .all()
        )

        recent_events = [
            f"{e.event_type}: {e.detail}" if e.detail else e.event_type
            for e in recent_event_rows
        ]

        area_data.append(schemas.AreaRoundupData(
            area_id=area.id,
            area_name=area.name,
            area_status=area.status,
            active_thread_count=active_thread_count,
            todos_created=todos_created,
            todos_completed=todos_completed,
            decisions=decisions,
            recent_events=recent_events,
            has_activity=len(recent_event_rows) > 0,
        ))

    # Stale areas: non-stable areas with no activity for 14+ days
    stale_cutoff = datetime.utcnow() - timedelta(days=14)
    now = datetime.utcnow()
    stale_areas = []
    for area in areas:
        if area.status == "stable":
            continue
        if area.updated_at and area.updated_at < stale_cutoff:
            days = (now - area.updated_at).days
            stale_areas.append(schemas.StaleArea(
                id=area.id,
                name=area.name,
                status=area.status,
                days_inactive=days,
            ))
    stale_areas.sort(key=lambda a: -a.days_inactive)

    return schemas.RoundupData(
        generated_at=generated_at,
        period_days=7,
        areas=area_data,
        stale_areas=stale_areas,
    )


@router.get("/activity", response_model=list[schemas.ActivityItem])
def get_activity(
    limit: int = Query(default=10, le=10),
    db: Session = Depends(get_db),
):
    events = (
        db.query(models.ActivityEvent)
        .join(models.Thread, models.ActivityEvent.thread_id == models.Thread.id)
        .order_by(models.ActivityEvent.occurred_at.desc())
        .limit(limit)
        .all()
    )

    result = []
    for event in events:
        thread = event.thread
        area = db.query(models.Area).filter(models.Area.id == thread.area_id).first()
        result.append(
            schemas.ActivityItem(
                event_type=event.event_type,
                thread_id=thread.id,
                thread_title=thread.title,
                thread_status=thread.status,
                detail=event.detail,
                occurred_at=event.occurred_at,
                area_id=area.id,
                area_name=area.name,
                area_status=area.status,
            )
        )
    return result
