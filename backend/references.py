"""Creating the things that get their own reference card.

Attachments, thread links and filed folios all appear in a thread's timeline as
a card. Every route that makes one goes through here, so the card can never be
forgotten: the Signals accept path, Telegram media and the demo loader all
create these objects directly, and pasting the hook into each of them would be
one refactor away from a silent gap.
"""
import os

from sqlalchemy.orm import Session

import models
from audit import create_reference_entry, delete_reference_entry


def add_attachment(db: Session, thread_id: int, *, type: str, name: str,
                   url: str = None, stored_name: str = None,
                   original_name: str = None, size: int = None):
    """Attach a file or a link to a thread, with its timeline card."""
    attachment = models.Attachment(
        thread_id=thread_id,
        type=type,
        name=name,
        url=url,
        stored_name=stored_name,
        original_name=original_name,
        size=size,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)

    create_reference_entry(db, thread_id, 'link' if type == 'link' else 'file',
                           attachment.id, attachment.name)
    return attachment


def add_thread_link(db: Session, from_thread_id: int, to_thread_id: int, kind: str,
                    to_title: str):
    """Link one thread to another, with a card on the from-thread only.

    The card belongs where the action happened. The other thread is untouched,
    which is also what the delete copy promises.
    """
    link = models.ThreadLink(
        from_thread_id=from_thread_id,
        to_thread_id=to_thread_id,
        kind=kind,
    )
    db.add(link)
    db.commit()
    db.refresh(link)

    create_reference_entry(db, from_thread_id, 'thread', link.id, to_title)
    return link


def remove_attachment(db: Session, attachment, performed_by: int = None):
    """Delete an attachment, its file on disk and its card.

    Shared by the attachment route and by deleting the card itself, so both
    directions do exactly the same work.
    """
    from audit import log_audit  # noqa: PLC0415 (circular at module scope)
    from routers.attachments import UPLOAD_DIR  # noqa: PLC0415

    attachment_id = attachment.id
    thread_id = attachment.thread_id
    att_type = attachment.type
    att_name = attachment.name
    area_id = db.query(models.Thread.area_id).filter(
        models.Thread.id == thread_id).scalar()

    if attachment.type == "file" and attachment.stored_name:
        path = os.path.join(UPLOAD_DIR, attachment.stored_name)
        if os.path.exists(path):
            os.remove(path)

    db.delete(attachment)
    db.commit()

    delete_reference_entry(db, 'link' if att_type == 'link' else 'file', attachment_id)

    log_audit(db, entity_type='attachment', entity_id=attachment_id, area_id=area_id,
              thread_id=thread_id, action='deleted', field=att_type, old_value=att_name,
              performed_by=performed_by)


def remove_thread_link(db: Session, link, performed_by: int = None):
    """Delete a thread link and its card."""
    from audit import log_audit  # noqa: PLC0415

    link_id = link.id
    from_thread_id = link.from_thread_id
    kind = link.kind
    to_thread = db.query(models.Thread).filter(
        models.Thread.id == link.to_thread_id).first()
    area_id = db.query(models.Thread.area_id).filter(
        models.Thread.id == from_thread_id).scalar()

    db.delete(link)
    db.commit()

    delete_reference_entry(db, 'thread', link_id)

    log_audit(db, entity_type='thread_link', entity_id=link_id, area_id=area_id,
              thread_id=from_thread_id, action='deleted', field=kind,
              old_value=to_thread.title if to_thread else None,
              performed_by=performed_by)
