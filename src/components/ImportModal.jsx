import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import Combobox from './Combobox.jsx'
import './ImportModal.css'

const PUBLISHING = [
  'bmi', 'ascap', 'socan', 'sacem', 'kobalt', 'umg', 'warner',
  'empire pub', 'sony pub', 'sony publishing', 'legacy publishing',
]
const DISTRIBUTION = [
  'distrokid', 'tunecore', 'venice', 'create music group', 'create',
  'orchard', 'united masters', 'believe', 'toolost', 'too lost',
  'hitmaker', 'vydia', 'downtown', 'mad solutions', 'onerpm', 'somvibe',
  'sony masters', 'empire masters', 'sosouth', 'fuga', 'stem', 'gyro stream',
  'organic', 'revelator', 'cdbaby', 'cd baby', 'amuse', 'noteriety distro',
]

function inferRoyaltyType(selectedRows) {
  let hasPub = false
  let hasDistro = false

  selectedRows.forEach(row => {
    const raw = (row['C'] || '').toLowerCase().trim()

    // "pub" or "publishing" anywhere → publishing (catches Empire Pub, Curve (Pub), etc.)
    if (/pub(lishing)?/.test(raw)) { hasPub = true; return }

    if (PUBLISHING.some(k => raw.includes(k))) { hasPub = true; return }
    if (DISTRIBUTION.some(k => raw.includes(k))) { hasDistro = true; return }
  })

  if (hasPub && hasDistro) return 'Both'
  if (hasPub) return 'Publishing'
  if (hasDistro) return 'Distribution'
  return null // unrecognized — leave blank
}

