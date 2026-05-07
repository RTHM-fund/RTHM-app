# Claude Progress — Session Save

## Accomplished This Session

### Form polish
- **Valuation page Recoup Rate** — accepts up to 2 decimals (e.g. `70.5`, `67.25`). Locked display always renders 2 dp via `toFixed(2)`. `inputMode="decimal"`.
- **RPA Advance Amount editable** — was locked when autofilled. Now editable while keeping the "auto-filled" label. On save, writes back to `lockedDeal.advanceAmount` so it becomes the source of truth for future autofills. Combined with B2B `transactionId` lock update into one POST.
- **OfferLetter Advance Amount editable** — same pattern as RPA. Editable when a deal sheet row is locked. On save, writes back to `lockedDeal.advanceAmount` alongside the existing `legalName` update in one POST.
- **RTHM RPA B2B mapping fix** — for B2B deals on `RTHM RPA_Template.docx`:
  - `Seller Name` ← `B2B Entity` (e.g. Skyline Capital) — was `B2B Signer`
  - `Legal Name` ← `B2B Signer` (e.g. Lawton Bouhairie) — was artist's `lockedDeal.legalName`
  - `Title` ← `B2B Title` (unchanged)
  - Fixes the seller signature block reading "Malachi Burney / Owner" while body said "Lawton Bouhairie, as Seller". Individual deals untouched.

### Cross-machine reliability (Mac onboarding)
- **Mac setup script (`RTHM Setup.command`)** — added pre-flight check for empty/missing `package.json` (Dropbox placeholder) and post-flight check on `npm install` exit code. Both fail loud with a Dropbox-sync hint instead of silently "succeeding".
- **Mac launch script (`RTHM Launch.command`)** — added `App Files`/`node_modules`/`npm` existence checks plus a `read -p` pause at end so Terminal stays open showing errors. Replaced the silent-fail original.
- **Desktop launcher** — setup now writes a wrapper (`exec "$SCRIPT_DIR/RTHM Launch.command"`) instead of copying the launch script. The copy approach broke `dirname "$0"` resolution and made the Desktop shortcut try to find App Files in `~/Desktop`.
- **`findDropboxRTHM()`** — `server/index.js` now walks up from `App Files/` looking for a directory containing `1. RTHM Fund/2. Offers/`, instead of assuming a fixed 4-level depth. Logs the resolved path on startup. Falls back to old behavior with a warning if not found. Handles team Dropbox vs personal Dropbox structures.

### Data safety
- **Wipe prevention (critical)** — `/api/deals/saved` was nuking `agreements: []` and `folderPath: null` on any machine where the underlying Dropbox folders weren't synced. The Mac launching with un-synced `1. RTHM Fund/` triggered this and the corruption synced back to Windows. Cleanup logic now gates on `MATERIALS_ROOT` and `TEMP_AGREEMENTS_DIR` actually existing.
- **Deal recovery** — restored `deals.json` from commit `a675155` via `git checkout`. 2 deals that had been imported between the commit and the Mac wipe were lost in the restore (user opted not to recover; would have required manual reconciliation from Dropbox version history).
- **Pre-write deal snapshots** — every `writeDeals()` now copies the current `deals.json` to `<RTHM App>/Backups/deals.<timestamp>.<hostname>.json` first. Located outside `App Files/` so destructive code paths can't touch it. Inside Dropbox = synced across machines. Hostname-tagged, per-host pruning (cap 50/host) so machines never delete each other's backups. Recovery is manual: copy a snapshot back to `App Files/data/deals.json`, restart app.

---

## Current State

- **Working path:** `C:\Users\richa\RTHM Dropbox\RTHM Fund\RTHM\4. Operations\RTHM App`
- **Repo:** `App Files/` on `master`, pushed to `https://github.com/RTHM-fund/RTHM-app`
- **Working tree:** clean.
- **App:** Windows running, working perfectly. Mac onboarded — launches via `npm run dev`; the upgraded `.command` wrappers fix the silent-fail issues. Mac is missing `1. RTHM Fund/`, `3. Deal Materials/`, `1. Data/` Dropbox folders, so agreements / materials / data features won't fully work on Mac until those sync.
- **Backups:** `<RTHM App>/Backups/` will be created on the next `writeDeals()` after each machine restarts its dev server.
- **Data:** 39 deals, 38 with agreements, 66 agreement file references, 4 with `lockedDeal`, multiple with `folderPath` (incl. new Lilmal357 + Eric Lee Hudson deals from today's app activity).

---

## What's Next

### Immediate / open
- B2B RPA template — does it have similar Seller/Legal Name/Title mapping issues? Worth a quick check now that the convention is set for RTHM RPA.
- If user wants previously-generated `.docx` files to update when Advance Amount changes, that's a separate feature (currently they're static after generation).
- Mac `1. RTHM Fund/`, `3. Deal Materials/`, `1. Data/` folders need syncing for full feature parity.

### V2 roadmap (unchanged)
1. **File discovery** — after folder pick, scan for CSV/XLS/XLSX (skip "merged"/"summary"/"basic"/`~$`), show in UI.
2. Column standardization → earnings column selection → date extraction → include/exclude columns → merge + persist.
3. Pivot engine → projection model → advance/IRR calculator.

Full spec: `docs/v2_specs.md`. Modularity rule: Data Manager and Deal Manager remain decoupled until v3.
