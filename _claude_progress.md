# Claude Progress — Session Save (2026-07-22)

## ✅ Accomplished

### Valuation page — NEW auto-set rule: margin-based seeding (committed this session)
Replaced the starting-Recoup-Rate rule in `src/components/ValuationPage.jsx`. **Old:** RAS rate −
per-term point offsets (`OFFSETS`, Individual 6/5/4/4/3, B2B 2pts tighter). **New (user-specified):**
each term's seed is the rate that makes the RTHM Valuation **MARGIN = exactly 10% of that term's
RAS advance** (`MARGIN_PCT = 0.10`) — the exact inverse of the Margin column, mirroring the Margin
cell's manual onBlur solve:
- B2B: `rthmAdvance = adv − 0.10·adv` → rate = rthmAdvance/rec × 100 (2 dp)
- Individual: `rthmAdvance = (adv − 0.10·adv) / (1 + commission/100)` (commission resolved once as
  `seedCommission` = savedState → deal → 4, shared with the commission state init; `savedState`
  hoisted above the seed — hydration behavior unchanged, overwrite-bug comment preserved)
- Fill-blanks-only unchanged: only terms with both adv+rec seed; **saved/tuned rates always win**.
- `Math.max(0,…)` kept (guards negative quote cells).

### Audit catch — server-side mirror was stale (fixed, same session)
`server/index.js` had a DUPLICATE of the old offset rule: `OFFSETS` + `effectiveRatesFor` ("Mirrors
ValuationPage so the exported rate equals the on-screen rate"), used by
`GET /api/deals/:index/deal-sheet-tables` (~line 725→780) and `POST …/create-agreement` (~880→895)
for any term WITHOUT a saved rate. Left as-was, deal-sheet reads/exports would have diverged from
the UI. Fixed to the identical margin-based inverse with the same seedCommission resolution
(server-side: `vs.commission ?? parseFloat(deal.commission) || 4` — no session cache on the server).
**`OFFSETS` deleted from both files; codebase-wide grep = zero references.**
⚠️ STANDING TRAP (memory written): the FE seed (`ValuationPage.jsx` startDefaults) and server
`effectiveRatesFor` implement THE SAME rule in two places — any future change must edit BOTH.

### Verification / audit evidence (max-effort pass)
- Hand-math exact: adv 100k / rec 125k → B2B 72.00% & margin 10,000; IND@4% 69.23% & margin 10,000.
- FE live regression (Roykeisha Rockette): saved 74.61/62.10/52.95/46.15 rendered exactly; cross-tied
  internally at its 6% commission.
- API regression (idx 49): deal-sheet-tables returns saved rates exactly (fallback untriggered).
- **API live proof of new rule** (Bobby Shmurda idx 32, 144mo never saved): returns **33.54** — the
  predicted new seed to the digit; implied margin Δ −$14 on a $995K recoup (within bound).
- Rounding bound (honest): 2 dp rate storage ⇒ margin within ±0.005% of RAS recoup of exact 10%
  (+$0.50 display). Worst real case: Victor Thell 84mo ($3.77M recoup) → ±$208 ≈ 0.1% of its target
  margin. Same convention as manually typing a margin.
- **Impact on existing data:** 77/79 quote-bearing deals unchanged (full saved rates win). Exactly 2
  deals gain a seed, both on never-saved 144mo terms only: Bobby Shmurda → 33.54, Lambo4oe (#52) →
  42.63. New rule otherwise manifests on future deals.
- Accepted by design: commission-at-open seeding (margin drifts if commission edited later); B2B
  margin has no commission term so its seed = 0.9 × RAS rate exactly.

### Preview/dev-server via harness launch config (NEW, this session)
`<RTHM App root>/.claude/launch.json` (OUTSIDE the App Files git repo; Dropbox-synced) now has a
**Windows** entry `rthm-app-win`: `cmd /c npm run dev --prefix "App Files"`, port 5173 — plain
`npm`/absolute paths break on Windows spawn quoting ("C:\Program" error). The pre-existing
`rthm-app` entry is the **Mac** one (`/usr/local/bin/npm`) — left untouched. Watch for
harness-orphaned dev-stack processes holding 3001/5173 after a preview stop: kill PIDs with
`*App Files*` in the command line, then preview_start again.

## 🧭 Current state
- App Files `master`: this session's commits pushed; in sync with origin (verify with git status).
- **App is RUNNING** under the harness preview (`rthm-app-win`, backend 3001 + Vite 5173) with all
  changes live. Backend still needs a manual restart after any `server/index.js` edit.
- deals.json: 79 deals (one removed via normal app usage during the July gap), valid JSON, committed.
- Untracked junk still present (NOT committed, safe to delete on confirmation):
  `node_modules (RTHM Fund's conflicted copy 2026-07-03)/`.
- Earlier this session (already committed + pushed previously): startup prewarm event-loop fix
  (`5417af9`), stuck-diligence-run PID-reuse classifier fix (`3ca3571`).

## ⏭️ Next / open tasks
1. **/underwrite integration** — skill fully ingested (Data tree `.claude/skills/underwrite/`:
   SKILL.md + methodology.md + decay_playbook.md + build_underwrite.py). User will give integration
   instructions. Notes: emits `UNDERWRITE i/6` stdout markers (run-monitor-ready); output
   `<DEAL> Quote.xlsx` may collide with the v2 quote-engine filename; brief > methodology.md where
   they disagree (first payment = EOMONTH(close,3); I5 uses interest rate; last_actual_month /
   first_pay_month exist in builder schema).
2. Delete the conflict-copy `node_modules` junk dir when confirmed.
3. (Optional) startup residual: ~11s Node module-load before listen; Option D disk-persist summary
   cache — neither needed for the resolved complaint.

Carried over: Tyga/Lil Sheik 0-track parser ("fails by design"); container Lifetime == Σ catalogs
spot-check; diligence/extract stage-marker e2e confirm; James Avex grand-total reconcile gap.