export default function ImportModal({ onClose, onImported, editDeal = null, editIndex = null }) {
  const isEdit = editDeal !== null

  const [connected, setConnected] = useState(false)
  const [rows, setRows] = useState([])
  const [headerMap, setHeaderMap] = useState({})
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [step, setStep] = useState(1)
  const [dealType, setDealType] = useState(editDeal?.dealType || '')
  const [royaltyType, setRoyaltyType] = useState(editDeal?.royaltyType || 'Distribution')
  const [commission, setCommission] = useState(editDeal?.commission || '4')
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    fetch('/api/auth/status')
      .then(r => r.json())
      .then(d => {
        setConnected(d.connected)
        if (d.connected) loadRows()
        else setLoading(false)
      })
  }, [])

  function loadRows() {
    setLoading(true)
    setError(null)
    fetch('/api/deals/sheet-rows')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setHeaderMap(data.headerMap)
        setRows(data.rows)
        if (isEdit && editDeal.name) {
          const preSelected = new Set(
            data.rows.reduce((acc, row, i) => {
              if (row['A']?.trim() === editDeal.name) acc.push(i)
              return acc
            }, [])
          )
          setSelected(preSelected)
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }

  async function handleConnect() {
    const res = await fetch('/api/auth/url').then(r => r.json())
    const popup = window.open(res.url, '_blank', 'width=500,height=600')
    const interval = setInterval(async () => {
      try {
        const status = await fetch('/api/auth/status').then(r => r.json())
        if (status.connected) {
          clearInterval(interval)
          popup?.close()
          setConnected(true)
          loadRows()
        }
      } catch {}
    }, 1000)
    setTimeout(() => clearInterval(interval), 120000)
  }

  function toggleRow(i) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === filteredIndices.length) setSelected(new Set())
    else setSelected(new Set(filteredIndices))
  }

  const filteredIndices = rows.reduce((acc, row, i) => {
    const matches = !search ||
      (row['A'] || '').toLowerCase().includes(search.toLowerCase()) ||
      (row['C'] || '').toLowerCase().includes(search.toLowerCase())
    if (matches) acc.push(i)
    return acc
  }, [])

  const filtered = filteredIndices.map(i => rows[i])

  const selectedNames = new Set([...selected].map(i => rows[i]?.['A']?.trim()))
  const canProceed = selected.size > 0 && selectedNames.size === 1
  const canImport = dealType && royaltyType && (dealType !== 'Individual' || commission)

  async function handleImport() {
    if (!canImport) return
    setImporting(true)
    setError(null)
    try {
      const selectedRows = [...selected].map(i => rows[i])
      const dealName = selectedRows[0]?.['A']?.trim() || 'Untitled Deal'
      const body = JSON.stringify({ rows: selectedRows, dealType, royaltyType, commission })

      if (isEdit) {
        const res = await fetch(`/api/deals/${editIndex}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body
        })
        const data = await res.json()
        if (!res.ok || data.error) throw new Error(data.error || 'Update failed')
      } else {
        // Push to Monday first to get the item ID
        const mondayRes = await fetch('/api/monday/create-deal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: dealName, type: dealType, commission })
        })
        const mondayData = await mondayRes.json()
        if (!mondayRes.ok || mondayData.error) throw new Error('Monday: ' + (mondayData.error || 'Failed'))

        const importRes = await fetch('/api/deals/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: selectedRows, dealType, royaltyType, commission, mondayItemId: mondayData.id })
        })
        const importData = await importRes.json()
        if (!importRes.ok || importData.error) throw new Error(importData.error || 'Import failed')
      }

      onImported()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setImporting(false)
    }
  }

  return createPortal(
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">{step === 1 ? 'SELECT ROWS' : 'DEAL DETAILS'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* ── Step 1: Row selection ── */}
        {step === 1 && (
          <>
            {!connected ? (
              <div className="modal-connect">
                <p>Connect to Google Sheets to import deals.</p>
                <button className="modal-connect-btn" onClick={handleConnect}><span>Connect Google Sheets</span></button>
              </div>
            ) : (
              <>
                <div className="modal-search-wrap">
                  <input
                    className="modal-search"
                    placeholder="search by deal name or platform"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                  {selected.size > 0 && (
                    <span className="modal-selected-count">{selected.size} selected</span>
                  )}
                </div>

                {loading && <div className="modal-status">Loading sheet data…</div>}
                {error && <div className="modal-error">{error}</div>}

                {!loading && !error && (
                  <div className="modal-table-wrap">
                    <table className="modal-table">
                      <thead>
                        <tr>
                          <th></th>
                          <th>{headerMap['A'] || 'Deal'}</th>
                          <th>{headerMap['C'] || 'Distributor/PRO'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.length === 0 && (
                          <tr><td colSpan={3} className="modal-empty">No deals found</td></tr>
                        )}
                        {filtered.map((row, fi) => {
                          const ri = filteredIndices[fi]
                          return (
                            <tr key={ri} className={selected.has(ri) ? 'selected' : ''} onClick={() => toggleRow(ri)}>
                              <td><input type="checkbox" checked={selected.has(ri)} onChange={() => toggleRow(ri)} onClick={e => e.stopPropagation()} /></td>
                              <td>{row['A'] || '—'}</td>
                              <td>{row['C'] || '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="modal-footer">
                  <button className="modal-cancel" onClick={onClose}><span>Cancel</span></button>
                  <button
                    className={`modal-import-btn ${!canProceed ? 'disabled' : ''}`}
                    onClick={() => {
                      setError(null)
                      if (!isEdit) {
                        const inferred = inferRoyaltyType([...selected].map(i => rows[i]))
                        if (inferred) setRoyaltyType(inferred)
                      }
                      setStep(2)
                    }}
                    disabled={!canProceed}
                  >
                    <span>next <span className="arr">▶</span></span>
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {/* ── Step 2: Deal details ── */}
        {step === 2 && (
          <>
            <div className="modal-form">
              {error && <div className="modal-error">{error}</div>}

              <div className="modal-field">
                <label className="modal-label">ROYALTY TYPE</label>
                <Combobox
                  className="combobox--form"
                  value={royaltyType}
                  onChange={e => setRoyaltyType(e.target.value)}
                  options={[
                    { value: 'Distribution', label: 'Distribution' },
                    { value: 'Publishing', label: 'Publishing' },
                    { value: 'Both', label: 'Both' },
                  ]}
                />
              </div>

              <div className="modal-field">
                <label className="modal-label">DEAL TYPE</label>
                <div className="modal-radio-group">
                  {['B2B', 'Individual'].map(t => (
                    <button
                      key={t}
                      className={`modal-radio-btn ${dealType === t ? 'active' : ''}`}
                      onClick={() => setDealType(t)}
                    >
                      <span>{t}</span>
                    </button>
                  ))}
                </div>
              </div>

            </div>

            <div className="modal-footer">
              <button className="modal-cancel" onClick={() => { setStep(1); setError(null) }}><span><span className="arr">◀</span> back</span></button>
              <button
                className={`modal-import-btn ${!canImport || importing ? 'disabled' : ''}`}
                onClick={handleImport}
                disabled={!canImport || importing}
              >
                <span>{importing ? (isEdit ? 'Saving…' : 'Creating Deal…') : (isEdit ? 'Save Changes' : 'Create Deal')}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
