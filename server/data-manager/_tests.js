// _tests.js — PS spec sanity tests A-E. Run via `node _tests.js` from this dir.
// Each test prints PASS/FAIL with expected vs computed. Process exits non-zero on any FAIL.

const { xnpv, xirr } = require('./xfin')
const { buildProjections, computeBaseline, computeFloor, projectDecay } = require('./projections')
const { buildAdvance, solveAdvance, solveReqMonths, buildInflows } = require('./advance')
const { resolveParams, PORTFOLIO_DEFAULTS } = require('./params')

let pass = 0, fail = 0
function check(name, got, expected, tol = 1e-6) {
  const ok = Math.abs(got - expected) < tol
  if (ok) { pass++; console.log(`  PASS  ${name}  got=${got}`) }
  else    { fail++; console.log(`  FAIL  ${name}  expected=${expected}  got=${got}  diff=${got - expected}`) }
}
function checkEq(name, got, expected) {
  const ok = got === expected
  if (ok) { pass++; console.log(`  PASS  ${name}  got=${JSON.stringify(got)}`) }
  else    { fail++; console.log(`  FAIL  ${name}  expected=${JSON.stringify(expected)}  got=${JSON.stringify(got)}`) }
}

// =====================================================================
// TEST A — Decay sanity (single track, no overrides)
// =====================================================================
console.log('\n--- TEST A: Decay sanity (flat 100 over 12 monthly periods) ---')
{
  const hist = Array(12).fill(100)
  const resolved = resolveParams('T1', PORTFOLIO_DEFAULTS, {})
  const bl = computeBaseline(hist, resolved, 1)
  check('longAvg', bl.longAvg, 100)
  check('shortAvg', bl.shortAvg, 100)
  check('monthsHistory', bl.monthsHistory, 12)
  check('w', bl.w, 1)
  check('rawBaseline', bl.rawBaseline, 100)
  check('baseline', bl.baseline, 90)
  const floor = computeFloor(bl.baseline, bl.longAvg, resolved.floor_pct)
  check('floor', floor, 50)
  const { projection } = projectDecay({
    baseline: bl.baseline, floor,
    k0: resolved.k0, k_inf: resolved.k_inf, gamma: resolved.gamma,
    stepMonths: 1, lastHistDate: '2025-12-01',
  })
  // k(1) = k_inf + (k0-k_inf)*exp(-gamma*1*0) = k_inf + (k0-k_inf) = k0 = 0.06
  // cumDecay(1) = 0.06 * 1 = 0.06
  // proj(1) = 50 + 40 * exp(-0.06) ≈ 50 + 40 * 0.9417645335842487 ≈ 87.67058134
  const expectedProj1 = 50 + 40 * Math.exp(-0.06)
  check('proj(1)', projection[0].value, expectedProj1)
  checkEq('proj(1) date', projection[0].date, '2026-01-01')
}

// =====================================================================
// TEST B — baseline_override replaces calculated baseline
// =====================================================================
console.log('\n--- TEST B: baseline_override replaces ---')
{
  const hist = Array(12).fill(100)
  const resolved = resolveParams('T1', PORTFOLIO_DEFAULTS, { T1: { baseline_override: 75 } })
  const bl = computeBaseline(hist, resolved, 1)
  check('baseline (override)', bl.baseline, 75)
  const floor = computeFloor(bl.baseline, bl.longAvg, resolved.floor_pct)
  // MAX(75 × 0.5, 100 × 0.5) = MAX(37.5, 50) = 50
  check('floor (override)', floor, 50)
}

