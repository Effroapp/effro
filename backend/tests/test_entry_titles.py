"""
Entry titles.

The load-bearing rule is that a title the user wrote is never overwritten. An
AI suggestion may only replace a fallback, and a content edit may only
re-derive a fallback, so someone who has bothered to name an entry keeps that
name whatever else happens to it.
"""
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
def thread_id(client):
    return _thread(client, _area(client))


@pytest.fixture
def stub_ai(monkeypatch):
    """Swap the AI provider in a way that survives a module reload.

    routers.generate binds get_provider at import time, and the backfill test
    rebuilds the app, which replaces that module. Patching generate's own name
    would then land on a copy the running app no longer uses. ai_provider is
    never purged, so patching its factory reaches whichever copy is live.
    """
    def use(provider):
        import ai_provider
        monkeypatch.setattr(ai_provider, "_build_provider", lambda config: provider)
    return use


def _add(client, thread_id, **payload):
    payload.setdefault("content", "A reasonably long entry body to work from")
    payload.setdefault("type", "entry")
    r = client.post(f"/api/threads/{thread_id}/entries", json=payload)
    assert r.status_code in (200, 201), r.text
    return r.json()


# ── The fallback rule ─────────────────────────────────────────────────────────

def test_fallback_title_strips_markdown_and_takes_the_first_line():
    from entry_text import fallback_title
    assert fallback_title("## A **bold** heading\nand more") == "A bold heading"
    assert fallback_title("- [link](http://x) item") == "link item"
    assert fallback_title("> quoted line") == "quoted line"


def test_fallback_title_cuts_a_long_line_on_a_word_boundary():
    from entry_text import fallback_title
    got = fallback_title("word " * 40)
    assert len(got) <= 60
    assert got.endswith("word")


def test_fallback_title_has_something_to_say_about_nothing():
    from entry_text import fallback_title
    assert fallback_title("") == "Untitled"
    assert fallback_title("   \n\n  ") == "Untitled"


# ── Create ────────────────────────────────────────────────────────────────────

def test_create_without_a_title_gets_a_fallback(client, thread_id):
    entry = _add(client, thread_id, content="Supplier may miss the cutover window")
    assert entry["title"] == "Supplier may miss the cutover window"
    assert entry["title_source"] == "fallback"


def test_create_with_a_title_records_the_user(client, thread_id):
    entry = _add(client, thread_id, title="  Cutover   risk  ")
    # Trimmed and single-spaced on the way in.
    assert entry["title"] == "Cutover risk"
    assert entry["title_source"] == "user"


def test_create_may_claim_an_ai_title(client, thread_id):
    entry = _add(client, thread_id, title="Cutover risk", title_source="ai")
    assert entry["title_source"] == "ai"


def test_a_client_cannot_claim_any_other_source(client, thread_id):
    entry = _add(client, thread_id, title="Cutover risk", title_source="fallback")
    assert entry["title_source"] == "user"


def test_a_todo_carries_a_short_form(client, thread_id):
    """A to-do gets a title so the compact lists have something that fits, but
    it is generated from what the user typed rather than asked for."""
    wordy = ("Chase the venue about parking access for the away day in "
             "September, before they let the block go")
    entry = _add(client, thread_id, type="todo", content=wordy)
    assert entry["title_source"] == "fallback"
    assert len(entry["title"]) <= 60


def test_a_meeting_carries_no_title(client, thread_id):
    """A meeting is named by its own title field, so it takes no second one."""
    entry = _add(client, thread_id, type="meeting", title="Ignore me")
    assert entry["title"] is None
    assert entry["title_source"] is None


def test_a_title_is_capped(client, thread_id):
    entry = _add(client, thread_id, title="x " * 200)
    assert len(entry["title"]) <= 120


# ── Update ────────────────────────────────────────────────────────────────────

def test_a_content_edit_recomputes_a_fallback_title(client, thread_id):
    entry = _add(client, thread_id, content="The first version of this entry")
    updated = client.put(f"/api/entries/{entry['id']}",
                         json={"content": "A completely different second version"}).json()
    assert updated["title"] == "A completely different second version"
    assert updated["title_source"] == "fallback"


def test_a_content_edit_leaves_a_user_title_alone(client, thread_id):
    entry = _add(client, thread_id, title="My own name for this")
    updated = client.put(f"/api/entries/{entry['id']}",
                         json={"content": "Rewritten entirely"}).json()
    assert updated["title"] == "My own name for this"
    assert updated["title_source"] == "user"


