import { useState, useEffect } from 'react'

export const FONT_OPTIONS = [
  {
    key: 'geist', label: 'Geist', stack: "'Geist Sans', system-ui, sans-serif", hint: 'Default',
    desc: "The app's default. A clean, modern sans-serif tuned for screens.",
  },
  {
    key: 'lexend', label: 'Lexend', stack: "'Lexend', 'Geist Sans', system-ui, sans-serif", hint: 'ADHD-friendly',
    desc: 'Spaced and shaped to reduce visual stress and improve reading speed. A strong default for ADHD readers.',
  },
  {
    key: 'opendyslexic', label: 'OpenDyslexic', stack: "'OpenDyslexic', 'Geist Sans', system-ui, sans-serif", hint: 'Dyslexia',
    desc: 'Letters have weighted bottoms and distinct shapes, which helps stop them rotating or swapping. Designed for dyslexia.',
  },
  {
    // A reading MODE, not a typeface: it bolds the start of each word. The base
    // font stays a readable Lexend. `useBionic` reads this key to switch it on.
    key: 'bionic', label: 'Bionic Reading', stack: "'Lexend', 'Geist Sans', system-ui, sans-serif", hint: 'Reading mode',
    desc: 'Bolds the start of each word to create fixation points your eye can hop between, which can speed up reading.',
  },
]

const DEFAULT_FONT = 'geist'

/**
 * Manages the body font choice.
 * Persists to localStorage and sets a CSS variable on <html> so the rule in
 * index.css (html { font-family: var(--font-body) }) picks it up.
 * Display headings (font-display) and code (font-mono) stay untouched.
 */
export function useFont() {
  const [font, setFontState] = useState(() => {
    const stored = localStorage.getItem('font')
    if (stored && FONT_OPTIONS.some((o) => o.key === stored)) return stored
    return DEFAULT_FONT
  })

  useEffect(() => {
    const option = FONT_OPTIONS.find((o) => o.key === font) ?? FONT_OPTIONS[0]
    document.documentElement.style.setProperty('--font-body', option.stack)
    localStorage.setItem('font', font)
  }, [font])

  return { font, setFont: setFontState }
}
