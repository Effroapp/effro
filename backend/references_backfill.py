"""Give every existing attachment, thread link and filed folio its card.

Before reference cards existed, attaching something wrote a plain text entry
saying so. Those entries are converted in place rather than duplicated, so a
thread that has been going for months does not suddenly show everything twice.

Matching is deliberately strict. The old logger produced a handful of exact
strings, listed below, and only an entry matching one of them character for
character, in the right thread, within two minutes of the object it describes,
is treated as the log line for that object. Anything else is something the user
wrote and is left alone. A false negative just means one extra card. A false
positive would eat someone's writing.
"""
import logging

from sqlalchemy import text

log = logging.getLogger("effro")

# Every string the old activity logger could produce, by kind. Read from the
# call sites in attachments.py, threads.py and signals.py before they changed.
_MATCH_WINDOW_SECONDS = 120


def _legacy_attachment_strings(name: str, url: str, att_type: str) -> list:
    if att_type == "link":
        link_md = f"[**{name}**]({url})" if url else f"**{name}**"
        return [
            f"Added a link: {link_md}",          # attachments.add_link
            f"Attached a link: **{name[:80]}**",  # signals accept, link mode
        ]
    return [
        f"Attached a file: **{name}**",          # attachments.upload_file
        f"Attached a file: **{name[:80]}**",     # signals accept, file mode
    ]


def _legacy_link_strings(to_title: str, kind: str) -> list:
    verb = "Marked as blocking" if kind == "blocks" else "Linked to"
    return [f"{verb} **{to_title}**"]


def _convert(conn, thread_id, ref_kind, ref_id, name, candidates, after):
    """Turn the old log line into a card, if one is there to turn.

    Returns True when an entry was converted.
    """
    for content in candidates:
        row = conn.execute(text(
            "SELECT id FROM entries "
            "WHERE thread_id = :t AND type = 'entry' AND content = :c "
            "AND ref_kind IS NULL "
            "AND created_at >= :from_ts "
            "AND created_at <= datetime(:from_ts, :window) "
            "LIMIT 1"
        ), {
            "t": thread_id, "c": content, "from_ts": after,
            "window": f"+{_MATCH_WINDOW_SECONDS} seconds",
        }).fetchone()
        if row:
            conn.execute(text(
                "UPDATE entries SET type = 'reference', ref_kind = :k, ref_id = :r, "
                "content = :n, title = NULL, title_source = NULL WHERE id = :i"
            ), {"k": ref_kind, "r": ref_id, "n": name, "i": row[0]})
            return True
    return False


def _has_card(conn, ref_kind, ref_id) -> bool:
    return conn.execute(text(
        "SELECT 1 FROM entries WHERE type = 'reference' "
        "AND ref_kind = :k AND ref_id = :r LIMIT 1"
    ), {"k": ref_kind, "r": ref_id}).fetchone() is not None


def _create(conn, thread_id, ref_kind, ref_id, name, created_at):
    # Every NOT NULL column has to be named: this is raw SQL, so the model's
    # Python-side defaults do not apply.
    conn.execute(text(
        "INSERT INTO entries (thread_id, content, type, completed, decomp_dismissed, "
        "ref_kind, ref_id, created_at, updated_at) "
        "VALUES (:t, :n, 'reference', 0, 0, :k, :r, :ts, :ts)"
    ), {"t": thread_id, "n": name, "k": ref_kind, "r": ref_id, "ts": created_at})


def backfill_reference_entries(engine) -> tuple:
    """Returns (converted, created). A second run changes nothing."""
    converted = created = 0

    with engine.connect() as conn:
        # ── Attachments ─────────────────────────────────────────────────────
        rows = conn.execute(text(
            "SELECT id, thread_id, type, name, url, created_at FROM attachments"
        )).fetchall()
        for att_id, thread_id, att_type, name, url, made_at in rows:
            kind = "link" if att_type == "link" else "file"
            if _has_card(conn, kind, att_id):
                continue
            if _convert(conn, thread_id, kind, att_id, name,
                        _legacy_attachment_strings(name or "", url or "", att_type),
                        made_at):
                converted += 1
            else:
                _create(conn, thread_id, kind, att_id, name, made_at)
                created += 1

        # ── Thread links ────────────────────────────────────────────────────
        rows = conn.execute(text(
            "SELECT l.id, l.from_thread_id, l.kind, t.title, l.created_at "
            "FROM thread_links l JOIN threads t ON t.id = l.to_thread_id"
        )).fetchall()
        for link_id, from_thread_id, kind, to_title, made_at in rows:
            if _has_card(conn, "thread", link_id):
                continue
            # A thread renamed since the link was made will not match its old
            # log line. Accepted: the result is one extra card, not a loss.
            if _convert(conn, from_thread_id, "thread", link_id, to_title,
                        _legacy_link_strings(to_title, kind), made_at):
                converted += 1
            else:
                _create(conn, from_thread_id, "thread", link_id, to_title, made_at)
                created += 1

        # ── Filed folios ────────────────────────────────────────────────────
        # These never had a log line, so there is nothing to convert.
        rows = conn.execute(text(
            "SELECT id, thread_id, title, created_at FROM folios "
            "WHERE thread_id IS NOT NULL"
        )).fetchall()
        for folio_id, thread_id, title, made_at in rows:
            if _has_card(conn, "folio", folio_id):
                continue
            _create(conn, thread_id, "folio", folio_id,
                    title or "Untitled folio", made_at)
            created += 1

        conn.commit()

    return converted, created
