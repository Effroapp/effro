"""
GET/PUT /api/prefs in desktop mode (auth off).

Covers the contract the frontend prefs store depends on: a partial PUT merges,
null deletes, values keep their JSON type, and an avatar-sized payload goes
through without complaint.
"""
import os
import sqlite3

import pytest


def test_empty_database_returns_an_empty_dict(client):
    r = client.get("/api/prefs")
    assert r.status_code == 200
    assert r.json() == {}


def test_put_stores_and_returns_the_full_set(client):
    r = client.put("/api/prefs", json={
        "onboarding.completed_version": "v1",
        "profile.display_name": "Luke Keogh",
        "intro.effro.signalsIntroSeen": True,
    })
    assert r.status_code == 200
    assert r.json() == {
        "onboarding.completed_version": "v1",
        "profile.display_name": "Luke Keogh",
        "intro.effro.signalsIntroSeen": True,
    }


def test_values_keep_their_json_type(client):
    client.put("/api/prefs", json={"an_object": {"a": 1, "b": [1, 2]}, "a_number": 3})
    body = client.get("/api/prefs").json()
    assert body["an_object"] == {"a": 1, "b": [1, 2]}
    assert body["a_number"] == 3


def test_a_partial_put_leaves_other_keys_alone(client):
    client.put("/api/prefs", json={"onboarding.completed_version": "v1",
                                   "profile.display_name": "Luke Keogh"})
    body = client.put("/api/prefs", json={"profile.display_name": "Luke"}).json()
    assert body["profile.display_name"] == "Luke"
    assert body["onboarding.completed_version"] == "v1"


def test_null_deletes_a_key_and_deleting_twice_is_harmless(client):
    client.put("/api/prefs", json={"scratch": "value"})
    body = client.put("/api/prefs", json={"scratch": None}).json()
    assert "scratch" not in body

    r = client.put("/api/prefs", json={"scratch": None})
    assert r.status_code == 200
    assert "scratch" not in r.json()


def test_an_avatar_sized_value_is_accepted_intact(client):
    # Avatars arrive as base64 data URLs and can approach a megabyte.
    avatar = "data:image/png;base64," + ("A" * 1_000_000)
    assert client.put("/api/prefs", json={"profile.avatar": avatar}).status_code == 200
    assert client.get("/api/prefs").json()["profile.avatar"] == avatar


@pytest.mark.parametrize("payload,expected", [
    ({"profile.avatar": "x" * (5 * 1024 * 1024)}, 413),   # past the per-value ceiling
    ({"k" * 200: "x"}, 400),                              # key longer than the column
    ({"": "x"}, 400),                                     # empty key
])
def test_bad_input_is_rejected(client, payload, expected):
    assert client.put("/api/prefs", json=payload).status_code == expected


def test_a_non_object_body_is_rejected(client):
    assert client.put("/api/prefs", json=["not", "a", "dict"]).status_code in (400, 422)


def test_the_table_has_the_expected_shape(client):
    """user_prefs is created by create_all on boot, the way the repo adds every
    new table (no Alembic). Check the shape the router relies on."""
    con = sqlite3.connect(os.environ["DB_PATH"])
    try:
        columns = {row[1] for row in con.execute("PRAGMA table_info(user_prefs)")}
        # PRAGMA index_list columns: (seq, name, unique, origin, partial)
        indexes = con.execute("PRAGMA index_list(user_prefs)").fetchall()
    finally:
        con.close()

    assert columns == {"id", "user_id", "key", "value", "updated_at"}
    assert any(row[2] for row in indexes), "expected a unique index on (user_id, key)"


def test_writing_the_same_key_twice_upserts_rather_than_duplicating(client):
    """The unique constraint on (user_id, key) is what makes PUT an upsert
    instead of a growing pile of rows."""
    client.put("/api/prefs", json={"dupe.check": "first"})
    client.put("/api/prefs", json={"dupe.check": "second"})

    con = sqlite3.connect(os.environ["DB_PATH"])
    try:
        rows = con.execute("SELECT value FROM user_prefs WHERE key = 'dupe.check'").fetchall()
    finally:
        con.close()

    assert len(rows) == 1
    assert client.get("/api/prefs").json()["dupe.check"] == "second"
