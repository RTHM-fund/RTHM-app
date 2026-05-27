# Claude Progress — Session Save

Massive session — Valuate page expansion + Data Manager v2 inline summaries + modal cutout architecture + Combobox component + diligence-skill spawn diagnostic + dozens of glass/border/alpha refinements.

---

## Accomplished This Session

### Valuate Page

**Custom chart tooltip** with combined breakdown — for the Combined view, the tooltip now shows `total: $X` + per-platform `jive: $A`, `umpg: $B`, etc. Single-platform views just show `total: $X`. Months aligned across platforms via client-side `monthKey()` mirror of the server's parser.

**Key metrics card** added below the existing chart cards. Rows: `Lifetime (window) — Combined`, `TTM (window) — Combined` (always both shown when ≥12 months, else falls back to Lifetime), per-platform `% of Lifetime (net paid)` (originally `% of LTV` — reverted because LTV means Loan-to-Value in catalog finance; reserving the acronym for the future advance/IRR section). Shares always total 100%.

**$ removed everywhere** on Valuate — `fmtCurrency` drops the currency symbol; just comma-separated integers.

**Chart titles renamed** + center-aligned: `tracks` → `total revenue`, `track adjusted` → `adjusted revenue`. `key metrics` heading also centered (same `.valuate-chart-title` class).

**Tracks list card** (below the adjusted-revenue chart) — top-80% individual rows + `OTHER (N tracks)` bundle. Columns: `# | track | lifetime | % of LTV`. Server-side per-track aggregation on the "net paid where distinct" basis (only Track sheets, not Brkdn). Comprehensive aggregate-row filter (catches `Grand Total (Gross Royalty)`, `Reported Total`, `Adjusted Total`, `Bridge`, `Less:`, `Layer N — Stripped`, `Net Payable`, `Memo`, `Source field:`, `Statement PDF total`, `Reserve Account Release`, `(a)/(b)/(c)` lettered prefixes). Verified across all current deal workbooks: 47/47 aggregates filtered, 0/57 real tracks falsely caught.

**Empty chart frames suppressed** — chart cards only render when their data series has ≥1 point. No more hollow axis frames when a deal's diligence is incomplete.

**Focus outlines killed** on chart SVG (the dark frame that appeared on click).

**Header stats block** (left of title-block, centered between title and toggle then locked at page horizontal midpoint via `position: absolute; left: 50%`): two mini stat-tiles for `STATEMENTS` (count) + `CYCLE` (monthly / quarterly / semi-annual / annual / mixed). Value 15px primary, label 10px uppercase ink-light. Dynamic per platform toggle — selecting BMI Dom shows just BMI Dom's count + cadence.

