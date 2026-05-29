import { useState } from 'react'
import './Sidebar.css'

export default function Sidebar({ categories, selectedTemplate, onSelectTemplate, onClearTemplate, activePage, onSetPage }) {
  const [openCategory, setOpenCategory] = useState(null)

  function toggleCategory(id) {
    setOpenCategory(prev => {
      const closing = prev === id
      if (closing) onClearTemplate()
      return closing ? null : id
    })
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <img src="/logo.png" className="sidebar-logo" alt="RTHM" />
      </div>

      <nav className="sidebar-nav">
        <button
          className={`nav-item ${activePage === 'dataManager' ? 'active' : ''}`}
          onClick={() => { onSetPage('dataManager'); setOpenCategory(null); onClearTemplate() }}
        >
          Data Manager
        </button>

        <button
          className={`nav-item nav-item--spaced ${activePage === 'deals' ? 'active' : ''}`}
          onClick={() => { onSetPage('deals'); setOpenCategory(null); onClearTemplate() }}
        >
          Deal Manager
        </button>

        <div className="sidebar-section-label">Templates</div>

        {categories.map(cat => (
          <div key={cat.id} className="sidebar-category">
            <button
              className={`category-toggle ${openCategory === cat.id ? 'open' : ''}`}
              onClick={() => toggleCategory(cat.id)}
            >
              <span className="category-label">{cat.label}</span>
              <span className="category-chevron">{openCategory === cat.id ? '▾' : '▸'}</span>
            </button>

            {openCategory === cat.id && (
              <div className="category-templates">
                {cat.templates.length === 0 && (
                  <span className="template-empty">No templates yet</span>
                )}
                {cat.templates.map(t => {
                  const isClickable = cat.id === 'Royalty Purchase Agreements' || cat.id === 'Offer Letters' || cat.id === 'Invoices'
                  const isActive = isClickable && selectedTemplate?.filename === t.filename &&
                                   selectedTemplate?.category === cat.id
                  return isClickable ? (
                    <button
                      key={t.filename}
                      className={`template-item ${isActive ? 'active' : ''}`}
                      onClick={() => { onSetPage('template'); onSelectTemplate({ category: cat.id, filename: t.filename, name: t.name }) }}
                    >
                      {t.name}
                    </button>
                  ) : (
                    <span key={t.filename} className="template-item static">
                      {t.name}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </nav>
    </aside>
  )
}
