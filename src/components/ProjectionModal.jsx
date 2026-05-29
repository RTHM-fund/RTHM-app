import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import './ProjectionModal.css'

// Spec defaults (from V2 royalty pipeline spec, PART 3).
const PORTFOLIO_DEFAULTS = {
  k0: 0.06,
  k_inf: 0.015,
  gamma: 0.7,
  floor_pct: 0.5,
  haircut: 0.1,
  baseline_override: null,
}

// Number field config — label + step + valid range from the spec.
const FIELDS = [
  { key: 'k0',                label: 'k0 (initial decay)',       step: 0.01, min: 0, max: 0.5 },
  { key: 'k_inf',             label: 'k_inf (tail decay)',       step: 0.005, min: 0, max: 0.2 },
  { key: 'gamma',             label: 'gamma (transition speed)', step: 0.05, min: 0, max: 1.0 },
  { key: 'floor_pct',         label: 'floor %',                  step: 0.05, min: 0, max: 0.8 },
  { key: 'haircut',           label: 'haircut',                  step: 0.01, min: 0, max: 0.5 },
  { key: 'baseline_override', label: 'baseline override (blank = auto)', step: 1, min: 0 },
]

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Accent colors for the projection chart overlays.
const COLOR_HISTORICAL = '#5200BE'
const COLOR_PROJECTED  = 'rgba(82, 0, 190, 0.35)'
const COLOR_BASELINE   = '#14B8A6'    // teal
const COLOR_DECAY      = '#FB7185'    // coral

// Custom tooltip content — recharts' default colors each row by the line's
// stroke. We want the projected row to read as ink (the projected stroke is
// faint light-purple and reads as low-contrast text in the tooltip).
// Portal-rendered chart tooltip. Renders into document.body so it escapes ALL
// parent overflow / stacking contexts (the modal body's overflow-y: auto would
// otherwise clip and trigger a horizontal scrollbar). Position computed from
// the chart container's viewport rect + recharts' chart-space coordinate.
// pointer-events: none guarantees no interference with anything beneath.
function ProjectionTooltip({ active, payload, label, coordinate, chartHostRef }) {
  if (!active || !payload || payload.length === 0) return null
  const visible = payload.filter(item => item.value != null)
  if (visible.length === 0) return null
  const rect = chartHostRef && chartHostRef.current
    ? chartHostRef.current.getBoundingClientRect()
    : null
  if (!rect) return null
  const x = rect.left + (coordinate && coordinate.x ? coordinate.x : 0)
  const y = rect.top  + (coordinate && coordinate.y ? coordinate.y : 0)
  return createPortal(
    <div style={{
      position: 'fixed',
      left: x + 14,
      top: y - 14,
      transform: 'translateY(-100%)',
      pointerEvents: 'none',
      zIndex: 10000,
      fontSize: 12,
      background: 'rgba(255, 255, 255, 0.45)',
      backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      borderRadius: 'var(--radius)',
      boxShadow: '0 4px 20px rgba(82,0,190,0.08)',
      isolation: 'isolate',
      padding: '8px 12px',
    }}>
      <div style={{ color: 'var(--ink)', marginBottom: 4, fontWeight: 600 }}>{label}</div>
      {visible.map(item => {
        const color = item.dataKey === 'projected' ? 'var(--ink)' : item.color
        let formatted
        if (item.dataKey === 'decay') {
          // Decay row shows the per-period decay rate (%), not the curve's dollar value.
          const rate = item.payload && item.payload.decayRate
          formatted = Number.isFinite(rate) ? (rate * 100).toFixed(1) + '%' : '—'
        } else {
          formatted = Number.isFinite(item.value)
            ? item.value.toLocaleString('en-US', { maximumFractionDigits: 0 })
            : item.value
        }
        return (
          <div key={item.dataKey} style={{ color }}>
            {item.name || item.dataKey}: {formatted}
          </div>
        )
      })}
    </div>,
    document.body
  )
}

