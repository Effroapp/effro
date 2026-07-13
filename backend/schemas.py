from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, date


# ── Attachments ──────────────────────────────────────────────────────────────

class AttachmentOut(BaseModel):
    id: int
    thread_id: int
    type: str
    name: str
    stored_name: Optional[str] = None
    original_name: Optional[str] = None
    url: Optional[str] = None
    size: Optional[int] = None
    # Cloud-sync fields - null on local-only installs, populated once a
    # remote backend is configured and the background upload has run.
    remote_path: Optional[str] = None
    sync_status: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class LinkCreate(BaseModel):
    name: str
    url: str


# ── Entries ───────────────────────────────────────────────────────────────────

class EntryCreate(BaseModel):
    content: str
    type: str = 'entry'  # entry | todo | decision | meeting
    due_date: Optional[date] = None
    meeting_at: Optional[datetime] = None
    notes: Optional[str] = None


class EntryUpdate(BaseModel):
    content: Optional[str] = None
    type: Optional[str] = None
    completed: Optional[bool] = None
    due_date: Optional[date] = None
    meeting_at: Optional[datetime] = None
    notes: Optional[str] = None


class EntryOut(BaseModel):
    id: int
    thread_id: int
    content: str
    type: str
    completed: bool
    completed_at: Optional[datetime] = None
    due_date: Optional[date] = None
    meeting_at: Optional[datetime] = None
    notes: Optional[str] = None
    # Task decomposition fields
    parent_id: Optional[int] = None
    time_estimate_minutes: Optional[int] = None
    subtask_order: Optional[int] = None
    decomp_dismissed: bool = False
    # Nested subtasks (only populated for parent todos). Self-referential -
    # children carry an empty list since they have no further nesting.
    subtasks: List["EntryOut"] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Subtasks ──────────────────────────────────────────────────────────────────

class SubtaskCreate(BaseModel):
    title: str
    time_estimate_minutes: Optional[int] = None
    subtask_order: Optional[int] = None


class SubtaskBulkCreate(BaseModel):
    subtasks: List[SubtaskCreate]


class ReorderItem(BaseModel):
    subtask_id: int
    subtask_order: int


class ReorderRequest(BaseModel):
    order: List[ReorderItem]


# Shared AI-summary freshness fields, mixed into both Area and Thread schemas
# so the Overview behaves identically for each.
class _SummaryMeta(BaseModel):
    summary_updated_at: Optional[datetime] = None
    summary_auto_generated: bool = False
    summary_auto_update: bool = False
    # Computed: is there activity newer than the summary, and how much?
    summary_stale: bool = False
    summary_new_count: int = 0


# ── Threads ───────────────────────────────────────────────────────────────────

class ThreadCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    status: Optional[str] = "open"
    # File the new thread straight into a group. Provide group_id for an
    # existing group, or new_group_name to create one on the fly. None = no group.
    group_id: Optional[int] = None
    new_group_name: Optional[str] = None


class ThreadUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    description: Optional[str] = None
    summary: Optional[str] = None
    auto_update: Optional[bool] = None


class ThreadReorder(BaseModel):
    """Full list of thread ids in their new display order within an area."""
    ordered_ids: List[int]


# ── Thread groups (optional per-area organisation) ─────────────────────────────

class ThreadGroupCreate(BaseModel):
    name: Optional[str] = "New group"


class ThreadGroupUpdate(BaseModel):
    name: str


class ThreadGroupReorder(BaseModel):
    ordered_ids: List[int]


class ThreadGroupAssign(BaseModel):
    """Set (or clear, with null) the group a thread belongs to."""
    group_id: Optional[int] = None


class ThreadGroupOut(BaseModel):
    id: int
    area_id: int
    name: str
    position: Optional[int] = None

    model_config = {"from_attributes": True}


class ThreadSummary(BaseModel):
    """Lightweight thread representation used in area views."""
    id: int
    area_id: int
    title: str
    status: str
    description: str
    group_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    entry_count: int
    attachment_count: int

    model_config = {"from_attributes": True}


class LinkedThreadRef(BaseModel):
    link_id: int
    thread_id: int
    thread_title: str
    thread_status: str
    area_id: int
    area_name: str
    kind: str  # blocks | relates_to


class ThreadLinkCreate(BaseModel):
    to_thread_id: int
    kind: str  # blocks | relates_to


