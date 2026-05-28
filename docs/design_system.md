# RTHM App — Design System

Living reference for visual + interaction patterns across the app. Source of truth for all UI work. Pair with `CLAUDE.md` (which has the LOCKED color tokens and high-level directives).

This file grows as design rules are added. Every visual pattern that appears in 2+ places belongs here.

---

## Glass Surface

Used for: chart cards, modal panels, page headers, table `<thead>` cells, calc-tip tooltips, recharts tooltips, page-level inner panels, **all form inputs** (text fields, selects, search inputs, rate inputs, combo dropdowns).

**Reserve solid white** for filled pill buttons only — anywhere else that would otherwise be `white` / `var(--white)` / `var(--paper)` should be glass so the lavender body shows through.

```css
background: rgba(255, 255, 255, 0.45);
backdrop-filter: blur(20px) saturate(180%);
-webkit-backdrop-filter: blur(20px) saturate(180%);
border: none;
isolation: isolate;
```

For pseudo-elements (`::before` / `::after`) add compositing hints so `backdrop-filter` activates reliably:
```css
will-change: backdrop-filter, transform;
```

**Modal backdrop** (neutral soft darken + meaningful page blur — sits below the modal panel; intentionally NOT navy-tinted so the modal doesn't read as grey/muddy):
```css
background: rgba(0, 0, 0, 0.2);
backdrop-filter: blur(8px);
```

**Modal panel** (Apple-style clean transparent white — high opacity + stronger blur so the panel pops without being opaque):
```css
background: rgba(255, 255, 255, 0.85);
backdrop-filter: blur(24px) saturate(180%);
```

**Modal sticky table header** (`.modal-table thead`): no background fill — lets the modal's own glass show through. Sticky positioning stays, but scrolling content reads through the header. Trade-off the user accepted; do not re-add a solid header bg.

---

## Form Inputs — Glass Schema

All form-entry **text fields** (text inputs, textareas, search inputs, rate inputs, checkboxes) share **one visual treatment**: subtle 0.18-alpha glass, no border, no focus ring.

**Comboboxes are NOT in this schema** — they're click-to-open buttons that surface a menu, so they follow the filled-primary pill button design language (purple at rest, white-bubble + primary-text on hover/open via the liquid-pill effect). See the Pill Buttons section. For form contexts where the trigger should stretch to fill its container, use `<Combobox className="combobox--form">`.

```css
padding: 10px 14px;       /* form fields — adjust per context */
border: none;
border-radius: var(--radius);
background: rgba(255, 255, 255, 0.18);
backdrop-filter: blur(20px) saturate(180%);
-webkit-backdrop-filter: blur(20px) saturate(180%);
color: var(--ink);
font-size: 14px;
outline: none;
```

**Rules:**
- **No borders, no focus rings.** Inputs read as floating glass on the aurora. Hierarchy is the alpha bump (0.18) against the lavender, nothing else.
- **No `:focus` border-color flip, no `box-shadow` glow** — clean rest = clean focus. Tradeoff accepted: minor keyboard-accessibility hit; visual consistency wins.
- **Padding/sizing per context.** Table cell inputs (`.rate-input`) are 4px 6px / 13px font. Form fields (`.field-input`, `.modal-input`) are 10px 14px / 14px font. Combobox glass-input (`.combobox--glass`) matches form fields.
- **Locked / read-only state** uses the same 0.18 glass — the field still reads as a value-bearing surface, just non-interactive. Don't switch to plain text unless the surrounding table is explicitly mirroring a read-only sibling (RTHM Valuation locked Advance / Rate cells mirror the Initial Quote table).
- **Native `<select>` is forbidden in forms.** Its opened dropdown menu is OS-rendered solid white and can't be glass-styled. Use the `<Combobox className="combobox--glass">` component instead — same controlled-value API as `<select>`, but a portaled glass menu.

**Classes implementing this rule:**
- `.rate-input` (ValuationPage table cells, OfferLetterForm income-cell %)
- `.field-input` (RPAForm, OfferLetterForm, InvoiceForm)
- `.field-locked` (read-only auto-calculated variant — same glass + ink-light text)
- `.modal-input` (ImportModal)
- `.modal-search` (ImportModal search bar — borderless, no background pill of its own, sits directly on the modal's glass)
- `.field-checkbox` / `.modal-table input[type="checkbox"]` (15×15 glass squares; primary fill + white check on `:checked`)
- `.line-items-count` (InvoiceForm line-item counter)
- `.combo-dropdown` (InvoiceForm type-or-pick menu — same glass as `.combobox-menu`)

If a new input class is added, it must match this schema. Any `border: 1.5px solid var(--paper-darker)` on a form input is a regression — remove it.

---

## Search Bars

Used for filtering tables / lists. Current instances: `.deals-search` (Deal Manager header), `.data-manager-search` (Data Manager header), `.modal-search` (Import modal select-rows view).

**Schema (all search inputs share this):**
```css
padding: 8px 12px 8px 30px;       /* 30px left padding = room for the 12px icon + 6px gap to text */
border: none;
border-radius: var(--radius);
font-size: 13px;
font-family: 'Montserrat', sans-serif;
color: var(--ink);
outline: none;
background: transparent url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%236B6580' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'><circle cx='7' cy='7' r='5'/><path d='m10.5 10.5 3.5 3.5'/></svg>") no-repeat 12px calc(50% + 2px) / 12px 12px;
```

**Rules:**
- **Borderless transparent** — the parent surface (page-header lavender body / modal glass) shows through. Inherits the no-borders, no-focus-ring form-input convention.
- **Leading magnifying-glass icon** — inline SVG data URI baked into `background`. Sized 12px, stroke color `#6B6580` (= `--ink-light`, matches placeholder text). Sits in the 30px left padding at 12px from the left edge, with a 6px gap to the start of the text. Vertical position is `calc(50% + 2px)` — the +2px nudge aligns the icon's center with the lowercase **x-height midpoint** of the placeholder text (excluding ascenders like `h`/`d`/`b`), not the geometric center of the input box.
- **Icon rationale** — Montserrat has no magnifying-glass glyph, so we use an inline SVG sized + colored to be visually integrated with the text. Do not swap for `🔍` (emoji) — it renders in the system emoji font and breaks the typographic feel.
- **Width** — `flex: 1` in modal contexts (`.modal-search` inside `.modal-search-wrap`). In **header contexts** (Deal Manager / Data Manager) the input grows from right to left as the user types:
  - `field-sizing: content` — input auto-fits its content (or placeholder when empty)
  - `max-width: 240px` — caps growth; further typing scrolls within the input
  - `text-align: right` — text is anchored to the right edge of the input, sitting "right next to" the adjacent header button (separated only by the wrapper's 12px flex `gap`)
  - The icon stays at `12px` from the input's left edge, so it physically shifts leftward as the input grows. At max-width the icon reaches its furthest-left position
  - **Vertical alignment with the adjacent button**: the search bar and the adjacent pill button align middle-to-middle via the wrapper's `align-items: center`. The button's position is sacred — do not nudge it. The search input owns the alignment burden, but with `align-items: center` doing the work, no per-input vertical transform is needed
  - Browser support note: `field-sizing: content` is Chromium 123+ (no Firefox/Safari yet). This app is Chromium-only so it's safe; do not adopt the header-growth variant in cross-browser contexts
- **Placeholder copy is lowercase** — `"search by <field>"`. Examples: `"search by deal name"`, `"search by folder name"`, `"search by deal name or platform"`. Follows the global Text & Copy lowercase rule.
- **Placement** — header search bars sit immediately to the left of the primary header action button (`+ Import Data`, `+ Create New Deal`) inside a right-group flex wrapper (`.deals-header-right`, `.data-manager-header-right`) with `gap: 12px` and `align-items: center` for perfect vertical centering with the button.
- **Outside-click selection** — when adding a header search bar to a page that has table-row selection with outside-click-to-deselect, add the search bar's wrapper class to the exemption list so typing in the search doesn't drop the selected row.

**For a new search bar:** copy the schema above verbatim into the new class. If a different icon is genuinely needed, encode it inline (no separate file) at 12×12 within a 16×16 viewBox, stroke `#6B6580` to keep parity with placeholder text.

---

## Pill Buttons — Liquid Hover

All clickable pill buttons participate in the **liquid-pill hover effect**: a radial fill that expands from the cursor's entry point over `0.6s cubic-bezier(0.33, 0, 0.15, 1)`. Text is wrapped in a `<span>` so it color-flips on the same timing.

### No borders, ever
Pill buttons **never have a border**. Differentiation between filled / outline-look / tinted / error variants is done purely via background color, text color, and the liquid-pill hover effect. If a class still has `border: 1.5px solid ...` or `border-color:`, remove it. Visual hierarchy is carried by fill and text contrast — not strokes.

### Color variants

| Variant | Rest | Hover |
|---|---|---|
| Filled primary | bg primary, white text | white bubble fills, text → primary (+ subtle purple glow) |
| Outline primary | white bg, primary text/border | primary-mid bubble fills, text → white |
| Transparent tinted | `rgba(82,0,190,0.1)` bg, primary text, no border | primary-mid bubble fills, text → white |
| Outline error | white bg, error text/border | error bubble fills, text → white |

### Required wiring (per new pill button class)
1. Add the class to **all four** selector lists in `src/index.css`'s liquid-pill block:
   - Base (position/isolation/overflow)
   - `::before` (the bubble)
   - `> span` (the text-flip element)
   - `:hover::before` (the expansion)
2. Add to the appropriate **per-color group** (filled-primary / outline-primary / transparent-tinted / outline-error) so the bubble color + text-flip target match the variant.
3. Add to the `LIQUID_SELECTOR` array in `src/App.jsx`'s mouseover handler so the cursor tracker sets `--mx` / `--my`.
4. Wrap the button's text in `<span>` in JSX.

### Bubble expansion
The `:hover::before` rule expands to `1500px × 1500px`. Large enough to fully cover any reasonably-sized pill regardless of where the cursor enters.

### Standard sizing
- **Action pill** (`+ Diligence`, `+ Valuate`, `+ Extract`, platform toggle): `padding: 5px 14px`, `font-size: 12px`, `font-weight: 600`, `border-radius: var(--radius)`
- **Larger primary** (`+ Import Data`, `Create New Deal`, modal CTAs): `padding: 10px 22px`, `font-size: 13px`
- **Back button** (`.back-btn`) is an exception — text-link style, no pill, no bubble

---

## Disabled / Non-Clickable Suppression

Non-clickable button variants stay in their **rest state on hover** — no bubble, no text flip, no glow. App-wide rule lives at the end of the liquid-pill block in `src/index.css`.

### Rest-state appearance (unified)
All non-clickable buttons (disabled or otherwise non-interactive) use the **transparent-tinted purple** convention:
```css
background: rgba(82, 0, 190, 0.1);
color: var(--primary);
cursor: not-allowed;
```
Do NOT use `var(--paper-darker)` + `var(--primary-mid)` for disabled state — that pattern is deprecated. Always use the tinted-purple convention so disabled buttons read consistently across the app.

### Triggers (caught by the suppression block)
- `button:disabled` (HTML attribute)
- `.disabled` class
- `.recoup-btn-inactive` (the recoup toggle's non-clickable variant)

Implementation:
```css
button:disabled:hover::before,
.disabled:hover::before,
.recoup-btn-inactive:hover::before {
  width: 0;
  height: 0;
}
button:disabled:hover > span,
.disabled:hover > span,
.recoup-btn-inactive:hover > span {
  color: inherit;
  text-shadow: none;
}
```

When adding a new "two-state toggle" variant (active/inactive pair), name the inactive class with a clear `-inactive` suffix and add it to this suppression block.

---

## Toggles

Two-button or N-button mutually-exclusive selectors. The active button is statically filled-primary (no hover bubble — clicking it is a no-op). Inactive buttons use the transparent-tinted pattern with full liquid-pill hover.

Examples:
- `.recoup-btn` (Set Recoup / Edit Recoup pair on Valuation page)
- `.valuate-toggle-btn` (platform switcher on Valuate page — N options + "Combined")

**Rule for ordering N-option toggles:** if a "Combined" / "All" option exists, it goes **furthest right**. Individual options come before it.

**Default selection** for N-option toggles defaults to Combined (or whatever the broadest aggregate is). Single-platform workbooks suppress the toggle entirely.

---

## Tooltips

All tooltips use the **Glass Surface** pattern. Two implementation styles:

### 1. Recharts (graph tooltips) — portal-rendered (LOCKED)

**Rule**: every chart tooltip MUST render via `createPortal` to `document.body`. Recharts' `wrapperStyle` is set to `display: none` so recharts' own positioned wrapper never participates in layout; the actual tooltip content is portaled out and positioned in viewport coords using `position: fixed`. This is the ONLY way to guarantee:
1. Tooltip is always the top layer (never clipped by ANY parent: modal body `overflow-y: auto`, table `overflow`, etc.)
2. Tooltip never affects layout — `pointer-events: none` + portal escape means nothing beneath is touched, no scrollbar can appear, no container resizes

**Implementation pattern** — reference impls live in `ProjectionModal.jsx` and `ValuatePage.jsx`:

```jsx
import { createPortal } from 'react-dom'

const chartHostRef = useRef(null)

// Wrap ResponsiveContainer with a ref'd div — the div's bounding rect drives
// portal positioning. ResponsiveContainer itself doesn't expose a usable ref.
<div ref={chartHostRef}>
  <ResponsiveContainer width="100%" height={280}>
    <LineChart ...>
      <Tooltip
        content={(props) => <MyTooltip {...props} chartHostRef={chartHostRef} />}
        wrapperStyle={{ display: 'none' }}
        allowEscapeViewBox={{ x: true, y: true }}
      />
      ...
    </LineChart>
  </ResponsiveContainer>
</div>

function MyTooltip({ active, payload, label, coordinate, chartHostRef }) {
  if (!active || !payload?.length) return null
  const rect = chartHostRef?.current?.getBoundingClientRect()
  if (!rect) return null
  const x = rect.left + (coordinate?.x || 0)
  const y = rect.top  + (coordinate?.y || 0)
  return createPortal(
    <div style={{
      position: 'fixed',
      left: x + 14, top: y - 14, transform: 'translateY(-100%)',
      pointerEvents: 'none', zIndex: 10000,
      // Glass surface (standard):
      fontSize: 12,
      background: 'rgba(255, 255, 255, 0.45)',
      backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      borderRadius: 'var(--radius)',
      boxShadow: '0 4px 20px rgba(82,0,190,0.08)',
      isolation: 'isolate',
      padding: '8px 12px',
    }}>
      …content…
    </div>,
    document.body
  )
}
```

Standard offset: `left: x + 14, top: y - 14, transform: translateY(-100%)` — tooltip appears above-right of the cursor, anchored at its bottom-left. `zIndex: 10000` ensures top layer above modal overlay.

### 2. `.calc-tip` (form/table tooltips)
CSS-only pseudo-element triggered by hover. Used in `ValuationPage`, `RPAForm`, `InvoiceForm`, `OfferLetterForm`. Reads from a `data-tip` attribute and renders via `::after content: attr(data-tip)`.

Positioning: anchored above the trigger element via `bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%)`. Max-width 280px with `white-space: normal` so long formulas wrap instead of being clipped.

### No-clipping rule (universal)

**Tooltips are always the top layer, never clipped, and never affect the page beneath.** Concretely:
- Chart tooltips: portal-rendered per pattern (1) above — escapes ALL parent overflow/stacking contexts. Locked rule.
- `.calc-tip` tooltips: parent containers that host tooltip triggers MUST NOT have `overflow: hidden`. For tables specifically, use per-corner border-radius on the corner cells instead of `overflow: hidden` on the table.
- Any tooltip implementation must satisfy: (a) `pointer-events: none` so nothing beneath is affected, (b) `z-index` above page chrome (10000 for chart tooltips, ≥100 for `.calc-tip`), (c) never causes a scrollbar to appear, never resizes its container.

---

## Border Radius

- `--radius: 8px` (used everywhere unless noted)
- Modals use `border-radius: 12px` (one-off — larger surface, larger radius)
- Tables avoid `overflow: hidden` so tooltips/popovers can escape. Use per-corner radii on the corner cells:
  ```css
  table thead tr:first-child th:first-child { border-top-left-radius: var(--radius); }
  table thead tr:first-child th:last-child  { border-top-right-radius: var(--radius); }
  table tbody tr:last-child  td:first-child { border-bottom-left-radius: var(--radius); }
  table tbody tr:last-child  td:last-child  { border-bottom-right-radius: var(--radius); }
  ```
  Requires `border-collapse: separate; border-spacing: 0` on the table.

---

## Modals

Structure:
- `.modal-overlay` — fixed dark backdrop, dims and slightly blurs the page (`rgba(10,4,28,0.6) + blur(2px)`)
- `.modal` — glass-surfaced panel, `border-radius: 12px`, centered in viewport
- Sub-variants (`.deal-sheet-modal`, `.agreements-type-modal`, `.partner-modal`, etc.) inherit `.modal` styles

When adding a new modal variant, define the sub-class for sizing/padding only — don't redefine bg/blur (those come from `.modal`).

---

## Page Headers

Pattern (`.valuation-header`, `.valuate-header`, `.agreements-header`, `.data-manager-header`, etc.):
- Padding `24px 40px 20px`
- Glass surface (standard pattern)
- `border-bottom: 1px solid var(--paper-darker)`
- `display: flex; align-items: center; gap: 20px; flex-shrink: 0`

Layout:
- **Left:** title block (`.X-title-block`) with `<h2>` (20px weight 600, ink) + optional subtitle (11px primary-mid uppercase, letter-spacing 0.08em)
- **Right:** action pills / toggles (where applicable)
- **Far left (when contextual):** `.back-btn`

When adding a new page or component with a header, **immediately add its header class** to the arcade toggle selector in `MainArea.jsx` `handleContextMenu`. Functional-consistency rule (see CLAUDE.md).

### Header Stats Block (centered)

Pattern for surfacing a small number of headline KPIs directly in a page header (first use: Valuate page — `.valuate-header-stats`, showing # statements + reporting cycle).

**Layout — absolute-centered at page midpoint:**
- Host header has `position: relative`.
- Stats block: `position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%)`.
- This anchors the block at the header's horizontal midpoint, which equals the chart-card title midpoint below (both share the same `40px` horizontal padding). Stats therefore line up visually with the column of centered chart-card titles.
- Because absolute removes the block from flex flow, the header's title-block stays at natural width on the left and the right-side toggle/action pills need `margin-left: auto` to stay pinned right.

**Stat tile structure:** `value` above `label`, both centered horizontally within the tile via `align-items: center` on the column-flex tile.
- **Value:** 15px, weight 700, `color: var(--primary)`, `font-variant-numeric: tabular-nums`, lowercase/natural case (no `text-transform`). For numeric values it renders as a numeral; for word values (e.g. "monthly", "quarterly", "mixed") it reads in its source lowercase.
- **Label:** 10px, weight 600, `color: var(--ink-light)`, `letter-spacing: 0.08em`, `text-transform: uppercase`.

**Tile spacing:** `gap: 24px` between tiles inside the block; `gap: 2px` between value and label inside each tile.

**Edge case to flag:** very wide title-block content (long folder name + long subtitle) can grow past the absolute-centered stats block's left edge and overlap. Hasn't surfaced yet but worth knowing if it ever does.

---

## Aurora Background

Layered, bottom → top:

1. **Body gradient** — 4 lavender pools + vertical lavender stack, all in the `--primary` purple family. See Body Background section below for exact values.
2. **`.orb-layer`** (fixed, z-index 0) — 3 JS-animated wandering orbs, all `#5200BE` (`--primary`). Minimal/brand-loud single-color haze.
3. **`.grain`** (fixed, z-index 1, `mix-blend-mode: overlay`, opacity 0.06) — SVG fractal-noise film grain.
4. **`.main-area`** (z-index 2) — `background: transparent` so the body + orbs + grain all show through.

Don't put opaque backgrounds on page-level containers — they break the aurora.

### Orb configuration (locked, in `App.jsx`)

**Anchor positions** (centerX, centerY as fractions of viewport):
| # | Color | Size factor | Center (X, Y) | Depth |
|---|---|---|---|---|
| 1 | `#5200BE` | 0.80 × vmax | (0.343, 0.253) | 1.0 |
| 2 | `#5200BE` | 0.90 × vmax | (0.906, 0.460) | 0.8 |
| 3 | `#5200BE` | 0.60 × vmax | (0.511, 0.842) | 1.1 |

Forms an askew composition: upper-left soft, right-side dominant, bottom-center anchor. Each orb is a radial gradient blurred by `0.07 × vmax`.

**Physics constants** (`LOCKED` object):
```
breath: 0.10        speed: 1.0        wanderSpeed: 3.0
wander: 3.0         converge: 150     repel: 3.0
velocity: 0.05      spacing: 0.20
```

**Cursor-area gating (`activeFactor` ∈ [0,1]):**
- `isActive = true` only when cursor is over `.main-area`. Cursor in sidebar / outside window → `isActive = false`.
- `activeFactor` smooth-lerps toward `isActive ? 1 : 0` at 0.08/frame (~12 frames to fully transition).
- **Wander, cursor convergence, and velocity transfer** all scale by `activeFactor` — orbs glide back to anchors and stop wandering when cursor leaves the main area.
- **Repel** scales by `(1 - activeFactor)` — orbs can overlap freely while converging on the cursor; repel only kicks back in once they're returning to anchors.
- **Per-orb opacity** scales by `(1 - 0.5 × activeFactor)` — at full convergence each orb fades to 50% of its rest opacity (`0.30 → 0.15`) so three overlapping orbs don't stack into a too-dark blob.
- Breath scale and pairwise repulsion damping are not gated — orbs keep breathing at rest, residual velocity dies out cleanly.

To tweak orb count, palette, or physics: edit `ORB_DEFS` and `LOCKED` in `App.jsx`. The in-app drag playground (with magenta dots + readout panel) was removed after the anchor tune-in pass — re-add only if rebalancing positions.

---

## Selection State (Tables / Rows)

Restrained pattern, user-confirmed:
- **Left accent bar:** 3px solid `var(--primary)` via `box-shadow: inset 3px 0 0 0 var(--primary)`
- **Faint wash:** `background: rgba(82,0,190,0.05)`
- **NOT** heavy fills, thick rings, or full-row purple bg

Outside-click handler exempts the table wrap AND its sibling header-actions container (so action buttons don't accidentally deselect — `mousedown` fires before `click`).

---

## Sidebar

LOCKED. Specs in `CLAUDE.md`. Do not modify without explicit request.

Notable: bg image is on a `::before` pseudo-element with `transform: scaleX(-1)` so nav items don't flip with it.

---

## Empty States

Pages with no content (no folders, no deals, no template selected, loading, error) render a centered hint message. Used in Deal Manager, Data Manager, Valuate page, and the MainArea fallback ("pick a template").

**Markup**
```jsx
<div className="empty-state">
  <p className="empty-hint">lowercase hint text here</p>
</div>
```

**Centering behavior**: `.empty-state` is **`position: absolute; inset: 0`** — it centers on the **full page area**, not on remaining flex space after the header. This means an empty Data Manager page (taller header with 3 action buttons) and an empty Deal Manager page (shorter header) place the hint text at the **same visual midpoint**.

**Host container requirement**: the parent of `.empty-state` must be `position: relative` so it forms a positioning context. Already applied to:
- `.deals-page`
- `.data-manager-page`
- `.main-area-content`
- `.valuate-body`

When adding a new page that uses `.empty-state`, also add `position: relative` to that page's container.

**Pointer-events**: `.empty-state` has `pointer-events: none` so the absolute overlay doesn't block clicks on the header beneath it. Children re-enable with `pointer-events: auto`.

**Hint styling** (`.empty-hint`):
- `font-size: 16px`, weight 500, `color: var(--primary-mid)`
- `text-align: center` (single-line and multi-line both center correctly)
- All copy lowercase (except proper nouns) per the Text & Copy Rules below

---

## Text & Copy Rules

- All placeholder + empty-state text **lowercase** (except proper nouns: Google Sheets, Monday.com, EMPIRE, BMI, distributor names, etc.)
- **All pill button text is lowercase.** The global `button { text-transform: lowercase }` rule enforces this. JSX strings can be written in any case (`+ Diligence`, `B2B`, `Individual`, `Combined`) — the CSS lowercases at render. Do NOT add `text-transform: none` overrides on pill button classes.
  - Applies to: action pills, toggle pills, modal radio buttons, combobox triggers, recoup toggles, etc.
  - Plain text-link buttons (`.back-btn`): lowercase JSX too (no transform difference).
  - Exception — dropdown **list items** (rendered as `<div>` inside `.combobox-menu`): display in the data's source case (typically Title Case, e.g. "Publishing", "Individual"). The trigger button lowercases the selected label visually; the menu itself preserves source casing.
  - Exception — buttons whose label is a filename / proper-noun template name pulled from data (e.g. `.template-item`, `.category-toggle`, `.agreements-type-btn`): use `text-transform: none` because the source case is meaningful.
- Subtitles: uppercase + `letter-spacing: 0.08em` + primary-mid color
- Chart titles inside cards: lowercase in source, `text-transform: uppercase` in CSS

---

## Colors (Authoritative)

All defined in `src/index.css` `:root`. The high-level locked subset is repeated in `CLAUDE.md`.

### Purples
| Token | Value | Use |
|---|---|---|
| `--primary` | `#5200BE` | Buttons, accents, page titles, hover states |
| `--primary-dark` | `#3A0090` | Button hover (filled variant background) |
| `--primary-mid` | `#6218C8` | Bubble fills (outline-primary group), secondary purple |
| `--primary-soft` | `#A78BFA` | Soft lavender — sidebar active item |
| `--primary-light` | `#EAE0FF` | Light tints |
| `--primary-faint` | `#F4F0FF` | Faintest purple bg |
| `--primary-deep` | `#241050` | Deep near-black purple — sidebar hover state |
| `--accent` | `#5200BE` | Alias of `--primary` (legacy) |
| `--accent-light` | `#EAE0FF` | Alias of `--primary-light` (legacy) |

### Ink (text)
| Token | Value | Use |
|---|---|---|
| `--ink` | `#050508` | Main text, headings (essentially black) |
| `--ink-light` | `#6B6580` | Placeholders only |
| `--ink-faint` | `#7E7898` | Disabled states only |

### Paper (greys/neutrals)
| Token | Value | Use |
|---|---|---|
| `--white` | `#FFFFFF` | Pure white |
| `--paper` | `#FAFAFA` | Lightest neutral (off-white) |
| `--paper-dark` | `#F4F2F9` | Slightly cooler off-white |
| `--paper-darker` | `#E5E0F0` | Subtle borders, dividers, table outlines, header `border-bottom` |

### Sidebar
| Token | Value | Use |
|---|---|---|
| `--sidebar-bg` | `#16092E` | Sidebar base bg color (under the bg image) |
| `--sidebar-text` | `#EDE6FF` | Sidebar nav text |
| `--sidebar-text-dim` | `#9B90C2` | Dimmed/inactive sidebar text |

Sidebar active item uses `--primary-soft`; sidebar hover state uses `--primary-deep` (both live in the Purples section).

### Semantic
| Token | Value | Use |
|---|---|---|
| `--success` | `#059669` | Success states |
| `--error` | `#DC2626` | Destructive buttons, error states |

### Other
| Token | Value | Use |
|---|---|---|
| `--shadow` | `0 1px 3px rgba(82,0,190,0.06), 0 4px 16px rgba(82,0,190,0.08)` | Standard purple-tinted drop shadow |
| `--radius` | `8px` | Standard border-radius |

---

## Typography

**Font family:** `'Montserrat', sans-serif` — applied to body, all buttons, inputs, selects, textareas.

### Body defaults (from `body`)
- `font-size: 14px`
- `font-weight: 500`
- `line-height: 1.6`
- `color: var(--ink)`
- `-webkit-font-smoothing: antialiased`

### Headings (`h1, h2, h3`)
- `font-family: 'Montserrat', sans-serif`
- `font-weight: 600`
- `line-height: 1.25`

### Page titles (specific sizes per page header)
- Page-header `<h2>`: `font-size: 20px`, `font-weight: 600`, `letter-spacing: -0.2px`, color `var(--ink)`
- Page-header subtitle (`.X-sub`): `font-size: 11px`, `font-weight: 600`, `letter-spacing: 0.08em`, `text-transform: uppercase`, color `var(--primary-mid)`
- Chart card titles (`.valuate-chart-title`): `font-size: 13px`, `font-weight: 700`, `letter-spacing: 0.04em`, `text-transform: uppercase`, color `var(--ink)`
- Modal titles (`.modal-title`): `font-size: 13px`, `font-weight: 700`, `letter-spacing: 0.08em`, color `var(--ink)`

### Button defaults (global, in `index.css`)
```css
button {
  cursor: pointer;
  font-family: 'Montserrat', sans-serif;
  text-transform: lowercase;
  font-weight: 700 !important;
  border-radius: 999px !important;
}
```
Exceptions: `.template-item`, `.category-toggle` use `text-transform: none`. `.back-btn` overrides `border-radius` to `0` (text-link style).

### Action pill labels
Title Case in JSX (`+ Diligence`, `+ Import Data`) — but the global `text-transform: lowercase` re-cases them at render unless the source already has the desired casing AND the JSX text is intentionally cased. Audit before assuming.

---

## Transitions & Timing

| Pattern | Duration / Easing | Use |
|---|---|---|
| Standard color/bg | `0.15s` | Most button rest→hover transitions (non-pill, non-liquid) |
| Standard `all` | `0.15s` | Most pill buttons' fallback transition before liquid-pill takes over |
| Border-color | `0.15s` | Form input focus |
| Opacity (tooltip) | `0.15s` | calc-tip `::after` fade-in |
| **Liquid pill bubble + text flip** | `0.6s cubic-bezier(0.33, 0, 0.15, 1)` | The signature radial-fill expansion + color flip + glow. Matches Bystro — DO NOT change without explicit user request. |

---

## Effects

### Purple text glow (on filled-primary hover)
```css
text-shadow: 0 0 12px rgba(82, 0, 190, 0.4);
```
Applied on the `> span` color flip for: `deals-new-btn`, `data-manager-import-btn`, `data-manager-summarize-btn`, `data-manager-valuate-btn`, `data-manager-extract-btn`, `valuation-new-btn:not(:disabled)`, `agreements-new-btn`, `modal-import-btn:not(.disabled)`, `modal-connect-btn`, `export-btn:not(.disabled)`, `recoup-btn-active`, and the Deal Manager `.linked` filled-state buttons. Fades in over the same `0.6s cubic-bezier` as the bubble.

### Drop shadow (standard, purple-tinted)
```css
box-shadow: 0 1px 3px rgba(82,0,190,0.06), 0 4px 16px rgba(82,0,190,0.08);
```
Available as `var(--shadow)`. Use for cards, dropdowns, etc.

### Modal drop shadow (stronger)
```css
box-shadow: 0 8px 40px rgba(82, 0, 190, 0.18);
```

### Tooltip drop shadow (subtle)
```css
box-shadow: 0 4px 20px rgba(82, 0, 190, 0.08);
```
Used on both recharts `<Tooltip>` and `.calc-tip::after`.

### Row hover wash (tables)
```css
background: rgba(186, 156, 252, 0.18);
box-shadow: inset 0 0 0 1px rgba(218, 206, 253, 0.5);
```

---

## Liquid Pill Bubble — Full Spec

### Rest state (`.foo::before`)
```css
content: "";
position: absolute;
top: var(--my, 50%);
left: var(--mx, 50%);
width: 0;
height: 0;
background: white;          /* default — overridden per-color group */
border-radius: 50%;
transform: translate(-50%, -50%);
pointer-events: none;
z-index: 0;
transition:
  width 0.6s cubic-bezier(0.33, 0, 0.15, 1),
  height 0.6s cubic-bezier(0.33, 0, 0.15, 1);
```

### Hover state
```css
width: 1500px;
height: 1500px;
```

### Span (`.foo > span`)
```css
position: relative;
z-index: 1;
text-shadow: none;
transition:
  color 0.6s cubic-bezier(0.33, 0, 0.15, 1),
  text-shadow 0.6s cubic-bezier(0.33, 0, 0.15, 1);
```

### Per-color groups (bubble bg → text-flip target)

| Group | Bubble bg | Text flips to | Examples |
|---|---|---|---|
| Filled primary | `white` (default) | `var(--primary)` + glow | `.deals-new-btn`, `.data-manager-import-btn`, `.agreements-new-btn`, `.modal-import-btn`, etc. |
| Outline primary (deal-manager type) | `var(--primary)` | `white` | `.deals-valuation-btn` |
| Outline primary (form-link type) | `var(--primary-mid)` | `white` | `.deals-forms-btn`, `.deals-materials-btn`, `.agreements-edit-btn`, `.agreements-export-btn`, `.agreements-type-btn`, `.modal-radio-btn`, `.valuate-toggle-btn:not(.active)` |
| Outline error | `var(--error)` | `white` | `.deals-delete-btn`, `.data-manager-delete-btn`, `.agreements-delete-btn` |
| Modal cancel | `var(--primary)` | `white` | `.modal-cancel` |
| Recoup toggle (active) | `white` | `var(--primary)` + glow | `.recoup-btn-active` |
| Linked state (filled look) | `white` | `var(--primary)` + glow | `.deals-valuation-btn.linked`, `.deals-forms-btn.linked`, `.deals-materials-btn.linked` |

### Cursor tracking
`App.jsx` attaches a delegated `mouseover` listener on `document`. On a genuine entry (relatedTarget outside the button), sets `--mx` and `--my` to the cursor's position relative to the button's bounding rect. The bubble origin is fixed at entry — moves within the button don't re-anchor.

### LIQUID_SELECTOR array
Lives in `App.jsx`. Every pill class must be in this array OR the bubble won't track the cursor.

---

## Z-Index Scale

| Layer | z-index | Notes |
|---|---|---|
| Body bg gradient | (default) | `position: static` |
| `.orb-layer` | `0` | Fixed, behind everything |
| `.grain` | `1` | Fixed, `mix-blend-mode: overlay` on top of orbs |
| `.main-area` | `2` | The app content surface (transparent) |
| `.sidebar` | `1` | Inside the app flex layout |
| Bubble `::before` (inside button) | `0` | Inside button's isolated context |
| Button `> span` (inside button) | `1` | Above the bubble |
| Page header glass cells (`<th>`) | `auto`, `isolation: isolate` | Stacking context for backdrop-filter |
| `.modal-overlay` | `100` | Above all page content |
| `.modal` | (within overlay) | Default flow |
| Tooltips (`calc-tip::after`, recharts) | `100` | Above tables/content |

---

## Body Background

```css
body {
  background:
    /* Soft lavender highlight pools — all in the primary-purple family */
    radial-gradient(at 15% 20%, #EADAF7 0%, transparent 45%),
    radial-gradient(at 85% 15%, #E2D0F4 0%, transparent 50%),
    radial-gradient(at 75% 75%, #D6C0EF 0%, transparent 55%),
    radial-gradient(at 20% 85%, #E6D5F5 0%, transparent 50%),
    /* Base lavender stack */
    linear-gradient(180deg, #F2E8FB 0%, #E5DBF6 60%, #D4C5ED 100%);
  background-attachment: fixed;
}
```

All bg hues sit in the same purple family as `--primary` (#5200BE) — diffuse pale lavender pools + a vertical lavender stack. No blue or grey tints. The aurora orbs animate on top (see Aurora Background section).
