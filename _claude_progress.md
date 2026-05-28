# Claude Progress — Session Save

Long session — Data Manager v3 polish, Valuate page Tracks table buildout, app-wide form-input glass schema unification, major data-integrity fixes on diligence workbook parsing, dynamic per-platform metrics, and a brief color exploration (reverted).

---

## Accomplished This Session

### Data Manager Page

**Clickable ✓/? in Diligence / Valuation / Extract columns.** Each mark is now a button:
- **Diligence ✓** → opens `<folder>/<folder>_Due Diligence` in native Finder/Explorer
- **Valuation ✓** → opens that folder's Valuate page (graph view)
- **Extract ✓** → opens `<folder>/<folder>_Data Engine` in native Finder/Explorer
- **Diligence ?** → kicks off `runSkill('diligence', f.path)` for that row
- **Valuation ?** → opens Valuate page (same as ✓ — no skill to run)
- **Extract ?** → kicks off `runSkill('catalog-extract', f.path)`

`runSkill` now accepts optional explicit folderPath so per-row buttons work without requiring row selection first. Row-toggle bails on `closest('button, a')`.

**Hover effect (Option A — glow pulse, no box):** ✓ stays green at rest, on hover the text-shadow intensifies (3 layered shadows tight-to-loose, inner at full alpha) and scales 1.1× via 0.25s ease transition. Same hot-halo treatment in red for the `?`. Font weight stays 500 (Montserrat is static-discrete, can't smoothly tween weight).

**New columns:** Tracks, Top 80%, Dollar Age — all left-aligned numeric. Header centering applied to Diligence/Valuation/Extract via `nth-child` rules.

**Move column attempt + revert.** Briefly added a "Move" pill button (transparent-tinted primary-mid variant) that opened `1. Current/` with the row's folder selected via `revealInParent()` (windows `explorer.exe /select,`, Mac `open -R`). User deleted the column entirely; all related code (JSX, CSS, index.css liquid-pill wiring, App.jsx LIQUID_SELECTOR, server `revealInParent` helper, `reveal:true` endpoint flag) removed.

**Faster cold-start.** Server pre-warms summary cache on `app.listen` (walks every folder ~100ms after server start, populates `computeWorkbookSummary` cache). Client `App.jsx` prefetches `/api/data/folders` on mount, not when Data Manager opens — by the time user navigates there, data is in lifted React state.

**Selected row mechanics** ported from Data Manager to Deal Manager (left accent bar + faint primary wash, outside-click deselect, inline-button bypass).

### Valuate Page

**Tracks table** — full buildout. Columns now: `# | TRACK | SPARKLINE | % OF LTR | LIFETIME | TTM | DOLLAR AGE | DECAY RATE`. Per-track values:
- **Dollar Age:** years from each track's first non-zero earning month to today
- **TTM:** sum of monthly revenue in the 12-month window ending at the active view's lastKey (combined or platform-specific)
- **Decay Rate:** simple arithmetic mean of period-to-period decay rates (`1 - curr/prev`) across consecutive non-zero-prev pairs. Positive = decaying, negative = growing
- **Sparkline:** per-track revenue line aligned to the active view's month axis; 0 in months with no earnings
- **% of LTR:** lifetime revenue share (was "% of LTV" — relabeled since LTV is reserved for Loan-to-Value)

OTHER bundle row aggregates each metric: simple averages for Dollar Age + Decay Rate, sums for Lifetime + TTM, element-wise sum for the sparkline.

**Dynamic per-platform view.** Server now returns `tracksByPlatform[name] = {tracks, other, dealLifetime, dollarAge}` — each platform gets its own top-80% ranking + OTHER bundle scoped to its revenue, with the platform's own month axis for sparklines. Toggling platforms re-ranks the table the same way it switches charts and header stats.

**Key Metrics card.**
- Pivoted from row-list to single-row tile grid (value above, label below per tile)
- Tiles evenly distributed via inline `gridTemplateColumns: repeat(N, 1fr)`
- Added Dollar Age — Combined row
- Per-platform view: scopes Lifetime/TTM/Dollar Age to that platform only, drops the per-platform % of Lifetime rows (would trivially be 100%)
- Labels stay source-case (no `text-transform: uppercase`)

**Charts.**
- Added period-to-period decay row to the recharts hover tooltip: `decayFromPrev = 1 - (current.total / prev.total)` per row, shown as a signed `%` at the bottom of the tooltip
- Added hover tooltip on "adjusted revenue" chart title via `.calc-tip` schema — explains what adjusted revenue is and why it's adjusted
- Chart card lifts to `z-index: 10` on hover so recharts tooltip can overflow downward without being clipped by the next card's stacking context

### Diligence Workbook Parsing — Data Integrity Overhaul

**This was the session's biggest area of fixes.** All work in `computeDiligenceWorkbook` (Valuate endpoint) and `computeWorkbookSummary` (Data Manager).

**Bug 1: 2-4x inflated Lifetime/TTM across most deals.** The narrow `/^total$|^grand total$/i` row filter in `buildSeries` missed qualified aggregate rows (`Reported Total`, `Adjusted Total`, `GRAND TOTAL (Gross Royalty)`, `(a) Reported Total`, `Bridge`, `Less:`, etc.). Those rows' values got double-counted into per-month buckets. Lifted `isAggregateRow()` to module scope and use it everywhere. Lil Candy Paint $1.49M → $496K, Lomeli $68K → $22K, Charles Rhodes $223K → $56K, etc.

**Bug 2: Projection-data bleed.** Lomeli's workbook contains decay-modeled projections appended after a `Decay` parameter column — same month labels repeat past Feb-2026, into Mar-2038. Without detection, projected values double-counted into their corresponding historical months. Added "projection boundary detector" — scan headers left→right tracking max date seen, stop reading columns at the first key reset. Applied to `buildSeries` + `trackLifetimeFromEntries` (Valuate) and the inline track loop in `computeWorkbookSummaryInner` (Data Manager).

**Bug 3: Track-label extraction read Work IDs as titles.** Landstrip Chip's BMI sheets have col 0 = Work # ("24348906") and col 1 = title ("10 000 HOURS") — swapped from the typical convention. Heuristic: if col 0 is **6+ digits** and col 1 is non-numeric text, use col 1 as the label. 6-digit minimum so short numeric titles like "22" (Lil Candy Paint) and "42" (22gfay) aren't misclassified. Audited across all 17 deals with diligence workbooks — 16 correctly read titles after fix; Too $hort still shows asset codes ("Z0089") because the diligence skill didn't capture track titles for that deal (workbook content issue, not app).

**Bug 4: 4 deals weren't producing summaries at all.**
- **AJ McQueen** — uses quarterly headers (`Q1-25, Q2-25, Q3-25, Q4-25, Q1-26`). Extended `parseMonthHeader` to handle `Q[1-4][-/'\s]?\d{2,4}` and `[1-4]Q\d{2,4}`. Each quarter anchors to its start month (Q1→Jan, Q2→Apr, etc.).
- **Hirschmann** — workbook is `Hirschmann DD Workbook.xlsx` (non-canonical name), sheets are `By Track (Reported)` (non-standard), headers are `Q3'22` (apostrophe quarterly). Added `resolveDiligenceWorkbookPath()` helper that falls back to scanning the diligence folder for any `.xlsx` containing "workbook" (excludes `(by-statement)` variants). Extended sheet regex to accept `By (Track|Source) (Reported|Adjusted)`. Quarterly parser accepts `'` separator.
- **Lambo4oe** — workbook is `Lambo4oe_Catalog_Diligence_Workbook.xlsx`. Same filename-variant fix as Hirschmann.
- **BPG Records, Charles Rhodes** — single-platform workbooks with bare sheet names (`Track Rep` / `Track Adj` instead of `<Platform> – Track Rep`). Extended `sheetKindRe` to make the platform prefix optional; bare sheets use the deal folder name as the platform identifier.

**Bug 5: Empty `_Due Diligence` folders were showing green ✓.** `hasDiligence` was just "folder exists" — Narvent and Romano had empty folders. Changed to `hasDiligence = summary != null` so the indicator reflects actual parseable data.

**Bug 6: Statement count from heuristic folder scan was wrong/missing.** Replaced the 117-line folder-walk Pass 2b with `p.statementsCount = p.months.length` — derived directly from the workbook data that drives the chart. Per the design rule "if you can draw the line, you have the statements."

**Bug 7: App was non-currency-agnostic for Barretta.** Briefly added README-parsing currency detection (Barretta is in COP) — reverted per user directive: "app is currency agnostic, value in, value out, currency blind." The app now displays raw workbook numbers regardless of currency; conversion is the diligence skill's responsibility.

### Track-level Server Outputs (new fields exposed)

The `/api/data/diligence-workbook` response now returns:
- `combined.keys[]` — YYYY-MM axis for the combined view (paired with `months[]`)
- `tracks[].line[]` — per-track monthly revenue aligned to `combined.keys`
- `tracks[].ageYears` — years since first non-zero earning
- `tracks[].ttm` — sum in the trailing-12-months window from `combined.keys[last]`
- `tracks[].decayRate` — simple-average period-to-period decay
- `other.line[]`, `other.ageYears`, `other.ttm`, `other.decayRate` — same metrics for the OTHER bundle (sum for sparkline + ttm, simple avg for age + decay)
- `dollarAge` — catalog-level simple average of all per-track ages
- `tracksByPlatform[name]` — same `{tracks, other, dealLifetime, dollarAge}` shape, scoped per-platform with its own month axis

`/api/data/folders` summary endpoint adds `summary.trackCount`, `summary.top80Count`, `summary.dollarAge` (all computed via the same per-track extraction with aggregate filter + projection boundary applied).

### App-Wide Form Input Glass Schema

**Unified rule:** all form-entry text fields (text inputs, textareas, comboboxes, search inputs, rate inputs, checkboxes) use `background: rgba(255,255,255,0.18)` + `backdrop-filter: blur(20px) saturate(180%)` + `border: none` + `outline: none`. No focus rings. Padding/sizing per context.

Classes updated to comply:
- `.field-input` (RPAForm, OfferLetterForm, InvoiceForm)
- `.field-locked` (locked auto-calc variant — same glass + ink-light text)
- `.modal-input` (ImportModal)
- `.modal-search` (ImportModal search bar — borderless, sits directly on the modal's glass)
- `.line-items-count` (InvoiceForm counter)
- `.income-cell .rate-input` (OfferLetterForm Income Sharing Summary %)
- `.field-checkbox` + `.modal-table input[type="checkbox"]` — 15×15 glass squares, primary fill + white check on `:checked`, check centered via translate
- `.combo-dropdown` (InvoiceForm type-or-pick menu — matches `.combobox-menu` styling)

**Native `<select>` is forbidden** in form contexts. Replaced 3 in `ImportModal`, `OfferLetterForm`, `RPAForm` with `<Combobox className="combobox--form">`. Combobox got a new `combobox--form` variant — full-width filled-primary purple pill (inherits default trigger styling) with liquid-pill hover. Also applied to B2B Template combobox in `ValuationPage` and `AgreementsPage`.

**Combobox menu** — added `max-height: 320px` + `overflow-y: auto` so long lists scroll instead of clipping at viewport bottom.

**Selected row schema** (`.modal-table` in ImportModal) — converted from heavy fill to design-system pattern: left 3px primary bar (`inset 3px 0 0 0 var(--primary)`) + faint primary wash (`rgba(82,0,190,0.05)`).

**Dropdown buttons must show white font on purple, with white-bubble hover transition** — wired Combobox triggers into all four index.css liquid-pill selector groups + LIQUID_SELECTOR array in App.jsx + filled-primary text-flip group.

### Locked Valuation Page

**Locked Margin cell** keeps subtle 0.18-alpha glass (matches `.rate-input` editable state) — distinguishes it from the plain-text Advance/Rate cells which mirror the Initial Quote table. Other locked values (Advance, Recoup Rate) render as plain text.

**Top-level Margin and Commission rate inputs** stay editable even when recoup is locked — moved this out of `disabled={recoupLocked}` per user instruction: "broker / b2b margin is what you want to edit, not rthm margin".

**Per-term Margin column edit feature** added then reverted — user wanted only the broker/B2B margin rate (top-level), not per-term column editing.

### Pill Buttons + Tooltips + Misc Polish

**Pill button lowercase rule** documented in design_system.md — global `button { text-transform: lowercase }` enforced. Removed `text-transform: none` overrides from `.combobox.combobox--form .combobox-trigger` and `.modal-radio-btn` (the two violations from the user's screenshot).

**`.calc-tip` global tooltip** — added explicit `font-weight: 500`, `text-transform: none`, `letter-spacing: normal` overrides so tooltip text doesn't inherit parent's typography (chart titles are bold/uppercase). Widened `max-width: 280 → 360px`.

**Hover tooltip on "adjusted revenue" chart title** — explains the metric: "Reported revenue minus diligence adjustments. Removes non-recurring items (sync stripped, foreign catch-up bridges, layer adjustments, fee strip-outs) so the baseline reflects sustainable catalog earnings used for valuation."

**Tile pivot of Key Metrics card** — value-above-label, single horizontal row with `gridTemplateColumns: repeat(N, 1fr)`. Matches header-stats typography (18px primary purple value, 11px ink-light source-case label).

**Tracks table polish:**
- All numeric columns left-aligned (was right-aligned)
- Sparkline cell width 110px with padding-right 32px so the line doesn't crowd the next column
- Column reorder: `# | TRACK | SPARKLINE | % OF LTR | LIFETIME | TTM | DOLLAR AGE | DECAY RATE` (track name stays prominent in column 2)

**Tracks table headers** in Data Manager left-aligned with values, `white-space: nowrap` on all headers so "DOLLAR AGE" stays on one line.

### Sparkline Component

Extracted from inline `DataManagerPage.jsx` to shared `src/components/Sparkline.jsx`. Both Data Manager rows and Valuate Tracks table import it. CSS class renamed `data-manager-sparkline → sparkline-svg` (used in both pages).

### Color Exploration (REVERTED)

User asked about toning down `#5200BE` to a darker/cooler purple closer to the sidebar tone. Tested `#420099` (HSL 266°, 100%, 30%) — 61 replacements across 14 files (`#5200BE` → `#420099`, `rgba(82,0,190,…)` → `rgba(66,0,153,…)`). User: "nope it looks bad revert, we had the perfect color all along." Fully reverted; zero residual references to the new color.

---

## Current State

- **Working path**: `C:\Users\richa\RTHM Dropbox\RTHM Fund\RTHM\4. Operations\RTHM App\App Files`
- **Branch**: `master`, repo `https://github.com/RTHM-fund/RTHM-app`
- **App state**: Vite + Node server hot-reloading. Several backend changes this session — server restart required to clear summary caches + load new track-level outputs.
- **23 modified files + 1 new file** (`Sparkline.jsx`) staged for commit.

---

## What's Next

### V2 Royalty Projection + Advance-Calc Engine (stages 7-22)

Per the task spec re-confirmed this session, the projection + advance-calc engine is the next major build. Already-built foundation:
- Per-track `monthly: Map<YYYY-MM, value>` is computed for every track (= pivot input rows)
- Top-80% / OTHER split is running in `buildTracksOutput` (Stage 7 logic, but scoped to display)
- Per-platform track maps + combined map both available
- `firstKey`, lifetime, TTM, decay rate, dollar age per track

Not built — the actual engine:
- `server/data-manager/projections.js` (stages 7-11: rank/split, baseline, floor, decay, TOTAL)
- `server/data-manager/params.js` (stages 12-15: defaults / overrides / presets / resolve / validate)
- `server/data-manager/advance.js` (stages 16-22: scenarios, cashflow, advance solver, recoupment, IRR, req-months)
- `server/data-manager/xfin.js` (XNPV + XIRR primitives — hand-written, no deps)
- `server/data-manager/routes.js` (single endpoint returning the full `{projections, advance}` result)

**Process when starting** — per CLAUDE.md spec-first workflow:
1. Explain the full plan (module layout, function signatures, data flow, tests)
2. End with "understand?" and wait for "go"
3. Build stage-by-stage with sanity tests A-E after each

### Known Open Issues / Flags
- **Too $hort** Track Rep sheet has asset codes ("Z0089") in col 0 and descriptions in col 1 — neither contains actual song titles. Workbook content issue, not app. Needs diligence re-run with track titles populated.
- **Lomeli** workbook contains projection data through 2038. App now correctly cuts off at the projection boundary, but the projection rows in the workbook itself violate "diligence is 100% historical" data-integrity rule. Flagged for diligence-skill cleanup.
- **Barretta** workbook is in Colombian Pesos (COP) — app displays raw numbers regardless of currency per user directive ("currency-agnostic, value in, value out").
- **Hirschmann** workbook uses non-standard sheet names + filename — handled via fallback resolvers and extended regex. Real catalog (7K+ sync cues) so the absurdly high track count is correct, not a bug.
