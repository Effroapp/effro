from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime, Boolean, Date
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


class Thread(Base):
    __tablename__ = "threads"

    id = Column(Integer, primary_key=True, index=True)
    area_id = Column(Integer, ForeignKey("areas.id"), nullable=False)
    title = Column(String(200), nullable=False)
    # open | in-progress | resolved | parked
    status = Column(String(50), default="open", nullable=False)
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


class Entry(Base):
    __tablename__ = "entries"

    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(Integer, ForeignKey("threads.id"), nullable=False)
    content = Column(Text, nullable=False)
    # entry | todo | decision | meeting
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

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    thread = relationship("Thread", back_populates="entries")
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

    # Original Graph payload (JSON) for debugging + forward-compat.
    raw_json = Column(Text, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


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
