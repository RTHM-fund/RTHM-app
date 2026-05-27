import React, { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar.jsx'
import MainArea from './components/MainArea.jsx'
import './App.css'

export default function App() {
  const [categories, setCategories] = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [prefillData, setPrefillData] = useState(null)
  const [activePage, setActivePage] = useState('deals')
  const [selectedDeal, setSelectedDeal] = useState(null)
  const [selectedDealIndex, setSelectedDealIndex] = useState(null)
  // Data Manager — selected catalog folder for the Valuate page (charts of its diligence workbook)
  const [valuateFolder, setValuateFolder] = useState(null)
  const [valuationStates, setValuationStates] = useState({})
  const [mainArcade, setMainArcade] = useState(false)
  const [pageHistory, setPageHistory] = useState([])
  // Data Manager — running skills per folder. Lifted here so spinners survive page navigation.
  // Map<folderPath, Set<skill>>. Persisted to localStorage so spinners also survive a page reload;
  // entries self-clean when their file-system completion flag flips on the next Data Manager visit.
  const [runningSkills, setRunningSkills] = useState(() => {
    try {
      const raw = localStorage.getItem('rthm-running-skills')
      if (!raw) return new Map()
      const obj = JSON.parse(raw)
      const map = new Map()
      for (const [path, skills] of Object.entries(obj || {})) {
        if (Array.isArray(skills) && skills.length > 0) map.set(path, new Set(skills))
      }
      return map
    } catch {
      return new Map()
    }
  })

  useEffect(() => {
    try {
      const obj = {}
      for (const [path, skills] of runningSkills) obj[path] = [...skills]
      localStorage.setItem('rthm-running-skills', JSON.stringify(obj))
    } catch {}
  }, [runningSkills])

  function navigateTo(page) {
    setPageHistory(prev => [...prev, { page: activePage, template: selectedTemplate, prefill: prefillData, deal: selectedDeal, dealIndex: selectedDealIndex, valuateFolder }])
    setActivePage(page)
  }

  function handleGoBack() {
    const prev = pageHistory[pageHistory.length - 1]
    if (!prev) {
      setPrefillData(null)
      setSelectedTemplate(null)
      setActivePage('deals')
      return
    }
    setPageHistory(h => h.slice(0, -1))
    setActivePage(prev.page)
    setSelectedTemplate(prev.template)
    setPrefillData(prev.prefill)
    setSelectedDeal(prev.deal)
    setSelectedDealIndex(prev.dealIndex)
    setValuateFolder(prev.valuateFolder ?? null)
  }

  useEffect(() => {
    fetch('/api/templates')
      .then(r => r.json())
      .then(setCategories)
      .catch(err => console.error('Failed to load templates', err))
  }, [])

  // Aurora background — 4 wandering orbs (sum-of-sines wander + cursor converge
  // + pairwise repulsion + velocity momentum + breath scale). Ported verbatim
  // from the Bystro landing page so behavior is identical. DOM is mutated
  // imperatively for per-frame transforms (cheaper than React state).
  useEffect(() => {
    const orbLayer = document.getElementById('orb-layer')
    if (!orbLayer) return

    const LOCKED = {
      breath: 0.06,
      speed: 0.8,
      wanderSpeed: 2.4,
      wander: 2.0,
      converge: 120,
      repel: 2.0,
      velocity: 0.02,
      spacing: 0.35,
    }
    // RTHM-brand palette: purples + a near-black anchor. No teal/blue/green.
    // Colors map to design tokens: primary, primary-mid, sidebar-active, sidebar-hover.
    // RTHM-brand palette: purples + a near-black anchor. No teal/blue/green.
    // Colors map to design tokens: primary, primary-mid, sidebar-active, sidebar-hover.
    // Opacities lowered + blur bumped (see positionOrbs below) to keep the
    // background atmospheric rather than busy.
    const ORB_DEFS = [
      { color: '#A78BFA', sizeFactor: 0.80, opacity: 0.20, anchor: 'top-right',    offsetX: -160, offsetY: -200, depth: 1.0 },
      { color: '#5200BE', sizeFactor: 0.90, opacity: 0.13, anchor: 'bottom-left',  offsetX: -200, offsetY: -260, depth: 0.8 },
      { color: '#6218C8', sizeFactor: 0.65, opacity: 0.16, anchor: 'center',       offsetX:  -50, offsetY:  -50, depth: 1.3 },
      { color: '#241050', sizeFactor: 0.60, opacity: 0.10, anchor: 'center-right', offsetX: -100, offsetY:  -60, depth: 1.1 },
    ]

    const makeWanderFreqs = () => [
      { fx: 0.12 + Math.random() * 0.08, ax: 13 + Math.random() * 6, fy: 0.10 + Math.random() * 0.08, ay: 11 + Math.random() * 6, px: Math.random() * Math.PI * 2, py: Math.random() * Math.PI * 2 },
      { fx: 0.05 + Math.random() * 0.04, ax:  9 + Math.random() * 4, fy: 0.07 + Math.random() * 0.04, ay:  8 + Math.random() * 4, px: Math.random() * Math.PI * 2, py: Math.random() * Math.PI * 2 },
      { fx: 0.18 + Math.random() * 0.06, ax:  5 + Math.random() * 3, fy: 0.16 + Math.random() * 0.06, ay:  4 + Math.random() * 3, px: Math.random() * Math.PI * 2, py: Math.random() * Math.PI * 2 },
      { fx: 0.03 + Math.random() * 0.02, ax:  7 + Math.random() * 4, fy: 0.04 + Math.random() * 0.02, ay:  6 + Math.random() * 4, px: Math.random() * Math.PI * 2, py: Math.random() * Math.PI * 2 },
    ]

    const orbs = ORB_DEFS.map(def => {
      const el = document.createElement('div')
      el.className = 'orb'
      el.style.background = `radial-gradient(circle at center, ${def.color} 0%, ${def.color}00 70%)`
      el.style.opacity = def.opacity
      orbLayer.appendChild(el)
      return { def, el, size: 0, baseCenterX: 0, baseCenterY: 0, velX: 0, velY: 0, repelX: 0, repelY: 0, _tempTx: 0, _tempTy: 0, wanderFreqs: makeWanderFreqs(), breathPhase: Math.random() * Math.PI * 2 }
    })

    function positionOrbs() {
      const W = window.innerWidth, H = window.innerHeight
      const vmax = Math.max(W, H)
      const blur = Math.round(vmax * 0.07)
      orbs.forEach(orb => {
        const def = orb.def
        const size = Math.round(def.sizeFactor * vmax)
        orb.size = size
        orb.el.style.width = size + 'px'
        orb.el.style.height = size + 'px'
        orb.el.style.filter = 'blur(' + blur + 'px)'
        let left, top
        if (def.anchor === 'top-right')         { left = W - size + (-def.offsetX); top = def.offsetY }
        else if (def.anchor === 'bottom-left')  { left = def.offsetX; top = H - size + (-def.offsetY) }
        else if (def.anchor === 'center')       { left = W/2 - size/2 + def.offsetX; top = H/2 - size/2 + def.offsetY }
        else if (def.anchor === 'center-right') { left = W - size + def.offsetX; top = H/2 - size/2 + def.offsetY }
        orb.el.style.left = left + 'px'
        orb.el.style.top = top + 'px'
        orb.baseCenterX = left + size / 2
        orb.baseCenterY = top + size / 2
      })
    }
    positionOrbs()

    let mx = window.innerWidth / 2, my = window.innerHeight / 2
    let smx = mx, smy = my
    let lastMx = mx, lastMy = my, velX = 0, velY = 0

    function onMouseMove(e) { mx = e.clientX; my = e.clientY }
    function onMouseOut(e) {
      if (!e.relatedTarget) { mx = window.innerWidth / 2; my = window.innerHeight / 2 }
    }
    function onTouchMove(e) {
      if (e.touches.length > 0) { mx = e.touches[0].clientX; my = e.touches[0].clientY }
    }
    function onTouchEnd() { mx = window.innerWidth / 2; my = window.innerHeight / 2 }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseout', onMouseOut)
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd)

    let rafId = 0
    function tick(t) {
      const time = t * 0.001 * LOCKED.speed
      const wanderTime = t * 0.001 * LOCKED.wanderSpeed
      smx += (mx - smx) * 0.10
      smy += (my - smy) * 0.10
      velX = velX * 0.85 + (mx - lastMx) * 0.15
      velY = velY * 0.85 + (my - lastMy) * 0.15
      lastMx = mx; lastMy = my

      orbs.forEach(orb => {
        const def = orb.def
        let driftX = 0, driftY = 0
        for (const f of orb.wanderFreqs) {
          driftX += Math.sin(wanderTime * f.fx + f.px) * f.ax
          driftY += Math.cos(wanderTime * f.fy + f.py) * f.ay
        }
        driftX *= LOCKED.wander
        driftY *= LOCKED.wander
        const dxc = smx - orb.baseCenterX
        const dyc = smy - orb.baseCenterY
        const k = LOCKED.converge / 200 * def.depth
        orb.velX = orb.velX * 0.92 + velX * LOCKED.velocity * def.depth * 0.4
        orb.velY = orb.velY * 0.92 + velY * LOCKED.velocity * def.depth * 0.4
        orb._tempTx = driftX + dxc * k + orb.velX
        orb._tempTy = driftY + dyc * k + orb.velY
      })

      for (let i = 0; i < orbs.length; i++) {
        let fx = 0, fy = 0
        const a = orbs[i]
        const cxi = a.baseCenterX + a._tempTx + a.repelX
        const cyi = a.baseCenterY + a._tempTy + a.repelY
        for (let j = 0; j < orbs.length; j++) {
          if (i === j) continue
          const b = orbs[j]
          const cxj = b.baseCenterX + b._tempTx + b.repelX
          const cyj = b.baseCenterY + b._tempTy + b.repelY
          const dx = cxi - cxj
          const dy = cyi - cyj
          const dist = Math.sqrt(dx * dx + dy * dy) + 1
          const minDist = (a.size + b.size) * LOCKED.spacing
          if (dist < minDist) {
            const force = (minDist - dist) * 0.05 * LOCKED.repel
            fx += dx / dist * force
            fy += dy / dist * force
          }
        }
        a.repelX = (a.repelX + fx) * 0.90
        a.repelY = (a.repelY + fy) * 0.90
      }

      orbs.forEach(orb => {
        const scale = 1 + Math.sin(time * 0.6 + orb.breathPhase) * LOCKED.breath
        const tx = orb._tempTx + orb.repelX
        const ty = orb._tempTy + orb.repelY
        orb.el.style.transform = 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px) scale(' + scale.toFixed(3) + ')'
      })

      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    let resizeTimer = null
    function onResize() {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(positionOrbs, 200)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(rafId)
      if (resizeTimer) clearTimeout(resizeTimer)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseout', onMouseOut)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('resize', onResize)
      orbs.forEach(orb => orb.el.remove())
    }
  }, [])

  // Liquid-pill cursor tracking: capture the cursor's entry point relative to
  // the button so the ::before circle (defined in styles/liquid-pill.css) grows
  // from where the cursor entered. Delegated via mouseover, but we only update
  // when the cursor genuinely ENTERS the button (relatedTarget is outside it) —
  // matches Bystro's mouseenter semantics so the bubble origin stays fixed.
  useEffect(() => {
    const LIQUID_SELECTOR = [
      '.deals-new-btn', '.deals-valuation-btn', '.deals-forms-btn',
      '.deals-materials-btn', '.deals-delete-btn',
      '.data-manager-import-btn', '.data-manager-delete-btn', '.data-manager-summarize-btn', '.data-manager-valuate-btn', '.data-manager-extract-btn',
      '.valuation-new-btn', '.recoup-btn',
      '.agreements-new-btn', '.agreements-edit-btn', '.agreements-export-btn',
      '.agreements-delete-btn', '.agreements-type-btn',
      '.modal-import-btn', '.modal-cancel', '.modal-connect-btn', '.modal-radio-btn',
      '.export-btn'
    ].join(',')
    function handler(e) {
      const btn = e.target.closest(LIQUID_SELECTOR)
      if (!btn) return
      // Only fire on genuine entry — ignore moves between children inside the button
      if (e.relatedTarget && btn.contains(e.relatedTarget)) return
      const rect = btn.getBoundingClientRect()
      btn.style.setProperty('--mx', (e.clientX - rect.left) + 'px')
      btn.style.setProperty('--my', (e.clientY - rect.top) + 'px')
    }
    document.addEventListener('mouseover', handler, true)
    return () => document.removeEventListener('mouseover', handler, true)
  }, [])

  useEffect(() => {
    fetch('/api/deals/saved')
      .then(r => r.json())
      .then(deals => {
        const loaded = {}
        deals.forEach((d, i) => { if (d.valuationState) loaded[i] = d.valuationState })
        setValuationStates(loaded)
      })
      .catch(() => {})
  }, [])

  function handleSelectTemplate(t) {
    setPrefillData(null)
    setSelectedTemplate(t)
  }

  function handleUpdateValuationState(index, state) {
    const merged = { ...valuationStates[index], ...state }
    setValuationStates(prev => ({ ...prev, [index]: { ...prev[index], ...state } }))
    fetch(`/api/deals/${index}/valuation-state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(merged)
    }).catch(() => {})
  }

  function handleOpenValuation(deal, index) {
    setSelectedDeal(deal)
    setSelectedDealIndex(index)
    navigateTo('valuation')
  }

  function handleOpenValuate(folder) {
    if (!folder) return
    setValuateFolder(folder)
    navigateTo('valuate')
  }

  function handleOpenAgreements(deal, index) {
    setSelectedDeal(deal)
    setSelectedDealIndex(index)
    navigateTo('agreements')
  }

  function handleSaveComplete(dealIndex) {
    if (dealIndex == null) return
    fetch('/api/deals/saved')
      .then(r => r.json())
      .then(deals => {
        if (deals[dealIndex]) {
          setSelectedDeal(deals[dealIndex])
          setSelectedDealIndex(dealIndex)
          setPrefillData(null)
          setSelectedTemplate(null)
          setActivePage('agreements')
        }
      })
      .catch(() => {})
  }

  function handleNavigateToOfferLetter(deal, dealIndex, type) {
    let filename
    if (type === 'RTHM Offer Letter') {
      filename = 'RTHM Offer Letter_Template.docx'
    } else {
      const partner = deal.b2bPartner || 'RTHM'
      filename = `${partner} Offer Letter_Template.docx`
    }
    setPrefillData({ dealIndex, dealName: deal.name })
    setSelectedTemplate({ category: 'Offer Letters', filename, name: filename.replace('.docx', '') })
    navigateTo('template')
  }

  function handleNavigateToRPA(deal, dealIndex, type) {
    const filename = type === 'B2B RPA' ? 'B2B RPA_Template.docx' : 'RTHM RPA_Template.docx'
    setPrefillData({ dealIndex, dealName: deal.name })
    setSelectedTemplate({
      category: 'Royalty Purchase Agreements',
      filename,
      name: filename.replace('.docx', '')
    })
    navigateTo('template')
  }

  function handleNavigateToRAS(data) {
    setPrefillData(data)
    setSelectedTemplate({
      category: 'Royalty Purchase Agreements',
      filename: 'RTHM x RAS RPA_Template.docx',
      name: 'RTHM x RAS RPA_Template'
    })
    navigateTo('template')
  }

  return (
    <div className="app-shell">
      <div className="orb-layer" id="orb-layer" />
      <div className="grain" />
      <iframe
        className="app-arcade-iframe"
        src="/floor796.html#wandering"
        title="floor796"
        style={{ visibility: mainArcade ? 'visible' : 'hidden' }}
      />
      <Sidebar
        categories={categories}
        selectedTemplate={selectedTemplate}
        onSelectTemplate={handleSelectTemplate}
        onClearTemplate={() => { setPrefillData(null); setSelectedTemplate(null) }}
        activePage={activePage}
        onSetPage={setActivePage}
      />
      <MainArea
        activePage={activePage}
        selectedTemplate={selectedTemplate}
        prefillData={prefillData}
        selectedDeal={selectedDeal}
        onClearTemplate={() => { setPrefillData(null); setSelectedTemplate(null) }}
        onGoBack={handleGoBack}
        onSaveComplete={handleSaveComplete}
        onNavigateToRAS={handleNavigateToRAS}
        onNavigateToRPA={handleNavigateToRPA}
        onNavigateToOfferLetter={handleNavigateToOfferLetter}
        onOpenValuation={handleOpenValuation}
        onOpenAgreements={handleOpenAgreements}
        selectedDealIndex={selectedDealIndex}
        valuationStates={valuationStates}
        valuationState={valuationStates[selectedDealIndex] || null}
        onUpdateValuationState={(state) => handleUpdateValuationState(selectedDealIndex, state)}
        onBackToDeals={() => setActivePage('deals')}
        arcadeMode={mainArcade}
        onToggleArcade={() => setMainArcade(p => !p)}
        runningSkills={runningSkills}
        setRunningSkills={setRunningSkills}
        valuateFolder={valuateFolder}
        onOpenValuate={handleOpenValuate}
      />
    </div>
  )
}
