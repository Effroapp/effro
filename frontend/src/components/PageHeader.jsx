import { isValidElement } from 'react'

/**
 * PageHeader - the single, consistent header used across main views.
 *
 * Pattern (researched against Linear, Sunsama, Notion, Monday, Zoho):
 *   - a 20px icon in muted warm-grey, left of the title (NOT mint, so the
 *     accent stays scarce), except an `accent` page (the AI surface), which gets
 *     the icon in a small mint chip
 *   - title in the page-title step, warm near-white (pitch-50), not pure white,
 *     which glares on the pitch surface
 *   - an optional one-line Lexend subtitle in muted grey, aligned to the title
 *   - left-aligned
 *   - optional right-aligned actions or counts in the same row as the title
 *
 * Use the SAME icon a page has in the sidebar nav, so the thing you click and
 * the thing at the top of the page are visually linked.
 *
 * This renders inside PageShell's header bar, which owns the width, the
 * padding, the pr-14 settings-button reserve and the hairline underneath. The
 * header used to carry its own margin and rule, and that is why it is not here.
 *
 * Slots
 *   above           a back link or a breadcrumb, on its own row over the title.
 *                   Named for its position rather than for a back link, because
 *                   two different things live there and naming it after one
 *                   makes the other read wrong at the call site.
 *   icon            a lucide component OR a rendered node. AreaView's icon is an
 *                   interactive 40px picker rather than a static glyph, which is
 *                   a real reason to differ, so the slot takes both. A node
 *                   brings its own styling and `accent` does not apply to it,
 *                   since the mint chip is sized for a 17px glyph.
 *   title           text or a node. FolioView and ThreadView pass an editable
 *                   field.
 *   titleAdornment  nodes that sit INLINE with the title: AreaView's status
 *                   badge, LogView's count. Not `right`, which is the far side
 *                   of the row.
 *   subtitle        one quiet line under the title, inside the title column.
 *   right           actions, far side of the title row.
 *   below           a block under the whole header that runs the FULL width,
 *                   including under `right`. ThreadView's editable description
 *                   needs this; `subtitle` would wrap it early against the
 *                   actions instead.
 */
export default function PageHeader({
  icon,
  title,
  subtitle,
  accent = false,
  right = null,
  above = null,
  titleAdornment = null,
  below = null,
}) {
  const Icon = icon
  const iconNode = !icon ? null
    : isValidElement(icon) ? icon
    : accent ? (
      <span className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center
                       bg-mint/10 border border-mint/20">
        <Icon size={17} className="text-mint-600 dark:text-mint" />
      </span>
    ) : (
      <Icon size={20} strokeWidth={1.75} className="flex-shrink-0 text-paper-500 dark:text-pitch-100" />
    )

  return (
    <div>
      {above}
      <div className={`flex items-start justify-between gap-4${above ? ' mt-3' : ''}`}>
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {iconNode}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 min-w-0">
              <h1 className="title-page text-paper-900 dark:text-pitch-50 truncate">
                {title}
              </h1>
              {titleAdornment}
            </div>
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
      {below}
    </div>
  )
}
