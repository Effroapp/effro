"""
Folio capture helpers: turn a pasted link or an uploaded file into the readable
text that feeds the digest and search. Documents reuse ingest.parse_file;
images go through the AI vision adapter (see folio_vision). Links are fetched
here with an SSRF guard.

Everything is best-effort: a fetch or parse failure returns empty text with a
note rather than raising, so a capture is never lost just because extraction
struggled.
"""
from __future__ import annotations

import ipaddress
import logging
import re
import socket
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

log = logging.getLogger("effro.folio.capture")

_MAX_FETCH_BYTES = 3_000_000     # ~3 MB of HTML is plenty for an article
_MAX_TEXT_CHARS = 60_000         # matches ingest.parse_file's clamp
_UA = "Mozilla/5.0 (compatible; EffroFolio/1.0; +https://effro.io)"

# Block text gathered from these; everything inside chrome/script is dropped.
_BLOCK_TAGS = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote",
               "article", "section", "td", "th", "dd", "dt", "figcaption", "pre"}
_SKIP_TAGS = {"script", "style", "noscript", "nav", "header", "footer", "aside",
              "form", "svg", "button", "select", "option", "template", "iframe"}


def is_fetchable_url(url: str) -> bool:
    """True only for an http(s) URL whose host resolves entirely to PUBLIC IPs.
    Blocks SSRF to internal / loopback / link-local / cloud-metadata hosts. (A
    residual DNS-rebinding gap remains because httpx re-resolves on the actual
    request; the public-IP gate closes the practical exploit, matching the
    stance taken for the OIDC discovery fetch.)"""
    try:
        p = urlparse(url)
        if p.scheme not in ("http", "https") or not p.hostname:
            return False
        port = p.port or (443 if p.scheme == "https" else 80)
        infos = socket.getaddrinfo(p.hostname, port, proto=socket.IPPROTO_TCP)
        if not infos:
            return False
        for *_unused, sockaddr in infos:
            ip = ipaddress.ip_address(sockaddr[0])
            if (ip.is_private or ip.is_loopback or ip.is_link_local
                    or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
                return False
        return True
    except (OSError, ValueError):
        return False


class _Extractor(HTMLParser):
    """Pulls the <title>, a favicon href, and readable block text. Deliberately
    modest (stdlib only, no readability dep) - good enough for v1, and the
    digest tolerates some noise. Skips script/style/nav/footer chrome."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title_parts: list[str] = []
        self.favicon: str | None = None
        self._chunks: list[str] = []
        self._skip_depth = 0
        self._in_title = False
        self._capture_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in _SKIP_TAGS:
            self._skip_depth += 1
        elif tag == "title":
            self._in_title = True
        elif tag == "link":
            a = dict(attrs)
            rel = (a.get("rel") or "").lower()
            if "icon" in rel and a.get("href"):
                self.favicon = a["href"]
        elif tag in _BLOCK_TAGS:
            self._capture_depth += 1
            self._chunks.append("\n")

    def handle_endtag(self, tag):
        if tag in _SKIP_TAGS and self._skip_depth > 0:
            self._skip_depth -= 1
        elif tag == "title":
            self._in_title = False
        elif tag in _BLOCK_TAGS and self._capture_depth > 0:
            self._capture_depth -= 1
            self._chunks.append("\n")

    def handle_data(self, data):
        if self._skip_depth:
            return
        if self._in_title:
            self.title_parts.append(data)
        elif self._capture_depth:
            self._chunks.append(data)

    def result(self) -> tuple[str, str]:
        title = re.sub(r"\s+", " ", "".join(self.title_parts)).strip()
        text = "".join(self._chunks)
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
        return title, text.strip()


def extract_html(html: str, base_url: str) -> dict:
    parser = _Extractor()
    try:
        parser.feed(html)
    except Exception:
        pass
    title, text = parser.result()
    host = urlparse(base_url).hostname or ""
    favicon = parser.favicon
    if favicon:
        favicon = urljoin(base_url, favicon)
    elif host:
        p = urlparse(base_url)
        favicon = f"{p.scheme}://{host}/favicon.ico"
    return {"title": title, "extracted_text": text, "domain": host, "favicon_url": favicon}


def fetch_readable(url: str) -> dict:
    """Fetch a URL and return {extracted_text, title, domain, favicon_url}.
    Raises ValueError for a blocked / non-public URL so the route can 400."""
    url = (url or "").strip()
    if not is_fetchable_url(url):
        raise ValueError("That link could not be fetched (only public web addresses are allowed).")
    import httpx
    domain = urlparse(url).hostname or ""
    try:
        with httpx.Client(timeout=10.0, follow_redirects=True,
                          headers={"User-Agent": _UA, "Accept": "text/html,*/*"}) as client:
            r = client.get(url)
            r.raise_for_status()
            ctype = r.headers.get("content-type", "")
            raw = r.content[:_MAX_FETCH_BYTES]
            if "html" in ctype or raw[:512].lstrip().lower().startswith((b"<!doctype", b"<html")):
                html = raw.decode(r.encoding or "utf-8", errors="ignore")
                out = extract_html(html, str(r.url))
            else:
                # Non-HTML (e.g. a plain-text page): keep the body as text.
                out = {"title": "", "extracted_text": raw.decode("utf-8", errors="ignore").strip(),
                       "domain": domain, "favicon_url": f"{urlparse(url).scheme}://{domain}/favicon.ico"}
    except ValueError:
        raise
    except Exception as e:
        log.warning("folio link fetch failed for %s: %s", domain, e)
        # Don't lose the capture - keep the URL, leave text empty with a note.
        out = {"title": "", "extracted_text": "",
               "domain": domain, "favicon_url": None,
               "error": "Could not read this link automatically."}
    if out.get("extracted_text") and len(out["extracted_text"]) > _MAX_TEXT_CHARS:
        out["extracted_text"] = out["extracted_text"][:_MAX_TEXT_CHARS] + "\n\n[…truncated]"
    return out


def extract_file(filename: str, content: bytes) -> str:
    """Readable text from an uploaded document. Reuses the shared ingest
    parser (pdf / text / eml / ics)."""
    import ingest
    text, _kind = ingest.parse_file(filename or "", content)
    return text
