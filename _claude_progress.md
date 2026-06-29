# Claude Progress — Session Save (2026-06-29)

## ✅ Accomplished

### Spec Kit walkthrough → Diligence Run Monitor (feature 001)
Walked the full SDD cycle (constitution → specify → clarify → plan → tasks → analyze → implement).
Artifacts in `<RTHM App root>/specs/001-diligence-run-monitor/` + ratified
`<root>/.specify/memory/constitution.md` (v1.0.0). **These live at the RTHM App ROOT — Dropbox-synced,
NOT in the App Files git repo.**

**Diligence Run Monitor** (`DiligenceMonitor.jsx`/`.css`, `useSkillRuns.js`, `server/index.js`):
- Persistent, draggable, always-on-top glass panel at the App root; survives page nav; bottom-anchored
  (grows upward, never clips); soft-fade name truncation (app schema).
- Honest **named-stage progress** (`[stage] i/n` markers added to diligence + catalog-extract SKILL.md —
  logging only, in the Dropbox Data tree); **loud failures** with classified `failureKind`
  (tooling_unavailable incl. 401/auth, rate_limit, process_error).
- `GET /api/data/skill-runs` read-only ledger: `classifyRun` from logs (pid probe + markers),
  `succeeded` gated on real output (no false completions), re-attach to detached in-flight runs.
- **Adaptive per-account cap**: configurable ceiling `DILIGENCE_MAX_CONCURRENT` (default 2) + auto-backoff
  on `rate_limit`, recover after 2 clean completions; trigger disabled at cap + 409 backstop.
- **Host-tagging**: runs carry `os.hostname()`; a foreign (other-machine) in-flight run shows "running",
  not a false "failed" (logs/ syncs via Dropbox).

### claude CLI auth fixed
Diligence 401s were a stale OAuth token (`auth status` said logged-in but calls 401'd). Re-ran
`claude auth login`; verified `AUTHOK` headless. `.claude-bin` cleared (self-heals to the Windows bundle).

### Data Manager — Container Folders (`!`-folders)
`!`-prefixed `1. Current/` folders = collections of catalogs. Purple clickable name (`!` dropped) →
drills into its catalogs (`?path=` on `/api/data/folders`); back via the DATA MANAGER title / Backspace
(drill state lifted to `App.jsx`, routed through `handleGoBack`); **pinned to top**; **X/N** done counts;
**right-way rollup** (`computeContainerRollup` = virtual mega-catalog: combined top-80% / dollar-age /
sparkline). `computeWorkbookSummary` math is UNTOUCHED — only `keys` + `trackInfos` appended to its return.
X/N done counts render as plain ink table text (`--ink`, weight 500) — not the bold purple of the numeric
columns (`complete`/green class removed).

### Design system
New schemas documented: Persistent Run Monitor, container rows, **Purple Clickable Text** (hover → new
`--primary-hover` #4400B0 token; the only 2 instances are the container name + the DATA MANAGER back title).

### Sparkline / Lifetime "0" fix — cache hardening (NOT a math bug)
Several Kendall Deals rows (State Of Mine, DJ TOPO, Lijpe, OwnBoss) showed 0 Lifetime + flat sparklines.
**The engine is correct** — replicating the exact `buildSeries` pipeline on State Of Mine's workbook yields
**$1,606,924** (DK $356,923 + TC $878,617 + YT $371,382; annual DK/TC + monthly YT headers all parse). The
running server had **cached a transient bad read**: the workbook was read while a Dropbox online-only
placeholder was still downloading (sheets present → tracks counted, but series totals empty → 0), and the
mtime-keyed `summaryCache` then pinned that wrong 0. Fix: `computeWorkbookSummary` now **refuses to cache an
internally-inconsistent read** (`trackCount > 0 && !lifetime`) — it recomputes on the next request instead of
pinning a 0. A restart clears the already-poisoned entry.

## 🧭 Current state
- App Files repo `master`: all this session's app/code changes committed + pushed (incl. the sparkline cache guard).
- An earlier push also carried a pre-existing local commit **d4f829c** ("Fix Data Manager pivot parser drift +
  add annual cadence support", Richard Kim 2026-06-28, penny-exact verified).
- **Server restart required** to (a) load the `server/index.js` changes (skill-runs ledger, container
  rollup/endpoint, host-tagging, sparkline cache guard) — HMR only reloads the front end — AND (b) clear the
  poisoned `summaryCache` entry so the Kendall Deals 0-Lifetime rows recompute to their real values.
- **`data/deals.json` left UNcommitted on purpose** — it has an unrelated Deal Manager change (7 deals removed
  incl. Igor Mamet; 60 del / 15 ins). Looks like runtime/cross-machine-sync churn, not this session's work.
  Awaiting the user's call on whether to commit it.
- Untracked junk, NOT committed: `node_modules (Yanel Fils-aime's conflicted copy 2026-06-11)/` (Dropbox
  conflict copy) and `src/components/DataManagerPage.css.tmp.2076.823b6c07d983` (orphaned editor write-temp).
  Both safe to delete.
- Verified: `node --check server/index.js` clean.

## ⏭️ Next / open tasks
1. **After restart, confirm the Kendall Deals rows recomputed** — State Of Mine ≈ $1.6M, sparklines filled.
2. Decide on `data/deals.json` (commit the deal removals or revert) + delete the two untracked junk files.
3. On a live restart, spot-check a container's **Lifetime == Σ its catalogs' Lifetimes** (penny-exact).
4. Diligence/extract stage bar only advances once the `[stage]` markers fire in a real run — confirm e2e.
5. Pre-existing James Avex grand-total reconcile gap (orthogonal, flagged earlier sessions).
