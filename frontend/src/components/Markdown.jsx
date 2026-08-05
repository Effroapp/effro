import ReactMarkdown from 'react-markdown'
import { useBionic } from '../hooks/useBionic'
import { rehypeBionic } from '../utils/bionic.jsx'
import { openExternal } from '../api/tauri'

// Links in rendered prose hand off to the OS browser - the desktop webview
// blocks target="_blank", so every external link must go through openExternal.
function MdLink({ href, children }) {
  return (
    <a
      href={href}
      onClick={(e) => { e.preventDefault(); openExternal(href) }}
    >
      {children}
    </a>
  )
}

/**
 * Markdown — the app's one prose renderer. Everything a MarkdownArea saves is
 * displayed through this, so formatting looks identical everywhere: prose-entry
 * styles, Bionic reading support, OS-browser link handling.
 */
export default function Markdown({ children, className = '' }) {
  const bionic = useBionic()
  if (!children) return null
  return (
    <div className={`prose-entry ${className}`}>
      <ReactMarkdown
        rehypePlugins={bionic ? [rehypeBionic] : []}
        components={{ a: MdLink }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

// Inline-only variant for single-line surfaces (to-do rows, tight labels):
// bold/italic/links/code render, block structure is flattened to plain text.
const INLINE_ALLOWED = ['p', 'strong', 'em', 'a', 'code']

export function InlineMarkdown({ children }) {
  const bionic = useBionic()
  if (!children) return null
  return (
    <ReactMarkdown
      rehypePlugins={bionic ? [rehypeBionic] : []}
      allowedElements={INLINE_ALLOWED}
      unwrapDisallowed
      components={{ a: MdLink, p: ({ children: c }) => <>{c}</> }}
    >
      {children}
    </ReactMarkdown>
  )
}
