import { useCallback, useEffect, useState } from 'react'

export const DASHBOARD_LAYOUTS = [
  { key: 'stacked', label: 'Stacked' },
  { key: 'split',   label: 'Split' },
  { key: 'rail',    label: 'Rail' },
]

export const SECTION_STYLES = [
  { key: 'plain',   label: 'Plain' },
  { key: 'lifted',  label: 'Lifted' },
  { key: 'sheet',   label: 'Sheet' },
  { key: 'inset',   label: 'Inset' },
  { key: 'folder',  label: 'Folder' },
  { key: 'margin',  label: 'Margin' },
  { key: 'boxed',   label: 'Boxed' },
]

const DEFAULT_LAYOUT = 'split'
const DEFAULT_SECTION_STYLE = 'inset'

const LAYOUT_KEY = 'dashboardLayout'
const STYLE_KEY = 'dashboardSectionStyle'

/**
 * How the dashboard is arranged and dressed.
 *
 * Two values, both per device in localStorage to match `dashboardView` and the
 * theme. They land on the dashboard root as data attributes and one CSS file
 * does the rest, so a new section style is a block of CSS rather than a code
 * path.
 *
 * Both are validated on read. An unknown stored value falls back to the
 * default rather than producing a dashboard with no styling at all, which is
 * what an unmatched attribute selector would give.
 */
function read(key, options, fallback) {
  const stored = localStorage.getItem(key)
  return options.some((o) => o.key === stored) ? stored : fallback
}

/**
 * The settings menu and the dashboard both use this hook, and they are
 * different components. Without a shared store the menu would write the new
 * value while the dashboard carried on rendering the old one, so state lives
 * at module level and every mounted instance is told when it changes.
 *
 * The `storage` event only fires in *other* windows, so it cannot do this job.
 */
const store = {
  layout: read(LAYOUT_KEY, DASHBOARD_LAYOUTS, DEFAULT_LAYOUT),
  sectionStyle: read(STYLE_KEY, SECTION_STYLES, DEFAULT_SECTION_STYLE),
}
const listeners = new Set()

function publish(next) {
  Object.assign(store, next)
  listeners.forEach((fn) => fn({ ...store }))
}

export function useDashboardStyling() {
  const [value, setValue] = useState(store)

  useEffect(() => {
    listeners.add(setValue)
    // Another window changing it should still reach this one.
    const onStorage = (e) => {
      if (e.key === LAYOUT_KEY || e.key === STYLE_KEY) {
        publish({
          layout: read(LAYOUT_KEY, DASHBOARD_LAYOUTS, DEFAULT_LAYOUT),
          sectionStyle: read(STYLE_KEY, SECTION_STYLES, DEFAULT_SECTION_STYLE),
        })
      }
    }
    window.addEventListener('storage', onStorage)
    return () => {
      listeners.delete(setValue)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const setLayout = useCallback((next) => {
    localStorage.setItem(LAYOUT_KEY, next)
    publish({ layout: next })
  }, [])

  const setSectionStyle = useCallback((next) => {
    localStorage.setItem(STYLE_KEY, next)
    publish({ sectionStyle: next })
  }, [])

  return { layout: value.layout, setLayout, sectionStyle: value.sectionStyle, setSectionStyle }
}

// ─── Per-zone collapse ────────────────────────────────────────────────────────

const ZONE_KEY = (id) => `zoneCollapsed:${id}`

/**
 * Whether one zone is collapsed. All three open by default.
 *
 * Coming Up used to be collapsed by default under its own key, so that key is
 * migrated once and removed. Without this a returning user would find it
 * open when they had deliberately shut it.
 */
export function readZoneCollapsed(id) {
  if (id === 'coming') {
    const legacy = localStorage.getItem('comingUpCollapsed')
    if (legacy !== null) {
      if (localStorage.getItem(ZONE_KEY('coming')) === null && legacy === 'true') {
        localStorage.setItem(ZONE_KEY('coming'), 'true')
      }
      localStorage.removeItem('comingUpCollapsed')
    }
  }
  return localStorage.getItem(ZONE_KEY(id)) === 'true'
}

export function writeZoneCollapsed(id, collapsed) {
  localStorage.setItem(ZONE_KEY(id), String(collapsed))
}
