import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import './ScanResultsModal.css'

export default function ScanResultsModal({ folderPath, onClose, onNext }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [showSkipped, setShowSkipped] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/data/scan-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folderPath })
        })
        const data = await res.json()
        if (cancelled) return
        if (!res.ok || data.error) setError(data.error || 'scan failed')
        else setResult(data)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [folderPath])

  const includedCount = result?.included?.length || 0
  const skippedCount = result?.skipped?.length || 0
  const errorCount = result?.errors?.length || 0

  // Group skipped by category (text before the colon in the reason)
  const skippedByReason = {}
  if (result?.skipped) {
    for (const s of result.skipped) {
      const category = s.reason.split(':')[0].trim()
      if (!skippedByReason[category]) skippedByReason[category] = []
      skippedByReason[category].push(s)
    }
  }

  return createPortal(
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal scan-modal">
        <div className="modal-header">
          <h2 className="modal-title">SCAN RESULTS</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="scan-body">
          {loading && <div className="modal-status">scanning folder…</div>}
          {error && <div className="modal-error">{error}</div>}
          {result && !loading && (
            <>
              <div className="scan-path">{folderPath}</div>

              {result.warnings?.length > 0 && (
                <div className="scan-warnings">
                  {result.warnings.map((w, i) => (
                    <div key={i} className="scan-warning">{w}</div>
                  ))}
                </div>
              )}

              <div className="scan-summary">
                <span className="scan-summary-item scan-summary-included">{includedCount} included</span>
                <span className="scan-summary-item scan-summary-skipped">{skippedCount} skipped</span>
                {errorCount > 0 && (
                  <span className="scan-summary-item scan-summary-errors">{errorCount} errors</span>
                )}
              </div>

              {includedCount === 0 && errorCount === 0 && (
                <div className="scan-empty">no data files found in this folder</div>
              )}

              {includedCount > 0 && (
                <div className="scan-section">
                  <div className="scan-section-title">INCLUDED FILES</div>
                  <div className="scan-list">
                    {result.included.map((f, i) => (
                      <div key={i} className="scan-row">
                        <span className="scan-row-path">{f.path}</span>
                        <span className="scan-row-meta">{f.source === 'direct' ? f.ext : 'from zip'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {skippedCount > 0 && (
                <div className="scan-section">
                  <button
                    className="scan-section-toggle"
                    onClick={() => setShowSkipped(!showSkipped)}
                  >
                    <span>SKIPPED ({skippedCount})</span>
                    <span className="scan-toggle-arrow">{showSkipped ? '▼' : '▶'}</span>
                  </button>
                  {showSkipped && (
                    <div className="scan-list">
                      {Object.entries(skippedByReason).map(([category, items]) => (
                        <div key={category} className="scan-skip-group">
                          <div className="scan-skip-category">{category} ({items.length})</div>
                          {items.map((s, i) => (
                            <div key={i} className="scan-row scan-row-skipped">
                              <span className="scan-row-path">{s.path}</span>
                              <span className="scan-row-meta">{s.reason}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {errorCount > 0 && (
                <div className="scan-section">
                  <button
                    className="scan-section-toggle"
                    onClick={() => setShowErrors(!showErrors)}
                  >
                    <span>ERRORS ({errorCount})</span>
                    <span className="scan-toggle-arrow">{showErrors ? '▼' : '▶'}</span>
                  </button>
                  {showErrors && (
                    <div className="scan-list">
                      {result.errors.map((e, i) => (
                        <div key={i} className="scan-row scan-row-error">
                          <span className="scan-row-path">{e.path}</span>
                          <span className="scan-row-meta">{e.reason}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="modal-cancel" onClick={onClose}><span>cancel</span></button>
          <button
            className={`modal-import-btn ${!result || includedCount === 0 ? 'disabled' : ''}`}
            onClick={() => onNext && onNext(result)}
            disabled={!result || includedCount === 0}
          >
            <span>next <span className="arr">▶</span></span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