// =====================================================================
// TEST C — XIRR matches Excel
// =====================================================================
console.log('\n--- TEST C: XIRR vs Excel ---')
{
  // [-10000, 1000 × 12] monthly first-of-month starting 2026-01-01
  // Investment 2026-01-01, payments 2026-02-01 .. 2027-01-01 (12 payments).
  // Per spec: 13 entries total (1 negative + 12 positive). Independently verifiable.
  const cfs = [-10000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000]
  const dates = [
    '2026-01-01','2026-02-01','2026-03-01','2026-04-01','2026-05-01','2026-06-01',
    '2026-07-01','2026-08-01','2026-09-01','2026-10-01','2026-11-01','2026-12-01','2027-01-01'
  ]
  const r = xirr(cfs, dates)
  console.log(`  XIRR = ${r}`)
  // PS spec's "0.07442" expected value was a misprint — 12 × $1000 inflows on a $10000
  // outlay recoups 1.2× in a year, so IRR is in the 40% range, not 7%.
  // Verify by the definition of XIRR: XNPV(r) = 0 at the returned rate.
  const residual = xnpv(r, cfs, dates)
  check('XNPV(xirr_result) ≈ 0  (self-consistency)', residual, 0, 1e-6)
  // Sanity-bound: with $12k recouped on $10k over 12 months, IRR must be > 0 and < 100%.
  if (r > 0 && r < 1) { pass++; console.log(`  PASS  XIRR in plausible range (0,1)`) }
  else                { fail++; console.log(`  FAIL  XIRR=${r} out of plausible range`) }

  // Known-IRR sanity case: $1000 in, $1100 out 1 year later → exactly 10%.
  const simpleR = xirr([-1000, 1100], ['2026-01-01', '2027-01-01'])
  check('Simple 1-year 10% IRR', simpleR, 0.10, 1e-9)
}

// =====================================================================
// TEST D — Advance back-solve
// =====================================================================
console.log('\n--- TEST D: Advance back-solve ---')
{
  const targetIRR = 0.30
  const referralPct = 0.01
  const otherFees = 0
  const investmentDate = '2026-01-15'
  const dates = []
  const inflows = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(2026, 1 + i, 1))  // 2026-02-01 .. 2027-01-01
    dates.push(d.toISOString().slice(0, 10))
    inflows.push(1000)
  }
  const { advance, rasCost } = solveAdvance({
    targetIRR, otherFees, referralPct, investmentDate, dates, inflows,
  })
  // Expected: Advance ≈ PV of inflows at 30% / 1.01
  const pv = xnpv(targetIRR, [0, ...inflows], [investmentDate, ...dates])
  const expectedAdvance = Math.max(0, (pv - otherFees) / (1 + referralPct))
  check('Advance vs PV/(1+ref)', advance, expectedAdvance, 1e-9)

  // Verify XIRR of [-RAS_Cost, inflows] = 0.30
  const verifyIRR = xirr([-rasCost, ...inflows], [investmentDate, ...dates])
  check('XIRR(back-solved) = target', verifyIRR, targetIRR, 1e-6)
}

