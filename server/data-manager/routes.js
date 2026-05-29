// routes.js — Data Manager API endpoints (V2 royalty engine + Quote export).
//
//   POST /api/data-manager/quote-engine   — pure math: pivot+params+advance → JSON
//   POST /api/data-manager/quote/export   — full pipeline: builds pivot from the
//                                            deal's diligence workbook, runs the
//                                            engine, spawns quote.py, returns the
//                                            output Quote.xlsx path
//
// Modularity: this module imports ONLY from ./projections, ./advance, ./params,
// ./pivot, and Node stdlib. It never reaches into Deal Manager state.

const express = require('express')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const { buildProjections, MAX_PROJ_YEARS } = require('./projections')
const { buildAdvance, DEFAULT_TARGET_IRR, DEFAULT_REFERRAL_PCT, DEFAULT_REQ_ADVANCE } = require('./advance')
const { buildPivotFromWorkbook } = require('./pivot')

const router = express.Router()

// =====================================================================
// /quote-engine  — pure math endpoint (kept for testability + future re-use)
// =====================================================================
router.post('/quote-engine', (req, res) => {
  try {
    const { pivot, params, advance } = req.body || {}
    if (!pivot)   return res.status(400).json({ error: 'missing `pivot` in body' })
    if (!params)  return res.status(400).json({ error: 'missing `params` in body' })
    if (!advance) return res.status(400).json({ error: 'missing `advance` in body' })

    const projections = buildProjections(pivot, params)
    const advanceResult = buildAdvance(projections, advance)
    res.json({ projections, advance: advanceResult })
  } catch (err) {
    console.error('[quote-engine] error:', err && err.stack || err)
    res.status(400).json({ error: err.message || String(err) })
  }
})

// =====================================================================
// /projection-preview — canonical TOTAL projection (per-track decay then
// sum) for catalog graphs (chart:total / chart:adjusted). Fixes the audit
// finding where ProjectionModal's client-side decay-on-already-summed-TOTAL
// produced different numbers than the engine's per-track-then-sum.
//
// Body:  { folder, defaults?, nPeriods? }
// Returns: { projection: [{date, value, period}], lastHistoricalKey,
//            stepMonths, totalBaseline, totalFloor }
// =====================================================================
router.post('/projection-preview', (req, res) => {
  try {
    const { folder, defaults, nPeriods } = req.body || {}
    if (!folder) return res.status(400).json({ error: 'missing `folder` in body' })
    if (!fs.existsSync(folder)) return res.status(404).json({ error: `folder not found: ${folder}` })

    const basename = path.basename(folder)
    const ddFolder = path.join(folder, `${basename}_Due Diligence`)
    if (!fs.existsSync(ddFolder)) return res.status(412).json({ error: 'no Due Diligence folder' })
    const wbPath = resolveDiligenceWorkbookPath(ddFolder, basename)
    if (!wbPath) return res.status(412).json({ error: 'no diligence workbook' })

    // Merge saved per-track overrides with the form's catalog defaults.
    const paramsPath = path.join(folder, `${basename}_Projection.json`)
    let savedParams = { catalogDefaults: {}, trackOverrides: {} }
    if (fs.existsSync(paramsPath)) {
      try { savedParams = JSON.parse(fs.readFileSync(paramsPath, 'utf8')) }
      catch (e) { console.warn('[projection-preview] failed to parse saved params:', e.message) }
    }

    const pivot = buildPivotFromWorkbook(wbPath, basename)
    const proj = buildProjections(pivot, {
      defaults: defaults || savedParams.catalogDefaults || {},
      overrides: savedParams.trackOverrides || {},
    }, {
      customProjPeriods: Number.isFinite(nPeriods) && nPeriods > 0 ? Math.floor(nPeriods) : undefined,
    })

    // Sum-of-track baselines + floors for the chart's reference lines.
    const totalBaseline = proj.tracks.reduce((s, t) => s + t.baseline, 0) + proj.other.baseline
    const totalFloor    = proj.tracks.reduce((s, t) => s + t.floor, 0)    + proj.other.floor

    res.json({
      projection: proj.total.projection,
      lastHistoricalKey: proj.meta.lastHistDate,
      stepMonths: proj.meta.stepMonths,
      totalBaseline,
      totalFloor,
    })
  } catch (err) {
    console.error('[projection-preview] error:', err && err.stack || err)
    res.status(400).json({ error: err.message || String(err) })
  }
})

