"""
The In Hand pin toggle and strip query.

Covers the contract the dashboard strip depends on: one endpoint pins and
unpins, the strip is ordered newest pin first, a ticked todo drops out of the
strip without losing its pin, and the toggle hands back a live count for the
toast copy.
"""
import os
import sqlite3

import pytest


@pytest.fixture(autouse=True)
def no_pins_carried_over(client):
    """The client fixture is module-scoped, so clear every pin between tests.

    Done in SQLite rather than through the toggle because a completed-but-still
    pinned entry does not appear in /api/pinned and so cannot be toggled off
    from the list alone.
    """
    conn = sqlite3.connect(os.environ["DB_PATH"])
    conn.execute("UPDATE entries SET pinned_at = NULL")
    conn.commit()
    conn.close()


def _area(client, name="Platform migration"):
    r = client.post("/api/areas", json={"name": name})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _thread(client, area_id, title="Vendor cutover"):
    r = client.post(f"/api/areas/{area_id}/threads", json={"title": title})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _entry(client, thread_id, content, type="todo"):
    r = client.post(f"/api/threads/{thread_id}/entries",
                    json={"content": content, "type": type})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _fixture(client, titles, thread_title="Vendor cutover", area_name=None):
    """An area, a thread and one todo per title. Returns the entry ids."""
    area_id = _area(client, area_name) if area_name else _area(client)
    thread_id = _thread(client, area_id, thread_title)
    return thread_id, [_entry(client, thread_id, t) for t in titles]


def test_the_column_exists_after_migration(client):
    cols = sqlite3.connect(os.environ["DB_PATH"]).execute(
        "PRAGMA table_info(entries)").fetchall()
    assert "pinned_at" in {c[1] for c in cols}


def test_nothing_is_pinned_to_begin_with(client):
    r = client.get("/api/pinned")
    assert r.status_code == 200
    assert r.json() == []


def test_the_toggle_pins_then_unpins_the_same_entry(client):
    _, (entry_id,) = _fixture(client, ["Send the revised SOW"])

    on = client.post(f"/api/entries/{entry_id}/pin")
    assert on.status_code == 200
    assert on.json()["pinned"] is True
    assert on.json()["pinned_at"] is not None
    assert len(client.get("/api/pinned").json()) == 1

    off = client.post(f"/api/entries/{entry_id}/pin")
    assert off.status_code == 200
    assert off.json()["pinned"] is False
    assert off.json()["pinned_at"] is None
    assert client.get("/api/pinned").json() == []


def test_the_toggle_returns_the_live_count_and_thread_name(client):
    _, ids = _fixture(client, ["One", "Two"], thread_title="Team away day")

    first = client.post(f"/api/entries/{ids[0]}/pin").json()
    assert first["count"] == 1
    assert first["thread_name"] == "Team away day"

    second = client.post(f"/api/entries/{ids[1]}/pin").json()
    assert second["count"] == 2

    # Unpinning reports the count after the removal, not before.
    assert client.post(f"/api/entries/{ids[0]}/pin").json()["count"] == 1


def test_the_strip_is_ordered_newest_pin_first(client):
    _, ids = _fixture(client, ["First pinned", "Second pinned", "Third pinned"])
    for entry_id in ids:
        client.post(f"/api/entries/{entry_id}/pin")

    contents = [row["content"] for row in client.get("/api/pinned").json()]
    assert contents == ["Third pinned", "Second pinned", "First pinned"]


def test_a_row_carries_its_thread_and_area_names(client):
    thread_id, (entry_id,) = _fixture(
        client, ["Chase the venue"], thread_title="Autumn offsite",
        area_name="Operations")
    client.post(f"/api/entries/{entry_id}/pin")

    row = client.get("/api/pinned").json()[0]
    assert row["thread_id"] == thread_id
    assert row["thread_name"] == "Autumn offsite"
    assert row["area_name"] == "Operations"
    assert row["type"] == "todo"


def test_ticking_a_todo_removes_it_from_the_strip_but_keeps_the_pin(client):
    _, (entry_id,) = _fixture(client, ["Renew the insurance"])
    client.post(f"/api/entries/{entry_id}/pin")
    assert len(client.get("/api/pinned").json()) == 1

    ticked = client.put(f"/api/entries/{entry_id}", json={"completed": True})
    assert client.get("/api/pinned").json() == []
    # The pin itself survives, so the age is intact when it comes back.
    assert ticked.json()["pinned_at"] is not None

    client.put(f"/api/entries/{entry_id}", json={"completed": False})
    assert len(client.get("/api/pinned").json()) == 1


def test_every_entry_type_can_be_pinned(client):
    area_id = _area(client, "Mixed types")
    thread_id = _thread(client, area_id, "All sorts")
    ids = [_entry(client, thread_id, t, type=t)
           for t in ("entry", "decision", "blockage", "meeting")]
    for entry_id in ids:
        client.post(f"/api/entries/{entry_id}/pin")

    types = {row["type"] for row in client.get("/api/pinned").json()}
    assert types == {"entry", "decision", "blockage", "meeting"}


def test_undo_restores_the_original_pin_stamp_and_order(client):
    _, ids = _fixture(client, ["Oldest", "Middle", "Newest"])
    for entry_id in ids:
        client.post(f"/api/entries/{entry_id}/pin")

    original = {row["id"]: row["pinned_at"] for row in client.get("/api/pinned").json()}
    middle = ids[1]

    client.post(f"/api/entries/{middle}/pin")
    assert middle not in {row["id"] for row in client.get("/api/pinned").json()}

    # Undo hands back the stamp the row had, so it lands where it was rather
    # than jumping to the top with a fresh age.
    client.post(f"/api/entries/{middle}/pin",
                json={"restore_pinned_at": original[middle]})

    rows = client.get("/api/pinned").json()
    assert [row["content"] for row in rows] == ["Newest", "Middle", "Oldest"]
    assert rows[1]["pinned_at"] == original[middle]


def test_pinning_without_a_body_stamps_the_current_time(client):
    _, (entry_id,) = _fixture(client, ["No body sent"])
    # The control posts an explicit null; a bare post must behave the same.
    bare = client.post(f"/api/entries/{entry_id}/pin").json()
    assert bare["pinned"] is True and bare["pinned_at"] is not None


def test_pinning_an_unknown_entry_is_a_404(client):
    assert client.post("/api/entries/999999/pin").status_code == 404


def test_the_strip_needs_a_session_when_auth_is_on(auth_client):
    assert auth_client.get("/api/pinned").status_code == 401
    assert auth_client.post("/api/entries/1/pin").status_code == 401
