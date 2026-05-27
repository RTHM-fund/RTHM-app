import React, { useState, useEffect } from 'react'
import Combobox from './Combobox.jsx'
import './ValuationPage.css'

const TERMS = ['12 months', '36 months', '60 months', '84 months']
const IQ_PAIRS = [['AC','AD'], ['AE','AF'], ['AG','AH'], ['AI','AJ']]
const VQ_PAIRS = [['AR','AS'], ['AT','AU'], ['AV','AW'], ['AX','AY']]

const DEFAULT_RATES = {
  Individual: { '12 months': 70, '36 months': 60, '60 months': 50, '84 months': 45 },
  B2B:        { '12 months': 74, '36 months': 64, '60 months': 54, '84 months': 50 }
}

// Terms reversed for RTHM Valuation table
const TERMS_DESC = ['84 months', '60 months', '36 months', '12 months']

function fmt(n) {
  if (n === null || n === undefined || n === '') return '—'
  const num = typeof n === 'number' ? n : parseFloat(n)
  if (isNaN(num)) return '—'
  return Math.round(num).toLocaleString('en-US')
}

function hasValues(obj, pairs) {
  return pairs.some(([a, b]) => obj[a] || obj[b])
}

function RateInput({ label, value, onChange, disabled }) {
  return (
    <div className="commission-inline">
      <span className="commission-label">{label}</span>
      <input
        className={`rate-input${disabled ? ' rate-input-locked' : ''}`}
        type="text"
        inputMode="numeric"
        value={String(Number(value))}
        onFocus={e => e.target.select()}
        onChange={e => {
          if (disabled) return
          const v = e.target.value.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '')
          onChange(v === '' ? 0 : parseInt(v))
        }}
        readOnly={disabled}
        tabIndex={disabled ? -1 : undefined}
      />
      <span className="rate-symbol">%</span>
    </div>
  )
}

