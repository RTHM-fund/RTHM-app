import React, { useState, useEffect } from 'react'
import './DataManagerPage.css'

// Build a new Map with completed entries removed (folder gone, or completion flag flipped).
// Returns the same `prev` reference if nothing changed, so React skips re-render.
function clearCompletedSkills(prev, list) {
  let changed = false
  const next = new Map()
  for (const [folderPath, skills] of prev) {
    const folder = list.find(f => f.path === folderPath)
    if (!folder) { changed = true; continue }
    const remaining = new Set(skills)
    if (skills.has('diligence') && folder.hasDiligence) { remaining.delete('diligence'); changed = true }
    if (skills.has('catalog-extract') && folder.hasExtract) { remaining.delete('catalog-extract'); changed = true }
    if (remaining.size > 0) next.set(folderPath, remaining)
  }
  return changed ? next : prev
}

// runningSkills is lifted to App.jsx so spinners survive page navigation.
export default function DataManagerPage({ runningSkills, setRunningSkills }) {
  const [folders, setFolders] = useState([])
  const [selectedFolderPath, setSelectedFolderPath] = useState(null)

  useEffect(() => {
    loadFolders()
    window.addEventListener('focus', loadFolders)
    return () => window.removeEventListener('focus', loadFolders)
  }, [])

  useEffect(() => {
    function handleDocMouseDown(e) {
      // Don't clear selection when clicking action buttons that operate on the selected row.
      if (!e.target.closest('.data-manager-table-wrap, .data-manager-header-actions')) {
        setSelectedFolderPath(null)
      }
    }
    document.addEventListener('mousedown', handleDocMouseDown)
    return () => document.removeEventListener('mousedown', handleDocMouseDown)
  }, [])

  // Poll every 10s while any skill is running; loadFolders also reconciles runningSkills.
  useEffect(() => {
    if (runningSkills.size === 0) return
    const interval = setInterval(loadFolders, 10000)
    return () => clearInterval(interval)
  }, [runningSkills.size > 0])

  function loadFolders() {
    fetch('/api/data/folders')
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data) ? data : []
        setFolders(list)
        setSelectedFolderPath(prev => (prev && list.some(f => f.path === prev) ? prev : null))
        setRunningSkills(prev => clearCompletedSkills(prev, list))
      })
      .catch(() => {})
  }

  function openDataFolder() {
    fetch('/api/data/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'current' }),
    }).catch(() => {})
  }

  function runSkill(skill) {
    if (!selectedFolderPath) return
    const folderPath = selectedFolderPath
    fetch('/api/data/run-skill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill, folderPath }),
    })
      .then(r => r.json())
      .then(data => {
        if (data && data.ok) {
          setRunningSkills(prev => {
            const next = new Map(prev)
            const skills = new Set(next.get(folderPath) || [])
            skills.add(skill)
            next.set(folderPath, skills)
            return next
          })
        }
      })
      .catch(() => {})
  }

  return (
    <div className="data-manager-page">
      <div className="data-manager-header">
        <div className="data-manager-title-row">
          <h1 className="data-manager-title">DATA MANAGER</h1>
          <span className="data-manager-count-badge">{folders.length}</span>
          <div className="data-manager-header-actions">
            <button className="data-manager-summarize-btn" onClick={() => runSkill('diligence')}><span>Diligence</span></button>
            <button className="data-manager-valuate-btn"><span>Valuate</span></button>
            <button className="data-manager-extract-btn" onClick={() => runSkill('catalog-extract')}><span>Extract</span></button>
          </div>
        </div>
        <button className="data-manager-import-btn" onClick={openDataFolder}><span>+ Import Data</span></button>
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
                <th>Extract</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {folders.map((f) => {
                const isSelected = selectedFolderPath === f.path
                const isRunning = runningSkills.has(f.path)
                const trClass = [isSelected && 'selected', isRunning && 'running'].filter(Boolean).join(' ')
                return (
                  <tr
                    key={f.path}
                    className={trClass}
                    onClick={() => setSelectedFolderPath(prev => prev === f.path ? null : f.path)}
                  >
                    <td className="data-manager-td-name" title={f.name}>
                      <div className="data-manager-cell-truncate">
                        {f.name}
                        {isRunning && <span className="data-manager-row-spinner" aria-label="running" />}
                      </div>
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
                    <td>
                      <span className={`diligence-mark ${f.hasExtract ? 'found' : 'missing'}`}>
                        {f.hasExtract ? '✓' : '?'}
                      </span>
                    </td>
                    <td></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

    </div>
  )
}
