import React, { useRef, useEffect } from 'react'
import RPAForm from './RPAForm.jsx'
import OfferLetterForm from './OfferLetterForm.jsx'
import InvoiceForm from './InvoiceForm.jsx'
import DealsPage from './DealsPage.jsx'
import ValuationPage from './ValuationPage.jsx'
import AgreementsPage from './AgreementsPage.jsx'
import DataManagerPage from './DataManagerPage.jsx'
import ValuatePage from './ValuatePage.jsx'
import './MainArea.css'

const RPA_CATEGORY = 'Royalty Purchase Agreements'
const OFFER_CATEGORY = 'Offer Letters'
const INVOICES_CATEGORY = 'Invoices'

export default function MainArea({ activePage, selectedTemplate, prefillData, selectedDeal, selectedDealIndex, onClearTemplate, onGoBack, onSaveComplete, onNavigateToRAS, onNavigateToRPA, onNavigateToOfferLetter, onOpenValuation, onOpenAgreements, onBackToDeals, valuationStates, valuationState, onUpdateValuationState, arcadeMode, onToggleArcade, runningSkills, setRunningSkills, valuateFolder, onOpenValuate }) {
  const rightClickCount = useRef(0)
  const lastRightClick = useRef(0)

  function handleContextMenu(e) {
    e.preventDefault()
    if (arcadeMode && !e.target.closest('.deals-page-header, .valuation-header, .agreements-header, .rpa-header, .offers-header, .invoice-header, .data-manager-header, .valuate-header')) return
    const now = Date.now()
    if (now - lastRightClick.current < 400) {
      rightClickCount.current += 1
      if (rightClickCount.current >= 2) {
        onToggleArcade()
        rightClickCount.current = 0
      }
    } else {
      rightClickCount.current = 1
    }
    lastRightClick.current = now
  }

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Backspace' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
        e.preventDefault()
        onGoBack()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onGoBack])

  function wrap(content) {
    return (
      <div className={`main-area${arcadeMode ? ' main-area--arcade' : ''}`} onContextMenu={handleContextMenu}>
        <div className="main-area-content">
          {content}
        </div>
      </div>
    )
  }

  if (activePage === 'dataManager') return wrap(<DataManagerPage runningSkills={runningSkills} setRunningSkills={setRunningSkills} onOpenValuate={onOpenValuate} />)
  if (activePage === 'valuate') return wrap(<ValuatePage folderPath={valuateFolder?.path} folderName={valuateFolder?.name} onBack={onGoBack} />)
  if (activePage === 'deals') return wrap(<DealsPage onOpenValuation={onOpenValuation} onOpenAgreements={onOpenAgreements} valuationStates={valuationStates} />)
  if (activePage === 'valuation') return wrap(<ValuationPage deal={selectedDeal} dealIndex={selectedDealIndex} onBack={onGoBack} onOpenAgreements={onOpenAgreements} valuationState={valuationState} onUpdateValuationState={onUpdateValuationState} />)
  if (activePage === 'agreements') return wrap(<AgreementsPage deal={selectedDeal} dealIndex={selectedDealIndex} onBack={onGoBack} onNavigateToOfferLetter={onNavigateToOfferLetter} onNavigateToRPA={onNavigateToRPA} />)

  return wrap(
    <>
      {!selectedTemplate && (
        <div className="empty-state">
          <p className="empty-hint">pick a template</p>
        </div>
      )}
      {selectedTemplate && selectedTemplate.category === RPA_CATEGORY && (
        <div className="form-panel slide-in">
          <RPAForm template={selectedTemplate} prefillData={prefillData} onBack={onGoBack} onNavigateToRAS={onNavigateToRAS} onSaveComplete={onSaveComplete} />
        </div>
      )}
      {selectedTemplate && selectedTemplate.category === OFFER_CATEGORY && (
        <div className="form-panel slide-in">
          <OfferLetterForm template={selectedTemplate} prefillData={prefillData} onBack={onGoBack} onSaveComplete={onSaveComplete} />
        </div>
      )}
      {selectedTemplate && selectedTemplate.category === INVOICES_CATEGORY && (
        <div className="form-panel slide-in">
          <InvoiceForm template={selectedTemplate} onBack={onGoBack} />
        </div>
      )}
      {selectedTemplate && selectedTemplate.category !== RPA_CATEGORY && selectedTemplate.category !== OFFER_CATEGORY && selectedTemplate.category !== INVOICES_CATEGORY && (
        <div className="empty-state">
          <p className="empty-hint">coming soon</p>
        </div>
      )}
    </>
  )
}
