# RTHM App — Claude Code Directives

---

## Session Start
- Always read `_claude_progress.md` at the start of every session before doing anything.
- Also read `docs/v2_specs.md` — the full v2 royalty pipeline spec (statement merger, projection model, advance/IRR calculator, modularity rule). This is the source of truth for v2 work.
- Also read `docs/design_system.md` — the living visual + interaction reference (glass, pill buttons, liquid hover, disabled-state suppression, tooltips, modals, headers, etc.). Source of truth for all UI work. Pattern that appears in 2+ places goes here.
- When the user says **"save session"**, write a concise `_claude_progress.md` covering:
  1. What was accomplished this session
  2. Where we left off / current state
  3. What's next / open tasks
- After writing `_claude_progress.md` on "save session", run `git status` and report any uncommitted changes (modified, staged, or untracked files) to the user. Do NOT auto-commit — only notify. The user will decide whether to commit manually.

---

## Change Control
- Only change what is explicitly asked. Nothing more.
- Never modify working code unless directly required by the request.
- New code must never break existing functionality, UI, or styles.
- If something adjacent seems worth changing, ask before touching it.

---

## Spec-First Workflow
- For any non-trivial feature: explain the full plan before writing a single line of code.
- When gathering specs across multiple steps, end each explanation with "understand?" and wait for the next instruction — do not code until the user says go.
- When the user says "explain next steps" or "explain back to me" — do exactly that, no code.
- Get explicit permission ("go", "yes", "do it") before executing.
- List exactly what will be removed before removing anything, especially files.

---

## Feature Removal & Cleanup
- When a feature or approach is abandoned, remove ALL of it — every prop, ref, state, import, CSS rule, and file related to it. No stubs, no dead code, no "just in case" remnants.
- When stripping a feature, clearly separate what stays (infrastructure) from what goes (interaction/logic being rebuilt).
- Orphaned files, unused imports, and dead CSS must be removed. Run periodic audits.
- When auditing: only remove with 100% certainty. If ambiguous, leave it and flag it.
- List what will be deleted and get confirmation before deleting any file.

---

## Iteration Style
- If repeated patching isn't working, propose starting that section from scratch.
- When starting fresh, identify and preserve infrastructure (rendering, state, CSS positioning) and strip only the interaction/logic layer.
- Tradeoffs belong to the user — present options clearly, state the tradeoff explicitly, wait for the user to decide. Never silently make a tradeoff.

---

## Functional Consistency — New Pages & Components
- When adding a new page or component with a header, immediately add its header class to the arcade toggle selector in `MainArea.jsx` (`handleContextMenu`).
- When adding any new page or component, audit all existing cross-cutting behaviors (arcade toggle, window focus re-fetch, prefill flows, back navigation) and apply them where relevant — do not wait to be asked.
- Functional consistency is not optional. If an existing feature works a certain way across all pages, new pages must match.

---

## Modularity — Data Manager & Deal Manager
- Data Manager and Deal Manager are completely separate modules — own data, own state, own API endpoints, no cross-dependencies.
- V3 will hook the two together, but v2 must keep them decoupled so each can be built and tested independently.
- Never import Deal Manager state/data into Data Manager or vice versa. No shared hooks, no shared data files.

---

## Data Integrity (CORE RULE)

Data is sacred. There are two protected layers that downstream code must never corrupt or get wrong — and on top of those, all math must be perfect.

**Layer 1 — Source data.** The raw distributor/publisher statements (CSV / XLS / XLSX). The single source of truth. Never tamper.

**Layer 2 — Diligence workbooks.** The outputs of the `diligence` skill (`<deal> - Diligence Workbook.xlsx`). Derived directly from source data and required to be **100% accurate** to it — no drift, no estimation, no rounding shortcuts. The app reads from these; every downstream metric depends on them being faithful.

**Rules:**

