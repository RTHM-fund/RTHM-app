// params.js — projection-params data model: defaults, overrides, presets, resolve, validate.
// Pure functions, no I/O.

const PORTFOLIO_DEFAULTS = Object.freeze({
  k0: 0.06,
  k_inf: 0.015,
  gamma: 0.7,
  floor_pct: 0.5,
  haircut: 0.1,
  baseline_override: null,
})

const PRESETS = Object.freeze({
  EVERGREEN: { k0: 0.06, k_inf: 0.015, gamma: 0.10, floor_pct: 0.25, haircut: 0.10 },
  HIP_HOP:   { k0: 0.18, k_inf: 0.03,  gamma: 0.25, floor_pct: 0.10, haircut: 0.15 },
})

const PARAM_KEYS = ['k0', 'k_inf', 'gamma', 'floor_pct', 'haircut', 'baseline_override']

// Validation ranges from PS spec.
const RANGES = {
  k0:        [0, 0.5],
  k_inf:     [0, 0.2],
  gamma:     [0, 1.0],
  floor_pct: [0, 0.8],
  haircut:   [0, 0.5],
}

function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v) }

// Resolve params for a track: per-track override falls back to defaults.
// Returns { ...resolvedParams, _provenance: { key: {value, source} } } — every field carries
// an audit trail so downstream consumers can show "from override" vs "from default."
function resolveParams(trackKey, defaults, overrides) {
  const d = { ...PORTFOLIO_DEFAULTS, ...(defaults || {}) }
  const o = (overrides && overrides[trackKey]) || {}
  const out = {}
  const _provenance = {}
  for (const k of PARAM_KEYS) {
    const hasOverride = Object.prototype.hasOwnProperty.call(o, k) && o[k] !== null && o[k] !== undefined
    out[k] = hasOverride ? o[k] : d[k]
    _provenance[k] = { value: out[k], source: hasOverride ? 'override' : 'default' }
  }
  out._provenance = _provenance
  return out
}

// Return a copy of the named preset (does not mutate anything).
function applyPreset(presetName) {
  const p = PRESETS[presetName]
  if (!p) throw new Error(`Unknown preset: ${presetName}. Available: ${Object.keys(PRESETS).join(', ')}`)
  return { ...p }
}

// Throw on out-of-range or wrong-type values. Pass-through if ok.
function validateParams(p) {
  if (!p || typeof p !== 'object') throw new Error('validateParams: params must be an object')
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    const v = p[k]
    if (v === null || v === undefined) continue  // ok — falls back to default
    if (!isFiniteNumber(v)) throw new Error(`validateParams: ${k} must be a finite number, got ${v}`)
    if (v < lo || v > hi) throw new Error(`validateParams: ${k}=${v} out of range [${lo}, ${hi}]`)
  }
  if (p.baseline_override !== null && p.baseline_override !== undefined) {
    if (!isFiniteNumber(p.baseline_override)) {
      throw new Error(`validateParams: baseline_override must be a finite number or null, got ${p.baseline_override}`)
    }
    if (p.baseline_override < 0) {
      throw new Error(`validateParams: baseline_override=${p.baseline_override} must be ≥ 0 or null`)
    }
  }
  return p
}

module.exports = {
  PORTFOLIO_DEFAULTS,
  PRESETS,
  PARAM_KEYS,
  resolveParams,
  applyPreset,
  validateParams,
}
