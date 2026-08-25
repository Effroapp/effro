# Handoff: thread timeline entry, title hierarchy and entry type

## Overview

Two fixes to the entry card in the Effro thread timeline:

1. **Title hierarchy.** Today the title and the body sit at similar size, weight, and ink, and
   the body often opens with a bold lead-in, so the title reads as the paragraph's first bold
   run rather than as a title.
2. **Entry type legibility.** Nothing on the card or the rail says whether an entry is a todo,
   decision, update, blocker, meeting, note, or a user-made custom type.

The chosen direction puts the type on the timeline rail, so a long thread is scannable without
reading, and rebuilds the card's vertical rhythm so the title owns the top of the content area.
It also defines how a user-made custom type gets its identity.

## About the design files

`Entry Card Hierarchy.dc.html` in this folder is a **design reference created in HTML**. It is a
prototype of the intended look, not production code. The task is to recreate it inside the
existing Effro frontend (React + Vite + Tailwind, wrapped in Tauri) using the app's established
components, `tokens.css` variables, and `lucide-react` icons. Do not port its markup or inline
styles.

The prototype file contains three explored directions for the entry card, labelled 1a, 1b, 1c,
and two for custom types, labelled 2a and 2b. **Build 1b and 2a.** 1a, 1c, and 2b are kept in the
file as rejected alternates for context only.

## Fidelity

**High fidelity.** Colours, type, spacing, and radii below are final and taken from the Effro
design tokens. Recreate them exactly, sourcing every value from `tokens.css` rather than
hardcoding hex.

---

## 1. Tokens used

All values already exist in the product's `tokens.css`. Nothing new is introduced.

**Neutrals, dark theme (default)**

| Token | Value | Use here |
|---|---|---|
| `--pitch-800` | `#0F0E0C` | page ground, and the base the rail medallion tint mixes into |
| `--pitch-700` / `--surface-card` | `#181714` | entry card surface |
| `--border-default` | `--pitch-500` `#2A2826` | card border, hairlines, rail line |
| `--text-primary` | `#EDEAE3` | title |
| `--text-secondary` | `#A8A49E` | content, date |
| `--text-muted` | `#6B6862` | time, "(edited)", action icons, NOTES |

Light theme uses the same semantic tokens (`--surface-card` `#FFFFFF`, `--text-primary` `#14130F`,
and so on). All `color-mix` percentages below hold in both themes without change.

**Type**

| Token | Value |
|---|---|
| `--font-sans` | Geist. Titles, UI. |
| `--font-mono` | Geist Mono. Labels, timestamps, counts. Always uppercase, wide tracking. |
| `--font-body` | Lexend. Entry content prose only. |

**Radii and motion**: `--radius-sm` 6, `--radius-md` 8, `--radius-lg` 12. Transitions
120 / 200 / 400ms with `--ease-out` `cubic-bezier(.2,.8,.2,1)`.

---

## 2. Entry card (direction 1b)

### Layout

- Timeline column: entries in a vertical flex, **gap 12px**. Container has **padding-left 48px**;
  the rail is a **1px** line of `--border-default` at **left 15px**, inset 8px top and bottom.
- **Rail medallion**, one per entry, absolutely positioned at left 0 of the gutter, **top 12px**:
  - 32 x 32, `border-radius: 10px`
  - `background: color-mix(in srgb, <TYPE> 14%, var(--pitch-800))` (opaque, so the rail line does
    not show through)
  - `border: 1px solid color-mix(in srgb, <TYPE> 34%, transparent)`
  - Lucide icon at **15px**, `color: <TYPE>`, stroke width 2, round caps
- **Card**: `background: var(--surface-card)`, `border: 1px solid var(--border-default)`,
  **`border-left: 3px solid <TYPE>`**, `border-radius: var(--radius-lg)`, `overflow: hidden`.
  Calm at rest: no shadow until hover, per the design system's hover lift.

### Header row

