// projections.js — stages 7-11 of the V2 royalty pipeline.
//   7. rank tracks by last-3-period sum, split top 80% from OTHER
//   8. per-track baseline (shortAvg / longAvg blend, haircut, override)
//   9. per-track floor (max of two candidates)
//  10. 90-month exponential decay projection
//  11. synthetic TOTAL row (sum of all per-track projections)
//
// All pure. Inputs treated as readonly. Fail loud — never silent zeros except where
// explicitly allowed by the cashflow-assembly stage downstream.

const { resolveParams, validateParams } = require('./params')

const HORIZON_MONTHS = 90
const MAX_PROJ_YEARS = 34          // hard ceiling on ANY projection horizon (export, preview, custom)
const TOP_CUMULATIVE_SHARE = 0.80

// EDATE — Excel-compatible: add `months` to `date`, clamp day to target month's last day.
function edate(date, months) {
  const d = date instanceof Date ? date : new Date(date)
  const day = d.getUTCDate()
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + months
  // Last day of target month
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(day, lastDay)))
}

function isoFirstOfMonth(d) {
  // Returns YYYY-MM-01 string
  const dt = d instanceof Date ? d : new Date(d)
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}

function mean(arr) {
  if (!arr.length) return 0
  let s = 0
  for (const v of arr) s += v
  return s / arr.length
}

