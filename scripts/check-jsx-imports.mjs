/**
 * Gate check: JSX components and known helpers used but never imported or
 * declared in a file.
 *
 * Vite compiles an undefined identifier happily and the page then throws at
 * runtime, so a green build is not evidence that a refactor rewired every
 * import. Pulling the entry components out of ThreadView left exactly that
 * mistake behind, which is why this exists.
 *
 * Usage: node scripts/check-jsx-imports.mjs [files...]
 * With no arguments it walks frontend/src.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Bare function calls worth checking as well as components. Kept to helpers
// that move between files, since a full scope analysis is not the job here.
const HELPERS = [
  'format', 'parseISO', 'formatDistanceToNow', 'getDueDateClass', 'toLocalInput',
  'stripMarkdown', 'formatBytes', 'entityFor', 'entityForEntry', 'openExternal',
  'displayTitle', 'suggestTitle', 'suggestAndApplyTitle', 'notifyEntriesChanged',
]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.jsx') || p.endsWith('.js')) out.push(p)
  }
  return out
}

// Comments mention components that are not really used, so strip them first
// or every doc block that says <Toast> reads as a missing import.
//
// A comment opener only counts when something structural precedes it. Without
// that guard, accept="image/*" opens a phantom comment that swallows the rest
// of the file up to the next JSX {/* ... */}, and every declaration inside it
// disappears. Line comments likewise skip "https://".
function stripComments(src) {
  return src
    .replace(/(^|[\s{(,;=>])\/\*[\s\S]*?\*\//g, '$1 ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

function declaredIn(src) {
  const names = new Set()
  // Destructured parameters, including renames such as ({ icon: Icon }).
  for (const m of src.matchAll(/\(\s*\{([^{}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const bare = part.trim().split(':').pop().trim().split('=')[0].trim()
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(bare)) names.add(bare)
    }
  }
  for (const m of src.matchAll(/^import\s+(?:([A-Za-z0-9_$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from/gm)) {
    if (m[1]) names.add(m[1])
    if (m[2]) {
      for (const part of m[2].split(',')) {
        const bare = part.trim().split(/\s+as\s+/).pop()
        if (bare) names.add(bare)
      }
    }
  }
  // Anything the file defines itself, including destructured locals.
  for (const m of src.matchAll(/(?:function|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1])
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1])
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const bare = part.trim().split(':').pop().trim().split('=')[0].trim()
      if (bare) names.add(bare)
    }
  }
  return names
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : walk('frontend/src')
let bad = 0

for (const file of files) {
  const src = stripComments(readFileSync(file, 'utf8'))
  const declared = declaredIn(src)
  const used = new Set()
  // JSX elements starting with a capital. Namespaced ones (Foo.Bar) resolve
  // through their object, so only the root matters and it is caught anyway.
  for (const m of src.matchAll(/<([A-Z][A-Za-z0-9_$]*)(?![.\w])/g)) used.add(m[1])
  for (const helper of HELPERS) {
    const call = new RegExp('(?<![.\\w])' + helper + '\\s*\\(')
    if (call.test(src)) used.add(helper)
  }
  const missing = [...used].filter((u) => !declared.has(u))
  if (missing.length) {
    bad++
    console.log(file + '\n  missing: ' + missing.join(', '))
  }
}

console.log(bad ? '\n' + bad + ' file(s) with undeclared references' : 'No undeclared references.')
process.exit(bad ? 1 : 0)
