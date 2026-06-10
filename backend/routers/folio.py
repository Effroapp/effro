"""
Folio - capture a deep-research dive, then pull the captures into one digest.

Every route is gated by EFFRO_FOLIO_ENABLED via the router-level
require_folio_enabled dependency, so the whole feature 404s (is invisible, not
just forbidden) on instances that have not switched it on. Mounted under /api.

This step-1 surface covers folios + manual topics + the FTS index plumbing.
Captures, the digest pull-together, and search wire on top in later steps.

Routes (under /api):
  GET    /folios                 - list folios, most-recently-touched first
  POST   /folios                 - create a folio
  GET    /folios/{id}            - one folio with its captures + current digest
  PATCH  /folios/{id}            - rename / refile (title, area_id, topic_ids)
  DELETE /folios/{id}            - delete a folio and its captures/digests
  GET    /folios/topics          - list manual topics
  POST   /folios/topics          - create a manual topic
"""
import json
import logging
import os
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import folio_capture
import folio_vision
import models
from database import get_db
from dependencies import require_folio_enabled

log = logging.getLogger("effro.folio")
router = APIRouter(tags=["folio"], dependencies=[Depends(require_folio_enabled)])

UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "./data/uploads")
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".heic", ".heif"}


# ── Schemas ───────────────────────────────────────────────────────────────────

class FolioCreate(BaseModel):
    title: Optional[str] = None
    area_id: Optional[int] = None
    topic_ids: Optional[list[int]] = None


class FolioUpdate(BaseModel):
    title: Optional[str] = None
    area_id: Optional[int] = None
    topic_ids: Optional[list[int]] = None


class TopicCreate(BaseModel):
    name: str


# ── FTS index helper ──────────────────────────────────────────────────────────

def reindex_folio(db: Session, folio: "models.Folio") -> None:
    """Rebuild this folio's row in folio_fts: title + every capture's extracted
    text + the current digest. Delete-then-insert keeps it idempotent. Best
    effort - if the build's SQLite lacks FTS5 the table is absent and search
    simply returns nothing, so a failure here must never break a write."""
    try:
        parts = []
        for cap in folio.captures:
            if cap.extracted_text:
                parts.append(cap.extracted_text)
        cur = next((d for d in folio.digests if d.is_current), None)
        if cur:
            parts.append(cur.summary or "")
            for field in (cur.key_points, cur.sources, cur.open_threads):
                try:
                    parts.extend(str(x) for x in json.loads(field or "[]"))
                except Exception:
                    pass
        body = "\n".join(p for p in parts if p)
        db.execute(text("DELETE FROM folio_fts WHERE folio_id = :fid"), {"fid": folio.id})
        db.execute(
            text("INSERT INTO folio_fts (folio_id, title, body) VALUES (:fid, :title, :body)"),
            {"fid": folio.id, "title": folio.title or "", "body": body},
        )
        db.commit()
    except Exception as e:
        db.rollback()
        log.warning("folio_fts reindex skipped for folio %s: %s", getattr(folio, "id", "?"), e)


def _unindex_folio(db: Session, folio_id: int) -> None:
    try:
        db.execute(text("DELETE FROM folio_fts WHERE folio_id = :fid"), {"fid": folio_id})
        db.commit()
    except Exception:
        db.rollback()


# ── Serialisers ─────────────────────────────────────────────────────────────--

def _topic_out(t: "models.Topic") -> dict:
    return {"id": t.id, "name": t.name, "created_at": t.created_at}


def _folio_summary(f: "models.Folio") -> dict:
    """List-row shape: enough for the index without loading every capture body."""
    return {
        "id": f.id,
        "title": f.title,
        "area_id": f.area_id,
        "capture_count": len(f.captures),
        "has_digest": any(d.is_current for d in f.digests),
        "topics": [_topic_out(t) for t in f.topics],
        "created_at": f.created_at,
        "updated_at": f.updated_at,
    }


# ── Topics ──────────────────────────────────────────────────────────────────--