// Numbers in JS stringified for input value; baseline_override is null until set.
function paramsToFormState(p) {
  return {
    k0: p.k0 != null ? String(p.k0) : '',
    k_inf: p.k_inf != null ? String(p.k_inf) : '',
    gamma: p.gamma != null ? String(p.gamma) : '',
    floor_pct: p.floor_pct != null ? String(p.floor_pct) : '',
    haircut: p.haircut != null ? String(p.haircut) : '',
    baseline_override: p.baseline_override != null ? String(p.baseline_override) : '',
  }
}

function formStateToParams(s) {
  const n = (v) => {
    if (v === '' || v == null) return null
    const f = parseFloat(v)
    return Number.isFinite(f) ? f : null
  }
  return {
    k0: n(s.k0),
    k_inf: n(s.k_inf),
    gamma: n(s.gamma),
    floor_pct: n(s.floor_pct),
    haircut: n(s.haircut),
    baseline_override: n(s.baseline_override),
  }
}

// Strip non-numeric chars + leading zeros from a decimal string input.
// Mirrors the pattern used on ValuationPage's rate inputs so typing "02"
// → "2" without waiting for blur, while preserving "0.06" / "0." / ".5".
// Strips commas first so paste-from-formatted-display round-trips cleanly.
function cleanNumeric(raw) {
  let v = String(raw == null ? '' : raw)
    .replace(/,/g, '')                 // strip thousands separators
    .replace(/[^0-9.]/g, '')           // digits + dots only
    .replace(/(\..*)\./g, '$1')        // keep first dot only
    .replace(/^0+(?=\d)/, '')          // strip leading zeros before a digit
  return v
}

// Format a raw cleaned string with thousands-separator commas in the whole
// part. Preserves the decimal point and any trailing digits/zeros so the
// cursor doesn't jump while mid-typing decimals. No-op when whole part < 1000.
function withCommas(raw) {
  if (raw == null || raw === '') return ''
  const s = String(raw)
  const dotIdx = s.indexOf('.')
  const whole = dotIdx === -1 ? s : s.slice(0, dotIdx)
  const dec   = dotIdx === -1 ? '' : s.slice(dotIdx)
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + dec
}

// Apply a max ceiling to an already-cleaned numeric string. Returns either the
// cleaned string (accepted) or null (reject — caller keeps prev state). Empty
// / lone "." / trailing-"." are always accepted as partial input mid-typing.
function clampMax(cleaned, max) {
  if (max == null) return cleaned
  if (cleaned === '' || cleaned === '.' || cleaned.endsWith('.')) return cleaned
  const n = parseFloat(cleaned)
  if (!Number.isFinite(n)) return cleaned
  return n > max ? null : cleaned
}

// Fields whose max < 1 must always start with "0." once the user starts typing.
// gamma (max 1.0) is excluded — "1.0" is a legitimate value for it.
const ZERO_LOCKED_KEYS = new Set(['k0', 'k_inf', 'floor_pct', 'haircut'])

// Fields where ↑/↓ arrow keys step the value by the field's `step`. Only the
// sub-1 step fields participate — integer / dollar-amount fields don't.
const STEP_KEYS = new Set(['k0', 'k_inf', 'gamma', 'floor_pct', 'haircut'])

// How many decimal places the step value carries (0.005 → 3, 0.05 → 2, 0.01 → 2).
function decimalPlaces(step) {
  const s = String(step)
  const i = s.indexOf('.')
  return i === -1 ? 0 : s.length - i - 1
}

// Format a stepped number back to a clean string at the step's precision —
// strips trailing zeros after the dot and a bare trailing dot so "0.20" → "0.2"
// without forcing "1.0" → "1." for an integer result. Then re-applies the zero
// prefix for zero-locked fields.
function formatStepped(value, step, key) {
  const dp = decimalPlaces(step)
  let s = value.toFixed(dp).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  if (ZERO_LOCKED_KEYS.has(key)) {
    const enforced = ensureZeroPrefix(s)
    if (enforced != null) s = enforced
  }
  return s
}

