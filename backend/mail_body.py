"""
Shared email body extraction for the mail and iCloud engines.

Both pull flagged mail over IMAP; both previously read headers only, so the
suggester judged emails by subject line alone. extract_body() turns a parsed
message into clean text the model can actually read:

  - walk the MIME tree, prefer text/plain, fall back to text/html stripped
    to text (stdlib HTMLParser, no new dependencies)
  - cut the quoted reply chain and signature - from the first "On ... wrote:"
    or "-- " marker down - so the new content is read, not the thread history
  - return a truncated clean copy plus any attachment filenames, so a
    body-less message can still be described as subject + attachments

Callers keep their raw stored payloads; this is the model-facing copy.
"""
from __future__ import annotations

import email.message
import re
from html import unescape
from html.parser import HTMLParser

# Cut everything from the first reply-quote or signature marker down.
_CUT_MARKERS = (
    re.compile(r"^On .{0,300}wrote:\s*$", re.MULTILINE),
    re.compile(r"^--\s*$", re.MULTILINE),
)

_BLOCK_TAGS = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "blockquote"}


class _HTMLText(HTMLParser):
    """Collects readable text from HTML, dropping script/style and turning
    block boundaries into newlines."""

    def __init__(self):
        super().__init__()
        self._chunks: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip_depth += 1
        elif tag in _BLOCK_TAGS:
            self._chunks.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._skip_depth:
            self._skip_depth -= 1

    def handle_data(self, data):
        if not self._skip_depth:
            self._chunks.append(data)

    def text(self) -> str:
        return "".join(self._chunks)


def _html_to_text(html: str) -> str:
    try:
        p = _HTMLText()
        p.feed(html)
        return unescape(p.text())
    except Exception:
        # Worst case: strip tags crudely rather than lose the body.
        return unescape(re.sub(r"<[^>]+>", " ", html))


def _cut_quoted(text: str) -> str:
    cut = len(text)
    for marker in _CUT_MARKERS:
        m = marker.search(text)
        if m:
            cut = min(cut, m.start())
    return text[:cut]


def _decode_part(part: email.message.Message) -> str:
    payload = part.get_payload(decode=True)
    if payload is None:
        return ""
    charset = part.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, "replace")
    except LookupError:                      # unknown charset label
        return payload.decode("utf-8", "replace")


def extract_body(msg: email.message.Message, *, max_chars: int = 2000) -> tuple[str, list[str]]:
    """(clean body text, attachment filenames) for a parsed email message.

    The body is the joined text/plain parts when any exist, else the text/html
    parts stripped to text - in both cases with the quoted reply chain and
    signature cut, whitespace settled, and the result truncated to max_chars.
    Empty string when the message has no readable text; the caller then falls
    back to subject + attachment names rather than feeding nothing onward."""
    plain: list[str] = []
    html: list[str] = []
    attachments: list[str] = []

    for part in msg.walk():
        if part.is_multipart():
            continue
        filename = part.get_filename()
        disposition = (part.get("Content-Disposition") or "").lower()
        if filename or "attachment" in disposition:
            if filename:
                attachments.append(filename)
            continue
        ctype = part.get_content_type()
        if ctype == "text/plain":
            plain.append(_decode_part(part))
        elif ctype == "text/html":
            html.append(_decode_part(part))

    body = "\n".join(plain).strip() or _html_to_text("\n".join(html)).strip()
    body = _cut_quoted(body)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    return body[:max_chars].rstrip(), attachments
