# Claude Progress — Session Save (2026-07-28)

## 1. COMMISSION removed entirely (this session's main work)
Commission no longer exists in the Valuation UI, in ANY valuation math, in the import path, or in
the Monday sync for Individual deals. **Margin stays 11% of RAS advance**; Individual math is now
**identical to B2B**.

**Math change (Individual only):**
- was `Margin = RAS adv − RTHM adv − (RTHM adv × commission%)`, seed `RTHM adv = (RAS adv − m)/(1 + comm/100)`
- now `Margin = RAS adv − RTHM adv`, seed `RTHM adv = 0.89 × RAS adv`
- Net effect: **new rate = old rate × (1 + comm/100)**. The slice commission used to take now goes
  into the RTHM advance. Margin still lands on 11%.

**Files:** `ValuationPage.jsx` (Commission input deleted; seed, margin, PR margin, both tooltips and
the Margin-cell inverse solve all unbranched; `marginRate` + `commission` state removed),
`AgreementsPage.jsx` (2 payloads), `ImportModal.jsx` (state, canImport guard, 3 payloads —
there was never a commission INPUT; it silently stamped `'4'`), `server/index.js`
(`effectiveRatesFor` dropped BOTH `seedCommission` and `dealType` params → `(source, pairs,
savedRates)`; both call sites; import + edit-deal stop writing `deal.commission`; monday/create-deal
stops writing the column; valuation-state PATCH push is now **B2B-only**).

**Kept deliberately:** `MARGIN_PCT` 0.11 · `MONDAY_COMMISSION_COL` + `updateMondayCommission` (B2B
margin still writes there) · `b2bMarginRate` / the "B2B Margin" input (partner margin — a DIFFERENT
concept) · `.commission-inline` / `.commission-label` CSS (shared RateInput, used by B2B).

**Verified across all 86 real deals (read-only script):** B2B regression 126 term-rows **0 drift**;
Individual 234/234 rows match `× (1 + comm/100)`; margin == 11% of RAS advance **0 violations**;
FE↔BE seed lines byte-identical; syntax OK on all 4 files. Known row (RAS adv 31,255 / recoup
62,225 / 4%): 42.98%→**44.70%**, adv 26,744→**27,815**, margin 3,441→3,440 (11% = 3,438).

**⚠️ Expected behavior — ALL 86 deals carry saved rates, and saved rates always win (decision 2A):**
existing deals keep their rate + RTHM advance (exports do NOT drift), but their **Margin column
displays higher** by `RTHM adv × old comm%` and will not read 11% (e.g. that row shows ~4,511, not
3,441). The new 11% seed only applies to **newly imported deals** / terms with no saved rate.
There is NO re-seed path. If existing deals should be re-seeded, that's an unbuilt follow-up
(would overwrite tuned rates — destructive, needs explicit approval).

**Monday.com:** Individual deals no longer write to the Commission column at all (not at import,
not on recoup-lock). B2B still writes its margin on recoup-lock.

**deals.json:** old `commission` / `valuationState.commission` values left inert — no migration.
`valuationState.commission` drops organically on the next valuation save (FE replaces the object).

## 2. Also this session
- **"B2B Margin" label** — the B2B rate input on the Valuation header now reads "B2B Margin".
- **Offer Letter dynamic Recoup Rate** (1617163): editing the auto-filled Advance Amount re-derives
  Recoup Rate = Advance ÷ Recoup Amount (Recoup Amount fixed), live + in the saved doc;
  `lockedDeal.recoupRate` synced on save.
- **B2B RTHM Deal Sheet collision fix** (2d0b36b): B2B deals emit `RTHM Deal Sheet (B2B)_<name>.docx`
  so they can't overwrite the same-name Individual instance's sheet.
- **Data Manager load perf** (4dd80ad): `/api/data/folders` is now non-blocking (cache-only +
  background warmer that yields); was freezing the whole app 2+ min on a cold cache. ~200ms typical.
- **deals.json committed as truth** (ecd312d) — git had a stale 2026-07-22 snapshot.

## 🧭 Current state
- **User runs the dev server** — Claude must NOT start/stop it or touch ports 3001/5173.
  Backend was down at save time; the next start picks up the new server code automatically.
- All work committed + pushed this save.
- `deals.json` is live Dropbox-synced from the Mac (86 deals at save time, was 84 earlier today) —
  it drifts on its own. Only ever commit it on explicit say-so; NEVER `git restore` it (that would
  revert to a stale snapshot and destroy current data).

## ⏭️ Next / open
1. /underwrite integration — task #4, awaiting instructions.
2. Optional: re-seed path for existing deals' rates (see the 2A note above).
3. Optional: worker-thread XLSX parsing to remove the residual 1–3s Data Manager warm blips.
4. SETTLED (do not re-raise): offer-letter/RPA same-name collision is NOT an auto-collision.