class ThreadDetail(_SummaryMeta):
    """Full thread with all entries and attachments."""
    id: int
    area_id: int
    title: str
    status: str
    description: str
    summary: str = ""
    group_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    entries: List[EntryOut] = []
    attachments: List[AttachmentOut] = []
    outgoing_links: List[LinkedThreadRef] = []
    incoming_links: List[LinkedThreadRef] = []

    model_config = {"from_attributes": True}


# ── Areas ─────────────────────────────────────────────────────────────────────

class AreaCreate(BaseModel):
    name: str
    summary: Optional[str] = ""
    icon: Optional[str] = None


class AreaUpdate(BaseModel):
    status: Optional[str] = None
    summary: Optional[str] = None
    icon: Optional[str] = None
    auto_update: Optional[bool] = None


class SummarySuggestion(BaseModel):
    summary: str


class AreaSummary(_SummaryMeta):
    """Area card data for the dashboard."""
    id: int
    name: str
    slug: str
    status: str
    summary: str
    icon: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    thread_count: int
    open_thread_count: int

    model_config = {"from_attributes": True}


class AreaDetail(_SummaryMeta):
    """Area detail without threads (threads fetched separately)."""
    id: int
    name: str
    slug: str
    status: str
    summary: str
    icon: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Activity ──────────────────────────────────────────────────────────────────

class ActivityItem(BaseModel):
    event_type: str
    thread_id: int
    thread_title: str
    thread_status: str
    detail: Optional[str] = None
    occurred_at: datetime
    area_id: int
    area_name: str
    area_status: str

    model_config = {"from_attributes": True}


class AuditLogEntry(BaseModel):
    id: int
    entity_type: str
    entity_id: int
    action: str
    field: Optional[str] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    occurred_at: datetime

    model_config = {"from_attributes": True}


class AuditLogWithContext(BaseModel):
    id: int
    entity_type: str
    entity_id: int
    action: str
    field: Optional[str] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    occurred_at: datetime
    thread_id: Optional[int] = None
    thread_title: Optional[str] = None
    area_id: int
    area_name: str

    model_config = {"from_attributes": True}


class AllThreadSummary(BaseModel):
    id: int
    area_id: int
    area_name: str
    title: str
    status: str
    updated_at: datetime

    model_config = {"from_attributes": True}


class UpcomingTodo(BaseModel):
    id: int
    thread_id: int
    thread_title: str
    area_id: int
    area_name: str
    content: str
    due_date: Optional[date] = None

    model_config = {"from_attributes": True}


# ── Generate / Process ────────────────────────────────────────────────────────

class ProcessRequest(BaseModel):
    area_name: str
    input_text: str
    # eml | ics | pdf | text - when supplied, the prompt is biased for that
    # source (e.g. ics → produce a meeting item first).
    source_kind: Optional[str] = None
    # Existing thread titles in the area, surfaced so the AI can reuse one
    # rather than invent a duplicate. Superseded by area_id below, which lets
    # the backend build far richer context (descriptions + recent entries).
    existing_threads: Optional[List[str]] = None
    # When supplied, the backend reads the area's existing threads and their
    # recent entries from the DB and gives the AI that context so it can file
    # items into the right existing thread instead of inventing duplicates.
    area_id: Optional[int] = None
    # Incremental extraction: contents already returned in earlier passes, so
    # this pass continues with NEW items instead of repeating itself.
    exclude: Optional[List[str]] = None
    # How many items this single pass may return (the UI extracts in waves).
    max_items: Optional[int] = 8


class ProcessedItem(BaseModel):
    type: str
    content: str
    rationale: str
    # The model sometimes omits this or returns null (e.g. an item it doesn't
    # think belongs to any thread). Tolerate it here; the router fills a derived
    # fallback so the frontend always has a usable title.
    suggested_thread: Optional[str] = None
    due_date: Optional[str] = None
    meeting_at: Optional[str] = None


class ProcessResponse(BaseModel):
    items: List[ProcessedItem]


class RefineRequest(BaseModel):
    item: dict
    rejection_reason: str
    area_name: str


class RefineResponse(BaseModel):
    item: dict


# ── Roundup ───────────────────────────────────────────────────────────────────

class AreaRoundupData(BaseModel):
    area_id: int
    area_name: str
    area_status: str
    active_thread_count: int
    todos_created: int
    todos_completed: int
    decisions: List[str]
    recent_events: List[str]
    has_activity: bool


