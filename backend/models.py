from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime, Boolean, Date, Table, UniqueConstraint
from sqlalchemy.orm import relationship, backref
from sqlalchemy.sql import func
from database import Base


class Area(Base):
    __tablename__ = "areas"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    slug = Column(String(100), nullable=False, unique=True, index=True)
    # stable | active | review | blocked
    status = Column(String(50), default="stable", nullable=False)
    # What the area IS - a stable, user-written statement of scope. Editable but
    # intended to be set once and rarely touched, unlike summary (the "Current
    # Overview"), which tracks the live situation and may be AI-refreshed.
    description = Column(Text, default="")
    summary = Column(Text, default="")
    # When the summary was last (re)generated or saved. Distinct from
    # updated_at (which moves on any field change) so the UI can show how old
    # the *summary specifically* is, and detect when it's out of sync.
    summary_updated_at = Column(DateTime, nullable=True)
    # Was the last summary write produced by the auto-refresh job (True) or
    # written/approved by the user (False)?
    summary_auto_generated = Column(Boolean, default=False, nullable=False)
    # Per-area opt-in: does the daily refresher keep this summary current?
    summary_auto_update = Column(Boolean, default=False, nullable=False)
    # lucide-react icon name (e.g. "Code", "Database"). null = no icon set.
    icon = Column(String(64), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    threads = relationship(
        "Thread", back_populates="area", cascade="all, delete-orphan"
    )
    thread_groups = relationship(
        "ThreadGroup",
        back_populates="area",
        cascade="all, delete-orphan",
        order_by="ThreadGroup.position",
    )


class ThreadGroup(Base):
    """A user-defined, named collection of threads within an area. Optional -
    an area with no groups renders threads exactly as before. Deleting a group
    ungroups its threads (it never deletes them; the router nulls group_id)."""
    __tablename__ = "thread_groups"

    id = Column(Integer, primary_key=True, index=True)
    area_id = Column(Integer, ForeignKey("areas.id"), nullable=False)
    name = Column(String(120), nullable=False, default="New group")
    # Display order of groups within the area.
    position = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    area = relationship("Area", back_populates="thread_groups")
    # Note: no delete cascade - removing a group must not remove its threads.
    threads = relationship("Thread", back_populates="group")


class Thread(Base):
    __tablename__ = "threads"

    id = Column(Integer, primary_key=True, index=True)
    area_id = Column(Integer, ForeignKey("areas.id"), nullable=False)
    title = Column(String(200), nullable=False)
    # open | in-progress | resolved | parked
    status = Column(String(50), default="open", nullable=False)
    # Manual sort order within the area (set by drag-to-reorder). NULL = never
    # reordered; such threads fall back to most-recent-activity ordering.
    position = Column(Integer, nullable=True)
    # Optional custom group this thread belongs to. NULL = ungrouped (the
    # default; renders under the automatic status groups as before).
    group_id = Column(Integer, ForeignKey("thread_groups.id"), nullable=True)
    description = Column(Text, default="")
    # AI Overview — same shape as Area.summary. `description` stays the user's
    # own one-liner; `summary` is the generated/editable status overview.
    summary = Column(Text, default="")
    summary_updated_at = Column(DateTime, nullable=True)
    summary_auto_generated = Column(Boolean, default=False, nullable=False)
    summary_auto_update = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    area = relationship("Area", back_populates="threads")
    group = relationship("ThreadGroup", back_populates="threads")
    entries = relationship(
        "Entry",
        back_populates="thread",
        cascade="all, delete-orphan",
        order_by="Entry.created_at",
    )
    attachments = relationship(
        "Attachment",
        back_populates="thread",
        cascade="all, delete-orphan",
        order_by="Attachment.created_at",
    )


class CustomEntryType(Base):
    """A user-defined entry type, such as Risk or Question.

    Label and colour only. Entries using one are stored with type 'custom'
    and behave exactly like an Update underneath, so nothing about the rest of
    the app has to know these exist. Global rather than per-area, because a
    Risk means the same thing wherever it is written.
    """
    __tablename__ = "custom_entry_types"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(40), nullable=False)
    # One of the keys in CUSTOM_COLOURS. Maps to a palette entry on the client,
    # never to a class name built at runtime, because Tailwind only generates
    # what it can see written out.
    colour = Column(String(20), nullable=False)
    created_at = Column(DateTime, server_default=func.now())


