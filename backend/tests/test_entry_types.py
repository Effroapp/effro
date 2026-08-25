"""
User-defined entry types.

Covers the contract the composer depends on: types are created, named
uniquely case-insensitively, renamed freely, and deleting one converts its
entries to Updates rather than taking them with it. Also that an entry of type
'custom' cannot exist without a real type behind it.
"""
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
def thread_id(client):
    return _thread(client, _area(client))


@pytest.fixture(autouse=True)
def no_types_carried_over(client):
    """The client fixture is module-scoped, so start each test with none.

    Tolerant of a non-list body, because the auth-on test in this module runs
    against a different app on a different database and has nothing to clear.
    """
    body = client.get("/api/entry-types").json()
    if isinstance(body, list):
        for t in body:
            client.delete(f"/api/entry-types/{t['id']}")


def _make(client, name="Risk", colour="plum"):
    r = client.post("/api/entry-types", json={"name": name, "colour": colour})
    assert r.status_code == 201, r.text
    return r.json()


def test_create_then_list(client):
    made = _make(client, "Risk", "plum")
    assert made["name"] == "Risk"
    assert made["colour"] == "plum"

    _make(client, "Question", "seafoam")
    listed = client.get("/api/entry-types").json()
    # Ordered by name, and each reports how many entries use it.
    assert [t["name"] for t in listed] == ["Question", "Risk"]
    assert all(t["usage_count"] == 0 for t in listed)


def test_a_name_is_trimmed_and_bounded(client):
    assert client.post("/api/entry-types",
                       json={"name": "  Risk  ", "colour": "sage"}).json()["name"] == "Risk"
    assert client.post("/api/entry-types",
                       json={"name": "   ", "colour": "sage"}).status_code == 422
    assert client.post("/api/entry-types",
                       json={"name": "x" * 25, "colour": "sage"}).status_code == 422


def test_a_duplicate_name_is_rejected_case_insensitively(client):
    _make(client, "Risk")
    clash = client.post("/api/entry-types", json={"name": "risk", "colour": "sage"})
    assert clash.status_code == 409
    assert clash.json()["detail"] == "You already have a type called Risk"


def test_an_unknown_colour_is_rejected(client):
    assert client.post("/api/entry-types",
                       json={"name": "Risk", "colour": "chartreuse"}).status_code == 422


def test_the_built_in_type_colours_are_not_on_offer(client):
    """A custom type painted terracotta would read as a Blocked entry."""
    for taken in ("mint", "sky", "amber", "lavender", "terracotta", "mustard"):
        r = client.post("/api/entry-types", json={"name": f"T {taken}", "colour": taken})
        assert r.status_code == 422, f"{taken} should not be offered"


def test_rename_is_free_and_keeps_the_entries(client, thread_id):
    made = _make(client, "Risk")
    client.post(f"/api/threads/{thread_id}/entries",
                json={"content": "A risk", "type": "custom", "custom_type_id": made["id"]})

    renamed = client.put(f"/api/entry-types/{made['id']}", json={"name": "Concern"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Concern"
    assert client.get("/api/entry-types").json()[0]["usage_count"] == 1


def test_renaming_onto_an_existing_name_is_rejected(client):
    _make(client, "Risk")
    other = _make(client, "Question", "seafoam")
    assert client.put(f"/api/entry-types/{other['id']}",
                      json={"name": "RISK"}).status_code == 409
    # Renaming a type to its own name is a no-op, not a clash with itself.
    assert client.put(f"/api/entry-types/{other['id']}",
                      json={"name": "Question"}).status_code == 200


def test_delete_converts_its_entries_to_updates_and_counts_them(client, thread_id):
    made = _make(client, "Risk")
    ids = []
    for text in ("First risk", "Second risk"):
        r = client.post(f"/api/threads/{thread_id}/entries",
                        json={"content": text, "type": "custom",
                              "custom_type_id": made["id"]})
        ids.append(r.json()["id"])

    gone = client.delete(f"/api/entry-types/{made['id']}")
    assert gone.status_code == 200
    assert gone.json() == {"converted": 2}
    assert client.get("/api/entry-types").json() == []

    # The entries survive as plain Updates with no dangling link.
    entries = {e["id"]: e for e in client.get(f"/api/threads/{thread_id}").json()["entries"]}
    for entry_id in ids:
        assert entries[entry_id]["type"] == "entry"
        assert entries[entry_id]["custom_type_id"] is None


def test_a_custom_entry_needs_a_real_type(client, thread_id):
    missing = client.post(f"/api/threads/{thread_id}/entries",
                          json={"content": "Orphan", "type": "custom"})
    assert missing.status_code == 422

    unknown = client.post(f"/api/threads/{thread_id}/entries",
                          json={"content": "Orphan", "type": "custom",
                                "custom_type_id": 999999})
    assert unknown.status_code == 422


def test_a_non_custom_entry_never_keeps_a_custom_type(client, thread_id):
    made = _make(client, "Risk")
    r = client.post(f"/api/threads/{thread_id}/entries",
                    json={"content": "A plain update", "type": "entry",
                          "custom_type_id": made["id"]})
    assert r.json()["custom_type_id"] is None


def test_thread_get_carries_the_custom_type_on_the_entry(client, thread_id):
    made = _make(client, "Risk", "plum")
    client.post(f"/api/threads/{thread_id}/entries",
                json={"content": "A risk", "type": "custom", "custom_type_id": made["id"]})

    entry = client.get(f"/api/threads/{thread_id}").json()["entries"][-1]
    assert entry["type"] == "custom"
    assert entry["custom_type"] == {"id": made["id"], "name": "Risk", "colour": "plum"}


def test_switching_type_moves_the_custom_link_with_it(client, thread_id):
    made = _make(client, "Risk")
    entry_id = client.post(f"/api/threads/{thread_id}/entries",
                           json={"content": "Started plain", "type": "entry"}).json()["id"]

    became = client.put(f"/api/entries/{entry_id}",
                        json={"type": "custom", "custom_type_id": made["id"]}).json()
    assert became["type"] == "custom"
    assert became["custom_type"]["name"] == "Risk"

    # Switching away clears the link rather than leaving a stale label.
    back = client.put(f"/api/entries/{entry_id}", json={"type": "entry"}).json()
    assert back["custom_type_id"] is None
    assert back["custom_type"] is None

    # And switching to custom without an id is refused.
    assert client.put(f"/api/entries/{entry_id}", json={"type": "custom"}).status_code == 422


def test_entry_types_need_a_session_when_auth_is_on(auth_client):
    assert auth_client.get("/api/entry-types").status_code == 401
    assert auth_client.post("/api/entry-types",
                            json={"name": "Risk", "colour": "sage"}).status_code == 401
