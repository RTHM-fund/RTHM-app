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

### Sparkline / Lifetime "0" fix — per-platform rep/adj selection (real root cause)
Kendall Deals rows showed 0 Lifetime + flat sparklines (State Of Mine, DJ TOPO, Lijpe) or a wildly-low value
(OwnBoss $3,195 vs ~$548K). **Root cause: the rep-vs-adj line choice was GLOBAL, not per-platform.**
`computeWorkbookSummaryInner` summed every platform's reported series into `repLine` and every platform's
adjusted series into `adjLine`, then chose `adjMatchesRep ? repLine : adjLine`. A workbook with only "Rep"
sheets (no "Adj" sheets) has an all-zero `adjLine` that still differs from rep → it picked the zero line
(State Of Mine/DJ TOPO/Lijpe → 0). A MIXED workbook (some accounts have Adj sheets, some only Rep — e.g.
OwnBoss) had its rep-only accounts dropped to zero in the global `adjLine` → $3,195. **Fix:** choose rep vs
adj **per platform** (adj only when that platform has adjusted data that differs from reported, else rep), then
combine — the same basis the track walk + Valuate page already use, so the line is now consistent with the
per-track lifetimes. The earlier "cache guard" hypothesis was wrong (a fresh server still computed 0) and was
reverted. **Verified live**: State Of Mine $1,606,924, DJ TOPO $2,378,354, Lijpe $1,312,348, OwnBoss $548,163
(matches the ~$548K expectation). Tyga shows $19.7M but 0 tracks — its per-track parser still can't read its
format (pre-existing "fails by design"), untouched by this fix.

## 🧭 Current state
- App Files repo `master`: app/code changes committed + pushed. The per-platform rep/adj fix supersedes the
  reverted cache guard (commit 946dbcb).
- An earlier push also carried a pre-existing local commit **d4f829c** ("Fix Data Manager pivot parser drift +
  add annual cadence support", Richard Kim 2026-06-28, penny-exact verified).
- **Dev server is RUNNING** (background `npm run dev` from `App Files/`, ports 3001 + 5173) with the fix live;
  Kendall Deals values verified via the API. The backend does NOT watch files — any further `server/index.js`
  edit needs a manual restart (kill 3001 → `npm run dev`). Boot prewarm takes ~70s before the API responds.
- **`data/deals.json` left UNcommitted on purpose** — it has an unrelated Deal Manager change (7 deals removed
  incl. Igor Mamet; 60 del / 15 ins). Looks like runtime/cross-machine-sync churn, not this session's work.
  Awaiting the user's call on whether to commit it.
- Untracked junk, NOT committed: `node_modules (Yanel Fils-aime's conflicted copy 2026-06-11)/` (Dropbox
  conflict copy) and `src/components/DataManagerPage.css.tmp.2076.823b6c07d983` (orphaned editor write-temp).
  Both safe to delete.
- Verified: `node --check server/index.js` clean; live API spot-check of all flagged deals.

## ⏭️ Next / open tasks
1. **Tyga (and Lil Sheik) still show 0 tracks** — per-track parser can't read their format ("fails by design").
   Tyga now shows a $19.7M series total but no track breakdown; revisit if a real fix is wanted.
2. Decide on `data/deals.json` (commit the deal removals or revert) + delete the two untracked junk files.
3. Spot-check a container's **Lifetime == Σ its catalogs' Lifetimes** (penny-exact) in the live UI.
4. Diligence/extract stage bar only advances once the `[stage]` markers fire in a real run — confirm e2e.
5. Pre-existing James Avex grand-total reconcile gap (orthogonal, flagged earlier sessions).
