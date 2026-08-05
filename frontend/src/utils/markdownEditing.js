// Pure text helpers behind the formatting toolbar (MarkdownArea). All of them
// take the textarea's value + selection and return the next value + selection,
// so the component stays a thin shell and these stay unit-testable.

// Toggle an inline wrapper (** for bold, _ for italic) around the selection.
// Re-applying on an already-wrapped selection unwraps it.
export function toggleInlineWrap(value, start, end, marker) {
  const len = marker.length
  const sel = value.slice(start, end)

  // Selection includes the markers themselves -> unwrap
  if (sel.length >= 2 * len && sel.startsWith(marker) && sel.endsWith(marker)) {
    const inner = sel.slice(len, sel.length - len)
    return {
      value: value.slice(0, start) + inner + value.slice(end),
      selStart: start,
      selEnd: start + inner.length,
    }
  }

  // Markers sit just outside the selection -> unwrap
  if (value.slice(Math.max(0, start - len), start) === marker && value.slice(end, end + len) === marker) {
    return {
      value: value.slice(0, start - len) + sel + value.slice(end + len),
      selStart: start - len,
      selEnd: start - len + sel.length,
    }
  }

  // Wrap. With an empty selection the caret lands between the markers.
  return {
    value: value.slice(0, start) + marker + sel + marker + value.slice(end),
    selStart: start + len,
    selEnd: end + len,
  }
}

const BULLET_RE = /^\s*[-*]\s+/
const NUMBER_RE = /^\s*\d+\.\s+/

// Toggle "- " or "1. " prefixes on every line the selection touches. If every
// non-empty line already has the requested prefix, the toggle removes it.
export function toggleLinePrefix(value, start, end, type) {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  let lineEnd = value.indexOf('\n', end)
  if (lineEnd === -1) lineEnd = value.length

  const lines = value.slice(lineStart, lineEnd).split('\n')
  const re = type === 'bullet' ? BULLET_RE : NUMBER_RE
  const isOn = lines.every((l) => !l.trim() || re.test(l))

  let n = 0
  const next = lines
    .map((l) => {
      if (!l.trim()) return l
      const stripped = l.replace(BULLET_RE, '').replace(NUMBER_RE, '')
      if (isOn) return stripped
      n += 1
      return type === 'bullet' ? `- ${stripped}` : `${n}. ${stripped}`
    })
    .join('\n')

  return {
    value: value.slice(0, lineStart) + next + value.slice(lineEnd),
    selStart: lineStart,
    selEnd: lineStart + next.length,
  }
}

// Enter inside a list continues it with the next marker; Enter on an empty
// item clears the marker and exits the list. Returns null when the caret is
// not on a list line (caller lets the default newline happen).
export function continueListOnEnter(value, pos) {
  const lineStart = value.lastIndexOf('\n', pos - 1) + 1
  const line = value.slice(lineStart, pos)
  const m = line.match(/^([-*]|\d+\.)\s+(.*)$/)
  if (!m) return null

  if (!m[2].trim()) {
    // Empty item: exit the list
    return { value: value.slice(0, lineStart) + value.slice(pos), caret: lineStart }
  }

  const marker = /^\d+\./.test(m[1]) ? `${parseInt(m[1], 10) + 1}. ` : `${m[1]} `
  const insert = `\n${marker}`
  return { value: value.slice(0, pos) + insert + value.slice(pos), caret: pos + insert.length }
}

// Turn the selection into a link, leaving "url" selected so the user can type
// straight over it.
export function insertLink(value, start, end) {
  const label = value.slice(start, end) || 'link text'
  const snippet = `[${label}](url)`
  const urlStart = start + label.length + 3
  return {
    value: value.slice(0, start) + snippet + value.slice(end),
    selStart: urlStart,
    selEnd: urlStart + 3,
  }
}

// Reduce markdown to plain text for one-line previews (cards, subtitles,
// truncated lists) so markers never show as noise outside a prose surface.
export function stripMarkdown(text) {
  if (!text) return text
  return String(text)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')     // images -> alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')      // links -> label
    .replace(/(\*\*|__)([^*_]+)\1/g, '$2')        // bold
    .replace(/(\*|_)([^*_]+)\1/g, '$2')           // italic
    .replace(/~~([^~]+)~~/g, '$1')                // strikethrough
    .replace(/`([^`]*)`/g, '$1')                  // inline code
    .replace(/^#{1,6}\s+/gm, '')                  // headings
    .replace(/^>\s+/gm, '')                       // blockquotes
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, '')        // list markers
}
