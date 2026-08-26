import { useId } from 'react'

import { SECTION_STYLES } from '../hooks/useDashboardStyling'

/**
 * The seven section-style tiles, as little pictures of what each one does.
 *
 * Lifted from the design reference so the settings tiles and the dashboard
 * cannot drift apart, with the mock's variable names swapped for the
 * dashboard's own --dz-* set. The app's --paper and --ink are static, so the
 * originals would have kept every tile light on a dark page. The picker's
 * wrapper carries .dz-tokens, which is where that set is defined.
 */
const GLYPHS = {
  plain: (shadow) => (
    <><rect x="2" y="3" width="14" height="3" rx="1.5" fill="var(--dz-text)"/><rect x="2.5" y="10.5" width="39" height="16" rx="3" fill="var(--dz-sheet)" stroke="var(--dz-rule)"/></>
  ),
  lifted: (shadow) => (
    <><rect x="2" y="3" width="14" height="3" rx="1.5" fill="var(--dz-text)"/><rect x="3" y="12" width="39" height="16" rx="3" fill="var(--dz-text)" opacity=".14" filter={shadow}/><rect x="2.5" y="10.5" width="39" height="16" rx="3" fill="var(--dz-sheet)"/></>
  ),
  sheet: (shadow) => (
    <><rect x="3" y="5" width="39" height="23" rx="3" fill="var(--dz-text)" opacity=".14" filter={shadow}/><rect x="2.5" y="3.5" width="39" height="23" rx="3" fill="var(--dz-sheet)"/><rect x="6" y="7" width="13" height="3" rx="1.5" fill="var(--dz-text)"/><path d="M6 13.5h32" stroke="var(--dz-rule)"/></>
  ),
  inset: (shadow) => (
    <><rect x="3" y="5" width="39" height="23" rx="3" fill="var(--dz-text)" opacity=".14" filter={shadow}/><rect x="2.5" y="3.5" width="39" height="23" rx="3" fill="var(--dz-sheet)"/><rect x="6" y="7" width="13" height="3" rx="1.5" fill="var(--dz-text)"/><rect x="5.5" y="13.5" width="33" height="10" rx="2" fill="var(--dz-page)" stroke="var(--dz-rule-soft)"/></>
  ),
  folder: (shadow) => (
    <><g opacity=".14" filter={shadow}><rect x="3" y="11" width="39" height="17" rx="3" fill="var(--dz-text)"/><rect x="3" y="5" width="17" height="8" rx="2" fill="var(--dz-text)"/></g><rect x="2.5" y="9.5" width="39" height="17" rx="3" fill="var(--dz-sheet)"/><path d="M2.5 12.5v-7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v7z" fill="var(--dz-sheet)"/><rect x="6" y="5.5" width="9" height="2.5" rx="1.25" fill="var(--dz-text)"/></>
  ),
  margin: (shadow) => (
    <><path d="M3.5 3v24" stroke="var(--dz-text)" strokeOpacity=".28" strokeWidth="2"/><rect x="8" y="3" width="14" height="3" rx="1.5" fill="var(--dz-text)"/><rect x="8.5" y="10.5" width="33" height="16" rx="3" fill="var(--dz-sheet)" stroke="var(--dz-rule)"/></>
  ),
  boxed: (shadow) => (
    <><rect x="2.5" y="3.5" width="39" height="23" rx="3" fill="var(--dz-sheet)" stroke="var(--dz-rule)"/><path d="M2.5 6.5a3 3 0 0 1 3-3h33a3 3 0 0 1 3 3v5h-39z" fill="var(--dz-card)"/><path d="M2.5 11.5h39" stroke="var(--dz-rule)"/><rect x="6" y="6" width="11" height="2.5" rx="1.25" fill="var(--dz-text-soft)"/></>
  ),
}

export default function SectionStyleGlyph({ style, className = '' }) {
  // useId returns a bracketed or colon-wrapped token depending on the React
  // version, and url(#...) will not parse either, so keep the word characters.
  const filterId = `sh-${useId().replace(/\W/g, '')}`
  const shadow = `url(#${filterId})`
  const glyph = (GLYPHS[style] ?? GLYPHS.plain)(shadow)
  return (
    <svg viewBox="0 0 44 30" width="44" height="30" aria-hidden="true" className={className}>
      <defs>
        <filter id={filterId} x="-30%" y="-30%" width="160%" height="180%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>
      {glyph}
    </svg>
  )
}

export { SECTION_STYLES }