class StaleArea(BaseModel):
    id: int
    name: str
    status: str
    days_inactive: int


class RoundupData(BaseModel):
    generated_at: str
    period_days: int
    areas: List[AreaRoundupData]
    stale_areas: List[StaleArea] = []


class RoundupRequest(BaseModel):
    areas: List[dict]
    period_days: int
    generated_at: str


class RoundupResponse(BaseModel):
    text: str


# ── AI Engine settings ───────────────────────────────────────────────────────

class AIConfig(BaseModel):
    """
    The AI engine configuration stored in app_settings.

    Fields:
      provider:  one of {"claude", "groq", "gemini", "ollama", "custom"}
      model:     model name (provider-specific; falls back to preset default)
      base_url:  base URL for OpenAI-compatible providers; None for Claude
      api_key:   raw key - stored as-is in the DB, masked on read
    """
    provider: str = "claude"
    model: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None


class AIConfigOut(BaseModel):
    """
    What the frontend receives. api_key never leaves the server in plaintext -
    it's masked to bullets with the last 4 chars visible.

    `is_configured` is true when the minimum required fields for the provider
    are set (e.g. Claude requires a key; Ollama doesn't).
    """
    provider: str
    model: Optional[str]
    base_url: Optional[str]
    api_key_masked: Optional[str]
    is_configured: bool
    # True when the active engine is a small/free/local preset; lets the UI set
    # honest expectations (e.g. the Smart Generate note).
    small_model: bool = False


class AITestResult(BaseModel):
    """Result of a connection test against an AI provider."""
    ok: bool
    message: str
    provider: str
    model: Optional[str]


# ── Storage / cloud sync ─────────────────────────────────────────────────────

class StorageConfig(BaseModel):
    """
    Storage backend config - stored in app_settings under 'storage_config'.

    Only fields relevant to the active provider are populated. The password
    is encrypted at rest (Fernet symmetric encryption); see storage_backend.py.
    """
    provider: str = "local"               # local | nextcloud | webdav | s3 | google_drive | dropbox
    server_url: Optional[str] = None      # base/WebDAV URL, or S3 endpoint
    username: Optional[str] = None        # or S3 access key
    password: Optional[str] = None        # app password / S3 secret key, encrypted
    remote_folder: str = "Effro"          # or S3 key prefix
    bucket: Optional[str] = None          # S3 bucket
    region: Optional[str] = None          # S3 region
    backup_enabled: bool = True


class StorageConfigOut(BaseModel):
    """API-safe view - never returns raw passwords."""
    provider: str
    is_connected: bool
    remote_folder: str
    backup_enabled: bool
    server_url: Optional[str]
    username: Optional[str]
    bucket: Optional[str] = None
    region: Optional[str] = None
    last_backup_at: Optional[str]
    last_backup_status: Optional[str]


class StorageSyncLogOut(BaseModel):
    id: int
    event_type: str
    status: str
    provider: Optional[str]
    remote_path: Optional[str]
    size_bytes: Optional[int]
    error_message: Optional[str]
    occurred_at: datetime

    model_config = {"from_attributes": True}


# ─── Insights ─────────────────────────────────────────────────────────────────
# Read-only aggregates for the Insights page. Everything here is computed on the
# fly from existing tables - no new storage. Designed to grow: as integrations
# (Jira, mail, PRs) land, add sibling schemas and fields rather than reshaping
# these.

class MomentumArea(BaseModel):
    """One area ranked by recent activity. Null when there are too few areas
    to make a ranking meaningful (the frontend hides the card in that case)."""
    area_id: int
    area_name: str
    icon: Optional[str] = None
    status: str
    entry_count: int            # entries created in the lookback window
    last_activity_at: Optional[datetime] = None
    days_since_activity: Optional[int] = None


class CalendarEntryOut(BaseModel):
    """A meeting-type entry, surfaced for the calendar/next-meeting cards."""
    id: int
    thread_id: int
    thread_title: str
    area_id: int
    area_name: str
    content: str
    meeting_at: datetime


class InsightsOut(BaseModel):
    """Everything the Insights page needs in a single round-trip."""
    most_active: Optional[MomentumArea] = None
    quietest: Optional[MomentumArea] = None
    next_meeting: Optional[CalendarEntryOut] = None
    recent_meetings: List[CalendarEntryOut] = []
    area_count: int = 0
    lookback_days: int = 7


