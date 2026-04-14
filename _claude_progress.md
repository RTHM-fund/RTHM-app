# Claude Progress — Session Save

## Accomplished This Session

### V2 Scaffolding — Data Manager Page
Built the skeleton for v2 royalty analysis pipeline. V1 is locked (commit `91b925c`). V2 built as a separate **Data Manager** module that stays fully independent from Deal Manager until v3 integration.

- **Sidebar:** added "Data Manager" button above "Deal Manager", same style. Spacing between DATA MANAGER and DEAL MANAGER matches the gap between DEAL MANAGER and TEMPLATES (26px total via `.nav-item--spaced { margin-top: 6px; }`).
- **DataManagerPage.jsx + .css:** new component with header, count badge, "+ Import Data" button, empty state, and table placeholder (Dataset Name, Platform, Files, Rows, Date Range, Delete). Styles pixel-identical to DealsPage.
- **MainArea.jsx/css:** added `dataManager` page route, arcade toggle selector includes `.data-manager-header`.
- **V2 specs in Claude memory:** `memory/v2_specs.md` (full pipeline spec) + `memory/architecture_modularity.md` (modularity rule: Data Manager and Deal Manager stay independent until v3).

### Server endpoint — `/api/data/pick-folder`
Opens native folder picker on Windows and macOS. Uses `Shell.Application.BrowseForFolder` on Windows with flag `0x240` (`BIF_NEWDIALOGSTYLE | BIF_NONEWFOLDERBUTTON` — no "Make New Folder" button). Root path: `DATA_ROOT = RTHM/1. RTHM Fund/1. Data` (derived dynamically from `__dirname`, works on any device). Returns `{ ok, folderPath }` or `{ cancelled: true }`. Doesn't persist anywhere yet — frontend stores selection in local state only.

### Deal Materials folder picker — upgraded
- **Windows:** switched from `System.Windows.Forms.FolderBrowserDialog` (ignores `SelectedPath` reliably) to `Shell.Application.BrowseForFolder` with flag `0x40` (`BIF_NEWDIALOGSTYLE`, keeps "Make New Folder" button). Dialog opens rooted at `MATERIALS_ROOT`.
- **macOS:** unchanged osascript (already worked).

### Cleanup
- Removed unused `useEffect` import in DataManagerPage.jsx.
- Removed stray blank line after `DATA_ROOT` in server/index.js.
- Removed all dead code from earlier picker-fix attempts (helper functions, C# scroll hack, temp PS scripts).

---

## Current State

- **Working path:** `C:\Users\richa\RTHM Dropbox\RTHM Fund\RTHM\4. Operations\RTHM App`
- **App:** fully functional. V1 behavior intact. V2 Data Manager page with working folder picker.
- **Uncommitted changes** (see git status below).
- **Server must restart** after code changes to pick up new endpoints.

---

## What's Next — V2 Roadmap

**Step 1 of merger pipeline is underway.** Folder picker UI is done but does nothing yet after folder selection. Next pieces:

1. **File discovery** — after user picks folder, scan for CSV/XLS/XLSX files (skip "merged", "summary", "basic", and `~$` temp files), show list in UI.
2. **Column standardization** — read each file, normalize column names, show union of columns.
3. **Earnings column selection** — user picks which column is earnings → rename to `royalty_amount`. Auto-detect common names.
4. **Date extraction** — from filename first (with learning for ambiguous), fallback to picking date columns.
5. **Include/exclude columns** — user selects which columns to keep.
6. **Merge + persist** — combine into one dataset, save it (artist/distributor-scoped).
7. **Pivot engine** — Track × Date → royalty_amount.
8. **Projection model** — baseline/floor/decay (k0, k_inf, gamma), 90-period forecast. Full math in `memory/v2_specs.md`.
9. **Advance/IRR calculator** — 7 scenarios (18m/24m/36m/48m/60m/Bespoke/Req-months), cash flows, XIRR, recoupment.

Full spec reference: `royalty_merger.py` + `Royalty_Summary_MASTER.xlsm` in `C:\Users\richa\Downloads`. Specs also in Claude memory (`memory/v2_specs.md`).

**Modularity rule:** Deal Manager is not touched as part of v2 work. Cross-integration = v3.

**Session continues on dispatch.**
