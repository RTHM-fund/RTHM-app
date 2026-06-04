import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MONTHS } from '../utils.js'
import './InvoiceForm.css'

const RTHM_ENTITIES = {
  'RTHM Fund Incorporated': {
    address: '254 Chapman Rd, Ste 208 23005',
    cityStateZip: 'Newark, DE 19702',
    country: 'United States',
    accountNumber: '325211693428',
    wireNumber: '026009593',
  },
  'RTHM Distribution LLC': {
    address: '254 Chapman Rd, Ste 208 22433',
    cityStateZip: 'Newark, DE 19702',
    country: 'United States',
    accountNumber: '139107232435',
    wireNumber: '026009593',
  },
}

const ENTITY_NAMES = Object.keys(RTHM_ENTITIES)

// Formats a number with thousands separators, no currency symbol (app-wide: no $).
function formatDollar(n) {
  return isNaN(n) || n === 0 ? '' : Math.round(n).toLocaleString('en-US')
}

function ComboInput({ value, onChange, onSelect, placeholder, showDropdown, setShowDropdown }) {
  const wrapperRef = useRef(null)
  const inputRef = useRef(null)
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const [menuRect, setMenuRect] = useState(null)

  // Position the portaled menu under the input, matching the INPUT's own width/left (the wrapper
  // is a full-column-width flex item, wider than the field box). Recomputed each open.
  useEffect(() => {
    if (!showDropdown || !inputRef.current) return
    const r = inputRef.current.getBoundingClientRect()
    setMenuRect({ top: r.bottom + 4, left: r.left, width: r.width })
  }, [showDropdown])

  useEffect(() => {
    function handleClick(e) {
      if (wrapperRef.current && wrapperRef.current.contains(e.target)) return
      if (e.target.closest && e.target.closest('.combo-dropdown')) return
      setShowDropdown(false)
      setHighlightIdx(-1)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [setShowDropdown])

  function handleKeyDown(e) {
    if (!showDropdown) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setShowDropdown(true)
        setHighlightIdx(0)
        e.preventDefault()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIdx(prev => (prev + 1) % ENTITY_NAMES.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIdx(prev => (prev - 1 + ENTITY_NAMES.length) % ENTITY_NAMES.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightIdx >= 0 && highlightIdx < ENTITY_NAMES.length) {
        onSelect(ENTITY_NAMES[highlightIdx])
        setShowDropdown(false)
        setHighlightIdx(-1)
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false)
      setHighlightIdx(-1)
    }
  }

  return (
    <div className="combo-input-wrapper" ref={wrapperRef}>
      <input
        ref={inputRef}
        className="field-input"
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); setShowDropdown(false); setHighlightIdx(-1) }}
        onFocus={() => { setShowDropdown(true); setHighlightIdx(-1) }}
        onClick={() => setShowDropdown(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
      {showDropdown && menuRect && createPortal(
        <div
          className="combo-dropdown"
          style={{ position: 'fixed', top: menuRect.top, left: menuRect.left, width: menuRect.width }}
        >
          {ENTITY_NAMES.map((name, idx) => (
            <div
              key={name}
              className={`combo-option${idx === highlightIdx ? ' combo-option--active' : ''}`}
              onMouseDown={() => { onSelect(name); setShowDropdown(false); setHighlightIdx(-1) }}
              onMouseEnter={() => setHighlightIdx(idx)}
            >
              {name}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

export default function InvoiceForm({ template, onBack }) {
  const [fileName, setFileName] = useState('')
  const [fromEntity, setFromEntity] = useState('')
  const [fromAddress, setFromAddress] = useState('')
  const [fromCityStateZip, setFromCityStateZip] = useState('')
  const [fromCountry, setFromCountry] = useState('')
  const [fromAutoFilled, setFromAutoFilled] = useState(false)

  const [toEntity, setToEntity] = useState('')
  const [toAddress, setToAddress] = useState('')
  const [toCityStateZip, setToCityStateZip] = useState('')
  const [toCountry, setToCountry] = useState('')
  const [toAutoFilled, setToAutoFilled] = useState(false)

  const [accountNumber, setAccountNumber] = useState('')
  const [wireNumber, setWireNumber] = useState('')
  const [paymentAutoFilled, setPaymentAutoFilled] = useState(false)

  const [dueDate, setDueDate] = useState('')

  const [lineItemCount, setLineItemCount] = useState('1')
  const [items, setItems] = useState([])

  const [notes, setNotes] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const [fromDropdownOpen, setFromDropdownOpen] = useState(false)
  const [toDropdownOpen, setToDropdownOpen] = useState(false)
  const notesRef = useRef(null)

  useEffect(() => {
    if (notesRef.current) {
      notesRef.current.style.height = 'auto'
      notesRef.current.style.height = notesRef.current.scrollHeight + 'px'
    }
  }, [notes])

  // Update line item rows when count changes
  useEffect(() => {
    const count = parseInt(lineItemCount) || 0
    setItems(prev => {
      if (count <= 0) return []
      const next = []
      for (let i = 0; i < count; i++) {
        next.push(prev[i] || { description: '', quantity: '', unitPrice: '', amount: '' })
      }
      return next
    })
  }, [lineItemCount])

  function handleFromSelect(name) {
    const data = RTHM_ENTITIES[name]
    setFromEntity(name)
    setFromAddress(data.address)
    setFromCityStateZip(data.cityStateZip)
    setFromCountry(data.country)
    setAccountNumber(data.accountNumber)
    setWireNumber(data.wireNumber)
    setFromAutoFilled(true)
    setPaymentAutoFilled(true)
  }

  function handleFromType(val) {
    setFromEntity(val)
    if (RTHM_ENTITIES[val]) {
      handleFromSelect(val)
    } else if (fromAutoFilled) {
      setFromAddress('')
      setFromCityStateZip('')
      setFromCountry('')
      setAccountNumber('')
      setWireNumber('')
      setFromAutoFilled(false)
      setPaymentAutoFilled(false)
    }
  }

  function handleToSelect(name) {
    const data = RTHM_ENTITIES[name]
    setToEntity(name)
    setToAddress(data.address)
    setToCityStateZip(data.cityStateZip)
    setToCountry(data.country)
    setToAutoFilled(true)
  }

  function handleToType(val) {
    setToEntity(val)
    if (RTHM_ENTITIES[val]) {
      handleToSelect(val)
    } else if (toAutoFilled) {
      setToAddress('')
      setToCityStateZip('')
      setToCountry('')
      setToAutoFilled(false)
    }
  }

  const dueDateFormatted = dueDate
    ? (() => { const [year, month, day] = dueDate.split('-'); return `${parseInt(day)} ${MONTHS[parseInt(month) - 1]} ${year}` })()
    : ''

  function handleItemChange(idx, field, value) {
    setItems(prev => {
      const next = [...prev]
      const item = { ...next[idx] }

      if (field === 'quantity') {
        item.quantity = value.replace(/[^0-9]/g, '')
      } else if (field === 'unitPrice') {
        item.unitPrice = value.replace(/[^0-9.]/g, '')
      } else {
        item[field] = value
      }

      const qty = parseFloat(item.quantity) || 0
      const price = parseFloat(item.unitPrice) || 0
      item.amount = qty * price

      next[idx] = item
      return next
    })
  }

  const totalAmount = items.reduce((sum, item) => sum + (item.amount || 0), 0)

  const allFilled = fileName.trim() !== ''
    && fromEntity.trim() !== ''
    && fromAddress.trim() !== ''
    && fromCityStateZip.trim() !== ''
    && fromCountry.trim() !== ''
    && toEntity.trim() !== ''
    && toAddress.trim() !== ''
    && toCityStateZip.trim() !== ''
    && toCountry.trim() !== ''
    && dueDate !== ''
    && accountNumber.trim() !== ''
    && wireNumber.trim() !== ''
    && items.length > 0
    && items.every(item => item.description.trim() !== '' && item.quantity !== '' && item.unitPrice !== '')

  async function handleSave() {
    if (!allFilled) return
    setSaving(true)
    setError(null)

    const today = new Date()
    const dateFormatted = `${today.getDate()} ${MONTHS[today.getMonth()]} ${today.getFullYear()}`

    const fields = {
      'Date': dateFormatted,
      'Due Date': dueDateFormatted,
      'From Entity': fromEntity,
      'From Address': fromAddress,
      'From City/State/Zip': fromCityStateZip,
      'From Country': fromCountry,
      'To Entity': toEntity,
      'To Address': toAddress,
      'To City/State/Zip': toCityStateZip,
      'To Country': toCountry,
      'Total Amount': formatDollar(totalAmount),
      'Account Number': accountNumber,
      'Wire Number': wireNumber,
      'Notes': notes.split('\n').filter(l => l.trim()).map(l => '• ' + l.trim()).join('\n'),
      items: items.map(item => ({
        description: item.description,
        quantity: String(item.quantity),
        unitPrice: formatDollar(parseFloat(item.unitPrice) || 0),
        amount: formatDollar(item.amount),
      })),
    }

    try {
      const res = await fetch('/api/save/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: template.category,
          filename: template.filename,
          fileName: fileName.trim(),
          fields,
        })
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Save failed')
    } catch (err) {
      setError('Save failed: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="invoice-form">
      <div className="invoice-header">
        <button className="back-btn" onClick={onBack}><span className="arr">&#9664;</span> back</button>
        <div className="invoice-title-block">
          <h2 className="invoice-title">{template.name}</h2>
          <span className="invoice-category">{fileName || 'Invoice'}</span>
        </div>
      </div>

      <div className="invoice-body">
        <div className="invoice-fields">

          {/* File Name */}
          <div className="field-group">
            <label className="field-label">File Name</label>
            <input
              className="field-input"
              type="text"
              value={fileName}
              onChange={e => setFileName(e.target.value)}
              placeholder="invoice file name"
            />
          </div>

          {/* ── FROM Section ── */}
          <div className="invoice-section-label">From</div>

          <div className="field-group">
            <label className="field-label">
              Entity
              {fromAutoFilled && <span className="auto-label">auto-filled</span>}
            </label>
            <ComboInput
              value={fromEntity}
              onChange={handleFromType}
              onSelect={handleFromSelect}
              placeholder="select or type entity"
              showDropdown={fromDropdownOpen}
              setShowDropdown={setFromDropdownOpen}
            />
          </div>

          <div className="field-group">
            <label className="field-label">
              Address
              {fromAutoFilled && <span className="auto-label">auto-filled</span>}
            </label>
            <input
              className={`field-input${fromAutoFilled ? ' field-locked' : ''}`}
              type="text"
              value={fromAddress}
              onChange={e => setFromAddress(e.target.value)}
              readOnly={fromAutoFilled}
              tabIndex={fromAutoFilled ? -1 : undefined}
              placeholder="street address"
            />
          </div>

          <div className="field-group">
            <label className="field-label">
              City/State/Zip
              {fromAutoFilled && <span className="auto-label">auto-filled</span>}
            </label>
            <input
              className={`field-input${fromAutoFilled ? ' field-locked' : ''}`}
              type="text"
              value={fromCityStateZip}
              onChange={e => setFromCityStateZip(e.target.value)}
              readOnly={fromAutoFilled}
              tabIndex={fromAutoFilled ? -1 : undefined}
              placeholder="city, state zip"
            />
          </div>

          <div className="field-group">
            <label className="field-label">
              Country
              {fromAutoFilled && <span className="auto-label">auto-filled</span>}
            </label>
            <input
              className={`field-input${fromAutoFilled ? ' field-locked' : ''}`}
              type="text"
              value={fromCountry}
              onChange={e => setFromCountry(e.target.value)}
              readOnly={fromAutoFilled}
              tabIndex={fromAutoFilled ? -1 : undefined}
              placeholder="country"
            />
          </div>

          {/* ── TO Section ── */}
          <div className="invoice-section-label">To</div>

          <div className="field-group">
            <label className="field-label">
              Entity
              {toAutoFilled && <span className="auto-label">auto-filled</span>}
            </label>
            <ComboInput
              value={toEntity}
              onChange={handleToType}
              onSelect={handleToSelect}
              placeholder="select or type entity"
              showDropdown={toDropdownOpen}
              setShowDropdown={setToDropdownOpen}
            />
          </div>

          <div className="field-group">
            <label className="field-label">
              Address
              {toAutoFilled && <span className="auto-label">auto-filled</span>}
            </label>
            <input
              className={`field-input${toAutoFilled ? ' field-locked' : ''}`}
              type="text"
              value={toAddress}
              onChange={e => setToAddress(e.target.value)}
              readOnly={toAutoFilled}
              tabIndex={toAutoFilled ? -1 : undefined}
              placeholder="street address"
            />
          </div>

          <div className="field-group">
            <label className="field-label">
              City/State/Zip
              {toAutoFilled && <span className="auto-label">auto-filled</span>}
            </label>
            <input
              className={`field-input${toAutoFilled ? ' field-locked' : ''}`}
              type="text"
              value={toCityStateZip}
              onChange={e => setToCityStateZip(e.target.value)}
              readOnly={toAutoFilled}
              tabIndex={toAutoFilled ? -1 : undefined}
              placeholder="city, state zip"
            />
          </div>

          <div className="field-group">
            <label className="field-label">
              Country
              {toAutoFilled && <span className="auto-label">auto-filled</span>}
            </label>
            <input
              className={`field-input${toAutoFilled ? ' field-locked' : ''}`}
              type="text"
              value={toCountry}
              onChange={e => setToCountry(e.target.value)}
              readOnly={toAutoFilled}
              tabIndex={toAutoFilled ? -1 : undefined}
              placeholder="country"
            />
          </div>

          {/* ── Due Date ── */}
          <div className="field-group">
            <label className="field-label">Due Date</label>
            <input
              className={`field-input${dueDate ? '' : ' date-empty'}`}
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
            />
          </div>

          {/* ── Line Items ── */}
          <div className="field-group">
            <label className="field-label">Line Items</label>
            <div className="line-items-count-row">
              <input
                className="line-items-count"
                type="text"
                value={lineItemCount}
                onChange={e => {
                  const digits = e.target.value.replace(/[^0-9]/g, '')
                  setLineItemCount(digits)
                }}
                placeholder="0"
              />
              <span style={{ fontSize: 12, color: 'var(--ink-light)' }}>rows</span>
            </div>
          </div>

          {items.length > 0 && (
            <div className="line-items-table">
              <div className="line-item-headers">
                <span className="line-item-header">Description</span>
                <span className="line-item-header">Qty</span>
                <span className="line-item-header">Unit Price</span>
                <span className="line-item-header">Amount</span>
              </div>

              {items.map((item, idx) => (
                <div key={idx} className="line-item-row">
                  <input
                    className="field-input"
                    type="text"
                    value={item.description}
                    onChange={e => handleItemChange(idx, 'description', e.target.value)}
                    placeholder={`item ${idx + 1}`}
                  />
                  <input
                    className="field-input"
                    type="text"
                    value={item.quantity}
                    onChange={e => handleItemChange(idx, 'quantity', e.target.value)}
                    placeholder="0"
                  />
                  <input
                    className="field-input"
                    type="text"
                    value={item.unitPrice}
                    onChange={e => handleItemChange(idx, 'unitPrice', e.target.value)}
                    placeholder="0"
                  />
                  <div className={item.amount ? 'calc-tip' : ''} data-tip={item.amount ? `${item.quantity} × ${item.unitPrice}` : undefined}>
                    <input
                      className="field-input field-locked"
                      type="text"
                      value={item.amount ? Math.round(item.amount).toLocaleString('en-US') : ''}
                      readOnly
                      tabIndex={-1}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Payment ── */}
          <div className="invoice-section-label">Payment Instructions</div>

          <div className="field-group">
            <label className="field-label">
              Account Number
              {paymentAutoFilled && <span className="auto-label">auto-filled</span>}
            </label>
            <input
              className={`field-input${paymentAutoFilled ? ' field-locked' : ''}`}
              type="text"
              value={accountNumber}
              onChange={e => setAccountNumber(e.target.value)}
              readOnly={paymentAutoFilled}
              tabIndex={paymentAutoFilled ? -1 : undefined}
              placeholder="bank account number"
            />
          </div>

          <div className="field-group">
            <label className="field-label">
              Wire Number
              {paymentAutoFilled && <span className="auto-label">auto-filled</span>}
            </label>
            <input
              className={`field-input${paymentAutoFilled ? ' field-locked' : ''}`}
              type="text"
              value={wireNumber}
              onChange={e => setWireNumber(e.target.value)}
              readOnly={paymentAutoFilled}
              tabIndex={paymentAutoFilled ? -1 : undefined}
              placeholder="wire routing number"
            />
          </div>

          {/* ── Notes ── */}
          <div className="field-group">
            <label className="field-label">Notes</label>
            <textarea
              ref={notesRef}
              className="field-input invoice-notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && e.shiftKey) {
                  e.preventDefault()
                  const { selectionStart, selectionEnd } = e.target
                  const before = notes.slice(0, selectionStart)
                  const after = notes.slice(selectionEnd)
                  setNotes(before + '\n' + after)
                  setTimeout(() => { e.target.selectionStart = e.target.selectionEnd = selectionStart + 1 }, 0)
                }
              }}
              placeholder="optional notes (shift+enter for new line)"
              rows={1}
            />
          </div>

          {/* ── Save ── */}
          <div className="invoice-export-row">
            {error && (
              <div className="invoice-error">{error}</div>
            )}
            <button
              className={`export-btn ${(!allFilled || saving) ? 'disabled' : ''} ${saving ? 'saving' : ''}${saving ? ' is-processing' : ''}`}
              onClick={handleSave}
              disabled={!allFilled || saving}
            >
              <span>{saving ? 'exporting...' : 'export invoice'}</span>
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
