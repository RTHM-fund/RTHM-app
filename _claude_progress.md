# Claude Progress — Session Save

This session was a massive **design-system establishment + visual overhaul** pass on top of a Valuate-page rebuild. Most of the work lives in CSS / a new `docs/design_system.md`, plus a couple of server + JSX changes.

---

## Accomplished This Session

### Valuate page (built from scratch)
- Old ValuatePage was paused on an `exceljs` bug (`Cannot read properties of undefined (reading 'comments')`). Swapped the diligence-workbook parser to **`xlsx` (SheetJS)** — `exceljs` removed from `package.json`, `xlsx@0.18.5` added.
- Server endpoint `/api/data/diligence-workbook` rewritten to support:
  - Both `Track Rep|Adj` and `Brkdn Rep|Adj` sheet naming
  - Dynamic header-row detection (scans rows 0–7 for first row with month-parseable cells; handles Starz Lil D's header-row-1 layout AND Too $hort's header-row-3 layout AND Rockette's monthly+semi-annual mix)
  - Per-platform parsing with **Track-preferred + Breakdown fallback** (so UMPG, which has no Track sheets, still contributes via its Breakdown sheets)
  - Combined view = chronological union of all platforms' months, summed
- Response shape: `{ folderName, platforms: [{ name, months, tracksLine, tracksAdjLine }], combined: { months, tracksLine, tracksAdjLine } }`.
- New month-header parser (`parseMonthHeader`) handles: Date objects, `YYYY-MM`, `M/YYYY`, `M/YY` (assumes 2000s), `MMM YYYY`, **`MMMyy` no-separator** (the diligence-skill default like `Aug25`), `MMMyyyy` no-separator.
- Frontend `ValuatePage.jsx`:
  - Two stacked line charts ("tracks", "track adjusted"), full width, glass cards, no white bg
  - Default view = **Combined**, per-platform toggle on the right (only shown when 2+ platforms). Toggle order: platforms first → **Combined furthest right**.
  - Track-adjusted card auto-hides when its series is element-wise identical to Tracks (case: BMI Dom and BMI Intl on Rockette).
  - Glass header with back-btn + title + subtitle (all platforms joined `·`).
- Test catalogs covered: Starz Lil D (1 platform monthly), Too $hort (Jive Track + UMPG Breakdown-only), Roykeisha Rockette (3 platforms mixed monthly+semi-annual).

### Design system established
- New living doc: **`docs/design_system.md`** — full coverage of glass surface, pill buttons, liquid-pill, disabled suppression, toggles, tooltips, border-radius rules, modals, page headers, aurora background (with full orb spec), selection state, sidebar, typography, transitions/timing, effects (glow/shadow), z-index scale, body background, and the **empty-state centering pattern**.
- `CLAUDE.md` Session Start updated to read `docs/design_system.md` on every session, alongside `_claude_progress.md` and `docs/v2_specs.md`.

### Color tokens (locked)
- **`--ink`**: `#1A0F2E → #0A0A0F → #050508` (essentially black with a barely-perceptible cool hint). Token-based so it cascaded across all text in one change.
- **`--sidebar-active`** renamed to **`--primary-soft`** (it's a brand-palette purple, not sidebar-only).
- **`--sidebar-hover`** renamed to **`--primary-deep`** (same reasoning).
- Sidebar.css usages updated. Comments in `App.jsx` (orb color mapping) updated.

### Background system (aurora locked)
- Body gradient back to **lavender**, but all hues sit in the `--primary` purple family (no blue/grey tints — pure RTHM purple family).
- **3 orbs** (down from 4), **all `#5200BE`** royal purple. Minimal/brand-loud.
- Anchor positions tuned via an **in-app drag playground** (debug code now stripped):
  - Orb 1 (sizeFactor 0.80, depth 1.0): centerX `0.343`, centerY `0.253`
  - Orb 2 (sizeFactor 0.90, depth 0.8): centerX `0.906`, centerY `0.460`
  - Orb 3 (sizeFactor 0.60, depth 1.1): centerX `0.511`, centerY `0.842`
- Anchor system **refactored to percentage-based** (`centerX, centerY ∈ [0,1]`) — much more intuitive than the old corner-anchor + offset system.
- Physics: `breath 0.10, speed 1.0, wanderSpeed 3.0, wander 3.0, converge 150, repel 3.0, velocity 0.05, spacing 0.20`.
- **Cursor-area gating**: new `isActive` flag — `true` only when cursor is over `.main-area`. Smooth `activeFactor` lerps to 0/1 at 0.08/frame.
  - Wander, cursor convergence, and velocity transfer all **scale by activeFactor** → orbs glide back to anchors when cursor leaves the main area.
  - **Repel scales by `(1 - activeFactor)`** → orbs can overlap freely while converging on the cursor; repel returns when they settle.
  - **Per-orb opacity scales by `(1 - 0.5 × activeFactor)`** → at full convergence each orb fades to 50% of rest (0.30 → 0.15) so 3 overlapping orbs don't stack too dark.

### Pill button system (locked rules)
- **No borders, ever** on pill buttons (~10 borders removed across app: agreements-edit/export/delete/type, data-manager-delete, modal-cancel, modal-radio, recoup-btn base, deals-X.linked orphan border-color).
- **Disabled / non-clickable** buttons use the **transparent-tinted purple** convention (`rgba(82, 0, 190, 0.1) + var(--primary)`) — the old `var(--paper-darker) + var(--primary-mid)` pattern is deprecated.
- Suppression block at the end of liquid-pill in `index.css`: `button:disabled`, `.disabled`, `.recoup-btn-inactive` all stay in rest state on hover (no bubble, no text flip, no glow).
- Liquid bubble expansion bumped `500px → 1500px` so it fully covers wide buttons (modal radios, agreements-type).
- Glow on filled-primary hover: `text-shadow: 0 0 12px rgba(82, 0, 190, 0.4)`.

### Glass surface (everywhere)
- **All modals**: cleaner Apple-white (`rgba(255,255,255,0.85)` + `blur(24px) saturate(180%)`) over a neutral darken backdrop (`rgba(0,0,0,0.2) + blur(8px)`) — no more navy-purple cast.
- **All tooltips → glass**: `calc-tip::after` matches recharts tooltip styling (rgba 0.45 + blur 20px + var(--radius)). Recharts tooltips also get `allowEscapeViewBox={{ x: true, y: true }}` to escape chart bounds.
- **All form inputs → glass** (9 surfaces): `.field-input` (Invoice + RPA + OfferLetter), `.rate-input` (Valuation), `.income-cell .rate-input` (OfferLetter), `.modal-search`, `.modal-input`, `select.modal-input`, `.line-items-count`, `.combo-dropdown`, `.field-locked`.
- `.field-locked` uses the same glass + `color: var(--ink-light)` (muted text distinguishes locked from active).
- White solid is now reserved for **filled pill buttons only**.
- **Valuation table** lost `overflow: hidden`; corner-cell border-radius applied instead — so calc-tip can escape table bounds.

### Empty-state pattern (new design rule)
- `.empty-state` now **absolute-positioned**: `position: absolute; inset: 0; pointer-events: none` (children re-enable). Centers on the **full page area**, not on remaining flex-space-after-header.
- Result: Data Manager and Deal Manager (different header heights) place their "no folders found" / "click create new deal" hints at the **same visual midpoint**.
- `position: relative` added to all 4 host containers: `.deals-page`, `.data-manager-page`, `.main-area-content`, `.valuate-body`.
- `.empty-hint` now also has `text-align: center` for safety on multi-line copy.

### Sidebar
- Background image flipped horizontally (`transform: scaleX(-1)` on a new `::before` pseudo-element so nav items don't flip with it).
- "RTHM App" wordmark + `.sidebar-footer` container removed (JSX + CSS rules deleted).

### Monday.com logo button (special effect)
- Rest: 0.3-opacity full-color logo (faded but colored).
- Hover: clip-path circle (anchored at cursor entry via the liquid-pill `--mx`/`--my` system) grows over 0.6s to reveal a 100%-opacity colored logo from a `::before` pseudo.
- Added `.deals-monday-btn` to `LIQUID_SELECTOR` in App.jsx.

### Headers (audit + glass)
- All form-page headers (`.invoice-header`, `.agreements-header`, `.offers-header`, `.rpa-header`, `.valuate-header`, `.valuation-header`) confirmed glass with the standard pattern (`rgba(255,255,255,0.45) + blur(20px) saturate(180%) + border-bottom`).
- `.data-manager-header` and `.deals-page-header` are inline title-rows (not glass banners) by design — flagged in audit.

### Other UI fixes
- **Income Sharing table**: removed `border-bottom` from `th` cells (no more white line under header).
- **Modal table thead**: white fill removed (sticky positioning kept, but bg transparent so modal glass shows through).
- **Modal top-row checkbox**: removed (header row no longer selectable; empty `<th></th>` placeholder keeps column widths aligned).
- **Modal cancel/back rest color**: ink → primary (matches the tinted-clickable schema).
- **Agreements-type-btn**: moved from outline-primary group to filled-primary group (rest = filled primary, hover = white bubble + primary text + glow, matches `+ Diligence`).
- **Recoup toggle**: kept on the no-borders + suppression-block rules; orphan `border-color` cleaned.

### Server / endpoint additions
- `POST /api/data/open-folder` now accepts `{ path: <absolute path> }` in addition to `{ key }`. Security check: resolved path must live inside `DATA_ROOT`.
- Data Manager: **right-click on a folder name** → opens that folder in Explorer/Finder via the new endpoint. `e.stopPropagation()` to avoid the arcade triple-click handler. `preventDefault()` on the context menu.

### Memory + docs
- `CLAUDE.md` Session Start updated to reference `docs/design_system.md`.
- `docs/design_system.md` created and continuously expanded as new rules were locked.
- Token renames + ink darkening reflected in `CLAUDE.md` Locked Colors section.

---

## Current State

- **Working path**: `C:\Users\richa\RTHM Dropbox\RTHM Fund\RTHM\4. Operations\RTHM App\App Files`
- **Branch**: `master`, repo `https://github.com/RTHM-fund/RTHM-app`
- **App state**: Vite + Node server still hot-reloading cleanly. No outstanding runtime errors.
- **Server-restart-needed changes this session**: yes — `xlsx` dep swap, endpoint rewrites, plus other minor edits. Frontend changes hot-reload via Vite, but the user should have `npm run dev` running for the latest server code.
- **Design**: locked in. Background lavender / orbs royal-purple / empty-state absolute-centered / pill buttons borderless / disabled tinted-purple / glass everywhere except filled pills.

---

## What's Next

### V2 roadmap (unchanged from last save)
1. File discovery — done ✓
2. **Column standardization → earnings col selection → date extraction → include/exclude → merge** ← NEXT
3. Pivot engine → projection model → advance/IRR calculator

Full spec: `docs/v2_specs.md`. Modularity rule still holds (Data Manager / Deal Manager decoupled at the frontend; server endpoints are the only bridge).

### Known issues / pending
- **Linux fallback** for `findClaudeBin()` still not implemented (PATH-only).
- **No concurrency cap** on skill runs.
- **localStorage stale entries** — no force-clear UI yet.
- Mac Dropbox File Provider migration still pending re-run of `RTHM Setup.command`.

### Design follow-ups (if needed)
- Data Manager header / Deals page header are still inline title-rows (no glass banner). If user wants them upgraded to glass banners later, the pattern is documented.
- Sticky modal-table thead has no fill now → scrolling rows read through. User accepted that tradeoff. If it becomes a problem, faint glass on the `<thead>` is the fix.
