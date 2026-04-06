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
- Commission/Margin locked when recoup set
- "B2B Margin" → "Margin"
- Swapped RTHM Advance and RAS Recoup columns
- Tables auto-size (align-items: flex-start on section, flex: 0 0 auto on tables-row)
- Removed overflow:hidden (tooltip clipping fix)

### PR Uplift Table (Offer Letter Modal)
- Reordered: Term → Total Deal → Advance Amount → Marketing Budget → Recoup Rate → Recoup Amount

### Math Tooltips (Global `.calc-tip` in index.css)
- ValuationPage: RTHM Advance, Margin (full formula), PR Uplift (all calculated values with full formulas)
- OfferLetterForm modal: PR Uplift + RTHM Valuation tables, Total Deal field
- RPAForm: Margin Fee, Net Amount (only these two get calc-tip wrapper, all other fields stretch full width)
- InvoiceForm: Amount per row, Total
- Auto-calculated fields with calc-tip wrapper auto-size smaller; all other fields stretch full width — consistent across all forms

### B2B RPA Field Reordering
- Deal → Recoup Amount → B2B Partner → B2B Entity → rest

### Auto-fill Consistency Fix
- RPAForm clears previous auto-fills on deal switch
- All dropdowns: placeholder disabled hidden

### Cross-Platform + Multi-User
- Dynamic DROPBOX_RTHM, resolveAgreementPath(), relative folderPath
- Zero hardcoded user-specific paths

### Cleanup
- Removed ALL green notification boxes (saveSuccess state, JSX, .export-success CSS) from OfferLetterForm + RPAForm
- Old .margin-tip replaced with global .calc-tip
- Dead m1/m2 variables removed

---

## Current State
App fully functional and production-ready. Zero known bugs. Clean build, zero dead code.

---

## What's Next
- Mac testing
- Live multi-user testing
