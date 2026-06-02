import { useState, useEffect, useMemo, useRef } from 'react'
import './QuoteModal.css'

// 7 maturity scenarios + Req — fixed across the app.
const SCENARIO_LABELS = ['18m', '24m', '36m', '48m', '60m', '84m', '144m', 'Req']

// Form fields shown in the bottom half of the modal — placement mirrors
// ProjectionModal exactly (2 cols × 3 rows after the date pair at top).
const FIELDS_TOP = [
  { key: 'investmentDate',   label: 'investment date',   type: 'date' },
  { key: 'firstRoyaltyDate', label: '1st royalty payment',  type: 'date' },
]
const FIELDS_BODY = [
  { key: 'targetIRR',   label: 'target IRR',   type: 'number', step: 0.01, min: 0, max: 1.0 },
  { key: 'referralPct', label: 'referral %',   type: 'number', step: 0.001, min: 0, max: 0.5 },
  { key: 'otherFees',   label: 'other fees',   type: 'number', step: 100, min: 0 },
  { key: 'reqAdvance',  label: 'req advance',  type: 'number', step: 1000, min: 0 },
]

// "YYYY-MM-DD" or Date → "YYYY-MM-DD" for the date input.
function toIsoDate(v) {
  if (!v) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).slice(0, 10)
}

// Sensible defaults — match the Excel template's Inputs block:
//   investment date = today + 15
//   1st royalty pmnt = today + 90 (one quarter out — user adjusts)
//   target IRR 0.30, referral 0.01, other fees 0, req advance 15000
function defaultForm() {
  const now = new Date()
  const inv = new Date(now); inv.setDate(now.getDate() + 15)
  const fr = new Date(now); fr.setDate(now.getDate() + 90)
  return {
    investmentDate:   toIsoDate(inv),
    firstRoyaltyDate: toIsoDate(fr),
    targetIRR:   '0.30',
    referralPct: '0.01',
    otherFees:   '0',
    reqAdvance:  '15000',
  }
}

// Strip non-numeric chars + leading zeros from a decimal string input.
// Mirrors ValuationPage's rate-input pattern so typing "02" → "2" without
// waiting for blur, while preserving "0.30" / "0." / ".5". Strips commas so
// paste-from-formatted-display round-trips cleanly.
function cleanNumeric(raw) {
  return String(raw == null ? '' : raw)
    .replace(/,/g, '')
    .replace(/[^0-9.]/g, '')
    .replace(/(\..*)\./g, '$1')
    .replace(/^0+(?=\d)/, '')
}

// Format raw digits with thousands-separator commas in the whole part.
// Preserves decimal point + trailing digits/zeros. No-op when whole < 1000.
function withCommas(raw) {
  if (raw == null || raw === '') return ''
  const s = String(raw)
  const dotIdx = s.indexOf('.')
  const whole = dotIdx === -1 ? s : s.slice(0, dotIdx)
  const dec   = dotIdx === -1 ? '' : s.slice(dotIdx)
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + dec
}

// Apply a max ceiling to a cleaned numeric string. Returns the cleaned string
// (accepted) or null (reject). Mirrors ProjectionModal.
function clampMax(cleaned, max) {
  if (max == null) return cleaned
  if (cleaned === '' || cleaned === '.' || cleaned.endsWith('.')) return cleaned
  const n = parseFloat(cleaned)
  if (!Number.isFinite(n)) return cleaned
  return n > max ? null : cleaned
}

// referralPct (max 0.5) must always start with "0." once the user types.
// targetIRR (max 1.0) is excluded — "1.0" is a legitimate value for it.
const ZERO_LOCKED_KEYS = new Set(['referralPct'])

// Fields where ↑/↓ arrow keys step the value by the field's `step`. Only the
// sub-1 step fields participate — dollar-amount fields don't.
const STEP_KEYS = new Set(['targetIRR', 'referralPct'])

function decimalPlaces(step) {
  const s = String(step)
  const i = s.indexOf('.')
  return i === -1 ? 0 : s.length - i - 1
}

function formatStepped(value, step, key) {
  const dp = decimalPlaces(step)
  let s = value.toFixed(dp).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  if (ZERO_LOCKED_KEYS.has(key)) {
    const enforced = ensureZeroPrefix(s)
    if (enforced != null) s = enforced
  }
  return s
}

function ensureZeroPrefix(cleaned) {
  if (cleaned === '') return ''
  if (cleaned === '0' || cleaned === '.') return '0.'
  if (cleaned.startsWith('0.')) return cleaned
  if (cleaned.startsWith('.')) return '0' + cleaned
  if (cleaned.includes('.')) return null
  return '0.' + cleaned
}