def test_an_ai_title_is_ignored_when_the_user_wrote_one(client, thread_id):
    entry = _add(client, thread_id, title="My own name for this")
    updated = client.put(f"/api/entries/{entry['id']}",
                         json={"title": "A suggested name", "title_source": "ai"}).json()
    assert updated["title"] == "My own name for this"
    assert updated["title_source"] == "user"


def test_an_ai_title_replaces_a_fallback(client, thread_id):
    entry = _add(client, thread_id)
    assert entry["title_source"] == "fallback"
    updated = client.put(f"/api/entries/{entry['id']}",
                         json={"title": "A suggested name", "title_source": "ai"}).json()
    assert updated["title"] == "A suggested name"
    assert updated["title_source"] == "ai"


def test_clearing_a_title_recomputes_the_fallback(client, thread_id):
    entry = _add(client, thread_id, content="The body of the entry",
                 title="My own name for this")
    cleared = client.put(f"/api/entries/{entry['id']}", json={"title": ""}).json()
    assert cleared["title"] == "The body of the entry"
    assert cleared["title_source"] == "fallback"


def test_a_user_title_can_replace_an_ai_one(client, thread_id):
    entry = _add(client, thread_id, title="Suggested", title_source="ai")
    updated = client.put(f"/api/entries/{entry['id']}", json={"title": "Mine"}).json()
    assert updated["title"] == "Mine"
    assert updated["title_source"] == "user"


# ── Type changes ──────────────────────────────────────────────────────────────

def test_changing_out_of_a_titled_type_drops_the_title(client, thread_id):
    entry = _add(client, thread_id, title="A decision I made", type="decision")
    became = client.put(f"/api/entries/{entry['id']}", json={"type": "meeting"}).json()
    assert became["title"] is None
    assert became["title_source"] is None


def test_changing_into_a_titled_type_gains_a_fallback(client, thread_id):
    entry = _add(client, thread_id, type="meeting", content="Chase the venue about parking")
    assert entry["title"] is None
    became = client.put(f"/api/entries/{entry['id']}", json={"type": "decision"}).json()
    assert became["title"] == "Chase the venue about parking"
    assert became["title_source"] == "fallback"


def test_a_blocked_entry_carries_a_title(client, thread_id):
    """A blocker can run to a paragraph, so it earns a one-line name the same
    way an Update does. A To Do does not, being one line already."""
    entry = _add(client, thread_id, type="blockage",
                 content="Their IT team have not granted staging access and the "
                         "ticket has been open for three weeks with no owner")
    assert entry["title_source"] == "fallback"
    named = client.put(f"/api/entries/{entry['id']}",
                       json={"title": "Waiting on their IT for staging"}).json()
    assert named["title"] == "Waiting on their IT for staging"
    assert named["title_source"] == "user"


def test_a_custom_entry_carries_a_title(client, thread_id):
    made = client.post("/api/entry-types",
                       json={"name": "Risk", "colour": "plum"}).json()
    entry = _add(client, thread_id, type="custom", custom_type_id=made["id"],
                 title="Cutover risk")
    assert entry["title"] == "Cutover risk"
    assert entry["title_source"] == "user"
    client.delete(f"/api/entry-types/{made['id']}")


# ── The suggestion endpoint ───────────────────────────────────────────────────

def test_short_content_is_refused(client):
    r = client.post("/api/generate/title", json={"content": "too short"})
    assert r.status_code == 422


def test_a_short_todo_is_refused_because_it_already_fits(client):
    """Shortening a to-do that fits would spend a call to make it no better."""
    # 41 characters: over the prose floor of 20, under the to-do floor of 60.
    short = "Renew the professional indemnity insurance"
    assert client.post("/api/generate/title",
                       json={"content": short, "type": "todo"}).status_code == 422
    # The same text is long enough for a prose entry, which is named from much
    # less than it takes to be worth shortening.
    assert client.post("/api/generate/title",
                       json={"content": short}).status_code != 422


def test_an_unconfigured_engine_says_so(client, stub_ai):
    import ai_provider

    stub_ai(ai_provider._UnconfiguredProvider("nope"))
    r = client.post("/api/generate/title",
                    json={"content": "A long enough entry to want a title for"})
    assert r.status_code == 503
    assert r.json()["detail"] == "AI isn't set up yet"