class Entry(Base):
    __tablename__ = "entries"

    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(Integer, ForeignKey("threads.id"), nullable=False)
    content = Column(Text, nullable=False)
    # entry | todo | decision | meeting | blockage | custom | reference
    # 'custom' carries a user-defined type through custom_type_id.
    type = Column(String(20), default="entry", nullable=False)
    completed = Column(Boolean, default=False, nullable=False)
    completed_at = Column(DateTime, nullable=True)
    due_date = Column(Date, nullable=True)
    # Scheduled time for meeting-type entries (null for other types)
    meeting_at = Column(DateTime, nullable=True)
    # Free-form notes - used mostly on investigative todos to capture
    # findings while the task is still open. Nullable across all types.
    notes = Column(Text, nullable=True)

    # ── Task decomposition (subtasks) ─────────────────────────────────────────
    # Subtasks are Entry rows of type 'todo' that point at a parent todo via
    # parent_id. Top-level entries have parent_id = NULL.
    parent_id = Column(Integer, ForeignKey("entries.id", ondelete="CASCADE"), nullable=True)
    # AI-suggested time estimate for a subtask, in minutes.
    time_estimate_minutes = Column(Integer, nullable=True)
    # Display ordering among siblings under the same parent.
    subtask_order = Column(Integer, nullable=True)
    # True once the user has dismissed the breakdown drawer for this todo -
    # enables the "Break this down" later affordance without re-triggering.
    decomp_dismissed = Column(Boolean, default=False, nullable=False)

    # ── External provenance (Signals) ────────────────────────────────────────
    # When a meeting Entry is created by accepting a Signals item, the upstream
    # source's stable id (Graph event id for Microsoft) is stored here so the
    # 30-min re-sync can update the entry in place if the event moves. NULL
    # for manual entries.
    external_id = Column(String(256), nullable=True, index=True)

    # ── Custom entry types ───────────────────────────────────────────────────
    # Set only when type == 'custom'. Joined eagerly because the thread read
    # path renders the label and colour on every entry, and a lazy load there
    # would be one query per row.
    custom_type_id = Column(Integer, ForeignKey("custom_entry_types.id"), nullable=True, index=True)

    # ── In Hand (pinned strip on the dashboard) ──────────────────────────────
    # One nullable timestamp does three jobs: non-null means the entry is in
    # hand, it is the sort key (newest pin first), and it is where the row's
    # age comes from. Completing a todo never clears it, so unticking the task
    # in its thread quietly returns it to the strip with its age intact.
    pinned_at = Column(DateTime, nullable=True, index=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    thread = relationship("Thread", back_populates="entries")
    custom_type = relationship("CustomEntryType", lazy="joined")
    # Self-referential: a todo's subtasks. Deleting a parent cascades to its
    # children. remote_side ties the backref 'parent' to this row's id.
    subtasks = relationship(
        "Entry",
        backref=backref("parent", remote_side="Entry.id"),
        foreign_keys="Entry.parent_id",
        order_by="Entry.subtask_order",
        cascade="all, delete-orphan",
        single_parent=True,
    )


class Attachment(Base):
    __tablename__ = "attachments"

    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(Integer, ForeignKey("threads.id"), nullable=False)
    # file | link
    type = Column(String(10), nullable=False)
    name = Column(String(255), nullable=False)
    # stored filename on disk (files only)
    stored_name = Column(String(500))
    # original filename (files only)
    original_name = Column(String(255))
    # url (links only)
    url = Column(String(1000))
    # bytes (files only)
    size = Column(Integer)
    # Remote path on the configured cloud backend (null = local-only).
    # Populated by the background upload task in routers/attachments.py
    # after the file lands on Nextcloud / Dropbox / etc.
    remote_path = Column(String(500), nullable=True)
    # local | synced | pending | failed - drives the sync indicator in UI
    # and lets future retry logic know which attachments to chase.
    sync_status = Column(String(20), nullable=True, default="local")
    created_at = Column(DateTime, server_default=func.now())

    thread = relationship("Thread", back_populates="attachments")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    entity_type = Column(String(50), nullable=False)
    entity_id = Column(Integer, nullable=False)
    area_id = Column(Integer, ForeignKey("areas.id", ondelete="CASCADE"), nullable=True)
    thread_id = Column(Integer, ForeignKey("threads.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(50), nullable=False)
    field = Column(String(100), nullable=True)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    # Who performed the action. Null for system/scheduler actions and for rows
    # written before auth existed. Set by log_audit to current_user.id (or the
    # synthetic local admin's id when EFFRO_AUTH_ENABLED is off).
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    occurred_at = Column(DateTime, server_default=func.now())


class ThreadLink(Base):
    __tablename__ = "thread_links"

    id = Column(Integer, primary_key=True, index=True)
    from_thread_id = Column(Integer, ForeignKey("threads.id", ondelete="CASCADE"), nullable=False, index=True)
    to_thread_id = Column(Integer, ForeignKey("threads.id", ondelete="CASCADE"), nullable=False, index=True)
    # blocks | relates_to
    kind = Column(String(30), nullable=False)
    created_at = Column(DateTime, server_default=func.now())


class ActivityEvent(Base):
    __tablename__ = "activity_events"

    id = Column(Integer, primary_key=True, index=True)
    event_type = Column(String(50), nullable=False)
    thread_id = Column(Integer, ForeignKey("threads.id", ondelete="CASCADE"), nullable=False)
    detail = Column(String(200), nullable=True)
    occurred_at = Column(DateTime, server_default=func.now())

    thread = relationship("Thread")


class WorkSession(Base):
    """
    A contiguous span of app presence, used to infer the working day for the
    Insights "wind-down".

    Populated by the heartbeat (POST /api/heartbeat): each ping extends the
    current session's ended_at, or opens a new session when the gap since the
    last ping exceeds SESSION_GAP_MINUTES. This gives an honest "when did you
    start / stop today" without storing a row per ping, and lets an isolated
    late-night check-in be discounted (it becomes its own tiny session rather
    than stretching the day).

    Timestamps are naive UTC (datetime.utcnow()), consistent with the rest of
    the schema; the API converts to the caller's local day on read.
    """
    __tablename__ = "work_sessions"

    id = Column(Integer, primary_key=True, index=True)
    started_at = Column(DateTime, nullable=False)
    ended_at = Column(DateTime, nullable=False)
    ping_count = Column(Integer, default=1, nullable=False)


class AppSettings(Base):
    """
    Generic key-value store for application-wide settings.

    Currently holds the AI provider configuration under key "ai_config".
    Adding new settings = pick a key, JSON-encode the payload.

    Why a single key-value table rather than columns: most settings are
    one-off + structured-but-small. Migrations stay free. New setting =
    new key, no schema changes.
    """
    __tablename__ = "app_settings"

    key = Column(String(100), primary_key=True, index=True)
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class UserPref(Base):
    """
    Durable per-user UI state, in the same key-value spirit as AppSettings but
    scoped to a person.

    Why it exists: the desktop shell clears all webview browsing data on every
    version update as a deliberate cache bust, and that takes localStorage with
    it. Anything that must survive an update lives here instead - onboarding
    completion, the display name, the profile photo, and the intro-panel
    dismissals. The frontend keeps localStorage as a read-through cache for an
    instant boot, but this table is the source of truth.

    value holds a JSON-encoded string, so a pref can be a string, a number, a
    boolean or a small object without a schema change. Avatars arrive as base64
    data URLs and can approach a megabyte, hence Text.

    user_id is deliberately a plain column with no foreign key. When
    EFFRO_AUTH_ENABLED is off (the desktop build) the current user is a
    synthetic local admin with id=1 that is never written to the users table, so
    a foreign key would reject every desktop write.
    """
    __tablename__ = "user_prefs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    key = Column(String(120), nullable=False)
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "key", name="uq_user_prefs_user_key"),
    )


class StorageSyncLog(Base):
    """
    Records each backup/sync attempt and its outcome.

    Two event types so far:
      - "backup"          : nightly encrypted DB snapshot upload
      - "attachment_sync" : (future) per-attachment remote upload audit

    Surfaced in the StorageSetupModal's Manage view - the user sees the last
    few rows as a quick "did backups actually run?" sanity check.
    """
    __tablename__ = "storage_sync_logs"

    id = Column(Integer, primary_key=True, index=True)
    event_type = Column(String(30), nullable=False, default="backup")
    # success | failed | skipped
    status = Column(String(20), nullable=False)
    provider = Column(String(30), nullable=True)
    remote_path = Column(String(500), nullable=True)
    size_bytes = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)
    occurred_at = Column(DateTime, server_default=func.now())


