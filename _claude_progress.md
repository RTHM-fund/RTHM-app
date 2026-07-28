# Claude Progress — Session Save (2026-07-28)

## 1. Offer Letter Form — dynamic Recoup Rate (OfferLetterForm.jsx, committed)
**Ask:** when the user overrides the auto-filled Advance Amount, the auto-filled Recoup Rate
must update live.

**Fix (2 edits, frontend-only — HMR, no server restart):**
- `handleChange` (isAmount branch): when the edited field is `Advance Amount` AND a deal row is
  locked (`lockedRow`) with a Recoup Amount base > 0, re-derive
  **Recoup Rate = (Advance ÷ Recoup Amount) × 100**, Recoup Amount held fixed. Raw keeps full
  precision; `formatPct` is display-only. Empty advance → blank rate. This automatically flows to
  the saved document (save reads `values['Recoup Rate']`).
- `handleSave` (advanceChanged block): also set `lockUpdate.recoupRate = (formAdvance ÷
  lockedRow.recoupAmount) × 100` so the persisted `lockedDeal` stays internally consistent.
  (Note: `lockedDeal.recoupRate` is write-only downstream — RPAForm reads advanceAmount +
  recoupAmount, never recoupRate — so this is for data cleanliness/auditability.)

**Canonical relation:** Advance = Recoup Amount × Recoup Rate (deal-sheet tooltip). Inverted here
to solve for the rate. Recoup Amount is the projection-derived recoupable base and stays fixed.

**Verified:** clean compile (app loaded, zero console errors); formula proven in-page against the
920,920 base — 500,000→54.29% (matches the reference screenshot), 600,000→65.15%,
920,920→100.00%, cleared→blank. Full UI click-through not driven (deep 6-step flow through a
flaky browser pane); math + wiring + compile confirmed instead.

## 2. Earlier today (already committed + pushed)
- **B2B RTHM Deal Sheet collision fix** (commit 2d0b36b): B2B deals now emit
  `RTHM Deal Sheet (B2B)_<name>.docx` so a B2B instance no longer overwrites the same-name
  Individual instance's deal sheet. type stays 'Deal Sheet', name still startsWith 'RTHM Deal
  Sheet' → all matchers/readers safe. Go-forward only.
- **B2B template dropdown labels** tidied (Valuation + Agreements): show just the partner name.

## 🧭 Current state
- App running (:3001 backend, :5173 Vite). All changes live. This session committed + pushed.
- Dev stack still orphans from the harness — if ports busy but "no preview", kill `*App Files*`
  node PIDs and `preview_start rthm-app-win`.

## ⏭️ Next / open
1. /underwrite integration — task #4, awaiting user instructions (skill fully ingested).
2. SETTLED (do not re-raise): offer-letter/RPA same-name collision — NOT an auto-collision
   (Individual "RTHM Offer Letter_" vs B2B's distinct prefix; RPA filename user-editable). Only
   the auto-derived Deal Sheet name was a silent clash, and that's fixed.
3. Carried: first real 12-year RPA gen + first fee-bearing deal-sheet export; Tyga/Lil Sheik
   parser; container Lifetime spot-check; diligence stage-marker e2e; James Avex reconcile.
