# Claude Progress — Session Save (2026-07-31)

## 1. Sheets import failing — FIXED (server/index.js)
**Symptom:** "app not working, sheets data not importing."

**Root cause (measured, not guessed):** on every server start the Data Manager pre-warmed ~98
diligence workbooks. `XLSX.readFile` is SYNCHRONOUS and several workbooks are multi-MB, so the
back-to-back parses monopolized Node's single thread for ~75s. Fast local endpoints squeezed
through (`/api/deals/saved` 8ms) but the Google Sheets call — multi round-trip HTTPS + large JSON —
got starved and timed out. Proof: `sheet-rows` FAILED >30s during the warm, then returned
**1,912ms / 463 rows** the moment the warm finished. Google itself was never the problem (token
refreshes fine; standalone probe: spreadsheet 1.6s, 471 rows in 309ms).
NOT caused by the commission removal, NOT auth, NOT a crash.

**Fix (easy path — user explicitly declined the worker-thread "real fix"):**
1. **Boot prewarm REMOVED entirely** from `app.listen`. Nothing parses at startup, so the server is
   usable immediately. The warm now only runs when `/api/data/folders` is actually called (i.e. the
   Data Manager page is opened), and the progressive column-fill already built covers that.
2. **Warm drain throttled**: `WARM_YIELD_MS = 75` real timer between parses instead of
   `setImmediate` (a setImmediate yield is too short for work needing sustained loop time).

**Verified:** cold-start import **PASS** (3.3s, 464 rows — was a >30s timeout); columns still warm
to completion (91 summaries, pending→0).

**⚠️ KNOWN RESIDUAL (not fixed):** if the Data Manager page is opened (starting the warm) and an
import runs within the next few minutes, it can STILL time out — 1 of 3 probes during warming
failed. One 5.5MB workbook parse blocks long enough to starve a request. Full warm also now takes
~190s (was ~75s) — background/progressive, not a freeze.
**Offered but NOT built** (user hasn't answered): gate the drain on server idle — stamp each
incoming request, only parse after ~500ms of no traffic (~10 lines, no workers). That would remove
the residual. The permanent fix is worker-thread XLSX parsing — explicitly declined for now.

## 2. Discovered: the server auto-shuts-down (not a crash)
`maybeShutdown()` calls `process.exit(0)` once the last UI connection closes and no skill is
running (index.js ~2850). This explains the repeated "server is down" throughout the session —
closing the browser tab stops the backend BY DESIGN. Not a bug, not a crash.

## 3. Earlier today (all committed)
- **COMMISSION removed entirely** (e93f31c) — gone from Valuation UI, all valuation math, the import
  path, and the Individual Monday sync. Margin still 11% of RAS advance; Individual math now
  identical to B2B (`Margin = RAS adv − RTHM adv`, seed `0.89 × RAS adv`). Net: new rate = old rate
  × (1 + comm/100). Verified across all 86 deals: B2B 126 rows 0 drift; Individual 234/234 match;
  margin == 11% 0 violations. **All 86 deals carry saved rates and saved rates win — existing deals
  keep their rate/advance but their Margin column now displays higher and won't read 11%. Only new
  imports get the new seed. No re-seed path exists (would be destructive; needs approval).**
  Monday: Individual deals no longer write the Commission column at all; B2B still writes margin.
- **"B2B Margin"** label on the Valuation header (was "Margin").
- **Offer Letter dynamic Recoup Rate** (1617163) — editing Advance Amount re-derives
  Recoup Rate = Advance ÷ Recoup Amount; `lockedDeal.recoupRate` synced on save.
- **B2B deal-sheet collision fix** (2d0b36b) — B2B emits `RTHM Deal Sheet (B2B)_<name>.docx`.
- **Data Manager load perf** (4dd80ad) — `/api/data/folders` non-blocking (cache-only + background
  warmer). Fixed page-load freeze but NOT the starvation root cause — see item 1.

## 🧭 Current state
- **User runs the dev server.** Claude must NOT start/stop it or touch ports 3001/5173 unprompted.
  (Diagnostic runs this session were started and stopped explicitly; nothing left running.)
- All work committed + pushed this save.
- `data/deals.json` is live Dropbox-synced from the Mac and drifts on its own. Only commit it on
  explicit say-so; NEVER `git restore` it (would revert to a stale snapshot and destroy live data).

## ⏭️ Next / open
1. **Decide on the idle-gate follow-up** for the warm-window import residual (item 1).
2. /underwrite integration — task #4, awaiting instructions.
3. Optional: re-seed path for existing deals' rates (see commission note above).
4. SETTLED (do not re-raise): offer-letter/RPA same-name collision is NOT an auto-collision.