// =====================================================================
// /quote/preview — same pipeline as /export but returns the 8 scenarios
// only (no Excel write). Used by the Quote modal for live table updates
// as the user types advance inputs.
// =====================================================================
router.post('/quote/preview', (req, res) => {
  try {
    const { folder, advance } = req.body || {}
    if (!folder)  return res.status(400).json({ error: 'missing `folder` in body' })
    if (!advance) return res.status(400).json({ error: 'missing `advance` in body' })
    if (!fs.existsSync(folder)) return res.status(404).json({ error: `folder not found: ${folder}` })

    const basename = path.basename(folder)
    const ddFolder = path.join(folder, `${basename}_Due Diligence`)
    if (!fs.existsSync(ddFolder)) return res.status(412).json({ error: 'no Due Diligence folder' })
    const wbPath = resolveDiligenceWorkbookPath(ddFolder, basename)
    if (!wbPath) return res.status(412).json({ error: 'no diligence workbook' })

    const paramsPath = path.join(folder, `${basename}_Projection.json`)
    let savedParams = { catalogDefaults: {}, trackOverrides: {} }
    if (fs.existsSync(paramsPath)) {
      try { savedParams = JSON.parse(fs.readFileSync(paramsPath, 'utf8')) }
      catch (e) { console.warn('[quote/preview] failed to parse saved params:', e.message) }
    }

    const pivot = buildPivotFromWorkbook(wbPath, basename)
    const projections = buildProjections(pivot, {
      defaults: savedParams.catalogDefaults || {},
      overrides: savedParams.trackOverrides || {},
    }, {
      // Quote preview projects to the full horizon (capped at MAX_PROJ_YEARS), matching
      // the export — so the modal's scenario numbers equal the exported ones.
      customProjPeriods: Math.ceil(MAX_PROJ_YEARS * 12 / pivot.stepMonths),
    })

    const advanceInputs = {
      targetIRR:        Number.isFinite(advance.targetIRR)   ? advance.targetIRR   : DEFAULT_TARGET_IRR,
      referralPct:      Number.isFinite(advance.referralPct) ? advance.referralPct : DEFAULT_REFERRAL_PCT,
      otherFees:        Number.isFinite(advance.otherFees)   ? advance.otherFees   : 0,
      investmentDate:   advance.investmentDate,
      firstRoyaltyDate: advance.firstRoyaltyDate,
      reqAdvance:       Number.isFinite(advance.reqAdvance)  ? advance.reqAdvance  : DEFAULT_REQ_ADVANCE,
      scenarios:        advance.scenarios,
      overrides:        advance.overrides || {},
    }
    if (!advanceInputs.investmentDate)   return res.status(400).json({ error: 'missing advance.investmentDate' })
    if (!advanceInputs.firstRoyaltyDate) return res.status(400).json({ error: 'missing advance.firstRoyaltyDate' })

    const advanceResult = buildAdvance(projections, advanceInputs)
    // Strip cashflow arrays from the response — the modal only needs the 8 scenario summaries.
    const lean = {
      scenarios: advanceResult.scenarios.map(s => {
        const { cashflow, ...rest } = s
        return rest
      }),
      inputs: advanceResult.inputs,
      stepMonths: pivot.stepMonths,
    }
    res.json(lean)
  } catch (err) {
    console.error('[quote/preview] error:', err && err.stack || err)
    res.status(400).json({ error: err.message || String(err) })
  }
})

