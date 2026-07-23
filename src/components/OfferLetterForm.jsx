import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import Combobox from './Combobox.jsx'
import { MONTHS, getTypeLabel, isAmountField, formatPct } from '../utils.js'
import './OfferLetterForm.css'

const FUTURES_FIELDS = ['Futures Advance', 'Holdback', 'Track Number', 'Futures Term']
const MARKETING_FIELDS = ['Marketing Budget']
const DISTRO_FIELDS = ['Distro Advance', 'Distro Term']
const INCOME_FIELDS = ['DA1','DR1','AA1','AR1','DA2','DR2','AA2','AR2','DA3','DR3','AA3','AR3','DA4','DR4','AA4','AR4']
const INCOME_ROWS = [
  { label: 'Streaming (current catalog)', fields: ['DA1','DR1','AA1','AR1'] },
  { label: 'Streaming (new releases)',    fields: ['DA2','DR2','AA2','AR2'] },
  { label: 'Publishing',                  fields: ['DA3','DR3','AA3','AR3'] },
  { label: 'Merch, sync, touring',        fields: ['DA4','DR4','AA4','AR4'] },
]
const INCOME_PAIRS = {
  DA1:'DR1', DR1:'DA1', AA1:'AR1', AR1:'AA1',
  DA2:'DR2', DR2:'DA2', AA2:'AR2', AR2:'AA2',
  DA3:'DR3', DR3:'DA3', AA3:'AR3', AR3:'AA3',
  DA4:'DR4', DR4:'DA4', AA4:'AR4', AR4:'AA4',
}
const AFTER_INCOME_FIELDS = new Set(['Legal Name', 'Date'])
const SPECIAL_FIELDS = new Set([...FUTURES_FIELDS, ...MARKETING_FIELDS, ...DISTRO_FIELDS, ...INCOME_FIELDS, 'Total Deal', 'Advance Amount', 'Deal Name'])

const PERCENT_FIELDS = new Set(['Recoup Rate','Flow-Through','DA1','DA2','DA3','DA4','DR1','DR2','DR3','DR4','AA1','AA2','AA3','AA4','AR1','AR2','AR3','AR4'])

const FIELD_PLACEHOLDERS = {
  'Total Deal': 'dollars',
  'Advance Amount': 'dollars',
  'Distro Advance': 'dollars',
  'Distro Term': 'years',
  'Futures Advance': 'dollars',
  'Holdback': 'months',
  'Track Number': 'tracks',
  'Futures Term': 'years',
  'Marketing Budget': 'dollars',
  'Recoup Rate': 'percent',
  'Flow-Through': 'percent',
  'Term': 'months',
  'Recoup Amount': 'dollars',
  'DA1': 'percent', 'DA2': 'percent', 'DA3': 'percent', 'DA4': 'percent',
  'DR1': 'percent', 'DR2': 'percent', 'DR3': 'percent', 'DR4': 'percent',
  'AA1': 'percent', 'AA2': 'percent', 'AA3': 'percent', 'AA4': 'percent',
  'AR1': 'percent', 'AR2': 'percent', 'AR3': 'percent', 'AR4': 'percent',
  'Legal Name': 'first and last name',
}
const MONTHS_FIELDS = new Set(['Term','Holdback'])
const YEARS_FIELDS = new Set(['Distro Term','Futures Term'])
const PLAIN_NUMBER_FIELDS = new Set(['Track Number'])
const LOCKED_FIELDS = new Set(['Advance Amount', 'Recoup Rate', 'Term', 'Recoup Amount', 'Marketing Budget'])


