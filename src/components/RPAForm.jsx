import React, { useState, useEffect } from 'react'
import { MONTHS, getTypeLabel, isAmountField } from '../utils.js'
import './RPAForm.css'

const MONTHS_FIELDS = new Set(['Estimated Term'])
const AUTO_CALC_FIELDS = new Set(['Net Amount', 'Margin Fee'])
const B2B_PARTNER_FIELDS = new Set(['B2B Entity', 'B2B Address', 'B2B Partner', 'B2B Website', 'B2B Signer', 'B2B Title'])

function buildRasPrefix(dateVal) {
  const dateParts = (dateVal || '').split(' ')
  if (dateParts.length === 3) {
    const monthIdx = MONTHS.indexOf(dateParts[1])
    if (monthIdx >= 0) {
      const mmyy = String(monthIdx + 1).padStart(2, '0') + dateParts[2].slice(-2)
      return `RAS-RP-${mmyy}-`
    }
  }
  return 'RAS-RP-'
}

const FIELD_PLACEHOLDERS = {
  'Recoup Amount': 'dollars',
  'Seller Name': 'individual or entity',
  'Legal Name': 'first and last name',
  'Title': 'owner or artist',
  'Advance Amount': 'dollars',
  'Estimated Term': 'months',
  'Artist Name': 'stage name',
  'Platform(s)': 'distributors/PROs',
  'Transaction ID': 'RTHM-RPA-00',
  'RAS Advance': 'dollars',
  'Margin Fee': 'dollars',
  'B2B Entity': 'legal entity name',
  'B2B Address': 'business address',
  'B2B Partner': 'partner name',
  'B2B Website': 'website URL',
  'B2B Signer': 'authorized signer',
  'B2B Title': 'signer title',
  'Net Amount': 'dollars',
  'RAS ID': 'RAS-RP-MMYY-XX00',
}

