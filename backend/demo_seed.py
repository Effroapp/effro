"""
Reusable demo dataset for showcasing Effro.

One believable persona - Maya, a delivery / QA lead at a mid-size SaaS - with a
handful of real-feeling workstreams (Areas), strands of work (Threads), and a
mix of logged Entries (updates, to-dos, decisions, meetings, blockers). Plus
Signals to triage, heartbeat work-sessions so Insights has a working window, and
links between threads. Everything is dated RELATIVE TO NOW so Reflect/Ahead look
alive every time it is seeded.

Two entry points, both used by `scripts/seed_demo.py` (fresh file) and the admin
"Load demo data" button (running instance):
  - seed(db)            insert the dataset into an empty schema
  - reset_and_seed(db)  wipe CONTENT only (never users/settings), then seed

`reset_and_seed` is deliberately content-only: it never touches users, sessions,
app_settings, integrations or the licence, so an admin can reload the demo
without logging themselves out or losing their account.
"""
from datetime import datetime, timedelta, time

import models
from audit import create_reference_entry

DEMO_FLAG_KEY = "demo_seeded"

# Tables wiped by reset_and_seed, children first so FKs stay satisfied.
# NOTE: users / sessions / app_settings / integrations / licence are NOT here,
# and neither are nudges (seeded at startup by _init_db, not user content).
_CONTENT_MODELS = [
    "AuditLog", "ActivityEvent", "SignalItem", "Attachment", "ThreadLink",
    "Entry", "Thread", "Area", "WorkSession",
]


