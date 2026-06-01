# Claude Progress — Session Save (2026-05-31, Deal Manager sheet remap + Mac parity setup + Quote export work + orb recovery)

## Accomplished — Deal Manager Google Sheet remap (columns shifted)
The "Deals" sheet (`SPREADSHEET_ID 1tCKpr…IIsk`, gid 944936958, tab "Deals") was restructured; repointed the app to the correct columns. Header row is still 7 (data row 8+).
- **Initial Quote** ← group header **"Initial quotes, net of 3% fee"** = cols **AP–AW** (4 terms 12/36/60/84) — was gross `AC–AJ`. **NET** (~3% lower), user-confirmed.
- **Variable Quote** ← **"Variable quotes"** = cols **BC–BJ** — was `AR–AY`.
- **Percent %** ← **BA** — was `AN` (AN is now "Acquisition").
- Fetch **range `A7:BL`** (was `A7:AY`; the Variable block sits past the old AY cutoff).
- **144-month bucket dropped** — app keeps its 4 terms, as before (only a few deals have 144).
- Edits: `server/index.js` (`IQ_COLS`/`VQ_COLS`/`IQ_PAIRS`/`VQ_PAIRS`/`WANTED_COLS`, percent `AN→BA`, range) + `src/components/ValuationPage.jsx` (`IQ_PAIRS`/`VQ_PAIRS`). Keys aligned server ↔ frontend ↔ docx-gen.
- **Verified vs live sheet:** Lomeli → IQ-net `59,946…`, VQ `53,951…`, percent `90%`, VQ÷IQ-net = `0.900` (= the 90%); LeTreez → IQ-net only, no VQ. Diff scope: index.js 7 lines / ValuationPage 2 lines; `node --check` clean.

## Accomplished — Cross-platform (Mac) parity audit + setup fix
Read-only audit of Windows-vs-Mac parity, then a **setup-script-only** fix (no app / `quote.py` change).
- **Verdict:** ~95% Mac-ready by design — `findDropboxRTHM()` discovers the Dropbox root dynamically (no hardcoded drive); `openFile` (explorer/open) + folder picker (powershell/osascript) are platform-branched; `getLibreOfficeBin()` + `findClaudeBin()` include Mac/Unix paths; folder selections stored relative; Mac launchers exist and are LF-safe.
- **The one gap:** the Quote export spawns `python3 quote.py` (imports openpyxl) **directly** (not via Claude). **Neither** `RTHM Setup.command` nor `RTHM Setup.bat` installed Python/openpyxl — it worked on the dev PC only because they're ambiently present; a fresh Mac would 500 on Quote export. (`quote.py` is the only hard Python dep — diligence/extract/aggregate run through the Claude CLI.)
- **Fix (setup scripts only):**
  - `RTHM Setup.command` (Mac): new step **[3/5]** — brew-installs python3 if missing, then ensures openpyxl with a PEP-668-aware fallback (`--user` → `--break-system-packages`), and verifies `import openpyxl`. LF + shebang preserved.
  - `RTHM Setup.bat` (Windows): mirror step **[3/4]** — winget python if missing + pip openpyxl; **leads with the import check** so an already-equipped PC installs nothing. LF + ASCII preserved (this `.bat` is LF on disk and works that way).
- **Distribution:** both launchers sit ABOVE `App Files` and are **NOT git-tracked** — they reach machines via **Dropbox sync** (bytes preserved, stays LF). So commits carry only the session log; the script fixes propagate via Dropbox.
- **Untouched (exact):** all app code, `quote.py`, `RTHM Launch.command`/`.bat`. Windows + app functionality/design unchanged.

## Accomplished — Quote export formatting (template `RAS Quote_Template.xlsx`)
All edits via openpyxl (`data_only=False`); each audited original-vs-git as isolated change-sets (no collateral to values/formulas/fonts/fills/borders/freeze/merges/structure):
- **G7** (Cashflow sheet): `RAS Origination fees` → `RAS origination fees` (lowercased "Origination"; RAS kept as acronym — matches the other Deal-terms labels).
- **Quote sheet right-alignment:** everything right of the `L11` freeze line — cols **L→HC, rows 11–14** (period header / date / payment / cumulative) → `horizontal='right'` (800 cells). K (frozen labels) left as-is.
- **Cashflow sheet widths:** cols **L, M** → stored `10.07421875` (displayed 9.36 = **110 px**) via the MDW+0.714 method.
- **Quote `L13`/`L14` number format** → `#,##0;(#,##0);"-"` (dropped the accounting `_)` right-padding so forecast values sit flush-right like the dates).

### How the Quote export works (traced this session)
- `routes.js` (`/export`) spawns **`quote.py`** (generator, outside repo at `RTHM/1. RTHM Fund/1. Data/.claude/skills/quote/quote.py`) with the template + engine/inputs; it loads `RAS Quote_Template.xlsx` and fills static values.
- **Forecasted Cash strip:** `quote.py` copies **column L's** full style (font/fill/alignment/border/**number_format**) + width as the prototype and propagates it to **every** projection column. ⇒ Fix **template column L** (L11–L14) to change the whole strip — code-free. (Confirmed on existing AJ McQueen quote: M/N carry L's format.)
- **Catalog projection graph = per-track decay → then summed** (server `/projection-preview` → `buildProjections`). A **saved** per-track override (`<deal>_Projection.json` → `trackOverrides`) flows into the catalog total's **projection line AND decay curve** (both are sums of per-track curves). Track graphs = client single-track decay; catalog = server per-track-then-sum (deliberate audit fix).

