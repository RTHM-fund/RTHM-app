# Claude Progress — Session Save (2026-06-02, UI polish pass: sub-table header schema, sparkline/orb tuning, invoice + quote fixes, diligence-status fix)

## ✅ Accomplished this session

### Table header typography — two schemas (LOCKED in design_system.md)
- **Sub-table header schema:** `11px / 700 / 0.05em / uppercase`. **Color flips by background:** white header bar → `--ink-light` (grey); transparent header → `--ink`. Applied to: Quote (`.quote-table`), Agreements, Valuation (grey, white bars); Tracks (`.valuate-tracks-table`), Import "select rows" base (`.modal-table th`) (ink, transparent). Deal-sheet modal re-adds grey over the base (it has a white bar).
- **Form input-grids are NOT sub-tables:** Offer-Letter income split (`.income-table th`) + Invoice line-items (`.line-item-header`) use a separate `10px / 700 / 0.04em` field-label style (they match each other). Documented as an exception.
- **Main tables** (Deal Manager `.deals-table th`, Data Manager `.data-manager-table th`) keep their own schema; bumped letter-spacing `0.06em → 0.07em` (per request). Never use the sub-table schema on these.
- Form field labels confirmed: `12px / 600 / 0.03em`, same font family (Montserrat) as everything.

### Glass header purple-fringe fix
- Modal white-glass table headers (`.quote-table thead th`, `.deal-sheet-table-modal …thead th`) switched from translucent `backdrop-filter` glass to **flat `rgba(255,255,255,0.55)`** — kills the saturated-edge purple hairline. Locked in design_system.md.

### Template sidebar order
- `server/index.js` `/api/templates`: RTHM template pinned to top of **Deal Sheets** + **Offer Letters** (was dead `orders` map). RPAs/Invoices alphabetical (unchanged).

### Quote modal
- Inline Advance editor (Alt+click): now **inherits the cell's exact look** (was purple/bold) and **formats with commas** live; `size={1}` + `min-width:0` stops it widening its column (fade mask on overflow).
- ROYALTY TYPE combobox: locked to **fixed 150px** (widest option "distribution") so button + menu don't resize; label+chevron **centered**.
- Combobox: removed the **selected-row indicator** app-wide (hover only); `fitMenu` experiment added then reverted.

### Combobox deal pickers (Offer-Letter + RPA)
- Fixed string/number `value` mismatch so the trigger **shows the selected deal name**; added `combobox--preserve-case` so deal names keep their case.

### Cashflow waterfall (Quote export)
- Deleted 1 empty row on sheet 2 of `server/templates/RAS Quote_Template.xlsx` (title now has 1 blank row under it); set row 11 (table header) height to **31pt**; Quote sheet verified untouched. Backup: `Backups/RAS Quote_Template.BEFORE-cashflow-row-delete.xlsx`.
- `quote.py` (`…/1. Data/.claude/skills/quote/quote.py`): decremented all sheet-2 row refs by 1. Verified **end-to-end** (ran quote.py → values land in correct cells, 0 formulas with 8 scenarios).

### Invoice form
- Line-items rows now align right-edge with the form fields: the AMOUNT input was wrapped in a `.calc-tip` div and overflowed — fixed with `.line-item-row > div .field-input { width:100% }`.
- **Removed the Total row** (markup + CSS) per request; **kept** the `totalAmount` calc (still fills `Total Amount` in the exported invoice .docx).

### Date input placeholder (app-wide)
- Native `mm/dd/yyyy` placeholder now grey. The aria-valuenow CSS trick is **invalid in Chrome 146** (dropped); used a value-driven `.date-empty` class + `input[type="date"].date-empty::-webkit-datetime-edit { color: var(--ink-light) }`. Applied to all 4 date inputs (Invoice, Quote, Offer-Letter, RPA). Documented.

### Sparklines
- `Sparkline.jsx`: split pad into `padX:0` / `padY:2` so the visible line reaches the cell edge → gap to next column = the table's inter-column spacing (**Data Manager 40px, Tracks 24px**), both sides. Removed dead `.valuate-tracks-spark` 8/32 padding. Deleted orphaned `ValuatePage.css.tmp.*`.

### Aurora orbs (toned down)
- `App.jsx`: rest opacity **0.40 → 0.24**; convergence fade **0.3 → 0.55** (clustered orbs ≈0.11, no dark blob); breath rebased to **scale [0.7, 0.9]** (was [0.7, 1.3]). Color/blur unchanged. Research-informed (ambient bg should be soft; motion signals responsiveness, not darkness).

### Data Manager — Diligence ✓ status fix
- **Root cause:** `hasDiligence` was `summary != null` — tied to the app PARSING the workbook, not it existing. 3 folders done via the skill directly (`diedlonely`, `Super Miles`, `Teddi Gold`) use sheet-naming variants the summary parser can't read → wrongly showed "?".
- **Fix:** added `diligenceWorkbookExists()` (fresh `fs` check each request) and set `hasDiligence` from workbook existence. ✓ now reflects disk on every page load. Empty `_Due Diligence` folders (Narvent/Romano/WeAreRGM) still correctly "?".

## Current state
- Front-end builds clean via HMR, no console errors. CSS verified via computed-style probes (the preview runs as a background tab, so `requestAnimationFrame` is paused and screenshots wedge — orb animation + some modals couldn't be screenshot-verified, only measured/inspected).

## ⏭️ Next / open tasks
1. **Restart the node API server (port 3001)** — required for the Diligence-✓ fix AND the template sidebar reorder to take effect (plain `node server/index.js`, no auto-restart). `quote.py` is spawned per-export, no restart needed.
2. **Diligence data columns** (sparkline/Lifetime/TTM/etc.) for `diedlonely`, `Super Miles`, `Teddi Gold` still show "—" — their workbooks use sheet-naming the summary parser doesn't handle (`Trk`/`Bkd`/`Brk` abbreviations; Super Miles fails deeper). Optional follow-up: extend the parser (data-integrity sensitive).
3. **Eyeball the orbs** in a real (foreground) browser — values are research-informed but not visually confirmed here; easy to nudge opacity/fade/breath.

## Files touched
- `src/App.jsx`, `src/index.css`, `src/components/Sparkline.jsx`
- `src/components/QuoteModal.{jsx,css}`, `Combobox.{jsx,css}`, `ImportModal.{jsx,css}`, `OfferLetterForm.{jsx,css}`, `RPAForm.jsx`, `InvoiceForm.{jsx,css}`, `ValuatePage.css`, `ValuationPage.css`, `AgreementsPage.css`, `DealsPage.css`, `DataManagerPage.css`
- `server/index.js`, `server/templates/RAS Quote_Template.xlsx`
- `docs/design_system.md`
- deleted `src/components/ValuatePage.css.tmp.16112.c632c8f76def`
- (outside App Files repo) `…/1. Data/.claude/skills/quote/quote.py`