# entry types: entry (Update) | todo | decision | meeting | blockage
AREAS = [
    {
        "name": "Payments platform", "slug": "payments-platform", "status": "active",
        "icon": "CreditCard", "summary_days": 1,
        "summary": "Migrating card processing from the legacy gateway to Adyen. Webhooks and "
                   "tokenisation are live in staging; reconciliation and the production cutover "
                   "are the remaining risks. PCI scope review signed off last week.",
        "threads": [
            {"title": "Adyen migration", "status": "in-progress", "created": 34,
             "description": "Replace the legacy gateway with Adyen across web and mobile.",
             "summary": "Webhooks + tokenisation working in staging. Reconciliation job and the "
                        "production cutover plan are open. Targeting a low-traffic Sunday cutover.",
             "entries": [
                {"type": "decision", "content": "Go with Adyen over Braintree as the new processor.",
                 "notes": "Better EU acquiring rates, native SCA, and one integration for cards + "
                          "wallets. Braintree's payout timing didn't fit finance's close.", "created": 33},
                {"type": "entry", "content": "Webhooks landed in staging - capture, refund and "
                                             "chargeback events all verified end to end.", "created": 12},
                {"type": "todo", "content": "Build the daily settlement reconciliation job",
                 "notes": "Match Adyen settlement report against our ledger; flag mismatches over 1.00.",
                 "due": 4},
                {"type": "todo", "content": "Write the production cutover runbook", "due": 6},
                {"type": "blockage", "content": "Blocked on finance approving the cutover window",
                 "notes": "Need a confirmed low-traffic Sunday; waiting on the finance close calendar.",
                 "created": 3},
                {"type": "todo", "content": "Smoke-test Adyen webhooks in staging", "done": 0},
             ]},
            {"title": "PCI scope review", "status": "resolved", "created": 40,
             "description": "Annual PCI DSS scope review with the external assessor.",
             "entries": [
                {"type": "meeting", "content": "PCI scope walkthrough with the QSA", "meet_past": 9, "hour": 14},
                {"type": "decision", "content": "Keep SAQ-A scope by never touching raw PAN.",
                 "notes": "Adyen hosted fields keep card data out of our servers, so we stay SAQ-A.",
                 "created": 8},
                {"type": "todo", "content": "File the signed SAQ-A with the acquirer", "done": 2},
             ]},
        ],
    },
    {
        "name": "Mobile app v3", "slug": "mobile-app-v3", "status": "active",
        "icon": "Smartphone", "summary_days": 0,
        "summary": "The v3 release: offline mode, a refreshed home screen, and the Adyen card "
                   "sheet. Offline sync is in beta with the team; app-store submission is gated on "
                   "the new privacy strings and a final regression pass.",
        "threads": [
            {"title": "Offline mode", "status": "in-progress", "created": 21,
             "description": "Let people capture and read while offline; sync on reconnect.",
             "summary": "Read + capture work offline behind a flag; conflict handling for edits made "
                        "on two devices is the open question before we widen the beta.",
             "entries": [
                {"type": "entry", "content": "Offline capture working behind a feature flag - dogfooding "
                                             "with the mobile squad this week.", "created": 5},
                {"type": "todo", "content": "Decide conflict strategy for edits made on two devices",
                 "notes": "Last-write-wins is simplest but loses data; considering per-field merge.", "due": 3},
                {"type": "todo", "content": "Add an offline indicator to the header", "done": 1},
                {"type": "meeting", "content": "Offline mode design review", "meet": 2, "hour": 11},
             ]},
            {"title": "App store submission", "status": "open", "created": 9,
             "description": "Prep and submit v3 to the App Store and Play Store.",
             "entries": [
                {"type": "todo", "content": "Update privacy nutrition labels for the new analytics",
                 "due": 5},
                {"type": "todo", "content": "Capture 6.7-inch and tablet screenshots", "due": 8},
                {"type": "blockage", "content": "Blocked: Apple developer account renewal pending finance",
                 "notes": "Renewal invoice sent to finance on Monday; submission can't start until it clears.",
                 "created": 2},
             ]},
            {"title": "v3 regression pass", "status": "open", "created": 4,
             "entries": [
                {"type": "todo", "content": "Run the full regression suite on the release candidate",
                 "due": 7},
                {"type": "entry", "content": "Drafted the regression checklist from last release's "
                                             "escaped defects - 14 high-risk flows to cover.", "created": 1},
             ]},
        ],
    },
    {
        "name": "Customer portal", "slug": "customer-portal", "status": "review",
        "icon": "LayoutDashboard", "summary_days": 12,
        "summary": "Self-serve portal revamp (billing, usage, team management). The billing page "
                   "is blocked on the Adyen reconciliation work, so this area is intentionally quiet "
                   "while payments lands.",
        "threads": [
            {"title": "Billing page revamp", "status": "parked", "created": 26,
             "description": "Rebuild the billing page on the new payments data.",
             "summary": "Parked until the Adyen reconciliation job exists - the page needs trustworthy "
                        "settlement data to show balances.",
             "entries": [
                {"type": "entry", "content": "Parked pending the Adyen reconciliation job - the balance "
                                             "widget needs settled figures to be trustworthy.", "created": 12},
                {"type": "decision", "content": "Show 'pending' vs 'settled' balances separately.",
                 "notes": "Avoids the support tickets we get when an authorised-but-unsettled charge "
                          "looks like it already left the account.", "created": 13},
             ]},
            {"title": "Team management", "status": "open", "created": 18,
             "entries": [
                {"type": "todo", "content": "Spec role-based access for the team settings page", "due": 9},
                {"type": "entry", "content": "Reused the auth model's admin/member split rather than "
                                             "inventing new roles.", "created": 11},
             ]},
        ],
    },
    {
        "name": "Test & release infra", "slug": "test-release-infra", "status": "stable",
        "icon": "FlaskConical", "summary_days": 2,
        "summary": "CI, the flaky-test budget, and the release pipeline. Healthy: pipeline green, "
                   "flaky rate down to two known offenders being quarantined.",
        "threads": [
            {"title": "Flaky test cleanup", "status": "in-progress", "created": 16,
             "description": "Drive down the flaky-test rate that's eroding trust in CI.",
             "entries": [
                {"type": "entry", "content": "Flaky rate down from 4.1% to 1.3% after quarantining the "
                                             "two worst offenders.", "created": 2},
                {"type": "todo", "content": "Fix the timezone-dependent assertion in the billing tests",
                 "notes": "Fails between 23:00-00:00 UTC; freeze the clock in the fixture.", "done": 0},
                {"type": "todo", "content": "De-quarantine the two stabilised suites", "due": 5},
             ]},
            {"title": "Release pipeline", "status": "in-progress", "created": 30,
             "entries": [
                {"type": "decision", "content": "Adopt trunk-based dev with short-lived branches.",
                 "notes": "Long-lived feature branches were causing painful merges; gate merges on a "
                          "green required check instead.", "created": 22},
                {"type": "entry", "content": "Cut release time from ~40 min to ~11 min by caching the "
                                             "dependency layer.", "created": 6},
             ]},
        ],
    },
    {
        "name": "Hiring: QA engineer", "slug": "hiring-qa-engineer", "status": "active",
        "icon": "Users", "summary_days": 1,
        "summary": "Backfilling a mid-level QA engineer. Two candidates in final stages; aiming to "
                   "close before the v3 regression crunch.",
        "threads": [
            {"title": "Pipeline", "status": "in-progress", "created": 24,
             "entries": [
                {"type": "meeting", "content": "Final interview - candidate A (test strategy panel)",
                 "meet": 1, "hour": 15},
                {"type": "meeting", "content": "Final interview - candidate B", "meet": 4, "hour": 10},
                {"type": "todo", "content": "Write up candidate A's panel feedback", "done": 0},
                {"type": "todo", "content": "Chase references for candidate B", "due": 3},
                {"type": "decision", "content": "Drop the take-home; use a 45-min pairing exercise.",
                 "notes": "The take-home was filtering out strong candidates who didn't have a free "
                          "evening. Pairing is fairer and tells us more.", "created": 7},
             ]},
        ],
    },
    {
        "name": "Personal & admin", "slug": "personal-admin", "status": "stable",
        "icon": "User", "summary_days": 3,
        "summary": "The small things that otherwise fall through: expenses, 1:1s, and a bit of "
                   "learning time held back each week.",
        "threads": [
            {"title": "This week", "status": "open", "created": 6,
             "entries": [
                {"type": "todo", "content": "Submit March expenses", "done": 0},
                {"type": "todo", "content": "Prep talking points for 1:1 with Sam", "due": 1},
                {"type": "meeting", "content": "1:1 with Sam (manager)", "meet": 1, "hour": 9, "minute": 30},
                {"type": "entry", "content": "Held two hours on Friday for the Adyen reconciliation "
                                             "spike - protecting focus time.", "created": 2},
             ]},
        ],
    },
]