# ─── Today (the end-of-day wind-down) ─────────────────────────────────────────
# Every field below is computed deterministically from real rows. The narrative
# is phrased (by the AI or a template) using ONLY these facts - nothing here is
# inferred or rounded by the model. Accuracy is the whole point of this surface.

class TodayChip(BaseModel):
    """A single 'X things of type Y' summary chip in the hero."""
    type: str          # todo | decision | blockage | resolved | jira
    label: str         # human label, already singular/plural-correct
    count: int


class TodayDoneItem(BaseModel):
    """One concrete finished thing, for the 'Done today' list."""
    id: int
    type: str          # todo | decision | blockage | resolved | jira
    content: str
    area_name: Optional[str] = None
    thread_id: Optional[int] = None
    at: Optional[datetime] = None


class TodayMeeting(BaseModel):
    id: int
    content: str
    area_name: Optional[str] = None
    thread_id: Optional[int] = None
    at: datetime


class TodayProgressThread(BaseModel):
    thread_id: int
    title: str
    area_name: Optional[str] = None
    count: int         # entries added to this thread today


class TodayCreatedGroup(BaseModel):
    area_name: str
    count: int         # threads created in this area today


class TodayInsights(BaseModel):
    date: str                       # local YYYY-MM-DD the figures cover
    started_at: Optional[datetime] = None      # first presence today (UTC)
    last_active_at: Optional[datetime] = None   # last presence today (UTC)
    active_hours: Optional[float] = None        # span start->now, hours
    headline_count: int = 0         # sum of breakdown chip counts
    breakdown: List[TodayChip] = []
    done_items: List[TodayDoneItem] = []
    meetings_count: int = 0
    meetings: List[TodayMeeting] = []
    threads_progressed: List[TodayProgressThread] = []
    threads_created: List[TodayCreatedGroup] = []
    jira_connected: bool = False
    jira_filed_today: int = 0
    jira_pending: int = 0
    narrative: str = ""
    ai_generated: bool = False      # True if the AI phrased it, False = template
    workday_mode: str = "in_progress"   # wind_down | in_progress
    started_label: Optional[str] = None  # local clock label for the start, e.g. "9:05am"
    work_hours: Optional[float] = None   # active work time today (excludes lunch/long breaks)
    tip: Optional[str] = None            # rotating ADHD workday tip, shown while in progress


# ─── Reflect (this week) ──────────────────────────────────────────────────────

class Celebration(BaseModel):
    type: str          # unblocked | resolved | comeback | decisions
    text: str          # warm, grounded sentence


class WorkDay(BaseModel):
    """One day's working window, for the start/stop bars."""
    label: str                       # 'Today' or weekday abbrev
    start_hour: Optional[float] = None   # local decimal hour (e.g. 9.5)
    end_hour: Optional[float] = None
    active_hours: Optional[float] = None
    over: bool = False               # ran long (gentle flag only)


class RhythmDay(BaseModel):
    label: str                       # single-letter weekday
    count: int                       # entries created that day
    weekend: bool = False
    is_today: bool = False


class WeekInsights(BaseModel):
    narrative: str = ""              # the top "what to notice" line (deterministic)
    headline_count: int = 0
    breakdown: List[TodayChip] = []
    closed_items: List[TodayDoneItem] = []
    celebrations: List[Celebration] = []
    your_days: List[WorkDay] = []
    rhythm: List[RhythmDay] = []
    focus: Optional[str] = None      # the user's "what I'm focused on this week" note


class FocusIn(BaseModel):
    text: str = ""


# ─── Ahead ────────────────────────────────────────────────────────────────────

class TimelineItem(BaseModel):
    kind: str                        # meeting | todo
    content: str
    area_name: Optional[str] = None
    time_local: Optional[str] = None  # meetings only


class TimelineDay(BaseModel):
    iso_date: str
    label: str                       # 'now' | 'tmrw' | weekday letter
    day_num: str                     # day of month
    weekend: bool = False
    is_today: bool = False
    items: List[TimelineItem] = []


class GoodWindow(BaseModel):
    area_name: str
    quiet_days: int
    day_label: Optional[str] = None  # e.g. 'Friday', when a light day exists


