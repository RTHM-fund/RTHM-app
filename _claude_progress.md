# Claude Progress — Session Save

Massive session — built the entire V2 royalty pipeline (PROJECT + QUOTE end-to-end), ran a 134-agent comprehensive audit, applied 6 audit-driven fixes, then a wave of UI polish on the Valuate-page modals and a universal portal-tooltip design rule.

---

## Accomplished This Session

### V2 Royalty Pipeline — full build (Stages A → D)

**Stage A — `RAS Quote_Template.xlsx`** at `server/templates/`:
- 8 scenarios (18m / 24m / 36m / 48m / 60m / 84m / 144m / Req)
- Parameterized stepping via `$B$8` so the same template works monthly / quarterly / semi-annual
- Inputs block (rows 1–9), scenario summary (rows 11–19, cols A–I), cashflow strip (cols K–HC = 200 periods)
- Live LET + XNPV / XIRR / MAP / SEQUENCE formulas; Req solver SEQUENCE(200,1) matching spec
- L11 period-label LET anchors on `$B$6` (not `$B$7`) so headers match the lookup dates beneath them
- Generated via `build_quote_template.py` (in user's Temp folder)

**Stage B — V2 server engine** at `server/data-manager/`:
- `xfin.js` — XNPV (Actual/365), XIRR (Newton-Raphson seeded 0.1 with bisection fallback on [-0.999, 100])
- `params.js` — `PORTFOLIO_DEFAULTS` (frozen), `PRESETS` (EVERGREEN + HIP_HOP), `resolveParams` with `_provenance` audit trail, `validateParams` with locked ranges
- `projections.js` — stages 7–11 (rank+split @ 80% / baseline blend / floor / 90-month decay / TOTAL row). `projectDecay` and `buildProjections` accept optional `customProjPeriods` for the preview UI
- `advance.js` — stages 16–22 (8 scenarios, closed-form advance solver via XNPV, recoupment, IRR, 200-period Req solver). Uses `Number.isFinite` ternaries for default fallback (audit fix)
- `pivot.js` — workbook → engine pivot with three legacy parity rules ported byte-for-byte from `index.js`: swapped-column track-label heuristic (BMI Work IDs), adj-vs-rep compare-then-pick, zero-cell `allKeys.add` skip. Audit `_meta.droppedCells` trail
- `routes.js` — POST `/quote-engine` (pure math), `/quote/preview` (lean scenarios for live UI), `/quote/export` (full Excel pipeline), `/projection-preview` (canonical TOTAL projection for catalog graphs)
- `_tests.js` — 30/30 PS sanity tests passing throughout the session

**Stage C — `quote.py`** at `1. RTHM Fund/1. Data/.claude/skills/quote/`:
- Copies diligence workbook → `<deal folder>/<deal> - Quote.xlsx` (overwrites; original never touched)
- Appends `Projections` sheet (engine TOTAL row, Date | $Value | YYYY-MM key, + metadata block)
- Appends `Quote` sheet by cell-by-cell copy from the template (preserves formulas, formats, fills, freeze panes)
- Est. Payment row 13 cols L+ filled with live `INDEX/MATCH` against `Projections!C` (YYYY-MM key column) — keeps Excel-side recalc working
- `STRIP_PERIODS = 200` matching the template width
- `SKILL.md` doc explaining it's invoked directly via Node spawn (no Claude CLI in the loop — work is deterministic)

**Stage D — UI**:
- `QuoteModal.jsx` + `QuoteModal.css` — mirrors ProjectionModal exactly (1000px, X top-right, close/save footer). Body has a scenario table (8 cols × 7 metric rows) at top, advance-inputs form (2 col × 3 row) below
- 6 input fields: investment date, 1st royalty payment, target IRR, referral %, other fees, req advance
- Debounced 300ms POST to `/quote/preview` on every input change → table recalculates live
- Save button POSTs to `/quote/export` → writes `<deal> - Quote.xlsx` into the deal folder. Disabled until inputs ready; "saving..." state while in flight
- Quote button on ValuatePage wired with `is-open` class + outside-click exemption

### Comprehensive Audit (134 agents, 42 verified findings)
Ran a 12-dimension workflow audit covering xfin, every PS-spec stage, params, pivot, both modals, the template + `quote.py`, the Valuate page reader, master.xlsm parity, and end-to-end provenance. Each finding was adversarially refuted by an independent verifier.
- **Verdict**: math kernel is solid; 5 critical fixes applied (below); audit report saved to `/tmp` task output.

### 6 Audit Fixes Applied
- **Fix A — template**: SEQUENCE(150)→(200), L11 anchor `$B$7`→`$B$6`, widen strip 150→200, `quote.py` `STRIP_PERIODS` to 200
- **Fix B — QuoteModal Periods cell**: `Math.ceil(months / stepMonths)` instead of `Math.ceil(months)` (was wrong by stepMonths factor on non-monthly cadence). Also switched Advance/Recoup row to use server-canonical `recoupMultiple`
- **Fix C — pivot parser**: ported 3 legacy rules from `index.js` (swapped-column heuristic, adj-vs-rep compare-then-pick, zero-cell skip)
- **Fix D — `/projection-preview` endpoint + ProjectionModal catalog wiring**: catalog graphs (`chart:total`, `chart:adjusted`) now fetch canonical per-track-summed TOTAL from server instead of running client decay on already-summed historical (mathematically wrong). Track graphs unchanged (client-side compute is correct for single-track decay)
- **Fix E — defense-in-depth**: `buildAdvance` uses `Number.isFinite()` guards instead of `??` (catches NaN / Infinity / strings). Bare `catch {}` blocks replaced with logged warnings (`routes.js`, `index.js` workbook-resolve/summary)
- **Fix F — spec doc**: `v2_specs.md` decay formula corrected (`k(p) = k_inf + (k0 - k_inf) × exp(-gamma × stepMonths × (p-1))`), clarified "90-month horizon" wording

### UI / UX Polish (Valuate-page modals)
- **Search bars** (Deal Manager + Data Manager): right-justified, magnifying-glass icon at calc(50% + 2px), `field-sizing: content` for grow-from-button, locked color + sizing tokens
- **Quote modal `PMNT` → `PAYMENT`** label
- **Table column 1 labels Title Case + `IRR` all caps**; removed lowercase text-transform
- **Selection rule**: if Adjusted Revenue chart exists, Total Revenue card stays visible but is NOT selectable. If only Total exists, it IS selectable. Locked via `totalSelectable = adjMatchesRep || tracksAdjRows.length === 0`
- **Leading-zero strip** on every numeric input in both modals (`cleanNumeric`)
- **Max-threshold clamp** on 7 bounded fields (k0/k_inf/gamma/floor%/haircut/target IRR/referral %) — keystrokes that would exceed max are silently rejected
- **Zero-prefix lock** on 5 fields where `max < 1` (k0/k_inf/floor%/haircut/referral %): once user types, `"0."` is always present; can clear back to empty via select-all + delete
- **Comma formatting** on ALL numeric inputs across ProjectionModal / QuoteModal / ValuationPage: state stays raw digits, `withCommas()` wraps display value. No-op when whole < 1000
- **Arrow key step** on the 7 sub-1-step fields: ↑/↓ adds/subtracts the field's step value, clamps to [0, max], strips trailing zeros, re-applies zero-prefix for locked fields
- **Quote modal Save button** wired to `/quote/export` (was disabled — backend now hooked)
- **Portal-rendered chart tooltips** (universal design rule): both ProjectionModal and ValuatePage charts now use `createPortal` to `document.body` with `position: fixed`, computed from chart container's `getBoundingClientRect() + coordinate`. `wrapperStyle: { display: 'none' }` hides recharts' own wrapper. Solves clipping + the modal-widening scrollbar bug

### Design System updates
- `docs/design_system.md`: new **Search Bars** section, **Tooltips section rewritten** with locked portal rule + reference implementation. No-clipping rule expanded to mandate `pointer-events: none`, `z-index ≥ 10000`, no layout side-effects

---

## Current State

- **Working path**: `C:\Users\richa\RTHM Dropbox\RTHM Fund\RTHM\4. Operations\RTHM App\App Files`
- **Branch**: `master`
- **Server status**: requires restart — new endpoints (`/api/data-manager/quote/preview`, `/quote/export`, `/projection-preview`) won't load via Vite HMR
- **Engine tests**: 30/30 passing throughout the session
- **Audit verdict**: math kernel sound; critical fixes applied; engine is production-ready

### Files modified / created this session
**New**:
- `server/data-manager/{xfin,params,projections,advance,pivot,routes,_tests}.js`
- `server/templates/RAS Quote_Template.xlsx`
- `src/components/QuoteModal.jsx`, `QuoteModal.css`
- `<Data>/.claude/skills/quote/quote.py`, `SKILL.md`

**Modified**:
- `server/index.js` (mounted `/api/data-manager` router, logged catch blocks, raised body limit)
- `src/components/ProjectionModal.jsx` (catalog server-preview, portal tooltip, numeric input UX, arrow steps)
- `src/components/ValuatePage.jsx` (Quote button wiring, selection rule, portal tooltips)
- `src/components/ValuatePage.css` (`.is-open` for quote button, comma helpers, portal handling)
- `src/components/ValuationPage.jsx` (comma formatting on advance / rate / margin inputs)
- `src/components/DealsPage.jsx`, `DealsPage.css` (search bar)
- `src/components/DataManagerPage.jsx`, `DataManagerPage.css` (search bar)
- `src/components/ImportModal.jsx`, `ImportModal.css` (search-bar polish)
- `docs/design_system.md` (Search Bars + Tooltips sections)
- `docs/v2_specs.md` (decay formula doc fix)

---

## What's Next

### Audit follow-ups (deferred — low/medium severity)
- `xfin.js` `toDay()` timezone-safety hardening (dormant — no callers trigger today)
- Newton-Raphson tight-loop break when residual fails (perf only)
- Stage-22 no-solution branch: cleaner `null`-on-failure for `recoupment` + `recoupMultiple` (UX clarity in QuoteModal Req column)
- `pivot.js` parses Excel-native Date headers in local timezone — convert to UTC (`getUTCFullYear`/`getUTCMonth`)
- `detectStepMonths` flag mixed-cadence catalogs (semi-annual + monthly mix)
- Extend `_tests.js` Test F to loop over `[1, 3, 6]` step sizes
- Master `.xlsm` bugs flagged for user to fix in Excel: `W20` references wrong columns (T/U instead of W/X); VBA `CreateOrRefreshPortfolioDefaults` writes wrong defaults

### Possible UI follow-ups
- Saved-projection indicator on graphs (user tried Pattern A — small dot — didn't like it; abandoned)
- `.calc-tip` form/table tooltips could optionally adopt the same portal pattern for symmetry (chart tooltips are now portal-rendered; CSS-pseudo-element tooltips still use their existing positioning)