- **Never tamper with source files.** Source files are read-only from the app's perspective — never write to, rename, move, or delete them.
- **Never tamper with diligence workbooks.** The app reads from them; never modify them in place.
- **Diligence workbook contents must be 100% faithful to source data.** Any value in the workbook must trace exactly to its source row/column.
- **Never corrupt source data in memory or in persisted form.** Standardization, normalization, and reformatting happen on derived copies, never on the source row.
- **Preserve originals alongside normalizations.** If a column name is normalized, keep the original. If a value is cleaned, the raw value must remain accessible.
- **Encoding handling must be lossless.** BOM stripping, delimiter detection, and encoding fallback must never silently alter character data. Log anything that changes.
- **Every derived number must be auditable back to its source.** A user must be able to trace any value (merged dataset, pivot, projection, advance calc, key metric, tooltip number) back to the exact source file, row, and column it came from.
- **All math must be perfect — no mistakes.** Sums, averages, percentages, CAGR, IRR, share calculations, period-window boundaries: every formula must be financially correct and produce identical results to a manual hand-calculation. No floating-point sloppiness left unhandled. No off-by-one window edges. No silent fallback to wrong defaults. No counting "entries" when you mean "calendar months". If you're unsure whether a calculation matches the intended financial definition, ask before shipping.
- **Fail loud, not silent.** If a file can't be parsed cleanly, surface the error — never skip the row, fudge a value, or guess.

---

## Common Mistakes — Never Repeat
- **Ref-to-state conversion**: if `useRef` is changed to `useState`, update every `.current` reference in JSX and handlers immediately. Missing `.current` silently breaks rendering.
- **Pointer-events side effects**: changes to `pointer-events` cascade in non-obvious ways. Trace the full event flow before implementing.
- **Adding visible UI elements unprompted**: never add a visible div, header, label, or container that wasn't explicitly requested.
- **/simplify must not change behavior**: after any simplify pass, verify all existing functionality still works. If simplify changes logic, revert that part.
- **CSS overflow + flex interactions**: adding `display: flex` or `flex: 1` to a scroll container can break child `height: 100%` — use `flex: 1` on the child instead.

---

## Communication
- Responses must be short and direct. No preamble, no summary at the end.
- Before coding: one sentence stating what is changing and why.
- Flag tradeoffs if two valid approaches exist.
- State what was intentionally left unchanged when relevant.
- Ask before assuming scope on ambiguous requests.

---

## Debugging
- Diagnose before fixing. State the root cause explicitly.
- Read the relevant files before suggesting any fix.
- Fix the actual problem, not the symptom. If unsure, say so.

---

## Code Quality
- Simplest solution that works. No unnecessary abstractions or future-proofing.
- Delete unused code immediately. No commented-out blocks, no orphaned components.
- Follow existing naming conventions — no new patterns introduced mid-project.
- Every build must run clean on first launch.
- Flag any new dependencies explicitly.

---

## UI & Design — LOCKED
UI design is locked. Do not change colors, gradients, typography, sidebar, or spacing unless explicitly asked.

### Colors
- `--primary: #5200BE` (dark purple — buttons, accents, DEAL MANAGER title)
- `--primary-dark: #3A0090` (hover state)
- `--primary-mid: #6218C8`
- `--primary-light: #EAE0FF`
- `--primary-faint: #F4F0FF`
- `--ink: #050508` (main text — essentially black with a barely-perceptible cool hint)
- `--ink-light: #6B6580` (placeholders only)
- `--ink-faint: #7E7898` (disabled states only)
- `--sidebar-text: #EDE6FF` (sidebar nav text)
- `--primary-soft: #A78BFA` (soft lavender — sidebar active, orb palette)
- `--primary-deep: #241050` (deep near-black purple — sidebar hover, orb palette)

### Sidebar
- Background: `var(--sidebar-bg) url('/sidebar-bg.png') center top / cover no-repeat`
- Logo: `<img src="/logo.png">` at 28px height
- Nav text: `12px`, `font-weight: 700`, `color: var(--white)`, `letter-spacing: 0.08em`, uppercase

### Main Area
- Background gradient: `linear-gradient(to bottom, #DACEFD 0%, #FAFAFA 75%)`
- Applied on `.main-area` in MainArea.css

### Deal Manager Page
- Title color: `var(--primary)`
- Row hover: `rgba(82,0,190,0.08)`

### Valuation Page
- Rate inputs: centered text, no spin buttons
- Set Recoup / Edit Recoup toggle buttons below RTHM Valuation table

### Text & Copy
- All placeholder and empty-state text is **lowercase**, except proper nouns (e.g. Google Sheets, Monday.com)
- All new UI elements must exactly match the style of existing similar elements
- Never introduce new visual patterns when an existing one applies