class LoadCount(BaseModel):
    meetings: int = 0
    todos: int = 0


class AheadInsights(BaseModel):
    next_meeting: Optional[TodayMeeting] = None
    timeline: List[TimelineDay] = []
    forecast_next: LoadCount = LoadCount()
    forecast_prev: LoadCount = LoadCount()
    good_window: Optional[GoodWindow] = None


# ─── Balance ──────────────────────────────────────────────────────────────────

class AreaBalance(BaseModel):
    area_id: int
    name: str
    icon: Optional[str] = None
    status: str
    total: int = 0                   # entries in the window
    series: List[int] = []           # per-day counts (oldest -> newest)
    quiet_days: Optional[int] = None  # days since last activity


class DriftArea(BaseModel):
    area_id: int
    name: str
    quiet_days: int


class NotOnYou(BaseModel):
    thread_id: int
    title: str
    area_name: Optional[str] = None


class BalanceInsights(BaseModel):
    areas: List[AreaBalance] = []
    drift: List[DriftArea] = []
    not_on_you: List[NotOnYou] = []


# ─── Signals / Microsoft 365 ──────────────────────────────────────────────────
# Source-agnostic staging surface for externally-sourced items awaiting user
# triage. Microsoft Outlook is the first source; future Jira/GitHub items use
# the same shape.

class MicrosoftConfigIn(BaseModel):
    """User-supplied Azure app registration credentials."""
    client_id: str
    client_secret: str
    tenant_id: str = "common"


class MicrosoftConfigOut(BaseModel):
    """API view - secret is masked. is_configured is true iff client_id + secret are set."""
    client_id: Optional[str] = None
    client_secret_masked: Optional[str] = None
    tenant_id: str = "common"
    is_configured: bool = False


class MicrosoftProfileOut(BaseModel):
    """Connected MS account, minimal v1 fields. tokens never leave the server."""
    connected: bool
    display_name: Optional[str] = None
    email: Optional[str] = None
    connected_at: Optional[str] = None
    last_synced: Optional[str] = None


class GoogleConfigIn(BaseModel):
    """User-supplied Google Cloud OAuth client credentials."""
    client_id: str
    client_secret: str


class GoogleConfigOut(BaseModel):
    """API view - secret masked. is_configured iff client_id + secret are set."""
    client_id: Optional[str] = None
    client_secret_masked: Optional[str] = None
    is_configured: bool = False


class GoogleProfileOut(BaseModel):
    """Connected Google account, minimal fields. Tokens never leave the server."""
    connected: bool
    display_name: Optional[str] = None
    email: Optional[str] = None
    connected_at: Optional[str] = None
    last_synced: Optional[str] = None


class DropboxConfigIn(BaseModel):
    """User-supplied Dropbox app credentials."""
    app_key: str
    app_secret: str


class DropboxConfigOut(BaseModel):
    app_key: Optional[str] = None
    app_secret_masked: Optional[str] = None
    is_configured: bool = False


class DropboxProfileOut(BaseModel):
    """Connected Dropbox account. Tokens never leave the server."""
    connected: bool
    display_name: Optional[str] = None
    email: Optional[str] = None
    connected_at: Optional[str] = None


class IcloudConfigIn(BaseModel):
    """Apple ID + app-specific password (iCloud has no OAuth)."""
    apple_id: str
    app_password: str


class IcloudConfigOut(BaseModel):
    apple_id: Optional[str] = None
    app_password_masked: Optional[str] = None
    is_configured: bool = False


class IcloudProfileOut(BaseModel):
    connected: bool
    apple_id: Optional[str] = None
    last_synced: Optional[str] = None


class GithubConfigIn(BaseModel):
    """GitHub personal access token (GitHub has no simple OAuth for BYO)."""
    token: str


class GithubConfigOut(BaseModel):
    token_masked: Optional[str] = None
    login: Optional[str] = None
    is_configured: bool = False


class GithubProfileOut(BaseModel):
    connected: bool
    login: Optional[str] = None
    last_synced: Optional[str] = None


class TelegramConfigIn(BaseModel):
    """Telegram bot token (BYO, made with @BotFather)."""
    token: str


class TelegramConfigOut(BaseModel):
    token_masked: Optional[str] = None
    bot_username: Optional[str] = None
    is_configured: bool = False


