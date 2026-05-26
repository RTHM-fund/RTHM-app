# Claude Progress — Session Save

## Accomplished This Session

### Data Manager — row selection
- Single-row select, click-anywhere-on-row, deselect by re-click OR click-outside.
- Visual: 3px solid `var(--primary)` left accent bar via `box-shadow: inset 3px 0 0 0` + faint 5% purple wash. User-confirmed style — restrained, content-first.
- Outside-click handler exempts `.data-manager-table-wrap` AND `.data-manager-header-actions` so action buttons don't accidentally deselect (mousedown fires before click).
- Memory note: [Selection-state style](selection_state_style.md) captures the design + the click-outside trap.

### Data Manager — three new action buttons
- **+ Diligence**, **+ Valuate** (placeholder, no onClick), **+ Extract** — left of `+ Import Data`, grouped in a new `.data-manager-header-actions` flex container inside the title row.
- Style matches `.deals-valuation-btn` dimensions (5px 14px, 12px font, 600 weight, no border, `var(--radius)`) but **filled-primary** — solid purple bg + white text, white radial-fill bubble flips text to purple on hover.
- All wired into liquid-pill system: 4 selector lists in `src/index.css` + `LIQUID_SELECTOR` in `App.jsx`.

### Data Manager — Extract column added
- New "Extract" column right of Quote, showing ✓ if folder contains `*_Data Engine` subfolder, ? otherwise.
- Server endpoint `/api/data/folders` already returns `hasExtract` (mirrors `hasDiligence` pattern). Column widths updated in CSS to cover nth-child(4).

