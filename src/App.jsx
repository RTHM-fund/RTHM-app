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
  const [valuationStates, setValuationStates] = useState({})
  const [mainArcade, setMainArcade] = useState(false)
  const [pageHistory, setPageHistory] = useState([])

  function navigateTo(page) {
    setPageHistory(prev => [...prev, { page: activePage, template: selectedTemplate, prefill: prefillData, deal: selectedDeal, dealIndex: selectedDealIndex }])
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
  }

  useEffect(() => {
    fetch('/api/templates')
      .then(r => r.json())
      .then(setCategories)
      .catch(err => console.error('Failed to load templates', err))
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
      />
    </div>
  )
}