// =====================================================================
// TEST E — Req months solver
// =====================================================================
console.log('\n--- TEST E: Req months ---')
{
  const targetIRR = 0.30
  const referralPct = 0.01
  const otherFees = 0
  const reqAdvance = 10000
  const investmentDate = '2026-01-15'
  // Build a fake TOTAL projection: $1000 × 24 starting 2026-02-01
  const totalProjection = []
  for (let i = 0; i < 24; i++) {
    const d = new Date(Date.UTC(2026, 1 + i, 1))
    totalProjection.push({ date: d.toISOString().slice(0, 10), value: 1000, period: i + 1 })
  }
  const req = solveReqMonths({
    reqAdvance, referralPct, otherFees, targetIRR,
    investmentDate, firstRoyaltyDate: '2026-02-01', stepMonths: 1, totalProjection,
  })
  console.log(`  Req result: periods=${req.reqPeriods}, months=${req.reqMonths}, IRR=${req.irr}, flag=${req.flag}`)
  // Hand check: with $1000/mo inflow and $10100 outlay (10000 + 100 ref), recoup ~ month 11.
  // IRR should first cross 30% somewhere in the 12-14 month range.
  if (req.reqPeriods === null) {
    fail++; console.log('  FAIL  Req solver returned null — should have found a solution')
  } else {
    pass++; console.log(`  PASS  Req solver converged at k=${req.reqPeriods}`)
    // The IRR at k must be ≥ targetIRR
    if (req.irr >= targetIRR - 1e-9) { pass++; console.log(`  PASS  Req IRR ≥ target  (${req.irr} ≥ ${targetIRR})`) }
    else { fail++; console.log(`  FAIL  Req IRR < target  (${req.irr} < ${targetIRR})`) }
    // And k-1 should NOT satisfy (otherwise k is not minimal)
    if (req.reqPeriods > 1) {
      const kMinus = req.reqPeriods - 1
      const inflowsKm = []
      const datesKm = [investmentDate]
      for (let i = 0; i < kMinus; i++) {
        const d = new Date(Date.UTC(2026, 1 + i, 1))
        datesKm.push(d.toISOString().slice(0, 10))
        inflowsKm.push(1000)
      }
      const rasCost = reqAdvance + reqAdvance * referralPct + otherFees
      const irrKm = xirr([-rasCost, ...inflowsKm], datesKm)
      if (irrKm === null || irrKm < targetIRR) { pass++; console.log(`  PASS  k-1=${kMinus} does NOT satisfy  (IRR=${irrKm})`) }
      else { fail++; console.log(`  FAIL  k-1=${kMinus} also satisfies (IRR=${irrKm}) — k is not minimal`) }
    }
  }
}

// =====================================================================
// TEST F — End-to-end engine smoke test
// =====================================================================
console.log('\n--- TEST F: End-to-end engine (buildProjections + buildAdvance) ---')
{
  // 12 monthly periods, 2 tracks
  const periods = []
  for (let i = 0; i < 12; i++) {
    periods.push(new Date(Date.UTC(2025, i, 1)).toISOString().slice(0, 10))
  }
  const pivot = {
    tracks: ['Hit', 'Tail'],
    periods,
    values: [
      Array(12).fill(800),  // Hit — dominant
      Array(12).fill(200),  // Tail
    ],
    stepMonths: 1,
  }
  const proj = buildProjections(pivot, { defaults: {}, overrides: {} })
  console.log(`  topTracks: ${proj.tracks.map(t => t.key).join(', ')}  (keep ${proj.meta.keepCount}, exclude ${proj.meta.excludedCount})`)
  console.log(`  OTHER componentKeys: [${proj.other.componentKeys.join(', ')}]`)
  // Hit alone has 80% of last3 — should be the only top track, Tail in OTHER.
  checkEq('keep count', proj.meta.keepCount, 1)
  checkEq('exclude count', proj.meta.excludedCount, 1)
  checkEq('TOTAL has projection length', proj.total.projection.length, 90)

  const adv = buildAdvance(proj, {
    targetIRR: 0.30, referralPct: 0.01, otherFees: 0,
    investmentDate: '2026-01-15', firstRoyaltyDate: '2026-02-01',
    reqAdvance: 10000,
  })
  console.log(`  Scenarios: ${adv.scenarios.map(s => `${s.name}=${s.advance ? s.advance.toFixed(0) : 'N/A'}`).join('  ')}`)
  checkEq('scenario count = 8', adv.scenarios.length, 8)
  // Verify back-solved IRR ≈ targetIRR for each maturity scenario
  for (const sc of adv.scenarios) {
    if (sc.kind === 'maturity' && sc.advance > 0) {
      const diff = Math.abs(sc.irr - 0.30)
      if (diff < 1e-6) { pass++; console.log(`  PASS  ${sc.name} IRR=${sc.irr}`) }
      else             { fail++; console.log(`  FAIL  ${sc.name} IRR=${sc.irr} (diff=${diff})`) }
    }
  }
}

// =====================================================================
console.log(`\n=== ${pass} passed, ${fail} failed ===`)
process.exit(fail === 0 ? 0 : 1)
