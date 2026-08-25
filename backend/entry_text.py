"""Shared vocabulary and text rendering for entries.

One place for the things every part of the app has to agree on about an entry:
what its human label is, which colours a user-defined type may take, how an
entry is written into an AI prompt, and how its fallback title is derived.
Kept out of models.py so the routers, the scheduler and the AI prompt builders
can import it without pulling the ORM in.
"""
import re
from urllib.parse import urlparse

# Colours a user-defined type may take. Keys only. The class strings they map
# to live in the frontend palette, written out literally, because Tailwind only
# generates classes it can see in the source.
#
# Deliberately none of the built-in type colours. Mint, sky, amber, lavender
# and terracotta already mean Update, To Do, Decision, Meeting and Blocked, so
# a user's own type painted in one of those would read as a built-in.
CUSTOM_COLOURS = ("sage", "seafoam", "dusk", "plum", "heather", "pebble")

# Types that carry a title.
#
# A To Do is already one line, so naming it would only restate it, and a
# Meeting is named by its own title field. References take their name from the
# thing they point at. Everything else is prose that can run long enough to be
# worth a one-line name, Blocked included: a blocker with a paragraph of detail
# reads exactly like an Update in that respect.
TITLED_TYPES = frozenset({"entry", "decision", "custom", "blockage"})

# Longest title we store, and the longest a derived or generated one runs to.
TITLE_MAX = 120
TITLE_CUT = 60

# Human labels for the stored type values. The stored value is never shown.
TYPE_LABELS = {
    "entry": "Update",
    "todo": "To Do",
    "decision": "Decision",
    "meeting": "Meeting",
    "blockage": "Blocked",
}


# How a reference reads in an AI prompt. The verb says what happened, which is
# what a model needs to know about it.
REF_LABELS = {
    "file": "File attached",
    "link": "Link added",
    "thread": "Linked thread",
    "folio": "Folio filed",
}


def entry_label(entry) -> str:
    """The label to show for an entry, following its custom type when it has one."""
    if entry.type == "reference":
        return REF_LABELS.get(entry.ref_kind, "Attached")
    if entry.type == "custom":
        custom = getattr(entry, "custom_type", None)
        if custom is not None and custom.name:
            return custom.name
        # A custom entry whose type was deleted underneath it. Rare, and only
        # reachable through a direct database edit, since deleting a type
        # converts its entries back to Updates first.
        return "Update"
    return TYPE_LABELS.get(entry.type, "Update")


def entry_prompt_line(entry, limit: int | None = None) -> str:
    """One line describing an entry, for an AI prompt.

    Prefixed with the entry's label in square brackets so the model can tell a
    Decision from a Blocked item from a user's own Risk without being told the
    taxonomy separately. Every prompt builder uses this, so a new entry type is
    understood everywhere the moment it exists.

    `limit` trims the content at a word boundary. The callers each had their own
    cap on how much of an entry they were willing to spend prompt budget on, and
    those caps are kept rather than flattened to one.
    """
    content = " ".join((entry.content or "").split())
    if limit is not None and len(content) > limit:
        content = content[:limit].rsplit(" ", 1)[0] or content[:limit]
    if entry.type == "reference" and entry.ref_kind == "link":
        host = _host_of(entry)
        if host:
            content = f"{content} ({host})"
    return f"[{entry_label(entry)}] {content}"


def _host_of(entry) -> str:
    """The hostname behind a link reference, when the attachment is still there."""
    attachment = getattr(entry, "ref_attachment", None)
    url = getattr(attachment, "url", None)
    if not url:
        return ""
    try:
        return urlparse(url).hostname or ""
    except ValueError:
        return ""


# ── Titles ───────────────────────────────────────────────────────────────────

# Ported from stripMarkdown in frontend/src/utils/markdownEditing.js. The two
# sides have to agree, because the server writes the fallback title and the
# client derives the same thing for one-line labels before a save lands.
_MD_PATTERNS = (
    (re.compile(r"!\[([^\]]*)\]\([^)]*\)"), r"\1"),      # images -> alt text
    (re.compile(r"\[([^\]]+)\]\([^)]*\)"), r"\1"),       # links -> label
    (re.compile(r"(\*\*|__)([^*_]+)\1"), r"\2"),         # bold
    (re.compile(r"(\*|_)([^*_]+)\1"), r"\2"),            # italic
    (re.compile(r"~~([^~]+)~~"), r"\1"),                 # strikethrough
    (re.compile(r"`([^`]*)`"), r"\1"),                   # inline code
    (re.compile(r"^#{1,6}\s+", re.M), ""),               # headings
    (re.compile(r"^>\s+", re.M), ""),                    # blockquotes
    (re.compile(r"^\s*([-*+]|\d+\.)\s+", re.M), ""),     # list markers
)


def strip_markdown(text: str) -> str:
    if not text:
        return text or ""
    out = str(text)
    for pattern, repl in _MD_PATTERNS:
        out = pattern.sub(repl, out)
    return out


def cut_at_word(text: str, limit: int) -> str:
    """Trim to a length on a word boundary, so a title never ends mid-word."""
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0] or text[:limit]


def fallback_title(content: str) -> str:
    """A title derived from the entry's own first line.

    Written on the server so every client gets one, and never shown on the
    card, since it would only echo the text directly beneath it. It exists so
    one-line contexts (lists, search results, the In Hand strip) always have
    something to show, and so an AI suggestion has something to replace.
    """
    plain = strip_markdown(content or "")
    for line in plain.splitlines():
        collapsed = " ".join(line.split())
        if collapsed:
            return cut_at_word(collapsed, TITLE_CUT)
    return "Untitled"


def clean_title(raw: str) -> str:
    """Normalise a title from any source: trimmed, single-spaced, capped."""
    return cut_at_word(" ".join((raw or "").split()), TITLE_MAX)


def entry_display_title(entry) -> str:
    """The one-line label for an entry, for activity rows and the like."""
    return (entry.title or "").strip() or fallback_title(entry.content)