## Accomplished — Quote export header title-casing (template)
- Title-cased 7 header cells in `server/templates/RAS Quote_Template.xlsx` (**IRR** kept uppercase):
  - `Quote!A11` → Scenario Summary · `Quote!K11` → Forecasted Cash
  - `Cashflow waterfall (12 year)`: G12 Loan Principal Brought Forward · J12 Principal Repaid · K12 Loan Principal Carried Forward · L12 Free Cash Flow · M12 Gross IRR Flows
- **Casing only** — Aptos Narrow typeface unchanged. Reverses the prior deliberate lowercasing of L12/M12.
- **Scope: template only** — already-exported `… - Quote.xlsx` files keep old headers until regenerated.
- Edited via openpyxl (`data_only=False` to preserve formulas). Audited original-vs-git: **exactly 7 cells changed**; all 659 formulas, cell styles, column widths, merged ranges, and sheet structure byte-faithful to the original.

## Accomplished — Aurora orb final tuning
Tuned the aurora orb background (`src/App.jsx`) to its final locked feel:
- **LOCKED physics:** breath `0.3`, speed `3.0`, wanderSpeed `7.0`, wander `7.0`, converge `150`, repel `5.0`, velocity `0.1`, spacing `0.20`.
- **Rest opacity** `0.30 → 0.40` (all 3 orbs).
- **Repel always-on** — removed the `* (1 - activeFactor)` gate; orbs hold spacing even while converging on the cursor.
- **Breath phase even-distributed** per orb (`i * (2π / N)`, i.e. 0°/120°/240°) instead of random — staggered round-robin pulse, never peak together.
- **Converge opacity-fade softened** `×0.5 → ×0.7` — at full convergence each orb sits at 70% of rest opacity (`0.40 → 0.28`).
- Wander + cursor-convergence + velocity transfer remain gated by `activeFactor` (active only when cursor is over `.main-area`).
- Synced `docs/design_system.md` → "Aurora Background" section to the final values.

## ⚠️ Disk-full incident + recovery (resolved)
- Mid-session, C: hit **0 bytes free**; an in-progress `App.jsx` write (orb anchor tweak) failed with ENOSPC and **truncated `src/App.jsx` to 0 bytes**.
- User freed ~37 GB by uninstalling League of Legends → C: now ~38 GB free.
- Recovered: `git checkout -- src/App.jsx` (restored HEAD `10c65df`, 19,058 bytes) + re-applied the orb tuning from notes.
- **Temp code gone by construction** — the committed base never had it and it was not re-added: orb path-trail visualizers, converge=0 experiment, wander un-gating, anchor "thirds" reposition.
- **Reconstruction conflict:** `design_system.md` had been synced mid-tuning and was stale on 4 values (speed 2.0, wander 5.0, velocity 0.05, fade ×0.5). Resolved to the **final** values (speed 3.0, wander 7.0, velocity 0.1, fade ×0.7) and re-synced the doc.

## Current state
- `src/App.jsx` — restored + final orb tuning, no temp code (grep-verified values). **User confirmed the 4 reconstructed values (speed `3.0`, wander `7.0`, velocity `0.1`, fade `×0.7`) correct — app in perfect working condition.**
- `docs/design_system.md` — Aurora section synced to final orb values.
- Committed + pushed to `origin/master`. Aurora recovery fully closed out.

## Next / open tasks
- (Aurora recovery complete — values user-verified, nothing open here.)
- Quote export: template fixed (headers + right-alignment + L/M widths + flush number format); **regenerate** existing `… - Quote.xlsx` exports (AJ McQueen, Shay Nicole, Shaun Milli, Delux Music Group, Lambo4oe) to pick up the changes (template-only scope).
- **Mac parity:** once Dropbox syncs the updated `RTHM Setup.command`, the Mac user reruns it (installs python3 + openpyxl) then `claude login` — Quote export then matches Windows. Fresh PCs covered by the mirrored `RTHM Setup.bat` step.
- **Deal Manager remap — apply it:** restart the server (`index.js` changed) + **re-import each deal** (existing `deals.json` holds old column keys + stale values; re-import re-pulls the correct net data).
- Watch C: free space.

## Carryover from prior session (still open)
- `docs/design_system.md` still slightly stale on **non-orb** items: glow now 0.3; add Valuate folder-name super-user gesture (Alt+click title → open folder); modals have no X close button; projected tooltip text is purple. (Orb section is now synced.)
- Prior server edits (`index.js`, `xfin.js`, `params.js`) are behavior-neutral but need a **server restart** to load (if not already restarted).
- `quote.py` lives outside the repo: `…/1. RTHM Fund/1. Data/.claude/skills/quote/quote.py`.
- openpyxl column-width gotcha → captured in `MEMORY.md` ("Quote template column widths").
