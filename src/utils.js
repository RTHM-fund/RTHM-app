export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export function getTypeLabel(filename) {
  const base = filename.replace('.docx', '')
  const idx = base.lastIndexOf('_')
  return idx !== -1 ? base.substring(0, idx) : base
}

export function isAmountField(field) {
  const f = field.toLowerCase()
  return f.includes('amount') || f.includes('advance') || f.includes('fee') || f.includes('budget')
}

// Format a percentage VALUE to exactly 2 decimal places for display/output (e.g. 40 → "40.00",
// "40.5%" → "40.50"). Strips any %/commas first. DISPLAY-ONLY — never feed the result back into
// math; the underlying numeric value is unchanged. Returns '' for empty/non-numeric input.
export function formatPct(v) {
  if (v === null || v === undefined || v === '') return ''
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n.toFixed(2) : ''
}
