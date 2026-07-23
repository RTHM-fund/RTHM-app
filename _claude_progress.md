# Claude Progress — Session Save (2026-07-23)

Short session. Two fixes, both audited and live.

## 1. B2B RTHM Deal Sheet filename collision — FIXED (server/index.js, committed)
**Problem (diagnosed):** every agreement filename is derived from `deal.name` + a
type/partner prefix and written into two flat shared folders (`Temp Agreements` for
`.docx`, `Deal Sheets` for `.pdf`). `createDoc` does a raw `fs.writeFileSync` — same path =
silent overwrite. So two deal *instances* of the same name (e.g. Individual "MC Delux" +
B2B "MC Delux") both minted `RTHM Deal Sheet_MC Delux.docx` → the same physical file →
creating/exporting one clobbered the other.

**Fix:** one-line ternary at `server/index.js:966` (create-agreement, inside `if (!b2bOnly)`):
B2B deals now emit `RTHM Deal Sheet (B2B)_<name>.docx`; Individual path unchanged.
- `typeLabel` stays `'Deal Sheet'` and the name still `startsWith('RTHM Deal Sheet')`, so
  EVERY consumer is unaffected: agreementDefs matchers (RTHM row / B2B-row exclusion),
  `deal-sheet-tables` reader (738/740), export-pdf, delete's partner-clear guard (1075),
  and DealsPage's valuation "linked" state (132). No other edits needed.
- Go-forward only — no migration of existing deals (user decision).
- Multiple same-name B2Bs share one `(B2B)` file — fine: the RTHM sheet uses base `fields`
  only (margin/partner feed ONLY `b2bFields` → the partner sheet), so those are byte-identical.

**Scope decision (settled):** Offer Letters + RPAs evaluated and deliberately left unchanged —
they don't silently auto-collide. Individual makes "RTHM Offer Letter_" vs B2B's distinct prefix;
the RPA filename is a user-editable field (defaults to deal name but changeable). The auto-derived
Deal Sheet name was the ONLY guaranteed silent clash. Do not re-raise.

**Live proof (non-destructive, snapshot/restore):** B2B deal "Otega" (already had an
Individual-named sheet on disk) generated `RTHM Deal Sheet (B2B)_Otega.docx`; the
`RTHM Deal Sheet_Otega.docx` file was byte-identical before/after (10,415,934 bytes, same
mtime). deals.json restored, test artifact deleted, zero footprint.

## 2. B2B template dropdown labels — cleaned up (Valuation + Agreements, committed)
The two B2B "create deal sheets" modal dropdowns showed "NSU Global Deal Sheet" etc.
Added `.replace(/\s*Deal Sheet$/i, '')` to the label so they read just "Earl Jam /
NSU Global / Skyline / TopValley". Label-only — `value: t.filename` untouched, so the save
flow + partner derivation are unaffected. Both sites (AgreementsPage:295, ValuationPage:478)
fixed identically; confirmed those are the only two.

## 🧭 Current state
- App running (backend restarted on :3001 with new code; Vite :5173). All changes live.
- Committed + pushed this save.
- Dev stack still orphans from the harness — if ports busy but "no preview", kill
  `*App Files*` node PIDs and `preview_start rthm-app-win`.

## ⏭️ Next / open
Nothing left from this session — deal-sheet fix is done, committed, pushed. Standing backlog only:
1. /underwrite integration — task #4, awaiting user instructions (skill fully ingested).
2. Carried: first real 12-year RPA gen + first fee-bearing deal-sheet export; Tyga/Lil Sheik
   parser; container Lifetime spot-check; diligence stage-marker e2e; James Avex reconcile.
