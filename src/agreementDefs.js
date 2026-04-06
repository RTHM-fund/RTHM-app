export const ROW_DEFS = {
  Individual: ['RTHM Deal Sheet', 'RTHM Offer Letter', 'RTHM RPA', 'RTHM x RAS RPA'],
  B2B: ['RTHM Deal Sheet', 'B2B Deal Sheet', 'B2B Offer Letter', 'B2B RPA', 'RTHM RPA', 'RTHM x RAS RPA'],
}

export function matchAgreement(rowLabel, agreements) {
  switch (rowLabel) {
    case 'RTHM Deal Sheet':   return agreements.find(ag => ag.fileName?.startsWith('RTHM Deal Sheet'))
    case 'B2B Deal Sheet':    return agreements.find(ag => ag.type !== 'Deal Sheet' && ag.fileName?.toLowerCase().includes('deal sheet'))
    case 'RTHM Offer Letter': return agreements.find(ag => ag.fileName?.startsWith('RTHM Offer Letter'))
    case 'B2B Offer Letter':  return agreements.find(ag => ag.fileName?.includes('Offer Letter') && !ag.fileName?.startsWith('RTHM Offer Letter'))
    case 'RTHM RPA':          return agreements.find(ag => ag.type === 'RTHM RPA')
    case 'RTHM x RAS RPA':   return agreements.find(ag => ag.type === 'RTHM x RAS RPA' || ag.type === 'RAS RPA')
    case 'B2B RPA':           return agreements.find(ag => ag.type === 'B2B RPA')
    default: return null
  }
}
