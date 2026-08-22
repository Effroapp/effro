"""
The upgrade path for user_prefs.

A database written by a build that predates the table has to gain it on the next
launch, with everything already in it untouched. This module builds its own
clients rather than using the shared fixture, because it deliberately reboots
the app against the same data directory twice.
"""
import os
import sqlite3

from conftest import build_client


def test_an_existing_database_gains_the_table_on_the_next_boot(tmp_path):
    with build_client(tmp_path, auth_enabled=False) as c:
        c.put("/api/prefs", json={"onboarding.completed_version": "v1"})
        assert c.post("/api/areas", json={"name": "Kept"}).status_code in (200, 201)

    db_path = os.environ["DB_PATH"]

    # Rewind to the pre-prefs schema.
    con = sqlite3.connect(db_path)
    try:
        con.execute("DROP TABLE user_prefs")
        con.commit()
    finally:
        con.close()

    with build_client(tmp_path, auth_enabled=False) as c:
        # The table is back, empty, and the surrounding content is intact.
        assert c.get("/api/prefs").json() == {}
        assert any(a["name"] == "Kept" for a in c.get("/api/areas").json())
        assert c.put("/api/prefs", json={"back": "again"}).status_code == 200
        assert c.get("/api/prefs").json()["back"] == "again"


def test_prefs_survive_a_restart(tmp_path):
    """The whole point of the table: state written in one launch is still there
    in the next, which is what the desktop cache bust used to destroy."""
    avatar = "data:image/png;base64," + ("A" * 200_000)

    with build_client(tmp_path, auth_enabled=False) as c:
        c.put("/api/prefs", json={
            "onboarding.completed_version": "v1",
            "profile.display_name": "Luke Keogh",
            "profile.avatar": avatar,
            "intro.effro.signalsIntroSeen": True,
        })

    with build_client(tmp_path, auth_enabled=False) as c:
        assert c.get("/api/prefs").json() == {
            "onboarding.completed_version": "v1",
            "profile.display_name": "Luke Keogh",
            "profile.avatar": avatar,
            "intro.effro.signalsIntroSeen": True,
        }
