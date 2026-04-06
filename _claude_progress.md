# Claude Progress — Session Save

## Accomplished This Session

### Invoice Template Feature (New)
- Template with `{{#items}}` loop, FROM/TO/payment placeholders
- InvoiceForm.jsx: ComboInput, RTHM entity auto-fill, line items auto-calc, notes with bullet points, PDF export to Downloads
- Server endpoint POST /api/save/invoice

### Monday.com Integration Expanded
- B2B Partner Push: dropdown column fuzzy match, hooked into Deal Sheet creation + PATCH b2b-partner
- Commission/Margin Push: to Monday Commission column when recoup locked

### Valuation Page Updates
- Commission/Margin locked when recoup set, editable via Edit Recoup
- "B2B Margin" → "Margin"
- Swapped RTHM Advance and RAS Recoup columns
- Tables auto-size (align-items: flex-start on section, flex: 0 0 auto on tables-row)

### PR Uplift Table (Offer Letter Modal)
- Reordered: Term → Total Deal → Advance Amount → Marketing Budget → Recoup Rate → Recoup Amount

### Math Tooltips (Global `.calc-tip` in index.css)
- All calculated values across ValuationPage, OfferLetterForm, RPAForm, InvoiceForm

### Cross-Platform + Multi-User
- Dynamic DROPBOX_RTHM, resolveAgreementPath(), relative folderPath
- RTHM Launch.command uses $HOME/Dropbox path
- postinstall.js auto-chmod's .command files on Mac
- Setup.command icon uses NSWorkspace API

### Server Reliability
- Heartbeat: tracks activeConnections, only shuts down when all tabs closed
- Field extraction: cache + retry with 2s delay for Dropbox sync
- Removed dead execSync import

### Cleanup
- Removed all green notification boxes
- .margin-tip → global .calc-tip
- Dead variables removed (m1, m2, advTip, execSync)

### Git
- Local git repo initialized, initial commit

### Known Mac Issue
- Logos/images don't display if Dropbox smart sync has public/ files as cloud-only
- Fix: right-click public/ folder in Finder → Make Available Offline
- Not a code bug — Dropbox serving placeholder files instead of actual content

---

## Current State
App fully functional. Cross-platform (Windows/Mac). Zero code bugs. Clean build, zero dead code.

---

## What's Next
- Mac: make public/ and Templates/ folders "Available Offline" in Dropbox
- Live multi-user testing