@router.get("/folios/topics")
def list_topics(db: Session = Depends(get_db)):
    return [_topic_out(t) for t in db.query(models.Topic).order_by(models.Topic.name).all()]


@router.post("/folios/topics")
def create_topic(body: TopicCreate, db: Session = Depends(get_db)):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="A topic needs a name.")
    existing = db.query(models.Topic).filter(models.Topic.name == name).first()
    if existing:
        return _topic_out(existing)            # idempotent: reuse, don't error
    topic = models.Topic(name=name)
    db.add(topic)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.query(models.Topic).filter(models.Topic.name == name).first()
        return _topic_out(existing)
    db.refresh(topic)
    return _topic_out(topic)


# ── Folios ──────────────────────────────────────────────────────────────────--

def _apply_topics(db: Session, folio: "models.Folio", topic_ids: Optional[list[int]]) -> None:
    if topic_ids is None:
        return
    folio.topics = db.query(models.Topic).filter(models.Topic.id.in_(topic_ids)).all() if topic_ids else []


@router.get("/folios")
def list_folios(db: Session = Depends(get_db)):
    folios = db.query(models.Folio).order_by(models.Folio.updated_at.desc()).all()
    return [_folio_summary(f) for f in folios]


@router.post("/folios")
def create_folio(body: FolioCreate, db: Session = Depends(get_db)):
    folio = models.Folio(title=(body.title or "").strip() or None, area_id=body.area_id)
    db.add(folio)
    db.flush()
    _apply_topics(db, folio, body.topic_ids)
    db.commit()
    db.refresh(folio)
    reindex_folio(db, folio)
    return _folio_summary(folio)


@router.get("/folios/{folio_id}")
def get_folio(folio_id: int, db: Session = Depends(get_db)):
    folio = db.query(models.Folio).filter(models.Folio.id == folio_id).first()
    if not folio:
        raise HTTPException(status_code=404, detail="Folio not found.")
    cur = next((d for d in folio.digests if d.is_current), None)
    return {
        **_folio_summary(folio),
        "captures": [
            {
                "id": c.id, "type": c.type, "raw_content": c.raw_content,
                "extracted_text": c.extracted_text,
                "source_meta": json.loads(c.source_meta) if c.source_meta else None,
                "created_at": c.created_at,
            }
            for c in sorted(folio.captures, key=lambda c: c.id)
        ],
        "digest": None if not cur else {
            "id": cur.id, "version": cur.version, "summary": cur.summary,
            "key_points": json.loads(cur.key_points or "[]"),
            "sources": json.loads(cur.sources or "[]"),
            "open_threads": json.loads(cur.open_threads or "[]"),
            "based_on_capture_ids": json.loads(cur.based_on_capture_ids or "[]"),
            "generated_at": cur.generated_at,
        },
    }


@router.patch("/folios/{folio_id}")
def update_folio(folio_id: int, body: FolioUpdate, db: Session = Depends(get_db)):
    folio = db.query(models.Folio).filter(models.Folio.id == folio_id).first()
    if not folio:
        raise HTTPException(status_code=404, detail="Folio not found.")
    if body.title is not None:
        folio.title = body.title.strip() or None
    if body.area_id is not None:
        folio.area_id = body.area_id or None
    _apply_topics(db, folio, body.topic_ids)
    db.commit()
    db.refresh(folio)
    reindex_folio(db, folio)
    return _folio_summary(folio)


@router.delete("/folios/{folio_id}")
def delete_folio(folio_id: int, db: Session = Depends(get_db)):
    folio = db.query(models.Folio).filter(models.Folio.id == folio_id).first()
    if not folio:
        raise HTTPException(status_code=404, detail="Folio not found.")
    db.delete(folio)
    db.commit()
    _unindex_folio(db, folio_id)
    return {"ok": True}


# ── Captures ──────────────────────────────────────────────────────────────────

class CaptureIn(BaseModel):
    type: str                      # note | link
    text: Optional[str] = None     # for note
    url: Optional[str] = None      # for link