function fmtCurrency(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  const formatted = abs.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return v < 0 ? `(${formatted})` : formatted
}
function fmtPercent(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(2)}%`
}
function fmtInt(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

export default function QuoteModal({ folderPath, graphName, onClose }) {
  const [form, setForm] = useState(defaultForm)
  const [scenarios, setScenarios] = useState(null)  // array of 8 scenario objects (no cashflow)
  const [stepMonths, setStepMonths] = useState(1)   // server returns detected step; needed for Periods display
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [overrides, setOverrides] = useState({})  // { '18m': number } — pinned manual advances (super-user Alt+click)
  const [editing, setEditing] = useState(null)     // scenario name whose Advance cell is being edited inline
  const [editValue, setEditValue] = useState('')   // live comma-formatted text in the inline Advance editor
  const debounceRef = useRef(null)
  const skipBlurRef = useRef(false)                 // suppress the unmount-blur commit on Enter/Escape

  // Coerce the form into the engine's input shape (numbers + ISO strings).
  const advanceInputs = useMemo(() => {
    const n = (s) => {
      if (s === '' || s == null) return null
      const f = parseFloat(s)
      return Number.isFinite(f) ? f : null
    }
    return {
      investmentDate:   form.investmentDate || null,
      firstRoyaltyDate: form.firstRoyaltyDate || null,
      targetIRR:        n(form.targetIRR),
      referralPct:      n(form.referralPct),
      otherFees:        n(form.otherFees),
      reqAdvance:       n(form.reqAdvance),
      overrides,
    }
  }, [form, overrides])

  // Are all required inputs ready to send?
  const inputsReady =
    !!advanceInputs.investmentDate &&
    !!advanceInputs.firstRoyaltyDate &&
    Number.isFinite(advanceInputs.targetIRR) &&
    Number.isFinite(advanceInputs.referralPct) &&
    Number.isFinite(advanceInputs.otherFees) &&
    Number.isFinite(advanceInputs.reqAdvance)

  // Live preview — debounced server call on input change.
  useEffect(() => {
    if (!folderPath || !inputsReady) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setError(null)
      fetch('/api/data-manager/quote/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: folderPath, advance: advanceInputs }),
      })
        .then(r => r.json().then(body => ({ ok: r.ok, body })))
        .then(({ ok, body }) => {
          if (!ok) { setError(body.error || 'preview failed'); setScenarios(null); return }
          setScenarios(body.scenarios || null)
          if (Number.isFinite(body.stepMonths)) setStepMonths(body.stepMonths)
        })
        .catch(err => { setError(err.message); setScenarios(null) })
    }, 300)
    return () => debounceRef.current && clearTimeout(debounceRef.current)
  }, [folderPath, advanceInputs.investmentDate, advanceInputs.firstRoyaltyDate,
      advanceInputs.targetIRR, advanceInputs.referralPct, advanceInputs.otherFees,
      advanceInputs.reqAdvance, overrides, inputsReady])

  function handleField(key, value, isNumeric) {
    if (!isNumeric) {
      setForm(prev => ({ ...prev, [key]: value }))
      return
    }
    let cleaned = cleanNumeric(value)
    if (ZERO_LOCKED_KEYS.has(key)) {
      cleaned = ensureZeroPrefix(cleaned)
      if (cleaned === null) return  // "0." can't be honored → reject
    }
    const fieldMax = (FIELDS_BODY.find(f => f.key === key) || {}).max
    const result = clampMax(cleaned, fieldMax)
    if (result === null) return  // exceeded threshold → reject keystroke
    setForm(prev => ({ ...prev, [key]: result }))
  }

  // ↑/↓ arrow key handler for the 2 step-enabled fields.
  function handleArrowStep(key, direction) {
    if (!STEP_KEYS.has(key)) return
    const f = FIELDS_BODY.find(x => x.key === key)
    if (!f || !Number.isFinite(f.step)) return
    const current = parseFloat(form[key])
    const base = Number.isFinite(current) ? current : 0
    const next = direction === 'up' ? base + f.step : base - f.step
    const clamped = Math.max(0, f.max != null ? Math.min(next, f.max) : next)
    setForm(prev => ({ ...prev, [key]: formatStepped(clamped, f.step, key) }))
  }

  // Super-user: commit (or clear) a manual advance override for one maturity scenario.
  // Empty / non-numeric → remove the override (revert to the back-solved advance). The
  // server then recomputes referral / total investment / advance-recoup / IRR off it.
  function commitOverride(name, raw) {
    setEditing(null)
    const cleaned = cleanNumeric(raw)
    const val = parseFloat(cleaned)
    setOverrides(prev => {
      const next = { ...prev }
      if (cleaned === '' || !Number.isFinite(val)) delete next[name]
      else next[name] = val
      return next
    })
  }

  // Save = export the canonical Quote file into the deal folder.
  // Filename convention (locked decision): `<deal> - Quote.xlsx`, overwrites prior.
  // The endpoint never touches the diligence workbook (data-integrity rule).
  function handleSave() {
    if (!folderPath || !inputsReady || saving) return
    setSaving(true)
    setError(null)
    fetch('/api/data-manager/quote/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: folderPath, advance: advanceInputs }),
    })
      .then(r => r.json().then(body => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        setSaving(false)
        if (!ok) { setError(body.error || 'export failed'); return }
        onClose()
      })
      .catch(err => { setSaving(false); setError(err.message) })
  }

  // 7 metric rows in the table — labels in col 1, one value per scenario col.
  // Periods row converts months → periods using the detected stepMonths (1/3/6) so
  // quarterly/semi-annual cadences display the correct period count, not raw months.
  const rows = useMemo(() => {
    const sc = scenarios || []
    const step = Number.isFinite(stepMonths) && stepMonths > 0 ? stepMonths : 1
    function valFor(metric, fmt) {
      return sc.map(s => fmt(s ? s[metric] : null))
    }
    return [
      { label: 'Periods',          values: sc.map(s => s && Number.isFinite(s.months) ? fmtInt(Math.ceil(s.months / step)) : '—') },
      { label: 'Advance',          values: valFor('advance',        fmtCurrency) },
      { label: 'Referral Fee',     values: valFor('referral',       fmtCurrency) },
      { label: 'Total Investment', values: valFor('rasCost',        fmtCurrency) },
      { label: 'Total Recoupment', values: valFor('recoupment',     fmtCurrency) },
      // Use server-canonical recoupMultiple (sc.recoupMultiple = advance/recoupment, null if 0).
      { label: 'Advance / Recoup', values: sc.map(s => s && Number.isFinite(s.recoupMultiple) ? fmtPercent(s.recoupMultiple) : '—') },
      { label: 'IRR',              values: valFor('irr',            fmtPercent) },
    ]
  }, [scenarios, stepMonths])

  const title = `quote: ${graphName || 'total revenue'}`

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal quote-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
        </div>

        <div className="quote-modal-body">
          <div className="quote-modal-table-wrap">
            <table className="quote-table">
              <thead>
                <tr>
                  <th></th>
                  {SCENARIO_LABELS.map(lab => <th key={lab}>{lab}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.label}>
                    <td className="quote-table-label">{row.label}</td>
                    {row.values.map((v, i) => {
                      // Advance row: maturity cells are Alt+click-editable (super-user). No
                      // visual indicator — the cell reads as plain text until edited.
                      const sc = row.label === 'Advance' ? (scenarios || [])[i] : null
                      const editable = !!sc && sc.kind === 'maturity'
                      if (editable && editing === sc.name) {
                        return (
                          <td key={i} className="quote-table-val">
                            <input
                              className="quote-advance-edit"
                              autoFocus
                              inputMode="decimal"
                              size={1}
                              value={editValue}
                              onChange={e => setEditValue(withCommas(cleanNumeric(e.target.value)))}
                              onKeyDown={e => {
                                if (e.key === 'Enter') { skipBlurRef.current = true; commitOverride(sc.name, editValue) }
                                else if (e.key === 'Escape') { skipBlurRef.current = true; setEditing(null) }
                              }}
                              onBlur={() => {
                                if (skipBlurRef.current) { skipBlurRef.current = false; return }
                                commitOverride(sc.name, editValue)
                              }}
                            />
                          </td>
                        )
                      }
                      return (
                        <td
                          key={i}
                          className="quote-table-val"
                          onClick={editable ? (e => { if (e.altKey) { e.preventDefault(); setEditing(sc.name); setEditValue(Number.isFinite(sc.advance) ? withCommas(String(Math.round(sc.advance))) : '') } }) : undefined}
                        >{v}</td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="quote-modal-form">
            {FIELDS_TOP.map(f => (
              <div className="projection-field" key={f.key}>
                <label>{f.label}</label>
                <input
                  className={`field-input${f.type === 'date' && !form[f.key] ? ' date-empty' : ''}`}
                  type={f.type}
                  value={form[f.key]}
                  onChange={e => handleField(f.key, e.target.value, false)}
                />
              </div>
            ))}
            {FIELDS_BODY.map(f => (
              <div className="projection-field" key={f.key}>
                <label>{f.label}</label>
                <input
                  className="field-input"
                  type="text"
                  inputMode="decimal"
                  value={withCommas(form[f.key])}
                  onChange={e => handleField(f.key, e.target.value, true)}
                  onKeyDown={STEP_KEYS.has(f.key) ? (e => {
                    if (e.key === 'ArrowUp')   { e.preventDefault(); handleArrowStep(f.key, 'up') }
                    if (e.key === 'ArrowDown') { e.preventDefault(); handleArrowStep(f.key, 'down') }
                  }) : undefined}
                />
              </div>
            ))}
          </div>

          {error && <p className="projection-modal-error">{error}</p>}
        </div>

        <div className="projection-modal-footer">
          <button className="modal-cancel" onClick={onClose} disabled={saving}><span>close</span></button>
          <button
            className={`modal-import-btn${saving ? ' is-processing' : ''}`}
            onClick={handleSave}
            disabled={!inputsReady || saving}
          ><span>{saving ? 'saving...' : 'save'}</span></button>
        </div>
      </div>
    </div>
  )
}