### Skill runner — server-side subprocess spawning
- `POST /api/data/run-skill` — spawns `claude -p "/<skill> <folderPath>" --dangerously-skip-permissions`. Detached + unref'd, fire-and-forget.
- ALLOWED_SKILLS: `['diligence', 'catalog-extract']`. Diligence is wired to + Diligence button. Catalog-extract to + Extract. Valuate intentionally has no skill yet (placeholder).
- `findClaudeBin()` helper resolves the CLI: checks PATH via `where`/`which`, then falls back to `%APPDATA%\Claude\claude-code\<version>\claude.exe` on Windows (Claude Desktop app bundles the CLI; it's not on system PATH) or common Mac paths. Cached at first lookup.
- stdout/stderr stream to `App Files/logs/<folder>_<skill>_<timestamp>.log` for debugging.
- **FD leak fix**: parent's logFd is closed after spawn so fds don't accumulate across runs.

### Running-skill UI feedback
- Per-row lavender wash highlight + small purple CSS spinner (12px) inline right of the folder name when a skill is running.
- Spinner lives inside `.data-manager-cell-truncate` so the mask only fades when content actually overflows (short names show no fade, long names truncate cleanly).
- Polling: every 10s while `runningSkills.size > 0`, re-fetches `/api/data/folders` and clears entries whose completion flag flipped (`diligence` → `hasDiligence`, `catalog-extract` → `hasExtract`). `loadFolders` also reconciles on mount + window-focus.

### Running state lifted to App.jsx + persisted
- `runningSkills` Map state moved from `DataManagerPage` to `App.jsx` and threaded through `MainArea`. Spinners survive page navigation.
- Persisted to `localStorage['rthm-running-skills']` (serialized as `{path: [skills]}`). Spinners survive full page reload. File-system flags self-heal stale entries on next Data Manager visit.

### Import Data — simplified to "open Explorer/Finder"
- Old behavior (folder picker → copy → scan modal) replaced. Now: click → opens `1. RTHM Fund/1. Data/1. Current/` in native file browser. User drags folders in manually; Data Manager refreshes on window focus.
- New endpoint `POST /api/data/open-folder` accepts `{key: 'current' | 'materials-root'}` and uses existing `openFile` helper (`spawn('explorer'|'open', [path])`).
- **Deal Materials unlinked case** also uses the new pattern — click opens `3. Deal Materials/` parent in Explorer. Right-click context menu still calls `handleRelink` (picker-based linker, unchanged).

### Cleanup
- Deleted: `server/scanner.js`, `src/components/ScanResultsModal.jsx`, `src/components/ScanResultsModal.css`.
- Removed endpoints: `/api/data/pick-folder`, `/api/data/import-folder`, `/api/data/scan-folder`.
- Removed frontend: `pickFolder`, `importFolder` functions, `scanFolderPath` state, ScanResultsModal import + JSX.
- Removed orphaned dep `yauzl` from package.json (was only used by scanner.js).
- Added `logs/` to `.gitignore`.

### Mac workflow hardening (post-initial commit)
- **`findClaudeBin()`** expanded with Mac fallbacks: `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`, `~/.npm-global/bin/claude`, `~/.claude/local/claude`, scans `~/.nvm/versions/node/<v>/bin/claude`, and a defensive `~/Library/Application Support/Claude/claude-code/<v>/claude` (in case the Mac Desktop app starts bundling its own CLI like Windows does).
- **`/api/data/run-skill`** auto-applies `xattr com.dropbox.ignored` when it creates `logs/` at first skill run on Mac — covers users who haven't re-run the updated Setup.command yet.
- **`runSkill` frontend** now alerts on `data.error` from the spawn endpoint so users see "Could not start diligence: Claude CLI not found…" instead of nothing.
- **`RTHM Setup.command`** (parent dir, Dropbox-only): step 4/4 installs Claude Code CLI via `npm install -g`, with sudo fallback. Skills-folder pre-flight check warns if `1. Data/.claude/skills/` isn't synced. xattr Dropbox-ignore applied to both `node_modules/` AND `logs/`. Verifies `claude --version` after install. Closing message reminds the user to run `claude login`.
- **`RTHM Launch.command`** (parent dir, Dropbox-only): replaced `sleep 4` with `curl -sf` polling on `http://localhost:5173` (up to 30s timeout) so the browser opens only when Vite is actually ready.

### Final audit pass
- Code review (3 parallel finder agents) caught: FD leak from `fs.openSync` after spawn (fixed via `closeSync`) and orphaned `yauzl` dep (removed from package.json).
- All other findings were false positives or intentional (Valuate placeholder, `[runningSkills.size > 0]` dep array).

### Memory entries created/updated
- `selection_state_style.md` — restrained selected-row pattern + click-outside trap warning.
- `claude_cli_path_windows.md` — now cross-platform; documents `findClaudeBin()` and silent-spawn diagnostic signature.
- `mac_user_workflow.md` — full Dropbox-driven new-Mac-user chain, files in git vs Dropbox-only, common failure modes.

---

## Current State

- **Working path:** `C:\Users\richa\RTHM Dropbox\RTHM Fund\RTHM\4. Operations\RTHM App`
- **Repo:** `App Files/` on `master`, pushed to `https://github.com/RTHM-fund/RTHM-app`
- **Diligence verified end-to-end** on **Starz Lil D** — claude.exe spawned, Workbook + Memo landed in `Starz Lil D_Due Diligence/`, polling cleared the spinner, Diligence column flipped ✓.
- **9 stale Claude Desktop app windows** are still running locally; not from our server, can be ignored or killed via Task Manager.

---

## What's Next

### Open / known issues
- **+ Valuate button** still a placeholder (no onClick, no skill mapped). User said placeholder; design to come.
- **Linux fallback** for `findClaudeBin()` not implemented (PATH-only). Add if Linux becomes a target.
- **No concurrency cap** on skill runs — user can fire N parallel diligence subprocesses. Each burns tokens. Consider adding a UI cap if cost becomes an issue.
- **localStorage stale entries** — if a spawn fails after the spinner saves to localStorage, the spinner persists until the completion flag flips. No "force clear running" UI yet; users can run `localStorage.removeItem('rthm-running-skills')` in console.

### Earlier session leftovers (still pending)
- Re-import deals with VQ data to refresh column mapping.
- B2B RPA template Seller/Legal/Title mapping audit.
- Mac Dropbox File Provider migration → re-run `RTHM Setup.command` after migration.

### V2 roadmap (unchanged)
1. File discovery — done (folder listing + diligence/extract triggers).
2. Column standardization → earnings col selection → date extraction → include/exclude → merge.
3. Pivot engine → projection model → advance/IRR calculator.

Full spec: `docs/v2_specs.md`. Modularity rule: Data Manager and Deal Manager remain decoupled at frontend level; server endpoints are the only bridge.
