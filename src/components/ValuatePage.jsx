import React, { useState, useEffect } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import './ValuatePage.css'

function fmtCurrency(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function Header({ folderName, platforms, view, setView, onBack }) {
  const platformNames = (platforms || []).map(p => p.name)
  return (
    <div className="valuate-header">
      <button className="back-btn" onClick={onBack}><span className="arr">◀</span> back</button>
      <div className="valuate-title-block">
        <h2 className="valuate-title">{folderName}</h2>
        {platformNames.length > 0 && <span className="valuate-sub">{platformNames.join(' · ')}</span>}
      </div>
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
  const tracksRows = series.months.map((m, i) => ({ month: m, value: series.tracksLine[i] || 0 }))
  const tracksAdjRows = series.months.map((m, i) => ({ month: m, value: series.tracksAdjLine[i] || 0 }))
  const adjMatchesRep = series.tracksLine.length === series.tracksAdjLine.length
    && series.tracksLine.every((v, i) => v === series.tracksAdjLine[i])

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
          <div className="valuate-chart-card">
            <h3 className="valuate-chart-title">tracks</h3>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={tracksRows} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(82,0,190,0.08)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6B6580' }} />
                <YAxis tick={{ fontSize: 11, fill: '#6B6580' }} tickFormatter={fmtCurrency} width={80} />
                <Tooltip
                  formatter={fmtCurrency}
                  contentStyle={{
                    fontSize: 12,
                    background: 'rgba(255, 255, 255, 0.45)',
                    backdropFilter: 'blur(20px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                    border: 'none',
                    borderRadius: 'var(--radius)',
                    boxShadow: '0 4px 20px rgba(82,0,190,0.08)',
                    isolation: 'isolate',
                  }}
                  wrapperStyle={{ outline: 'none' }}
                  allowEscapeViewBox={{ x: true, y: true }}
                />
                <Line type="monotone" dataKey="value" stroke="#5200BE" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {!adjMatchesRep && (
            <div className="valuate-chart-card">
              <h3 className="valuate-chart-title">track adjusted</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={tracksAdjRows} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(82,0,190,0.08)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6B6580' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B6580' }} tickFormatter={fmtCurrency} width={80} />
                  <Tooltip
                  formatter={fmtCurrency}
                  contentStyle={{
                    fontSize: 12,
                    background: 'rgba(255, 255, 255, 0.45)',
                    backdropFilter: 'blur(20px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                    border: 'none',
                    borderRadius: 'var(--radius)',
                    boxShadow: '0 4px 20px rgba(82,0,190,0.08)',
                    isolation: 'isolate',
                  }}
                  wrapperStyle={{ outline: 'none' }}
                  allowEscapeViewBox={{ x: true, y: true }}
                />
                  <Line type="monotone" dataKey="value" stroke="#5200BE" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
