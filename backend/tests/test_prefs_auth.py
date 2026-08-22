"""
/api/prefs in hosted mode (EFFRO_AUTH_ENABLED on).

The point of keying prefs by user: two people on one deployment each get their
own onboarding, name and photo, and neither can see the other's.
"""
ADMIN = {"email": "a@example.com", "password": "correct horse battery staple"}
MEMBER = {"email": "b@example.com", "password": "another good passphrase"}


def _sign_in(client, who):
    client.post("/api/auth/logout")
    r = client.post("/api/auth/login", json=who)
    assert r.status_code == 200, r.text


def test_prefs_are_gated_before_sign_in(auth_client):
    assert auth_client.get("/api/prefs").status_code == 401
    assert auth_client.put("/api/prefs", json={"x": 1}).status_code == 401


def test_each_user_gets_their_own_prefs(auth_client):
    r = auth_client.post("/api/auth/setup", json={**ADMIN, "display_name": "A"})
    assert r.status_code in (200, 201), r.text

    # Setup leaves the admin signed in.
    auth_client.put("/api/prefs", json={
        "onboarding.completed_version": "v1",
        "profile.display_name": "A",
    })

    # Add the second person directly, which is what an invite ends up doing.
    import auth_utils
    from database import SessionLocal
    from models import User
    db = SessionLocal()
    try:
        db.add(User(
            email=MEMBER["email"],
            display_name="B",
            role="member",
            password_hash=auth_utils.hash_password(MEMBER["password"]),
            is_active=True,
        ))
        db.commit()
    finally:
        db.close()

    _sign_in(auth_client, MEMBER)
    # A brand new person starts empty, so they see onboarding once, on their own.
    assert auth_client.get("/api/prefs").json() == {}

    auth_client.put("/api/prefs", json={"profile.display_name": "B"})
    assert auth_client.get("/api/prefs").json() == {"profile.display_name": "B"}

    _sign_in(auth_client, ADMIN)
    assert auth_client.get("/api/prefs").json() == {
        "onboarding.completed_version": "v1",
        "profile.display_name": "A",
    }


def test_gdpr_export_carries_the_users_own_prefs(auth_client):
    _sign_in(auth_client, ADMIN)
    payload = auth_client.get("/api/account/export").json()
    keys = {p["key"] for p in payload["prefs"]}
    assert keys == {"onboarding.completed_version", "profile.display_name"}
    assert all(p["user_id"] == payload["user"]["id"] for p in payload["prefs"])
