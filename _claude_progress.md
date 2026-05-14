# Claude Progress — Session Save

## Accomplished This Session

### Form polish (earlier in session)
- **Valuation page Recoup Rate** — accepts up to 2 decimals (e.g. `70.5`, `67.25`). Locked display always renders 2 dp via `toFixed(2)`. `inputMode="decimal"`.
- **RPA Advance Amount editable** — was locked when autofilled. Now editable while keeping the "auto-filled" label. On save, writes back to `lockedDeal.advanceAmount`. Combined with B2B `transactionId` lock update into one POST.
- **OfferLetter Advance Amount editable** — same pattern as RPA. Editable when a deal sheet row is locked. Writes back to `lockedDeal.advanceAmount` alongside the existing `legalName` update in one POST.
- **RTHM RPA B2B mapping fix** — for B2B deals on `RTHM RPA_Template.docx`:
  - `Seller Name` ← `B2B Entity` (was `B2B Signer`)
  - `Legal Name` ← `B2B Signer` (was artist's `lockedDeal.legalName`)
  - `Title` ← `B2B Title` (unchanged)
  - Fixes the seller signature block reading "Malachi Burney / Owner" while body said "Lawton Bouhairie, as Seller". Individual deals untouched.

### Cross-machine reliability — Mac onboarding
- **Mac setup script (`RTHM Setup.command`)** — added pre-flight check for empty/missing `package.json` (Dropbox placeholder) and post-flight check on `npm install` exit code. Both fail loud with a Dropbox-sync hint.
- **Mac launch script (`RTHM Launch.command`)** — added `App Files`/`node_modules`/`npm` existence checks plus a `read -p` pause at end so Terminal stays open showing errors.
- **Desktop launcher** — setup now writes a wrapper (`exec "$SCRIPT_DIR/RTHM Launch.command"`) instead of copying the launch script. The copy approach broke `dirname "$0"` resolution.
- **`findDropboxRTHM()`** — `server/index.js` walks up from `App Files/` looking for `1. RTHM Fund/2. Offers/`. Logs the resolved path. Falls back with a warning if not found.

### Data safety — the big one
- **The wipe bug, recurring.** Even after the gated cleanup in `13ddbd6`, `/api/deals/saved` was still wiping agreements when individual files weren't synced. Lost 78 agreements again.
- **Restoration.** Re-merged from commit `14efd15` (78 agreements + folderPaths + lockedDeals + valuationStates). Hostname-tagged backups via the new pre-write snapshot feature catch any future accidental writes.
- **Stop the bleeding (commit `511602f`):**
  - `/api/deals/saved` is now read-only. The on-read cleanup that scanned every agreement file and silently deleted references is **gone**.
  - Stale references are cleaned up only on **explicit user action**: clicking "edit DOC" / "export PDF" / "Deal Materials" against a missing file silently removes that one reference. Server returns `{ cleared: true }` so frontend updates immediately.
  - `AgreementsPage` `handleOpen` + `handleExportPDF` do optimistic local removal on `cleared:true`.
  - `DealsPage` `handleDealMaterials` already calls `loadDeals()` on `!res.ok`.
- **Safe writes:**
  - `writeDeals` is now atomic: `writeFileSync(.tmp)` + `renameSync()`. Readers see either old or new file, never half-written.
  - `checkForDropboxConflicts()` runs at startup, warns if `*conflicted copy*.json` files exist in `data/` (no auto-merge).
  - Stale `.tmp` cleanup at startup defends against prior-crash leftovers.
- **Simplify pass (commit `8a75806`):**
  - `atomicWriteJson(path, data)` — extracted as pure write primitive. `writePartners` now also uses it (was vulnerable to same partial-write risk).
  - `clearAndRespond404(res, deals, msg, mutate)` — collapses 3 near-identical cleanup blocks across `/open-folder`, `/open`, `/export-pdf`.
  - Frontend optimistic-removal pattern — also fixed an alert ordering bug where `handleExportPDF` flashed "Export failed" for a row that just disappeared.

### Pre-write deal snapshots (added earlier in session, now active)
- Every `writeDeals()` snapshots the current `deals.json` to `<RTHM App>/Backups/deals.<timestamp>.<hostname>.json` first.
- Outside `App Files/`, inside Dropbox = synced cross-machine. Hostname-tagged + per-host pruning (cap 50/host) so machines never delete each other's recovery points.

---

## Current State

- **Working path:** `C:\Users\richa\RTHM Dropbox\RTHM Fund\RTHM\4. Operations\RTHM App`
- **Repo:** `App Files/` on `master`, pushed to `https://github.com/RTHM-fund/RTHM-app`
- **Working tree:** clean (only `package-lock.json` cross-platform npm noise, untracked)
- **App data:** 44 deals, 81 agreements, 43 purple-button valuations, 5 folderPaths, 7 lockedDeals.
- **Servers must be restarted** on both Mac and Windows to pick up the post-cleanup code (commit `8a75806`).

---

## What's Next

### Open follow-ups
- B2B RPA template — does it have similar Seller/Legal Name/Title mapping issues now that the convention is set for RTHM RPA?
- If user wants previously-generated `.docx` files to update when Advance Amount changes, that's a separate feature (currently they're static after generation).
- Mac `1. RTHM Fund/`, `3. Deal Materials/`, `1. Data/` folders need syncing for full feature parity on Mac.
- Long-term: if cross-device consistency becomes a real-time requirement (concurrent edits across machines), move `deals.json` to a cloud DB (Supabase/Firebase). Today's setup is eventually consistent (via Dropbox sync) — adequate for 1–2 user setup.

### V2 roadmap (unchanged)
1. **File discovery** — after folder pick, scan for CSV/XLS/XLSX (skip "merged"/"summary"/"basic"/`~$`), show in UI.
2. Column standardization → earnings column selection → date extraction → include/exclude columns → merge + persist.
3. Pivot engine → projection model → advance/IRR calculator.

Full spec: `docs/v2_specs.md`. Modularity rule: Data Manager and Deal Manager remain decoupled until v3.
