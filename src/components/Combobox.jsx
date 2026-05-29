import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import './Combobox.css'

// Drop-in replacement for <select className="modal-input"> when the opened
// dropdown menu needs to follow the modal's glass schema. Native <select>
// menus are OS-rendered solid-white panels that CSS can't reach, so this
// custom component is used for B2B template pickers inside modals.
//
// Props mirror a controlled <select>: value (string), onChange (event-like with
// { target: { value } }), options ([{ value, label }]), placeholder, className.
export default function Combobox({ value, onChange, options, placeholder, className = '' }) {
  const [open, setOpen] = useState(false)
  const [menuRect, setMenuRect] = useState(null)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)

  // Position the portaled menu directly below the trigger using its bounding rect.
  // Portal is required because the parent modal has overflow: hidden + a containing
  // block created by backdrop-filter, which traps even position: fixed children.
  useEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setMenuRect({ top: rect.bottom + 4, left: rect.left, width: rect.width })
  }, [open])

  useEffect(() => {
    if (!open) return
    function handleDocMouseDown(e) {
      if (rootRef.current && rootRef.current.contains(e.target)) return
      if (e.target.closest && e.target.closest('.combobox-menu')) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleDocMouseDown)
    return () => document.removeEventListener('mousedown', handleDocMouseDown)
  }, [open])

  const selected = options.find(o => o.value === value)
  const displayLabel = selected ? selected.label : (placeholder || '')

  function pick(v) {
    onChange?.({ target: { value: v } })
    setOpen(false)
  }

  return (
    <div className={`combobox ${className} ${open ? 'open' : ''}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`combobox-trigger ${selected ? '' : 'is-placeholder'}`}
        onClick={() => setOpen(o => !o)}
      >
        <span>
          {displayLabel}
          <svg className="combobox-chevron" viewBox="0 0 12 8" width="12" height="8" aria-hidden="true">
            <path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
        </span>
      </button>
      {open && menuRect && createPortal(
        <div
          className="combobox-menu"
          role="listbox"
          style={{ position: 'fixed', top: menuRect.top, left: menuRect.left, width: menuRect.width }}
        >
          {options.map(o => (
            <div
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`combobox-item ${o.value === value ? 'selected' : ''}`}
              onClick={() => pick(o.value)}
            >
              {o.label}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
