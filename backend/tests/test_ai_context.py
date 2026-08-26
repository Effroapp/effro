"""
What the AI is allowed to know.

The grounded features - the area overview, the thread summary, the nightly
refresh and the weekly roundup - all read their material through ai_context.
That is deliberate, and this file is what keeps it true.

Two things went wrong before it existed, and both are the same mistake. The
reference card feature landed and immediately starved the area overview,
because three attached files are three of the most recent entries and the
summariser had no idea it should skip them. The weekly roundup only ever
queried to-dos and decisions, so a Blocked item, a meeting and every type a
user had made for themselves were invisible in the one place meant to tell
them how their week went.

So the tests below are not really about ai_context's functions. They are about
the promise that a new kind of content reaches every prompt at once.
"""
import io

import pytest


def _area(client, name="Delivery"):
    r = client.post("/api/areas", json={"name": name})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _thread(client, area_id, title="A thread"):
    r = client.post(f"/api/areas/{area_id}/threads", json={"title": title})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _entry(client, thread_id, **payload):
    r = client.post(f"/api/threads/{thread_id}/entries", json=payload)
    assert r.status_code in (200, 201), r.text
    return r.json()


@pytest.fixture
def thread_id(client):
    return _thread(client, _area(client))


@pytest.fixture
def db_session(client):
    """A session on the same throwaway database the client is using."""
    import database  # noqa: PLC0415 (the app is imported per-module, see conftest)
    session = database.SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _thread_ids(db_session):
    import models  # noqa: PLC0415
    return [row.id for row in db_session.query(models.Thread.id).all()]


def _long_ago(db_session):
    from datetime import datetime, timedelta  # noqa: PLC0415
    return datetime.utcnow() - timedelta(days=365)


# ── The whole taxonomy reaches a prompt ──────────────────────────────────────

def test_every_built_in_type_is_counted_under_its_own_label(client, db_session, thread_id):
    """One entry of every built-in type, and every one of them is seen.

    Keyed by label rather than by the stored type value, so this also proves a
    type added to TYPE_LABELS arrives in the roundup with nothing else changed.
    """
    from ai_context import entries_logged  # noqa: PLC0415
    from entry_text import TYPE_LABELS  # noqa: PLC0415

    for type_value in TYPE_LABELS:
        payload = {"type": type_value, "content": f"An entry of type {type_value}"}
        if type_value == "meeting":
            payload["meeting_at"] = "2099-01-01T10:00"
        _entry(client, thread_id, **payload)

    logged = entries_logged(db_session, _thread_ids(db_session), _long_ago(db_session))

    missing = [label for label in TYPE_LABELS.values() if label not in logged]
    assert not missing, (
        f"{missing} never reach an AI prompt. Every entry type has to be visible "
        "to the roundup, so either entry_label knows it or it is being silently "
        "folded into another type."
    )
    # Distinct labels, or two kinds of entry would be reported as one.
    assert len(set(TYPE_LABELS.values())) == len(TYPE_LABELS)


def test_a_users_own_type_appears_under_its_own_name(client, db_session, thread_id):
    """A custom type is the case that motivated all of this."""
    from ai_context import entries_logged, week_highlights  # noqa: PLC0415

    made = client.post("/api/entry-types", json={
        "name": "Risk", "icon": "flag", "colour": "sage",
    })
    assert made.status_code in (200, 201), made.text
    _entry(client, thread_id, type="custom", custom_type_id=made.json()["id"],
           content="Cable order may slip past the energisation date")

    ids = _thread_ids(db_session)
    logged = entries_logged(db_session, ids, _long_ago(db_session))
    assert logged.get("Risk") == 1, (
        f"a user's own type is invisible to the roundup: {logged}"
    )

    highlights = week_highlights(db_session, ids, _long_ago(db_session))
    assert any("[Risk]" in line for line in highlights), highlights


def test_blocked_items_reach_the_roundup(client, db_session, thread_id):
    """The most important thing in a week used not to be gathered at all."""
    from ai_context import week_highlights  # noqa: PLC0415

    _entry(client, thread_id, type="blockage",
           content="Waiting on the DNO to confirm the earthing design")

    highlights = week_highlights(db_session, _thread_ids(db_session), _long_ago(db_session))
    assert any("[Blocked]" in line and "DNO" in line for line in highlights), highlights


