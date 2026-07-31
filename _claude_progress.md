# Claude Progress — Session Save (2026-07-28)

## 1. Data Manager load perf — `/api/data/folders` no longer freezes the app (index.js + DataManagerPage.jsx)
**Root cause:** `App.jsx` fires `/api/data/folders` on every app mount; that endpoint synchronously
parsed ~98 diligence workbooks (`XLSX.readFile`) in one un-yielded `.map()`. On a cold cache
(server restart OR the Mac's Dropbox re-sync changing workbook mtimes → the mtime-keyed cache
invalidates) it blocked the single Node event loop for **2+ minutes**, freezing the whole app.
(Not Dropbox hydration — 95/98 workbooks are local; pure CPU parsing on the request thread.)

**Fix — non-blocking + background warm + progressive fill:**
- `getSummaryCached()`: cache-only lookup — returns the cached summary or flags `summaryPending`;
  NEVER parses inline.
- `queueSummaryWarm()` / `drainWarmQueue()`: background warmer parses uncached workbooks one at a
  time, yielding (`setImmediate`) between each so HTTP stays responsive. Deduped `Set`.
- `computeWorkbookSummary()`: now caches even when the parse THROWS (broken/locked workbook) so a
  row can't stay `summaryPending` forever (prevents endless FE polling).
- `computeContainerRollup()`: cache-only, returns `{ rollup, pending }` — never a partial/
  understated rollup (data integrity); queues pending children.
- `/api/data/folders`: cache-only per folder, collects pending paths → `queueSummaryWarm`, adds
  `summaryPending` to each row. Startup prewarm routed through the same warmer.
- `DataManagerPage.jsx`: re-fetches every 1.5s while any row is `summaryPending`, self-terminating
  → data columns (sparkline/Lifetime/TTM/Tracks) fill in progressively.

**Verified live (cold-boot hammer):** endpoint **~200ms typical** (was 2+ min timeout); `pending`
89→0 over ~60s background warming; `deals/saved` 8ms + `templates` 4ms DURING warming (app-wide
responsive); converges `pending=0` (89 summaries; 17 folders no-workbook/unparseable → `—`). Clean
boot, no console/server errors. Residual: occasional 1–3s blip while a large workbook parses in the
background (SheetJS is synchronous; fully removing it would need worker threads — out of scope).

## 2. Offer Letter dynamic Recoup Rate (committed 1617163, earlier this session)
Editing the auto-filled Advance Amount now re-derives Recoup Rate = Advance ÷ Recoup Amount
(Recoup Amount fixed) live + in the saved doc; `lockedDeal.recoupRate` synced on save.

## 🧭 Current state
- App running (:3001 backend, :5173 Vite) with new code. All changes live.
- **`data/deals.json` UNCOMMITTED — deliberately.** It's the Mac's live data (83 deals, all
  `/Users/slif/` paths, synced via Dropbox), not corruption. Not bundled into code commits — your
  data decision (commit from whichever machine you're actively on).
- Dev stack orphans from the harness; ports also linger. To restart cleanly: kill the PIDs on
  ports 3001+5173 (NOT just `*App Files*` — the `node server/index.js` proc has no "App Files" in
  its cmdline), then `preview_start rthm-app-win`.

## ⏭️ Next / open
1. /underwrite integration — task #4, awaiting instructions.
2. Data Manager perf (optional): worker-thread XLSX parsing would remove the residual 1–3s
   warm-window blips. Bigger change; current fix already killed the multi-minute freeze.
3. SETTLED (do not re-raise): offer-letter/RPA same-name collision is NOT an auto-collision.