export default function RPAForm({ template, prefillData, onBack, onNavigateToRAS, onSaveComplete }) {
  const [fields, setFields] = useState([])
  const [values, setValues] = useState({})
  const [rawDates, setRawDates] = useState({})
  const [rawAmounts, setRawAmounts] = useState({})
  const [fileName, setFileName] = useState('')
  const [selectedDealIdx, setSelectedDealIdx] = useState(null)
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [autoFilledFields, setAutoFilledFields] = useState(new Set())

  useEffect(() => {
    fetch('/api/deals/saved')
      .then(r => r.json())
      .then(setDeals)
      .catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)

    setFileName(prefillData?.rpaExportData?.fileName || prefillData?.dealName || '')
    setSelectedDealIdx(prefillData?.rpaExportData?.dealIndex ?? prefillData?.dealIndex ?? null)
    setValues({})
    setRawDates({})
    setRawAmounts({})

    fetch(`/api/fields/${encodeURIComponent(template.category)}/${encodeURIComponent(template.filename)}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        const orderedFields = data.fields
        if (template.filename === 'B2B RPA_Template.docx') {
          const front = ['Recoup Amount', 'B2B Partner', 'B2B Entity']
          front.reverse().forEach(f => {
            const idx = orderedFields.indexOf(f)
            if (idx > 0) { orderedFields.splice(idx, 1); orderedFields.unshift(f) }
          })
        }
        setFields(orderedFields)
        const today = new Date()
        const todayRaw = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
        const todayFormatted = `${today.getDate()} ${MONTHS[today.getMonth()]} ${today.getFullYear()}`
        const init = {}
        const initDates = prefillData?.rawDates ? { ...prefillData.rawDates } : {}
        data.fields.forEach(f => {
          if (prefillData?.values?.[f]) {
            init[f] = prefillData.values[f]
          } else if (f === 'RAS Advance' && prefillData?.rasAdvance && template.filename === 'RTHM x RAS RPA_Template.docx') {
            init[f] = 'USD ' + Math.round(prefillData.rasAdvance).toLocaleString('en-US')
          } else if (f.toLowerCase().includes('date')) {
            init[f] = todayFormatted
            if (!initDates[f]) initDates[f] = todayRaw
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
    const deal = deals[idx]
    let platform = deal?.platform || ''
    if (platform) {
      const hasVQ = deal?.variableQuote && Object.values(deal.variableQuote).some(v => v != null)
      if (hasVQ) platform += ', RTHM'
      setValues(prev => ({ ...prev, 'Platform(s)': platform }))
    }
    const locked = deal?.lockedDeal
    const filled = []
    if (platform) filled.push('Platform(s)')
    if (locked) {
      const termDigits = String(parseInt(locked.term))
      setRawAmounts(prev => ({
        ...prev,
        'Advance Amount': String(locked.advanceAmount),
        'Recoup Amount': String(locked.recoupAmount),
        'Estimated Term': termDigits,
        ...(locked.transactionId ? { 'Transaction ID': locked.transactionId.replace(/[^0-9]/g, '') } : {}),
      }))
      const lockedUpdates = {
        'Advance Amount': 'USD ' + Math.round(locked.advanceAmount).toLocaleString('en-US'),
        'Recoup Amount': 'USD ' + Math.round(locked.recoupAmount).toLocaleString('en-US'),
        'Estimated Term': `${parseInt(locked.term)} ${parseInt(locked.term) === 1 ? 'month' : 'months'}`,
        'Artist Name': deal?.name || '',
        ...(locked.legalName ? { 'Legal Name': locked.legalName } : {}),
        ...(locked.transactionId ? { 'Transaction ID': locked.transactionId } : {}),
      }
      setValues(prev => ({ ...prev, ...lockedUpdates }))
      filled.push(...Object.keys(lockedUpdates))
    }
    if (deal?.b2bPartner && template.filename === 'RTHM RPA_Template.docx') {
      fetch(`/api/b2b-partners/${encodeURIComponent(deal.b2bPartner)}`)
        .then(r => r.json())
        .then(pd => {
          const pu = {}
          if (pd?.['B2B Entity']) pu['Seller Name'] = pd['B2B Entity']
          if (pd?.['B2B Signer']) pu['Legal Name'] = pd['B2B Signer']
          if (pd?.['B2B Title']) pu['Title'] = pd['B2B Title']
          if (Object.keys(pu).length) {
            setValues(prev => ({ ...prev, ...pu }))
            setAutoFilledFields(prev => new Set([...prev, ...Object.keys(pu)]))
          }
        })
        .catch(() => {})
    }
    setAutoFilledFields(new Set(filled))
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
      const digits = value.replace(/[^0-9.]/g, '')
      setRawAmounts(prev => ({ ...prev, [field]: digits }))
      const n = parseFloat(digits)
      const formatted = isNaN(n) ? '' : 'USD ' + Math.round(n).toLocaleString('en-US')
      setValues(prev => ({ ...prev, [field]: formatted }))
    } else if (field === 'Transaction ID') {
      const digits = value.replace(/[^0-9]/g, '')
      setRawAmounts(prev => ({ ...prev, [field]: digits }))
      setValues(prev => ({ ...prev, [field]: digits === '' ? '' : `RTHM-RPA-${digits}` }))
    } else if (field === 'RAS ID') {
      const stripped = value.replace(/^RAS-RP-(?:\d{4}-)?/, '')
      const raw = stripped.replace(/[^a-zA-Z0-9]/g, '')
      setRawAmounts(prev => ({ ...prev, [field]: raw }))
      const prefix = buildRasPrefix(values['Date'])
      setValues(prev => ({ ...prev, [field]: raw === '' ? '' : `${prefix}${raw}` }))
    } else if (MONTHS_FIELDS.has(field)) {
      const digits = value.replace(/[^0-9]/g, '')
      setRawAmounts(prev => ({ ...prev, [field]: digits }))
      setValues(prev => ({ ...prev, [field]: digits === '' ? '' : `${parseInt(digits)} ${parseInt(digits) === 1 ? 'month' : 'months'}` }))
    } else {
      setValues(prev => ({ ...prev, [field]: value }))
    }
  }

  useEffect(() => {
    if (selectedDealIdx === null || !deals.length || template.filename === 'RTHM x RAS RPA_Template.docx') return
    const deal = deals[selectedDealIdx]
    if (!deal) return
    // Clear previous auto-fills before applying new ones
    setValues(prev => {
      const next = { ...prev }
      autoFilledFields.forEach(f => { next[f] = '' })
      return next
    })
    setAutoFilledFields(new Set())
    setRawAmounts({})
    const locked = deal.lockedDeal
    let platform = deal.platform || ''
    if (platform) {
      const hasVQ = deal.variableQuote && Object.values(deal.variableQuote).some(v => v != null)
      if (hasVQ) platform += ', RTHM'
    }
    const updates = {}
    if (platform) updates['Platform(s)'] = platform
    if (deal.name) updates['Artist Name'] = deal.name
    if (locked) {
      const termDigits = String(parseInt(locked.term))
      updates['Advance Amount'] = 'USD ' + Math.round(locked.advanceAmount).toLocaleString('en-US')
      updates['Recoup Amount'] = 'USD ' + Math.round(locked.recoupAmount).toLocaleString('en-US')
      updates['Estimated Term'] = `${parseInt(locked.term)} ${parseInt(locked.term) === 1 ? 'month' : 'months'}`
      if (locked.legalName) updates['Legal Name'] = locked.legalName
      if (locked.transactionId) updates['Transaction ID'] = locked.transactionId
      setRawAmounts(prev => ({
        ...prev,
        'Advance Amount': String(locked.advanceAmount),
        'Recoup Amount': String(locked.recoupAmount),
        'Estimated Term': termDigits,
        ...(locked.transactionId ? { 'Transaction ID': locked.transactionId.replace(/[^0-9]/g, '') } : {}),
      }))
    }
    if (deal.b2bPartner && template.filename === 'RTHM RPA_Template.docx') {
      fetch(`/api/b2b-partners/${encodeURIComponent(deal.b2bPartner)}`)
        .then(r => r.json())
        .then(partnerData => {
          if (!partnerData) return
          const partnerUpdates = {}
          if (partnerData['B2B Entity']) partnerUpdates['Seller Name'] = partnerData['B2B Entity']
          if (partnerData['B2B Signer']) partnerUpdates['Legal Name'] = partnerData['B2B Signer']
          if (partnerData['B2B Title']) partnerUpdates['Title'] = partnerData['B2B Title']
          if (Object.keys(partnerUpdates).length) {
            setValues(prev => ({ ...prev, ...partnerUpdates }))
            setAutoFilledFields(prev => new Set([...prev, ...Object.keys(partnerUpdates)]))
          }
        })
        .catch(() => {})
    }
    if (Object.keys(updates).length) {
      setValues(prev => ({ ...prev, ...updates }))
      setAutoFilledFields(prev => new Set([...prev, ...Object.keys(updates)]))
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
    }
  }, [deals, selectedDealIdx, fields])

  useEffect(() => {
    if (template.filename !== 'B2B RPA_Template.docx' || selectedDealIdx === null || !deals.length) return
    const deal = deals[selectedDealIdx]
    if (!deal?.b2bPartner) return
    fetch(`/api/b2b-partners/${encodeURIComponent(deal.b2bPartner)}`)
      .then(r => r.json())
      .then(partnerData => {
        if (!partnerData || !Object.keys(partnerData).length) return
        const filled = []
        setValues(prev => {
          const updates = { ...prev }
          for (const [key, val] of Object.entries(partnerData)) {
            if (val && fields.includes(key) && !updates[key]) {
              updates[key] = val
              filled.push(key)
            }
          }
          return updates
        })
        setAutoFilledFields(prev => new Set([...prev, ...filled]))
      })
      .catch(() => {})
  }, [deals, selectedDealIdx, fields])

  useEffect(() => {
    if (template.filename === 'RTHM x RAS RPA_Template.docx') {
      const rasAdvance = parseFloat((values['RAS Advance'] || '').replace(/[^0-9.-]/g, ''))
      const advanceAmount = parseFloat((prefillData?.advanceAmount || '').replace(/[^0-9.-]/g, ''))

      const margin = (!isNaN(rasAdvance) && !isNaN(advanceAmount))
        ? (rasAdvance - advanceAmount) * 0.08
        : NaN

      const net = (!isNaN(rasAdvance) && !isNaN(margin))
        ? rasAdvance - margin
        : NaN

      setValues(prev => ({
        ...prev,
        'Margin Fee': isNaN(margin) ? '' : 'USD ' + Math.round(margin).toLocaleString('en-US'),
        'Net Amount': isNaN(net) ? '' : 'USD ' + Math.round(net).toLocaleString('en-US'),
      }))
    }
  }, [values['RAS Advance'], prefillData?.advanceAmount, template.filename])

  useEffect(() => {
    if (template.filename === 'RTHM x RAS RPA_Template.docx') {
      const raw = rawAmounts['RAS ID'] || ''
      if (!raw) return
      const prefix = buildRasPrefix(values['Date'])
      setValues(prev => ({ ...prev, 'RAS ID': `${prefix}${raw}` }))
    }
  }, [values['Date'], template.filename])

  const allFilled = fileName.trim() !== '' && fields.every(f => AUTO_CALC_FIELDS.has(f) || values[f]?.trim() !== '')

  async function handleSaveBoth() {
    if (!allFilled) return
    setSaving(true)
    setError(null)

    const dealIndex = selectedDealIdx
    try {
      const [rasRes, rpaRes] = await Promise.all([
        fetch('/api/save/rpa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: template.category,
            filename: template.filename,
            fileName: fileName.trim(),
            fields: values,
            dealIndex,
            typeLabel: getTypeLabel(template.filename)
          })
        }),
        fetch('/api/save/rpa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(prefillData.rpaExportData)
        })
      ])
      const [rasData, rpaData] = await Promise.all([rasRes.json(), rpaRes.json()])
      if (!rasRes.ok || rasData.error) throw new Error(rasData.error || 'RAS save failed')
      if (!rpaRes.ok || rpaData.error) throw new Error(rpaData.error || 'RPA save failed')

      const dealForLock = dealIndex != null ? deals[dealIndex] : null
      const formAdvance = Math.round(parseFloat(rawAmounts['Advance Amount']))
      if (dealForLock?.lockedDeal && !isNaN(formAdvance) && formAdvance !== dealForLock.lockedDeal.advanceAmount) {
        await fetch(`/api/deals/${dealIndex}/lock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...dealForLock.lockedDeal, advanceAmount: formAdvance })
        }).catch(() => {})
      }

      if (onSaveComplete) onSaveComplete(dealIndex)
    } catch (err) {
      setError('Save failed: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    if (!allFilled) return
    setSaving(true)
    setError(null)

    try {
      const res = await fetch('/api/save/rpa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: template.category,
          filename: template.filename,
          fileName: fileName.trim(),
          fields: values,
          dealIndex: selectedDealIdx,
          typeLabel: getTypeLabel(template.filename)
        })
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Save failed')

      const dealForLock = selectedDealIdx != null ? deals[selectedDealIdx] : null
      const formAdvance = Math.round(parseFloat(rawAmounts['Advance Amount']))
      const advanceChanged = dealForLock?.lockedDeal && !isNaN(formAdvance) && formAdvance !== dealForLock.lockedDeal.advanceAmount
      const txIdChange = template.filename === 'B2B RPA_Template.docx' && values['Transaction ID']

      if (selectedDealIdx != null && (advanceChanged || txIdChange)) {
        const lockUpdate = { ...(dealForLock?.lockedDeal || {}) }
        if (advanceChanged) lockUpdate.advanceAmount = formAdvance
        if (txIdChange) lockUpdate.transactionId = values['Transaction ID']
        fetch(`/api/deals/${selectedDealIdx}/lock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lockUpdate)
        }).catch(() => {})
      }
      if (onSaveComplete) onSaveComplete(selectedDealIdx)
    } catch (err) {
      setError('Save failed: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const isRAS = template.filename === 'RTHM x RAS RPA_Template.docx'
  const isRTHM = template.filename === 'RTHM RPA_Template.docx'

  return (
    <div className="rpa-form">
      <div className="rpa-header">
        <button className="back-btn" onClick={onBack}><span className="arr">◀</span> back</button>
        <div className="rpa-title-block">
          <h2 className="rpa-title">{template.name}</h2>
          <span className="rpa-category">{fileName || 'Royalty Purchase Agreement'}</span>
        </div>
      </div>

      <div className="rpa-body">
        {loading && <p className="rpa-loading">Loading fields…</p>}

        {!loading && error && (
          <div className="rpa-error">{error}</div>
        )}

        {!loading && !error && (
          <div className="rpa-fields">
            <div className="field-group">
              <label className="field-label">
                Deal
                {(isRAS || prefillData?.dealName) && <span className="auto-label">auto-filled</span>}
              </label>
              {(isRAS || prefillData?.dealName) ? (
                <input
                  className="field-input field-locked"
                  type="text"
                  value={fileName}
                  readOnly
                  tabIndex={-1}
                  placeholder="select a deal"
                />
              ) : (
                <select
                  className="field-input"
                  value={selectedDealIdx ?? ''}
                  onChange={handleDealSelect}
                  style={{color: selectedDealIdx === null ? 'var(--ink-light)' : 'var(--ink)'}}
                >
                  <option value="" disabled hidden>select a deal</option>
                  {deals.map((d, i) => (
                    <option key={i} value={i}>{d.name}</option>
                  ))}
                </select>
              )}
            </div>

            {fields.map(field => {
              const isDate = field.toLowerCase().includes('date')
              const isAmount = isAmountField(field)
              const isAutoCalc = isRAS && (field === 'Net Amount' || field === 'Margin Fee')
              const dealLocked = selectedDealIdx !== null && !!deals[selectedDealIdx]?.lockedDeal
              const isB2B = template.filename === 'B2B RPA_Template.docx'
              const isAutoFill = (isRAS && ['Recoup Amount', 'Estimated Term', 'Artist Name', 'Platform(s)'].includes(field) && !!prefillData?.values?.[field])
                || (isRAS && field === 'RAS Advance' && !!prefillData?.rasAdvance)
                || (field === 'Platform(s)' && selectedDealIdx !== null && !!deals[selectedDealIdx]?.platform)
                || (autoFilledFields.has(field))
                || (isB2B && B2B_PARTNER_FIELDS.has(field) && autoFilledFields.has(field))

              const isTransactionId = field === 'Transaction ID'
              const isRasId = field === 'RAS ID'
              const isMonths = MONTHS_FIELDS.has(field)
              const displayValue = isDate ? (rawDates[field] || '') : (values[field] || '')
              const isLocked = (isAutoCalc || isAutoFill) && field !== 'Advance Amount'
              let calcTip = ''
              if (isAutoCalc && isRAS) {
                const ra = values['RAS Advance'] || ''
                const aa = prefillData?.advanceAmount || ''
                if (field === 'Margin Fee') calcTip = `(${ra} − ${aa}) × 8%`
                if (field === 'Net Amount') calcTip = `${ra} − ${values['Margin Fee'] || ''}`
              }
              return (
                <div key={field} className="field-group">
                  <label className="field-label">
                    {field}
                    {isAutoCalc && <span className="auto-label">auto-calculated</span>}
                    {isAutoFill && <span className="auto-label">auto-filled</span>}
                  </label>
                  {calcTip ? (
                    <div className="calc-tip" data-tip={calcTip}>
                      <input
                        className={`field-input${isLocked ? ' field-locked' : ''}`}
                        type="text"
                        value={values[field] || ''}
                        readOnly
                        tabIndex={-1}
                        placeholder={FIELD_PLACEHOLDERS[field] || ''}
                      />
                    </div>
                  ) : (
                    <input
                      className={`field-input${isLocked ? ' field-locked' : ''}`}
                      type={isDate ? 'date' : 'text'}
                      value={(isAutoCalc || isAutoFill) ? (values[field] || '') : displayValue}
                      onChange={e => handleChange(field, e.target.value, isDate, isAmount)}
                      onKeyDown={(isMonths || isTransactionId || isRasId) && !isLocked ? e => {
                        if (e.key === 'Backspace') {
                          e.preventDefault()
                          handleChange(field, (rawAmounts[field] || '').slice(0, -1), false, false)
                        }
                      } : undefined}
                      readOnly={isLocked}
                      tabIndex={isLocked ? -1 : undefined}
                      placeholder={FIELD_PLACEHOLDERS[field] || ''}
                    />
                  )}
                </div>
              )
            })}

            <div className="rpa-export-row">
              {error && !loading && (
                <div className="rpa-error">{error}</div>
              )}
              <div style={{display:'flex', gap:12, flexWrap:'wrap'}}>
                {template.filename === 'RTHM RPA_Template.docx' && (
                  <button
                    className={`export-btn ${!allFilled ? 'disabled' : ''}`}
                    style={{background: allFilled ? 'var(--primary-mid)' : undefined}}
                    onClick={() => allFilled && onNavigateToRAS({
                      values: {
                        'Recoup Amount': values['Recoup Amount'] || '',
                        'Estimated Term': values['Estimated Term'] || '',
                        'Artist Name': values['Artist Name'] || '',
                        'Platform(s)': values['Platform(s)'] || '',
                        'Date': values['Date'] || '',
                      },
                      advanceAmount: values['Advance Amount'] || '',
                      rasAdvance: deals[selectedDealIdx]?.lockedDeal?.rasAdvance || null,
                      rawDates,
                      rpaExportData: {
                        category: template.category,
                        filename: template.filename,
                        fileName,
                        fields: values,
                        dealIndex: selectedDealIdx,
                        typeLabel: getTypeLabel(template.filename)
                      }
                    })}
                    disabled={!allFilled}
                  >
                    <span>create RAS RPA <span className="arr">▶</span></span>
                  </button>
                )}

                {isRAS && (
                  <button
                    className={`export-btn ${(!allFilled || !prefillData?.rpaExportData || saving) ? 'disabled' : ''} ${saving ? 'saving' : ''}`}
                    onClick={handleSaveBoth}
                    disabled={!allFilled || !prefillData?.rpaExportData || saving}
                    style={{background: (allFilled && prefillData?.rpaExportData) ? 'var(--primary-dark)' : undefined}}
                  >
                    <span>{saving ? 'saving…' : 'save both RPAs'}</span>
                  </button>
                )}

                {!isRAS && !isRTHM && (
                  <button
                    className={`export-btn ${(!allFilled || saving) ? 'disabled' : ''} ${saving ? 'saving' : ''}`}
                    onClick={handleSave}
                    disabled={!allFilled || saving}
                  >
                    <span>{saving ? 'saving…' : 'save RPA'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
