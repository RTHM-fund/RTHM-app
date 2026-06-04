# Claude Progress — Session Save (2026-06-03) — diligence EFTYPE fix, invoice → Word, entity dropdown

## ✅ Accomplished

### 1. Diligence button broken → FIXED + verified  (committed `e726ac4`, pushed)
- **Root cause:** the Claude desktop app auto-updated to `2.1.160`, whose `claude.exe` is a **corrupt/unrunnable binary** (valid x64 PE header, but Windows refuses it — "not a valid application for this OS platform" → `spawn EFTYPE`). The prior `2.1.156` still runs. `findClaudeBin()` picked the newest existing exe (`2.1.160`) → spawn failed; the bad path was also cached in `logs/.claude-bin`, and self-heal only fired on ENOENT (not EFTYPE), so it failed on every click.
- **Fix (`server/index.js`):**
  - `claudeBinRuns(p)` — probes `claude --version` (status 0) before trusting any binary. Applied at the in-memory cache, disk cache, PATH hit, and bundle scan. A corrupt newest version is skipped → falls back to the last working version. **Verified:** selection now rejects 2.1.160, picks 2.1.156.
  - Self-heal extended to invalidate the cache on **EFTYPE / EACCES / ENOENT** in both the sync spawn-throw and async `error` paths.
  - **Fire-and-forget background runs:** subprocess is now `detached: true` + `unref()` writing stdout/stderr to **inherited file descriptors** (not piped through the server) → a run **survives closing the browser/app**. **Verified live:** a detached `claude -p` answered "4" to the log *after its parent process had already exited*.
  - **Durable double-run guard `skillRunInFlight()`** (PID-liveness via the `[spawn] pid=…` log line + `process.kill(pid,0)`) so a run that outlives a server restart can't be double-started and corrupt its own workbook. RUNNING_SKILLS still covers same-process.
- Server boots clean, endpoints respond, `node --check` clean.

### 2. Invoice PDF one-off text edit (pdf skill, not code)
- Changed **"(Wires)" → "(Paper & electronic)"** in `~/Downloads/RTHM Invoice_SPV Formation Fee.pdf` (the 121000358 routing number is the ACH/paper&electronic one, so the relabel is a correction). Subsetted Calibri → redact + redraw in real Calibri; verified only that line changed; font re-subset to 135 KB. Original overwritten in place.

### 3. Invoice export: PDF → Word `.docx`  (committed `c83c5cc`, pushed)
- `/api/save/invoice` now writes the filled `.docx` **straight to `~/Downloads`** (same `fillDocx → writeFileSync` pattern as agreement creation) instead of LibreOffice→PDF. Removed the `%TEMP%` write/delete, the LibreOffice conversion + error branch, and `pdfName`; returns `docName`. Frontend unchanged.
- **Verified** standalone: valid `.docx` written from the real template. **Heads-up:** exported docx ≈ 8 MB (template's embedded images, uncompressed — identical to how agreement `.docx` exports already behave).

### 4. Entity dropdown unreadable / oversized → FIXED  ⚠️ **UNCOMMITTED**
- Files: `src/components/InvoiceForm.jsx`, `src/components/InvoiceForm.css`.
- **Bleed-through:** the `ComboInput` menu (`.combo-dropdown`) rendered in-flow (`position:absolute`, z-10) among the form's glass inputs, so its `backdrop-filter` couldn't mask the sibling `.field-input`s (glass-in-glass failure) → see-through. **Fix:** `createPortal` to `<body>`, `position:fixed`, z-index 1000 — same mechanism as `.combobox-menu` (the working dropdowns). Outside-click now exempts `.combo-dropdown`.
- **Too wide:** was measuring the *wrapper* (a full-column-width 520px flex item). **Fix:** measure the **input element** (`inputRef`) so the menu width/left matches the field box. Covers From + To Entity.

### Discussed, no code change (by user decision)
- **Valuation "2-decimal lock"** on RTHM Advance: editing the advance back-solves a recoup rate rounded to 2 dp, then re-derives the advance from it; at RAS Recoup 50,400 each 0.01% ≈ $5, so advances quantize (29,679 → 58.89% → 29,681). It's a pick-2-of-3 tradeoff with the 2 dp display rule. **User: "leave it."**
- **Blank "Initial Quote (net of 3% fee)" (sheet cols AP–AW):** deal still imports (needs only a name in col A); `sumCol` returns `null` for an all-blank column → Initial Quote table shows "—", RTHM Valuation math reads `null` as 0 → silently produces $0. Fails quiet, not loud.

## 🧭 Current state
- **Pushed to `origin/master`:** `e726ac4` (diligence), `c83c5cc` (invoice docx). Branch otherwise clean except the dropdown work + runtime data.
- **App is running** (server PID was 29352 on :3001, vite on :5173). That server has the **diligence fix** (loaded when the user relaunched) but **NOT** the invoice-docx change (`c83c5cc` landed after the relaunch). The dropdown fix is frontend → Vite **HMR'd it live**, but it's **uncommitted**.

## ⏭️ Next / open tasks
1. **Restart the app** (`RTHM Launch.bat`) to load the invoice → `.docx` export (`c83c5cc`) — the running server still has the old PDF-export code.
2. **Eyeball + commit the entity dropdown fix** (`InvoiceForm.jsx` + `InvoiceForm.css`) — currently uncommitted (HMR-tested live).
3. Carryover (older): diligence **data columns** for `diedlonely` / `Super Miles` / `Teddi Gold` still "—" (workbook sheet-naming the summary parser doesn't handle).

## Uncommitted files
- `src/components/InvoiceForm.jsx`, `src/components/InvoiceForm.css` (entity dropdown fix — awaiting eyeball + commit)
- `data/deals.json` (runtime data — intentionally left uncommitted all session)
- `_claude_progress.md` (this file)
