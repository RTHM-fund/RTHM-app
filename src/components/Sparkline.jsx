// Minimal sparkline — line shape only, no axes/labels/dots.
// Shared between Data Manager rows and Valuate page tracks table.
// Renders an em-dash placeholder when there are fewer than 2 points (a single
// data point can't define a line direction).
export default function Sparkline({ values, width = 64, height = 24, emptyClassName = 'sparkline-empty' }) {
  if (!values || values.length < 2) return <span className={emptyClassName}>—</span>
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  // padX = 0 so the line spans the full width and its visible edges sit flush with the
  // SVG box (= the cell's content edge) — that makes the gap to the neighbouring column
  // exactly the table's inter-column spacing. padY = 2 keeps peaks/troughs from clipping.
  const padX = 0
  const padY = 2
  const w = width - padX * 2
  const h = height - padY * 2
  const points = values.map((v, i) => {
    const x = padX + (i / (values.length - 1)) * w
    const y = padY + h - ((v - min) / range) * h
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="sparkline-svg">
      <path d={'M' + points.join(' L')} fill="none" stroke="var(--primary)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
