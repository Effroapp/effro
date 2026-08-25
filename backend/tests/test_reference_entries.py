"""
Reference cards.

A file, link, linked thread or filed folio shows in the timeline as its own
card. The card and the thing it points at share one life, so removing either
removes both, with one exception: a Folio is unfiled rather than destroyed,
because it is a workspace of its own and the user is only saying it does not
belong on this thread.
"""
import io
import os
import pathlib
import sqlite3

import pytest


def _area(client, name="Delivery"):
    r = client.post("/api/areas", json={"name": name})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _thread(client, area_id, title="A thread"):
    r = client.post(f"/api/areas/{area_id}/threads", json={"title": title})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


@pytest.fixture
def area_id(client):
    return _area(client)


@pytest.fixture
def thread_id(client, area_id):
    return _thread(client, area_id)


def _refs(client, thread_id, kind=None):
    entries = client.get(f"/api/threads/{thread_id}").json()["entries"]
    rows = [e for e in entries if e["type"] == "reference"]
    return [e for e in rows if kind is None or e["ref_kind"] == kind]


def _upload(client, thread_id, name="runbook.txt", body=b"hello"):
    r = client.post(f"/api/threads/{thread_id}/attachments/file",
                    files={"file": (name, io.BytesIO(body), "text/plain")})
    assert r.status_code in (200, 201), r.text
    return r.json()


def _add_link(client, thread_id, name="The runbook", url="https://example.com/runbook"):
    r = client.post(f"/api/threads/{thread_id}/attachments/link", json={"name": name, "url": url})
    assert r.status_code in (200, 201), r.text
    return r.json()


# ── Creation ──────────────────────────────────────────────────────────────────

def test_uploading_a_file_creates_a_card(client, thread_id):
    att = _upload(client, thread_id)
    cards = _refs(client, thread_id, "file")
    assert len(cards) == 1
    assert cards[0]["ref_id"] == att["id"]
    # The name is resolved live, not read from the snapshot.
    assert cards[0]["reference"]["name"] == "runbook.txt"
    assert cards[0]["reference"]["kind"] == "file"
    # References carry no title of their own.
    assert cards[0]["title"] is None


def test_adding_a_link_creates_a_card(client, thread_id):
    att = _add_link(client, thread_id)
    cards = _refs(client, thread_id, "link")
    assert len(cards) == 1
    assert cards[0]["ref_id"] == att["id"]
    assert cards[0]["reference"]["url"] == "https://example.com/runbook"


def test_a_thread_link_puts_a_card_on_the_from_thread_only(client, area_id):
    from_id = _thread(client, area_id, "Adyen migration")
    to_id = _thread(client, area_id, "Billing page revamp")
    client.post(f"/api/threads/{from_id}/links",
                json={"to_thread_id": to_id, "kind": "blocks"})

    here = _refs(client, from_id, "thread")
    assert len(here) == 1
    assert here[0]["reference"]["thread_id"] == to_id
    assert here[0]["reference"]["link_kind"] == "blocks"
    # The other thread is untouched, which is what the delete copy promises.
    assert _refs(client, to_id) == []


def test_a_renamed_thread_shows_its_new_name_on_the_card(client, area_id):
    from_id = _thread(client, area_id, "Adyen migration")
    to_id = _thread(client, area_id, "Billing page revamp")
    client.post(f"/api/threads/{from_id}/links",
                json={"to_thread_id": to_id, "kind": "relates_to"})

    client.put(f"/api/threads/{to_id}", json={"title": "Billing rework"})
    card = _refs(client, from_id, "thread")[0]
    assert card["reference"]["name"] == "Billing rework"
    # The snapshot is left as it was, and display never uses it.
    assert card["content"] == "Billing page revamp"


# ── Folios ────────────────────────────────────────────────────────────────────

def test_filing_a_folio_creates_a_card(client, area_id, thread_id):
    folio = client.post("/api/folios",
                        json={"title": "Vendor research", "area_id": area_id,
                              "thread_id": thread_id}).json()
    cards = _refs(client, thread_id, "folio")
    assert len(cards) == 1
    assert cards[0]["reference"]["folio_id"] == folio["id"]


