# Effro dashboard styling. Build prompt, 1 of 2

## What this is

Build the redesigned dashboard. Three user-selectable layouts and seven section styles, chosen from a new **Dashboard styling** section in the settings menu. The visual reference is frozen. Match it rather than reinterpreting it.

Two things drive everything. A `data-layout` attribute and a `data-section-style` attribute on the dashboard root, read by one CSS file. Every combination renders from the same DOM. There are no per-style components.

## Read these first, in this order

1. `CLAUDE.md` in the repo root, including Known Debt.
2. `docs/design-reference/dashboard-styling/01-reference.html`. Copy the three handover files into that folder first if they aren't there. Open the reference in a browser. The top bar switches layout, section style and viewport width. The settings panel under the frame is the settings section you're building, and its controls are live. There's no JavaScript in it, the switching is CSS.
3. `docs/design-reference/dashboard-styling/03-dashboard-zones.css`. The zone CSS extracted from the reference. Source of truth for surfaces, headers, shadows, the three layouts and the seven styles.
4. `frontend/src/pages/Dashboard.jsx`, `frontend/src/components/SettingsMenu.jsx`, `frontend/src/tokens.css`, `frontend/tailwind.config.js`, `frontend/src/utils/status.js`, the existing hooks in `frontend/src/hooks/`, and the In Hand strip component. Find it by the text "In hand" on the dashboard.

## Ground rules

- Commit only when asked. Don't bump the version. `tauri.conf.json` is the version authority.
- British English in comments and UI copy. No em dashes and no semicolons in UI copy. Calm, second person, never demanding.
- Nothing on the dashboard turns terracotta. Drift and overdue use mustard. This is the same rule the Insights spec sets.
- Brand tokens only. No raw Tailwind palette colours.
- Zone styling lives in the CSS file, keyed on the two data attributes. A new style must only ever be a block of CSS, never a code path. Don't fork components per style.
- Don't touch Area View or Thread View in this prompt.
- Where the reference and existing behaviour conflict and this document doesn't resolve it, follow the reference and say so in your report.
- Anything you leave undone goes in CLAUDE.md under Known Debt.

## Scope

In this prompt

1. Settings. The Dashboard styling section, two settings, persistence, defaults.
2. Dashboard root attributes and the CSS port.
3. A Zone component and the shared header pattern across In Hand, Coming Up and Areas.
4. Header status line, nudge moved to the foot, area view control moved into the Areas header.
5. Coming Up open by default, next five items, past-their-date row.
6. Stacked, Split and Rail layouts with the 1400px breakpoint.
7. Card meta contrast and the grid paper fade.
8. A dark mode pass across all seven styles.

Out, and coming in prompt 2

- The tidy flow for items past their date. Reschedule, put in hand, clear date. This prompt ships a "See these" toggle in its place.
- Embers, AI suggestions, anything in Area or Thread views.

## 1. Settings

### Values and defaults

| Setting | localStorage key | Values | Default |
|---|---|---|---|
| Layout | `dashboardLayout` | `stacked`, `split`, `rail` | `split` |
| Section style | `dashboardSectionStyle` | `plain`, `lifted`, `sheet`, `inset`, `folder`, `margin`, `boxed` | `inset` |

Add `useDashboardStyling()` in `frontend/src/hooks/`, following the shape of the existing settings hooks (check `useTextSize` and `useDisplayName` and match whichever pattern they use). It returns `{ layout, setLayout, sectionStyle, setSectionStyle }`. Read once on mount, write through on change, and validate on read so an unknown stored value falls back to the default rather than producing an unstyled dashboard. Listening for the `storage` event so two windows stay in step is welcome but optional.

Persistence is per device, in localStorage, to match `dashboardView` and the theme. Don't add a backend setting in this prompt.

### The settings menu section

In `SettingsMenu.jsx`, add a `Section label="Dashboard styling"` after Text size. Inside it, in this order.

- Sub-label "Layout". The existing `Segmented` control with Stacked, Split and Rail.
- Sub-label "Section style". A tile picker. Seven tiles, three per row, glyph above name, 76px wide minimum. The selected tile gets the mint border and a 1px mint ring, since mint is the selected-state colour. Inset carries a small "Default" tag in its top-right corner, mono, text-2xs, ink-muted.
- A footnote under the tiles, text-2xs, ink-muted. Copy is "Applies to the dashboard only."

