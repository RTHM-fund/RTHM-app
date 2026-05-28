import React, { useState, useEffect } from 'react'
import Sparkline from './Sparkline.jsx'
import './DataManagerPage.css'

function fmtInt(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', { maximumFractionDigits: 0 })
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

// runningSkills + folders are lifted to App.jsx so state survives page navigation —
// switching to Deal Manager and back no longer drops the folder list and forces a
// re-fetch/re-parse on remount. The fetch still runs on mount + window focus; the
// previously-fetched list stays visible during the refresh.
export default function DataManagerPage({ runningSkills, setRunningSkills, folders, setFolders, onOpenValuate }) {
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

  // Open a specific folder path in the OS file browser (Finder / Explorer).
  // Used by the row's Diligence + Extract ✓ buttons to jump straight to the
  // skill's output folder inside the deal directory.
  function openFolderPath(p) {
    fetch('/api/data/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: p }),
    }).catch(() => {})
  }

  // folderPath is optional — when omitted, falls back to selectedFolderPath
  // (header-pill buttons). Per-row ? buttons pass their own row path so the
  // skill kicks off without requiring a selection.
  function runSkill(skill, explicitFolderPath) {
    const folderPath = explicitFolderPath || selectedFolderPath
    if (!folderPath) return
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
                <th className="data-manager-th-num">Tracks</th>
                <th className="data-manager-th-num">Top 80%</th>
                <th className="data-manager-th-num">Dollar Age</th>
                <th>Diligence</th>
                <th>Valuation</th>
                <th>Extract</th>
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
                    onClick={e => {
                      // Don't toggle row selection when clicking row buttons / links.
                      if (e.target.closest('button, a')) return
                      setSelectedFolderPath(prev => prev === f.path ? null : f.path)
                    }}
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
                      {f.summary ? <Sparkline values={f.summary.line} emptyClassName="data-manager-cell-empty" /> : <span className="data-manager-cell-empty">—</span>}
                    </td>
                    <td className="data-manager-td-num">
                      {f.summary ? fmtInt(f.summary.lifetime) : <span className="data-manager-cell-empty">—</span>}
                    </td>
                    <td className="data-manager-td-num">
                      {f.summary ? fmtInt(f.summary.ttm) : <span className="data-manager-cell-empty">—</span>}
                    </td>
                    <td className="data-manager-td-num">
                      {f.summary && Number.isFinite(f.summary.trackCount) ? fmtInt(f.summary.trackCount) : <span className="data-manager-cell-empty">—</span>}
                    </td>
                    <td className="data-manager-td-num">
                      {f.summary && Number.isFinite(f.summary.top80Count) ? fmtInt(f.summary.top80Count) : <span className="data-manager-cell-empty">—</span>}
                    </td>
                    <td className="data-manager-td-num">
                      {f.summary && Number.isFinite(f.summary.dollarAge)
                        ? f.summary.dollarAge.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'y'
                        : <span className="data-manager-cell-empty">—</span>}
                    </td>
                    <td>
                      {f.hasDiligence ? (
                        <button
                          className="diligence-mark-btn"
                          onClick={() => openFolderPath(`${f.path}/${f.name}_Due Diligence`)}
                          title="open diligence folder"
                        >
                          <span className="diligence-mark found">✓</span>
                        </button>
                      ) : (
                        <button
                          className="diligence-mark-btn"
                          onClick={() => runSkill('diligence', f.path)}
                          title="run diligence"
                        >
                          <span className="diligence-mark missing">?</span>
                        </button>
                      )}
                    </td>
                    <td>
                      {f.hasDeal ? (
                        <button
                          className="diligence-mark-btn"
                          onClick={() => onOpenValuate?.({ path: f.path, name: f.name })}
                          title="open valuate page"
                        >
                          <span className="diligence-mark found">✓</span>
                        </button>
                      ) : (
                        <button
                          className="diligence-mark-btn"
                          onClick={() => onOpenValuate?.({ path: f.path, name: f.name })}
                          title="open valuate page"
                        >
                          <span className="diligence-mark missing">?</span>
                        </button>
                      )}
                    </td>
                    <td>
                      {f.hasExtract ? (
                        <button
                          className="diligence-mark-btn"
                          onClick={() => openFolderPath(`${f.path}/${f.name}_Data Engine`)}
                          title="open extract folder"
                        >
                          <span className="diligence-mark found">✓</span>
                        </button>
                      ) : (
                        <button
                          className="diligence-mark-btn"
                          onClick={() => runSkill('catalog-extract', f.path)}
                          title="run extract"
                        >
                          <span className="diligence-mark missing">?</span>
                        </button>
                      )}
                    </td>
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