function sum(arr) {
  let s = 0
  for (const v of arr) s += v
  return s
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

// Stage 7 — rank + split top 80% / OTHER.
// pivot: { tracks: string[], periods: ISODate[], values: number[tracks][periods], stepMonths }
// Returns: { topTracks: [{ key, hist, last3, rank }], other: { key:'OTHER', hist, componentKeys }, meta }
function rankAndSplit(pivot) {
  const { tracks, periods, values } = pivot
  if (!tracks || tracks.length === 0) {
    throw new Error('rankAndSplit: pivot has no tracks')
  }
  if (!periods || periods.length < 3) {
    throw new Error(`rankAndSplit: need ≥3 periods to project (got ${periods ? periods.length : 0})`)
  }
  if (!Array.isArray(values) || values.length !== tracks.length) {
    throw new Error(`rankAndSplit: values shape mismatch (${values && values.length} rows vs ${tracks.length} tracks)`)
  }

  const nPeriods = periods.length
  const last3Start = nPeriods - 3

  // Build {key, hist, last3} per track. hist is a snapshot copy (readonly input).
  const items = tracks.map((key, i) => {
    const hist = values[i].slice()
    if (hist.length !== nPeriods) {
      throw new Error(`rankAndSplit: track ${key} has ${hist.length} values, expected ${nPeriods}`)
    }
    const last3 = sum(hist.slice(last3Start))
    return { key, hist, last3, _origIdx: i }
  })

  const grandTotal = sum(items.map(it => it.last3))
  if (!(grandTotal > 0)) {
    throw new Error(`rankAndSplit: cannot rank tracks — last 3 periods total = ${grandTotal}`)
  }

  // Stable sort descending by last3 (Array.prototype.sort is stable in modern engines).
  const sorted = items.slice().sort((a, b) => {
    if (b.last3 !== a.last3) return b.last3 - a.last3
    return a._origIdx - b._origIdx  // tie-break to guarantee deterministic order
  })

  // Walk: include until cumulative share ≥ 0.80, threshold-crosser included.
  const topTracks = []
  const excluded = []
  let cum = 0
  let cumulativeShareAtCut = 0
  let crossed = false
  for (let i = 0; i < sorted.length; i++) {
    const it = sorted[i]
    if (!crossed) {
      cum += it.last3
      const share = cum / grandTotal
      topTracks.push({ key: it.key, hist: it.hist, last3: it.last3, rank: i + 1 })
      if (share >= TOP_CUMULATIVE_SHARE) {
        crossed = true
        cumulativeShareAtCut = share
      }
    } else {
      excluded.push(it)
    }
  }
  if (!crossed) cumulativeShareAtCut = cum / grandTotal  // never crossed → all included

  // OTHER bucket: element-wise sum of excluded tracks' hist.
  let otherHist
  if (excluded.length === 0) {
    otherHist = new Array(nPeriods).fill(0)
  } else {
    otherHist = new Array(nPeriods).fill(0)
    for (const it of excluded) {
      for (let p = 0; p < nPeriods; p++) otherHist[p] += it.hist[p]
    }
  }

  const other = {
    key: 'OTHER',
    hist: otherHist,
    componentKeys: excluded.map(it => it.key),
  }

  const meta = {
    keepCount: topTracks.length,
    excludedCount: excluded.length,
    cumulativeShareAtCut,
    grandTotalLast3: grandTotal,
  }

  return { topTracks, other, meta }
}

// Stage 8 — per-track baseline.
// Returns { baseline, longAvg, shortAvg, w, rawBaseline, monthsHistory }
function computeBaseline(hist, resolved, stepMonths) {
  const nPeriods = hist.length
  const shortN = Math.min(3, nPeriods)
  const shortAvg = mean(hist.slice(nPeriods - shortN))

  const monthsHistory = nPeriods * stepMonths
  const tMonths = Math.min(12, monthsHistory)
  // tPeriods = MAX(1, ROUNDUP(tMonths / stepMonths)), bounded ≤ nPeriods
  let tPeriods = Math.max(1, Math.ceil(tMonths / stepMonths))
  if (tPeriods > nPeriods) tPeriods = nPeriods
  const longAvg = mean(hist.slice(nPeriods - tPeriods))

  const w = clamp(monthsHistory / 12, 0, 1)
  const rawBaseline = w * shortAvg + (1 - w) * longAvg
  let baseline = rawBaseline * (1 - resolved.haircut)

  // Override fully replaces if finite.
  if (resolved.baseline_override !== null && resolved.baseline_override !== undefined &&
      Number.isFinite(resolved.baseline_override)) {
    baseline = resolved.baseline_override
  }

  return { baseline, longAvg, shortAvg, w, rawBaseline, monthsHistory }
}

// Stage 9 — floor.
function computeFloor(baseline, longAvg, floor_pct) {
  return Math.max(baseline * floor_pct, longAvg * floor_pct)
}

// Stage 10 — exponential decay projection.
// Horizon: `customProjPeriods` if provided (the Quote export/preview pass the full
// MAX_PROJ_YEARS horizon; the chart preview passes its "years" control), else the
// 90-month default. EVERY path is hard-capped at MAX_PROJ_YEARS — no projection may
// exceed it.
// Returns { projection: [{date, value, period}], projPeriods }
function projectDecay({ baseline, floor, k0, k_inf, gamma, stepMonths, lastHistDate, customProjPeriods }) {
  let projPeriods = Number.isFinite(customProjPeriods) && customProjPeriods > 0
    ? Math.floor(customProjPeriods)
    : Math.ceil(HORIZON_MONTHS / stepMonths)
  const capPeriods = Math.ceil(MAX_PROJ_YEARS * 12 / stepMonths)
  if (projPeriods > capPeriods) projPeriods = capPeriods
  const out = []
  let cumDecay = 0
  for (let p = 1; p <= projPeriods; p++) {
    const k_p = k_inf + (k0 - k_inf) * Math.exp(-gamma * stepMonths * (p - 1))
    const k_period = k_p * stepMonths
    cumDecay += k_period
    let value = floor + (baseline - floor) * Math.exp(-cumDecay)
    if (value < floor) value = floor  // safety clamp; math shouldn't trigger
    const valueUnclamped = baseline * Math.exp(-cumDecay)  // pure exponential, no floor — the gold "decay curve" line
    const date = isoFirstOfMonth(edate(lastHistDate, stepMonths * p))
    out.push({ date, value, valueUnclamped, period: p })
  }
  return { projection: out, projPeriods }
}

// Stages 7-11 orchestrator — build the full projections block.
// Optional opts.customProjPeriods sets the projection horizon (in periods): the Quote
// export/preview pass the full MAX_PROJ_YEARS horizon and the chart preview passes its
// "years" control; callers that omit it get the 90-month default. projectDecay hard-caps
// every path at MAX_PROJ_YEARS.
function buildProjections(pivot, params, opts) {
  const { stepMonths } = pivot
  if (![1, 3, 6, 12].includes(stepMonths)) {
    throw new Error(`buildProjections: invalid stepMonths=${stepMonths}, must be 1, 3, 6, or 12`)
  }
  const customProjPeriods = opts && opts.customProjPeriods

  // Validate defaults + every override before doing math.
  validateParams(params.defaults || {})
  for (const [trackKey, ov] of Object.entries(params.overrides || {})) {
    try { validateParams(ov) }
    catch (e) { throw new Error(`buildProjections: invalid override for ${trackKey}: ${e.message}`) }
  }

  // Stage 7
  const { topTracks, other, meta } = rankAndSplit(pivot)

  // lastHistDate = final period's ISO date
  const lastHistDate = pivot.periods[pivot.periods.length - 1]

  // Stages 8-10 per track
  function processTrack({ key, hist, ...rest }) {
    const resolved = resolveParams(key, params.defaults, params.overrides)
    const { baseline, longAvg, shortAvg, w, rawBaseline, monthsHistory } =
      computeBaseline(hist, resolved, stepMonths)
    const floor = computeFloor(baseline, longAvg, resolved.floor_pct)
    const { projection } = projectDecay({
      baseline, floor,
      k0: resolved.k0, k_inf: resolved.k_inf, gamma: resolved.gamma,
      stepMonths, lastHistDate, customProjPeriods,
    })
    return {
      key, hist, baseline, floor, projection,
      _trace: { shortAvg, longAvg, w, rawBaseline, monthsHistory },
      resolvedParams: resolved,
      ...rest,
    }
  }

  const tracksOut = topTracks.map(processTrack)
  const otherOut = processTrack(other)

  // Stage 11 — TOTAL row (sum across all projections per period)
  const projPeriods = tracksOut.length > 0 ? tracksOut[0].projection.length : otherOut.projection.length
  const totalProjection = []
  for (let p = 0; p < projPeriods; p++) {
    let v = 0, vUnclamped = 0
    for (const t of tracksOut) {
      v += t.projection[p].value
      vUnclamped += t.projection[p].valueUnclamped
    }
    v += otherOut.projection[p].value
    vUnclamped += otherOut.projection[p].valueUnclamped
    totalProjection.push({
      date: (tracksOut[0] || otherOut).projection[p].date,
      value: v,
      valueUnclamped: vUnclamped,
      period: p + 1,
    })
  }
  const total = { key: 'TOTAL', projection: totalProjection }

  return {
    tracks: tracksOut,
    other: otherOut,
    total,
    meta: {
      stepMonths,
      projPeriods,
      lastHistDate,
      ...meta,
    },
  }
}

module.exports = {
  HORIZON_MONTHS,
  MAX_PROJ_YEARS,
  TOP_CUMULATIVE_SHARE,
  rankAndSplit,
  computeBaseline,
  computeFloor,
  projectDecay,
  buildProjections,
  edate,
  isoFirstOfMonth,
}