The tile glyphs are the seven `<symbol id="g-*">` SVGs in the reference file. Copy them verbatim into a `SectionStyleGlyph` component that takes the style value and renders the matching symbol. They use `var(--sheet)`, `var(--paper)`, `var(--paper-2)`, `var(--ink)`, `var(--ink-soft)`, `var(--rule)` and `var(--rule-soft)`, so they follow the theme without changes.

Semantics. The tile picker is `role="radiogroup"`, each tile `role="radio"` with `aria-checked`, arrow keys move selection, focus-visible shows the mint ring. If the existing `Segmented` control has keyboard handling, match it.

If seven tiles at three per row don't fit the popover, widen the popover for this section. Don't shrink the tiles.

## 2. Dashboard root and the CSS

- Wrap the page in `<div className="dashboard" data-layout={layout} data-section-style={sectionStyle}>`. Keep the existing `flex-1 min-h-screen` on it and add the class.
- Move `03-dashboard-zones.css` to `frontend/src/styles/dashboard-zones.css` and import it from `Dashboard.jsx`.
- The block at the top of that file defines four tokens. Move them into `tokens.css`, both the `:root` values and the `html.dark` values, then delete the block from the CSS file. Tokens have one home.
- `--font-sans` and `--font-mono` in that block are placeholders. Map them to however the app applies `font-sans` and `font-mono`, so the Lexend opt-in still reaches `.label`, `.ih-text` and the rest. If fonts are applied with Tailwind classes rather than variables, add `font-sans` and `font-mono` classes in the JSX and remove the `font-family` lines from the CSS.
- Grid paper. Replace `bg-grid-light dark:bg-grid-dark` on the root with the `.dashboard::before` rule from the CSS. It's the same grid with a fade from 40 percent down the page to nothing at 78 percent. Check it in dark.
- Type sizes in the CSS are rem so the Text size setting scales them. Spacing is px on purpose so surfaces don't swell when text is enlarged. Keep that split.
- Tailwind and this CSS coexist. The CSS owns zone chrome. Tailwind keeps doing what it already does inside rows. Where the two disagree, the CSS wins, so remove the Tailwind class that's fighting it rather than adding specificity.

## 3. The Zone component

New `frontend/src/components/Zone.jsx`. Props are `id` (`inhand`, `coming` or `areas`), `title`, `count` (string or null), `actions` (a node) and `children`.

The markup is exact because the CSS depends on it.

```jsx
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
        aria-label={`Collapse ${title}`}
        onClick={toggle}
      >
        <ChevronDown size={14} className="ic" />
      </button>
    </div>
  </div>
  <div id={bodyId} className={`zone-body ${bodyClass}`}>{children}</div>
</section>
```

- `bodyClass` is `card` for In Hand and Coming Up, and `area-grid` for Areas. Pass it as a prop.
- Collapsed state is persisted per zone under `zoneCollapsed:{id}`. All three default to open. Migrate the old `comingUpCollapsed` key once. If it exists and is `'true'`, write `zoneCollapsed:coming` as `'true'`, then remove the old key.
- The chevron rotates 90 degrees anticlockwise when collapsed. The CSS handles that from `data-collapsed`.
- The `.zact` class is the quiet text action used in zone headers. Any header action button gets it.

## 4. Header

- Greeting stays as it is, first name and all. The date stays in mono. The greeting size goes up one step. The CSS sets it.
- Beside the date, one status line in `.status .line`. It is deterministic and built from data already on the page. No AI.

```
parts = []
if inHandCount > 0      push "{n} in hand"
if dueThisWeek > 0      push "{n} due this week"
render parts.join(", ") + "."   or nothing when parts is empty
```

`dueThisWeek` is the today bucket plus the week bucket from `getDueGroup`, top-level todos only, not completed. `inHandCount` is the In Hand strip's own count.