**Statement count = actual source files**, not period count. Server scans the deal folder and attributes each statement file to the platform whose name appears in its relative path. Comprehensive rule set:
- Tokenized + aliased platform matching (`DOM ↔ Domestic`, `INTL ↔ International`, `PUB ↔ Publishing`, `MECH ↔ Mechanical`, `PERF ↔ Performance`). Single-substring matching missed Scott Storch's `ASCAP DOM` ↔ `ASCAP/01_12_2026 - Domestic.csv` case.
- CSV+PDF basename dedup (Scott Storch's ASCAP CSV+PDF pairs count as 1 statement, not 2).
- Single-platform deals allow depth-0 files (Starz Lil D's lone `royalties_detailed.csv` at the deal root).
- Multi-platform deals skip depth-0 (Too $hort's `Earnings Summary - Jive + UMPG.xlsx` filtered).
- Filename keyword filter: `quote / merged / consolidated / agreement / agenda / contract` always skip; `summary` only when no period marker (year / 1H/2H / Q1-Q4 / month name) — preserves UMPG's `Financial Summary 1H2023.pdf` while still rejecting `LOMELI TuneCore Summary.xlsx`.
- File extensions accepted: `.csv .tsv .pdf .xls .xlsx .xlsm .txt` (also added to `/diligence` skill's `SKILL.md`).
- **Integrity gate**: platform with revenue but 0 attributed files → `statementsCount: null`, frontend renders `?` with hover-tooltip explanation. Never a silent 0 when data exists.

**CAGR removed** from key metrics (`455.81%` on partial-year data was clearly broken; reserved for future advance/IRR work where it can be done correctly).

### Data Manager

**Three new columns** between Folder Name and Diligence: blank-header sparkline (SVG line shape only, no axes/labels/dots), `Lifetime`, `TTM`. Sparkline uses combined-revenue line (adjusted if distinct from rep, else rep — mirrors Valuate's auto-choose). Inline server computation via new `computeWorkbookSummary(folder)` helper called from `/api/data/folders`. Folders without diligence get `summary: null` → cells render `—`.

**Column widths tuned** so columns pack left next to the folder name + trailing column absorbs slack on the right. Folder name explicitly 280px (= 240px inner truncate + 40px padding) — matches Deal Manager's first-column visual exactly. Inputs/sparkline/lifetime/TTM/diligence/valuation/extract all tightened.

**Folder name truncation** — matches Deal Manager's pattern (`max-width: 240px` + right-edge mask-image fade) so long names taper rather than push the table.

**Action button disabled states** based on column completion: Diligence button disabled when `hasDiligence`, Valuate when `hasDeal`, Extract when `hasExtract`. All three disabled when no folder selected. Disabled rest state uses design-system "transparent-tinted purple" convention.

**QUOTE → VALUATION** column header rename.

**Stale-skill detection** in `/api/data/folders`. Per-folder, per-skill: if the most recent log file is empty + > 10 min old OR > 1 hr old regardless of size → marked stale → frontend's `clearCompletedSkills` reconciler auto-clears the spinner from localStorage. No more permanent spinners on dead diligence runs.

### Diligence Skill / Subprocess

**`SKILL.md` updated** to enumerate `CSV / TSV / XLS / XLSX / XLSM / PDF / TXT` in the description tag, Phase 2A cross-check, and failure-handling rule. So the skill's classifier sees all supported formats.

**Spawn diagnostic fix landed** in `/api/data/run-skill` — but NOT YET VERIFIED. Changes:
- Dropped `detached: true` (subprocess stays tied to server; server is long-running anyway)
- Switched `stdio` from raw fd inheritance to piped streams (`['ignore', 'pipe', 'pipe']` + `.pipe(createWriteStream)`) — Windows + detached + fd inheritance was silently dropping output
- Added `proc.on('exit')` handler that appends `[spawn] exit code=N signal=S` to log
- Added `proc.on('error')` handler for spawn failures
- Added `.spawn-debug.json` sidecar written BEFORE spawn (resolved bin + args + cwd + env keys)

Issue saved as `memory/diligence_spawn_dying_issue.md`. Next session: restart server, trigger diligence on Victor Thell, check for `[spawn] exit code=...` line + `.spawn-debug.json` to know exactly what fails.

### Modal Cutout Architecture

**Replaced 2-layer dim+blur with 1-layer cutout** approach across all modals. `.modal-overlay` is now a transparent click-trap (no `background`, no `backdrop-filter`). `.modal` panel drops to chart-card glass (`rgba(255,255,255,0.45)` + `blur(20px) saturate(180%)`) and casts its own dim via massive box-shadow spread (`0 0 0 100vmax rgba(0,0,0,0.35)`). The modal area becomes a clean hole in the dim — its transparency now reveals the real aurora blurred behind it, not a dimmed plane. Resolves the "modal looks muddy" problem.

Audited all six modal call sites (`ImportModal`, `OfferLetterForm` Select Row, `ValuationPage` Create Deal Sheets, `AgreementsPage` Select Type / Create Deal Sheets B2B / Partner Info). All sub-variants (`.deal-sheet-modal`, `.deal-sheet-table-modal`, `.agreements-type-modal`, `.partner-modal`) only override `width` — cutout flows through automatically.

**No-white-inside-modals**: all `.modal-search` / `.modal-input` / `select.modal-input` backgrounds set to `transparent`. The 0.45-alpha modal panel shows through directly. Border still defines the input region.

**All horizontal lines removed** from modals: `.modal-header` bottom, `.modal-search-wrap` bottom, `.modal-table th` bottom, `.modal-table td` bottom (row dividers), `.modal-footer` top.

### Combobox Component

**New reusable component** at `src/components/Combobox.jsx` + `.css`. Replaces native `<select className="modal-input">` because the OPENED dropdown menu of a native `<select>` is OS-rendered solid white and can't be styled with CSS.

Used in two places: `ValuationPage`'s Create Deal Sheets B2B template picker + `AgreementsPage`'s Create Deal Sheets B2B template picker. Other native selects in `ImportModal` (royaltyType / dealType) NOT swapped — wasn't requested.

**Trigger** = filled-primary pill (purple bg, white text, chevron via inline SVG with `currentColor` so it animates with the text-flip). Wired into all four `index.css` liquid-pill selector groups (base position rule, `::before` bubble rule, `> span` text-transition rule, filled-primary `:hover > span` color rule) + `LIQUID_SELECTOR` array in `App.jsx`.

**Stays-open state** — `.combobox.open .combobox-trigger::before` matches the hover `:hover::before` bubble-expansion rule + `.combobox.open .combobox-trigger > span` matches the filled-primary hover text-flip. So when the dropdown is open, trigger holds the white-bubble + primary-text + glow visual. Chevron also rotates 180° via `.combobox.open .combobox-chevron`.

**Dropdown menu portaled** to `document.body` via `createPortal`. Position fixed using the trigger's `getBoundingClientRect()`. Necessary because the parent modal has `overflow: hidden` (for rounded corners) + `backdrop-filter` (creates a containing block that traps even `position: fixed` children). Click-outside handler exempts both the combobox root AND the portaled menu.

**Field centering** — `.modal-field:has(.combobox)` centers the label + trigger horizontally in the modal.

### Valuation Page (rate-input cleanup)

- **Borders removed** from `.rate-input` (purple borders + focus-color flip both gone)
- **Editable rate-input alpha** dropped from 0.45 → 0.18 (subtle glass; user said 0.45 read as "white pill")
- **`.rate-locked` (locked recoup display)** restyled as a glass pill matching the valuation table headers — `rgba(255,255,255,0.45)` + `blur(20px) saturate(180%)` + 4px radius + 4px 8px padding. Both the recoup-rate column locked span AND the advance column locked span (`<span className="calc-tip">` got `rate-locked` added). Previously the locked state showed plain text with no background, "straight up purple" through the lavender.

### Data Integrity Core Rule

**Added to CLAUDE.md** as a top-level CORE RULE. Two sacred layers: (1) source data files, (2) diligence workbooks — must be 100% accurate from source. All math must be financially perfect, no mistakes. Includes specific examples (e.g., `slice(-12)`-counts-entries-not-months bug that caused TTM=Lifetime on semi-annual deals). Saved as `memory/data_integrity_core.md` for future-session persistence.

---

## Current State

- **Working path**: `C:\Users\richa\RTHM Dropbox\RTHM Fund\RTHM\4. Operations\RTHM App\App Files`
- **Branch**: `master`, repo `https://github.com/RTHM-fund/RTHM-app`
- **App state**: Vite + Node server hot-reloading cleanly. UI changes live via HMR.
- **Server restart needed** for: per-track extraction, source-file statement scanner, sparkline/Lifetime/TTM summary, stale-skill detection, diligence spawn diagnostic, all the route + helper additions.
- **Diligence spawn fix not yet verified** — first re-trigger after server restart will show whether it actually runs to completion (look for `[spawn] exit code=...` in log + `.spawn-debug.json` sidecar).

---

## What's Next

### v2 spec — projection + advance/IRR engine
Full spec already provided in earlier task message — stages 7-22, server-side only, pure functions. Modules outlined:
- `server/data-manager/projections.js` (stages 7–11: rank/split, baseline, floor, decay, TOTAL)
- `server/data-manager/params.js` (defaults / overrides / presets / resolve)
- `server/data-manager/advance.js` (stages 16–22: scenarios, cashflow, solver, recoupment, IRR, req-months)
- `server/data-manager/xfin.js` (XNPV + XIRR primitives, by hand)
- `server/data-manager/routes.js` (single endpoint)

UX design already in progress per user message:
- Portfolio inputs + "set parameters" pill below charts
- Projections toggle pill in same band
- Tracks list (top-80% + OTHER) drives drill-down: click track → graphs swap to single-track context
- Per-track parameter overrides starting from portfolio defaults
- Save individually + group-apply to TOTAL projection + advance calc

### Known open issues
- **Diligence subprocess silent death** — fix applied, not verified. See `memory/diligence_spawn_dying_issue.md`. Reproducible across multiple deals before fix; verify with Victor Thell after server restart.
- **Native `<select>` in `ImportModal`** (royaltyType, dealType) — still has OS-rendered solid-white dropdown menu. Combobox component exists; swap is a 3-line change per call site if/when desired.
- **Linux fallback** for `findClaudeBin()` still PATH-only.
- **No concurrency cap** on skill runs.

### Design follow-ups (if needed)
- `LTV` term reserved for Loan-to-Value future use — when advance/IRR scenarios land, that's where the acronym lives.
- `design_system.md` doc still references the old 2-layer modal architecture in places — cleanup pass deferred until everything else stabilizes.
