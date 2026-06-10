"""
Folio image capture: read the text in a photo or screenshot (including
handwriting) so a snapped whiteboard becomes searchable text.

This routes through the SAME AI proxy / provider as the rest of Effro - there
is one AI path to maintain. It is strictly best-effort: if AI is not configured,
the engine cannot do vision, or the call fails, the capture is still kept with
empty extracted_text and a note. An image capture is never lost over OCR.
"""
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from ai_provider import get_provider

log = logging.getLogger("effro.folio.vision")

_MEDIA_TYPES = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
    ".heic": "image/heic", ".heif": "image/heif",
}


def read_image_text(db: Session, image_bytes: bytes, ext: str) -> tuple[str, dict]:
    """Return (extracted_text, meta). meta carries vision_read (bool) and, on
    failure, a human note. Never raises."""
    media_type = _MEDIA_TYPES.get((ext or "").lower(), "image/png")
    try:
        provider = get_provider(db)
        text = (provider.read_image(image_bytes, media_type) or "").strip()
        if text:
            return text, {"vision_read": True, "model": getattr(provider, "_model", None)}
        # Read succeeded but found no text (e.g. a blank or purely graphic image).
        return "", {"vision_read": True, "note": "No readable text was found in this image."}
    except Exception as e:
        log.warning("folio image read failed: %s", e)
        return "", {"vision_read": False,
                    "note": "This image could not be read automatically. You can add a note describing it."}
