"""Shared vocabulary and text rendering for entries.

One place for the things every part of the app has to agree on about an entry:
what its human label is, which colours a user-defined type may take, and how an
entry is written into an AI prompt. Kept out of models.py so the routers, the
scheduler and the AI prompt builders can import it without pulling the ORM in.
"""

# Colours a user-defined type may take. Keys only. The class strings they map
# to live in the frontend palette, written out literally, because Tailwind only
# generates classes it can see in the source.
#
# Deliberately none of the built-in type colours. Mint, sky, amber, lavender
# and terracotta already mean Update, To Do, Decision, Meeting and Blocked, so
# a user's own type painted in one of those would read as a built-in.
CUSTOM_COLOURS = ("sage", "seafoam", "dusk", "plum", "heather", "pebble")

# Human labels for the stored type values. The stored value is never shown.
TYPE_LABELS = {
    "entry": "Update",
    "todo": "To Do",
    "decision": "Decision",
    "meeting": "Meeting",
    "blockage": "Blocked",
}


def entry_label(entry) -> str:
    """The label to show for an entry, following its custom type when it has one."""
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
    return f"[{entry_label(entry)}] {content}"