def test_refiling_a_folio_moves_its_card_and_keeps_the_notes(client, area_id, thread_id):
    other_id = _thread(client, area_id, "Somewhere else")
    folio = client.post("/api/folios",
                        json={"title": "Vendor research", "area_id": area_id,
                              "thread_id": thread_id}).json()
    card = _refs(client, thread_id, "folio")[0]
    client.put(f"/api/entries/{card['id']}", json={"notes": "Worth a read"})

    client.patch(f"/api/folios/{folio['id']}", json={"thread_id": other_id})

    assert _refs(client, thread_id, "folio") == []
    moved = _refs(client, other_id, "folio")
    assert len(moved) == 1
    assert moved[0]["id"] == card["id"]
    assert moved[0]["notes"] == "Worth a read"


def test_unfiling_a_folio_removes_its_card(client, area_id, thread_id):
    folio = client.post("/api/folios",
                        json={"title": "Vendor research", "area_id": area_id,
                              "thread_id": thread_id}).json()
    assert len(_refs(client, thread_id, "folio")) == 1

    client.patch(f"/api/folios/{folio['id']}", json={"thread_id": 0})
    assert _refs(client, thread_id, "folio") == []


def test_deleting_a_folio_card_unfiles_it_and_keeps_the_folio(client, area_id, thread_id):
    folio = client.post("/api/folios",
                        json={"title": "Vendor research", "area_id": area_id,
                              "thread_id": thread_id}).json()
    card = _refs(client, thread_id, "folio")[0]

    assert client.delete(f"/api/entries/{card['id']}").status_code in (200, 204)

    assert _refs(client, thread_id, "folio") == []
    # The Folio itself survives, loose.
    assert client.get(f"/api/folios/{folio['id']}").status_code == 200
    con = sqlite3.connect(os.environ["DB_PATH"])
    filed_on = con.execute("SELECT thread_id FROM folios WHERE id = ?",
                           (folio["id"],)).fetchone()[0]
    con.close()
    assert filed_on is None


# ── Shared life ───────────────────────────────────────────────────────────────

def test_deleting_the_attachment_removes_the_card(client, thread_id):
    att = _upload(client, thread_id)
    assert len(_refs(client, thread_id, "file")) == 1

    client.delete(f"/api/attachments/{att['id']}")
    assert _refs(client, thread_id, "file") == []


def test_deleting_the_card_removes_the_attachment_and_the_file(client, thread_id):
    from routers.attachments import UPLOAD_DIR

    att = _upload(client, thread_id)
    on_disk = os.path.join(UPLOAD_DIR, att["stored_name"])
    assert os.path.exists(on_disk)

    card = _refs(client, thread_id, "file")[0]
    client.delete(f"/api/entries/{card['id']}")

    assert _refs(client, thread_id, "file") == []
    assert client.get(f"/api/threads/{thread_id}").json()["attachments"] == []
    assert not os.path.exists(on_disk)


def test_deleting_a_link_card_removes_the_link(client, thread_id):
    _add_link(client, thread_id)
    card = _refs(client, thread_id, "link")[0]
    client.delete(f"/api/entries/{card['id']}")
    assert client.get(f"/api/threads/{thread_id}").json()["attachments"] == []


def test_deleting_a_thread_card_removes_the_link(client, area_id):
    from_id = _thread(client, area_id, "Adyen migration")
    to_id = _thread(client, area_id, "Billing page revamp")
    client.post(f"/api/threads/{from_id}/links",
                json={"to_thread_id": to_id, "kind": "blocks"})

    card = _refs(client, from_id, "thread")[0]
    client.delete(f"/api/entries/{card['id']}")

    assert _refs(client, from_id, "thread") == []
    assert client.get(f"/api/threads/{from_id}").json()["outgoing_links"] == []


def test_deleting_the_far_thread_takes_the_card_with_it(client, area_id):
    """The cascade removes the link row but knows nothing about the card in
    the other thread's timeline, so that has to be cleared deliberately."""
    from_id = _thread(client, area_id, "Adyen migration")
    to_id = _thread(client, area_id, "Billing page revamp")
    client.post(f"/api/threads/{from_id}/links",
                json={"to_thread_id": to_id, "kind": "blocks"})
    assert len(_refs(client, from_id, "thread")) == 1

    client.delete(f"/api/threads/{to_id}")
    assert _refs(client, from_id, "thread") == []


