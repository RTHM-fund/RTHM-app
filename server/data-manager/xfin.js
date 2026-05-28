// xfin.js — XNPV + XIRR primitives (Actual/365), no third-party deps.
// Must match Excel XNPV/XIRR within 1e-8 on standard cashflows.

const MS_PER_DAY = 24 * 60 * 60 * 1000

// Convert an ISO date string or Date to a UTC epoch (days since unix epoch, fractional ok).
// Excel XIRR uses Actual/365 day-count regardless of locale.
function toDay(d) {
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) throw new Error(`Invalid date: ${d}`)
  return dt.getTime() / MS_PER_DAY
}

function yearFrac(d0, di) {
  return (toDay(di) - toDay(d0)) / 365
}

// XNPV(rate, cashflows, dates) = Σ cf[i] / (1+r)^((d[i]-d[0])/365)
function xnpv(rate, cashflows, dates) {
  if (cashflows.length !== dates.length) {
    throw new Error(`xnpv: cashflows.length (${cashflows.length}) != dates.length (${dates.length})`)
  }
  if (cashflows.length === 0) throw new Error('xnpv: empty cashflow')
  const d0 = toDay(dates[0])
  const base = 1 + rate
  if (base <= 0) return NaN
  let sum = 0
  for (let i = 0; i < cashflows.length; i++) {
    const yf = (toDay(dates[i]) - d0) / 365
    sum += cashflows[i] / Math.pow(base, yf)
  }
  return sum
}

// Derivative of XNPV with respect to rate.
// d/dr [cf / (1+r)^t] = -t * cf / (1+r)^(t+1)
function xnpvDeriv(rate, cashflows, dates) {
  const d0 = toDay(dates[0])
  const base = 1 + rate
  if (base <= 0) return NaN
  let sum = 0
  for (let i = 0; i < cashflows.length; i++) {
    const yf = (toDay(dates[i]) - d0) / 365
    sum += -yf * cashflows[i] / Math.pow(base, yf + 1)
  }
  return sum
}

// XIRR — Newton-Raphson seeded at 0.1, bisection fallback on [-0.999, 100].
// Matches Excel XIRR semantics: requires at least one negative and one positive cashflow.
// Returns null when no bracket exists or convergence fails completely.
function xirr(cashflows, dates) {
  if (cashflows.length !== dates.length) {
    throw new Error(`xirr: length mismatch (${cashflows.length} vs ${dates.length})`)
  }
  if (cashflows.length < 2) return null

  let hasPos = false, hasNeg = false
  for (const v of cashflows) {
    if (v > 0) hasPos = true
    if (v < 0) hasNeg = true
  }
  if (!hasPos || !hasNeg) return null

  // Newton-Raphson
  let r = 0.1
  const maxIter = 100
  const tol = 1e-10
  for (let i = 0; i < maxIter; i++) {
    const f = xnpv(r, cashflows, dates)
    if (!Number.isFinite(f)) break
    const fp = xnpvDeriv(r, cashflows, dates)
    if (!Number.isFinite(fp) || Math.abs(fp) < 1e-14) break
    const dr = f / fp
    r = r - dr
    if (r <= -1) { r = -0.999; break }  // hard floor — bisect from here
    if (Math.abs(dr) < tol) {
      // Verify convergence
      const fv = xnpv(r, cashflows, dates)
      if (Math.abs(fv) < 1e-6) return r
    }
  }

  // Bisection fallback on [-0.999, 100]
  let lo = -0.999, hi = 100
  const fLo = xnpv(lo, cashflows, dates)
  const fHi = xnpv(hi, cashflows, dates)
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return null
  if (fLo * fHi > 0) return null  // no sign change → no root

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    const fMid = xnpv(mid, cashflows, dates)
    if (!Number.isFinite(fMid)) return null
    if (Math.abs(fMid) < 1e-10 || (hi - lo) / 2 < 1e-12) return mid
    if (fLo * fMid < 0) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}

module.exports = { xnpv, xirr, yearFrac, toDay }