function QuoteTable({ title, percent, pairs, data }) {
  return (
    <div className="valuation-section">
      <div className="valuation-section-header">
        <h3 className="valuation-section-title">{title}</h3>
        {percent != null && <span className="valuation-percent">{percent}%</span>}
      </div>
      <table className="valuation-table">
        <thead>
          <tr><th>Term</th><th>Initial Quote</th><th>RAS Recoup</th><th>RAS Rate</th></tr>
        </thead>
        <tbody>
          {TERMS_DESC.map(term => {
            const [a, b] = pairs[TERMS.indexOf(term)]
            const q = parseFloat(data[a]) || 0
            const r = parseFloat(data[b]) || 0
            const rasRate = (q && r) ? Math.round((q / r) * 100) : null
            return (
              <tr key={term}>
                <td className="term-cell">{term}</td>
                <td>{fmt(data[a])}</td>
                <td>{fmt(data[b])}</td>
                <td>{rasRate !== null ? `${rasRate}%` : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function ValuationPage({ deal, dealIndex, onBack, onOpenAgreements, valuationState, onUpdateValuationState }) {
  const dealType = deal?.dealType || 'Individual'
  const defaultRates = DEFAULT_RATES[dealType] || DEFAULT_RATES.Individual
  const [rates, setRates] = useState(valuationState?.rates || { ...defaultRates })
  const [commission, setCommission] = useState((valuationState?.commission ?? parseFloat(deal?.commission)) || 4)
  const [b2bMarginRate, setB2bMarginRate] = useState(valuationState?.b2bMarginRate ?? 5)
  const [recoupLocked, setRecoupLocked] = useState(valuationState?.recoupLocked || false)
  const [advanceDraft, setAdvanceDraft] = useState({})
  const [creatingSheet, setCreatingSheet] = useState(false)
  const [sheetError, setSheetError] = useState(null)
  const [showB2BModal, setShowB2BModal] = useState(false)
  const [b2bTemplates, setB2bTemplates] = useState([])
  const [b2bTemplate, setB2bTemplate] = useState('')

  const marginRate = dealType === 'Individual' ? commission : b2bMarginRate

  useEffect(() => {
    onUpdateValuationState({ rates, commission, b2bMarginRate, recoupLocked })
  }, [rates, commission, b2bMarginRate, recoupLocked])

  useEffect(() => {
    if (dealType !== 'B2B') return
    const controller = new AbortController()
    fetch('/api/templates', { signal: controller.signal })
      .then(r => r.json())
      .then(cats => {
        const cat = cats.find(c => c.id === 'Deal Sheets')
        setB2bTemplates((cat?.templates || []).filter(t => !t.filename.startsWith('RTHM Deal Sheet')))
      })
      .catch(() => {})
    return () => controller.abort()
  }, [dealType])

  if (!deal) return null

  const iq = deal.initialQuote || {}
  const vq = deal.variableQuote || {}
  const showVariable = hasValues(vq, VQ_PAIRS)
  const pairs = showVariable ? VQ_PAIRS : IQ_PAIRS
  const source = showVariable ? vq : iq
  const showPrUplift = deal.royaltyType !== 'Publishing'

  async function submitDealSheet(extraPayload = {}) {
    setCreatingSheet(true)
    setSheetError(null)
    try {
      const res = await fetch(`/api/deals/${dealIndex}/create-agreement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'Deal Sheet', rates, commission, ...extraPayload })
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed')
      setShowB2BModal(false)
      onOpenAgreements(deal, dealIndex)
    } catch (err) {
      setSheetError(err.message)
    } finally {
      setCreatingSheet(false)
    }
  }

  function handleCreateDealSheet() {
    if (dealType === 'B2B') { setSheetError(null); setShowB2BModal(true); return }
    submitDealSheet()
  }

  function handleB2BCreate() {
    submitDealSheet({ b2bTemplate, margin: b2bMarginRate })
  }

  function setRate(term, val) {
    setRates(prev => ({ ...prev, [term]: val }))
  }

  const valuationRows = TERMS_DESC.map(term => {
    const termIdx = TERMS.indexOf(term)
    const [advCol, recoupCol] = pairs[termIdx]
    const rasAdvance = parseFloat(source[advCol]) || 0
    const rasRecoup = parseFloat(source[recoupCol]) || 0
    const rate = parseFloat(rates[term]) || 0
    const rthmAdvance = Math.round(rasRecoup * (rate / 100))
    const margin = dealType === 'B2B'
      ? Math.round(rasAdvance - rthmAdvance)
      : Math.round(rasAdvance - rthmAdvance - rthmAdvance * (marginRate / 100))
    return { term, rasAdvance, rasRecoup, rate, rthmAdvance, margin }
  })

  // PR Uplift always derives from Initial Quote, even when a Variable Quote is present.
  const prUpliftRows = showPrUplift ? TERMS_DESC.map(term => {
    const termIdx = TERMS.indexOf(term)
    const [advCol, recoupCol] = IQ_PAIRS[termIdx]
    const rasAdvance = parseFloat(iq[advCol]) || 0
    const rasRecoup = parseFloat(iq[recoupCol]) || 0
    const rate = parseFloat(rates[term]) || 0
    const rthmAdvance = Math.round(rasRecoup * (rate / 100))

    const marketingBudgetRaw = rasAdvance * 0.2 * (1 - 0.33) * 2.5
    const marketingBudget = Math.ceil(marketingBudgetRaw / 1000) * 1000
    const advanceAmount = Math.round(rthmAdvance * 0.8)
    const totalDealValue = advanceAmount + marketingBudget
    const margin1 = rasAdvance * 0.2 * 0.33
    const margin2 = 0.8 * (rasAdvance - rthmAdvance)
    const margin = dealType === 'B2B'
      ? Math.round(margin1 + margin2)
      : Math.round(margin1 + margin2 - (marginRate / 100) * advanceAmount)
    return { term, totalDealValue, advanceAmount, marketingBudget, marketingBudgetRaw, rate, margin, rasAdvance, rthmAdvance }
  }) : []

  return (
    <div className="valuation-page">
      <div className="valuation-header">
        <button className="back-btn" onClick={onBack}><span className="arr">◀</span> back</button>
        <div className="valuation-title-block">
          <h2 className="valuation-title">{deal.name}</h2>
          {deal.platform && <span className="valuation-sub">{deal.platform}</span>}
        </div>
        <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4}}>
          <button className="valuation-new-btn" onClick={handleCreateDealSheet} disabled={creatingSheet || !recoupLocked}>
            <span>{creatingSheet ? 'creating...' : '+ create deal sheet'}</span>
          </button>
          {sheetError && <span style={{fontSize:11, color:'var(--error)'}}>{sheetError}</span>}
        </div>
      </div>

      <div className="valuation-body">

        <div className="valuation-tables-row">
          <QuoteTable title="INITIAL QUOTE" pairs={IQ_PAIRS} data={iq} />
          {showVariable && <QuoteTable title="VARIABLE QUOTE" percent={deal.percent} pairs={VQ_PAIRS} data={vq} />}
        </div>

        <div className="valuation-section">
          <div className="valuation-section-header">
            <h3 className="valuation-section-title">RTHM VALUATION</h3>
            <span className="valuation-type-badge">{dealType}</span>
            {dealType === 'Individual' && <RateInput label="Commission" value={commission} onChange={setCommission} disabled={recoupLocked} />}
            {dealType === 'B2B' && <RateInput label="Margin" value={b2bMarginRate} onChange={setB2bMarginRate} disabled={recoupLocked} />}
          </div>
          <table className="valuation-table">
            <thead>
              <tr>
                <th>Term</th>
                <th>RTHM Advance</th>
                <th>Recoup Rate</th>
                <th>RAS Recoup</th>
                <th>Margin</th>
              </tr>
            </thead>
            <tbody>
              {valuationRows.map(({ term, rasAdvance, rasRecoup, rate, rthmAdvance, margin }) => {
                const marginTip = dealType === 'B2B'
                  ? `${fmt(rasAdvance)} − ${fmt(rthmAdvance)}`
                  : `${fmt(rasAdvance)} − ${fmt(rthmAdvance)} − (${fmt(rthmAdvance)} × ${marginRate}%)`
                const advTip = `${fmt(rasRecoup)} × ${rate}%`
                return (
                  <tr key={term}>
                    <td className="term-cell">{term}</td>
                    <td>
                      {recoupLocked ? (
                        <span className="calc-tip rate-locked" data-tip={advTip}>{fmt(rthmAdvance)}</span>
                      ) : (
                        <input
                          className="rate-input advance-input"
                          type="text"
                          inputMode="numeric"
                          value={advanceDraft[term] !== undefined ? advanceDraft[term] : String(rthmAdvance)}
                          onFocus={e => { setAdvanceDraft(prev => ({ ...prev, [term]: String(rthmAdvance) })); e.target.select() }}
                          onChange={e => {
                            const digits = e.target.value.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '')
                            setAdvanceDraft(prev => ({ ...prev, [term]: digits }))
                          }}
                          onBlur={() => {
                            const draftVal = advanceDraft[term]
                            if (draftVal != null && rasRecoup > 0) {
                              const v = parseInt(draftVal) || 0
                              const newRate = Math.round((v / rasRecoup) * 10000) / 100
                              setRate(term, String(newRate))
                            }
                            setAdvanceDraft(prev => { const next = { ...prev }; delete next[term]; return next })
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                        />
                      )}
                    </td>
                    <td>
                      {recoupLocked ? (
                        <span className="rate-locked">{rate.toFixed(2)}<span className="rate-symbol">%</span></span>
                      ) : (
                        <>
                          <input
                            className="rate-input"
                            type="text"
                            inputMode="decimal"
                            value={rates[term] != null ? String(rates[term]) : ''}
                            onFocus={e => e.target.select()}
                            onChange={e => {
                              let v = e.target.value.replace(/[^0-9.]/g, '')
                              const dotIdx = v.indexOf('.')
                              if (dotIdx !== -1) {
                                v = v.slice(0, dotIdx + 1) + v.slice(dotIdx + 1).replace(/\./g, '')
                                const [whole, dec] = v.split('.')
                                v = whole + '.' + (dec || '').slice(0, 2)
                              }
                              v = v.replace(/^0+(?=\d)/, '')
                              setRate(term, v)
                            }}
                          />
                          <span className="rate-symbol">%</span>
                        </>
                      )}
                    </td>
                    <td>{fmt(rasRecoup)}</td>
                    <td className={margin < 0 ? 'negative' : ''}>
                      <span className="calc-tip" data-tip={marginTip}>{fmt(margin)}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="recoup-actions">
            <button
              className={`recoup-btn${recoupLocked ? ' recoup-btn-inactive' : ' recoup-btn-active'}`}
              onClick={() => setRecoupLocked(true)}
              disabled={recoupLocked}
            ><span>Set Recoup</span></button>
            <button
              className={`recoup-btn${recoupLocked ? ' recoup-btn-active' : ' recoup-btn-inactive'}`}
              onClick={() => setRecoupLocked(false)}
              disabled={!recoupLocked}
            ><span>Edit Recoup</span></button>
          </div>
        </div>

        {showPrUplift && <div className="valuation-section">
          <div className="valuation-section-header">
            <h3 className="valuation-section-title">PR UPLIFT</h3>
          </div>
          <table className="valuation-table">
            <thead>
              <tr>
                <th>Term</th>
                <th>Total Deal Value</th>
                <th>Advance Amount</th>
                <th>Marketing Budget</th>
                <th>Recoup Rate</th>
                <th>Margin</th>
              </tr>
            </thead>
            <tbody>
              {prUpliftRows.map(({ term, totalDealValue, advanceAmount, marketingBudget, rate, margin, marketingBudgetRaw, rasAdvance, rthmAdvance }) => {
                const marginTip = dealType === 'B2B'
                  ? `(${fmt(rasAdvance)} × 20% × 33%) + (80% × (${fmt(rasAdvance)} − ${fmt(rthmAdvance)}))`
                  : `(${fmt(rasAdvance)} × 20% × 33%) + (80% × (${fmt(rasAdvance)} − ${fmt(rthmAdvance)})) − (${marginRate}% × ${fmt(advanceAmount)})`
                const totalTip = `${fmt(advanceAmount)} + ${fmt(marketingBudget)}`
                const advTip = `${fmt(rthmAdvance)} × 80%`
                const mktTip = `${fmt(rasAdvance)} × 20% × 67% × 2.5 = ${fmt(Math.round(marketingBudgetRaw))} → round up to ${fmt(marketingBudget)}`
                return (
                  <tr key={term}>
                    <td className="term-cell">{term}</td>
                    <td><span className="calc-tip" data-tip={totalTip}>{fmt(totalDealValue)}</span></td>
                    <td><span className="calc-tip" data-tip={advTip}>{fmt(advanceAmount)}</span></td>
                    <td><span className="calc-tip" data-tip={mktTip}>{fmt(marketingBudget)}</span></td>
                    <td>{rate}%</td>
                    <td className={margin < 0 ? 'negative' : ''}>
                      <span className="calc-tip" data-tip={marginTip}>{fmt(margin)}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>}

      </div>

      {showB2BModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowB2BModal(false)}>
          <div className="modal deal-sheet-modal">
            <div className="modal-header">
              <h2 className="modal-title">CREATE DEAL SHEETS</h2>
              <button className="modal-close" onClick={() => setShowB2BModal(false)}>✕</button>
            </div>
            <div className="modal-form">
              {sheetError && <div className="modal-error">{sheetError}</div>}
              <div className="modal-field">
                <label className="modal-label">B2B TEMPLATE</label>
                <Combobox
                  value={b2bTemplate}
                  placeholder="select template"
                  options={b2bTemplates.map(t => ({ value: t.filename, label: t.name.replace(/_?Template$/i, '').trim() }))}
                  onChange={e => setB2bTemplate(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="modal-cancel" onClick={() => setShowB2BModal(false)}><span>Cancel</span></button>
              <button
                className={`modal-import-btn${(!b2bTemplate || creatingSheet) ? ' disabled' : ''}`}
                onClick={handleB2BCreate}
                disabled={!b2bTemplate || creatingSheet}
              >
                <span>{creatingSheet ? 'creating...' : 'Create Sheets'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