// =====================================================================
// /quote/export  — full pipeline driven by a deal folder
// =====================================================================
//
// Body shape:
//   {
//     folder: <absolute path to the deal's data folder>,
//     advance: {
//       targetIRR, referralPct, otherFees, investmentDate,
//       firstRoyaltyDate, reqAdvance, scenarios?
//     }
//   }
//
// Response on success: { ok: true, path: '<deal> - Quote.xlsx' }
//
router.post('/quote/export', (req, res) => {
  try {
    const { folder, advance } = req.body || {}
    if (!folder)  return res.status(400).json({ error: 'missing `folder` in body' })
    if (!advance) return res.status(400).json({ error: 'missing `advance` in body' })
    if (!fs.existsSync(folder)) return res.status(404).json({ error: `folder not found: ${folder}` })

    const basename = path.basename(folder)

    // 1. Resolve diligence workbook (must exist — UI gates this button)
    const ddFolder = path.join(folder, `${basename}_Due Diligence`)
    if (!fs.existsSync(ddFolder)) {
      return res.status(412).json({ error: 'no Due Diligence folder — run Diligence first' })
    }
    const wbPath = resolveDiligenceWorkbookPath(ddFolder, basename)
    if (!wbPath) {
      return res.status(412).json({ error: 'no diligence workbook found in _Due Diligence folder' })
    }

    // 2. Load saved projection params (created by the existing Projection modal)
    const paramsPath = path.join(folder, `${basename}_Projection.json`)
    let savedParams = { catalogDefaults: {}, trackOverrides: {} }
    if (fs.existsSync(paramsPath)) {
      try { savedParams = JSON.parse(fs.readFileSync(paramsPath, 'utf8')) }
      catch (e) { console.warn(`[quote/export] failed to parse ${paramsPath}: ${e.message}`) }
    }

    // 3. Build pivot from workbook
    let pivot
    try {
      pivot = buildPivotFromWorkbook(wbPath, basename)
    } catch (e) {
      return res.status(422).json({ error: `pivot build failed: ${e.message}` })
    }

    // 4. Run the engine (in-process — fast, no HTTP roundtrip).
    //    Project to the full horizon (capped at MAX_PROJ_YEARS) instead of the 90-month
    //    default, so long scenarios (84m/144m) recoup against real inflows, and the
    //    forecast strip in the Quote shows the whole projection.
    const projections = buildProjections(pivot, {
      defaults: savedParams.catalogDefaults || {},
      overrides: savedParams.trackOverrides || {},
    }, {
      customProjPeriods: Math.ceil(MAX_PROJ_YEARS * 12 / pivot.stepMonths),
    })

    // 5. Assemble advance inputs (apply defaults for missing fields)
    const advanceInputs = {
      targetIRR:        Number.isFinite(advance.targetIRR)   ? advance.targetIRR   : DEFAULT_TARGET_IRR,
      referralPct:      Number.isFinite(advance.referralPct) ? advance.referralPct : DEFAULT_REFERRAL_PCT,
      otherFees:        Number.isFinite(advance.otherFees)   ? advance.otherFees   : 0,
      investmentDate:   advance.investmentDate,
      firstRoyaltyDate: advance.firstRoyaltyDate,
      reqAdvance:       Number.isFinite(advance.reqAdvance)  ? advance.reqAdvance  : DEFAULT_REQ_ADVANCE,
      scenarios:        advance.scenarios,
      overrides:        advance.overrides || {},
    }
    if (!advanceInputs.investmentDate)   return res.status(400).json({ error: 'missing advance.investmentDate' })
    if (!advanceInputs.firstRoyaltyDate) return res.status(400).json({ error: 'missing advance.firstRoyaltyDate' })

    const advanceResult = buildAdvance(projections, advanceInputs)

    // 6. Write engine output + inputs to temp JSON files
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rthm-quote-'))
    const enginePath = path.join(tmpDir, 'engine.json')
    const inputsPath = path.join(tmpDir, 'inputs.json')
    fs.writeFileSync(enginePath, JSON.stringify({ projections, advance: advanceResult }))
    fs.writeFileSync(inputsPath, JSON.stringify({
      otherFees:        advanceInputs.otherFees,
      referralPct:      advanceInputs.referralPct,
      targetIRR:        advanceInputs.targetIRR,
      investmentDate:   advanceInputs.investmentDate,
      firstRoyaltyDate: advanceInputs.firstRoyaltyDate,
      stepMonths:       pivot.stepMonths,
      reqAdvance:       advanceInputs.reqAdvance,
    }))

    // 7. Resolve quote.py + template paths
    const scriptPath = resolveQuoteSkillPath(folder)
    if (!scriptPath) {
      cleanupTemp(tmpDir, enginePath, inputsPath)
      return res.status(500).json({ error: 'quote.py not found in any ancestor .claude/skills/quote/' })
    }
    const templatePath = path.join(__dirname, '..', 'templates', 'RAS Quote_Template.xlsx')
    if (!fs.existsSync(templatePath)) {
      cleanupTemp(tmpDir, enginePath, inputsPath)
      return res.status(500).json({ error: `template missing: ${templatePath}` })
    }

    // 8. Spawn quote.py — synchronous, deterministic, fast (< 1s typical)
    const outPath = path.join(folder, `${basename} - Quote.xlsx`)
    const pyCmd = process.platform === 'win32' ? 'python' : 'python3'
    const result = spawnSync(pyCmd, [
      scriptPath,
      '--diligence', wbPath,
      '--template',  templatePath,
      '--engine',    enginePath,
      '--inputs',    inputsPath,
      '--out',       outPath,
    ], { encoding: 'utf8', windowsHide: true })

    cleanupTemp(tmpDir, enginePath, inputsPath)

    if (result.error) {
      return res.status(500).json({ error: `spawn failed: ${result.error.message}` })
    }
    if (result.status !== 0) {
      return res.status(500).json({
        error: 'quote.py failed',
        exitCode: result.status,
        stderr: (result.stderr || '').trim(),
        stdout: (result.stdout || '').trim(),
      })
    }
    if (!fs.existsSync(outPath)) {
      return res.status(500).json({ error: 'quote.py reported success but output file missing', stdout: result.stdout })
    }

    res.json({
      ok: true,
      path: outPath,
      meta: {
        stepMonths: pivot.stepMonths,
        trackCount: pivot.tracks.length,
        periodCount: pivot.periods.length,
        scenarioCount: advanceResult.scenarios.length,
      },
    })
  } catch (err) {
    console.error('[quote/export] error:', err && err.stack || err)
    res.status(500).json({ error: err.message || String(err) })
  }
})


