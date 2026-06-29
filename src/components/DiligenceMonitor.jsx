import { useState, useRef, useEffect, useCallback } from 'react'
import useSkillRuns, { runId } from './useSkillRuns.js'
import './DiligenceMonitor.css'

// Persistent, always-on-top monitor for skill runs (diligence + catalog-extract). Rendered once at
// the App root so it survives page navigation; owned by Data Manager via useSkillRuns. Honest
// progress (named stages), loud failures, draggable (position persisted + clamped on-screen),
// non-closable while active, auto-hides when idle but holds failures until dismissed.

const SKILL_LABEL = { diligence: 'diligence', 'catalog-extract': 'extract' }
const POS_KEY = 'rthm-monitor-pos'

function loadPos() {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY))
    if (p && typeof p.left === 'number' && typeof p.bottom === 'number') return p
  } catch {}
  return null
}

// The panel is anchored by its BOTTOM-left so it grows UPWARD as runs are added — the bottom edge
// stays put and never clips off-screen. Clamp {left, bottom} to keep it fully within the viewport.
function clampPos(left, bottom, el) {
  const w = el?.offsetWidth || 320
  const h = el?.offsetHeight || 120
  const maxLeft = Math.max(0, window.innerWidth - w)
  const maxBottom = Math.max(0, window.innerHeight - h)
  return { left: Math.min(Math.max(0, left), maxLeft), bottom: Math.min(Math.max(0, bottom), maxBottom) }
}

function failureText(run) {
  if (run.failureKind === 'rate_limit') return 'rate-limited — reduce concurrency or wait for reset'
  if (run.failureKind === 'tooling_unavailable') return 'claude not available or not signed in — re-authenticate (claude login / Claude app)'
  return run.error || 'run failed'
}

function RunRow({ run, onDismiss }) {
  const label = SKILL_LABEL[run.skill] || run.skill
  const pct = run.stage && run.stage.n ? Math.round((run.stage.i / run.stage.n) * 100) : null
  return (
    <div className="dm-run">
      <div className="dm-run-top">
        <span className="dm-run-name" title={run.folderPath || run.folderName}>{run.folderName}</span>
        {run.state !== 'running' && (
          <button className="dm-run-dismiss" onClick={onDismiss}>dismiss</button>
        )}
        <span className="dm-run-skill">{label}</span>
      </div>

      {run.state === 'running' && (
        <div className="dm-run-progress">
          <div className={`dm-bar${pct === null ? ' dm-bar--indeterminate' : ''}`}>
            <div className="dm-bar-fill" style={pct === null ? undefined : { width: `${pct}%` }} />
          </div>
          <span className="dm-run-stage">
            {run.stage ? `${run.stage.label} · step ${run.stage.i} of ${run.stage.n}` : 'starting…'}
          </span>
        </div>
      )}
      {run.state === 'succeeded' && <div className="dm-run-status dm-run-status--ok">done</div>}
      {run.state === 'failed' && <div className="dm-run-status dm-run-status--fail">{failureText(run)}</div>}
    </div>
  )
}

export default function DiligenceMonitor({ runningSkills }) {
  const { runs, acknowledge } = useSkillRuns(runningSkills)
  const panelRef = useRef(null)
  const dragRef = useRef(null)
  const [pos, setPos] = useState(loadPos)

  // Re-clamp into view when the window resizes (FR-012).
  useEffect(() => {
    if (!pos) return
    function onResize() { setPos(p => (p ? clampPos(p.left, p.bottom, panelRef.current) : p)) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [pos])

  const onHeaderMouseDown = useCallback((e) => {
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, h: rect.height }
    function onMove(ev) {
      const left = ev.clientX - dragRef.current.dx
      const top = ev.clientY - dragRef.current.dy
      const bottom = window.innerHeight - top - dragRef.current.h
      setPos(clampPos(left, bottom, panelRef.current))
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      dragRef.current = null
      setPos(p => { try { localStorage.setItem(POS_KEY, JSON.stringify(p)) } catch {} ; return p })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    e.preventDefault()
  }, [])

  if (runs.length === 0) return null

  const activeCount = runs.filter(r => r.state === 'running').length
  const failedCount = runs.filter(r => r.state === 'failed').length
  const summary = activeCount ? `${activeCount} running` : (failedCount ? `${failedCount} failed` : 'done')
  const style = pos && typeof pos.bottom === 'number' ? { left: pos.left, bottom: pos.bottom, top: 'auto', right: 'auto' } : undefined

  return (
    <div
      className="diligence-monitor"
      ref={panelRef}
      style={style}
      role="status"
      aria-live="polite"
      onContextMenu={e => e.preventDefault()}
    >
      <div className="diligence-monitor-header" onMouseDown={onHeaderMouseDown}>
        <span className="dm-title">runs</span>
        <span className="dm-count">{summary}</span>
      </div>
      <div className="diligence-monitor-body">
        {runs.map(r => (
          <RunRow key={runId(r)} run={r} onDismiss={() => acknowledge(r.logFile)} />
        ))}
      </div>
    </div>
  )
}
