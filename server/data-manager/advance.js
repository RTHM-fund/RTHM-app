// advance.js — stages 16-22 of the V2 royalty pipeline.
//   16-17. scenario scaffolding (8 scenarios: 7 maturity + Req)
//   18.    cashflow assembly per scenario (dates + lookups against TOTAL)
//   19.    advance solver — closed-form via XNPV (maturity only)
//   20.    recoupment + recoup multiple
//   21.    IRR via XIRR
//   22.    req-months solver — walk k=1..MAX, find min k where XIRR ≥ targetIRR
//
// Consumes only the projections module's TOTAL row + the advance inputs.

const { xnpv, xirr } = require('./xfin')
const { edate } = require('./projections')

const STANDARD_SCENARIOS_MONTHS = [18, 24, 36, 48, 60, 84, 144]
const REQ_MONTHS_MAX_PERIODS = 200
const DEFAULT_TARGET_IRR = 0.30
const DEFAULT_REFERRAL_PCT = 0.01
const DEFAULT_REQ_ADVANCE = 15000

// Stages 16-17 — build the 8 scenarios from advance.scenarios + implicit Req.
function buildScenarios(scenariosMonths) {
  const months = (scenariosMonths && scenariosMonths.length > 0) ? scenariosMonths : STANDARD_SCENARIOS_MONTHS
  const out = months.map(m => ({ name: `${m}m`, months: m, kind: 'maturity' }))
  out.push({ name: 'Req', months: null, kind: 'reqMonths' })
  return out
}

// Stage 18 (helper) — build the date strip + inflow lookups for a given period count.
// Returns { dates: ISODate[1..N], inflows: number[1..N] } (period 0 NOT included here).
// Inflows are SEQUENCE-aligned to the projection: the i-th royalty payment collects the
// i-th projected period's earnings. Payment dates (1st-royalty + step·(i-1)) only drive
// the IRR/XNPV discounting — they do NOT need to coincide with the projection's calendar
// months (they generally don't for quarterly/semi-annual cadences). Past the projection
// horizon → 0 (the only allowed silent zero).
function buildInflows(nPeriods, firstRoyaltyDate, stepMonths, totalProjection) {
  const dates = []
  const inflows = []
  for (let i = 1; i <= nPeriods; i++) {
    dates.push(edate(firstRoyaltyDate, stepMonths * (i - 1)))
    const row = totalProjection[i - 1]
    inflows.push(row ? row.value : 0)
  }
  return { dates, inflows }
}

// Stage 19 — advance back-solve (maturity scenarios only).
// Closed-form: PV_of_inflows = XNPV(targetIRR, [0; inflows], [investmentDate; dates])
//              Advance       = MAX(0, (PV - otherFees) / (1 + referralPct))
function solveAdvance({ targetIRR, otherFees, referralPct, investmentDate, dates, inflows }) {
  const cfs = [0, ...inflows]
  const dts = [investmentDate, ...dates]
  const pv = xnpv(targetIRR, cfs, dts)
  if (!Number.isFinite(pv)) throw new Error(`solveAdvance: XNPV non-finite (rate=${targetIRR})`)
  const advance = Math.max(0, (pv - otherFees) / (1 + referralPct))
  const referral = referralPct * advance
  const rasCost = advance + referral + otherFees
  return { advance, referral, rasCost, pvOfInflows: pv }
}

// Stage 20 — recoupment + recoup multiple.
function computeRecoupment(inflows, advance) {
  let recoupment = 0
  for (const v of inflows) recoupment += v
  const recoupMultiple = recoupment === 0 ? null : advance / recoupment
  return { recoupment, recoupMultiple }
}

// Stage 21 — IRR via XIRR over the full cashflow (period 0 + inflows 1..N).
function computeIRR({ rasCost, investmentDate, dates, inflows }) {
  const cf = [-rasCost, ...inflows]
  const dts = [investmentDate, ...dates]
  return xirr(cf, dts)
}

// Stage 22 — req-months solver.
// Given fixed advance, find min k ∈ [1, MAX] such that XIRR over cashflow[0..k] ≥ targetIRR.
// Returns { reqPeriods, reqMonths, irr, flag } — flag is null on success, message on no-solution.
function solveReqMonths({ reqAdvance, referralPct, otherFees, targetIRR, investmentDate,
                          firstRoyaltyDate, stepMonths, totalProjection }) {
  const rasCost = reqAdvance + reqAdvance * referralPct + otherFees
  const { dates: allDates, inflows: allInflows } =
    buildInflows(REQ_MONTHS_MAX_PERIODS, firstRoyaltyDate, stepMonths, totalProjection)
  const fullCf = [-rasCost, ...allInflows]
  const fullDates = [investmentDate, ...allDates]

  for (let k = 1; k <= REQ_MONTHS_MAX_PERIODS; k++) {
    const cfK = fullCf.slice(0, k + 1)  // period 0..k inclusive = k+1 entries
    const dtK = fullDates.slice(0, k + 1)
    const irr = xirr(cfK, dtK)
    if (irr !== null && Number.isFinite(irr) && irr >= targetIRR) {
      // Build the cashflow output for this scenario
      const cashflow = []
      for (let i = 0; i <= k; i++) {
        cashflow.push({
          period: i,
          date: i === 0 ? investmentDate : allDates[i - 1],
          value: i === 0 ? -rasCost : allInflows[i - 1],
          included: true,
        })
      }
      const recoupment = allInflows.slice(0, k).reduce((a, b) => a + b, 0)
      return {
        reqPeriods: k,
        reqMonths: k * stepMonths,
        advance: reqAdvance,
        referral: reqAdvance * referralPct,
        otherFees,
        rasCost,
        recoupment,
        recoupMultiple: recoupment === 0 ? null : reqAdvance / recoupment,
        irr,
        cashflow,
        flag: null,
      }
    }
  }

  // No k satisfies — return the full-horizon cashflow with the flag set.
  const cashflow = []
  for (let i = 0; i <= REQ_MONTHS_MAX_PERIODS; i++) {
    cashflow.push({
      period: i,
      date: i === 0 ? investmentDate : allDates[i - 1],
      value: i === 0 ? -rasCost : allInflows[i - 1],
      included: false,
    })
  }
  const recoupment = allInflows.reduce((a, b) => a + b, 0)
  return {
    reqPeriods: null,
    reqMonths: null,
    advance: reqAdvance,
    referral: reqAdvance * referralPct,
    otherFees,
    rasCost,
    recoupment,
    recoupMultiple: recoupment === 0 ? null : reqAdvance / recoupment,
    irr: null,
    cashflow,
    flag: `never recoups at target IRR ${(targetIRR * 100).toFixed(1)}% over ${REQ_MONTHS_MAX_PERIODS} × ${stepMonths} = ${REQ_MONTHS_MAX_PERIODS * stepMonths} months`,
  }
}