export default function OfferLetterForm({ template, prefillData, onBack, onSaveComplete }) {
  const [fields, setFields] = useState([])
  const [values, setValues] = useState({})
  const [focusedIncome, setFocusedIncome] = useState(null) // income-split cell key being edited (raw while focused, 2dp otherwise)
  const [rawDates, setRawDates] = useState({})
  const [rawAmounts, setRawAmounts] = useState({})
  const [fileName, setFileName] = useState('')
  const [selectedDealIdx, setSelectedDealIdx] = useState(null)
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [showFutures, setShowFutures] = useState(false)
  const [showMarketing, setShowMarketing] = useState(false)
  const [showDistro, setShowDistro] = useState(false)
  const [showTableModal, setShowTableModal] = useState(false)
  const [dealSheetTables, setDealSheetTables] = useState(null)
  const [loadingTables, setLoadingTables] = useState(false)
  const [tablesError, setTablesError] = useState(null)
  const [selectedRow, setSelectedRow] = useState(null)
  const [structuredRows, setStructuredRows] = useState(null)
  const [prRows, setPrRows] = useState(null)
  const [showPR, setShowPR] = useState(false)
  const [lockedRow, setLockedRow] = useState(null)

  useEffect(() => {
    fetch('/api/deals/saved')
      .then(r => r.json())
      .then(setDeals)
      .catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)

    setFileName(prefillData?.dealName || '')
    setSelectedDealIdx(prefillData?.dealIndex ?? null)
    setValues({})
    setRawDates({})
    setRawAmounts({})
    setShowFutures(false)
    setShowMarketing(false)
    setShowDistro(false)
    setSelectedRow(null)
    setDealSheetTables(null)

    fetch(`/api/fields/${encodeURIComponent(template.category)}/${encodeURIComponent(template.filename)}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setFields(data.fields.filter(f => !f.startsWith('#') && !f.startsWith('/')))
        const today = new Date()
        const todayRaw = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
        const todayFormatted = `${today.getDate()} ${MONTHS[today.getMonth()]} ${today.getFullYear()}`
        const init = {}
        const initDates = {}
        data.fields.forEach(f => {
          if (f.toLowerCase().includes('date')) {
            init[f] = todayFormatted
            initDates[f] = todayRaw
          } else {
            init[f] = ''
          }
        })
        setValues(init)
        setRawDates(initDates)
      })
      .catch(err => setError('Failed to load template fields: ' + err.message))
      .finally(() => setLoading(false))
  }, [template.filename, template.category])

  function handleDealSelect(e) {
    const idx = parseInt(e.target.value)
    setSelectedDealIdx(idx)
    setFileName(deals[idx]?.name || '')
  }

  function handleChange(field, value, isDate, isAmount) {
    if (isDate) {
      setRawDates(prev => ({ ...prev, [field]: value }))
      if (value) {
        const [year, month, day] = value.split('-')
        const formatted = `${parseInt(day)} ${MONTHS[parseInt(month) - 1]} ${year}`
        setValues(prev => ({ ...prev, [field]: formatted }))
      } else {
        setValues(prev => ({ ...prev, [field]: '' }))
      }
    } else if (isAmount) {
      const digits = value.replace(/[^0-9]/g, '')
      setRawAmounts(prev => ({ ...prev, [field]: digits }))
      setValues(prev => ({ ...prev, [field]: digits === '' ? '' : parseInt(digits).toLocaleString('en-US') }))
    } else if (PERCENT_FIELDS.has(field)) {
      // Allow up to 2 decimals; show the raw value live (e.g. "40%", "40.5%"), format to
      // 2dp on blur (renderField onBlur) and at save.
      let cleaned = value.replace(/[^0-9.]/g, '')
      const dot = cleaned.indexOf('.')
      if (dot !== -1) cleaned = cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2)
      cleaned = cleaned.replace(/^0+(?=\d)/, '')
      setRawAmounts(prev => ({ ...prev, [field]: cleaned }))
      setValues(prev => ({ ...prev, [field]: cleaned === '' ? '' : `${cleaned}%` }))
    } else if (MONTHS_FIELDS.has(field)) {
      const digits = value.replace(/[^0-9]/g, '')
      setRawAmounts(prev => ({ ...prev, [field]: digits }))
      setValues(prev => ({ ...prev, [field]: digits === '' ? '' : `${parseInt(digits)} ${parseInt(digits) === 1 ? 'month' : 'months'}` }))
    } else if (YEARS_FIELDS.has(field)) {
      const digits = value.replace(/[^0-9]/g, '')
      setRawAmounts(prev => ({ ...prev, [field]: digits }))
      setValues(prev => ({ ...prev, [field]: digits === '' ? '' : `${parseInt(digits)} ${parseInt(digits) === 1 ? 'year' : 'years'}` }))
    } else if (PLAIN_NUMBER_FIELDS.has(field)) {
      const digits = value.replace(/[^0-9]/g, '')
      setRawAmounts(prev => ({ ...prev, [field]: digits }))
      setValues(prev => ({ ...prev, [field]: digits }))
    } else {
      setValues(prev => ({ ...prev, [field]: value }))
    }
  }

  useEffect(() => {
    if (selectedDealIdx === null || !deals.length || loading) return
    const deal = deals[selectedDealIdx]
    if (!deal) return
    const rt = deal.royaltyType || ''
    const isDistro = rt === 'Distribution' || rt === 'Both'
    const isPub = rt === 'Publishing' || rt === 'Both'

    const updates = {}
    const rawUpdates = {}

    // During Term
    const dr1 = isDistro ? '100' : '0'
    const dr2 = showFutures ? '100' : '0'
    const dr3 = isPub ? '100' : '0'
    const dr4 = '0'
    updates.DR1 = dr1 + '%'; rawUpdates.DR1 = dr1
    updates.DA1 = String(100 - parseInt(dr1)) + '%'; rawUpdates.DA1 = String(100 - parseInt(dr1))
    updates.DR2 = dr2 + '%'; rawUpdates.DR2 = dr2
    updates.DA2 = String(100 - parseInt(dr2)) + '%'; rawUpdates.DA2 = String(100 - parseInt(dr2))
    updates.DR3 = dr3 + '%'; rawUpdates.DR3 = dr3
    updates.DA3 = String(100 - parseInt(dr3)) + '%'; rawUpdates.DA3 = String(100 - parseInt(dr3))
    updates.DR4 = dr4 + '%'; rawUpdates.DR4 = dr4
    updates.DA4 = '100%'; rawUpdates.DA4 = '100'

    // After Term — all RTHM 0
    updates.AR1 = '0%'; rawUpdates.AR1 = '0'
    updates.AA1 = '100%'; rawUpdates.AA1 = '100'
    updates.AR2 = '0%'; rawUpdates.AR2 = '0'
    updates.AA2 = '100%'; rawUpdates.AA2 = '100'
    updates.AR3 = '0%'; rawUpdates.AR3 = '0'
    updates.AA3 = '100%'; rawUpdates.AA3 = '100'
    updates.AR4 = '0%'; rawUpdates.AR4 = '0'
    updates.AA4 = '100%'; rawUpdates.AA4 = '100'

    setValues(prev => ({ ...prev, ...updates }))
    setRawAmounts(prev => ({ ...prev, ...rawUpdates }))
  }, [selectedDealIdx, deals, showFutures, loading])

  useEffect(() => {
    if (selectedDealIdx === null) return
    setShowMarketing(false)
    setShowFutures(false)
    setShowDistro(false)
    setSelectedRow(null)
    setLockedRow(null)
    setDealSheetTables(null)
    setStructuredRows(null)
    setPrRows(null)
    setShowPR(false)
    setValues(prev => ({
      ...prev,
      'Advance Amount': '',
      'Term': '',
      'Recoup Rate': '',
      'Recoup Amount': '',
      'Marketing Budget': '',
    }))
    setRawAmounts(prev => {
      const next = { ...prev }
      delete next['Advance Amount']
      delete next['Term']
      delete next['Recoup Rate']
      delete next['Recoup Amount']
      delete next['Marketing Budget']
      return next
    })
  }, [selectedDealIdx])

  const parseAmt = raw => parseFloat((raw || '').replace(/[^0-9.]/g, '')) || 0
  const totalDeal = parseAmt(rawAmounts['Advance Amount'])
    + (showDistro ? parseAmt(rawAmounts['Distro Advance']) : 0)
    + (showMarketing ? parseAmt(rawAmounts['Marketing Budget']) : 0)
    + (showFutures ? parseAmt(rawAmounts['Futures Advance']) : 0)
  const totalDealFormatted = totalDeal > 0 ? Math.round(totalDeal).toLocaleString('en-US') : ''
  const totalDealParts = [values['Advance Amount']].concat(
    showDistro && rawAmounts['Distro Advance'] ? [values['Distro Advance']] : [],
    showMarketing && rawAmounts['Marketing Budget'] ? [values['Marketing Budget']] : [],
    showFutures && rawAmounts['Futures Advance'] ? [values['Futures Advance']] : [],
  )
  const totalDealTip = totalDealParts.length > 1 ? totalDealParts.filter(Boolean).join(' + ') : ''

  const visibleConditional = [
    ...(showDistro ? DISTRO_FIELDS : []),
    ...(showMarketing ? MARKETING_FIELDS : []),
    ...(showFutures ? FUTURES_FIELDS : []),
  ]
  const baseFields = fields.filter(f => !SPECIAL_FIELDS.has(f))
  const requiredFields = [
    ...(fields.includes('Advance Amount') ? ['Advance Amount'] : []),
    ...visibleConditional,
    ...baseFields,
  ]
  const allFilled = fileName.trim() !== ''
    && totalDealFormatted !== ''
    && requiredFields.every(f => values[f]?.trim() !== '')

  async function handleSave() {
    if (!allFilled) return
    setSaving(true)
    setError(null)

    try {
      const filteredValues = { ...values, 'Total Deal': totalDealFormatted, 'Deal Name': fileName.trim() }
      // Every percentage prints with exactly 2 decimals in the exported document (40% → 40.00%).
      PERCENT_FIELDS.forEach(f => { if (filteredValues[f]) { const p = formatPct(filteredValues[f]); if (p !== '') filteredValues[f] = `${p}%` } })
      if (!showDistro) DISTRO_FIELDS.forEach(f => delete filteredValues[f])
      if (!showMarketing) MARKETING_FIELDS.forEach(f => delete filteredValues[f])
      if (!showFutures) FUTURES_FIELDS.forEach(f => delete filteredValues[f])
      // Offer Letter templates have hardcoded " months" / " years" after these placeholders
      // (e.g. "{{Term}} months"). Send the raw digits so the suffix isn't doubled.
      ;[...MONTHS_FIELDS, ...YEARS_FIELDS].forEach(f => {
        if (filteredValues[f] && rawAmounts[f]) filteredValues[f] = rawAmounts[f]
      })

      const res = await fetch('/api/save/rpa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: template.category,
          filename: template.filename,
          fileName: fileName.trim(),
          fields: filteredValues,
          dealIndex: selectedDealIdx,
          typeLabel: getTypeLabel(template.filename),
          showFutures,
          showMarketing,
          showDistro,
        })
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Save failed')

      const saveDealIdx = prefillData?.dealIndex ?? selectedDealIdx
      if (lockedRow && saveDealIdx != null) {
        const formAdvance = Math.round(parseFloat(rawAmounts['Advance Amount']))
        const advanceChanged = !isNaN(formAdvance) && formAdvance !== lockedRow.advanceAmount
        const legalNameChange = !!values['Legal Name']
        if (advanceChanged || legalNameChange) {
          const lockUpdate = { ...lockedRow }
          if (legalNameChange) lockUpdate.legalName = values['Legal Name']
          if (advanceChanged) lockUpdate.advanceAmount = formAdvance
          await fetch(`/api/deals/${saveDealIdx}/lock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(lockUpdate)
          }).catch(() => {})
        }
      }
      if (onSaveComplete && saveDealIdx != null) onSaveComplete(saveDealIdx)
    } catch (err) {
      setError('Save failed: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const dealIdx = prefillData?.dealIndex ?? selectedDealIdx
  const dealSelected = dealIdx !== null && dealIdx !== undefined

  async function handleOpenDealSheet() {
    if (!dealSelected) return
    setTablesError(null)
    setShowTableModal(true)
    if (dealSheetTables) return
    setLoadingTables(true)
    try {
      const res = await fetch(`/api/deals/${dealIdx}/deal-sheet-tables`)
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to load deal sheet')
      setDealSheetTables(data.tables)
      setStructuredRows(data.rows || null)
      setPrRows(data.prRows || null)
      setShowPR(data.showPR || false)
    } catch (err) {
      setTablesError(err.message)
    } finally {
      setLoadingTables(false)
    }
  }

  async function handleConfirmRow() {
    if (!selectedRow || !structuredRows) return
    const isPR = selectedRow.table === 'pr'
    const row = isPR ? prRows[selectedRow.rIdx] : structuredRows[selectedRow.rIdx]
    if (!row) return
    setLockedRow(row)
    setShowTableModal(false)
    setTimeout(() => {
      const all = document.querySelectorAll('.field-input:not([readonly])')
      for (const input of all) {
        if (!input.value) {
          input.scrollIntoView({ behavior: 'smooth', block: 'center' })
          input.focus()
          break
        }
      }
    }, 100)

    const advanceAmount = isPR ? row.prAdvance : row.advanceAmount
    const termDigits = String(parseInt(row.term))
    const rateDigits = String(row.recoupRate)
    const advDigits = String(advanceAmount)
    const recoupDigits = String(row.recoupAmount)

    setRawAmounts(prev => ({
      ...prev,
      'Advance Amount': advDigits,
      'Recoup Rate': rateDigits,
      'Term': termDigits,
      'Recoup Amount': recoupDigits,
    }))
    setValues(prev => ({
      ...prev,
      'Advance Amount': Math.round(advanceAmount).toLocaleString('en-US'),
      'Recoup Rate': `${formatPct(row.recoupRate)}%`,
      'Term': `${parseInt(row.term)} ${parseInt(row.term) === 1 ? 'month' : 'months'}`,
      'Recoup Amount': Math.round(row.recoupAmount).toLocaleString('en-US'),
    }))

    if (isPR) {
      setShowMarketing(true)
      const mktDigits = String(row.marketingBudget)
      setRawAmounts(prev => ({ ...prev, 'Marketing Budget': mktDigits }))
      setValues(prev => ({ ...prev, 'Marketing Budget': Math.round(row.marketingBudget).toLocaleString('en-US') }))
    } else {
      setShowMarketing(false)
      setRawAmounts(prev => {
        const next = { ...prev }
        delete next['Marketing Budget']
        return next
      })
      setValues(prev => ({ ...prev, 'Marketing Budget': '' }))
    }

    try {
      await fetch(`/api/deals/${dealIdx}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row)
      })
    } catch (e) { /* non-critical */ }
  }

  const isFieldLocked = (field) => lockedRow && LOCKED_FIELDS.has(field) && !!(values[field])

  function renderField(field) {
    const isDate = field.toLowerCase().includes('date')
    const isAmount = isAmountField(field)
    const isSuffix = PERCENT_FIELDS.has(field) || MONTHS_FIELDS.has(field) || YEARS_FIELDS.has(field) || PLAIN_NUMBER_FIELDS.has(field)
    const isPercent = PERCENT_FIELDS.has(field)
    const displayValue = isDate ? (rawDates[field] || '') : (values[field] || '')
    const locked = isFieldLocked(field)
    const inputLocked = locked && field !== 'Advance Amount'
    return (
      <div key={field} className="field-group">
        <label className="field-label">
          {field}
          {locked && <span className="auto-label">auto-filled</span>}
        </label>
        <input
          className={`field-input${inputLocked ? ' field-locked' : ''}${isDate && !displayValue ? ' date-empty' : ''}`}
          type={isDate ? 'date' : 'text'}
          value={displayValue}
          onChange={e => handleChange(field, e.target.value, isDate, isAmount)}
          onKeyDown={isSuffix && !inputLocked ? e => {
            if (e.key === 'Backspace') {
              e.preventDefault()
              handleChange(field, (rawAmounts[field] || '').slice(0, -1), false, false)
            }
          } : undefined}
          onBlur={isPercent && !inputLocked ? () => {
            const p = formatPct(rawAmounts[field])
            setValues(prev => ({ ...prev, [field]: p === '' ? '' : `${p}%` }))
          } : undefined}
          readOnly={inputLocked}
          tabIndex={inputLocked ? -1 : undefined}
          placeholder={FIELD_PLACEHOLDERS[field] || ''}
        />
      </div>
    )
  }

  return (
    <>
    <div className="offer-form">
      <div className="offers-header">
        <button className="back-btn" onClick={onBack}><span className="arr">◀</span> back</button>
        <div className="rpa-title-block">
          <h2 className="rpa-title">{template.name}</h2>
          <span className="rpa-category">{fileName || 'Offer Letter'}</span>
        </div>
      </div>

      <div className="rpa-body">
        {loading && <p className="rpa-loading">Loading fields…</p>}

        {!loading && error && (
          <div className="rpa-error">{error}</div>
        )}

        {!loading && !error && (
          <div className="rpa-fields">

            {/* Deal selector */}
            <div className="field-group">
              <label className="field-label">
                Deal
                {prefillData?.dealName && <span className="auto-label">auto-filled</span>}
              </label>
              <div className="field-deal-row">
                {prefillData?.dealName ? (
                  <input
                    className="field-input field-locked"
                    value={prefillData.dealName}
                    readOnly
                    tabIndex={-1}
                  />
                ) : (
                  <Combobox
                    className="combobox--form combobox--preserve-case"
                    value={selectedDealIdx != null ? String(selectedDealIdx) : ''}
                    onChange={handleDealSelect}
                    placeholder="select a deal"
                    options={deals
                      .map((d, i) => ({ d, i }))
                      .filter(({ d }) => (d.agreements || []).some(a => a.fileName?.toLowerCase().includes('deal sheet')))
                      .map(({ d, i }) => ({ value: String(i), label: d.name }))
                    }
                  />
                )}
                {dealSelected && (
                  <button className="export-btn" onClick={handleOpenDealSheet}>
                    <span>select deal</span>
                  </button>
                )}
              </div>
            </div>

            {/* Total Deal — auto-calculated */}
            <div className="field-group">
              <label className="field-label">
                Total Deal
                <span className="auto-label">auto-calculated</span>
              </label>
              <div className={totalDealTip ? 'calc-tip' : ''} data-tip={totalDealTip || undefined}>
                <input
                  className="field-input field-locked"
                  value={totalDealFormatted}
                  readOnly
                  tabIndex={-1}
                  placeholder={FIELD_PLACEHOLDERS['Total Deal']}
                />
              </div>
            </div>

            {/* Advance Amount */}
            {fields.includes('Advance Amount') && renderField('Advance Amount')}

            {/* Distribution toggle + fields */}
            {fields.includes('Distro Advance') && (
              <div className="field-group field-group--toggle">
                <label className="field-label">Distribution</label>
                <input
                  type="checkbox"
                  className="field-checkbox"
                  checked={showDistro}
                  onChange={e => setShowDistro(e.target.checked)}
                />
              </div>
            )}
            {showDistro && DISTRO_FIELDS.filter(f => fields.includes(f)).map(f => renderField(f))}

            {/* Futures toggle + fields */}
            {fields.includes('Futures Advance') && (
              <div className="field-group field-group--toggle">
                <label className="field-label">Futures</label>
                <input
                  type="checkbox"
                  className="field-checkbox"
                  checked={showFutures}
                  onChange={e => setShowFutures(e.target.checked)}
                />
              </div>
            )}
            {showFutures && FUTURES_FIELDS.filter(f => fields.includes(f)).map(f => renderField(f))}

            {/* Marketing toggle + field */}
            {fields.includes('Marketing Budget') && (
              <div className="field-group field-group--toggle">
                <label className="field-label">Marketing</label>
                <input
                  type="checkbox"
                  className="field-checkbox"
                  checked={showMarketing}
                  onChange={e => setShowMarketing(e.target.checked)}
                />
              </div>
            )}
            {showMarketing && fields.includes('Marketing Budget') && renderField('Marketing Budget')}

            {/* Remaining fields before income table */}
            {baseFields.filter(f => fields.includes(f) && !AFTER_INCOME_FIELDS.has(f)).map(f => renderField(f))}

            {/* Income Sharing Summary table */}
            {fields.includes('DA1') && (
              <div className="field-group">
                <label className="field-label">Income Sharing Summary</label>
                <table className="income-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th colSpan={2}>During Term</th>
                      <th colSpan={2}>After Term</th>
                    </tr>
                    <tr>
                      <th>Income Type</th>
                      <th>artist</th>
                      <th>RTHM</th>
                      <th>artist</th>
                      <th>RTHM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {INCOME_ROWS.map(row => (
                      <tr key={row.label}>
                        <td className="income-label">{row.label}</td>
                        {row.fields.map(f => (
                          <td key={f} className="income-cell">
                            <input
                              className="rate-input"
                              type="text"
                              value={focusedIncome === f ? (rawAmounts[f] || '') : formatPct(rawAmounts[f])}
                              onFocus={() => setFocusedIncome(f)}
                              onBlur={() => setFocusedIncome(null)}
                              onChange={e => {
                                const digits = e.target.value.replace(/[^0-9]/g, '')
                                const complement = INCOME_PAIRS[f]
                                const compVal = digits === '' ? '' : String(Math.max(0, 100 - parseInt(digits)))
                                setRawAmounts(prev => ({ ...prev, [f]: digits, [complement]: compVal }))
                                setValues(prev => ({
                                  ...prev,
                                  [f]: digits === '' ? '' : `${parseInt(digits)}%`,
                                  [complement]: compVal === '' ? '' : `${parseInt(compVal)}%`,
                                }))
                              }}
                              placeholder=""
                            />
                            <span className="rate-symbol">%</span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Fields after income table (Legal Name, Date) */}
            {baseFields.filter(f => fields.includes(f) && AFTER_INCOME_FIELDS.has(f)).map(f => renderField(f))}

            <div className="rpa-export-row">
              {error && !loading && (
                <div className="rpa-error">{error}</div>
              )}
              <button
                className={`export-btn ${(!allFilled || saving) ? 'disabled' : ''} ${saving ? 'saving' : ''}${saving ? ' is-processing' : ''}`}
                onClick={handleSave}
                disabled={!allFilled || saving}
              >
                <span>{saving ? 'saving…' : 'save offer letter'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
    {showTableModal && createPortal(
      <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowTableModal(false)}>
        <div className="modal deal-sheet-table-modal">
          <div className="modal-header">
            <h2 className="modal-title">SELECT A ROW</h2>
          </div>

          <div className="modal-table-wrap">
            {loadingTables && <p className="modal-status">Loading deal sheet…</p>}
            {tablesError && <p className="modal-status" style={{color:'var(--error)'}}>{tablesError}</p>}
            {!loadingTables && !tablesError && structuredRows && (
              <>
              {showPR && prRows && prRows.length > 0 && (
                <>
                <h3 className="modal-table-label">PR UPLIFT</h3>
                <table className="modal-table deal-sheet-table">
                  <thead>
                    <tr>
                      <th>Term</th>
                      <th>Total Deal</th>
                      <th>Advance Amount</th>
                      <th>Marketing Budget</th>
                      <th>Recoup Rate</th>
                      <th>Recoup Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prRows.map((row, rIdx) => {
                      const fmtV = n => Math.round(n).toLocaleString('en-US')
                      // PR math anchors to the INITIAL QUOTE band — tooltips read the
                      // pr* fields the server computes from it, not the working numbers.
                      const totalTip = `${fmtV(row.prAdvance)} + ${fmtV(row.marketingBudget)}`
                      const prAdvTip = `${fmtV(row.prRthmAdvance ?? row.advanceAmount)} × 80%`
                      const prRas = row.prRasAdvance ?? row.rasAdvance
                      const mktRaw = prRas * 0.2 * 0.67 * 2.5
                      const mktTip = `${fmtV(prRas)} × 20% × 67% × 2.5 = ${fmtV(Math.round(mktRaw))} → round up to ${fmtV(row.marketingBudget)}`
                      return (
                      <tr
                        key={'pr-' + rIdx}
                        className={selectedRow?.table === 'pr' && selectedRow?.rIdx === rIdx ? 'selected' : ''}
                        onClick={() => setSelectedRow({ table: 'pr', rIdx })}
                      >
                        <td>{row.term}</td>
                        <td><span className="calc-tip" data-tip={totalTip}>{fmtV(row.prTotal)}</span></td>
                        <td><span className="calc-tip" data-tip={prAdvTip}>{fmtV(row.prAdvance)}</span></td>
                        <td>{row.marketingBudget > 0 ? <span className="calc-tip" data-tip={mktTip}>{fmtV(row.marketingBudget)}</span> : '—'}</td>
                        <td>{formatPct(row.recoupRate) + '%'}</td>
                        <td>{Math.round(row.recoupAmount).toLocaleString('en-US')}</td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
                </>
              )}
              <h3 className="modal-table-label">RTHM VALUATION</h3>
              <table className="modal-table deal-sheet-table rthm-table">
                <thead>
                  <tr>
                    <th>Term</th>
                    <th>Advance Amount</th>
                    <th>Recoup Rate</th>
                    <th>Recoup Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {structuredRows.map((row, rIdx) => {
                    const fmtV = n => Math.round(n).toLocaleString('en-US')
                    const advTip = `${fmtV(row.recoupAmount)} × ${formatPct(row.recoupRate)}%`
                    return (
                    <tr
                      key={'rthm-' + rIdx}
                      className={selectedRow?.table === 'rthm' && selectedRow?.rIdx === rIdx ? 'selected' : ''}
                      onClick={() => setSelectedRow({ table: 'rthm', rIdx })}
                    >
                      <td>{row.term}</td>
                      <td><span className="calc-tip" data-tip={advTip}>{fmtV(row.advanceAmount)}</span></td>
                      <td>{formatPct(row.recoupRate) + '%'}</td>
                      <td>{fmtV(row.recoupAmount)}</td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
              </>
            )}
          </div>

          <div className="modal-footer">
            <button className="modal-cancel" onClick={() => setShowTableModal(false)}><span>cancel</span></button>
            <button
              className={`modal-import-btn${!selectedRow ? ' disabled' : ''}`}
              disabled={!selectedRow}
              onClick={handleConfirmRow}
            >
              <span>select deal</span>
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}
    </>
  )
}
