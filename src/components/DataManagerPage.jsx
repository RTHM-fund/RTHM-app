import React, { useState, useEffect } from 'react'
import ScanResultsModal from './ScanResultsModal'
import './DataManagerPage.css'

export default function DataManagerPage() {
  const [folders, setFolders] = useState([])
  const [scanFolderPath, setScanFolderPath] = useState(null)

  useEffect(() => {
    loadFolders()
    window.addEventListener('focus', loadFolders)
    return () => window.removeEventListener('focus', loadFolders)
  }, [])

  function loadFolders() {
    fetch('/api/data/folders')
      .then(r => r.json())
      .then(data => setFolders(Array.isArray(data) ? data : []))
      .catch(() => {})
  }

  async function pickFolder() {
    const res = await fetch('/api/data/pick-folder', { method: 'POST' })
    const data = await res.json()
    if (data.ok) {
      setScanFolderPath(data.folderPath)
    }
  }

  return (
    <div className="data-manager-page">
      <div className="data-manager-header">
        <div className="data-manager-title-row">
          <h1 className="data-manager-title">DATA MANAGER</h1>
          <span className="data-manager-count-badge">{folders.length}</span>
        </div>
        <button className="data-manager-import-btn" onClick={pickFolder}><span>+ Import Data</span></button>
      </div>

      {folders.length === 0 ? (
        <div className="empty-state">
          <p className="empty-hint">no folders found in 1. Data/1. Current</p>
        </div>
      ) : (
        <div className="data-manager-table-wrap">
          <table className="data-manager-table">
            <thead>
              <tr>
                <th>Folder Name</th>
                <th>Diligence</th>
                <th>Quote</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {folders.map((f) => (
                <tr key={f.path}>
                  <td className="data-manager-td-name" title={f.name}>
                    <div className="data-manager-cell-truncate">{f.name}</div>
                  </td>
                  <td>
                    <span className={`diligence-mark ${f.hasDiligence ? 'found' : 'missing'}`}>
                      {f.hasDiligence ? '✓' : '?'}
                    </span>
                  </td>
                  <td>
                    <span className={`diligence-mark ${f.hasDeal ? 'found' : 'missing'}`}>
                      {f.hasDeal ? '✓' : '?'}
                    </span>
                  </td>
                  <td></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {scanFolderPath && (
        <ScanResultsModal
          folderPath={scanFolderPath}
          onClose={() => setScanFolderPath(null)}
          onNext={() => { /* Step 2 — column standardization — coming next */ }}
        />
      )}
    </div>
  )
}