// Stages 16-22 orchestrator — build the full advance block.
function buildAdvance(projections, advanceInputs) {
  const { stepMonths } = projections.meta
  const totalProjection = projections.total.projection

  // Number.isFinite() guard — explicit defense per the "fail loud" rule.
  // ?? alone would let NaN / Infinity / numeric strings through; Number.isFinite
  // catches all three. 0 is finite, so an explicit 0 input is preserved (not
  // replaced by the default). Audit fix.
  const targetIRR        = Number.isFinite(advanceInputs.targetIRR)   ? advanceInputs.targetIRR   : DEFAULT_TARGET_IRR
  const referralPct      = Number.isFinite(advanceInputs.referralPct) ? advanceInputs.referralPct : DEFAULT_REFERRAL_PCT
  const otherFees        = Number.isFinite(advanceInputs.otherFees)   ? advanceInputs.otherFees   : 0
  const reqAdvance       = Number.isFinite(advanceInputs.reqAdvance)  ? advanceInputs.reqAdvance  : DEFAULT_REQ_ADVANCE
  const investmentDate   = advanceInputs.investmentDate
  const firstRoyaltyDate = advanceInputs.firstRoyaltyDate
  // Manual per-scenario advance overrides (super-user inline edit), keyed by scenario
  // name ('18m'…'144m'). A finite, non-negative value pins that scenario's advance.
  const overrides        = advanceInputs.overrides || {}
  if (!investmentDate)   throw new Error('buildAdvance: investmentDate required')
  if (!firstRoyaltyDate) throw new Error('buildAdvance: firstRoyaltyDate required')

  const scenarios = buildScenarios(advanceInputs.scenarios)
  const out = []

  for (const sc of scenarios) {
    if (sc.kind === 'maturity') {
      const nPeriods = Math.ceil(sc.months / stepMonths)
      const { dates, inflows } = buildInflows(nPeriods, firstRoyaltyDate, stepMonths, totalProjection)

      // A manually-overridden advance pins that scenario: skip the back-solve and
      // recompute the dependent fields off it. Recoupment (term royalties) is
      // independent of the advance, so it's unchanged either way.
      const ov = overrides[sc.name]
      const hasOverride = Number.isFinite(ov) && ov >= 0
      let advance, referral, rasCost
      if (hasOverride) {
        advance = ov
        referral = referralPct * advance
        rasCost = advance + referral + otherFees
      } else {
        ({ advance, referral, rasCost } = solveAdvance({
          targetIRR, otherFees, referralPct, investmentDate, dates, inflows,
        }))
      }
      const { recoupment, recoupMultiple } = computeRecoupment(inflows, advance)
      const irr = computeIRR({ rasCost, investmentDate, dates, inflows })

      const cashflow = [{ period: 0, date: investmentDate, value: -rasCost }]
      for (let i = 0; i < inflows.length; i++) {
        cashflow.push({ period: i + 1, date: dates[i], value: inflows[i] })
      }

      out.push({
        name: sc.name,
        months: sc.months,
        kind: sc.kind,
        advance, referral, otherFees, rasCost,
        recoupment, recoupMultiple, irr,
        cashflow,
        overridden: hasOverride,
      })
    } else {
      // Req
      const req = solveReqMonths({
        reqAdvance, referralPct, otherFees, targetIRR,
        investmentDate, firstRoyaltyDate, stepMonths, totalProjection,
      })
      out.push({
        name: sc.name,
        months: req.reqMonths,
        kind: sc.kind,
        advance: req.advance,
        referral: req.referral,
        otherFees: req.otherFees,
        rasCost: req.rasCost,
        recoupment: req.recoupment,
        recoupMultiple: req.recoupMultiple,
        irr: req.irr,
        cashflow: req.cashflow,
        flag: req.flag,
      })
    }
  }

  return {
    scenarios: out,
    inputs: {
      targetIRR, referralPct, otherFees, investmentDate, firstRoyaltyDate,
      reqAdvance, scenarios: advanceInputs.scenarios || STANDARD_SCENARIOS_MONTHS,
    },
  }
}

module.exports = {
  STANDARD_SCENARIOS_MONTHS,
  REQ_MONTHS_MAX_PERIODS,
  DEFAULT_TARGET_IRR,
  DEFAULT_REFERRAL_PCT,
  DEFAULT_REQ_ADVANCE,
  buildScenarios,
  buildInflows,
  solveAdvance,
  computeRecoupment,
  computeIRR,
  solveReqMonths,
  buildAdvance,
}
