// pivot.js — build the V2-engine-shaped pivot from a deal's diligence workbook.
//
// Input:  path to <deal> - Diligence Workbook.xlsx
// Output: { tracks: string[], periods: ISODate[], values: number[tracks][periods], stepMonths }
//
// Parsing rules MIRROR the existing computeWorkbookSummaryInner in ../index.js
// (parseMonthHeader, isAggregateRow, platform-sheet detection, projection-section
// boundary handling, adj-vs-rep preference). The two parsers must stay in sync —
// if either changes, audit both. The duplication here is deliberate per the
// modularity rule (Data Manager is a self-contained module) and avoids
// refactoring the legacy index.js parser in this change.

const XLSX = require('xlsx')

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_MAP = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 }

// Period-header parser — MUST stay behavior-identical to parseMonthHeader in
// server/index.js:1536. Supports monthly (Aug25, Aug-21, Aug22', Aug 2025), quarterly
// (Q1-25, 1Q25, 23Q1, Q3 '14), half-yearly (22H1, H1-22, 1H23), and annual (2015, FY2023).
function parseMonthHeader(v) {
  if (v == null || v === '') return null
  if (v instanceof Date && !isNaN(v)) {
    const y = v.getFullYear(), mo = v.getMonth() + 1
    return { key: `${y}-${String(mo).padStart(2,'0')}`, label: `${MONTH_NAMES[mo-1]} ${y}` }
  }
  const s = String(v).trim()
  if (!s || /ltm/i.test(s)) return null
  let m = s.match(/^(\d{4})[-/](\d{1,2})/)
  if (m) return { key: `${m[1]}-${m[2].padStart(2,'0')}`, label: s }
  m = s.match(/^(\d{1,2})[-/](\d{4})$/)
  if (m) return { key: `${m[2]}-${m[1].padStart(2,'0')}`, label: s }
  m = s.match(/^(\d{1,2})[-/](\d{2})$/)
  if (m) return { key: `20${m[2]}-${m[1].padStart(2,'0')}`, label: s }
  // MMM YYYY / MMM-YYYY / MMM-YY (e.g. "Aug 2025", "Aug-21" — 2-digit year => 20yy)
  m = s.match(/^([A-Za-z]+)[-\s]+(\d{2}|\d{4})$/)
  if (m) {
    const mo = MONTH_MAP[m[1].slice(0,3).toLowerCase()]
    if (mo) {
      const yr = m[2].length === 4 ? m[2] : `20${m[2]}`
      return { key: `${yr}-${String(mo).padStart(2,'0')}`, label: s }
    }
  }
  // MMMyy / MMMyyyy — no separator (e.g. "Aug25", "Aug2025"); optional trailing apostrophe ("Aug22'").
  m = s.match(/^([A-Za-z]+)(\d{2,4})['’]?$/)
  if (m) {
    const mo = MONTH_MAP[m[1].slice(0,3).toLowerCase()]
    if (mo) {
      const yr = m[2].length === 4 ? m[2] : `20${m[2]}`
      return { key: `${yr}-${String(mo).padStart(2,'0')}`, label: s }
    }
  }
  // Quarterly: Q1-25, Q1 25, Q1/25, Q1'25, Q3 '14 (space+apostrophe), Q1-2025, Q12025, 1Q25, etc.
  m = s.match(/^Q([1-4])['’\-/\s]*(\d{2,4})$/i) || s.match(/^([1-4])Q(\d{2,4})$/i)
  if (m) {
    const q = Number(m[1])
    const startMo = (q - 1) * 3 + 1
    const yr = m[2].length === 4 ? m[2] : `20${m[2]}`
    return { key: `${yr}-${String(startMo).padStart(2,'0')}`, label: s }
  }
  // Year-first quarterly: 2023Q1, 23Q1 (year then quarter). Same START-month anchor.
  m = s.match(/^(\d{2,4})Q([1-4])$/i)
  if (m) {
    const startMo = (Number(m[2]) - 1) * 3 + 1
    const yr = m[1].length === 4 ? m[1] : `20${m[1]}`
    return { key: `${yr}-${String(startMo).padStart(2,'0')}`, label: s }
  }
  // Half-yearly (semi-annual): 22H1 / 2022H1 (year-first) or H1-22 / H1 2022 (H-first).
  m = s.match(/^(\d{2,4})\s*H([12])$/i)
  if (m) {
    const yr = m[1].length === 4 ? m[1] : `20${m[1]}`
    return { key: `${yr}-${m[2] === '1' ? '01' : '07'}`, label: s }
  }
  m = s.match(/^H([12])['’\-/\s]*(\d{2,4})$/i)
  if (m) {
    const yr = m[2].length === 4 ? m[2] : `20${m[2]}`
    return { key: `${yr}-${m[1] === '1' ? '01' : '07'}`, label: s }
  }
  // Half-first half-yearly: 1H23 / 2H2024 (half then year). Same start-month anchor.
  m = s.match(/^([12])H(\d{2,4})$/i)
  if (m) {
    const yr = m[2].length === 4 ? m[2] : `20${m[2]}`
    return { key: `${yr}-${m[1] === '1' ? '01' : '07'}`, label: s }
  }
  // Annual: bare calendar year (2015) or fiscal year (FY2023 / FY 23). Anchor to Jan.
  m = s.match(/^((?:19|20)\d{2})$/)
  if (m) return { key: `${m[1]}-01`, label: s }
  m = s.match(/^FY\s?(\d{2}|\d{4})$/i)
  if (m) { const yr = m[1].length === 4 ? m[1] : `20${m[1]}`; return { key: `${yr}-01`, label: s } }
  return null
}

// Platform-prefixed period headers ("BMI 22Q1", "Pulse 23H1") — some workbooks repeat
// the sheet's platform name in every period column. Returns a parser that tries the raw
// header first, then retries with the platform prefix stripped. MUST stay identical to
// parseMonthHeaderFor in server/index.js:1610.
function parseMonthHeaderFor(platformName) {
  const esc = String(platformName || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const prefixRe = esc ? new RegExp(`^${esc}[\\s–—―\\-]+`, 'i') : null
  return v => {
    const direct = parseMonthHeader(v)
    if (direct || !prefixRe || typeof v !== 'string') return direct
    const stripped = v.replace(prefixRe, '')
    return stripped === v ? null : parseMonthHeader(stripped)
  }
}

function isAggregateRow(label) {
  const s = String(label).trim()
  if (!s) return true
  if (/\btotal\b/i.test(s)) return true
  if (/\bbridge\b/i.test(s)) return true
  if (/\bless:\s/i.test(s)) return true
  if (/^layer\s+\d/i.test(s)) return true
  if (/\bstripped\b/i.test(s)) return true
  if (/^net\s+payable/i.test(s)) return true
  if (/^—?\s*memo\b/i.test(s)) return true
  if (/^source\s+field\s*:/i.test(s)) return true
  if (/^statement\s+pdf/i.test(s)) return true
  if (/^reserve\s+account/i.test(s)) return true
  if (/^\([a-z]\)\s+(reported|adjusted|less:)/i.test(s)) return true
  return false
}

// YYYY-MM key → ISO first-of-month date string ('2025-08-01')
function keyToIsoFirst(key) {
  return `${key}-01`
}

// Gap in calendar months between two YYYY-MM keys.
function monthGap(keyA, keyB) {
  const [yA, mA] = keyA.split('-').map(Number)
  const [yB, mB] = keyB.split('-').map(Number)
  return (yB - yA) * 12 + (mB - mA)
}

// Detect stepMonths from the period axis: the median gap between consecutive periods.
// Snaps to {1, 3, 6, 12} — the cadences the engine supports (monthly/qtr/half/annual).
function detectStepMonths(sortedKeys) {
  if (sortedKeys.length < 2) return 1
  const gaps = []
  for (let i = 1; i < sortedKeys.length; i++) {
    const g = monthGap(sortedKeys[i - 1], sortedKeys[i])
    if (g > 0) gaps.push(g)
  }
  if (gaps.length === 0) return 1
  gaps.sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)]
  if (median <= 1) return 1
  if (median <= 3) return 3
  if (median <= 6) return 6
  return 12
}

// A row is a period-header row if it has >=2 parseable period cells at col>=2, OR
// exactly one that is a STRONG (non-bare-year) format. This admits single-period
// sheets ("Dec23") and multi-year annual headers, while rejecting a lone stray year
// sitting in a data row (a bare "2011" among royalty values). MUST stay identical to
// isHeaderRow in server/index.js.
function isHeaderRow(cand, row) {
  const idxs = []
  for (let i = 2; i < cand.length; i++) if (cand[i]) idxs.push(i)
  if (idxs.length >= 2) return true
  if (idxs.length === 1) {
    const raw = row[idxs[0]] == null ? '' : String(row[idxs[0]]).trim()
    return !/^(?:FY\s?)?(?:19|20)\d{2}$/i.test(raw)  // a lone bare year is not enough
  }
  return false
}

// Parse a single sheet into { headerIdx, colMonths, projectionStartCol, rows }.
// Returns null if no header row is found. Shared between platform-line + per-track passes.
function parseSheet(wb, sheetName, platformName) {
  const ws = wb.Sheets[sheetName]
  if (!ws) return null
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
  if (rows.length < 3) return null
  const parseHeader = parseMonthHeaderFor(platformName)
  let headerIdx = -1
  let colMonths = null
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const cand = (rows[i] || []).map(parseHeader)
    if (isHeaderRow(cand, rows[i] || [])) { headerIdx = i; colMonths = cand; break }
  }
  if (headerIdx < 0) return null
  const headerLen = (rows[headerIdx] || []).length
  // Projection-section boundary: when a column's month key is ≤ the previous,
  // we've entered the projection block — stop reading values there.
  let projectionStartCol = headerLen
  let lastKey = ''
  for (let c = 2; c < headerLen; c++) {
    const mInfo = colMonths[c]
    if (!mInfo) continue
    if (mInfo.key <= lastKey) { projectionStartCol = c; break }
    lastKey = mInfo.key
  }
  return { rows, headerIdx, colMonths, projectionStartCol }
}

// Extract the platform-level historical TOTAL series from a set of Track sheets.
// Used only for the adj-vs-rep comparison (matches legacy server/index.js:1438-1443
// rule: if rep totals === adj totals across all months, use rep — no adjustments
// applied. Otherwise use adj). Returns Map<periodKey, totalValue>.
function platformTotalSeries(wb, entries, platformName) {
  const byMonth = new Map()
  for (const e of entries) {
    const parsed = parseSheet(wb, e.sheetName, platformName)
    if (!parsed) continue
    const { rows, headerIdx, colMonths, projectionStartCol } = parsed
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r] || []
      const a0 = row[0]; const a1 = row[1]
      const s0 = a0 == null ? '' : String(a0).trim()
      const s1 = a1 == null ? '' : String(a1).trim()
      if (!s0) continue
      // Swapped-column heuristic — see extractTrackLabel below.
      const labelStr = (/^\d{6,}$/.test(s0) && s1 && !/^\d+$/.test(s1)) ? s1 : s0
      if (!labelStr || isAggregateRow(labelStr)) continue
      for (let c = 2; c < projectionStartCol; c++) {
        const mInfo = colMonths[c]
        if (!mInfo) continue
        const cell = row[c]
        const val = typeof cell === 'number' ? cell : Number(cell)
        if (!Number.isFinite(val) || val === 0) continue
        byMonth.set(mInfo.key, (byMonth.get(mInfo.key) || 0) + val)
      }
    }
  }
  return byMonth
}

// True iff repSeries and adjSeries are element-wise identical (per the legacy
// rule at server/index.js:1438-1439).
function seriesMatch(repSeries, adjSeries) {
  if (repSeries.size === 0 && adjSeries.size === 0) return true
  const allMonths = new Set([...repSeries.keys(), ...adjSeries.keys()])
  for (const k of allMonths) {
    if ((repSeries.get(k) || 0) !== (adjSeries.get(k) || 0)) return false
  }
  return true
}

// Build the pivot from the diligence workbook.
// Returns { tracks, periods, values, stepMonths } or throws on no Track sheets.
function buildPivotFromWorkbook(wbPath, dealName) {
  const wb = XLSX.readFile(wbPath, { cellDates: true })

  // Platform-sheet detection — MUST stay byte-identical to SHEET_KIND_RE in
  // server/index.js:1128 (the canonical, proven parser). Accepts the real-world
  // tab-name variants the diligence skill emits when shortening under Excel's
  // 31-char limit: the "Trk" abbreviation, whitespace-only separators, and the
  // glued "TrkRep" form (Rep/Adj separator optional).
  // Examples: "SR1 - Track Rep", "BMI-Trk Rep", "MCDONNEL-TrkRep", "Avex Trk Rep".
  const sheetKindRe = /^(?:(.+?)[\s–—―\-]+)??(?:By\s+)?(Track|Trk|Source|Brkdn|Breakdown)\s*\(?(Rep|Reported|Adj|Adjusted)\)?\s*$/i
  const platformSheets = new Map()
  for (const sheetName of wb.SheetNames) {
    const m = sheetName.match(sheetKindRe)
    if (!m) continue
    const name = (m[1] || dealName).trim()
    const isTrack = /^(?:Track|Trk)$/i.test(m[2])
    const isAdj = /^Adj/i.test(m[3])
    if (!platformSheets.has(name)) platformSheets.set(name, [])
    platformSheets.get(name).push({ isTrack, isAdj, sheetName })
  }
  if (platformSheets.size === 0) {
    throw new Error('buildPivotFromWorkbook: no platform sheets found (need "<Platform> – Track Rep/Adj" naming)')
  }

  // Per-platform adj-vs-rep selection — mirrors the legacy auto-choose rule at
  // server/index.js:1438-1443: build BOTH rep and adj platform totals, compare
  // element-wise. If they match, USE REP (no adjustments applied). If they
  // differ, USE ADJ (analyst-curated). Fall-back chain: if chosen variant has
  // no sheets, try the other; if neither, all track-sheets.
  const perTrack = new Map() // trackKey -> Map(periodKey -> value)
  const allKeys = new Set()
  const droppedCells = []    // audit trail for non-finite cells

  for (const [platformName, entries] of platformSheets) {
    const trackOnly = entries.filter(e => e.isTrack)
    if (trackOnly.length === 0) continue  // Brkdn-only platform — skip

    const repSheets = trackOnly.filter(e => !e.isAdj)
    const adjSheets = trackOnly.filter(e => e.isAdj)

    let useEntries
    if (adjSheets.length > 0 && repSheets.length > 0) {
      const repSeries = platformTotalSeries(wb, repSheets, platformName)
      const adjSeries = platformTotalSeries(wb, adjSheets, platformName)
      const matches = seriesMatch(repSeries, adjSeries)
      useEntries = matches ? repSheets : adjSheets
    } else if (adjSheets.length > 0) {
      useEntries = adjSheets
    } else if (repSheets.length > 0) {
      useEntries = repSheets
    } else {
      continue
    }

    for (const e of useEntries) {
      const parsed = parseSheet(wb, e.sheetName, platformName)
      if (!parsed) continue
      const { rows, headerIdx, colMonths, projectionStartCol } = parsed

      // Walk rows: each non-aggregate row label is a track. Same-named tracks
      // across platforms get summed.
      for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = rows[r] || []
        const a0 = row[0]; const a1 = row[1]
        const s0 = a0 == null ? '' : String(a0).trim()
        const s1 = a1 == null ? '' : String(a1).trim()
        if (!s0) continue

        // Swapped-column heuristic (legacy server/index.js:1287-1292).
        // Some workbooks (Landstrip Chip BMI, publishing statements) store the
        // numeric Work ID in col 0 and the song title in col 1. Detect this
        // when col 0 is 6+ pure digits AND col 1 is non-numeric text — use col 1
        // as the label. Otherwise col 0.
        const labelStr = (/^\d{6,}$/.test(s0) && s1 && !/^\d+$/.test(s1)) ? s1 : s0
        if (!labelStr || isAggregateRow(labelStr)) continue

        let trackMap = perTrack.get(labelStr)
        if (!trackMap) { trackMap = new Map(); perTrack.set(labelStr, trackMap) }

        for (let c = 2; c < projectionStartCol; c++) {
          const mInfo = colMonths[c]
          if (!mInfo) continue
          const cell = row[c]
          // Non-finite numeric cells are tracked for the audit log, then dropped.
          if (cell !== null && cell !== '' && cell !== undefined) {
            const num = typeof cell === 'number' ? cell : Number(cell)
            if (!Number.isFinite(num)) {
              droppedCells.push({ sheet: e.sheetName, row: r + 1, col: c + 1, raw: cell })
              continue
            }
            // Zero cells: skip the allKeys.add to avoid axis expansion on padding
            // zeros, but still update trackMap (sum is unchanged since zero is identity).
            // Matches legacy server/index.js:1173.
            if (num === 0) continue
            trackMap.set(mInfo.key, (trackMap.get(mInfo.key) || 0) + num)
            allKeys.add(mInfo.key)
          }
        }
      }
    }
  }

  if (perTrack.size === 0) {
    throw new Error('buildPivotFromWorkbook: no track-level data found in any Track sheet')
  }
  if (allKeys.size < 3) {
    throw new Error(`buildPivotFromWorkbook: only ${allKeys.size} period(s) in data — engine requires ≥ 3`)
  }

  // Build unified periods axis (sorted YYYY-MM keys).
  const sortedKeys = [...allKeys].sort()
  const periods = sortedKeys.map(keyToIsoFirst)

  // Detect stepMonths from gaps.
  const stepMonths = detectStepMonths(sortedKeys)

  // Stable track order — by lifetime descending so the rank step downstream is
  // already biased correctly (the engine re-sorts by last3 anyway).
  const trackKeys = [...perTrack.keys()].sort((a, b) => {
    const sa = [...perTrack.get(a).values()].reduce((s, v) => s + v, 0)
    const sb = [...perTrack.get(b).values()].reduce((s, v) => s + v, 0)
    if (sb !== sa) return sb - sa
    return a.localeCompare(b)
  })

  // Build values matrix (zero-fill missing periods per track).
  const values = trackKeys.map(tk => {
    const m = perTrack.get(tk)
    return sortedKeys.map(k => m.get(k) || 0)
  })

  return {
    tracks: trackKeys,
    periods,
    values,
    stepMonths,
    _meta: {
      sourceWorkbook: wbPath,
      platformCount: platformSheets.size,
      trackCount: trackKeys.length,
      periodCount: periods.length,
      droppedCells,  // audit trail for non-finite cells the engine refused
    },
  }
}

module.exports = { buildPivotFromWorkbook, parseMonthHeader, isAggregateRow, detectStepMonths }