class JiraIntegration(Base):
    """
    Connected Atlassian Jira Cloud account (one row, single-user).

    Tokens are Fernet-encrypted at rest. cloud_id is the Atlassian Cloud
    site identifier needed for all API calls; it's resolved once after OAuth
    and stored here so every sync run doesn't need to re-fetch accessible resources.
    """
    __tablename__ = "jira_integrations"

    id = Column(Integer, primary_key=True, index=True)

    # Atlassian user identity
    atlassian_user_id = Column(String(256), unique=True, nullable=False)
    cloud_id = Column(String(256), nullable=False)   # e.g. "a1b2c3..."
    cloud_name = Column(String(256), nullable=True)  # e.g. "mycompany.atlassian.net"

    # Encrypted tokens
    access_token_enc = Column(Text, nullable=False)
    refresh_token_enc = Column(Text, nullable=True)
    token_expiry = Column(DateTime, nullable=True)

    # Profile cache
    display_name = Column(String(256), nullable=True)
    email = Column(String(256), nullable=True)
    avatar_url = Column(String(500), nullable=True)

    connected_at = Column(DateTime, server_default=func.now())
    last_synced = Column(DateTime, nullable=True)


class GoogleIntegration(Base):
    """
    Connected Google account (one row, single-user app).

    Tokens are Fernet-encrypted at rest using the same per-install key the
    other integrations use. Google issues a refresh token only on the first
    consent (access_type=offline, prompt=consent), so refresh_token_enc is
    preserved across refreshes when Google omits it from a refresh response.

    Powers the Google Drive/Docs features: docs as signals, attach-from-Drive,
    ingest doc content, and export-to-Docs.
    """
    __tablename__ = "google_integrations"

    id = Column(Integer, primary_key=True, index=True)
    # Google account id ("sub" from the OpenID userinfo) - stable per account.
    google_user_id = Column(String(256), unique=True, nullable=False)

    # Encrypted secrets - never log, never return via API.
    access_token_enc = Column(Text, nullable=False)
    refresh_token_enc = Column(Text, nullable=True)
    token_expiry = Column(DateTime, nullable=True)

    # Profile cache
    display_name = Column(String(256), nullable=True)
    email = Column(String(256), nullable=True)
    avatar_url = Column(String(500), nullable=True)

    connected_at = Column(DateTime, server_default=func.now())
    last_synced = Column(DateTime, nullable=True)


