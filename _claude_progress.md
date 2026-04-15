# Claude Progress — Session Save

## Accomplished This Session

### V2 Scaffolding — Data Manager Page
Built the skeleton for v2 royalty analysis pipeline. V1 is locked (tag `v1.0`). V2 built as a separate **Data Manager** module that stays fully independent from Deal Manager until v3 integration.

- **Sidebar:** added "Data Manager" button above "Deal Manager", same style. Spacing between DATA MANAGER and DEAL MANAGER matches the gap between DEAL MANAGER and TEMPLATES (26px total via `.nav-item--spaced { margin-top: 6px; }`).
- **DataManagerPage.jsx + .css:** new component with header, count badge, "+ Import Data" button, empty state, and table placeholder (Dataset Name, Platform, Files, Rows, Date Range, Delete). Styles pixel-identical to DealsPage.
- **MainArea.jsx/css:** added `dataManager` page route, arcade toggle selector includes `.data-manager-header`.

### Server endpoint — `/api/data/pick-folder`
Opens native folder picker on Windows and macOS. Uses `Shell.Application.BrowseForFolder` on Windows with flag `0x240` (`BIF_NEWDIALOGSTYLE | BIF_NONEWFOLDERBUTTON` — no "Make New Folder" button). Root path: `DATA_ROOT = RTHM/1. RTHM Fund/1. Data` (derived dynamically from `__dirname`, works on any device). Returns `{ ok, folderPath }` or `{ cancelled: true }`. Doesn't persist anywhere yet — frontend stores selection in local state only.

### Deal Materials folder picker — upgraded
- **Windows:** switched from `System.Windows.Forms.FolderBrowserDialog` (ignores `SelectedPath` reliably) to `Shell.Application.BrowseForFolder` with flag `0x40` (`BIF_NEWDIALOGSTYLE`, keeps "Make New Folder" button). Dialog opens rooted at `MATERIALS_ROOT`.
- **macOS:** unchanged osascript (already worked).

### GitHub backup
- Created `App Files/CLAUDE.md` (copy of parent CLAUDE.md) so project rules live inside the repo.
- Created `App Files/docs/v2_specs.md` — full v2 pipeline spec (statement merger, projection model, advance/IRR calc, modularity rule).
- Added GitHub remote `https://github.com/RTHM-fund/RTHM-app` (private). Everything pushed including v1.0 tag.
- `public/floor796.html` (174MB arcade easter egg) added to `.gitignore` and removed from git history — exceeded GitHub's 100MB per-file limit. File stays on local disk; arcade mode still works locally.

### Cleanup
- Removed unused `useEffect` import in DataManagerPage.jsx.
- Removed stray blank line after `DATA_ROOT` in server/index.js.
- Removed all dead code from earlier picker-fix attempts (helper functions, C# scroll hack, temp PS scripts, leftover `/tmp/rthm_pick_folder.ps1`).
- Deleted filter-branch backup refs (`refs/original/*`) and ran `git gc` to reclaim space after floor796.html was rewritten out of history.

---

## Current State

- **Working path:** `C:\Users\richa\RTHM Dropbox\RTHM Fund\RTHM\4. Operations\RTHM App`
- **Repo:** `App Files/` locally, pushed to `https://github.com/RTHM-fund/RTHM-app` (private, used as backup)
- **App:** fully functional. V1 behavior intact. V2 Data Manager page with working folder picker. Arcade easter egg works locally.
- **Working tree:** clean.
- **Server restart needed** after pulling new code to pick up endpoint changes.

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
8. **Projection model** — baseline/floor/decay (k0, k_inf, gamma), 90-period forecast. Full math in `docs/v2_specs.md`.
9. **Advance/IRR calculator** — 7 scenarios (18m/24m/36m/48m/60m/Bespoke/Req-months), cash flows, XIRR, recoupment.

Full spec reference: `docs/v2_specs.md` (in repo) + `royalty_merger.py` + `Royalty_Summary_MASTER.xlsm` (in local Downloads only — not in repo).

**Modularity rule:** Deal Manager is not touched as part of v2 work. Cross-integration = v3.