def is_demo(db) -> bool:
    """True if this instance has been seeded with demo data at least once."""
    row = db.query(models.AppSettings).filter(models.AppSettings.key == DEMO_FLAG_KEY).first()
    return bool(row and row.value == "1")


def area_count(db) -> int:
    return db.query(models.Area).count()


def _set_flag(db) -> None:
    row = db.query(models.AppSettings).filter(models.AppSettings.key == DEMO_FLAG_KEY).first()
    if row:
        row.value = "1"
    else:
        db.add(models.AppSettings(key=DEMO_FLAG_KEY, value="1"))


def reset_and_seed(db) -> dict:
    """Wipe CONTENT tables (never users/settings) then seed the demo dataset."""
    for name in _CONTENT_MODELS:
        model = getattr(models, name, None)
        if model is not None:
            db.query(model).delete(synchronize_session=False)
    db.commit()
    return seed(db)


def seed(db) -> dict:
    """Insert the demo dataset into the current (empty) schema. Returns counts."""
    now = datetime.utcnow()
    today = now.date()

    def ago(days=0, hours=0):                 # naive UTC, in the past
        return now - timedelta(days=days, hours=hours)

    def meet(days, hour, minute=0):           # naive LOCAL wall-clock (meeting_at convention)
        return datetime.combine(today + timedelta(days=days), time(hour, minute))

    def due(days):                            # a Date
        return today + timedelta(days=days)

    area_id, thread_id = {}, {}
    for a in AREAS:
        area = models.Area(
            name=a["name"], slug=a["slug"], status=a["status"], icon=a["icon"],
            summary=a["summary"], summary_updated_at=ago(a["summary_days"]),
            summary_auto_generated=True, summary_auto_update=True,
            created_at=ago(45), updated_at=ago(a["summary_days"]),
        )
        db.add(area); db.flush()
        area_id[a["name"]] = area.id
        for pos, t in enumerate(a["threads"]):
            th = models.Thread(
                area_id=area.id, title=t["title"], status=t["status"], position=pos,
                description=t.get("description", ""), summary=t.get("summary", ""),
                summary_updated_at=ago(2) if t.get("summary") else None,
                summary_auto_generated=bool(t.get("summary")),
                created_at=ago(t["created"]), updated_at=ago(1),
            )
            db.add(th); db.flush()
            thread_id[(a["name"], t["title"])] = th.id
            for e in t["entries"]:
                created = (ago(e["done"]) if "done" in e
                           else ago(e["created"]) if "created" in e
                           else ago(e.get("due", 3) + 2) if "due" in e
                           else ago(e.get("meet", e.get("meet_past", 3)) + 2))
                entry = models.Entry(
                    thread_id=th.id, type=e["type"], content=e["content"],
                    notes=e.get("notes"), created_at=created, updated_at=created,
                )
                if e["type"] == "todo":
                    if "done" in e:
                        entry.completed = True
                        entry.completed_at = ago(e["done"])
                    else:
                        entry.completed = False
                        entry.due_date = due(e["due"])
                if e["type"] == "meeting":
                    if "meet" in e:
                        entry.meeting_at = meet(e["meet"], e.get("hour", 10), e.get("minute", 0))
                    elif "meet_past" in e:
                        entry.meeting_at = datetime.combine(
                            today - timedelta(days=e["meet_past"]),
                            time(e.get("hour", 10), e.get("minute", 0)))
                db.add(entry)
    db.commit()

    # A couple of subtasks under the reconciliation to-do (task decomposition demo).
    recon = (db.query(models.Entry)
             .filter(models.Entry.content.like("Build the daily settlement reconciliation%")).first())
    if recon:
        for i, (txt, est, done) in enumerate([
            ("Pull Adyen settlement report via the API", 60, True),
            ("Match line items against our ledger", 120, False),
            ("Alert finance on any mismatch over 1.00", 45, False),
        ]):
            db.add(models.Entry(thread_id=recon.thread_id, type="todo", content=txt,
                                parent_id=recon.id, subtask_order=i, time_estimate_minutes=est,
                                completed=done, completed_at=(ago(0, 3) if done else None),
                                created_at=ago(3), updated_at=ago(3)))
        db.commit()

    # Thread links. Each gets its timeline card, backdated to match, so the
    # demo thread reads the way a real one would.
    def link(a1, t1, a2, t2, kind):
        row = models.ThreadLink(from_thread_id=thread_id[(a1, t1)],
                                to_thread_id=thread_id[(a2, t2)], kind=kind,
                                created_at=ago(11))
        db.add(row)
        db.commit()
        db.refresh(row)
        create_reference_entry(db, row.from_thread_id, 'thread', row.id, t2,
                               created_at=row.created_at)
    link("Payments platform", "Adyen migration", "Customer portal", "Billing page revamp", "blocks")
    link("Mobile app v3", "Offline mode", "Customer portal", "Team management", "relates_to")
    db.commit()

    # Link attachments, each with its timeline card at the same date.
    def attach(a, t, name, url, days):
        row = models.Attachment(thread_id=thread_id[(a, t)], type="link", name=name,
                                url=url, created_at=ago(days))
        db.add(row)
        db.commit()
        db.refresh(row)
        create_reference_entry(db, row.thread_id, 'link', row.id, name,
                               created_at=row.created_at)
    attach("Payments platform", "Adyen migration", "Adyen migration runbook (Confluence)",
           "https://example.atlassian.net/wiki/spaces/PAY/pages/adyen-runbook", 5)
    attach("Payments platform", "Adyen migration", "PR #214 feat/adyen-webhooks",
           "https://github.com/example/payments/pull/214", 12)
    attach("Mobile app v3", "Offline mode", "Offline mode - Figma",
           "https://www.figma.com/file/example/offline-mode", 6)
    attach("Customer portal", "Billing page revamp", "Billing page spec (Notion)",
           "https://www.notion.so/example/billing-page-spec", 13)
    db.commit()

    # Signals (triage feed).
    def signal(source, kind, title, ext, days_ahead=None, organizer=None, location=None,
               suggest_area=None, suggest_thread=None, created_days=1):
        s = models.SignalItem(
            source=source, external_id=ext, kind=kind, title=title, status="pending",
            organizer=organizer, location=location,
            created_at=ago(created_days), updated_at=ago(created_days),
            suggested_area_id=area_id.get(suggest_area) if suggest_area else None,
            suggested_thread_id=thread_id.get((suggest_area, suggest_thread)) if suggest_thread else None,
        )
        if days_ahead is not None:
            s.starts_at = meet(days_ahead, 13, 0)
            s.ends_at = meet(days_ahead, 13, 30)
        db.add(s)

    signal("microsoft", "meeting", "Payments cutover dry-run", "ms-evt-1001", days_ahead=2,
           organizer="finance@example.com", location="Teams", suggest_area="Payments platform",
           suggest_thread="Adyen migration")
    signal("microsoft", "meeting", "Mobile v3 go / no-go", "ms-evt-1002", days_ahead=3,
           organizer="release@example.com", location="Teams", suggest_area="Mobile app v3")
    signal("google", "email", "Re: Adyen production credentials - action needed", "gmail-2001",
           organizer="support@adyen.com", suggest_area="Payments platform", suggest_thread="Adyen migration")
    signal("icloud", "meeting", "Coffee with the new starter (informal)", "ical-3001", days_ahead=5,
           organizer="hr@example.com", location="Cafe")
    signal("jira", "Bug", "PORTAL-412 Billing page shows a stale balance after refund", "PORTAL-412",
           suggest_area="Customer portal", suggest_thread="Billing page revamp", created_days=2)
    signal("jira", "Story", "PAY-318 Reconcile Adyen settlement report daily", "PAY-318",
           suggest_area="Payments platform", suggest_thread="Adyen migration", created_days=2)
    signal("jira", "Task", "INFRA-77 De-flake the billing timezone test", "INFRA-77",
           suggest_area="Test & release infra", created_days=1)
    signal("github", "pr", "Review requested: feat/adyen-webhooks #214", "gh-pr-214",
           suggest_area="Payments platform", suggest_thread="Adyen migration", created_days=1)
    signal("github", "pr", "Review requested: fix/offline-indicator #231", "gh-pr-231",
           suggest_area="Mobile app v3", suggest_thread="Offline mode", created_days=0)
    db.commit()

    # Work sessions (heartbeat-derived; powers the Insights working window).
    for d in range(0, 15):
        day = today - timedelta(days=d)
        if day.weekday() >= 5:                # skip weekends
            continue
        if d == 0:
            db.add(models.WorkSession(started_at=datetime.combine(day, time(9, 5)),
                                      ended_at=datetime.combine(day, time(12, 35)), ping_count=42))
            aft_start = datetime.combine(day, time(13, 30))
            if now > aft_start:
                db.add(models.WorkSession(started_at=aft_start, ended_at=now,
                                          ping_count=max(1, int((now - aft_start).total_seconds() // 300))))
        else:
            db.add(models.WorkSession(started_at=datetime.combine(day, time(9, 10)),
                                      ended_at=datetime.combine(day, time(12, 40)), ping_count=42))
            db.add(models.WorkSession(started_at=datetime.combine(day, time(13, 25)),
                                      ended_at=datetime.combine(day, time(17, 50)), ping_count=53))
    db.commit()

    # A few activity events + audit rows so those surfaces aren't empty.
    def activity(a, t, event_type, detail, days):
        db.add(models.ActivityEvent(thread_id=thread_id[(a, t)], event_type=event_type,
                                    detail=detail, occurred_at=ago(days)))
    activity("Payments platform", "Adyen migration", "attachment_added", "PR #214 feat/adyen-webhooks", 12)
    activity("Payments platform", "Adyen migration", "thread_linked", "blocks Billing page revamp", 11)
    activity("Mobile app v3", "Offline mode", "attachment_added", "Offline mode - Figma", 6)
    db.commit()

    def audit(entity_type, entity_id, a, t, action, field=None, old=None, new=None, days=2):
        db.add(models.AuditLog(entity_type=entity_type, entity_id=entity_id,
                               area_id=area_id.get(a), thread_id=thread_id.get((a, t)) if t else None,
                               action=action, field=field, old_value=old, new_value=new,
                               occurred_at=ago(days)))
    audit("thread", thread_id[("Customer portal", "Billing page revamp")], "Customer portal",
          "Billing page revamp", "status_changed", "status", "open", "parked", 12)
    audit("area", area_id["Payments platform"], "Payments platform", None, "status_changed",
          "status", "review", "active", 30)
    audit("thread", thread_id[("Payments platform", "PCI scope review")], "Payments platform",
          "PCI scope review", "status_changed", "status", "in-progress", "resolved", 2)
    db.commit()

    _set_flag(db)
    db.commit()

    from sqlalchemy import func as _f
    return {
        "areas": db.query(_f.count(models.Area.id)).scalar(),
        "threads": db.query(_f.count(models.Thread.id)).scalar(),
        "entries": db.query(_f.count(models.Entry.id)).scalar(),
        "signals": db.query(_f.count(models.SignalItem.id)).scalar(),
        "work_sessions": db.query(_f.count(models.WorkSession.id)).scalar(),
    }
