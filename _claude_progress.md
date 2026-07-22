# Claude Progress — Session Save (2026-07-22, evening)

## ✅ Accomplished

### NSU Global — full B2B partner onboarding (COMPLETE, max-effort audited)
New B2B client onboarded app-wide, **zero code changes** (integration is fully data-driven):

**Created (Templates live at `<RTHM App root>\Templates\` — Dropbox-synced, OUTSIDE git):**
- `Templates\Deal Sheets\NSU Global Deal Sheet_Template.docx` (4.7MB)
- `Templates\Offer Letters\NSU Global Offer Letter_Template.docx` (4.7MB)
- `App Files\data\b2b-partners.json` → "NSU Global" entry (committed): Entity **No Switching Up
  LLC**, Address **1130 Grayson Oaks Drive, Lawrenceville, GA, 30045, USA**, Signer **Kendall
  Newsome**, Title **Owner**, Website **https://nsu.global** (extracted from the KYB folder docs at
  `…\1. RTHM Fund\5. Partners\No Switching Up\No Switching Up_KYB\`; user signed off).
- Logo asset (user-saved): `…\5. Partners\No Switching Up\NSU Logo.png` (3000², transparent).
- **No RPA file by design** — all B2B partners share `B2B RPA_Template.docx`; NSU's RPA data
  autofills from the registry (RPAForm.jsx:266 fetch → all 6 registry keys exist verbatim as
  {{fields}} in the RPA template — verified 6/6).

**Design (user-approved):** cloned from the Skyline pair; page background `#CDD1D6` light steel
(`<w:background>`), full white→ink text flip to `#26282B` (163+12 / 222+1 occurrences — safe
because the bases have ZERO shaded cells), logo masthead 0.90″ tall aspect-true (header drawing
extents patched wp:extent+a:ext), embedded odttf brand fonts carried over.

**Build pipeline (repeatable):** scratchpad clone → media swap → XML edits → rezip →
mechanical QC (field-set diff vs base 32=32; docxtemplater dry-render with the server's exact
options `delimiters {{ }}` per server/index.js:866; leftover sweep) → LibreOffice→pymupdf render
→ eyeball EVERY page → install → live wire-check. Scripts in scratchpad (`build_nsu.py` etc.).

**Render loop caught (would have shipped otherwise):** the offer letter's brand text is stylized
"**$kyline**" (dollar-sign S — invisible to a "Skyline" grep; 15 occurrences → "NSU Global" /
"NSU Distribution"); two split-run "NSU Capital" artifacts; an orphan space in "Why use NSU
Global?". Also: default docxtemplater delimiters are single-brace — always test with the server's
options.

**Final audit (all pass):** installed files SHA==build, zip parts==base, sweep clean, fields 32=32
via both raw-XML and the server's mammoth endpoint, renderer OK, registry API live-verified,
sidebar Templates + Valuation B2B modal verified in the LIVE UI (Otega deal; modal cancelled, no
writes), name round-trip (deal-sheet filename → partner "NSU Global" → offer-letter file exists,
App.jsx:408), siblings untouched, zero hardcoded partner names in code. NOT exercised (write
ops, all links proven individually): actual deal-sheet POST, RPA generation from a real NSU deal,
partner-modal PUT — first real NSU deal exercises them.

### Valuation margin seed: 10% → 11% (committed this session)
`MARGIN_PCT = 0.11` in BOTH `ValuationPage.jsx` AND server `effectiveRatesFor` (the mirror —
see memory). Verified live: Bobby Shmurda's unsaved 144mo seed 33.54→33.17 exactly as solved;
Roykeisha saved rates untouched; margin Δ within 2dp bound. FE/BE constants audited IN SYNC.

### RPA templates synced from ops (late evening — outside git, Templates dir)
User designated `…\4. Operations\1. Templates\3. Agreements\` copies as canonical. Result:
- **RTHM RPA_Template.docx** — app copy was ALREADY byte-identical (no action).
- **RTHM x RAS RPA_Template.docx** — swapped in the ops version (same doc, 4 revisions newer).
  ONLY difference: pagination cleanup (removed a page break after clause 40 — old p9 was mostly
  empty; sections 8–10 now flow; signature block clean on p13). Legal text 100% identical —
  verified per-part hash diff + 14-page render compare of both versions, reflowed pages eyeballed.
- Verified: installed SHA == ops (both), app's docxtemplater renders both (server options), server
  fields endpoint returns full sets incl. every RPAForm-hardcoded field, exactly one copy of each
  RPA template in the app tree. **No restart needed** (field sets identical → cache fine;
  generation reads the file fresh per request). Scratchpad backup deleted after confirmation
  (Dropbox version history retains the old file). B2B RPA untouched.
- Note: there is NO 12-year/144-specific RPA template (user asked; verified inside all 3 RPAs —
  term is a generic {{Estimated Term}} field; the only "twelve" is a statements-lookback clause).

### Google Sheets "disconnect" — false alarm (diagnosed)
Token + refresh flow healthy (forced a live refresh — OK; scope spreadsheets.readonly). The
"disconnected" UI was just the backend being down (dev stack orphans). Restarted → connected=true.
If it recurs: check the app is running before re-authing.

## 🧭 Current state
- **App RUNNING** under harness preview `rthm-app-win` (backend 3001 + Vite 5173). Note the
  preview server has repeatedly orphaned between turns — if ports are busy but harness says no
  server, kill PIDs with `*App Files*` cmdline and preview_start again.
- App Files `master`: this session's 4 commits pushed (registry entry; margin 11%; deals.json now
  87 deals; progress). Verify `git status` clean except the junk dir.
- Untracked junk (delete when confirmed): `node_modules (RTHM Fund's conflicted copy 2026-07-03)/`.
- Earlier today (already pushed): margin-rule rewrite (offsets → margin = % of RAS advance,
  fe7c823) + its server-mirror fix.

## ⏭️ Next / open tasks
1. **First real NSU Global deal** — exercises deal-sheet generation, RPA autofill, partner modal
   end-to-end (all pre-verified individually).
2. **/underwrite integration** — still pending user instructions (skill fully ingested; see
   2026-07-08 save + memory).
3. Delete the conflict-copy junk dir when confirmed.
4. Wording check (user flagged OK to revisit): offer letter "$kyline Capital"→"NSU Global",
   "$kyline Distribution"→"NSU Distribution" — 2-minute patch if different wording wanted.

Carried over: Tyga/Lil Sheik 0-track parser; container Lifetime spot-check; diligence stage-marker
e2e; James Avex reconcile gap; startup ~11s module-load (optional).