# ── References are known about, not quoted ───────────────────────────────────

def test_references_are_tallied_and_kept_out_of_the_prose(client, db_session, thread_id):
    """An attached file must not push a thread's actual work out of its summary."""
    from ai_context import recent_entries_for_prompt, reference_line, reference_tally  # noqa: PLC0415

    _entry(client, thread_id, type="entry", content="The work this thread is actually about")
    for name in ("one.txt", "two.txt", "three.txt"):
        r = client.post(f"/api/threads/{thread_id}/attachments/file",
                        files={"file": (name, io.BytesIO(b"x"), "text/plain")})
        assert r.status_code in (200, 201), r.text

    # Three files are the three most recent entries. Asking for three has to
    # still return the work.
    recent = recent_entries_for_prompt(db_session, [thread_id], 3)
    assert [e.type for e in recent] == ["entry"], [e.type for e in recent]
    assert "actually about" in recent[0].content

    tally = reference_tally(db_session, [thread_id])
    assert tally == {"File attached": 3}, tally
    assert reference_line(tally) == "File attached x3"


def test_references_are_not_counted_twice(client, db_session, thread_id):
    """They belong to the tally, not to the list of what the user wrote.

    Both would carry the same numbers under the same names, and a model reading
    "File attached: 1" among things the user wrote would report it as one.
    """
    from ai_context import entries_logged  # noqa: PLC0415

    r = client.post(f"/api/threads/{thread_id}/attachments/file",
                    files={"file": ("only.txt", io.BytesIO(b"x"), "text/plain")})
    assert r.status_code in (200, 201), r.text

    logged = entries_logged(db_session, [thread_id], _long_ago(db_session))
    assert not any("attached" in k.lower() or "added" in k.lower() for k in logged), logged


def test_reference_line_is_empty_when_there_is_nothing(db_session):
    from ai_context import reference_line, reference_tally  # noqa: PLC0415
    assert reference_line(reference_tally(db_session, [])) == ""


# ── Pins ─────────────────────────────────────────────────────────────────────

def test_what_is_in_hand_reaches_the_roundup(client, db_session, thread_id):
    """Nothing else in the data says which open item the person considers live."""
    from ai_context import in_hand  # noqa: PLC0415

    entry = _entry(client, thread_id, type="todo", content="Reissue the earthing drawings")
    r = client.post(f"/api/entries/{entry['id']}/pin")
    assert r.status_code in (200, 201), r.text

    pinned = in_hand(db_session, _thread_ids(db_session))
    assert any("earthing drawings" in line for line in pinned), pinned


# ── To-dos are counted, not quoted ───────────────────────────────────────────

def test_todos_are_left_out_of_highlights(client, db_session, thread_id):
    """They are counted opened and completed, and would otherwise be the list."""
    from ai_context import week_highlights  # noqa: PLC0415

    _entry(client, thread_id, type="todo", content="A task that should not be quoted")
    highlights = week_highlights(db_session, _thread_ids(db_session), _long_ago(db_session))
    assert not any("should not be quoted" in line for line in highlights), highlights


def test_subtasks_are_left_out_of_a_summary(client, db_session, thread_id):
    """A summary wants the task, not its breakdown."""
    from ai_context import recent_entries_for_prompt  # noqa: PLC0415

    parent = _entry(client, thread_id, type="todo", content="Parent task")
    r = client.post(f"/api/entries/{parent['id']}/subtasks",
                    json={"subtasks": [{"title": "A subtask nobody should summarise"}]})
    assert r.status_code in (200, 201), r.text

    recent = recent_entries_for_prompt(db_session, [thread_id], 20)
    assert not any("nobody should summarise" in (e.content or "") for e in recent)


# ── The endpoint the roundup prompt is built from ────────────────────────────