`display: flex; align-items: center; gap: 8px; padding: 11px 16px;`

| Element | Spec |
|---|---|
| Date | `--font-mono`, 12px, weight 600, `letter-spacing: .04em`, `--text-secondary` |
| Time | `--font-mono`, 12px, `--text-muted` |
| "(edited)" | `--font-mono`, 11px, `--text-muted` |
| Due date, todos only | `--font-mono`, 12px, `--amber-muted`, rendered as `· due 22 Aug` |
| Actions, right aligned | flex, gap 12px, `--text-muted`, Lucide `pin` / `pencil` / `trash-2` at 14px |

Then a **1px `--border-default` divider** across the full card width.

### Content area

`padding: 15px 18px 16px;`

1. **Type label**: `--font-mono`, 11px, weight 500, uppercase, `letter-spacing: .14em`,
   `color: <TYPE>`, `margin-bottom: 7px`. For a custom type this is the user's own name, uppercased.
2. **Title**: `--font-sans`, **21px**, weight **700**, `letter-spacing: -0.03em`,
   `line-height: 1.25`, `--text-primary`, `text-wrap: pretty`, margin 0.
3. **Hairline**: 1px `--border-default`, `margin: 14px 0`.
4. **Content**: `--font-body` (Lexend), **14.5px**, weight **300**, `line-height: 1.7`,
   `--text-secondary`, `text-wrap: pretty`. **Bold runs inside content render at weight 500 and
   keep `--text-secondary`**, never `--text-primary`. This is the change that stops a bold lead-in
   from reading as a second title.

### Footer

Only when the entry has notes. 1px divider, then `padding: 10px 16px`, `--text-muted`, Lucide
`chevron-down` at 12px plus `--font-mono` 11px uppercase `letter-spacing: .12em` label `NOTES`.
Existing disclosure behaviour is unchanged.

### Why these numbers

The title to content contrast is carried by four things at once: size (21 against 14.5), weight
(700 against 300), ink (`--text-primary` against `--text-secondary`), and typeface (Geist against
Lexend), plus a hairline between them. Any one of these alone was not enough in the current build.

---

## 3. Entry type map

One module, one source of truth. Colour and icon are fixed per built-in type and match the design
system's existing pairings.

| Type | Colour token | Hex | Lucide icon |
|---|---|---|---|
| Todo | `--sky-muted` | `#6B8AB8` | `square-check-big` |
| Decision | `--amber-muted` | `#C99A5C` | `scale` |
| Update | `--sage` | `#7A9579` | `git-commit-horizontal` |
| Blocker | `--terracotta` | `#B86A5C` | `circle-slash` |
| Meeting | `--lavender` | `#8A7BB8` | `calendar` |
| Note | `--mint` | `#10B981` | `pencil` |
| **Custom, any** | `--paper-soft-d` dark, `--ink-muted` light | `#A8A49E` / `#8A877F` | user's chosen icon |

Notes:

- `--mustard` `#C9A85C` stays free for thread and area status. Do not assign it to an entry type.
- Mint on Note is the one sanctioned mint status use, inherited from the design system. Mint is
  otherwise reserved for brand, focus rings, and selected states.
- The tinted chip formula everywhere is **12% fill, 32% border** of the type colour. The rail
  medallion is **14% over `--pitch-800`, 34% border**.

---

## 4. Custom entry types (direction 2a)

### The rule, and why

Six muted hues exist. Six built-in types already claim them. So a colour picker for custom types
runs out of meaningful colours immediately, and two types wearing the same hue destroys the glance
value the rail buys. Therefore:

- **Custom types are not colour-pickable.** Every one renders on the neutral stone ground
  (`--paper-soft-d` in dark, `--ink-muted` in light), using the same 12/32 chip and 14/34 medallion
  formulas.
- **The icon is the identity.** Neutral plus a distinct icon reads as "one of mine" in the rail and
  scales to any number of custom types.
