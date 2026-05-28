import React, { useState, useEffect } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import Sparkline from './Sparkline.jsx'
import './ValuatePage.css'

function fmtCurrency(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function fmtPercent(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  return (v * 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'
}

function fmtYears(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'y'
}

// Signed percentage. Positive = annual decay (loss), negative = growth.
function fmtSignedPercent(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  return (v * 100).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
}

// Mirror of server's parseMonthHeader → key-only. Used to align per-platform months
// against the combined chart's month axis (raw labels can differ across platforms).
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_MAP = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 }
// Format a YYYY-MM key back to the diligence-skill MMMyy default label.
function fmtMonthKey(key) {
  const [y, m] = key.split('-').map(Number)
  return `${MONTH_NAMES[m-1]}${String(y).slice(-2)}`
}
function monthKey(label) {
  if (label == null || label === '') return ''
  const s = String(label).trim()
  let m = s.match(/^(\d{4})[-/](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}`
  m = s.match(/^(\d{1,2})[-/](\d{4})$/)
  if (m) return `${m[2]}-${m[1].padStart(2,'0')}`
  m = s.match(/^(\d{1,2})[-/](\d{2})$/)
  if (m) return `20${m[2]}-${m[1].padStart(2,'0')}`
  m = s.match(/^([A-Za-z]+)[-\s]+(\d{4})$/)
  if (m) {
    const mo = MONTH_MAP[m[1].slice(0,3).toLowerCase()]
    if (mo) return `${m[2]}-${String(mo).padStart(2,'0')}`
  }
  m = s.match(/^([A-Za-z]+)(\d{2,4})$/)
  if (m) {
    const mo = MONTH_MAP[m[1].slice(0,3).toLowerCase()]
    if (mo) {
      const yr = m[2].length === 4 ? m[2] : `20${m[2]}`
      return `${yr}-${String(mo).padStart(2,'0')}`
    }
  }
  return s
}

// Compute the Key Metrics block rows from the diligence-workbook response.
// `view` is the active toggle — 'combined' or a platform name.
// - Combined view: aggregates all platforms via "net paid where distinct" rule
//   (Adj line per platform when it differs from Rep, else Rep). Includes
//   per-platform % of Lifetime share rows.
// - Per-platform view: scopes Lifetime/TTM/Dollar Age to that platform only.
//   No share rows (we're already inside the single-platform context).
function buildKeyMetrics(data, view) {
  if (!data || !data.platforms || data.platforms.length === 0) return []

  // Build per-platform { name, months, line, isNetPaid } — same as before.
  const perPlatform = data.platforms.map(p => {
    const matches = p.tracksAdjLine.length === p.tracksLine.length
      && p.tracksLine.every((v, i) => v === p.tracksAdjLine[i])
    const isNetPaid = !matches
    const line = isNetPaid ? p.tracksAdjLine : p.tracksLine
    return { name: p.name, months: p.months, line, isNetPaid }
  })

  // Restrict to the active platform when not in combined view.
  const isCombined = view === 'combined' || !view
  const activePlatforms = isCombined
    ? perPlatform
    : perPlatform.filter(p => p.name === view)
  if (activePlatforms.length === 0) return []

  // Bucket by parsed month key: { label, total, byPlatform: { name -> value } }
  const byKey = new Map()
  for (const p of activePlatforms) {
    for (let i = 0; i < p.months.length; i++) {
      const k = monthKey(p.months[i])
      if (!byKey.has(k)) byKey.set(k, { label: p.months[i], total: 0, byPlatform: {} })
      const b = byKey.get(k)
      const v = p.line[i] || 0
      b.total += v
      b.byPlatform[p.name] = (b.byPlatform[p.name] || 0) + v
    }
  }
  const sortedKeys = [...byKey.keys()].sort()
  if (sortedKeys.length === 0) return []

  // Lifetime = sum of all months
  const lifetimeTotal = sortedKeys.reduce((s, k) => s + byKey.get(k).total, 0)
  const lifetimeWindow = `${byKey.get(sortedKeys[0]).label} – ${byKey.get(sortedKeys[sortedKeys.length - 1]).label}`

  // TTM = trailing 12 CALENDAR months, anchored on the latest data month.
  // Entries whose YYYY-MM falls in [lastMonth-11, lastMonth] contribute.
  // Critical for irregular cadences (semi-annual UMPG, quarterly BMI, etc.) —
  // an entry-count-based slice(-12) would lump them in with monthly platforms.
  const firstKey = sortedKeys[0]
  const lastKey = sortedKeys[sortedKeys.length - 1]
  const [fy, fm] = firstKey.split('-').map(Number)
  const [ly, lm] = lastKey.split('-').map(Number)
  const totalMonths = (ly - fy) * 12 + (lm - fm) + 1
  let ttmKeys, ttmStartKey, ttmWindow
  if (totalMonths < 12) {
    // Catalog shorter than 12 calendar months — TTM falls back to lifetime.
    ttmKeys = sortedKeys
    ttmStartKey = firstKey
    ttmWindow = lifetimeWindow
  } else {
    let sm = lm - 11, sy = ly
    while (sm <= 0) { sm += 12; sy -= 1 }
    ttmStartKey = `${sy}-${String(sm).padStart(2, '0')}`
    ttmKeys = sortedKeys.filter(k => k >= ttmStartKey && k <= lastKey)
    const isFullCalendarYear = sm === 1 && lm === 12 && sy === ly
    ttmWindow = isFullCalendarYear
      ? `${ly} Full Year`
      : `${fmtMonthKey(ttmStartKey)} – ${fmtMonthKey(lastKey)}`
  }
  const ttmTotal = ttmKeys.reduce((s, k) => s + byKey.get(k).total, 0)

  // Suffix for labels: "Combined" in combined view, the platform name otherwise.
  const scopeLabel = isCombined ? 'Combined' : view

  // Catalog Dollar Age — server already provides per-platform values via
  // data.tracksByPlatform[name].dollarAge. Combined uses data.dollarAge.
  const dollarAge = isCombined
    ? data.dollarAge
    : (data.tracksByPlatform && data.tracksByPlatform[view] && data.tracksByPlatform[view].dollarAge)

  // Assemble metric rows.
  const rows = []
  rows.push({ label: `Lifetime (${lifetimeWindow}) — ${scopeLabel}`, value: fmtCurrency(lifetimeTotal) })
  rows.push({ label: `TTM (${ttmWindow}) — ${scopeLabel}`, value: fmtCurrency(ttmTotal) })
  if (Number.isFinite(dollarAge)) {
    rows.push({ label: `Dollar Age — ${scopeLabel}`, value: fmtYears(dollarAge) })
  }

  // Per-platform % of Lifetime — combined view only (in per-platform view
  // it would always be 100% on a single row, which is meaningless).
  if (isCombined) {
    for (const p of perPlatform) {
      let pSum = 0
      for (const k of sortedKeys) pSum += byKey.get(k).byPlatform[p.name] || 0
      const share = lifetimeTotal > 0 ? pSum / lifetimeTotal : 0
      const annot = p.isNetPaid ? ' (net paid)' : ''
      rows.push({ label: `${p.name} % of Lifetime${annot}`, value: fmtPercent(share) })
    }
  }

  return rows
}

// Detect a platform's reporting cadence from its month entries.
// Uses median gap (in months) between consecutive sorted keys.
function detectCycle(platform) {
  const keys = (platform.months || []).map(monthKey).filter(Boolean).sort()
  if (keys.length < 2) return 'monthly'
  const gaps = []
  for (let i = 1; i < keys.length; i++) {
    const [y1, m1] = keys[i - 1].split('-').map(Number)
    const [y2, m2] = keys[i].split('-').map(Number)
    gaps.push((y2 - y1) * 12 + (m2 - m1))
  }
  gaps.sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)]
  if (median <= 1) return 'monthly'
  if (median <= 3) return 'quarterly'
  if (median <= 6) return 'semi-annual'
  return 'annual'
}

function summarizeCycle(platforms) {
  if (!platforms || platforms.length === 0) return ''
  const unique = [...new Set(platforms.map(detectCycle))]
  return unique.length === 1 ? unique[0] : 'mixed'
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null
  const row = payload[0].payload || {}
  const breakdown = Object.keys(row)
    .filter(k => k !== 'month' && k !== 'total' && k !== 'decayFromPrev' && Number.isFinite(row[k]) && row[k] !== 0)
  return (
    <div className="valuate-tooltip">
      <div className="valuate-tooltip-month">{label}</div>
      <div className="valuate-tooltip-row valuate-tooltip-total">total: {fmtCurrency(row.total)}</div>
      {breakdown.map(k => (
        <div key={k} className="valuate-tooltip-row">{k}: {fmtCurrency(row[k])}</div>
      ))}
      {Number.isFinite(row.decayFromPrev) && (
        <div className="valuate-tooltip-row valuate-tooltip-decay">decay: {fmtSignedPercent(row.decayFromPrev)}</div>
      )}
    </div>
  )
}

function Header({ folderName, platforms, view, setView, onBack }) {
  const allPlatforms = platforms || []
  const platformNames = allPlatforms.map(p => p.name)
  // Stats reflect the active view — combined = all platforms, otherwise the single selected platform.
  const activePlatforms = view === 'combined' ? allPlatforms : allPlatforms.filter(p => p.name === view)
  // Statement count = source statement files attributed to the active platform(s).
  // Comes from the server's deal-folder scan (Pass 2b). Each file = one statement
  // (TuneCore monthly CSV = 1; Jive H1 multi-PDF folder counts each PDF; etc.).
  // Server returns null when a platform has revenue but the scanner found no
  // matching files — we surface that as "?" rather than rendering a misleading 0.
  const statementsUncertain = activePlatforms.some(p => p.statementsCount === null)
  const statementsN = statementsUncertain
    ? null
    : activePlatforms.reduce((sum, p) => sum + (p.statementsCount || 0), 0)
  return (
    <div className="valuate-header">
      <button className="back-btn" onClick={onBack}><span className="arr">◀</span> back</button>
      <div className="valuate-title-block">
        <h2 className="valuate-title">{folderName}</h2>
        {platformNames.length > 0 && <span className="valuate-sub">{platformNames.join(' · ')}</span>}
      </div>
      {activePlatforms.length > 0 && (
        <div className="valuate-header-stats">
          <div className="valuate-header-stat">
            <span
              className="valuate-header-stat-value"
              title={statementsUncertain ? 'source statement files could not be attributed to this platform — folder scan returned 0 despite revenue in workbook' : undefined}
            >
              {statementsN == null ? '?' : statementsN}
            </span>
            <span className="valuate-header-stat-label">statement{statementsN === 1 ? '' : 's'}</span>
          </div>
          <div className="valuate-header-stat">
            <span className="valuate-header-stat-value">{summarizeCycle(activePlatforms)}</span>
            <span className="valuate-header-stat-label">cycle</span>
          </div>
        </div>
      )}
      {platformNames.length >= 2 && (
        <div className="valuate-toggle">
          {platforms.map(p => (
            <button
              key={p.name}
              className={`valuate-toggle-btn${view === p.name ? ' active' : ''}`}
              onClick={() => setView(p.name)}
            ><span>{p.name}</span></button>
          ))}
          <button
            className={`valuate-toggle-btn${view === 'combined' ? ' active' : ''}`}
            onClick={() => setView('combined')}
          ><span>Combined</span></button>
        </div>
      )}
    </div>
  )
}

export default function ValuatePage({ folderPath, folderName, onBack }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [view, setView] = useState('combined')

  useEffect(() => {
    if (!folderPath) return
    setError(null)
    setData(null)
    setView('combined')
    fetch(`/api/data/diligence-workbook?folder=${encodeURIComponent(folderPath)}`)
      .then(r => r.json().then(body => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) { setError(body.error || 'failed to load workbook'); return }
        setData(body)
      })
      .catch(err => setError(err.message))
  }, [folderPath])

  if (error) {
    return (
      <div className="valuate-page">
        <Header folderName={folderName} platforms={[]} view={view} setView={setView} onBack={onBack} />
        <div className="valuate-body">
          <div className="empty-state"><p className="empty-hint">{error}</p></div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="valuate-page">
        <Header folderName={folderName} platforms={[]} view={view} setView={setView} onBack={onBack} />
        <div className="valuate-body">
          <div className="empty-state"><p className="empty-hint">loading workbook...</p></div>
        </div>
      </div>
    )
  }

  const series = view === 'combined'
    ? data.combined
    : (data.platforms.find(p => p.name === view) || data.combined)
  const isCombined = view === 'combined' && data.platforms.length >= 2

  // For combined view, build per-platform lookup keyed by parsed month key,
  // so each chart row carries { month, total, <platformName>: value, ... }.
  const platformRepByMonth = {}
  const platformAdjByMonth = {}
  if (isCombined) {
    for (const p of data.platforms) {
      platformRepByMonth[p.name] = {}
      platformAdjByMonth[p.name] = {}
      for (let i = 0; i < p.months.length; i++) {
        const k = monthKey(p.months[i])
        platformRepByMonth[p.name][k] = p.tracksLine[i] || 0
        platformAdjByMonth[p.name][k] = p.tracksAdjLine[i] || 0
      }
    }
  }
  // Build chart rows. `decayFromPrev` = 1 - (current.total / prev.total) for each
  // consecutive pair of periods. Positive = decay (revenue dropped vs prior period);
  // negative = growth. Null on the first row (no prior) and when the prior was 0
  // (undefined ratio). Displayed in the chart tooltip on hover.
  const tracksRows = series.months.map((m, i) => {
    const row = { month: m, total: series.tracksLine[i] || 0 }
    if (isCombined) {
      const k = monthKey(m)
      for (const p of data.platforms) row[p.name] = platformRepByMonth[p.name][k] || 0
    }
    const prev = i > 0 ? (series.tracksLine[i - 1] || 0) : 0
    row.decayFromPrev = i > 0 && prev > 0 ? 1 - (row.total / prev) : null
    return row
  })
  const tracksAdjRows = series.months.map((m, i) => {
    const row = { month: m, total: series.tracksAdjLine[i] || 0 }
    if (isCombined) {
      const k = monthKey(m)
      for (const p of data.platforms) row[p.name] = platformAdjByMonth[p.name][k] || 0
    }
    const prev = i > 0 ? (series.tracksAdjLine[i - 1] || 0) : 0
    row.decayFromPrev = i > 0 && prev > 0 ? 1 - (row.total / prev) : null
    return row
  })
  const adjMatchesRep = series.tracksLine.length === series.tracksAdjLine.length
    && series.tracksLine.every((v, i) => v === series.tracksAdjLine[i])

  const keyMetrics = buildKeyMetrics(data, view)

  return (
    <div className="valuate-page">
      <Header
        folderName={data.folderName || folderName}
        platforms={data.platforms}
        view={view}
        setView={setView}
        onBack={onBack}
      />
      <div className="valuate-body">
        <div className="valuate-charts">
          {keyMetrics.length > 0 && (
            <div className="valuate-chart-card">
              <h3 className="valuate-chart-title">key metrics</h3>
              <div
                className="valuate-metric-grid"
                style={{ gridTemplateColumns: `repeat(${keyMetrics.length}, 1fr)` }}
              >
                {keyMetrics.map(m => (
                  <div className="valuate-metric-tile" key={m.label}>
                    <span className="valuate-metric-tile-value">{m.value}</span>
                    <span className="valuate-metric-tile-label">{m.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {tracksRows.length > 0 && (
            <div className="valuate-chart-card">
              <h3 className="valuate-chart-title">total revenue</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={tracksRows} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(82,0,190,0.08)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6B6580' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B6580' }} tickFormatter={fmtCurrency} width={80} />
                  <Tooltip
                    content={<ChartTooltip />}
                    wrapperStyle={{ outline: 'none' }}
                    allowEscapeViewBox={{ x: true, y: true }}
                  />
                  <Line type="monotone" dataKey="total" stroke="#5200BE" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {!adjMatchesRep && tracksAdjRows.length > 0 && (
            <div className="valuate-chart-card">
              <h3
                className="valuate-chart-title calc-tip"
                data-tip="Reported revenue minus diligence adjustments. Removes non-recurring items (sync stripped, foreign catch-up bridges, layer adjustments, fee strip-outs) so the baseline reflects sustainable catalog earnings used for valuation."
              >adjusted revenue</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={tracksAdjRows} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(82,0,190,0.08)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6B6580' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B6580' }} tickFormatter={fmtCurrency} width={80} />
                  <Tooltip
                    content={<ChartTooltip />}
                    wrapperStyle={{ outline: 'none' }}
                    allowEscapeViewBox={{ x: true, y: true }}
                  />
                  <Line type="monotone" dataKey="total" stroke="#5200BE" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {(() => {
            // Pick the active tracks list based on the current view toggle.
            // Combined view uses the top-level `data.tracks` + `data.other`.
            // Per-platform view picks from `data.tracksByPlatform[name]` which
            // has its own top-80% / OTHER split scoped to that platform's revenue.
            const activeTracks = view === 'combined'
              ? { tracks: data.tracks, other: data.other }
              : (data.tracksByPlatform && data.tracksByPlatform[view]) || { tracks: [], other: null }
            if (!activeTracks.tracks || activeTracks.tracks.length === 0) return null
            return (
              <div className="valuate-chart-card">
                <h3 className="valuate-chart-title">tracks</h3>
                <table className="valuate-tracks-table">
                  <thead>
                    <tr>
                      <th className="valuate-tracks-rank">#</th>
                      <th className="valuate-tracks-label">track</th>
                      <th className="valuate-tracks-spark"></th>
                      <th className="valuate-tracks-num">% of LTR</th>
                      <th className="valuate-tracks-num">lifetime</th>
                      <th className="valuate-tracks-num">ttm</th>
                      <th className="valuate-tracks-num">dollar age</th>
                      <th className="valuate-tracks-num">decay rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeTracks.tracks.map((t, i) => (
                      <tr key={t.label}>
                        <td className="valuate-tracks-rank">{i + 1}</td>
                        <td className="valuate-tracks-label">{t.label}</td>
                        <td className="valuate-tracks-spark"><Sparkline values={t.line} /></td>
                        <td className="valuate-tracks-num">{fmtPercent(t.pctOfLtv)}</td>
                        <td className="valuate-tracks-num">{fmtCurrency(t.lifetime)}</td>
                        <td className="valuate-tracks-num">{fmtCurrency(t.ttm)}</td>
                        <td className="valuate-tracks-num">{fmtYears(t.ageYears)}</td>
                        <td className="valuate-tracks-num">{fmtSignedPercent(t.decayRate)}</td>
                      </tr>
                    ))}
                    {activeTracks.other && (
                      <tr key="OTHER" className="valuate-tracks-other">
                        <td className="valuate-tracks-rank">—</td>
                        <td className="valuate-tracks-label">{activeTracks.other.label}</td>
                        <td className="valuate-tracks-spark"><Sparkline values={activeTracks.other.line} /></td>
                        <td className="valuate-tracks-num">{fmtPercent(activeTracks.other.pctOfLtv)}</td>
                        <td className="valuate-tracks-num">{fmtCurrency(activeTracks.other.lifetime)}</td>
                        <td className="valuate-tracks-num">{fmtCurrency(activeTracks.other.ttm)}</td>
                        <td className="valuate-tracks-num">{fmtYears(activeTracks.other.ageYears)}</td>
                        <td className="valuate-tracks-num">{fmtSignedPercent(activeTracks.other.decayRate)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
