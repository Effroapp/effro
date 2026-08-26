/**
 * Gate check: every Lucide icon the pickers can list resolves to a real
 * component.
 *
 * The entry-type picker and the area picker both work in kebab case and store
 * a name rather than a component, so the kebab name has to travel back to a
 * Lucide export. Title-casing each part is right for all but a handful:
 * ArrowDownAZ kebabs to arrow-down-az and title-cases back to ArrowDownAz,
 * which is not an export. Those four resolved to null and were silently
 * dropped from the grid, which looks like nothing at all rather than an error.
 *
 * This mirrors the conversions in src/utils/entityIcons.js. If it fails after a
 * Lucide upgrade, the two must be brought back into step.
 *
 * Run from the frontend directory, where lucide-react resolves:
 *   node scripts/check-icon-names.mjs
 */
import * as LucideIcons from 'lucide-react'

const pascalToKebab = (name) =>
  String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()

let exportByKebab = null
function kebabIndex() {
  if (exportByKebab) return exportByKebab
  exportByKebab = new Map()
  for (const key of Object.keys(LucideIcons)) {
    if (!/^[A-Z][A-Za-z0-9]*$/.test(key)) continue
    if (key.startsWith('Lucide') || key.endsWith('Icon')) continue
    const kebab = pascalToKebab(key)
    if (!exportByKebab.has(kebab)) exportByKebab.set(kebab, key)
  }
  return exportByKebab
}

const kebabToPascal = (name) =>
  kebabIndex().get(String(name || '')) ||
  String(name || '').split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')

const names = Object.keys(LucideIcons).filter(
  (k) => /^[A-Z][A-Za-z0-9]*$/.test(k) && !k.startsWith('Lucide') && !k.endsWith('Icon'),
)
const kebabs = [...new Set(names.map(pascalToKebab))]

const broken = kebabs.filter((k) => !LucideIcons[kebabToPascal(k)])

console.log(`Checked ${names.length} Lucide exports, ${kebabs.length} distinct names.`)
if (broken.length) {
  console.log('These names would render nothing:')
  for (const k of broken.slice(0, 20)) console.log('  ' + k)
  process.exit(1)
}
console.log('Every listed icon resolves to a component.')
