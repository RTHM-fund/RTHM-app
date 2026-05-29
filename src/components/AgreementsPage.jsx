import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ROW_DEFS, matchAgreement } from '../agreementDefs.js'
import Combobox from './Combobox.jsx'
import './AgreementsPage.css'

export default function AgreementsPage({ deal, dealIndex, onBack, onNavigateToOfferLetter, onNavigateToRPA }) {
  const [agreements, setAgreements] = useState([])
  const [showTypePicker, setShowTypePicker] = useState(false)
  const [creating, setCreating] = useState(null)
  const [error, setError] = useState(null)
  const [showB2BModal, setShowB2BModal] = useState(false)
  const [b2bTemplates, setB2bTemplates] = useState([])
  const [b2bTemplate, setB2bTemplate] = useState('')
  const [b2bCreating, setB2bCreating] = useState(false)
  const [b2bError, setB2bError] = useState(null)
  const [showPartnerModal, setShowPartnerModal] = useState(false)
  const [partnerFields, setPartnerFields] = useState({})
  const [partnerSaving, setPartnerSaving] = useState(false)
  const [exporting, setExporting] = useState(null)

  const dealType = deal?.dealType || 'Individual'
  const rows = ROW_DEFS[dealType] || ROW_DEFS.Individual
  const matched = Object.fromEntries(rows.map(r => [r, matchAgreement(r, agreements)]))

  function loadAgreements() {
    fetch(`/api/deals/${dealIndex}/agreements`)
      .then(r => r.json())
      .then(setAgreements)
      .catch(() => {})
  }

  useEffect(() => {
    loadAgreements()
    window.addEventListener('focus', loadAgreements)
    return () => window.removeEventListener('focus', loadAgreements)
  }, [dealIndex])

  useEffect(() => {
    if (dealType !== 'B2B') return
    fetch('/api/templates')
      .then(r => r.json())
      .then(cats => {
        const sheets = cats.find(c => c.id === 'Deal Sheets')
        setB2bTemplates((sheets?.templates || []).filter(t => !t.filename.startsWith('RTHM Deal Sheet')))
      })
      .catch(() => {})
  }, [dealType])

  useEffect(() => {
    if (!showPartnerModal || !deal.b2bPartner) return
    fetch(`/api/b2b-partners/${encodeURIComponent(deal.b2bPartner)}`)
      .then(r => r.json())
      .then(setPartnerFields)
      .catch(() => {})
  }, [showPartnerModal])

  async function handleSavePartner() {
    if (!deal.b2bPartner) return
    setPartnerSaving(true)
    try {
      await fetch(`/api/b2b-partners/${encodeURIComponent(deal.b2bPartner)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partnerFields)
      })
      setShowPartnerModal(false)
    } catch (e) {}
    setPartnerSaving(false)
  }

  async function handleCreate(type) {
    setCreating(type)
    setError(null)
    try {
      const vs = deal.valuationState || {}
      const payload = type === 'RTHM Deal Sheet'
        ? { type: 'Deal Sheet', rates: vs.rates, commission: vs.commission }
        : { type }
      const res = await fetch(`/api/deals/${dealIndex}/create-agreement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed')
      setAgreements(prev => {
        const next = [...prev]
        for (const entry of data.created || []) {
          const i = next.findIndex(ag => ag.fileName === entry.fileName)
          if (i !== -1) next[i] = entry
          else next.push(entry)
        }
        return next
      })
      setShowTypePicker(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(null)
    }
  }

  async function handleB2BCreate() {
    if (!b2bTemplate) return
    setB2bCreating(true)
    setB2bError(null)
    const vs = deal.valuationState || {}
    try {
      const res = await fetch(`/api/deals/${dealIndex}/create-agreement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'Deal Sheet',
          b2bTemplate,
          margin: vs.b2bMarginRate ?? 5,
          rates: vs.rates,
          commission: vs.commission,
          b2bOnly: true
        })
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed')
      setAgreements(prev => {
        const next = [...prev]
        for (const entry of data.created || []) {
          const i = next.findIndex(ag => ag.fileName === entry.fileName)
          if (i !== -1) next[i] = entry
          else next.push(entry)
        }
        return next
      })
      setShowB2BModal(false)
      setB2bTemplate('')
    } catch (err) {
      setB2bError(err.message)
    } finally {
      setB2bCreating(false)
    }
  }

  async function handleOpen(ag) {
    const i = agreements.indexOf(ag)
    try {
      const res = await fetch(`/api/deals/${dealIndex}/agreements/${i}/open`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (data?.cleared) setAgreements(prev => prev.filter(a => a !== ag))
    } catch {}
  }

  async function handleExportPDF(ag, rowLabel) {
    const i = agreements.indexOf(ag)
    setExporting(i)
    try {
      const isDealSheet = rowLabel.toLowerCase().includes('deal sheet')
      const res = await fetch(`/api/deals/${dealIndex}/agreements/${i}/export-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDealSheet })
      })
      const data = await res.json()
      if (data?.cleared) { setAgreements(prev => prev.filter(a => a !== ag)); return }
      if (!res.ok || data.error) throw new Error(data.error || 'Export failed')
    } catch (err) {
      alert('Export failed: ' + err.message)
    } finally {
      setExporting(null)
    }
  }

  async function handleDelete(ag) {
    const i = agreements.indexOf(ag)
    const ok = await fetch(`/api/deals/${dealIndex}/agreements/${i}`, { method: 'DELETE' })
      .then(r => r.ok).catch(() => false)
    if (ok) setAgreements(prev => prev.filter(a => a !== ag))
  }

  return (
    <div className="agreements-page">
      <div className="agreements-header">
        <button className="back-btn" onClick={onBack}><span className="arr">◀</span> back</button>
        <div className="agreements-title-block">
          <h2 className="agreements-title">{deal.name}</h2>
          <span className="agreements-sub">Agreements</span>
        </div>
        {deal.b2bPartner && (
          <span
            className="agreements-partner"
            onClick={e => { if (e.altKey) setShowPartnerModal(true) }}
          >
            {deal.b2bPartner}
          </span>
        )}
        <button className="agreements-new-btn" onClick={() => { setError(null); setShowTypePicker(true) }}><span>+ create new agreement</span></button>
      </div>

      <div className="agreements-body">
        <div className="agreements-table-wrap">
          <table className="agreements-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>File Name</th>
                <th>Edit</th>
                <th>Export</th>
                <th>Delete</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(rowLabel => {
                const ag = matched[rowLabel]
                if (ag) {
                  return (
                    <tr key={rowLabel}>
                      <td>{rowLabel}</td>
                      <td className="agreements-td-name">{ag.fileName.replace(/\.[^.]+$/, '')}</td>
                      <td><button className="agreements-edit-btn" onClick={() => handleOpen(ag)}><span>edit DOC</span></button></td>
                      <td><button className={`agreements-export-btn${exporting === agreements.indexOf(ag) ? ' is-processing' : ''}`} onClick={() => handleExportPDF(ag, rowLabel)} disabled={exporting === agreements.indexOf(ag)}><span>{exporting === agreements.indexOf(ag) ? 'exporting…' : 'export PDF'}</span></button></td>
                      <td><button className="agreements-delete-btn" onClick={() => handleDelete(ag)}><span>delete</span></button></td>
                    </tr>
                  )
                }
                return (
                  <tr key={rowLabel} className="agreements-row-pending">
                    <td>{rowLabel}</td>
                    <td>—</td>
                    <td>—</td>
                    <td>—</td>
                    <td>—</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showTypePicker && createPortal(
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowTypePicker(false)}>
          <div className="modal agreements-type-modal">
            <div className="modal-header">
              <h2 className="modal-title">SELECT AGREEMENT TYPE</h2>
              <button className="modal-close" onClick={() => setShowTypePicker(false)}>✕</button>
            </div>
            <div className="agreements-type-list">
              {error && <div className="modal-error">{error}</div>}
              {rows.filter(type => !matched[type]).map(type => {
                const idx = rows.indexOf(type)
                const isUnlocked = idx === 0 || !!matched[rows[idx - 1]]
                return (
                  <button
                    key={type}
                    className={`agreements-type-btn${creating === type ? ' is-processing' : ''}`}
                    onClick={() => {
                      if (type === 'B2B Deal Sheet') {
                        setShowTypePicker(false)
                        setB2bError(null)
                        setB2bTemplate('')
                        setShowB2BModal(true)
                      } else if (type === 'RTHM Offer Letter' || type === 'B2B Offer Letter') {
                        setShowTypePicker(false)
                        onNavigateToOfferLetter(deal, dealIndex, type)
                      } else if (type === 'RTHM RPA' || type === 'RTHM x RAS RPA' || type === 'B2B RPA') {
                        setShowTypePicker(false)
                        onNavigateToRPA(deal, dealIndex, type === 'RTHM x RAS RPA' ? 'RTHM RPA' : type)
                      } else {
                        handleCreate(type)
                      }
                    }}
                    disabled={creating !== null || !isUnlocked}
                  >
                    <span>{creating === type ? 'creating...' : type}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>,
        document.body
      )}

      {showB2BModal && createPortal(
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowB2BModal(false)}>
          <div className="modal deal-sheet-modal">
            <div className="modal-header">
              <h2 className="modal-title">CREATE DEAL SHEETS</h2>
              <button className="modal-close" onClick={() => setShowB2BModal(false)}>✕</button>
            </div>
            <div className="modal-form">
              {b2bError && <div className="modal-error">{b2bError}</div>}
              <div className="modal-field">
                <label className="modal-label">B2B TEMPLATE</label>
                <Combobox
                  className="combobox--form"
                  value={b2bTemplate}
                  placeholder="select template"
                  options={b2bTemplates.map(t => ({ value: t.filename, label: t.name.replace(/_?Template$/i, '').trim() }))}
                  onChange={e => {
                    const val = e.target.value
                    setB2bTemplate(val)
                    const partner = val.replace(/_?Template\.docx$/i, '').replace(/_/g, ' ').replace(/\s*Deal Sheet$/i, '').trim()
                    if (partner) {
                      deal.b2bPartner = partner
                      fetch(`/api/deals/${dealIndex}/b2b-partner`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ partner })
                      }).catch(() => {})
                    }
                  }}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="modal-cancel" onClick={() => setShowB2BModal(false)}><span>Cancel</span></button>
              <button
                className={`modal-import-btn${(!b2bTemplate || b2bCreating) ? ' disabled' : ''}${b2bCreating ? ' is-processing' : ''}`}
                onClick={handleB2BCreate}
                disabled={!b2bTemplate || b2bCreating}
              >
                <span>{b2bCreating ? 'creating...' : 'Create Sheet'}</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showPartnerModal && deal.b2bPartner && createPortal(
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowPartnerModal(false)}>
          <div className="modal partner-modal">
            <div className="modal-header">
              <h2 className="modal-title">{deal.b2bPartner.toUpperCase()} PARTNER INFO</h2>
              <button className="modal-close" onClick={() => setShowPartnerModal(false)}>✕</button>
            </div>
            <div className="modal-form">
              {['B2B Entity', 'B2B Address', 'B2B Partner', 'B2B Website', 'B2B Signer', 'B2B Title'].map(key => (
                <div key={key} className="modal-field">
                  <label className="modal-label">{key.replace(/^B2B\s*/i, '')}</label>
                  <input
                    className="modal-input"
                    value={partnerFields[key] || ''}
                    onChange={e => setPartnerFields(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder={key === 'B2B Partner' ? deal.b2bPartner : ''}
                  />
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button className="modal-cancel" onClick={() => setShowPartnerModal(false)}><span>cancel</span></button>
              <button
                className={`modal-import-btn${partnerSaving ? ' disabled' : ''}${partnerSaving ? ' is-processing' : ''}`}
                onClick={handleSavePartner}
                disabled={partnerSaving}
              >
                <span>{partnerSaving ? 'saving…' : 'save'}</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
