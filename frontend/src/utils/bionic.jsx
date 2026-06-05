/**
 * Bionic reading: bold the leading part of each word to create "fixation
 * points" the eye can hop between, which many readers (ADHD included) find
 * faster. Implemented at the React/markdown layer so the app renders the bold
 * itself - no global DOM mutation that would fight React and crash on updates.
 */
import { useBionic } from '../hooks/useBionic'

// How many leading characters to embolden. Matches Bionic Reading's default
// "fixation" of 30% of the word, rounded up, at least one character. The
// remainder is left at normal weight (Bionic Reading does not dim it).
const FIXATION = 0.3
function boldLen(word) {
  return Math.max(1, Math.ceil(word.length * FIXATION))
}

// Wrap any plain-text string so it bionic-izes when the mode is on, and renders
// untouched otherwise. For markdown content, use the rehypeBionic plugin instead.
export function BionicText({ children }) {
  const on = useBionic()
  return on && typeof children === 'string' ? bionicizeReact(children) : children
}

// Plain string -> React nodes, with each word's prefix wrapped in <b>.
// Whitespace is preserved so layout is unchanged.
export function bionicizeReact(text) {
  if (!text) return text
  return String(text).split(/(\s+)/).map((tok, i) => {
    if (!tok || /^\s+$/.test(tok)) return tok
    const b = boldLen(tok)
    return (
      <span key={i}>
        <b className="bionic-fix">{tok.slice(0, b)}</b>{tok.slice(b)}
      </span>
    )
  })
}

// rehype plugin: same transform for markdown-rendered content. Skips code/pre.
export function rehypeBionic() {
  return (tree) => walk(tree)
}

function walk(node) {
  if (!node.children) return
  const out = []
  for (const child of node.children) {
    if (child.type === 'text') {
      out.push(...textToHast(child.value))
    } else {
      if (child.tagName !== 'code' && child.tagName !== 'pre') walk(child)
      out.push(child)
    }
  }
  node.children = out
}

function textToHast(text) {
  const nodes = []
  for (const tok of String(text).split(/(\s+)/)) {
    if (!tok) continue
    if (/^\s+$/.test(tok)) { nodes.push({ type: 'text', value: tok }); continue }
    const b = boldLen(tok)
    nodes.push({
      type: 'element', tagName: 'strong', properties: { className: ['bionic-fix'] },
      children: [{ type: 'text', value: tok.slice(0, b) }],
    })
    if (tok.length > b) nodes.push({ type: 'text', value: tok.slice(b) })
  }
  return nodes
}
