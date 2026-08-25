"""User-defined entry types.

Label and colour only. An entry using one is stored with type 'custom' and a
custom_type_id, and behaves exactly like an Update underneath. Types are global
rather than per-area, because a Risk means the same thing wherever it is
written, and deleting one is safe: its entries become Updates rather than
disappearing with it.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
import schemas
from audit import log_audit
from database import get_db
from dependencies import get_current_user
from entry_text import CUSTOM_COLOURS

router = APIRouter(tags=["entry-types"])

NAME_MAX = 24


def _clean_name(raw: str) -> str:
    name = (raw or "").strip()
    if not 1 <= len(name) <= NAME_MAX:
        raise HTTPException(
            status_code=422,
            detail=f"A type name needs 1 to {NAME_MAX} characters",
        )
    return name


def _check_colour(colour: str) -> str:
    if colour not in CUSTOM_COLOURS:
        raise HTTPException(
            status_code=422,
            detail=f"colour must be one of {', '.join(CUSTOM_COLOURS)}",
        )
    return colour


def _reject_duplicate(db: Session, name: str, exclude_id: int | None = None):
    """Names collide case-insensitively, so Risk and risk are the same type."""
    q = db.query(models.CustomEntryType).filter(
        func.lower(models.CustomEntryType.name) == name.lower()
    )
    if exclude_id is not None:
        q = q.filter(models.CustomEntryType.id != exclude_id)
    clash = q.first()
    if clash:
        raise HTTPException(
            status_code=409,
            detail=f"You already have a type called {clash.name}",
        )


def _usage(db: Session, type_id: int) -> int:
    return db.query(models.Entry).filter(models.Entry.custom_type_id == type_id).count()


@router.get("/entry-types", response_model=list[schemas.CustomEntryTypeListed])
def list_entry_types(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    rows = db.query(models.CustomEntryType).order_by(models.CustomEntryType.name).all()
    # One grouped count rather than a query per type.
    counts = dict(
        db.query(models.Entry.custom_type_id, func.count(models.Entry.id))
        .filter(models.Entry.custom_type_id.isnot(None))
        .group_by(models.Entry.custom_type_id)
        .all()
    )
    return [
        schemas.CustomEntryTypeListed(
            id=t.id, name=t.name, colour=t.colour,
            usage_count=counts.get(t.id, 0), created_at=t.created_at,
        )
        for t in rows
    ]


@router.post("/entry-types", response_model=schemas.CustomEntryTypeOut, status_code=201)
def create_entry_type(
    payload: schemas.CustomEntryTypeCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    name = _clean_name(payload.name)
    _check_colour(payload.colour)
    _reject_duplicate(db, name)

    entry_type = models.CustomEntryType(name=name, colour=payload.colour)
    db.add(entry_type)
    db.commit()
    db.refresh(entry_type)

    log_audit(db, entity_type='entry_type', entity_id=entry_type.id, area_id=None,
              action='created', field='name', new_value=name,
              performed_by=current_user.id)
    return entry_type


@router.put("/entry-types/{type_id}", response_model=schemas.CustomEntryTypeOut)
def update_entry_type(
    type_id: int, payload: schemas.CustomEntryTypeUpdate, db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    entry_type = db.query(models.CustomEntryType).filter(
        models.CustomEntryType.id == type_id).first()
    if not entry_type:
        raise HTTPException(status_code=404, detail="Entry type not found")

    if payload.name is not None:
        name = _clean_name(payload.name)
        if name != entry_type.name:
            _reject_duplicate(db, name, exclude_id=type_id)
            log_audit(db, entity_type='entry_type', entity_id=type_id, area_id=None,
                      action='updated', field='name',
                      old_value=entry_type.name, new_value=name,
                      performed_by=current_user.id)
            entry_type.name = name

    if payload.colour is not None:
        _check_colour(payload.colour)
        entry_type.colour = payload.colour

    db.commit()
    db.refresh(entry_type)
    return entry_type


@router.delete("/entry-types/{type_id}", response_model=schemas.CustomEntryTypeDeleted)
def delete_entry_type(
    type_id: int, db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Delete a type. Its entries become Updates rather than going with it."""
    entry_type = db.query(models.CustomEntryType).filter(
        models.CustomEntryType.id == type_id).first()
    if not entry_type:
        raise HTTPException(status_code=404, detail="Entry type not found")

    converted = (
        db.query(models.Entry)
        .filter(models.Entry.custom_type_id == type_id)
        .update({models.Entry.type: 'entry', models.Entry.custom_type_id: None},
                synchronize_session=False)
    )
    name = entry_type.name
    db.delete(entry_type)
    db.commit()

    log_audit(db, entity_type='entry_type', entity_id=type_id, area_id=None,
              action='deleted', field='name', old_value=name,
              new_value=str(converted), performed_by=current_user.id)
    return schemas.CustomEntryTypeDeleted(converted=converted)
