import React, { useState, useEffect } from 'react'
import ImportModal from './ImportModal.jsx'
import { ROW_DEFS, matchAgreement } from '../agreementDefs.js'
import './DealsPage.css'

export default function DealsPage({ onOpenValuation, onOpenAgreements, valuationStates = {} }) {
  const [deals, setDeals] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editIndex, setEditIndex] = useState(null)
  const [selectedDealIdx, setSelectedDealIdx] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    loadDeals()
    window.addEventListener('focus', loadDeals)
    return () => window.removeEventListener('focus', loadDeals)
  }, [])

  // Mirror Data Manager's outside-click deselect — exempt the table wrap and the
  // page header (so right-clicks on row names and clicks on "+ Create New Deal"
  // don't deselect).
  useEffect(() => {
    function handleDocMouseDown(e) {
      if (!e.target.closest('.deals-table-wrap, .deals-page-header')) {
        setSelectedDealIdx(null)
      }
    }
    document.addEventListener('mousedown', handleDocMouseDown)
    return () => document.removeEventListener('mousedown', handleDocMouseDown)
  }, [])

  function loadDeals() {
    fetch('/api/deals/saved')
      .then(r => r.json())
      .then(data => setDeals(data.map((d, i) => ({ ...d, _idx: i })).reverse()))
      .catch(() => {})
  }

  function deleteDeal(idx) {
    fetch(`/api/deals/${idx}`, { method: 'DELETE' })
      .then(() => loadDeals())
      .catch(() => {})
  }

  async function handleRelink(idx) {
    const res = await fetch(`/api/deals/${idx}/pick-folder`, { method: 'POST' })
    const data = await res.json()
    if (data.ok) loadDeals()
  }

  async function handleDealMaterials(deal) {
    if (deal.folderPath) {
      const res = await fetch(`/api/deals/${deal._idx}/open-folder`, { method: 'POST' })
      if (!res.ok) loadDeals()
    } else {
      // No linked folder yet — open the materials root in Explorer/Finder so the user
      // can manually find or create the folder. Right-click still calls handleRelink to link.
      fetch('/api/data/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'materials-root' }),
      }).catch(() => {})
    }
  }

  const q = search.trim().toLowerCase()
  const visibleDeals = q ? deals.filter(d => (d.name || '').toLowerCase().includes(q)) : deals

  return (
    <div className="deals-page">
      <div className="deals-page-header">
        <div className="deals-title-row">
          <h1 className="deals-page-title">DEAL MANAGER</h1>
          <span className="deals-count-badge">{deals.length}</span>
        </div>
        <div className="deals-header-right">
          <input
            className="deals-search"
            placeholder="search by deal name"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="deals-new-btn" onClick={() => setShowModal(true)}><span>+ Create New Deal</span></button>
        </div>
      </div>

      {deals.length === 0 ? (
        <div className="empty-state">
          <p className="empty-hint">click "create new deal" to import from Google Sheets</p>
        </div>
      ) : (
        <div className="deals-table-wrap">
          <table className="deals-table">
            <thead>
              <tr>
                <th>Deal Name</th>
                <th>Platform(s)</th>
                <th>Royalty</th>
                <th>Type</th>
                <th>Status</th>
                <th>Valuation</th>
                <th>Agreements</th>
                <th>Deal Materials</th>
                <th>Delete</th>
              </tr>
            </thead>
            <tbody>
              {visibleDeals.map((deal) => (
                <tr
                  key={deal._idx}
                  className={selectedDealIdx === deal._idx ? 'selected' : ''}
                  onClick={e => {
                    // Don't toggle when clicking row buttons / links — let them do their own thing.
                    if (e.target.closest('button, a')) return
                    setSelectedDealIdx(prev => prev === deal._idx ? null : deal._idx)
                  }}
                >
                  <td className="deals-td-name" title={deal.name} onClick={e => { if (!e.altKey) return; e.stopPropagation(); setEditIndex(deal._idx); setShowModal(true) }}>
                    <div className="deals-cell-truncate">{deal.name}</div>
                  </td>
                  <td title={deal.platform || ''}>
                    <div className="deals-cell-truncate">{deal.platform || '—'}</div>
                  </td>
                  <td>{deal.royaltyType || '—'}</td>
                  <td>{deal.dealType || '—'}</td>
                  <td>
                    {deal.mondayItemId
                      ? <a className="deals-monday-btn" href={`https://rthmfund.monday.com/boards/${deal.mondayBoardId}/pulses/${deal.mondayItemId}`} target="_blank" rel="noreferrer"><img src="/monday-logo.png" alt="monday.com" /></a>
                      : '—'}
                  </td>
                  <td><button
                    className={`deals-valuation-btn${deal.valuationState?.recoupLocked && deal.agreements?.some(ag => ag.fileName?.startsWith('RTHM Deal Sheet')) ? ' linked' : ''}`}
                    onClick={() => onOpenValuation(deal, deal._idx)}
                  ><span>Valuation</span></button></td>
                  <td><button
                    className={`deals-forms-btn${(ROW_DEFS[deal.dealType] || ROW_DEFS.Individual).every(r => matchAgreement(r, deal.agreements || [])) ? ' linked' : ''}`}
                    onClick={() => onOpenAgreements(deal, deal._idx)}
                  ><span>Agreements</span></button></td>
                  <td>
                    <button
                      className={`deals-materials-btn${deal.folderPath ? ' linked' : ''}`}
                      onClick={e => e.altKey ? handleRelink(deal._idx) : handleDealMaterials(deal)}
                    ><span>Deal Materials</span></button>
                  </td>
                  <td><button className="deals-delete-btn" onClick={() => deleteDeal(deal._idx)}><span>Delete</span></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <ImportModal
          onClose={() => { setShowModal(false); setEditIndex(null) }}
          onImported={loadDeals}
          editDeal={editIndex !== null ? deals.find(d => d._idx === editIndex) : null}
          editIndex={editIndex}
        />
      )}
    </div>
  )
}
