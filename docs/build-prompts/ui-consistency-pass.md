# Effro UI consistency pass. Build prompt

Seven phases. Phases 1 to 4 are fully specified and ready. Phases 5 to 7 are
blocked on design output and their sections say what to paste in.

Keep this file updated as phases complete. It's the source of truth for a fresh
session, so a new Claude Code run reads the status block below and knows what's
already done rather than reopening it.

## Status

| Phase | State | Branch | Commit |
|---|---|---|---|
| 1. Page shell | Merged to main | `feature/ui-consistency-page-shell` | `2f214d4`, merged `28f4aab` (PR #69) |
| 2. Typography plumbing | Built, not pushed | `feature/ui-consistency-typography` | `6698069` (2a/2b), `0d6ec68` (2c/2d) |
| 3. Primitives | Not started | | |
| 4. Tells cleanup | Not started | | |
| 5. Brand colour | Blocked on design brief 1 | | |
| 6. Type direction | Blocked on design brief 2 | | |
| 7. Insights hero | Blocked on design brief 3 | | |

## Read these first, in this order

1. `CLAUDE.md` in the repo root, including Known debt.
2. `frontend/src/tokens.css`. Source of truth for colour, spacing, radius, motion.
3. `frontend/tailwind.config.js`.
4. `frontend/src/index.css`, particularly the `@layer utilities` block and the `.prose-entry` rules.
5. `frontend/src/styles/dashboard-zones.css`. The Dashboard has its own container system and phase 1 must not disturb it.
6. `frontend/src/components/PageShell.jsx` and `frontend/src/components/PageHeader.jsx`.

## Ground rules

- Commit only when asked. Don't bump the version. `tauri.conf.json` is the version authority.
- British English in comments and UI copy. No em dashes and no semicolons in UI copy. Calm, second person, never demanding.
- Brand tokens only. No raw Tailwind palette colours. No hardcoded hex.
- No px type sizes anywhere. `useTextSize` sets the root font size, so px silently stops responding to the Text size setting.
- Icons are lucide-react only.
- External links use `openExternal()` from `api/tauri.js`.
- One commit per phase.
- Anything left undone goes in `CLAUDE.md` under Known debt.

## Gate checks, run at the end of every phase

1. ~~`npm run lint` clean.~~ **There is no lint script and no ESLint config in
   this repo.** See Known debt in `CLAUDE.md`. The standing substitute is
   `node scripts/check-jsx-imports.mjs` from the repo root and
   `node scripts/check-icon-names.mjs` from `frontend/`.
2. Static import pass. Every file that references a moved or renamed export actually imports it.
3. `npm run build` succeeds.
4. Manual pass on both themes.
5. Manual pass at all three Text size settings, Small, Default and Large.
6. Manual pass on the Dashboard specifically, at a narrow window and a wide one,
   because it uses container queries rather than viewport breakpoints and a
   regression there is quiet.

**How to run 4 to 6 in this environment.** The Browser pane never composites, so
screenshots fail and clicks miss. Build, then start an isolated backend on port
8011 with a scratch data dir (never port 8000, which is the installed app with
real data), and drive the page with `javascript_tool`. Computed styles and
`getBoundingClientRect` read correctly, so container width, padding, position
and colour are all verifiable. Toggle the theme and the text size through
`localStorage` (`theme`, `textSize`) and then reload, because a class toggled in
JS leaves transitioning properties frozen at their old value.

## Decisions already made. Do not reopen these

- One brand colour. Mint does every job. Indigo was retired deliberately.
- Clay never touches a control and never appears in a status context. The reasoning is in `tokens.css`.
- Nothing on the Dashboard turns terracotta. Drift and overdue use mustard.
- The Dashboard keeps its own `.zones` container at 1600px with px padding. That divergence is deliberate and the reasoning is in `dashboard-zones.css`. Phase 1 does not touch it.
- The Dashboard greeting is deliberately one step above the page title. Keep it.
- Auth pages, `LoginPage`, `SetupPage` and `SetPasswordPage`, are centred cards at `max-w-sm`. They are out of scope for the page shell.
- Zone styling is CSS keyed on data attributes, never a code path. A new style is a block of CSS, never a component fork.

---

# Phase 1. Page shell

**Built on `feature/ui-consistency-page-shell`. Not committed.**

## Why

Ten routed pages, five different maximum widths, four padding schemes. `AreaView`
disagreed with itself, header at `max-w-5xl` and body at `max-w-6xl`, so the area
title sat 64px inside the content below it. The grid paper texture appeared on
five pages and was absent from the other five, so the page surface changed as you
navigated.

## Current state, for reference (before phase 1)

| Page | Container | Padding | Grid | Sticky header |
|---|---|---|---|---|
| Dashboard | `max-w-[1600px]` | 32px px | Own faded version | Yes |
| FolioView | `max-w-7xl`, inner `max-w-4xl` | `px-6 md:px-10 py-8` | No | No |
| AreaView header | `max-w-5xl` | `px-8 py-5` | Yes | Yes |
| AreaView body | `max-w-6xl` | `px-8 py-6` | Yes | n/a |
| ThreadView | `max-w-5xl` | `px-8 py-4` | Yes | Yes |
| LogView | `max-w-5xl` | `px-8 py-5` and `py-6` | Yes | Yes |
| SystemSettings | `max-w-5xl` | `px-8 py-5` and `py-8` | No | Yes |
| ProcessView | `max-w-5xl` | `px-6 md:px-8` | No sticky | No |
| Insights | `max-w-5xl` | `px-6 md:px-10 py-8` | No | No |
| Signals | `max-w-5xl` | `px-6 md:px-10 py-8` | No | No |
| FolioIndex | `max-w-5xl` | `px-6 md:px-10 py-8` | No | No |

## What was built

**Token.** `--page-max: 87.5rem` and `--page-grid` (light and dark) in
`tokens.css`. Surfaced to Tailwind as `max-w-page` in `tailwind.config.js`, which
reads the var rather than restating 1400.

**Component.** `frontend/src/components/PageShell.jsx`. Props `header`, `sticky`
(default true), `grid` (default true), `bodyClassName` (default `py-6`) and
`className`. It owns width, horizontal padding, page ground, grid texture, the
`pr-14` settings-button reserve and the sticky header bar.

Two things in it are load-bearing and worth not undoing.

- The grid is a **sibling element**, not a `::before` on the shell root. A
  `.page-grid > * { position: relative }` rule, which is how the Dashboard does
  it, would land on the sticky header and stop it sticking. As a sibling it
  paints behind both children on DOM order alone.
- The header row uses **`pl-6 md:pl-8 pr-14`, not `px-6 md:px-8 pr-14`**. A
  responsive `px-*` utility is emitted after `pr-14` in the stylesheet, so it
  silently ate the settings-button reserve at `md` and up. This was caught in
  verification, not in review.

**Grid texture.** The Dashboard's masked version, promoted. The fade runs from
40 percent down the page to nothing at 78. `.bg-grid-light` and `.bg-grid-dark`
are gone from `index.css` and no caller remains.

**One divider value.** `border-paper-300 dark:border-pitch-500`, on the shell
header. `PageHeader` no longer draws its own hairline, because the shell supplies
it.

**Page ground on the shell.** `<main>` in `App.jsx` now carries
`bg-paper-100 dark:bg-pitch-800`, and the flex root no longer paints white. Every
per-page `bg-paper-100` and the two skeletons' `bg-white` are gone.

**Migrated.** All nine routed pages except the Dashboard. `PageHeader` lost its
own `mb-6`, `pr-14` and hairline, since it now always renders inside the shell's
header bar.

**Sticky headers everywhere.** Following the recommendation in this brief.
Insights, Signals, FolioIndex, FolioView and ProcessView gained a sticky header
by moving their `PageHeader` into the shell's header slot.

## Verified

Built clean, both check scripts pass, no console errors. Measured on all nine
pages in both themes: shell `position: relative`, paper/pitch ground, grid layer
present with its mask, header `sticky` at `z-10`, hairline `#E5E1D6` light and
`#2A2826` dark, container 1400px, padding 32px at `md` and up and 24px below,
header right padding 56px. Header and body containers now report identical width
and left offset on AreaView, which is the disagreement fixed by construction.
Text size Small, Default and Large resolve the container to 1225, 1400 and
1575px. No horizontal overflow at 700px. The Dashboard measures 460px stacked at
a 700px window and 1560px at an 1800px window, unchanged.

## Left for later

- **No inner reading measure on ThreadView and LogView.** Both now run to 1400px
  where they used to stop at 1024. FolioView keeps its `max-w-4xl` reading
  measure inside the wider page, which is the pattern the other two probably
  want. Recorded in `CLAUDE.md` under Known debt.
- **FolioView's sticky header is tall.** Back link, title and a wrapping row of
  topic chips. It is correct but it costs more vertical space than the others.
- **Sticky rails sit under the sticky header.** AreaView's `xl:sticky xl:top-6`
  aside and FolioView's rail both stick at 1.5rem, which is inside the header
  bar. AreaView already behaved this way before phase 1, so this is a
  pre-existing pattern rather than a regression, but it wants a shared
  `top-[header]` offset eventually.

## Out of scope for phase 1

The Dashboard's own container. Auth pages. Anything inside a page body.

---

# Phase 2. Typography plumbing

**Built on `feature/ui-consistency-typography`. Two commits, not yet pushed.**

## What the brief got wrong, and it mattered

The brief said the `.font-display` collision meant "which wins depends on source
order". It is not ambiguous. A rule authored inside `@layer utilities` is
emitted at the END of that layer, after every core utility, so in the built
sheet `.font-display{...500;-0.025em}` sat at byte 70052 and `.font-bold`
56607, `.font-semibold` 56692, `.tracking-widest` 58142 all sat before it.
Equal specificity, later wins.

So on every element carrying `font-display`, **the authored weight and the
authored tracking were both dead**. `.prose-entry h1`, written
`@apply font-display font-semibold`, compiled to `font-weight:500` with the 600
emitted and immediately overwritten. Nine headings written five different ways
rendered byte for byte identically. The one heading written `font-bold` rendered
at the same weight as the one written `font-medium`. Nine uppercase labels asked
for positive tracking and got -0.025em. Exactly one site in the app escaped, by
`!important`, and that `!important` existed for no other reason.

The consequence for the sweep: the brief's instruction to swap only "where it
appears alongside an explicit weight, since it's contributing nothing there" had
no such sites. There was one true no-op in 208. Every swap was a visual change,
and the change is the authored intent arriving.

## What was built

**2a.** The block is deleted. All 208 call sites say `font-sans` and state their
own weight and tracking. The 150 uppercase labels that had no weight of their own
were leaning on the dead 500, and at 11px dropping them to 400 is a real
legibility loss, so they carry `font-medium` deliberately now.

**2b.** The brief listed six px type sizes. There are 33: 24 arbitrary
`text-[NNpx]`, one raw CSS `font-size` (the entry prose, the running body of
every entry in every thread), seven inline `fontSize` numbers in
`OnboardingWizard.jsx` which meant the entire first-run tour ignored the Text
size setting, and one computed px in `Logo.jsx` left alone because WCAG exempts
logotypes. Six sites sat below the 11px floor that `tailwind.config.js` documents
and says never to go below, and are lifted to it rather than preserved. Two
places set a weight below 400 and both are now 400.

**2c.** One `.eyebrow`, 64 sites. It carries no colour, because a good number of
these labels are deliberately mint, mustard, clay or per-type, and muting them
would break a semantic tie. It lives in `@layer components`, not
`@layer utilities`, so a call site's own colour still wins. Every `<button>` and
`<label>` was left alone: a control label is not a section kicker, and phase 3
folds them into `Button` and `Field`.

**The brief's instruction to point `.label` in `dashboard-zones.css` at the same
definition was not followed, and must not be.** Six of the seven section styles
re-skin `.zone-head .label` into a real heading, sans at 1rem to 1.125rem,
weight 600, `text-transform: none`. It is a themeable slot that happens to
default to an eyebrow. The reason is now written beside it in that file.

**2d.** Three ladder steps, `.title-page` / `.title-section` / `.title-card`,
using a new `--font-heading` token rather than `--font-sans`, because
`--font-sans` follows the reading-font setting and a heading that used it left
Geist the moment someone picked Lexend. `PageHeader` gains `above`,
`titleAdornment`, `below` and a node-capable `icon`, and AreaView, LogView and
SystemSettings are routed through it.

Also taken here: `scroll-padding-top` on `html`, since every page is now sticky
and a focused element would otherwise scroll under the header; and
`Dashboard.jsx` rendered `<main className="zones">` inside `App.jsx`'s `<main>`,
so the default route had two `main` landmarks.

## Verified

Build and both check scripts clean. Measured live on every routed page in both
themes: one `h1` each, all Geist Sans 20px/600/-0.01em, one `<main>` per page,
`scroll-padding-top` 80px, `.eyebrow` at Geist Mono 11px/500 with 1.98px
tracking which is 0.18em, and the clay Areas label keeping its colour, which is
what proves the components-layer placement. With the reading font set to Lexend
the whole ladder stays Geist and only the entry prose follows, at 15px/400.

## Left for later

`ThreadView` still hand-rolls its header, and `PageHeader` already has the
`above` and `below` slots it needs. The button and form-field labels still carry
their own class strings, by design, until phase 3. Both are in `CLAUDE.md` under
Known debt.

## Why

Three separate causes producing one symptom.

## 2a. The `font-display` collision

`tailwind.config.js` defines `display` in `fontFamily` as Geist Sans, family only.
`index.css` also defines `.font-display` inside `@layer utilities` with family
plus `font-weight: 500` plus `letter-spacing: -0.025em`. Both land in the
utilities layer at equal specificity, so which wins depends on source order.

Worse, the behaviour differs per call site. `PageHeader` writes
`font-display font-semibold tracking-[-0.01em]`, which overrides both extras and
leaves the utility contributing nothing that `font-sans` doesn't already give.
`QuickSwitcher` writes `text-xs font-display uppercase tracking-widest`, where the
weight survives and the tracking gets overridden. `Sidebar` writes
`font-medium text-[13px] !tracking-[-0.005em] font-display`, with an `!important`
fighting it.

**Do this.** Delete the `.font-display` block from `index.css`. Keep the
`fontFamily.display` alias so nothing breaks. Sweep `font-display` to `font-sans`
where it appears alongside an explicit weight, since it's contributing nothing
there. Remove the `!important` in `Sidebar.jsx`.

## 2b. px type sizes break the Text size setting

`useTextSize` sets `document.documentElement.style.fontSize` to 14, 16 or 18px.
Rem follows, px doesn't. Six places use px, and three of them are reading text.

| File | Current | Change to |
|---|---|---|
| `index.css` `.prose-entry.entry-prose` | `font-size: 14.5px` | `font-size: 0.9375rem` |
| `FolioView.jsx` lede | `text-[16.5px] leading-[1.68]` | `text-base leading-relaxed` or a rem value |
| `FolioView.jsx` section paragraphs | `text-[15px] leading-[1.7]` | `text-[0.9375rem] leading-[1.7]` |
| `Sidebar.jsx` area names | `text-[13px]` | `text-xs` |
| `CreateEntryType.jsx` label | `text-[11px]` | `text-2xs` |
| `CreateEntryType.jsx` preview chip | `text-[11px]` | `text-2xs` |

The first three are the ones that matter. Someone with low vision picks Large,
the chrome grows, and the actual reading text stays put. That's a WCAG 1.4.4
failure in the part of the app that exists to be read.

**Also.** `.prose-entry.entry-prose` is at `font-weight: 300`. It's the only
place in the app below 400. Move it to 400 and check it against the title
hierarchy that `docs/build-prompts/timeline-entry-hierarchy.md` established,
since that hierarchy depends on the body staying visually quieter than the title.
If 400 breaks it, keep 300 and note why in a comment, but the size still moves to
rem either way.

## 2c. One eyebrow class

The small uppercase label is written seven ways for one job.

```
text-xs  font-display uppercase tracking-widest        OverviewCard, AreaView, ThreadView, QuickSwitcher
text-2xs font-display uppercase tracking-widest        SettingsMenu
font-mono text-2xs uppercase tracking-widest           SetupGuide, Insights
font-mono text-2xs uppercase tracking-wider            Signals, FolioView, FolioFiledUnder
font-mono text-[11px] uppercase tracking-[0.18em]      Sidebar
font-mono text-[11px] uppercase tracking-[0.12em]      CreateEntryType
.label in dashboard-zones.css, mono, 0.6875rem, .18em  Dashboard
```

Two faces, three sizes, four tracking values. `tracking-widest` is 0.1em and
`tracking-wider` is 0.05em, so those are visibly different side by side.

`CLAUDE.md` says Geist Mono is for meta and labels, so the mono variants are
correct and the `font-display` ones are the drift.

**Do this.** Add one `.eyebrow` component class matching the Dashboard's existing
`.label`, which is `font-mono`, `0.6875rem`, `letter-spacing .18em`, uppercase,
muted. Sweep all seven onto it. Point `.label` in `dashboard-zones.css` at the
same definition so there's one home.

## 2d. Four page headers, one component

`PageHeader.jsx` exists and its docstring explains the reasoning. Three pages
hand-roll near-identical markup instead.

- `AreaView.jsx`, `font-display font-semibold text-xl tracking-[-0.01em] text-paper-900 dark:text-pitch-50 truncate`
- `LogView.jsx`, the same plus `leading-tight`
- `SystemSettings.jsx`, the same plus `leading-tight`
- `PageHeader.jsx`, the same plus `leading-tight truncate`

Two of the three are already missing `leading-tight`, which is what drift looks
like before anyone notices.

**Do this.** Add a `titleAdornment` slot to `PageHeader` for nodes that sit
inline with the title. `AreaView` needs it for the icon picker and status badge,
which is a real reason to differ and an argument for a slot rather than a copy.
Add a `backLink` prop for `SystemSettings`. Route all three pages through it.

Phase 1 already moved all three hand-rolled headers into `PageShell`'s header
slot, so this is now a swap inside one slot rather than a page restructure. The
markup to replace is already sitting side by side with the real component.

**Also settle the h2 ladder while you're here.** Three treatments currently
exist. `font-display font-bold text-lg` in the Dashboard empty state.
`font-display font-semibold text-xl tracking-[-0.01em]` in the FolioIndex hero.
`font-display font-semibold text-xl tracking-[-0.015em]` in FolioView sections.
And `IntroPanel` uses `text-base font-semibold` with no display face at all. Pick
one and sweep.

---

# Phase 3. Primitives

## 3a. Button

Nine distinct class strings for the primary mint button.

```
px-4 py-2   text-sm  rounded-md  font-medium                     NewAreaModal, QuickCapture, AreaView modal, ThreadView modals, FolioIndex
px-4 py-2.5          rounded-lg  text-sm font-semibold           SystemSettings demo data
px-4 py-1.5          rounded-md  text-sm font-semibold           SetupGuide
px-4 py-2            rounded-md  text-sm font-semibold           PostConnectFlow
px-3 py-1.5 text-xs  rounded     font-display uppercase          CreateEntryType
px-3 py-1.5 text-xs  rounded-md  font-display uppercase +shadow  AreaView New Thread
px-4 py-2            rounded-md  text-sm font-medium             Dashboard empty state
px-3 py-1.5 text-xs  rounded-md                                  OverviewCard
px-4 py-2   text-sm  font-medium rounded-md                      SetupPage
```

Three radii, three vertical paddings, three weight treatments, two sizes.

**Build** `frontend/src/components/Button.jsx`.

Props. `variant` of `primary`, `secondary`, `ghost` or `danger`. `size` of `sm`
or `md`. `icon`, a lucide component. `loading`, boolean, rendering `Loader2` with
`animate-spin`. Standard `disabled`.

Sizes. `sm` is `px-3 py-1.5 text-xs`. `md` is `px-4 py-2 text-sm`. Radius
`rounded-md` on both.

Primary is `bg-mint-700 hover:bg-mint-800 text-white font-medium`. Disabled is
`disabled:opacity-50 disabled:cursor-not-allowed`. Transition is
`transition-colors`, never `transition-all`.

**Kill `transition-all`.** It animates every animatable property including layout
ones. It appears on the AreaView New Thread button, the SystemSettings and
Insights tab strips, and the FolioIndex hero. Replace with `transition-colors` in
each case. The FolioIndex hero also needs `transition-transform` if the lift
survives phase 4, which it shouldn't.

**Drop the coloured shadow.** `shadow-sm hover:shadow-mint-500/25` on the AreaView
New Thread button is the only primary button in the app carrying one.

Sweep all nine call sites onto the component.

## 3b. Field

Seven input variants, differing on radius, padding, background and border.

The one that matters is the dark border. Three values are in circulation.

- `dark:border-pitch-400`, `#38352F`, in FolioFiledUnder.
- `dark:border-pitch-500`, `#2A2826`, in CreateEntryType, Signals, SystemSettings, Sidebar, the ThreadView links panel.
- `dark:border-paper-700`, `#4A4845`, in QuickSwitcher, AreaView, QuickCapture, LogView, the ThreadView selects.

On a `#181714` card those are noticeably different, so two forms on adjacent
pages don't match.

**Build** `frontend/src/components/Field.jsx` covering input, textarea and select.
One pattern.

```
w-full px-3 py-2 text-sm rounded-md
bg-white dark:bg-pitch-800
border border-paper-300 dark:border-pitch-500
text-pitch-800 dark:text-white
placeholder:text-paper-500 dark:placeholder:text-paper-600
```

`dark:border-pitch-500` is the winner. It's the most used and it's the quieter of
the three on a card, and phase 1 already settled the page hairline on it.

**Light card surfaces.** Four are in use as "a card". `bg-white`, `bg-paper-50`,
`bg-paper-200`, `bg-paper-200/40`. Dark is nearly consistent at `pitch-700`.
Settle light on `bg-white` for interactive surfaces and `bg-paper-200` for grouped
or inset ones, and sweep.

## 3c. Focus

Six treatments, one of which is a real bug.

1. Global, `*:focus-visible` gets `ring-2 ring-mint ring-offset-2 ring-offset-paper dark:ring-offset-pitch`.
2. Most inputs override with `focus:outline-none focus:ring-2 focus:ring-mint-500`. That's `focus`, not `focus-visible`, so it fires on mouse click too.
3. `CreateEntryType` uses `focus:border-mint focus:ring-[3px] focus:ring-mint-50 dark:focus:ring-mint-900/30`.
4. `MarkdownArea` uses `focus-within:ring-2` on the wrapper with a bare `focus:outline-none` on the textarea.
5. `Insights` focus prompt uses `focus:outline-none focus:border-mint/50`, a border change only.
6. `SettingsMenu` has `<span tabIndex={0} className="... focus:outline-none">` around the font info tooltip. Focusable, keyboard reachable, no visible indicator. WCAG 2.4.7.

**Do this.** Fix number 6 first, it's the only one that's a failure rather than
drift. Remove the bare `focus:outline-none` and let the global ring apply.

Then sweep every `focus:` to `focus-visible:` so the ring stops firing on mouse
click. Keep the `focus-within` on `MarkdownArea`, since a wrapper ring around a
toolbar plus textarea is correct, but move it to `focus-within:has(:focus-visible)`
if browser support allows, otherwise leave it and note it.

Standardise on the global treatment and delete the per-component overrides unless
a component has a stated reason.

---

# Phase 4. Tells cleanup

Small, cosmetic, independent of everything else. Safe to run as a worktree
alongside phase 3.

**Sparkles.** The single most-flagged AI icon in the catalogue, and Lucide's own
site confirms it's among their most used. Three call sites.

- `OverviewCard.jsx`, the Update button. `Wand2` is already sitting next to it on the Auto toggle, which rather makes the point. Use `RefreshCw` for regenerate and leave `Wand2` where it is.
- `Insights.jsx`, the narrative line at size 13. `Telescope` matches the page's own nav icon and the `PageHeader` convention of using the same icon in both places.
- `SystemSettings.jsx`, Load demo data. `Database` or `PackageOpen`.

**IntroPanel gradient.**
`rounded-xl bg-gradient-to-br from-mint/10 to-mint/[0.03] dark:from-mint/[0.12] dark:to-mint/[0.03]`.
This renders on Insights, Signals, ProcessView, LogView, FolioIndex and every
Settings tab, so it's the most repeated decorative gradient in the app.

Replace with a flat `bg-mint/[0.06]` and a `border border-mint/20` hairline. Same
warmth, reads as deliberate rather than decorative. Apply the same change to
`Celebrations` in `Insights.jsx`, which uses the identical string.

**FolioView numbered kickers.** Each section renders
`String(i + 1).padStart(2, '0')` in mono with a `h-[3px] w-7` coloured bar beside
it, cycling through the brand palette. The code comment says the tone cycles "for
gentle variety", which is decoration by its own admission, and the numbers encode
nothing a reader needs. A folio digest is themed sections, not a sequence.

Remove both the number and the bar. Keep the heading.

Leave the ProcessView `01 / 02 / 03` steps alone. Pick an area, drop or paste,
review and approve is a genuine sequence, so the numbering earns its place there.

**Hover lift.** `FolioIndex.jsx` hero uses
`hover:-translate-y-0.5 hover:shadow-md transition-all`. Remove the translate and
the shadow change, keep the border colour change on hover.

`Dashboard.jsx` `NewAreaTile` uses `group-hover:scale-110` on the Plus icon.
Remove it. The border and text colour already change on hover.

`CreateEntryType.jsx` uses `hover:scale-110` on the colour swatches. Leave that
one. Growing a swatch under the cursor is a legible affordance in a picker, not
decoration.

---

# Phase 5. Brand colour

**Blocked on design brief 1.**

When the brief lands, paste the ten hex values and the contrast table here, then
do this.

- Replace the `mint` ramp in `tailwind.config.js`.
- Replace `--mint`, `--mint-button`, `--mint-hover`, `--mint-soft`, `--mint-50` and `--mint-ring` in `tokens.css`.
- Paste the sampling paragraph into the `tokens.css` comment block so the reasoning lives with the values, matching the existing clay note.
- Check `--mint-50` and `--mint-ring`, which are rgba literals derived from the old hex and will need recomputing rather than replacing.
- Check `scripts/generate-icons.mjs`, which hardcodes `#10B981` in the bare favicon mark. Regenerate the icon set.
- Check `frontend/public/effro-splash-animated.svg` and `Logo.jsx` for hardcoded mint.
- Check `index.css`, where `.ov-generating` uses `rgba(4,120,87,.95)` and `rgba(52,211,153,.95)` inline, and `.glow-mint` uses `rgba(16, 185, 129, 0.25)`.
- Check `dashboard-zones.css` for the `rgba(5,150,105,.6)` on the nudge leaf and the `rgba(16,185,129,.5)` on the new-area tile hover.

Nothing references the ramp by hex outside those files, which is what makes this
cheap. Grep for `10B981`, `047857`, `059669`, `065F46` and `34D399` to confirm
before you finish.

Verify all six contrast pairs from the brief after the change, not before.

# Phase 6. Type direction

**Blocked on design brief 2. Requires phase 2 complete.**

When the brief lands, paste the type ladder table and the chosen faces here.

Expect to touch. `tailwind.config.js` `fontFamily`. The font loading in
`index.html` or wherever the faces are declared. `useFont` and the `SettingsMenu`
font dropdown if Lexend becomes the default. The type ladder classes added in
phase 2. `.greet` in `dashboard-zones.css`.

If Lexend becomes the default reading face, recheck the thread timeline and the
audit log measure, since Lexend is wider than Geist at the same size, and phase 1
widened both pages to 1400px.

# Phase 7. Insights hero

**Blocked on design brief 3.**

Small build. `Hero` in `Insights.jsx`, plus `useCountUp` if the count-up goes.

Whatever the direction, the reduced-motion path already works and must keep
working, and the empty-week state has to be checked first rather than last.
