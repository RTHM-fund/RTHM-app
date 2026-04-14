import React, { useState } from 'react'
import './DataManagerPage.css'

export default function DataManagerPage() {
  const [datasets, setDatasets] = useState([])
  const [selectedFolder, setSelectedFolder] = useState(null)

  async function pickFolder() {
    const res = await fetch('/api/data/pick-folder', { method: 'POST' })
    const data = await res.json()
    if (data.ok) {
      setSelectedFolder(data.folderPath)
    }
  }

  return (
    <div className="data-manager-page">
      <div className="data-manager-header">
        <div className="data-manager-title-row">
          <h1 className="data-manager-title">DATA MANAGER</h1>
          <span className="data-manager-count-badge">{datasets.length}</span>
        </div>
        <button className="data-manager-import-btn" onClick={pickFolder}>+ Import Data</button>
      </div>

      {datasets.length === 0 ? (
        <div className="empty-state">
          <p className="empty-hint">click "import data" to get started</p>
        </div>
      ) : (
        <div className="data-manager-table-wrap">
          <table className="data-manager-table">
            <thead>
              <tr>
                <th>Dataset Name</th>
                <th>Platform</th>
                <th>Files</th>
                <th>Rows</th>
                <th>Date Range</th>
                <th>Delete</th>
              </tr>
            </thead>
            <tbody>
              {datasets.map((ds, i) => (
                <tr key={i}>
                  <td className="data-manager-td-name">{ds.name}</td>
                  <td>{ds.platform || '—'}</td>
                  <td>{ds.fileCount || '—'}</td>
                  <td>{ds.rowCount || '—'}</td>
                  <td>{ds.dateRange || '—'}</td>
                  <td><button className="data-manager-delete-btn">Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