// Ensure the cleaned string starts with "0." for the zero-locked fields. Empty
// string is allowed (means "use default"). Returns null when the user typed
// something like "1.5" that can never start with "0." after cleaning — caller
// rejects the keystroke.
function ensureZeroPrefix(cleaned) {
  if (cleaned === '') return ''
  if (cleaned === '0' || cleaned === '.') return '0.'
  if (cleaned.startsWith('0.')) return cleaned
  if (cleaned.startsWith('.')) return '0' + cleaned
  if (cleaned.includes('.')) return null     // "1.5", "12.3" — reject
  return '0.' + cleaned                      // plain digits → "0.5", "0.06"
}

// "YYYY-MM" → "MMM YY" display label matching the on-page chart format.
function keyToLabel(key) {
  if (!key || typeof key !== 'string') return ''
  const [y, m] = key.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m)) return key
  return `${MONTH_NAMES[m - 1]}${String(y).slice(-2)}`
}

// Add n months to a "YYYY-MM" key, returning a new YYYY-MM key.
function advanceKey(key, n) {
  const [y, m] = key.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}`
}

// Compute baseline + decay projection per V2 spec PART 3.
// Returns { baseline, floor, longAvg, projected[], decayUnclamped[] }.
// projected is floor-clamped; decayUnclamped is the pure exponential
// (baseline shape) without the floor — used for the gold "decay curve" line.
function computeProjection(historicalValues, params, stepMonths, nPeriods) {
  const safeVals = (historicalValues || []).filter(v => Number.isFinite(v))
  if (safeVals.length === 0 || nPeriods <= 0) {
    return { baseline: 0, floor: 0, longAvg: 0, projected: [], decayUnclamped: [] }
  }
  const last3 = safeVals.slice(-Math.min(3, safeVals.length))
  const shortAvg = last3.reduce((a, b) => a + b, 0) / last3.length

  const monthsHistory = safeVals.length * stepMonths
  const tMonths = Math.min(12, monthsHistory)
  const tPeriods = Math.max(1, Math.min(safeVals.length, Math.ceil(tMonths / stepMonths)))
  const last12 = safeVals.slice(-tPeriods)
  const longAvg = last12.reduce((a, b) => a + b, 0) / last12.length

  const w = Math.min(1, monthsHistory / 12)
  const rawBaseline = w * shortAvg + (1 - w) * longAvg
  let baseline = rawBaseline * (1 - (params.haircut || 0))
  if (params.baseline_override != null && Number.isFinite(params.baseline_override)) {
    baseline = params.baseline_override
  }

  const floorPct = params.floor_pct || 0
  const floor = Math.max(baseline * floorPct, longAvg * floorPct)

  const k0 = params.k0 || 0
  const kInf = params.k_inf || 0
  const gamma = params.gamma || 0

  let cumDecay = 0
  const projected = []
  const decayUnclamped = []
  for (let p = 1; p <= nPeriods; p++) {
    const k_p = kInf + (k0 - kInf) * Math.exp(-gamma * stepMonths * (p - 1))
    cumDecay += k_p * stepMonths
    const projVal = floor + (baseline - floor) * Math.exp(-cumDecay)
    projected.push(projVal < floor ? floor : projVal)
    decayUnclamped.push(baseline * Math.exp(-cumDecay))
  }
  return { baseline, floor, longAvg, projected, decayUnclamped }
}

export default function ProjectionModal({ folderPath, graphId, graphName, chartData, stepMonths, lastHistoricalKey, onClose }) {
  const [form, setForm] = useState(paramsToFormState(PORTFOLIO_DEFAULTS))
  const [years, setYears] = useState(15)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  // Catalog graphs (chart:total / chart:adjusted) fetch the canonical TOTAL
  // projection from the server (per-track decay then sum) instead of running
  // computeProjection on the already-summed historical line — they're not
  // mathematically equivalent under the non-linear baseline / floor / decay
  // operations. Track graphs continue to use client-side computeProjection
  // (correct for single-track decay). Audit fix.
  const isCatalog = graphId === 'chart:total' || graphId === 'chart:adjusted'
  const [serverProjection, setServerProjection] = useState(null)
  const previewDebounceRef = useRef(null)
  // Chart container ref — used by the portal tooltip to position itself in
  // viewport coords (escapes all parent overflow contexts).
  const chartHostRef = useRef(null)

  // Pre-fill priority on open:
  //   1. saved params for this graph
  //   2. catalogDefaults (only if this is a track graph)
  //   3. spec defaults
  useEffect(() => {
    if (!folderPath || !graphId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    fetch(`/api/data/projection-params?folder=${encodeURIComponent(folderPath)}`)
      .then(r => r.json())
      .then(data => {
        let resolved = null
        if (graphId === 'chart:total' || graphId === 'chart:adjusted') {
          resolved = data.catalogDefaults
        } else if (graphId.startsWith('track:')) {
          const label = graphId.slice('track:'.length)
          resolved = data.trackOverrides && data.trackOverrides[label]
            ? data.trackOverrides[label]
            : data.catalogDefaults
        }
        setForm(paramsToFormState(resolved || PORTFOLIO_DEFAULTS))
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [folderPath, graphId])

  // Reporting cadence (12 = monthly, 4 = quarterly, 2 = semi-annual).
  const periodsPerYear = stepMonths > 0 ? 12 / stepMonths : 12
  const periods = Math.max(1, Math.round(years * periodsPerYear))

  function handleField(key, value) {
    let cleaned = cleanNumeric(value)
    if (ZERO_LOCKED_KEYS.has(key)) {
      cleaned = ensureZeroPrefix(cleaned)
      if (cleaned === null) return  // "0." can't be honored → reject
    }
    const fieldMax = (FIELDS.find(f => f.key === key) || {}).max
    const result = clampMax(cleaned, fieldMax)
    if (result === null) return  // exceeded threshold → reject keystroke
    setForm(prev => ({ ...prev, [key]: result }))
  }

  // ↑/↓ arrow key handler for the 5 step-enabled fields. Clamps to [0, max]
  // and formats to the step's natural precision so 0.05+0.05 displays as 0.1
  // instead of 0.1000000000000001.
  function handleArrowStep(key, direction) {
    if (!STEP_KEYS.has(key)) return
    const f = FIELDS.find(x => x.key === key)
    if (!f || !Number.isFinite(f.step)) return
    const current = parseFloat(form[key])
    const base = Number.isFinite(current) ? current : 0
    const next = direction === 'up' ? base + f.step : base - f.step
    const clamped = Math.max(0, f.max != null ? Math.min(next, f.max) : next)
    setForm(prev => ({ ...prev, [key]: formatStepped(clamped, f.step, key) }))
  }

  function handleYearsChange(value) {
    const cleaned = cleanNumeric(value)
    const y = parseFloat(cleaned)
    if (Number.isFinite(y) && y >= 0) setYears(y)
    else if (cleaned === '') setYears(0)
  }

  function handlePeriodsChange(value) {
    const cleaned = cleanNumeric(value)
    const p = parseInt(cleaned, 10)
    if (Number.isFinite(p) && p >= 0) {
      const y = p / periodsPerYear
      setYears(y)
    } else if (cleaned === '') {
      setYears(0)
    }
  }

  // Client-side projection (used for track graphs — single-track decay,
  // mathematically correct on a single historical series).
  const clientProjection = useMemo(() => {
    const historicalValues = (chartData || []).map(r => r.total)
    return computeProjection(historicalValues, formStateToParams(form), stepMonths, periods)
  }, [chartData, form, stepMonths, periods])

  // Catalog mode — fetch canonical TOTAL projection from the server.
  // Debounced 250ms after the last keystroke. Sends the current form values as
  // catalogDefaults so the user sees what saving these params would produce.
  useEffect(() => {
    if (!isCatalog || !folderPath) return
    if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current)
    previewDebounceRef.current = setTimeout(() => {
      const defaults = formStateToParams(form)
      fetch('/api/data-manager/projection-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: folderPath, defaults, nPeriods: periods }),
      })
        .then(r => r.json().then(body => ({ ok: r.ok, body })))
        .then(({ ok, body }) => {
          if (!ok) { setServerProjection(null); return }
          setServerProjection(body)
        })
        .catch(() => setServerProjection(null))
    }, 250)
    return () => previewDebounceRef.current && clearTimeout(previewDebounceRef.current)
  }, [isCatalog, folderPath, form, periods])

  // Unified projection source — server values for catalog, client values for
  // track. The shape is normalized to { baseline, floor, longAvg, projected[],
  // decayUnclamped[] } so the chart-building memo below is mode-agnostic.
  // For catalog while waiting on the first server response, return an empty
  // projection so the chart never briefly renders the incorrect client math
  // (decay-on-already-summed-TOTAL — not equivalent to per-track-then-sum).
  const projection = useMemo(() => {
    if (isCatalog) {
      if (serverProjection && Array.isArray(serverProjection.projection)) {
        const projected = serverProjection.projection.map(p => p.value)
        // Catalog decay curve = sum of per-track unclamped decays (computed server-side,
        // per-track-then-sum — consistent with the projected line, not decay-on-summed-total).
        const decayUnclamped = serverProjection.projection.map(p => Number.isFinite(p.valueUnclamped) ? p.valueUnclamped : null)
        const baseline = Number.isFinite(serverProjection.totalBaseline) ? serverProjection.totalBaseline : 0
        const floor    = Number.isFinite(serverProjection.totalFloor)    ? serverProjection.totalFloor    : 0
        return { baseline, floor, longAvg: baseline, projected, decayUnclamped }
      }
      return { baseline: 0, floor: 0, longAvg: 0, projected: [], decayUnclamped: [] }
    }
    return clientProjection
  }, [isCatalog, serverProjection, clientProjection])

  // Build extended chart data: historical rows (unchanged) + projected rows
  // appended. Each row carries fields for the 4 lines so recharts can draw
  // them off the same dataset.
  const fullChartData = useMemo(() => {
    const baseline = projection.baseline
    const historicalRows = (chartData || []).map(r => ({
      month: r.month,
      historical: r.total,
      projected: null,
      baseline,
      decay: null,
      decayRate: null,
    }))
    // Anchor the projected line to the last historical point so the two
    // lines visually connect (no gap at the join).
    if (historicalRows.length > 0 && projection.projected.length > 0) {
      const last = historicalRows[historicalRows.length - 1]
      historicalRows[historicalRows.length - 1] = { ...last, projected: last.historical, decay: baseline, decayRate: null }
    }
    const projectedRows = []
    let nextKey = lastHistoricalKey
    // Per-period decay rate = 1 − decay/previous-decay (how much the decay curve
    // drops each period). First projected period is measured against the baseline.
    let prevDecay = baseline
    for (let i = 0; i < projection.projected.length; i++) {
      nextKey = nextKey ? advanceKey(nextKey, stepMonths) : null
      const d = projection.decayUnclamped[i]
      const decayRate = (Number.isFinite(d) && Number.isFinite(prevDecay) && prevDecay !== 0)
        ? 1 - d / prevDecay
        : null
      projectedRows.push({
        month: nextKey ? keyToLabel(nextKey) : `+${i + 1}`,
        historical: null,
        projected: projection.projected[i],
        baseline,
        decay: d,
        decayRate,
      })
      prevDecay = d
    }
    return [...historicalRows, ...projectedRows]
  }, [chartData, projection, stepMonths, lastHistoricalKey])

  function handleApply() {
    setSaving(true)
    setError(null)
    const params = formStateToParams(form)
    fetch('/api/data/projection-params', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: folderPath, graphId, params }),
    })
      .then(r => r.json().then(body => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        setSaving(false)
        if (!ok) { setError(body.error || 'save failed'); return }
        onClose()
      })
      .catch(err => {
        setSaving(false)
        setError(err.message)
      })
  }

  const titleYears = Math.max(1, Math.round(years))
  const title = `${titleYears} year projection: ${graphName}`

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal projection-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
        </div>

        <div className="projection-modal-body">
          <div className="projection-modal-chart" ref={chartHostRef}>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={fullChartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(82,0,190,0.08)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6B6580' }} interval="preserveStartEnd" minTickGap={24} />
                <YAxis tick={{ fontSize: 11, fill: '#6B6580' }} width={80} tickFormatter={v => Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'} />
                <Tooltip
                  content={(props) => <ProjectionTooltip {...props} chartHostRef={chartHostRef} />}
                  wrapperStyle={{ display: 'none' }}
                  allowEscapeViewBox={{ x: true, y: true }}
                />
                {/* Baseline (orange) — flat reference across the whole chart */}
                <Line type="monotone" dataKey="baseline" stroke={COLOR_BASELINE} strokeWidth={1.5} dot={false} activeDot={false} isAnimationActive={false} />
                {/* Decay curve (gold) — pure exponential, no floor clamp; spans projected range */}
                <Line type="monotone" dataKey="decay" stroke={COLOR_DECAY} strokeWidth={1.5} dot={false} activeDot={false} isAnimationActive={false} />
                {/* Projected statement revenue (light primary) — smooth line, no dots
                    (at 30 years of monthly cadence the 360 dots overwhelm the chart). */}
                <Line type="monotone" dataKey="projected" stroke={COLOR_PROJECTED} strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false} />
                {/* Historical (primary) — original RTHM purple line, unchanged */}
                <Line type="monotone" dataKey="historical" stroke={COLOR_HISTORICAL} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="projection-modal-form">
            <div className="projection-field">
              <label>years</label>
              <input
                className="field-input"
                type="text"
                inputMode="decimal"
                value={withCommas(Number.isFinite(years) ? (Number.isInteger(years) ? String(years) : years.toFixed(2)) : '')}
                onChange={e => handleYearsChange(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="projection-field">
              <label>periods</label>
              <input
                className="field-input"
                type="text"
                inputMode="numeric"
                value={withCommas(String(periods))}
                onChange={e => handlePeriodsChange(e.target.value)}
                disabled={loading}
              />
            </div>
            {FIELDS.map(f => (
              <div className="projection-field" key={f.key}>
                <label>{f.label}</label>
                <input
                  className="field-input"
                  type="text"
                  inputMode="decimal"
                  value={withCommas(form[f.key])}
                  onChange={e => handleField(f.key, e.target.value)}
                  onKeyDown={STEP_KEYS.has(f.key) ? (e => {
                    if (e.key === 'ArrowUp')   { e.preventDefault(); handleArrowStep(f.key, 'up') }
                    if (e.key === 'ArrowDown') { e.preventDefault(); handleArrowStep(f.key, 'down') }
                  }) : undefined}
                  disabled={loading}
                />
              </div>
            ))}
          </div>

          {error && <p className="projection-modal-error">{error}</p>}
        </div>

        <div className="projection-modal-footer">
          <button className="modal-cancel" onClick={onClose}><span>close</span></button>
          <button className={`modal-import-btn${saving ? ' is-processing' : ''}`} onClick={handleApply} disabled={saving || loading}><span>{saving ? 'saving...' : 'save'}</span></button>
        </div>
      </div>
    </div>
  )
}