class DropboxIntegration(Base):
    """
    Connected Dropbox account (one row, single-user app) - used purely as a
    Cloud Storage backup target, not a Signals source. Tokens are Fernet-
    encrypted; Dropbox issues a refresh token with token_access_type=offline,
    preserved across refreshes the same way the Google one is.
    """
    __tablename__ = "dropbox_integrations"

    id = Column(Integer, primary_key=True, index=True)
    dropbox_account_id = Column(String(256), unique=True, nullable=False)

    access_token_enc = Column(Text, nullable=False)
    refresh_token_enc = Column(Text, nullable=True)
    token_expiry = Column(DateTime, nullable=True)

    display_name = Column(String(256), nullable=True)
    email = Column(String(256), nullable=True)

    connected_at = Column(DateTime, server_default=func.now())


class MicrosoftIntegration(Base):
    """
    Connected Microsoft 365 account (one row, single-user app).

    Tokens are Fernet-encrypted at rest using the same per-install key the
    Nextcloud backup uses (storage_backend.get_or_create_fernet_key). Decryption
    happens just-in-time inside the token-refresh helper - the raw access token
    never sits in memory longer than a request.

    Lost key = stored tokens unrecoverable, user simply reconnects. Documented
    trade-off, single-user homelab tool.
    """
    __tablename__ = "microsoft_integrations"

    id = Column(Integer, primary_key=True, index=True)
    # Graph /me id - stable per Microsoft account.
    microsoft_user_id = Column(String(256), unique=True, nullable=False)

    # Encrypted secrets - never log, never return via API.
    access_token_enc = Column(Text, nullable=False)
    refresh_token_enc = Column(Text, nullable=True)
    token_expiry = Column(DateTime, nullable=True)  # UTC

    # Minimal profile cache - "connected as <email>" is all v1 surfaces.
    # job_title/department/office_location/avatar_data_uri columns exist for
    # forward-compat (see MS365_INTEGRATION_SPEC_1.md §0 - rich profile card
    # deferred from v1) but are not populated or rendered.
    display_name = Column(String(256), nullable=True)
    email = Column(String(256), nullable=True)
    job_title = Column(String(256), nullable=True)
    department = Column(String(256), nullable=True)
    office_location = Column(String(256), nullable=True)
    avatar_data_uri = Column(Text, nullable=True)

    connected_at = Column(DateTime, server_default=func.now())
    last_synced = Column(DateTime, nullable=True)


