/**
 * PageHeader — the single, consistent header used across main views.
 *
 * Pattern (researched against Linear, Sunsama, Notion, Monday, Zoho):
 *   - a 20px icon in muted warm-grey, left of the title (NOT mint, so the
 *     accent stays scarce), except an `accent` page (the AI surface), which gets
 *     the icon in a small mint chip
 *   - title: Geist 20px / 600 / -0.01em, warm near-white (pitch-50), not pure
 *     white (which glares on the pitch surface)
 *   - an optional one-line Lexend subtitle in muted grey, aligned to the title
 *   - left-aligned
 *   - optional right-aligned actions/counts in the same row as the title
 *
 * Use the SAME icon a page has in the sidebar nav, so the thing you click and
 * the thing at the top of the page are visually linked.
 *
 * This renders inside PageShell's header bar, which owns the width, the
 * padding, the pr-14 settings-button reserve and the hairline underneath. The
 * header used to carry its own margin and rule, and that is why it is not here.
 */
export default function PageHeader({ icon: Icon, title, subtitle, accent = false, right = null }) {
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {Icon && (
            accent ? (
              <span className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center
                               bg-mint/10 border border-mint/20">
                <Icon size={17} className="text-mint-600 dark:text-mint" />
              </span>
            ) : (
              <Icon
                size={20}
                strokeWidth={1.75}
                className="flex-shrink-0 text-paper-500 dark:text-pitch-100"
              />
            )
          )}
          <div className="min-w-0 flex-1">
            <h1 className="font-display font-semibold text-xl tracking-[-0.01em]
                           text-paper-900 dark:text-pitch-50 leading-tight truncate">
              {title}
            </h1>
            {subtitle && (
              <p className="font-lexend text-sm leading-snug mt-0.5
                            text-paper-600 dark:text-pitch-100">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {right && <div className="flex-shrink-0 flex items-center gap-2">{right}</div>}
      </div>
    </div>
  )
}
