# Claude Progress — Session Save

## Accomplished This Session

### V2 Scaffolding — Data Manager Page
Built the skeleton for v2 royalty analysis pipeline. V1 is locked (commit `91b925c`). V2 built as a separate **Data Manager** module that stays fully independent from Deal Manager until v3 integration.

- **Sidebar:** added "Data Manager" button above "Deal Manager", same style. Spacing between DATA MANAGER and DEAL MANAGER matches the gap between DEAL MANAGER and TEMPLATES (26px total via `.nav-item--spaced { margin-top: 6px; }`).
- **DataManagerPage.jsx + .css:** new component with header, count badge, "+ Import Data" button, empty state, and table placeholder (Dataset Name, Platform, Files, Rows, Date Range, Delete). Styles pixel-identical to DealsPage.
- **MainArea.jsx/css:** added `dataManager` page route, arcade toggle selector includes `.data-manager-header`.

### Server endpoint — `/api/data/pick-folder`
Opens native folder picker on Windows and macOS. Uses `Shell.Application.BrowseForFolder` on Windows with flag `0x240` (`BIF_NEWDIALOGSTYLE | BIF_NONEWFOLDERBUTTON` — no "Make New Folder" button). Root path: `DATA_ROOT = RTHM/1. RTHM Fund/1. Data` (derived dynamically from `__dirname`, works on any device). Returns `{ ok, folderPath }` or `{ cancelled: true }`. Doesn't persist anywhere yet — frontend stores selection in local state only.

### Deal Materials folder picker — upgraded
- **Windows:** switched from `System.Windows.Forms.FolderBrowserDialog` (ignores `SelectedPath` reliably) to `Shell.Application.BrowseForFolder` with flag `0x40` (`BIF_NEWDIALOGSTYLE`, keeps "Make New Folder" button). Dialog opens rooted at `MATERIALS_ROOT`.
- **macOS:** unchanged osascript (already worked).

### Repo portability — set up for dispatch
- Created `App Files/CLAUDE.md` (copy of parent CLAUDE.md, now inside the repo so it travels with git).
- Created `App Files/docs/v2_specs.md` — full v2 pipeline spec (statement merger, projection model, advance/IRR calc, modularity rule). Mirrors the local Claude memory file.
- Updated CLAUDE.md to instruct future sessions to read `_claude_progress.md` AND `docs/v2_specs.md` at start.
- Added GitHub remote: `https://github.com/RTHM-fund/RTHM-app` (private repo).
- Pushed full history including v1.0 tag.
- **Push required removing `public/floor796.html` (174MB arcade easter egg) from git history** — exceeded GitHub's 100MB per-file limit. Used `git filter-branch` with `--index-filter`. File is now in `.gitignore`. Restored to local working tree from `refs/original/refs/heads/master` after filter-branch deleted it.

### Cleanup
- Removed unused `useEffect` import in DataManagerPage.jsx.
- Removed stray blank line after `DATA_ROOT` in server/index.js.
- Removed all dead code from earlier picker-fix attempts (helper functions, C# scroll hack, temp PS scripts).

---

## Current State

- **Working path:** `C:\Users\richa\RTHM Dropbox\RTHM Fund\RTHM\4. Operations\RTHM App`
- **Repo path:** `App Files/` (now also at https://github.com/RTHM-fund/RTHM-app)
- **App:** fully functional. V1 behavior intact. V2 Data Manager page with working folder picker. Arcade easter egg works locally (file restored to `public/`).
- **Latest commit pushed:** `9c1b480` chore: gitignore floor796.html
- **Working tree:** clean after filter-branch (need to confirm via git status — see below).
- **Server must restart** after code changes to pick up new endpoints.
- **Browser may need hard refresh** if arcade mode looks broken (cached 404 from earlier file-missing window).

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

**Dispatch ready:** any new Claude session pointed at the GitHub repo will read CLAUDE.md, `_claude_progress.md`, and `docs/v2_specs.md` at start, then continue.

---

## How to continue on phone

1. Open **claude.ai/code** in phone browser (Safari/Chrome, NOT the Claude chat app)
2. Connect GitHub → authorize Claude GitHub App for `RTHM-fund/RTHM-app` (one-time)
3. Start new chat in that repo
4. First message: *"continue v2 work"*

CLAUDE.md auto-loads in every session and tells Claude to read the progress file + spec, so context picks up immediately.