- Enforce icon uniqueness among a workspace's custom types. Warn on a duplicate rather than block.

### Create-type panel

A standard card surface, `--radius-lg`, hairline border. Fields top to bottom:

1. **NAME**. Standard Input, label `NAME` in mono 11px uppercase `letter-spacing: .12em`
   `--text-muted`. Field: `--font-sans` 14px, `--surface-card`, 1px `--border-default`,
   `--radius-md`, `padding: 9px 12px`. Focus: `border-color: var(--mint)` plus
   `box-shadow: 0 0 0 3px var(--mint-50)`.
2. **ICON**. A second Input, label `ICON`, placeholder `Search icons, e.g. flag, shield, beaker`.
   Searches the **full Lucide set** by name and keyword. Results replace the quick pick grid below
   while a query is active.
3. **QUICK PICK**. Label in mono 11px uppercase `letter-spacing: .1em` `--text-muted`, then a
   wrapping flex grid, gap 8px, of 36 x 36 buttons at `--radius-md`:
   - Rest: `background: var(--surface-card)`, `border: 1px solid var(--border-default)`, icon 16px
     `--text-muted`
   - Hover: `background: var(--surface-hover)`, icon `--text-primary`
   - Selected: `background: var(--mint-50)`, `border: 1px solid var(--mint)`, icon `--text-primary`
   - Default set, all unclaimed by a built-in type: `flag`, `tag`, `clock`, `message-square`,
     `refresh-cw`, `history`, `link`, `paperclip`, `search`, `circle-dot`
   - Caption below, 12px `--text-muted`: "Ten to pick from straight away, or search the full icon
     set for your own. The quick picks are all unclaimed by a built-in type, so they stay distinct
     in the timeline."
4. **Preview and submit**, separated by a 1px `--border-default` top border, `padding-top: 16px`:
   label `PREVIEW` in mono, then the live type chip and the live rail medallion side by side, then a
   primary Button, size sm, uppercase, label "Create type", right aligned.

Chip in the preview is the standard Tag in its solid variant: 12% tint, uppercase mono label,
leading icon at 12px.

### Empty and error states

- No name yet: the Create action is disabled at 50% opacity, per the Button component.
- No icon chosen: fall back to `circle-dot` and say so quietly under the preview.
- Duplicate name or icon: inline message in `--terracotta`, sentence case, no exclamation.

---

## 5. Interactions

- Card hover: existing behaviour, border to `--border-strong` plus the design system's shadow lift,
  200ms `--ease-out`. The rail medallion does not animate.
- Action icons: fade in on card hover if that is the current behaviour, otherwise leave as is. This
  redesign does not change it.
- Icon search: debounce 150ms, filter locally against the Lucide name and tag list. No spinner.
- Everything suppressed under `prefers-reduced-motion`.

## 6. State

- Entry: `id, type, customTypeId?, title, content, notes[], createdAt, editedAt?, dueAt?, pinned`.
- Custom type: `id, name, icon` (Lucide name). No colour field, deliberately. If the schema already
  has one, ignore it in rendering rather than surfacing it in the UI.
- Icon search state is local to the panel: `query`, `results`, `selectedIcon`.

## 7. Assets

No images. Icons are `lucide-react`, stroke width 2, round caps, `currentColor`. Fonts are the
existing Geist, Geist Mono, and Lexend faces.

## 8. Files in this bundle

| File | What |
|---|---|
| `PROMPT.md` | The paste-ready brief for Claude Code |
| `README.md` | This specification |
| `Entry Card Hierarchy.dc.html` | Visual reference. Build direction **1b** for the card and **2a** for custom types. 1a, 1c, 2b are rejected alternates. |
| `screenshots/1b-entry-card-rail.png` | The entry card to build, showing update, blocker, todo, and a custom type in one thread |
| `screenshots/2a-custom-type.png` | The create-type panel and three custom types in one thread |

Match the screenshots. If what you have built does not look like them, the screenshots win.