def test_an_orphaned_card_reads_rather_than_crashing(client, thread_id):
    """A row removed behind the app's back must not take the thread down."""
    att = _upload(client, thread_id)
    card = _refs(client, thread_id, "file")[0]

    con = sqlite3.connect(os.environ["DB_PATH"])
    con.execute("DELETE FROM attachments WHERE id = ?", (att["id"],))
    con.commit()
    con.close()

    got = client.get(f"/api/threads/{thread_id}")
    assert got.status_code == 200
    orphan = [e for e in got.json()["entries"] if e["id"] == card["id"]][0]
    assert orphan["reference"] is None
    # The snapshot name is what the gone state has to show.
    assert orphan["content"] == "runbook.txt"


# ── What a reference will and will not accept ─────────────────────────────────

def test_a_client_cannot_create_a_reference(client, thread_id):
    r = client.post(f"/api/threads/{thread_id}/entries",
                    json={"content": "Sneaky", "type": "reference"})
    assert r.status_code == 422
    assert r.json()["detail"] == (
        "Reference entries are created by attaching things, not directly")


def test_a_reference_takes_notes_and_nothing_else(client, thread_id):
    _upload(client, thread_id)
    card = _refs(client, thread_id, "file")[0]

    ok = client.put(f"/api/entries/{card['id']}", json={"notes": "Read this first"})
    assert ok.status_code == 200
    assert ok.json()["notes"] == "Read this first"

    for field, value in (("content", "Renamed"), ("title", "A title"),
                         ("type", "entry"), ("completed", True)):
        bad = client.put(f"/api/entries/{card['id']}", json={field: value})
        assert bad.status_code == 400, field
        assert bad.json()["detail"] == "Reference entries can only take notes"


# ── The backfill ──────────────────────────────────────────────────────────────

def test_the_backfill_converts_legacy_entries_and_creates_what_is_missing(client, thread_id):
    """The old activity logger wrote plain text entries. Those are converted in
    place rather than duplicated, and anything with no line at all gets a card."""
    from tests.conftest import build_client

    att = _upload(client, thread_id, name="legacy.txt")
    loose = _add_link(client, thread_id, name="No log line", url="https://example.com/x")
    db_path = os.environ["DB_PATH"]

    con = sqlite3.connect(db_path)
    # Rewind the file to how it looked before reference cards: its card becomes
    # the plain text entry the old logger wrote, and the link loses its card.
    con.execute(
        "UPDATE entries SET type = 'entry', ref_kind = NULL, ref_id = NULL, content = ? "
        "WHERE type = 'reference' AND ref_kind = 'file' AND ref_id = ?",
        (f"Attached a file: **{att['name']}**", att["id"]),
    )
    con.execute("DELETE FROM entries WHERE type = 'reference' AND ref_kind = 'link' "
                "AND ref_id = ?", (loose["id"],))
    # And something the user actually wrote, which must survive untouched.
    con.execute(
        "INSERT INTO entries (thread_id, content, type, completed, decomp_dismissed, "
        "created_at, updated_at) "
        "VALUES (?, 'Attached a file: my own words about it', 'entry', 0, 0, "
        "datetime('now'), datetime('now'))", (thread_id,))
    con.commit()
    con.close()

    def boot():
        with build_client(pathlib.Path(db_path).parent, auth_enabled=False):
            pass

    boot()

    cards = _refs(client, thread_id)
    by_kind = {c["ref_kind"]: c for c in cards}
    assert set(by_kind) == {"file", "link"}
    # Converted in place: one card, not two, and the snapshot is now the name.
    assert by_kind["file"]["ref_id"] == att["id"]
    assert by_kind["file"]["content"] == "legacy.txt"
    assert by_kind["link"]["ref_id"] == loose["id"]

    # The user's own entry is left exactly as it was.
    mine = [e for e in client.get(f"/api/threads/{thread_id}").json()["entries"]
            if e["content"] == "Attached a file: my own words about it"]
    assert len(mine) == 1
    assert mine[0]["type"] == "entry"

    # A second run changes nothing.
    before = _refs(client, thread_id)
    boot()
    assert _refs(client, thread_id) == before