def test_a_configured_engine_returns_a_tidied_title(client, stub_ai):
    class _Stub:
        # Models like to wrap the answer in quotes and end with a full stop
        # however firmly the system prompt says not to.
        def complete(self, system, messages, max_tokens=40):
            return '  "Cutover risk for the supplier."  '

    stub_ai(_Stub())
    r = client.post("/api/generate/title",
                    json={"content": "A long enough entry to want a title for"})
    assert r.status_code == 200
    assert r.json()["title"] == "Cutover risk for the supplier"


def test_an_empty_reply_is_a_502(client, stub_ai):
    class _Stub:
        def complete(self, system, messages, max_tokens=40):
            return "   "

    stub_ai(_Stub())
    r = client.post("/api/generate/title",
                    json={"content": "A long enough entry to want a title for"})
    assert r.status_code == 502
    assert r.json()["detail"] == "No title came back"


# ── The backfill ──────────────────────────────────────────────────────────────

def test_the_backfill_fills_legacy_rows_once(client, thread_id):
    """A row written before the column existed gets a fallback on next boot,
    and a second boot leaves it exactly as it is."""
    from tests.conftest import build_client

    entry = _add(client, thread_id, content="An entry from before titles existed",
                 title="A title the user wrote")
    db_path = os.environ["DB_PATH"]

    # Rewind it to look legacy: a titled type carrying no title.
    con = sqlite3.connect(db_path)
    con.execute("UPDATE entries SET title = NULL, title_source = NULL WHERE id = ?",
                (entry["id"],))
    con.commit()
    con.close()

    def boot():
        with build_client(pathlib.Path(db_path).parent, auth_enabled=False):
            pass

    def read():
        con = sqlite3.connect(db_path)
        row = con.execute("SELECT title, title_source FROM entries WHERE id = ?",
                          (entry["id"],)).fetchone()
        con.close()
        return row

    boot()
    filled = read()
    assert filled == ("An entry from before titles existed", "fallback")

    # A second run must change nothing.
    boot()
    assert read() == filled


# ── Naming what is still on a fallback ────────────────────────────────────────

def test_the_backlog_lists_only_what_is_worth_naming(client, thread_id):
    """A short entry already reads fine, and a named one is not up for grabs."""
    wordy_todo = ("Chase the venue about parking access for the away day in "
                  "September, before they let the block go")
    wordy = _add(client, thread_id, type="todo", content=wordy_todo)
    short = _add(client, thread_id, type="todo", content="Renew the insurance")
    prose = _add(client, thread_id, content="A prose entry long enough to be worth naming")
    named = _add(client, thread_id, content="A named one that must be left alone",
                 title="I named this myself")

    mine = {wordy["id"], short["id"], prose["id"], named["id"]}
    listed = mine & set(client.get("/api/generate/title/backlog").json()["ids"])
    # The short to-do already fits and the user-named entry is not up for grabs.
    assert listed == {wordy["id"], prose["id"]}


def test_naming_one_entry_applies_it(client, thread_id, stub_ai):
    class _Stub:
        def complete(self, system, messages, max_tokens=40):
            return "Chase the venue about away-day parking"

    stub_ai(_Stub())
    wordy = ("Chase the venue about parking access for the away day in "
             "September, before they let the block go")
    entry = _add(client, thread_id, type="todo", content=wordy)

    r = client.post(f"/api/entries/{entry['id']}/title/suggest")
    assert r.status_code == 200, r.text
    result = r.json()
    assert result["changed"] is True
    assert result["title"] == "Chase the venue about away-day parking"

    # A second pass has nothing left to do, since it is no longer a fallback.
    again = client.post(f"/api/entries/{entry['id']}/title/suggest").json()
    assert again["changed"] is False


def test_a_user_title_is_never_taken_by_the_tidy_up(client, thread_id, stub_ai):
    """The server re-checks rather than trusting the list it was handed, so a
    title written after the backlog was read still wins."""
    class _Stub:
        def complete(self, system, messages, max_tokens=40):
            return "Something the model made up"

    stub_ai(_Stub())
    entry = _add(client, thread_id, content="A prose entry long enough to name",
                 title="My own words")

    result = client.post(f"/api/entries/{entry['id']}/title/suggest").json()
    assert result["changed"] is False
    assert result["title"] == "My own words"


def test_the_tidy_up_needs_an_engine(client, thread_id, stub_ai):
    import ai_provider

    entry = _add(client, thread_id, content="A prose entry long enough to name")
    stub_ai(ai_provider._UnconfiguredProvider("nope"))
    r = client.post(f"/api/entries/{entry['id']}/title/suggest")
    assert r.status_code == 503
