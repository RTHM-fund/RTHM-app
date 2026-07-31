# Claude Progress — Session Save (2026-07-28)

## 1. Data Manager load perf — `/api/data/folders` no longer freezes the app (committed)
**Root cause:** `App.jsx` fires `/api/data/folders` on every app mount; the endpoint synchronously
parsed ~98 diligence workbooks (`XLSX.readFile`) in one un-yielded loop. On a cold cache (server
restart OR the Mac's Dropbox re-sync changing workbook mtimes → mtime-keyed cache invalidated) it
blocked the single Node event loop for **2+ minutes**, freezing the whole app. (Not Dropbox
hydration — 95/98 workbooks are local; pure CPU parsing on the request thread.)

**Fix (index.js + DataManagerPage.jsx):** endpoint now serves summaries **cache-only** (never parses
inline); uncached workbooks flagged `summaryPending` and warmed by a background drain
(`queueSummaryWarm`/`drainWarmQueue`) that yields (`setImmediate`) between each parse.
`computeWorkbookSummary` caches even on parse-throw (no endless pending). `computeContainerRollup`
cache-only, returns `{rollup, pending}`, never a partial rollup (data integrity). `DataManagerPage`
re-fetches every 1.5s while any row is `summaryPending` → columns fill in progressively.
**Verified:** ~200ms typical (was 2+ min); `deals/saved` 8ms during warming; converges pending=0.
Residual: occasional 1–3s blip while a big workbook parses (SheetJS sync; worker-thread parsing
would remove it — optional, out of scope).

## 2. Offer Letter dynamic Recoup Rate (committed 1617163)
Editing auto-filled Advance Amount re-derives Recoup Rate = Advance ÷ Recoup Amount (Recoup Amount
fixed), live + in the saved doc; `lockedDeal.recoupRate` synced on save.

## 3. deals.json — committed as current truth (commit ecd312d)
Git HEAD had a stale 2026-07-22 snapshot (86 deals); the working copy was the Mac's live
Dropbox-synced data. Per user ("current PC state is truth"), committed the current file (84 deals
at commit time — it's live, count drifts as the Mac adds deals). Git now matches the PC.
**Note:** this file is live-synced; it'll show modified again as the Mac works. Only ever commit it
on the user's explicit say-so (their data decision) — never auto-commit, never `git restore` it
(that would revert to the stale snapshot and destroy current data).

## 🧭 Current state
- All code committed + pushed (latest: ecd312d). Working tree clean except live deals.json drift.
- **Server stability:** the harness-managed dev stack orphaned/died repeatedly this session, and
  port-kills (clearing EADDRINUSE) collided with the running server — that's what caused the
  "app broke" scare (backend was simply down; perf code verified stable through warming +
  navigation). **User is taking over server startup.** Claude should NOT start/kill the dev server
  or touch ports 3001/5173 unless asked. Durable fix if it recurs: run the server as a standing
  process independent of the harness.

## ⏭️ Next / open
1. /underwrite integration — task #4, awaiting instructions.
2. Data Manager perf (optional): worker-thread XLSX parsing removes the residual 1–3s warm blips.
3. SETTLED (do not re-raise): offer-letter/RPA same-name collision is NOT an auto-collision.
