import { SECTION_STYLES } from '../hooks/useDashboardStyling'

/**
 * The seven section-style tiles, as little pictures of what each one does.
 *
 * Lifted verbatim from the design reference so the settings tiles and the
 * dashboard cannot drift apart. Each is drawn in theme variables rather than
 * fixed colours, so they follow light and dark without a second set.
 */
const GLYPHS = {
  plain: (
    <><rect x="2" y="3" width="14" height="3" rx="1.5" fill="var(--ink)"/><rect x="2.5" y="10.5" width="39" height="16" rx="3" fill="var(--sheet)" stroke="var(--rule)"/></>
  ),
  lifted: (
    <><rect x="2" y="3" width="14" height="3" rx="1.5" fill="var(--ink)"/><rect x="3" y="12" width="39" height="16" rx="3" fill="var(--ink)" opacity=".14" filter="url(#g-sh)"/><rect x="2.5" y="10.5" width="39" height="16" rx="3" fill="var(--sheet)"/></>
  ),
  sheet: (
    <><rect x="3" y="5" width="39" height="23" rx="3" fill="var(--ink)" opacity=".14" filter="url(#g-sh)"/><rect x="2.5" y="3.5" width="39" height="23" rx="3" fill="var(--sheet)"/><rect x="6" y="7" width="13" height="3" rx="1.5" fill="var(--ink)"/><path d="M6 13.5h32" stroke="var(--rule)"/></>
  ),
  inset: (
    <><rect x="3" y="5" width="39" height="23" rx="3" fill="var(--ink)" opacity=".14" filter="url(#g-sh)"/><rect x="2.5" y="3.5" width="39" height="23" rx="3" fill="var(--sheet)"/><rect x="6" y="7" width="13" height="3" rx="1.5" fill="var(--ink)"/><rect x="5.5" y="13.5" width="33" height="10" rx="2" fill="var(--paper)" stroke="var(--rule-soft)"/></>
  ),
  folder: (
    <><g opacity=".14" filter="url(#g-sh)"><rect x="3" y="11" width="39" height="17" rx="3" fill="var(--ink)"/><rect x="3" y="5" width="17" height="8" rx="2" fill="var(--ink)"/></g><rect x="2.5" y="9.5" width="39" height="17" rx="3" fill="var(--sheet)"/><path d="M2.5 12.5v-7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v7z" fill="var(--sheet)"/><rect x="6" y="5.5" width="9" height="2.5" rx="1.25" fill="var(--ink)"/></>
  ),
  margin: (
    <><path d="M3.5 3v24" stroke="var(--ink)" stroke-opacity=".28" strokeWidth="2"/><rect x="8" y="3" width="14" height="3" rx="1.5" fill="var(--ink)"/><rect x="8.5" y="10.5" width="33" height="16" rx="3" fill="var(--sheet)" stroke="var(--rule)"/></>
  ),
  boxed: (
    <><rect x="2.5" y="3.5" width="39" height="23" rx="3" fill="var(--sheet)" stroke="var(--rule)"/><path d="M2.5 6.5a3 3 0 0 1 3-3h33a3 3 0 0 1 3 3v5h-39z" fill="var(--paper-2)"/><path d="M2.5 11.5h39" stroke="var(--rule)"/><rect x="6" y="6" width="11" height="2.5" rx="1.25" fill="var(--ink-soft)"/></>
  ),
}

export default function SectionStyleGlyph({ style, className = '' }) {
  const glyph = GLYPHS[style] ?? GLYPHS.plain
  return (
    <svg viewBox="0 0 44 30" width="44" height="30" aria-hidden="true" className={className}>
      {glyph}
    </svg>
  )
}

export { SECTION_STYLES }