// =====================================================================
// Helpers
// =====================================================================

// Mirror of resolveDiligenceWorkbookPath from index.js. See comments there for the
// canonical-vs-variant matching rationale. Duplicated to keep this module
// self-contained (modularity).
function resolveDiligenceWorkbookPath(ddFolder, basename) {
  try {
    const canonical = path.join(ddFolder, `${basename} - Diligence Workbook.xlsx`)
    if (fs.existsSync(canonical)) return canonical
    const candidates = fs.readdirSync(ddFolder)
      .filter(f => /\.xlsx$/i.test(f))
      .filter(f => !f.startsWith('~$'))
      .filter(f => /workbook/i.test(f))
      .filter(f => !/by[-_\s]statement/i.test(f))
      .sort((a, b) => a.length - b.length)
    if (candidates.length === 0) return null
    return path.join(ddFolder, candidates[0])
  } catch { return null }
}

// Walk up from `folder` looking for `<ancestor>/.claude/skills/quote/quote.py`.
// Matches the discovery pattern Claude CLI uses for the diligence + catalog-extract
// skills, but resolved here for direct python spawning.
function resolveQuoteSkillPath(folder) {
  let current = path.resolve(folder)
  for (let i = 0; i < 20; i++) {  // hard cap on walk depth
    const candidate = path.join(current, '.claude', 'skills', 'quote', 'quote.py')
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(current)
    if (parent === current) break  // hit root
    current = parent
  }
  return null
}

function cleanupTemp(dir, ...files) {
  // Cleanup is best-effort — failures are non-fatal and not user-actionable
  // (temp-dir auto-cleanup eventually wins). Swallow but log at debug level so
  // a persistent failure pattern is visible without noisy production logs.
  for (const f of files) {
    try { fs.unlinkSync(f) }
    catch (e) { console.debug('[cleanupTemp] unlink failed:', f, e.message) }
  }
  try { fs.rmdirSync(dir) }
  catch (e) { console.debug('[cleanupTemp] rmdir failed:', dir, e.message) }
}

module.exports = router
