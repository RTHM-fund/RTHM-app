import React, { useState, useEffect } from 'react'
import './DataManagerPage.css'

function fmtInt(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

// Minimal sparkline — line shape only, no axes/labels/dots.
function Sparkline({ values, width = 64, height = 24 }) {
  if (!values || values.length < 2) return <span className="data-manager-cell-empty">—</span>
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const pad = 2
  const w = width - pad * 2
  const h = height - pad * 2
  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * w
    const y = pad + h - ((v - min) / range) * h
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="data-manager-sparkline">
      <path d={'M' + points.join(' L')} fill="none" stroke="var(--primary)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// Build a new Map with completed entries removed (folder gone, completion flag
// flipped, or the server marked the skill stale — empty/old log with no progress).
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
    const stale = folder.staleSkills || []
    for (const s of stale) {
      if (remaining.has(s)) { remaining.delete(s); changed = true }
    }
    if (remaining.size > 0) next.set(folderPath, remaining)
  }
  return changed ? next : prev
}

// runningSkills is lifted to App.jsx so spinners survive page navigation.
export default function DataManagerPage({ runningSkills, setRunningSkills, onOpenValuate }) {
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
        } else if (data && data.error) {
          window.alert(`Could not start ${skill}:\n\n${data.error}`)
        }
      })
      .catch(() => {})
  }

  // Action availability per the table columns: each button is enabled only when
  // a folder is selected AND that folder's corresponding column shows ?.
  // Diligence ↔ hasDiligence,  Valuate ↔ hasDeal (Quote column),  Extract ↔ hasExtract.
  const selectedFolder = folders.find(f => f.path === selectedFolderPath) || null
  const diligenceDisabled = !selectedFolder || selectedFolder.hasDiligence
  const valuateDisabled = !selectedFolder || selectedFolder.hasDeal
  const extractDisabled = !selectedFolder || selectedFolder.hasExtract

  return (
    <div className="data-manager-page">
      <div className="data-manager-header">
        <div className="data-manager-title-row">
          <h1 className="data-manager-title">DATA MANAGER</h1>
          <span className="data-manager-count-badge">{folders.length}</span>
          <div className="data-manager-header-actions">
            <button className="data-manager-summarize-btn" disabled={diligenceDisabled} onClick={() => runSkill('diligence')}><span>Diligence</span></button>
            <button className="data-manager-valuate-btn" disabled={valuateDisabled} onClick={() => {
              if (!selectedFolderPath) return
              const f = folders.find(x => x.path === selectedFolderPath)
              if (f) onOpenValuate?.({ path: f.path, name: f.name })
            }}><span>Valuate</span></button>
            <button className="data-manager-extract-btn" disabled={extractDisabled} onClick={() => runSkill('catalog-extract')}><span>Extract</span></button>
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
                <th></th>
                <th className="data-manager-th-num">Lifetime</th>
                <th className="data-manager-th-num">TTM</th>
                <th>Diligence</th>
                <th>Valuation</th>
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
                    <td
                      className="data-manager-td-name"
                      title={f.name}
                      onContextMenu={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        fetch('/api/data/open-folder', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ path: f.path }),
                        }).catch(() => {})
                      }}
                    >
                      <div className="data-manager-cell-truncate">
                        {f.name}
                        {isRunning && <span className="data-manager-row-spinner" aria-label="running" />}
                      </div>
                    </td>
                    <td className="data-manager-td-spark">
                      {f.summary ? <Sparkline values={f.summary.line} /> : <span className="data-manager-cell-empty">—</span>}
                    </td>
                    <td className="data-manager-td-num">
                      {f.summary ? fmtInt(f.summary.lifetime) : <span className="data-manager-cell-empty">—</span>}
                    </td>
                    <td className="data-manager-td-num">
                      {f.summary ? fmtInt(f.summary.ttm) : <span className="data-manager-cell-empty">—</span>}
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
