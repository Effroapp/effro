import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { readZoneCollapsed, writeZoneCollapsed } from '../hooks/useDashboardStyling'

/**
 * One dashboard section: In Hand, Coming Up or Areas.
 *
 * The markup is deliberately fixed, because the seven section styles are seven
 * blocks of CSS keyed on `data-section-style` and this shape. A style must
 * never need a code path of its own, so nothing here branches on which one is
 * active. If a style needs different chrome, it gets different CSS.
 *
 * Collapse is per zone and per device. All three open by default.
 */
export default function Zone({ id, title, count, actions, bodyClass = 'card', children }) {
  const [collapsed, setCollapsed] = useState(() => readZoneCollapsed(id))
  const bodyId = `${useId()}-body`

  const toggle = () => {
    setCollapsed((wasCollapsed) => {
      writeZoneCollapsed(id, !wasCollapsed)
      return !wasCollapsed
    })
  }

  return (
    <section className={`zone zone-${id}`} data-collapsed={collapsed ? 'true' : 'false'}>
      <div className="zone-head">
        <div className="zone-title">
          <h2 className="label">{title}</h2>
          {count != null && <span className="count">{count}</span>}
        </div>
        <div className="zone-tools">
          {actions}
          <button
            type="button"
            className="chev"
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}
            onClick={toggle}
          >
            <ChevronDown size={14} className="ic" />
          </button>
        </div>
      </div>
      <div id={bodyId} className={`zone-body ${bodyClass}`}>{children}</div>
    </section>
  )
}