- The nudge moves out of the content flow to `<footer className="nudge">` as the last child of `.dashboard`. It keeps the leaf, the shuffle and the dismiss-for-today behaviour. The CSS pins it to the foot with `margin-top: auto`, so on a tall screen it sits at the bottom and on a short one it follows the content.
- `ViewSegmentedControl` moves out of the topbar and into the Areas zone's `actions`. Add the class `seg` to its wrapper and `is-on` to the active button so the section styles can restyle it. Weekly roundup stays in the topbar. The `filterNotice` text loses its home, so render it as a text-xs ink-muted line directly under the Areas header when a filter is active, or drop it if that reads as clutter. Your call, say which.

## 5. In Hand

- The existing strip's list becomes the body of `<Zone id="inhand" title="In hand" count={String(n)} bodyClass="card" actions={<button type="button" className="zact" onClick={tidy}>Tidy</button>}>`. Tidy is the existing one-tap tidy.
- Rows use `.ih-row`, with the existing checkbox as `.box`, the text as `.ih-text` and the age tag as `.age`. Item text moves to base size, medium weight, ink. The CSS does that, so remove the smaller Tailwind size class.
- Existing rules stand. Hidden when empty. Steady pins. Age indicator. Send home. Nothing red.

## 6. Coming Up

- `<Zone id="coming" title="Coming up" count={weekLabel} bodyClass="card" actions={seeAll}>`. `weekLabel` is "{n} this week" for the today-plus-week count when it's above zero, otherwise null.
- Open by default. This reverses the current default. Persisted through the zone key like the others.
- The body lists the today-plus-week bucket, sorted by due date then created_at, capped at five. Each row is `.cu-row` containing `.when`, `.cu-text` and `.where`. `.when` shows "Today" or the short weekday, Wed, Thu, and so on. `.cu-text` is the entry content through `stripMarkdown`, one line, ellipsis. `.where` is the area name. Clicking a row opens the thread with the entry highlighted, using the existing highlight pattern.
- When the bucket has more than five, the header action reads "See all" and expands to the full bucket. Its label becomes "Show fewer" while expanded. When there are five or fewer, render no action.
- The past-their-date row sits at the foot of the card and only renders when the overdue count is above zero. Markup is `.past` containing `.dot`, the text, and a `.zact`. The text is "{n} past their date", and "1 past its date" for one. The action reads "See these" and toggles an inline list of the overdue items directly under the row, in the same `.cu-row` markup, with `.when` showing the due date as "12 Aug". Nothing here is terracotta. Prompt 2 replaces "See these" with the tidy actions.
- The zone is hidden entirely when today-plus-week and overdue are both empty, which is the existing rule.
- `getDueGroup` and `entriesApi.getUpcoming(50)` stay as they are. If 50 might not cover overdue plus the week for a heavy user, raise it to 100 and note it.

## 7. Areas

- `<Zone id="areas" title="Areas" count={countLabel} bodyClass="area-grid" actions={<ViewSegmentedControl … />}>`. `countLabel` is the total as a string, or "{shown} of {total}" when Focus is hiding some.
- The body is the existing grid, with cards carrying `.acard`, `.ahead`, `.atitle`, `.badge`, `.abody`, `.afoot`, and the ghost tile carrying `.newtile`. Keep the DOM order inside a card as icon, title, badge, body, foot. The Rail layout turns the card into a grid with `display: contents` on `.ahead`, and that only works if the order holds.
- Card meta moves one step toward ink. The CSS sets `.afoot` colours, so remove the conflicting Tailwind colour classes from the footer rather than fighting them.
- The placeholder overview stays italic and uses `--placeholder`.
- The "Nd quiet" mustard tag, the empty state and the Focus-mode "everything is stable" line all stay.

## 8. Layouts

Nothing to do in JSX beyond two wrappers. `<main className="zones">` around the three zones, and a plain `<div className="band">` around Coming Up and Areas. The CSS does the rest, keyed on `data-layout` and a `min-width: 1400px` media query.

| Layout | Wide, 1400px and up | Under 1400px |
|---|---|---|
| Stacked | Everything full width, in order | Same |
| Split | In Hand full width, then Coming Up and Areas share a 3fr to 2fr band. Area grid is two across, titles wrap to two lines, the new-area tile becomes a slim row across both columns | Behaves as Stacked |
| Rail | Two columns, main and a 420px rail. In Hand and Coming Up in the main column, Areas in the rail as compact single-line cards | Behaves as Stacked |

## 9. Section styles