class SignalItem(Base):
    """
    Staging row for an externally-sourced item awaiting user triage.

    Items arrive automatically (Graph sync, future Jira/GitHub) but never
    become structured log entries until the user accepts them - "capture
    automatically, file deliberately" (see spec §2).

    Source-agnostic from day one: `source` discriminates microsoft / jira /
    github / etc. `kind` discriminates meeting / task / review / etc.

    Dedup key is (source, external_id). Re-sync updates in place. Upstream
    cancellation flips status to 'dismissed' rather than hard-deleting.
    """
    __tablename__ = "signal_items"

    id = Column(Integer, primary_key=True, index=True)
    # microsoft | jira | github | ... - dimension for routing & filtering.
    source = Column(String(30), nullable=False, index=True)
    # Stable upstream id - unique per source via composite index below.
    external_id = Column(String(256), nullable=False, index=True)
    # meeting | task | review | mention | ...
    kind = Column(String(30), nullable=False)

    title = Column(String(500), nullable=False)
    # Meeting fields - null for non-meeting kinds.
    starts_at = Column(DateTime, nullable=True)
    ends_at = Column(DateTime, nullable=True)
    location = Column(String(500), nullable=True)
    organizer = Column(String(255), nullable=True)
    is_all_day = Column(Boolean, default=False, nullable=False)

    # pending | assigned | dismissed
    # 'assigned' means accepted and committed to an Entry; 'dismissed' covers
    # both user-dismissed and upstream-cancelled / auto-expired.
    status = Column(String(20), nullable=False, default="pending", index=True)

    # AI suggestion - filled when the sync job has a configured AI provider.
    # Null when AI is unconfigured, or when the AI declined to suggest (no
    # strong match) - the UI surfaces this as a "choose area" state.
    suggested_area_id = Column(Integer, ForeignKey("areas.id", ondelete="SET NULL"), nullable=True)
    suggested_thread_id = Column(Integer, ForeignKey("threads.id", ondelete="SET NULL"), nullable=True)

    # Once accepted, points at the committed Entry. Lets a re-sync update the
    # entry if the upstream event moves.
    assigned_entry_id = Column(Integer, ForeignKey("entries.id", ondelete="SET NULL"), nullable=True)

    # The AI's ORIGINAL area call, set once by the suggestion pass and never
    # overwritten - accept and reassign both mutate suggested_area_id, so this
    # is the only honest record of what the AI actually said. ai_suggested_at
    # is stamped whenever the pass looks at the row, including when it abstains
    # ('none'), so coverage can be measured. Plain id, no FK: log semantics.
    ai_suggested_area_id = Column(Integer, nullable=True)
    ai_suggested_at = Column(DateTime, nullable=True)

    # Original Graph payload (JSON) for debugging + forward-compat.
    raw_json = Column(Text, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class SignalResolution(Base):
    """Append-only corrections log: one row per user triage decision, written
    the moment ground truth is born (accept or dismiss in the Signals UI -
    never by auto-expiry, which is not a human judgement).

    The suggester evaluation reads this table: ai_suggested_area_id is what
    the AI originally said (None = it abstained or never ran), final_area_id
    is where the person actually filed it. Raw ids on purpose, no FKs - the
    log must survive areas being renamed or deleted."""
    __tablename__ = "signal_resolutions"

    id = Column(Integer, primary_key=True, index=True)
    signal_id = Column(Integer, nullable=False, index=True)
    source = Column(String(30), nullable=False)
    kind = Column(String(30), nullable=False)
    ai_suggested_area_id = Column(Integer, nullable=True)
    final_area_id = Column(Integer, nullable=True)        # None for dismissed
    # accepted (AI right) | reassigned (AI wrong) | filed_unsuggested (AI
    # abstained or unconfigured) | dismissed (not a correctness label)
    outcome = Column(String(20), nullable=False, index=True)
    resolved_at = Column(DateTime, server_default=func.now())


class Nudge(Base):
    """
    Gentle daily usage reminders shown above the dashboard widgets.

    Seeded with a hand-written set on first run; the AI can top the pool up
    over time (source='ai'). One is surfaced per calendar day, rotated
    deterministically so it's stable across reloads within a day.
    """
    __tablename__ = "nudges"

    id = Column(Integer, primary_key=True, index=True)
    text = Column(Text, nullable=False)
    # seed | ai - where this nudge came from
    source = Column(String(20), nullable=False, default="seed")
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, server_default=func.now())


