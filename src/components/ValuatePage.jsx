import React, { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts'
import './ValuatePage.css'

const PALETTE = [
  '#5200BE', '#6218C8', '#A78BFA', '#7C3AED', '#9333EA',
  '#C084FC', '#A855F7', '#8B5CF6', '#DDD6FE', '#5B21B6'
]

function fmtCurrency(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

// Decay model from v2 specs:
//   k(p) = k_inf + (k0 - k_inf) * e^(-gamma * p)
//   projected(p) = floor + (baseline - floor) * e^(-cumulative_k)
function project(baseline, params, periods) {
  const { k0, kInf, gamma, floorPct } = params
  const floor = baseline * floorPct
  let cumK = 0
  const out = []
  for (let p = 1; p <= periods; p++) {
    const k = kInf + (k0 - kInf) * Math.exp(-gamma * p)
    cumK += k
    const v = floor + (baseline - floor) * Math.exp(-cumK)
    out.push(v)
  }
  return out
}

export default function ValuatePage({ folderPath, folderName, onBack }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [view, setView] = useState('adj') // 'rep' | 'adj'
  const [platformIdx, setPlatformIdx] = useState(0)
  const [selectedTrack, setSelectedTrack] = useState(null)
  const [decay, setDecay] = useState({ k0: 0.06, kInf: 0.015, gamma: 0.10, floorPct: 0.30, haircut: 0.10 })
  const [projectionMonths, setProjectionMonths] = useState(24)

  useEffect(() => {
    if (!folderPath) return
    setError(null)
    setData(null)
    fetch(`/api/data/diligence-workbook?folder=${encodeURIComponent(folderPath)}`)
      .then(r => r.json().then(body => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) { setError(body.error || 'failed to load workbook'); return }
        setData(body)
        if (body.platforms?.[0]?.tracks?.length) {
          const top = [...body.platforms[0].tracks].sort((a, b) => (b.ltmAdj || b.ltmRep || 0) - (a.ltmAdj || a.ltmRep || 0))[0]
          setSelectedTrack(top?.name || null)
        }
      })
      .catch(err => setError(err.message))
  }, [folderPath])

  const platform = data?.platforms?.[platformIdx]
  const months = platform?.months || []
  const valKey = view === 'adj' ? 'adj' : 'rep'
  const ltmKey = view === 'adj' ? 'ltmAdj' : 'ltmRep'

  // Top tracks bar data (chart E)
  const topTracks = useMemo(() => {
    if (!platform) return []
    return [...platform.tracks]
      .map(t => ({ name: t.name, ltm: t[ltmKey] || 0 }))
      .sort((a, b) => b.ltm - a.ltm)
      .slice(0, 10)
  }, [platform, ltmKey])

  // Platform breakdown stacked area (chart A) — by category over months
  const stackedAreaData = useMemo(() => {
    if (!platform) return { rows: [], keys: [] }
    const keys = platform.breakdown.map(b => b.name)
    const rows = months.map((m, i) => {
      const row = { month: m }
      for (const b of platform.breakdown) row[b.name] = (b[valKey] || [])[i] || 0
      return row
    })
    return { rows, keys }
  }, [platform, months, valKey])

  // Single-track drill-down line (chart C)
  const trackLineData = useMemo(() => {
    if (!platform || !selectedTrack) return []
    const t = platform.tracks.find(x => x.name === selectedTrack)
    if (!t) return []
    return months.map((m, i) => ({ month: m, revenue: (t[valKey] || [])[i] || 0 }))
  }, [platform, selectedTrack, months, valKey])

  // Aggregate decay projection (chart M)
  const projectionData = useMemo(() => {
    if (!platform || !months.length) return { rows: [], baseline: 0 }
    // Aggregate monthly across all tracks
    const monthly = months.map((_, i) =>
      platform.tracks.reduce((sum, t) => sum + ((t[valKey] || [])[i] || 0), 0)
    )
    const last3 = monthly.slice(-3)
    const shortAvg = last3.reduce((a, b) => a + b, 0) / Math.max(1, last3.length)
    const longAvg = monthly.reduce((a, b) => a + b, 0) / Math.max(1, monthly.length)
    const w = Math.min(1, monthly.length / 12)
    const rawBaseline = w * shortAvg + (1 - w) * longAvg
    const baseline = rawBaseline * (1 - decay.haircut)
    const projected = project(baseline, decay, projectionMonths)
    const rows = []
    for (let i = 0; i < monthly.length; i++) rows.push({ idx: i, label: months[i], historical: monthly[i], projected: null })
    for (let i = 0; i < projected.length; i++) rows.push({ idx: monthly.length + i, label: `+${i + 1}`, historical: null, projected: projected[i] })
    return { rows, baseline }
  }, [platform, months, valKey, decay, projectionMonths])

  if (error) {
    return (
      <div className="valuate-page">
        <div className="valuate-header">
          <button className="valuate-back" onClick={onBack}><span>← back</span></button>
          <h1 className="valuate-title">VALUATE: {folderName}</h1>
        </div>
        <div className="empty-state"><p className="empty-hint">{error}</p></div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="valuate-page">
        <div className="valuate-header">
          <button className="valuate-back" onClick={onBack}><span>← back</span></button>
          <h1 className="valuate-title">VALUATE: {folderName}</h1>
        </div>
        <div className="empty-state"><p className="empty-hint">loading workbook...</p></div>
      </div>
    )
  }

  return (
    <div className="valuate-page">
      <div className="valuate-header">
        <button className="valuate-back" onClick={onBack}><span>← back</span></button>
        <h1 className="valuate-title">VALUATE: {folderName}</h1>
        <div className="valuate-controls">
          {data.platforms.length > 1 && (
            <div className="valuate-platform-tabs">
              {data.platforms.map((p, i) => (
                <button
                  key={p.name}
                  className={`valuate-tab${i === platformIdx ? ' active' : ''}`}
                  onClick={() => setPlatformIdx(i)}
                ><span>{p.name}</span></button>
              ))}
            </div>
          )}
          <div className="valuate-view-toggle">
            <button className={`valuate-tab${view === 'rep' ? ' active' : ''}`} onClick={() => setView('rep')}><span>gross</span></button>
            <button className={`valuate-tab${view === 'adj' ? ' active' : ''}`} onClick={() => setView('adj')}><span>adjusted</span></button>
          </div>
        </div>
      </div>

      <div className="valuate-charts">
        {/* A: Stacked area — platform breakdown over time */}
        <div className="valuate-chart-card">
          <h3 className="valuate-chart-title">revenue over time, by category</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={stackedAreaData.rows} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(82,0,190,0.08)" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6B6580' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6B6580' }} tickFormatter={fmtCurrency} width={80} />
              <Tooltip formatter={fmtCurrency} contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {stackedAreaData.keys.map((k, i) => (
                <Area key={k} type="monotone" dataKey={k} stackId="1" stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.6} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* E: Top tracks by LTM */}
        <div className="valuate-chart-card">
          <h3 className="valuate-chart-title">top 10 tracks by LTM revenue</h3>
          <ResponsiveContainer width="100%" height={Math.max(220, topTracks.length * 28)}>
            <BarChart data={topTracks} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(82,0,190,0.08)" />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#6B6580' }} tickFormatter={fmtCurrency} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#1A0F2E' }} width={180} />
              <Tooltip formatter={fmtCurrency} contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="ltm" fill="#5200BE" radius={[0, 4, 4, 0]} onClick={(d) => setSelectedTrack(d.name)} cursor="pointer" />
            </BarChart>
          </ResponsiveContainer>
          <p className="valuate-chart-hint">click a bar to drill into that track below</p>
        </div>

        {/* C: Single-track drill-down line */}
        <div className="valuate-chart-card">
          <div className="valuate-chart-title-row">
            <h3 className="valuate-chart-title">track drill-down</h3>
            <select className="valuate-track-select" value={selectedTrack || ''} onChange={(e) => setSelectedTrack(e.target.value)}>
              {(platform?.tracks || []).map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trackLineData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(82,0,190,0.08)" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6B6580' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6B6580' }} tickFormatter={fmtCurrency} width={80} />
              <Tooltip formatter={fmtCurrency} contentStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="revenue" stroke="#5200BE" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* M: Decay projection */}
        <div className="valuate-chart-card">
          <div className="valuate-chart-title-row">
            <h3 className="valuate-chart-title">decay projection (aggregate)</h3>
            <span className="valuate-chart-hint">baseline: {fmtCurrency(projectionData.baseline)} / mo</span>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={projectionData.rows} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(82,0,190,0.08)" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6B6580' }} interval={Math.ceil(projectionData.rows.length / 12)} />
              <YAxis tick={{ fontSize: 11, fill: '#6B6580' }} tickFormatter={fmtCurrency} width={80} />
              <Tooltip formatter={fmtCurrency} contentStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="historical" stroke="#5200BE" strokeWidth={2} dot={false} name="historical" />
              <Line type="monotone" dataKey="projected" stroke="#A78BFA" strokeWidth={2} strokeDasharray="6 4" dot={false} name="projected" />
            </LineChart>
          </ResponsiveContainer>
          <div className="valuate-sliders">
            <Slider label="k0 (initial decay)" min={0.02} max={0.30} step={0.01} value={decay.k0} onChange={v => setDecay(d => ({ ...d, k0: v }))} />
            <Slider label="k∞ (tail decay)" min={0.005} max={0.05} step={0.005} value={decay.kInf} onChange={v => setDecay(d => ({ ...d, kInf: v }))} />
            <Slider label="γ (transition speed)" min={0.03} max={0.40} step={0.01} value={decay.gamma} onChange={v => setDecay(d => ({ ...d, gamma: v }))} />
            <Slider label="floor %" min={0.05} max={0.60} step={0.05} value={decay.floorPct} onChange={v => setDecay(d => ({ ...d, floorPct: v }))} />
            <Slider label="haircut" min={0} max={0.40} step={0.05} value={decay.haircut} onChange={v => setDecay(d => ({ ...d, haircut: v }))} />
            <Slider label="projection months" min={6} max={90} step={6} value={projectionMonths} onChange={v => setProjectionMonths(v)} display={v => `${v}`} />
          </div>
        </div>
      </div>
    </div>
  )
}

function Slider({ label, min, max, step, value, onChange, display }) {
  return (
    <label className="valuate-slider">
      <span className="valuate-slider-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
      <span className="valuate-slider-value">{display ? display(value) : value.toFixed(value < 1 ? 3 : 0)}</span>
    </label>
  )
}