All seven are in the CSS. This is what each one is, so you can tell when something's gone wrong.

| Value | Name | What it does |
|---|---|---|
| `plain` | Plain | Floating heading in the display face. No container around the header |
| `lifted` | Lifted | Heading floats. Body loses its border and sits on the `--lift` shadow, gap closed to 6px. Area cards lift the same way |
| `sheet` | Sheet | Heading inside a lifted sheet, hairline under it. No tinted bar, no border |
| `inset` | Inset | Heading on a lifted sheet, rows set into an inner panel the colour of the page. The default |
| `folder` | Folder | Heading is a folder tab on the sheet. Tab and body are one silhouette, so the shadow is a `drop-shadow` filter on the whole zone |
| `margin` | Margin | A 2px margin line runs down the left of heading and body. Flat, no shadow |
| `boxed` | Boxed | Tinted title bar inside a bordered box, the way the current In Hand strip does it |

The heading in every style is an `h2.label`. In Plain, Lifted, Sheet, Inset, Folder and Margin it's sentence case in the display face. In Boxed it's the mono uppercase voice. The count beside it is always mono and muted. Don't change the copy of the three titles. They are "In hand", "Coming up" and "Areas".

## 10. Dark mode pass

Go through all seven styles in dark, in both Split and Rail, and check these before touching anything else.

- Surfaces read against pitch-800. `--sheet` in dark is one step lighter than pitch-2.
- The shadow is replaced by the `--lift` dark value, a hairline ring plus a faint drop. Lifted, Sheet, Inset and Folder all depend on it.
- Hairlines are visible. `--rule-soft` in dark is on the paper side.
- Folder's tab and body are still one silhouette. The `drop-shadow` filter uses ink at low alpha, which vanishes on pitch, so give it a dark override that uses a faint light ring in the same way `--lift` does.
- Margin's line uses ink at 18 percent, which also vanishes on pitch. Add a dark override on paper at 18 percent.
- Boxed's title bar is distinct from the box.
- The area view control is readable inside every style.

If a token value needs to change, change it in `tokens.css` and report the value. Don't scatter hex codes through the CSS.

## 11. Accessibility

- Zone titles are `h2`. The page keeps one `h1`, the greeting.
- Chevron buttons carry `aria-expanded` and `aria-controls`. Enter and Space toggle them.
- The tile picker is a radiogroup with arrow-key movement.
- Focus-visible uses the mint ring everywhere, matching existing components.
- Reduced motion is already handled globally in `tokens.css`. Don't add per-element overrides.

## 12. Tests and checks

If the frontend has a test runner, add unit tests for `useDashboardStyling` covering defaults, validation of unknown values, persistence and the `comingUpCollapsed` migration, and for the status line composer covering the zero, one and many cases. If there's no runner, don't add one for this. Say so in the report.

The backend is untouched.

Run this matrix before reporting.

- Three layouts by seven styles, in light and dark, at 1600 and 1100 wide.
- Reload preserves both settings. A fresh profile shows Split and Inset.
- Coming Up opens by default. The `comingUpCollapsed` migration works in both states.
- Text size Large doesn't break the Rail cards or the tile picker.
- No console errors or warnings.

## 13. Copy, exact strings

| Where | String |
|---|---|
| Settings section label | Dashboard styling |
| Sub-labels | Layout, Section style |
| Layout options | Stacked, Split, Rail |
| Section style options | Plain, Lifted, Sheet, Inset, Folder, Margin, Boxed |
| Default tag | Default |
| Footnote | Applies to the dashboard only. |
| Zone titles | In hand, Coming up, Areas |
| Coming Up count | {n} this week |
| Header actions | Tidy, See all, Show fewer |
| Past their date | {n} past their date, or 1 past its date |
| Past their date action | See these |
| Status line | {n} in hand, {n} due this week. |

## 14. Report back

Summarise the files changed, any deviation from the reference and why, the dark-mode token values you settled on, what you decided about `filterNotice`, and anything logged as debt. Don't commit.

## Prompt 2, for later, not now

Replace "See these" with "Sort these out", which opens the overdue list with three quiet actions per item. Reschedule with a date picker, Put in hand, and Clear date. Same low-shame register as the In Hand exits. Not part of this prompt.