def _capture_out(c: "models.Capture") -> dict:
    return {
        "id": c.id,
        "type": c.type,
        "raw_content": c.raw_content,
        "extracted_text": c.extracted_text,
        "source_meta": json.loads(c.source_meta) if c.source_meta else None,
        "created_at": c.created_at,
    }


def _require_folio(db: Session, folio_id: int) -> "models.Folio":
    folio = db.query(models.Folio).filter(models.Folio.id == folio_id).first()
    if not folio:
        raise HTTPException(status_code=404, detail="Folio not found.")
    return folio


def _add_capture(db: Session, folio: "models.Folio", *, type: str,
                 raw_content: str, extracted_text: str, source_meta: Optional[dict]):
    cap = models.Capture(
        folio_id=folio.id, type=type,
        raw_content=raw_content or "", extracted_text=extracted_text or "",
        source_meta=json.dumps(source_meta) if source_meta else None,
    )
    db.add(cap)
    folio.updated_at = datetime.utcnow()    # a new capture is fresh activity
    db.commit()
    db.refresh(cap)
    db.refresh(folio)
    reindex_folio(db, folio)
    return cap


@router.post("/folios/{folio_id}/captures")
def add_capture(folio_id: int, body: CaptureIn, db: Session = Depends(get_db)):
    """Add a note or a link. Files and images use /captures/upload."""
    folio = _require_folio(db, folio_id)
    kind = (body.type or "").strip().lower()
    if kind == "note":
        txt = (body.text or "").strip()
        if not txt:
            raise HTTPException(status_code=400, detail="A note needs some text.")
        cap = _add_capture(db, folio, type="note", raw_content=txt, extracted_text=txt, source_meta=None)
    elif kind == "link":
        url = (body.url or "").strip()
        if not url:
            raise HTTPException(status_code=400, detail="Paste a link to capture.")
        try:
            data = folio_capture.fetch_readable(url)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        cap = _add_capture(
            db, folio, type="link", raw_content=url,
            extracted_text=data.get("extracted_text", ""),
            source_meta={k: data.get(k) for k in ("domain", "title", "favicon_url", "error") if data.get(k)},
        )
    else:
        raise HTTPException(status_code=400, detail="Capture type must be note or link.")
    return _capture_out(cap)


@router.post("/folios/{folio_id}/captures/upload")
async def upload_capture(folio_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Add a file or an image. Documents are text-extracted; images are read by
    the vision model (best-effort - see folio_vision)."""
    folio = _require_folio(db, folio_id)
    content = await file.read()
    if not content:
        raise HTTPException(status_code=422, detail="That file is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="That file is too large (25 MB max).")

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    original = file.filename or "capture"
    ext = os.path.splitext(original)[1].lower()
    stored_name = f"{uuid.uuid4().hex}{ext}"
    with open(os.path.join(UPLOAD_DIR, stored_name), "wb") as fh:
        fh.write(content)

    is_image = (file.content_type or "").startswith("image/") or ext in _IMAGE_EXTS
    if is_image:
        read_text, vmeta = folio_vision.read_image_text(db, content, ext)
        meta = {"original_name": original, "size": len(content), **vmeta}
        cap = _add_capture(db, folio, type="image", raw_content=stored_name,
                           extracted_text=read_text, source_meta=meta)
    else:
        read_text = folio_capture.extract_file(original, content)
        cap = _add_capture(db, folio, type="file", raw_content=stored_name,
                           extracted_text=read_text,
                           source_meta={"original_name": original, "size": len(content)})
    return _capture_out(cap)


@router.delete("/folios/{folio_id}/captures/{capture_id}")
def delete_capture(folio_id: int, capture_id: int, db: Session = Depends(get_db)):
    folio = _require_folio(db, folio_id)
    cap = db.query(models.Capture).filter(
        models.Capture.id == capture_id, models.Capture.folio_id == folio_id
    ).first()
    if not cap:
        raise HTTPException(status_code=404, detail="Capture not found.")
    db.delete(cap)
    folio.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(folio)
    reindex_folio(db, folio)
    return {"ok": True}