class TelegramProfileOut(BaseModel):
    connected: bool
    bot_username: Optional[str] = None
    last_synced: Optional[str] = None


class MailConfigIn(BaseModel):
    """Generic IMAP mailbox: host + username + an app password. An omitted
    port keeps the stored one (the client defaults new configs to 993)."""
    host: str
    username: str
    password: str
    port: Optional[int] = None


class MailConfigOut(BaseModel):
    host: Optional[str] = None
    port: Optional[int] = None
    username: Optional[str] = None
    password_masked: Optional[str] = None
    is_configured: bool = False


class MailProfileOut(BaseModel):
    connected: bool
    username: Optional[str] = None
    host: Optional[str] = None
    last_synced: Optional[str] = None


class SignalItemOut(BaseModel):
    """A pending/assigned Signal row, enriched with the AI suggestion's labels."""
    id: int
    source: str
    external_id: str
    kind: str
    title: str
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    location: Optional[str] = None
    organizer: Optional[str] = None
    is_all_day: bool
    status: str
    suggested_area_id: Optional[int] = None
    suggested_area_name: Optional[str] = None
    suggested_thread_id: Optional[int] = None
    suggested_thread_title: Optional[str] = None
    assigned_entry_id: Optional[int] = None
    # Deep link back to the item in its source app (Jira issue / Outlook event),
    # so the user can open the original in one click. Null if not resolvable.
    external_url: Optional[str] = None
    # Accept-as affordances: the URL a Link attachment would use (deep link or
    # one found in the captured text), and whether a downloadable file (a
    # Telegram photo/document/voice...) rides on this signal.
    link_url: Optional[str] = None
    has_media: bool = False
    created_at: datetime
    updated_at: datetime


class SignalListOut(BaseModel):
    """Wraps the list with a count and an unconfigured-AI hint."""
    items: List[SignalItemOut]
    pending_count: int
    ai_configured: bool
    # Most recent successful pull across connected sources (Outlook + Jira),
    # so the page can show "synced a few minutes ago". Null if never synced.
    last_synced: Optional[datetime] = None
    # True if at least one Signals source (Outlook, Google, iCloud, GitHub, Jira)
    # is set up. Lets the page tell "nothing connected yet" (offer setup) apart
    # from "all caught up" (connected, nothing pending) when the list is empty.
    integrations_configured: bool = False


class SignalAcceptIn(BaseModel):
    """User confirms a signal onto a thread - an existing one, or a new thread
    under an area. create_as picks how it lands: an Entry ('meeting' | 'todo' |
    'decision' | 'note'), a 'link' attachment (the item's URL or one found in
    the captured text), or a 'file' attachment (Telegram media downloaded onto
    the thread). Defaults by kind when omitted."""
    area_id: int
    thread_id: Optional[int] = None
    new_thread_title: Optional[str] = None
    create_as: Optional[str] = None


class SignalReassignIn(BaseModel):
    """Move the suggestion to a different area/thread without accepting yet."""
    area_id: Optional[int] = None
    thread_id: Optional[int] = None


# ─── Signals dashboard nudge setting ──────────────────────────────────────────

class SignalNudgeSettingOut(BaseModel):
    """How loudly Signals announces itself on the dashboard.

    off          - sidebar badge only, no dashboard line
    gentle       - one calm line, dismissible for the session (default)
    with-peek    - one calm line + a 1-item preview card
    """
    mode: str = "gentle"  # off | gentle | with-peek


class SignalNudgeSettingIn(BaseModel):
    mode: str


# ─── Jira integration ──────────────────────────────────────────────────────────

class JiraConfigIn(BaseModel):
    """Atlassian OAuth 2.0 app credentials."""
    client_id: str
    client_secret: str


class JiraConfigOut(BaseModel):
    """Masked view — secret never leaves the server."""
    client_id: Optional[str] = None
    client_secret_masked: Optional[str] = None
    is_configured: bool = False


class JiraScopeIn(BaseModel):
    scope: str  # "assigned" | "mine" | "all"


class JiraScopeOut(BaseModel):
    scope: str


class JiraProfileOut(BaseModel):
    """Connected Atlassian account, minimal profile."""
    connected: bool
    display_name: Optional[str] = None
    email: Optional[str] = None
    cloud_name: Optional[str] = None
    avatar_url: Optional[str] = None
    connected_at: Optional[str] = None
    last_synced: Optional[str] = None
