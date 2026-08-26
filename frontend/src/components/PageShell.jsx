/**
 * PageShell - the one container every routed page sits inside.
 *
 * Before this existed there were five maximum widths, four padding schemes and
 * a grid texture on five pages out of ten, so the page surface changed as you
 * navigated and AreaView disagreed with itself (header at max-w-5xl, body at
 * max-w-6xl, so the area title sat 64px inside its own content). The shell
 * settles all of it in one place:
 *
 *   - width      max-w-page, which reads --page-max from tokens.css
 *   - padding    px-6 md:px-8, one scheme everywhere
 *   - ground     bg-paper-100 / dark:bg-pitch-800
 *   - texture    the masked .page-grid layer
 *   - reserve    pr-14 on the header row, for the floating settings button,
 *                so it stops being hand-written on every page
 *
 * The Dashboard is the deliberate exception. It keeps its own .zones container
 * at 1600px with px padding, and the reasoning is in dashboard-zones.css.
 * Auth pages are centred cards and are out of scope too.
 *
 * The grid is a sibling element rather than a ::before on the root, because a
 * `.page-grid > * { position: relative }` rule would land on the sticky header
 * and stop it sticking. As a sibling it paints behind both children on DOM
 * order alone, and nothing has to be repositioned to sit on top of it.
 *
 * Props
 *   header          node, optional. Rendered in the page's header bar.
 *   sticky          boolean, default true. Only meaningful when header is set.
 *   grid            boolean, default true. The paper texture.
 *   bodyClassName   the page's own vertical rhythm, default py-6. SystemSettings
 *                   at py-8 and LogView at py-6 are a reasonable difference, so
 *                   vertical padding stays with the page.
 */
export default function PageShell({
  header = null,
  sticky = true,
  grid = true,
  bodyClassName = 'py-6',
  className = '',
  children,
}) {
  const stuck = header !== null && sticky

  return (
    <div
      className={`relative w-full min-h-screen bg-paper-100 dark:bg-pitch-800 ${className}`}
    >
      {grid && <div aria-hidden className="page-grid" />}

      {header !== null && (
        <header
          className={`
            border-b border-paper-300 dark:border-pitch-500
            ${stuck ? 'sticky top-0 z-10 bg-paper-100/90 dark:bg-pitch-800/90 backdrop-blur-md' : 'relative'}
          `}
        >
          {/* pl/pr rather than px, because a responsive px-* utility is
              emitted after pr-14 in the sheet and would quietly eat the
              settings-button reserve at md and up. */}
          <div className="mx-auto w-full max-w-page pl-6 md:pl-8 pr-14 py-5">
            {header}
          </div>
        </header>
      )}

      <div className={`relative mx-auto w-full max-w-page px-6 md:px-8 ${bodyClassName}`}>
        {children}
      </div>
    </div>
  )
}
