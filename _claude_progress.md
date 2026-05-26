# Claude Progress — Session Save

## Accomplished This Session

### Data Manager — folder listing module
- New `GET /api/data/folders` endpoint lists immediate subfolders of `<DROPBOX_RTHM>/1. RTHM Fund/1. Data/1. Current/`, sorted by mtime descending. Returns empty array if directory inaccessible.
- For each folder, server also tags:
  - `hasDiligence: true` if it contains a subdirectory whose name ends with `_Due Diligence` (case-insensitive)
  - `hasDeal: true` if a deal in `deals.json` matches the folder name (case-insensitive, trimmed) — **first intentional cross-module link**, kept on server side so frontend modules stay decoupled per the modularity rule
- `DataManagerPage` now fetches + renders folders on mount + window focus.
- 3 columns: **Folder Name** (truncates with soft fade + tooltip), **Diligence** (`✓` green / `?` red with text-shadow glow, centered), **Quote** (same `✓`/`?` style).
- Trailing empty spacer column absorbs leftover width so columns pack left.

### Deal Manager polish
- Renamed `Royalty Type` / `Deal Type` headers to single-word `Royalty` / `Type` so they fit on one line.
- LeTreez Monday link updated: `mondayBoardId: 10058081462`, `mondayItemId: "11622638565"`.

### Liquid-pill button system (Bystro pattern, RTHM colors)
- Adapted Bystro landing page's radial-fill hover effect: white circle expands from cursor entry over 0.6s `cubic-bezier(0.33, 0, 0.15, 1)`, text wrapped in `<span>` flips color on the same easing.
- All pill buttons updated: `deals-new-btn`, `deals-valuation-btn`, `deals-forms-btn`, `deals-materials-btn`, `deals-delete-btn`, `data-manager-import-btn`, `data-manager-delete-btn`, `valuation-new-btn`, `recoup-btn`, `agreements-new-btn`, `agreements-edit-btn`, `agreements-export-btn`, `agreements-delete-btn`, `agreements-type-btn`, `modal-import-btn`, `modal-cancel`, `modal-connect-btn`, `modal-radio-btn`, `export-btn`.
- All CSS lives in `src/index.css` (one place to maintain). Global `mouseover` listener in `App.jsx` sets `--mx` / `--my` on entry only (uses `relatedTarget` check to ignore moves within the button).
- Removed `@keyframes btn-lift` and every `animation: btn-lift` / box-shadow lift across component CSS files. No more bounce.
- **Deal Manager row buttons specifically** (Valuation / Agreements / Deal Materials / Delete):
  - No border
  - Rest state: ~10% transparent tint of their own color (rgba purple / purple-mid / red)
  - Hover: bubble fills with the matching solid color, text flips to white
- **Sidebar untouched** — design-locked.
- **`prefers-reduced-motion` lesson**: an early `transition: none` override for reduced-motion killed the bubble for users with that OS preference. Removed since the user explicitly wants the animation.

### Valuation page — editable RTHM Advance column (already committed in 1e41baf, covered again here for context)
- RTHM Advance cell is editable when not locked. On blur/Enter, back-computes the implied Recoup Rate. Margin recalculates.

### atomic-write hardening (already committed in 1e41baf)
- `atomicWriteJson` retries `renameSync` up to 5× with progressive backoff for `EPERM` / `EBUSY` / `ENOTEMPTY` (Windows + Dropbox lock contention). Falls back to direct write with a warning if all retries fail.

### Aurora background — explored + reverted
- Tested Bystro's multi-radial-gradient aurora background using RTHM purples. User didn't like it. Reverted to the original `linear-gradient(#DACEFD → #FAFAFA)`.

---

## Current State

- **Working path:** `C:\Users\richa\RTHM Dropbox\RTHM Fund\RTHM\4. Operations\RTHM App`
- **Repo:** `App Files/` on `master`, pushed to `https://github.com/RTHM-fund/RTHM-app`
- **App data:** 51 deals in `deals.json`.
- **Servers must be restarted on Mac + Windows** to pick up server changes (`/api/data/folders` endpoint, atomic-write retry).
- **Liquid-pill effect is live** — hover any pill button to see the radial fill.

---

## What's Next

### Open / known issues
- Catalog diligence feature (Claude Code subprocess for skill chain on a folder) — design discussed, not implemented yet. Pending decisions on skill names, output destination, master-skill orchestration.
- Re-import deals with VQ data to refresh column mapping (still pending from earlier session).
- B2B RPA template — may have similar Seller/Legal Name/Title mapping issues.
- Mac Dropbox File Provider migration: re-run `RTHM Setup.command` after migration completes to fix desktop shortcut absolute path.

### V2 roadmap (unchanged)
1. **File discovery** — partially done (scan-folder endpoint exists; folder listing now visible in Data Manager).
2. Column standardization → earnings column selection → date extraction → include/exclude columns → merge + persist.
3. Pivot engine → projection model → advance/IRR calculator.

Full spec: `docs/v2_specs.md`. Modularity rule: Data Manager and Deal Manager remain decoupled at frontend level; **server endpoints are the only bridge** (see `cross_machine_safety.md` and the new pattern in `/api/data/folders`).
