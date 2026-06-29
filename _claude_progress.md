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

### Design system
New schemas documented: Persistent Run Monitor, container rows, **Purple Clickable Text** (hover → new
`--primary-hover` #4400B0 token; the only 2 instances are the container name + the DATA MANAGER back title).

## 🧭 Current state
- App Files repo `master`: this session's app changes committed + pushed.
- This push ALSO sent a pre-existing local commit **d4f829c** ("Fix Data Manager pivot parser drift + add
  annual cadence support", by Richard Kim 2026-06-28, penny-exact verified) that was sitting unpushed.
- **Server restart needed** for this session's `server/index.js` changes (skill-runs ledger, container
  rollup/endpoint, host-tagging) to go fully live — HMR only reloads the front end.
- Left untracked on purpose: `node_modules (Yanel Fils-aime's conflicted copy 2026-06-11)/` — a Dropbox
  conflict copy, NOT committed; safe to delete.
- Verified: `vite build` clean + `node --check server/index.js` clean.

## ⏭️ Next / open tasks
1. On a live restart, spot-check a container's **Lifetime == Σ its catalogs' Lifetimes** (penny-exact).
2. Diligence/extract stage bar only advances once the `[stage]` markers fire in a real run — confirm e2e.
3. Delete the stray `node_modules (… conflicted copy …)/` junk dir when convenient.
4. Pre-existing James Avex grand-total reconcile gap (orthogonal, flagged earlier sessions).
