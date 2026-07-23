# Claude Progress — Session Save (2026-07-22, final)

Huge day. Three major workstreams, all completed, audited, and live.

## 1. RPA contract templates — rescission rollout + 12-year family (Templates dirs, OUTSIDE git)
- **Buyer's Right of Rescission** (from executed Jay Lewis clause 45) added to: RTHM RPA (ops +
  app, byte-identical, clause 44, plain-Buyer), B2B RPA (clause 45, Designee framing), RTHM RPA
  (12-year) (clause 43 after buy-out removal). RAS RPAs keep their own breach-remedy instead.
- **B2B RPA also got**: the 3% sourcing/admin fee covenant item (xi) + LOD zip 19702.
- **12-year rule enforced: NO buy-out** — removed from RTHM 12-year (7 ¶ + 4 residual phrases).
- **Created `B2B RPA (12-year)_Template.docx`** (ops): B2B base + the 3 proven 12-year deltas
  (merged Designee-preserving sale sentence, "Term:" labels, no buy-out).
- **RTHM x RAS RPA** synced ops→app (pagination-only diff). All templates byte-verified, rendered,
  eyeballed; rules matrix (buyout/rescission per family) ALL OK. Backups in scratchpad.

## 2. 12-year RPAs wired into the app (code, committed)
- All three 12-year templates byte-copied into app Templates; **auto-selection live**:
  `parseInt(deal.lockedDeal.term) === 144` → 12-year variants. `App.jsx` handleNavigateToRPA
  (entry) + handleNavigateToRAS (RAS leg inherits via `is12` in the handoff payload — the
  "save both RPAs" pair can never mix terms). `RPAForm.jsx`: `baseFilename` (12-year suffix
  stripped) drives all filename-keyed behavior; saved agreement types stay base types
  (linked-state intact); generated docs named "(12-year)". Verified live end-to-end with
  AJ McQueen (real 144 B2B deal): full chain incl. RAS handoff + Margin Fee auto-calc;
  84-month + unlocked deals resolve regular (all-87-deals branch proof).

## 3. Tracker realignment: INITIAL QUOTE + POST FEES (code + data, committed)
The Google tracker (hardcoded import source, `RAS_RTHM_TASKS_03.31.26v1` / "Deals" gid 944936958)
changed layout. App re-plumbed:
- **Bands**: initialQuote ← K–T ("Initial quotes"); postFees ← AR–BA ("RTHM net offer, before
  arbitrage"). Letter-keyed storage (cell provenance). variableQuote/grossQuote/percent DEAD.
- **Sourcing**: postFees = working numbers (RTHM VALUATION, 11% margin seeds, deal-sheet fields),
  fallback initialQuote. **PR math (PR UPLIFT + deal-sheet PR fields) anchors to INITIAL QUOTE**
  (user decision) — FE + server mirrored, old FE/BE PR asymmetry eliminated.
- **Fees**: import captures col F (adminFee) + G (rthmDistroFee), MAX across a deal's account
  rows (mixed-fee deals warned). POST FEES header badges `admin X.XX%` `distro X.XX%` (non-zero
  only). RPA ", RTHM" platform-append now keyed on rthmDistroFee > 0 (both prefill paths).
- **NO re-import** (import ENDPOINT APPENDS — re-import would duplicate deals!): one-time
  migration of deals.json — initialQuote ← old resolvedInitial (IQ→GQ), postFees ← old working
  resolution (VQ→IQ→GQ) — **1,720-value penny-identity independently re-derived vs backup**
  (`scratchpad/BACKUP_deals_20260722-233113.json`); fees backfilled from tracker (86/86 matched).
- **Audits**: 3 sweeps to zero (caught+fixed a 3rd hasVQ variant in RPAForm's deal-change path +
  a stale comment); FE/BE pairs string-identical; live UI proof on JayBenz (5%/10% fees: tables
  differ correctly, badges render, margin = 11% of postFees to the dollar, PR marketing from
  initial); Roykeisha penny-regression; sheet-rows endpoint serves the 24 new columns.

## 🧭 Current state
- App RUNNING with everything live (backend restarted with new code; verified via API + UI).
  Watch: the dev stack keeps orphaning from the harness — if ports busy but "no preview",
  kill `*App Files*` node PIDs and preview_start `rthm-app-win`.
- All committed + pushed this save (verify git status).
- deals.json: 86 deals, new model, JayBenz valuationState seeded during verification (expected).

## ⏭️ Next / open
1. **/underwrite integration** — task #4, awaiting user instructions (skill fully ingested).
2. First real 12-year RPA generation + first fee-bearing deal-sheet export — exercise live.
3. Carried: Tyga/Lil Sheik parser; container Lifetime spot-check; diligence stage-marker e2e;
   James Avex reconcile; startup ~11s module load (optional).