# ── Authentication, sessions & GDPR (flag-gated via EFFRO_AUTH_ENABLED) ───────
# These tables exist in every install but only carry real rows when auth is
# enabled (Docker / hosted). On the desktop build the gate is open and
# get_current_user returns a synthetic local admin, so no User row is created.

class User(Base):
    """
    An account that can sign in.

    password_hash is null for SSO-only accounts (OIDC), which authenticate via
    sso_subject + sso_provider instead. role is 'admin' | 'member'. GDPR account
    deletion sets is_active=False, blanks email/display_name, and writes a
    deletion_log row rather than dropping the user (audit rows are anonymised,
    not deleted).
    """
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(320), unique=True, nullable=False, index=True)
    display_name = Column(String(200), nullable=True)
    # Argon2 hash. Null for SSO-only accounts.
    password_hash = Column(String(512), nullable=True)
    # admin | member
    role = Column(String(20), nullable=False, default="member")
    is_active = Column(Boolean, nullable=False, default=True)
    # OIDC identity for SSO accounts (the ID token's sub + iss); null for
    # password accounts.
    sso_subject = Column(String(320), nullable=True)
    sso_provider = Column(String(320), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    last_login_at = Column(DateTime, nullable=True)
    # Profile photo as a data: URI. Populated best-effort from the IdP on first
    # SSO sign-in (Microsoft Graph photo / OIDC `picture`); also settable
    # locally. Null = fall back to initials.
    avatar = Column(Text, nullable=True)

    sessions = relationship(
        "UserSession", back_populates="user", cascade="all, delete-orphan"
    )


class UserSession(Base):
    """
    A server-side session. The id is a 256-bit random token
    (secrets.token_hex(32) = 64 hex chars) stored in the effro_session cookie;
    every authenticated request resolves the cookie to this row. Server-side so
    a session can be revoked (is_active=False) individually without rotating any
    signing key.
    """
    __tablename__ = "user_sessions"

    id = Column(String(64), primary_key=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at = Column(DateTime, server_default=func.now())
    expires_at = Column(DateTime, nullable=False)
    last_seen_at = Column(DateTime, server_default=func.now())
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(String(512), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)

    user = relationship("User", back_populates="sessions")


class PasswordResetToken(Base):
    """
    A single-use, time-limited password-reset token. Created by a reset flow and
    consumed (used=True) when the new password is set.
    """
    __tablename__ = "password_reset_tokens"

    id = Column(String(64), primary_key=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at = Column(DateTime, server_default=func.now())
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, nullable=False, default=False)


class DeletionLog(Base):
    """
    A tombstone for a GDPR account deletion. Stores only the SHA-256 of the
    original email (so a later sign-up can be recognised without retaining the
    address), when, and an optional reason. Contains no personal data itself.
    """
    __tablename__ = "deletion_log"

    id = Column(Integer, primary_key=True, index=True)
    email_hash = Column(String(64), nullable=False)  # sha256 hex of the email
    deleted_at = Column(DateTime, server_default=func.now())
    reason = Column(String(200), nullable=True)


# ── Folio (deep-research capture -> digest) ───────────────────────────────────
# A folio holds the captures of one research dive and the digest pulled together
# from them. Gated by EFFRO_FOLIO_ENABLED (see dependencies.folio_enabled). v1 is
# deliberately minimal per the build spec: no status/sensitive/template fields,
# recency is just updated_at. JSON-bearing fields are stored as TEXT and
# json-encoded, matching the rest of the codebase (no JSON column type in use).

folio_topics = Table(
    "folio_topics",
    Base.metadata,
    Column("folio_id", Integer, ForeignKey("folios.id", ondelete="CASCADE"), primary_key=True),
    Column("topic_id", Integer, ForeignKey("topics.id", ondelete="CASCADE"), primary_key=True),
)


class Folio(Base):
    __tablename__ = "folios"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=True)        # can be set later / auto-drafted
    area_id = Column(Integer, ForeignKey("areas.id"), nullable=True)
    # Optional thread link, within the area. Areas rarely close; threads
    # conclude often - so a folio files primarily to an area, optionally to a
    # thread. SET NULL so deleting the thread just unlinks the dive.
    thread_id = Column(Integer, ForeignKey("threads.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    # Recency (the index's "recent vs earlier" grouping) comes from updated_at.
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    area = relationship("Area")
    thread = relationship("Thread")
    captures = relationship("Capture", back_populates="folio", cascade="all, delete-orphan")
    digests = relationship("Digest", back_populates="folio", cascade="all, delete-orphan")
    topics = relationship("Topic", secondary=folio_topics, back_populates="folios")


class Capture(Base):
    __tablename__ = "captures"

    id = Column(Integer, primary_key=True, index=True)
    folio_id = Column(Integer, ForeignKey("folios.id", ondelete="CASCADE"), nullable=False)
    # link | note | file | image
    type = Column(String(20), nullable=False)
    # The raw content: a URL (link), the text (note), or the stored file path
    # (file/image).
    raw_content = Column(Text, default="")
    # Readable text pulled at capture time: article text, file text, or the
    # vision-model read of an image. Feeds both search and synthesis.
    extracted_text = Column(Text, default="")
    # JSON: {"domain", "title", "favicon_url", ...} - varies by capture type.
    source_meta = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    folio = relationship("Folio", back_populates="captures")


class Digest(Base):
    __tablename__ = "digests"

    id = Column(Integer, primary_key=True, index=True)
    folio_id = Column(Integer, ForeignKey("folios.id", ondelete="CASCADE"), nullable=False)
    # Monotonic per folio; each pull-together inserts a new row and flips the
    # previous is_current to False. Nothing is ever overwritten.
    version = Column(Integer, nullable=False, default=1)
    is_current = Column(Boolean, nullable=False, default=True)
    # Structured fields, kept separate so each section stays independently
    # editable and grounding can be checked per claim. summary is prose;
    # key_points / sources / open_threads / based_on_capture_ids are JSON lists.
    # headline is the piece's own title, drawn from the captures (empty for
    # digests pulled before headlines existed).
    headline = Column(Text, default="")
    summary = Column(Text, default="")
    key_points = Column(Text, default="[]")
    sources = Column(Text, default="[]")
    open_threads = Column(Text, default="[]")
    # Magazine sections, JSON list of {heading, body, quote?: {text, capture},
    # image?: capture_id}. Quotes are verified verbatim against the captures at
    # synthesis time; images reference the folio's own image captures. Empty
    # for digests pulled before sections existed - those render the flat way.
    sections = Column(Text, default="[]")
    # Glossary of the dive's jargon: JSON list of {term, definition}. A term is
    # kept only if it appears in a capture (grounded). Empty = legacy/none.
    key_terms = Column(Text, default="[]")
    # Where the captures disagree: JSON list of
    # {point, sides:[{source, stance}]}. Empty when sources broadly agree or
    # for digests pulled before this existed.
    tensions = Column(Text, default="[]")
    based_on_capture_ids = Column(Text, default="[]")
    generated_at = Column(DateTime, server_default=func.now())

    folio = relationship("Folio", back_populates="digests")


class Topic(Base):
    """Flat, manual tags for folios (no nesting, no AI suggestion in v1)."""
    __tablename__ = "topics"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    created_at = Column(DateTime, server_default=func.now())

    folios = relationship("Folio", secondary=folio_topics, back_populates="topics")
