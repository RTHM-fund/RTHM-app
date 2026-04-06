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