def test_the_roundup_payload_carries_the_whole_week(client):
    """End to end: what /api/roundup hands the model.

    This is the shape generate_roundup json-dumps into the prompt, so a field
    missing here is a field the model never sees.
    """
    area_id = _area(client, "Substation delivery")
    tid = _thread(client, area_id, "Earthing design")

    # The client fixture is module-scoped, so Risk may already exist from an
    # earlier test. Either way it is the type this area's entry wears.
    made = client.post("/api/entry-types", json={
        "name": "Risk", "icon": "shield", "colour": "dusk",
    })
    if made.status_code == 409:
        risk_id = next(t["id"] for t in client.get("/api/entry-types").json()
                       if t["name"] == "Risk")
    else:
        assert made.status_code in (200, 201), made.text
        risk_id = made.json()["id"]

    _entry(client, tid, type="decision", content="Ship the revised drawings first")
    _entry(client, tid, type="blockage", content="DNO has not confirmed the date")
    _entry(client, tid, type="custom", custom_type_id=risk_id,
           content="The cable order may slip")
    todo = _entry(client, tid, type="todo", content="Reissue the drawings")
    client.post(f"/api/entries/{todo['id']}/pin")
    client.post(f"/api/threads/{tid}/attachments/file",
                files={"file": ("spec.pdf", io.BytesIO(b"x"), "application/pdf")})

    data = client.get("/api/roundup").json()
    area = next(a for a in data["areas"] if a["area_id"] == area_id)

    assert area["logged"].get("Decision") == 1, area["logged"]
    assert area["logged"].get("Blocked") == 1, area["logged"]
    assert area["logged"].get("Risk") == 1, area["logged"]
    assert area["logged"].get("To Do") == 1, area["logged"]

    joined = " | ".join(area["highlights"])
    assert "[Decision]" in joined and "[Blocked]" in joined and "[Risk]" in joined, joined

    assert area["references_added"] == {"File attached": 1}, area["references_added"]
    assert any("Reissue the drawings" in line for line in area["in_hand"]), area["in_hand"]
    assert area["has_activity"] is True


def test_an_area_with_nothing_in_it_reports_nothing(client):
    """The roundup must not invent activity for a quiet area."""
    area_id = _area(client, "Dormant programme")

    data = client.get("/api/roundup").json()
    area = next(a for a in data["areas"] if a["area_id"] == area_id)

    assert area["logged"] == {}
    assert area["highlights"] == []
    assert area["references_added"] == {}
    assert area["in_hand"] == []
    assert area["has_activity"] is False


# ── Insights ─────────────────────────────────────────────────────────────────

def test_a_day_of_a_users_own_type_is_not_a_blank_day(client):
    """Insights counted five hardcoded types, so a day of Risks read as nothing.

    The comment above that code says the intent plainly: capturing updates,
    adding to-dos and making decisions is all real work and "0 done" never
    means a quiet day. A type the user made for themselves is real work too.
    """
    area_id = _area(client, "Insights area")
    tid = _thread(client, area_id, "A thread with risks")

    made = client.post("/api/entry-types", json={
        "name": "Risk", "icon": "flag", "colour": "sage",
    })
    if made.status_code == 409:
        risk = next(t for t in client.get("/api/entry-types").json() if t["name"] == "Risk")
    else:
        assert made.status_code in (200, 201), made.text
        risk = made.json()

    before = client.get("/api/insights/today?tz_offset_min=0").json()
    baseline = before["headline_count"]
    # The client fixture is module-scoped, so earlier tests may already have
    # logged a Risk. Count the movement, not the total.
    was = next((c["count"] for c in before["breakdown"]
                if c["type"].startswith("custom:")), 0)

    for i in range(3):
        _entry(client, tid, type="custom", custom_type_id=risk["id"],
               content=f"A risk worth writing down, number {i}")

    after = client.get("/api/insights/today?tz_offset_min=0").json()

    assert after["headline_count"] == baseline + 3, (
        f"three risks logged and the headline moved from {baseline} to "
        f"{after['headline_count']}"
    )

    chip = next((c for c in after["breakdown"] if c["type"].startswith("custom:")), None)
    assert chip is not None, after["breakdown"]
    assert chip["count"] == was + 3 and "risk" in chip["label"], chip
    # Its own colour and icon travel with it, or it renders as a to-do.
    assert chip["colour"] == risk["colour"], chip
    assert chip["icon"] == risk["icon"], chip

    assert any(d["type"] == "custom" for d in after["done_items"]), (
        "the chip says three risks were logged and the details show none"
    )
