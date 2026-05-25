import React, { useState, useEffect } from 'react'
import ImportModal from './ImportModal.jsx'
import { ROW_DEFS, matchAgreement } from '../agreementDefs.js'
import './DealsPage.css'

export default function DealsPage({ onOpenValuation, onOpenAgreements, valuationStates = {} }) {
  const [deals, setDeals] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editIndex, setEditIndex] = useState(null)

  useEffect(() => {
    loadDeals()
    window.addEventListener('focus', loadDeals)
    return () => window.removeEventListener('focus', loadDeals)
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
      await handleRelink(deal._idx)
    }
  }

  return (
    <div className="deals-page">
      <div className="deals-page-header">
        <div className="deals-title-row">
          <h1 className="deals-page-title">DEAL MANAGER</h1>
          <span className="deals-count-badge">{deals.length}</span>
        </div>
        <button className="deals-new-btn" onClick={() => setShowModal(true)}>+ Create New Deal</button>
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
                <th>Royalty Type</th>
                <th>Deal Type</th>
                <th>Status</th>
                <th>Valuation</th>
                <th>Agreements</th>
                <th>Deal Materials</th>
                <th>Delete</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((deal) => (
                <tr key={deal._idx}>
                  <td className="deals-td-name" title={deal.name} onContextMenu={e => { e.preventDefault(); setEditIndex(deal._idx); setShowModal(true) }}>
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
                  >Valuation</button></td>
                  <td><button
                    className={`deals-forms-btn${(ROW_DEFS[deal.dealType] || ROW_DEFS.Individual).every(r => matchAgreement(r, deal.agreements || [])) ? ' linked' : ''}`}
                    onClick={() => onOpenAgreements(deal, deal._idx)}
                  >Agreements</button></td>
                  <td>
                    <button
                      className={`deals-materials-btn${deal.folderPath ? ' linked' : ''}`}
                      onClick={() => handleDealMaterials(deal)}
                      onContextMenu={e => { e.preventDefault(); handleRelink(deal._idx) }}
                    >Deal Materials</button>
                  </td>
                  <td><button className="deals-delete-btn" onClick={() => deleteDeal(deal._idx)}>Delete</button></td>
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
