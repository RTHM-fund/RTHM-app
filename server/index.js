const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawnSync, spawn } = require('child_process')
const mammoth = require('mammoth')
const PizZip = require('pizzip')
const Docxtemplater = require('docxtemplater')
const XLSX = require('xlsx')
const { google } = require('googleapis')

const CREDENTIALS = require('./credentials.json').installed
const MONDAY_TOKEN = require('./monday_config.json').api_token
// Derive RTHM root by walking up from this file's location, looking for a directory
// that contains `1. RTHM Fund/2. Offers`. This works regardless of how the Dropbox
// is structured on each machine (e.g. team Dropbox `<DROPBOX>/RTHM Fund/RTHM/...`
// vs personal Dropbox where `1. RTHM Fund` may sit higher or lower in the tree).
function findDropboxRTHM() {
  let current = path.resolve(__dirname, '..', '..')
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(current, '1. RTHM Fund', '2. Offers'))) return current
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  console.warn('[RTHM] Could not locate "1. RTHM Fund/2. Offers" in any parent directory. Falling back to default path. Agreements/Materials/Data features may not work until the relevant Dropbox folders are synced locally.')
  return path.resolve(__dirname, '..', '..', '..', '..')
}
const DROPBOX_RTHM = findDropboxRTHM()
console.log('[RTHM] DROPBOX_RTHM =', DROPBOX_RTHM)
const TEMP_AGREEMENTS_DIR = path.join(DROPBOX_RTHM, '1. RTHM Fund', '2. Offers', 'Temp Agreements')
const DEAL_SHEETS_DIR = path.join(DROPBOX_RTHM, '1. RTHM Fund', '2. Offers', 'Deal Sheets')
const MATERIALS_ROOT = path.join(DROPBOX_RTHM, '1. RTHM Fund', '3. Deal Materials')
const DATA_ROOT = path.join(DROPBOX_RTHM, '1. RTHM Fund', '1. Data')
const MONDAY_BOARD_ID = 18397562279
const MONDAY_GROUP_ID = 'new_group29179'
const MONDAY_TYPE_COL = 'color_mm00qwp6'
const MONDAY_COMMISSION_COL = 'numeric_mkvz2fsk'
const SPREADSHEET_ID = '1tCKprwGo8RfnKJY31eLlI5-PyHgzRmTApITyYzzIIsk'
const SHEET_GID = 944936958
const TOKEN_PATH = path.join(__dirname, 'token.json')
const REDIRECT_URI = 'http://localhost:3001/api/auth/callback'
const DEALS_FILE = path.join(__dirname, '..', 'data', 'deals.json')
const B2B_PARTNERS_FILE = path.join(__dirname, '..', 'data', 'b2b-partners.json')
const BACKUP_DIR = path.resolve(__dirname, '..', '..', 'Backups')
const MAX_BACKUPS_PER_HOST = 50
const HOSTNAME = os.hostname().replace(/[^a-zA-Z0-9-]/g, '-')

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const TERMS_ALL = ['12 months', '36 months', '60 months', '84 months', '144 months']
// Quote sources, by sheet section. Each pair = [advance col, RAS recoup col], indexed by TERMS_ALL.
// NOTE: the code's `initialQuote` (IQ) is the sheet's "Initial quotes, net of 3% fee" section;
// `grossQuote` (GQ) is the sheet's plain "Initial quotes" section (fallback when IQ is empty).
const GQ_PAIRS = [['AC','AD'], ['AE','AF'], ['AG','AH'], ['AI','AJ'], ['AK','AL']]
const IQ_PAIRS = [['AP','AQ'], ['AR','AS'], ['AT','AU'], ['AV','AW'], ['AX','AY']]
const VQ_PAIRS = [['BC','BD'], ['BE','BF'], ['BG','BH'], ['BI','BJ'], ['BK','BL']]
// Auto-filled starting recoup = the deal's own RAS rate minus a per-term offset (percentage points).
// B2B offsets run 2pts tighter than Individual. See effectiveRatesFor.
const OFFSETS = {
  Individual: { '12 months': 6, '36 months': 5, '60 months': 4, '84 months': 4, '144 months': 3 },
  B2B:        { '12 months': 4, '36 months': 3, '60 months': 2, '84 months': 2, '144 months': 1 }
}

function readDeals() {
  try { return JSON.parse(fs.readFileSync(DEALS_FILE)) } catch { return [] }
}

// Snapshot deals.json BEFORE every write to a Dropbox-synced backup folder outside App Files.
// Each machine prunes only its own backups (filename ends in .<hostname>.json) so one machine
// can never delete another's recovery points.
function backupDealsBefore(targetPath) {
  if (!fs.existsSync(targetPath)) return
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const dest = path.join(BACKUP_DIR, `deals.${ts}.${HOSTNAME}.json`)
    fs.copyFileSync(targetPath, dest)
    const ownBackups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('deals.') && f.endsWith(`.${HOSTNAME}.json`))
      .sort()
    while (ownBackups.length > MAX_BACKUPS_PER_HOST) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, ownBackups.shift())) } catch {}
    }
  } catch (err) {
    console.warn('[RTHM] deals.json backup failed:', err.message)
  }
}

// Atomic write: serialize to a temp file, then rename onto the target.
// rename() is atomic on a single filesystem — readers either see the old or new
// file, never a half-written state.
// On Windows + Dropbox the rename can briefly fail with EPERM/EBUSY while the
// sync client holds a file lock. Retry with backoff, then fall back to a direct
// write so we never lose data because of a transient lock.
function atomicWriteJson(targetPath, data) {
  const tmp = targetPath + '.tmp'
  const json = JSON.stringify(data, null, 2)
  fs.writeFileSync(tmp, json)
  let lastErr = null
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.renameSync(tmp, targetPath)
      return
    } catch (err) {
      lastErr = err
      if (err.code !== 'EPERM' && err.code !== 'EBUSY' && err.code !== 'ENOTEMPTY') throw err
      const waitMs = 50 * (attempt + 1)
      const start = Date.now()
      while (Date.now() - start < waitMs) { /* brief sync wait for Dropbox to release lock */ }
    }
  }
  console.warn('[RTHM] atomic rename failed after retries, falling back to direct write:', lastErr?.message)
  try { fs.unlinkSync(tmp) } catch {}
  fs.writeFileSync(targetPath, json)
}

function writeDeals(deals) {
  backupDealsBefore(DEALS_FILE)
  atomicWriteJson(DEALS_FILE, deals)
}

// Stale .tmp from a prior crash (between writeFileSync and renameSync) would
// otherwise sit forever. Cheap one-time cleanup at startup.
try { fs.unlinkSync(DEALS_FILE + '.tmp') } catch {}

// On startup, surface any Dropbox conflict files so the user can manually reconcile.
// We never auto-merge — too risky.
function checkForDropboxConflicts() {
  try {
    const dataDir = path.dirname(DEALS_FILE)
    if (!fs.existsSync(dataDir)) return
    const conflicts = fs.readdirSync(dataDir).filter(f =>
      /(\(.*conflicted copy.*\)|\.conflict\.)/i.test(f)
    )
    if (conflicts.length > 0) {
      console.warn('[RTHM] Dropbox conflict files detected in data folder:')
      conflicts.forEach(f => console.warn('  - ' + f))
      console.warn('[RTHM] Review and merge manually, then delete the conflict file.')
    }
  } catch (err) {
    console.warn('[RTHM] conflict file check failed:', err.message)
  }
}
checkForDropboxConflicts()

// macOS: Dropbox doesn't sync the Unix exec bit, so Windows-side edits to the
// .command launchers arrive non-executable on Macs. Re-apply at every boot so
// direct double-clicks in Finder keep working. (The Desktop shortcut launches
// via bash and never needs the bit.)
if (os.platform() === 'darwin') {
  for (const f of ['RTHM Setup.command', 'RTHM Launch.command']) {
    try { fs.chmodSync(path.join(__dirname, '..', '..', f), 0o755) } catch {}
  }
}

// Cleanup helper for endpoints that resolve a stale reference and need to
// remove it from deals.json + return a 404 with a UI refresh hint.
function clearAndRespond404(res, deals, msg, mutate) {
  mutate(deals)
  writeDeals(deals)
  return res.status(404).json({ error: msg, cleared: true })
}

function openFile(filePath) {
  const proc = os.platform() === 'win32'
    ? spawn('explorer', [filePath], { detached: true, stdio: 'ignore' })
    : spawn('open', [filePath], { detached: true, stdio: 'ignore' })
  proc.unref()
}

function resolveAgreementPath(ag) {
  if (!ag?.fileName) return null
  const resolved = path.join(TEMP_AGREEMENTS_DIR, ag.fileName)
  if (fs.existsSync(resolved)) return resolved
  if (ag.filePath && fs.existsSync(ag.filePath)) return ag.filePath
  return null
}

const WANTED_COLS = ['A','C','AC','AD','AE','AF','AG','AH','AI','AJ','AK','AL','AP','AQ','AR','AS','AT','AU','AV','AW','AX','AY','BA','BC','BD','BE','BF','BG','BH','BI','BJ','BK','BL']

const GQ_COLS = ['AC','AD','AE','AF','AG','AH','AI','AJ','AK','AL']
const IQ_COLS = ['AP','AQ','AR','AS','AT','AU','AV','AW','AX','AY']
const VQ_COLS = ['BC','BD','BE','BF','BG','BH','BI','BJ','BK','BL']

function buildDealData(rows) {
  const groups = {}
  rows.forEach(row => {
    const name = row['A']?.trim()
    if (!name) return
    if (!groups[name]) groups[name] = []
    groups[name].push(row)
  })

  return Object.entries(groups).map(([name, groupRows]) => {
    const platform = [...new Set(groupRows.map(r => r['C']).filter(Boolean))].join(', ')
    const sumCol = col => {
      const nums = groupRows.map(r => parseFloat((r[col] || '').replace(/[^0-9.-]/g, ''))).filter(n => !isNaN(n))
      return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) : null
    }
    const grossQuote = {}
    GQ_COLS.forEach(col => { grossQuote[col] = sumCol(col) })
    const initialQuote = {}
    IQ_COLS.forEach(col => { initialQuote[col] = sumCol(col) })
    const percentRaw = groupRows.find(r => r['BA'])?.['BA'] || ''
    const percent = parseFloat(percentRaw.replace(/[^0-9.-]/g, '')) || null
    const variableQuote = {}
    VQ_COLS.forEach(col => { variableQuote[col] = sumCol(col) })
    return { name, platform, grossQuote, initialQuote, percent, variableQuote }
  })
}

function colIndex(col) {
  let n = 0
  for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64)
  return n - 1
}

// Does any term-pair in `prs` carry data in `obj`?
function pairsHaveData(obj, prs) {
  return prs.some(([a, b]) => obj?.[a] || obj?.[b])
}

// Resolve which quote block to use for a deal, by priority:
// variable (if present) → net-of-3% initial (if present) → plain initial (grossQuote).
// Returns { source, pairs }, both indexed by TERMS_ALL.
function resolveQuoteSource(deal) {
  const gq = deal.grossQuote || {}
  const iq = deal.initialQuote || {}
  const vq = deal.variableQuote || {}
  if (pairsHaveData(vq, VQ_PAIRS)) return { source: vq, pairs: VQ_PAIRS }
  if (pairsHaveData(iq, IQ_PAIRS)) return { source: iq, pairs: IQ_PAIRS }
  return { source: gq, pairs: GQ_PAIRS }
}

// Per-term effective recoup rate: the saved rate if present, else the auto-fill
// (RAS rate − per-term offset, clamped ≥ 0). Mirrors ValuationPage so the exported
// rate equals the on-screen rate. Fills blanks only.
function effectiveRatesFor(source, pairs, savedRates, dealType) {
  const offsets = OFFSETS[dealType] || OFFSETS.Individual
  const saved = savedRates || {}
  const out = {}
  TERMS_ALL.forEach(term => {
    if (saved[term] != null) { out[term] = saved[term]; return }
    const [advCol, recoupCol] = pairs[TERMS_ALL.indexOf(term)]
    const adv = parseFloat(source[advCol]), rec = parseFloat(source[recoupCol])
    if (adv && rec) out[term] = Math.max(0, Math.round((adv / rec * 100 - offsets[term]) * 100) / 100)
  })
  return out
}

function getOAuth2Client() {
  return new google.auth.OAuth2(CREDENTIALS.client_id, CREDENTIALS.client_secret, REDIRECT_URI)
}

function getAuthenticatedClient() {
  if (!fs.existsSync(TOKEN_PATH)) return null
  const auth = getOAuth2Client()
  auth.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH)))
  return auth
}

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))  // raised for V2 engine — pivot payloads can be large

// V2 royalty engine (Data Manager only — modularity-safe)
const dataManagerRoutes = require('./data-manager/routes')
app.use('/api/data-manager', dataManagerRoutes)

const CATEGORIES = [
  { id: 'Deal Sheets', label: 'Deal Sheets' },
  { id: 'Offer Letters', label: 'Offer Letters' },
  { id: 'Royalty Purchase Agreements', label: 'RPAs' },
  { id: 'Invoices', label: 'Invoices' },
]

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'Templates')

function getLibreOfficeBin() {
  const candidates = [
    'C:/Program Files/LibreOffice/program/soffice.com',     // Windows — console subsystem, no popup window
    'C:/Program Files/LibreOffice/program/soffice.exe',     // Windows fallback
    '/Applications/LibreOffice.app/Contents/MacOS/soffice', // Mac
    'soffice',                                               // Linux / Windows PATH
    'libreoffice',                                           // Linux alternate
  ]
  for (const bin of candidates) {
    try {
      const r = spawnSync(bin, ['--version'], { timeout: 5000, windowsHide: true, stdio: 'pipe' })
      if (r.status === 0 || r.error === undefined) return bin
    } catch {}
  }
  throw new Error('LibreOffice not found. Please install it from https://www.libreoffice.org')
}

const LIBRE_BIN = getLibreOfficeBin()

// ── Monday B2B Column ──
let mondayB2BCol = null

async function getMondayB2BColumn() {
  if (mondayB2BCol) return mondayB2BCol
  const query = `{ boards(ids: ${MONDAY_BOARD_ID}) { columns { id title type settings_str } } }`
  const response = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': MONDAY_TOKEN },
    body: JSON.stringify({ query })
  })
  const data = await response.json()
  const columns = data.data?.boards?.[0]?.columns || []
  const b2bCol = columns.find(c => c.title === 'B2B')
  if (!b2bCol) return null
  const settings = JSON.parse(b2bCol.settings_str || '{}')
  const options = (settings.labels || []).filter(l => l && l.id != null && l.name)
  mondayB2BCol = { columnId: b2bCol.id, type: b2bCol.type, options }
  return mondayB2BCol
}

function fuzzyMatchOption(partnerName, options) {
  const lower = partnerName.toLowerCase()
  return options.find(o => o.name.toLowerCase().includes(lower))
    || options.find(o => lower.includes(o.name.toLowerCase()))
    || null
}

async function updateMondayB2B(mondayItemId, partnerName) {
  const col = await getMondayB2BColumn()
  if (!col) return
  const match = fuzzyMatchOption(partnerName, col.options)
  if (!match) return
  const value = JSON.stringify({ ids: [match.id] })
  const mutation = `mutation { change_column_value(board_id: ${MONDAY_BOARD_ID}, item_id: ${mondayItemId}, column_id: ${JSON.stringify(col.columnId)}, value: ${JSON.stringify(value)}) { id } }`
  await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': MONDAY_TOKEN },
    body: JSON.stringify({ query: mutation })
  })
}

async function updateMondayCommission(mondayItemId, value) {
  const colVals = JSON.stringify({ [MONDAY_COMMISSION_COL]: String(value) })
  const mutation = `mutation { change_multiple_column_values(board_id: ${MONDAY_BOARD_ID}, item_id: ${mondayItemId}, column_values: ${JSON.stringify(colVals)}) { id } }`
  await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': MONDAY_TOKEN },
    body: JSON.stringify({ query: mutation })
  })
}

// ── Google Auth ──
app.get('/api/auth/status', (req, res) => {
  res.json({ connected: fs.existsSync(TOKEN_PATH) })
})

app.get('/api/auth/url', (req, res) => {
  const auth = getOAuth2Client()
  const url = auth.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    prompt: 'consent'
  })
  res.json({ url })
})

app.get('/api/auth/callback', async (req, res) => {
  try {
    const auth = getOAuth2Client()
    const { tokens } = await auth.getToken(req.query.code)
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens))
    res.send('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Connected!</h2><p>You can close this tab and return to RTHM.</p></body></html>')
  } catch (err) {
    res.status(500).send('Authentication failed: ' + err.message)
  }
})

app.get('/api/auth/disconnect', (req, res) => {
  if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH)
  res.json({ ok: true })
})


// GET /api/templates — all categories + their template files
app.get('/api/templates', (req, res) => {
  const result = CATEGORIES.map(cat => {
    const dir = path.join(TEMPLATES_DIR, cat.id)
    const files = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter(f => f.endsWith('.docx') && !f.startsWith('~$'))
      : []
    return {
      id: cat.id,
      label: cat.label,
      templates: files.map(f => ({ name: f.replace('.docx', ''), filename: f })).sort((a, b) => {
        // Pin the RTHM-branded template to the top of Deal Sheets and Offer Letters;
        // every other case (incl. RPAs, Invoices) is alphabetical.
        if (cat.id === 'Deal Sheets' || cat.id === 'Offer Letters') {
          const aRthm = a.name.startsWith('RTHM ')
          const bRthm = b.name.startsWith('RTHM ')
          if (aRthm !== bRthm) return aRthm ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })
    }
  })
  res.json(result)
})

// GET /api/fields/:category/:filename — extract {{fields}} from a docx
const fieldsCache = {}

async function extractFields(filepath) {
  const stat = fs.statSync(filepath)
  if (stat.size < 1000) {
    throw new Error('Template file may not be fully synced. If using Dropbox, right-click the Templates folder and select "Make Available Offline".')
  }
  const result = await mammoth.extractRawText({ path: filepath })
  const regex = /\{\{([^}]+)\}\}/g
  const seen = new Set()
  const fields = []
  let match
  while ((match = regex.exec(result.value)) !== null) {
    const field = match[1].trim()
    if (!seen.has(field) && !field.startsWith('#') && !field.startsWith('/')) {
      seen.add(field)
      fields.push(field)
    }
  }
  return fields
}

app.get('/api/fields/:category/:filename', async (req, res) => {
  try {
    const { category, filename } = req.params
    const filepath = path.join(TEMPLATES_DIR, decodeURIComponent(category), decodeURIComponent(filename))

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Template not found' })
    }

    const cacheKey = filepath
    if (fieldsCache[cacheKey]) {
      return res.json({ fields: fieldsCache[cacheKey] })
    }

    let fields
    try {
      fields = await extractFields(filepath)
    } catch {
      await new Promise(r => setTimeout(r, 2000))
      fields = await extractFields(filepath)
    }

    fieldsCache[cacheKey] = fields
    res.json({ fields })
  } catch (err) {
    console.error('Field extraction error:', err)
    res.status(500).json({ error: 'Failed to extract fields from template' })
  }
})

// POST /api/save/rpa — fill RPA template and save as docx to Temp Agreements
app.post('/api/save/rpa', (req, res) => {
  try {
    const { category, filename, fileName, fields, dealIndex, typeLabel, showFutures, showMarketing, showDistro } = req.body
    if (!fileName?.trim()) return res.status(400).json({ error: 'File Name is required' })
    const templatePath = path.join(TEMPLATES_DIR, category, filename)
    if (!fs.existsSync(templatePath)) return res.status(404).json({ error: 'Template not found' })
    const base = filename.replace('.docx', '')
    const underscoreIdx = base.lastIndexOf('_')
    const prefix = underscoreIdx !== -1 ? base.substring(0, underscoreIdx + 1) : base + '_'
    const docName = `${prefix}${fileName.trim()}.docx`
    const templateFields = { ...fields }
    if (showFutures !== undefined) templateFields.showFutures = showFutures
    if (showMarketing !== undefined) templateFields.showMarketing = showMarketing
    if (showDistro !== undefined) templateFields.showDistro = showDistro
    const filledBuf = fillDocx(templatePath, templateFields)
    fs.mkdirSync(TEMP_AGREEMENTS_DIR, { recursive: true })
    const filePath = path.join(TEMP_AGREEMENTS_DIR, docName)
    fs.writeFileSync(filePath, filledBuf)

    if (dealIndex != null && typeLabel) {
      const deals = readDeals()
      if (deals[dealIndex]) {
        if (!deals[dealIndex].agreements) deals[dealIndex].agreements = []
        const entry = { type: typeLabel, fileName: docName, filePath, createdAt: new Date().toISOString() }
        const existing = deals[dealIndex].agreements.findIndex(ag => ag.type === typeLabel)
        if (existing !== -1) deals[dealIndex].agreements[existing] = entry
        else deals[dealIndex].agreements.push(entry)
        writeDeals(deals)
      }
    }

    res.json({ ok: true, docName })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/save/invoice — fill invoice template and save as a Word .docx to Downloads
app.post('/api/save/invoice', (req, res) => {
  try {
    const { category, filename, fileName, fields } = req.body
    if (!fileName?.trim()) return res.status(400).json({ error: 'File Name is required' })
    const templatePath = path.join(TEMPLATES_DIR, category, filename)
    if (!fs.existsSync(templatePath)) return res.status(404).json({ error: 'Template not found' })

    const base = filename.replace('.docx', '')
    const underscoreIdx = base.lastIndexOf('_')
    const prefix = underscoreIdx !== -1 ? base.substring(0, underscoreIdx + 1) : base + '_'
    const safeName = path.basename(fileName.trim())
    const docName = `${prefix}${safeName}.docx`

    const filledBuf = fillDocx(templatePath, { ...fields })

    const outDir = path.join(os.homedir(), 'Downloads')
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, docName), filledBuf)

    res.json({ ok: true, docName })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Deal Manager ──

// GET /api/deals/saved — all persisted deals.
// Read-only: never mutates deals.json. Stale references (deleted .docx files,
// missing folders) are cleaned up only on explicit user action — when the user
// clicks "edit DOC" / "export PDF" / "open folder" and the underlying file is
// genuinely missing, the corresponding endpoint silently removes that one
// reference. This prevents an unsynced machine from wiping real data.
app.get('/api/deals/saved', (req, res) => {
  res.json(readDeals())
})

// GET /api/deals/sheet-rows — sheet rows for import modal
app.get('/api/deals/sheet-rows', async (req, res) => {
  try {
    const auth = getAuthenticatedClient()
    if (!auth) return res.status(401).json({ error: 'Not connected' })

    const sheets = google.sheets({ version: 'v4', auth })
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
    const sheet = meta.data.sheets.find(s => s.properties.sheetId === SHEET_GID)
    if (!sheet) return res.status(404).json({ error: 'Sheet not found' })

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheet.properties.title}!A7:BL`
    })

    const rows = response.data.values || []
    if (rows.length === 0) return res.json({ headerMap: {}, rows: [] })

    const headerRow = rows[0]
    const headerMap = {}
    WANTED_COLS.forEach(col => {
      headerMap[col] = headerRow[colIndex(col)]?.trim() || col
    })

    const dataRows = rows.slice(1)
      .filter(row => row[0]?.trim())
      .map(row => {
        const obj = {}
        WANTED_COLS.forEach(col => { obj[col] = row[colIndex(col)]?.trim() || '' })
        return obj
      })

    res.json({ headerMap, rows: dataRows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/deals/import — merge selected rows and append to deals.json
app.post('/api/deals/import', (req, res) => {
  try {
    const { rows, dealType, royaltyType, commission, mondayItemId } = req.body
    const newDeals = buildDealData(rows).map(d => ({
      ...d, dealType: dealType || '', royaltyType: royaltyType || '', commission: commission || '',
      mondayItemId: mondayItemId || null, mondayBoardId: mondayItemId ? MONDAY_BOARD_ID : null,
      importedAt: new Date().toISOString()
    }))
    const existing = readDeals()
    fs.mkdirSync(path.dirname(DEALS_FILE), { recursive: true })
    writeDeals([...existing, ...newDeals])
    res.json({ ok: true, imported: newDeals.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/monday/create-deal — create item in Monday Current group
app.post('/api/monday/create-deal', async (req, res) => {
  try {
    const { name, type, commission } = req.body
    const colVals = {}
    if (type) colVals[MONDAY_TYPE_COL] = { label: type }
    if (commission !== '' && commission !== null) colVals[MONDAY_COMMISSION_COL] = String(commission)

    const mutation = `mutation {
      create_item(
        board_id: ${MONDAY_BOARD_ID},
        group_id: "${MONDAY_GROUP_ID}",
        item_name: ${JSON.stringify(name)},
        column_values: ${JSON.stringify(JSON.stringify(colVals))}
      ) { id }
    }`

    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': MONDAY_TOKEN },
      body: JSON.stringify({ query: mutation })
    })
    const data = await response.json()
    if (data.errors) throw new Error(data.errors[0].message)
    res.json({ ok: true, id: data.data.create_item.id })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/deals/:index/pick-folder — open native folder picker and save path to deal
app.post('/api/deals/:index/pick-folder', (req, res) => {
  try {
    const idx = parseInt(req.params.index)
    const deals = readDeals()
    if (idx < 0 || idx >= deals.length) return res.status(404).json({ error: 'Deal not found' })

    let folderPath
    if (os.platform() === 'win32') {
      const result = spawnSync('powershell', ['-STA', '-Command',
        `$s = New-Object -ComObject Shell.Application; $f = $s.BrowseForFolder(0, 'Select Deal Materials folder', 0x40, '${MATERIALS_ROOT.replace(/'/g, "''")}'); if ($f) { $f.Self.Path } else { '' }`
      ], { encoding: 'utf8', timeout: 60000 })
      folderPath = result.stdout?.trim()
    } else {
      const result = spawnSync('osascript', ['-e', `POSIX path of (choose folder with prompt "Select Deal Materials folder" default location POSIX file "${MATERIALS_ROOT}")`],
        { encoding: 'utf8', timeout: 60000 })
      folderPath = result.stdout?.trim().replace(/\/$/, '')
    }

    if (!folderPath) return res.json({ cancelled: true })

    // Store relative to Dropbox root for cross-platform compat — always with
    // forward slashes so the stored path resolves on both Windows and Mac.
    const relPath = (folderPath.startsWith(DROPBOX_RTHM) ? folderPath.slice(DROPBOX_RTHM.length).replace(/^[/\\]/, '') : folderPath).replace(/\\/g, '/')
    deals[idx].folderPath = relPath
    writeDeals(deals)
    res.json({ ok: true, folderPath })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/deals/:index/open-folder — open saved folder in Explorer/Finder.
// If the folder is genuinely missing on disk, silently clear the stale reference.
app.post('/api/deals/:index/open-folder', (req, res) => {
  try {
    const idx = parseInt(req.params.index)
    const deals = readDeals()
    if (idx < 0 || idx >= deals.length) return res.status(404).json({ error: 'Deal not found' })

    const stored = deals[idx].folderPath
    if (!stored) return res.status(400).json({ error: 'No folder saved' })
    // A Windows-absolute path can't resolve on a non-Windows machine — fail loud,
    // never clear (the link is still valid on the machine that saved it).
    if (/^[A-Za-z]:/.test(stored) && os.platform() !== 'win32') {
      return res.status(404).json({ error: 'Folder link was saved with a Windows path — re-pick the folder on this machine' })
    }
    // Legacy relative paths may carry the other platform's separators — split on both.
    const resolved = path.isAbsolute(stored) ? stored : path.join(DROPBOX_RTHM, ...stored.split(/[/\\]/).filter(Boolean))
    if (!fs.existsSync(resolved)) {
      // Gate the destructive clear: if the Materials root itself is absent, this
      // machine just hasn't synced the subtree — never clear shared links from here.
      if (!fs.existsSync(MATERIALS_ROOT)) {
        return res.status(404).json({ error: 'Deal Materials folder is not synced on this machine yet' })
      }
      return clearAndRespond404(res, deals, 'Folder no longer exists', d => { d[idx].folderPath = null })
    }

    openFile(resolved)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/deals/:index — update existing deal (re-import rows + new details)
app.put('/api/deals/:index', (req, res) => {
  try {
    const idx = parseInt(req.params.index)
    const { rows, dealType, royaltyType, commission } = req.body
    const existing = readDeals()
    if (idx < 0 || idx >= existing.length) return res.status(404).json({ error: 'Deal not found' })
    const [dealData] = buildDealData(rows)
    existing[idx] = { ...existing[idx], ...dealData, dealType: dealType || '', royaltyType: royaltyType || '', commission: commission || '' }
    writeDeals(existing)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/deals/:index/agreements
app.get('/api/deals/:index/agreements', (req, res) => {
  try {
    const idx = parseInt(req.params.index)
    const deals = readDeals()
    if (idx < 0 || idx >= deals.length) return res.status(404).json({ error: 'Deal not found' })
    const all = deals[idx].agreements || []
    const existing = all.filter(ag => resolveAgreementPath(ag))
    if (existing.length !== all.length) {
      deals[idx].agreements = existing
      writeDeals(deals)
    }
    res.json(existing)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/deals/:index/deal-sheet-tables — parse tables directly from deal sheet docx
app.get('/api/deals/:index/deal-sheet-tables', (req, res) => {
  try {
    const idx = parseInt(req.params.index)
    const deals = readDeals()
    if (idx < 0 || idx >= deals.length) return res.status(404).json({ error: 'Deal not found' })
    const deal = deals[idx]
    const dealType = deal.dealType || 'Individual'
    const agreements = deal.agreements || []

    let dealSheet
    if (dealType === 'B2B') {
      dealSheet = agreements.find(ag => ag.fileName?.toLowerCase().includes('deal sheet') && !ag.fileName?.startsWith('RTHM Deal Sheet'))
    } else {
      dealSheet = agreements.find(ag => ag.fileName?.startsWith('RTHM Deal Sheet'))
    }

    if (!dealSheet) return res.status(404).json({ error: 'No deal sheet found for this deal' })
    const dealSheetPath = resolveAgreementPath(dealSheet)
    if (!dealSheetPath) return res.status(404).json({ error: 'Deal sheet file not found on disk' })

    const content = fs.readFileSync(dealSheetPath, 'binary')
    const zip = new PizZip(content)
    const xml = zip.file('word/document.xml').asText()

    const tables = []
    const tblRegex = /<w:tbl[\s>][\s\S]*?<\/w:tbl>/g
    let tblMatch
    while ((tblMatch = tblRegex.exec(xml)) !== null) {
      const tblXml = tblMatch[0]
      const rows = []
      const trRegex = /<w:tr[\s>][\s\S]*?<\/w:tr>/g
      let trMatch
      while ((trMatch = trRegex.exec(tblXml)) !== null) {
        const trXml = trMatch[0]
        const cells = []
        const tcRegex = /<w:tc[\s>][\s\S]*?<\/w:tc>/g
        let tcMatch
        while ((tcMatch = tcRegex.exec(trXml)) !== null) {
          const tcXml = tcMatch[0]
          const texts = []
          const tRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g
          let tMatch
          while ((tMatch = tRegex.exec(tcXml)) !== null) {
            if (tMatch[1]) texts.push(tMatch[1])
          }
          cells.push(texts.join(''))
        }
        if (cells.some(c => c.trim())) rows.push(cells)
      }
      if (rows.length) tables.push(rows)
    }



    const { source, pairs } = resolveQuoteSource(deal)
    const vs = deal.valuationState || {}
    const effectiveRates = effectiveRatesFor(source, pairs, vs.rates, dealType)

    const structuredRows = []
    for (const term of ['144 months', '84 months', '60 months', '36 months', '12 months']) {
      const termIdx = TERMS_ALL.indexOf(term)
      const [advCol, recoupCol] = pairs[termIdx]
      const rasAdvance = parseFloat(source[advCol]) || 0
      const rasRecoup = parseFloat(source[recoupCol]) || 0
      // 144mo exists for only some deals — omit the row entirely when this term has no quote data.
      if (term === '144 months' && !rasAdvance && !rasRecoup) continue
      const rate = parseFloat(effectiveRates[term]) || 0
      const rthmAdvance = Math.round(rasRecoup * (rate / 100))
      const marketingBudget = Math.ceil((rasAdvance * 0.2 * 0.67) * 2.5 / 1000) * 1000

      const prAdvance = Math.round(rthmAdvance * 0.8)

      structuredRows.push({
        advanceAmount: rthmAdvance,
        recoupRate: rate,
        term,
        recoupAmount: rasRecoup,
        rasAdvance,
        marketingBudget: marketingBudget > 0 ? marketingBudget : 0,
        prAdvance,
        prTotal: prAdvance + (marketingBudget > 0 ? marketingBudget : 0),
      })
    }

    const showPR = deal.royaltyType !== 'Publishing'
    const prRows = showPR ? structuredRows.filter(r => r.prTotal > 0) : []

    res.json({ tables, rows: structuredRows, prRows, showPR })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/deals/:index/lock — save locked deal row data
app.post('/api/deals/:index/lock', (req, res) => {
  try {
    const idx = parseInt(req.params.index)
    const deals = readDeals()
    if (idx < 0 || idx >= deals.length) return res.status(404).json({ error: 'Deal not found' })
    deals[idx].lockedDeal = req.body
    writeDeals(deals)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

function readPartners() {
  try { return JSON.parse(fs.readFileSync(B2B_PARTNERS_FILE)) } catch { return {} }
}

function writePartners(data) {
  atomicWriteJson(B2B_PARTNERS_FILE, data)
}

app.get('/api/b2b-partners', (req, res) => {
  res.json(readPartners())
})

app.get('/api/b2b-partners/:name', (req, res) => {
  const partners = readPartners()
  res.json(partners[req.params.name] || {})
})

app.put('/api/b2b-partners/:name', (req, res) => {
  try {
    const partners = readPartners()
    partners[req.params.name] = req.body
    writePartners(partners)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

function fillDocx(templateFile, fields) {
  const content = fs.readFileSync(templateFile, 'binary')
  const zip = new PizZip(content)
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: '{{', end: '}}' }, nullGetter: () => '' })
  doc.render(fields)
  return doc.getZip().generate({ type: 'nodebuffer' })
}

function createDoc(templateFile, fields, outputDir, fileName) {
  if (!fs.existsSync(templateFile)) throw new Error(`Template not found: ${path.basename(templateFile)}`)
  const filledBuf = fillDocx(templateFile, fields)
  const finalPath = path.join(outputDir, fileName)
  fs.writeFileSync(finalPath, filledBuf)
  return finalPath
}

// POST /api/deals/:index/create-agreement — generate and track an agreement
app.post('/api/deals/:index/create-agreement', async (req, res) => {
  try {
    const idx = parseInt(req.params.index)
    const { type, b2bTemplate, margin, rates, commission, b2bOnly } = req.body
    const deals = readDeals()
    if (idx < 0 || idx >= deals.length) return res.status(404).json({ error: 'Deal not found' })
    const deal = deals[idx]

    if (type !== 'Deal Sheet') {
      return res.status(400).json({ error: `${type} generation not yet supported from here` })
    }

    const now = new Date()
    const dateStr = `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`

    const dealType = deal.dealType || 'Individual'
    const showPR = deal.royaltyType !== 'Publishing'

    const { source, pairs } = resolveQuoteSource(deal)
    const effectiveRates = effectiveRatesFor(source, pairs, rates, dealType)

    function fmtMoney(n) { return Math.round(n).toLocaleString('en-US') }  // no currency symbol (app-wide, incl. exports)
    function fmtPct(n) { return Number(n).toFixed(2) + '%' }  // percentages to 2 decimals (e.g. 40 → 40.00%)

    const fields = { 'Deal Name': deal.name, 'Date': dateStr, showPR }
    const b2bFields = {}
    const effectiveMargin = margin != null ? parseFloat(margin) : 0
    let has144 = false  // drives the conditional 144 row in the deal-sheet templates

    for (const [term, key] of [['144 months','144'], ['84 months','84'], ['60 months','60'], ['36 months','36'], ['12 months','12']]) {
      const termIdx = TERMS_ALL.indexOf(term)
      const [advCol, recoupCol] = pairs[termIdx]
      const rasAdvance = parseFloat(source[advCol]) || 0
      const rasRecoup = parseFloat(source[recoupCol]) || 0
      // 144mo is conditional — skip its fields (and leave has144 false) when the deal has no 144 data.
      if (term === '144 months' && !rasAdvance && !rasRecoup) continue
      if (term === '144 months') has144 = true
      const rate = parseFloat(effectiveRates[term]) || 0
      const rthmAdvance = Math.round(rasRecoup * (rate / 100))

      fields[`Term ${key}`] = term
      fields[`RTHM Advance ${key}`] = fmtMoney(rthmAdvance)
      fields[`Recoup ${key}`] = fmtPct(rate)

      const marketingBudgetRaw = (rasAdvance * 0.2 * 0.67) * 2.5
      const marketingBudget = Math.ceil(marketingBudgetRaw / 1000) * 1000
      const advanceAmount = Math.round(rthmAdvance * 0.8)
      fields[`PR Total ${key}`] = fmtMoney(advanceAmount + marketingBudget)
      fields[`PR Advance ${key}`] = fmtMoney(advanceAmount)
      fields[`Marketing ${key}`] = fmtMoney(marketingBudget)

      const b2bAdvance = Math.round(rthmAdvance * (1 - effectiveMargin / 100))
      const b2bRecoup = rasRecoup > 0 ? (b2bAdvance / rasRecoup) * 100 : 0  // unrounded → fmtPct shows true 2dp
      const b2bPRAdvance = Math.round(advanceAmount * (1 - effectiveMargin / 100))
      b2bFields[`B2B Advance ${key}`] = fmtMoney(b2bAdvance)
      b2bFields[`B2B Recoup ${key}`] = fmtPct(b2bRecoup)
      b2bFields[`B2B PR ${key}`] = fmtMoney(b2bPRAdvance)
      b2bFields[`PR Total ${key}`] = fmtMoney(b2bPRAdvance + marketingBudget)
    }
    fields['has144'] = has144  // b2b sheet spreads ...fields, so it inherits has144 too

    const sheetsToCreate = []
    if (!b2bOnly) {
      sheetsToCreate.push({
        templateFile: path.join(TEMPLATES_DIR, 'Deal Sheets', 'RTHM Deal Sheet_Template.docx'),
        fields,
        fileName: `RTHM Deal Sheet_${deal.name}.docx`,
        typeLabel: 'Deal Sheet',
      })
    }

    if (dealType === 'B2B' && b2bTemplate) {
      const cleanLabel = b2bTemplate.replace(/_?Template\.docx$/i, '').replace(/_/g, ' ').trim()
      const partner = cleanLabel.replace(/\s*Deal Sheet$/i, '').trim()
      if (partner) {
        deals[idx].b2bPartner = partner
        if (deals[idx].mondayItemId) updateMondayB2B(deals[idx].mondayItemId, partner).catch(() => {})
      }
      sheetsToCreate.push({
        templateFile: path.join(TEMPLATES_DIR, 'Deal Sheets', b2bTemplate),
        fields: { ...fields, ...b2bFields },
        fileName: `${cleanLabel}_${deal.name}.docx`,
        typeLabel: cleanLabel,
      })
    }

    if (!deals[idx].agreements) deals[idx].agreements = []
    const createdAt = new Date().toISOString()
    const created = []

    fs.mkdirSync(TEMP_AGREEMENTS_DIR, { recursive: true })
    for (const sheet of sheetsToCreate) {
      const finalPath = createDoc(sheet.templateFile, sheet.fields, TEMP_AGREEMENTS_DIR, sheet.fileName)
      const entry = { type: sheet.typeLabel, fileName: sheet.fileName, filePath: finalPath, createdAt }
      const existing = deals[idx].agreements.findIndex(ag => ag.fileName === sheet.fileName)
      if (existing !== -1) deals[idx].agreements[existing] = entry
      else deals[idx].agreements.push(entry)
      created.push(entry)
    }

    writeDeals(deals)
    res.json({ ok: true, created })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/deals/:index/agreements/:agreementIndex/open — open agreement file.
// If the .docx is genuinely missing on disk, silently remove the stale reference.
app.post('/api/deals/:index/agreements/:agreementIndex/open', (req, res) => {
  try {
    const idx = parseInt(req.params.index)
    const agreeIdx = parseInt(req.params.agreementIndex)
    const deals = readDeals()
    const agreement = deals[idx]?.agreements?.[agreeIdx]
    if (!agreement) return res.status(404).json({ error: 'Agreement not found' })
    const agreementPath = resolveAgreementPath(agreement)
    if (!agreementPath) {
      return clearAndRespond404(res, deals, 'File not found on disk', d => { d[idx].agreements.splice(agreeIdx, 1) })
    }
    openFile(agreementPath)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/deals/:index/agreements/:agreementIndex/export-pdf — convert to PDF
app.post('/api/deals/:index/agreements/:agreementIndex/export-pdf', (req, res) => {
  try {
    const idx = parseInt(req.params.index)
    const agreeIdx = parseInt(req.params.agreementIndex)
    const { isDealSheet } = req.body
    const deals = readDeals()
    if (!deals[idx]?.agreements?.[agreeIdx]) return res.status(404).json({ error: 'Agreement not found' })
    const ag = deals[idx].agreements[agreeIdx]
    const agPath = resolveAgreementPath(ag)
    if (!agPath) {
      return clearAndRespond404(res, deals, 'File not found on disk', d => { d[idx].agreements.splice(agreeIdx, 1) })
    }

    const outDir = isDealSheet
      ? DEAL_SHEETS_DIR
      : path.join(os.homedir(), 'Downloads')
    fs.mkdirSync(outDir, { recursive: true })

    const result = spawnSync(LIBRE_BIN, [
      '--headless', '--convert-to', 'pdf', '--outdir', outDir, agPath
    ], { timeout: 30000 })

    if (result.status !== 0) {
      return res.status(500).json({ error: 'PDF conversion failed: ' + (result.stderr?.toString() || 'unknown error') })
    }

    const pdfName = ag.fileName.replace(/\.docx$/i, '.pdf')
    const pdfPath = path.join(outDir, pdfName)
    res.json({ ok: true, pdfPath, pdfName })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/deals/:index/agreements/:agreementIndex — remove an agreement
app.delete('/api/deals/:index/agreements/:agreementIndex', (req, res) => {
  try {
    const idx = parseInt(req.params.index)
    const agreeIdx = parseInt(req.params.agreementIndex)
    const deals = readDeals()
    if (!deals[idx]?.agreements?.[agreeIdx]) return res.status(404).json({ error: 'Agreement not found' })
    const ag = deals[idx].agreements[agreeIdx]
    const agDelPath = resolveAgreementPath(ag)
    if (agDelPath) { try { fs.unlinkSync(agDelPath) } catch {} }

    const isOfferLetter = ag.fileName?.includes('Offer Letter')
    const isB2BRPA = ag.type === 'B2B RPA'
    const isB2BDealSheet = ag.type !== 'Deal Sheet' && ag.fileName?.toLowerCase().includes('deal sheet')

    if (isOfferLetter) delete deals[idx].lockedDeal
    if (isB2BRPA && deals[idx].lockedDeal) delete deals[idx].lockedDeal.transactionId
    if (isB2BDealSheet) delete deals[idx].b2bPartner

    deals[idx].agreements.splice(agreeIdx, 1)
    writeDeals(deals)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.patch('/api/deals/:index/b2b-partner', (req, res) => {
  try {
    const idx = parseInt(req.params.index)
    const deals = readDeals()
    if (idx < 0 || idx >= deals.length) return res.status(404).json({ error: 'Deal not found' })
    deals[idx].b2bPartner = req.body.partner
    writeDeals(deals)
    if (deals[idx].mondayItemId && req.body.partner) {
      updateMondayB2B(deals[idx].mondayItemId, req.body.partner).catch(() => {})
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.patch('/api/deals/:index/valuation-state', (req, res) => {
  try {
    const idx = parseInt(req.params.index)
    const deals = readDeals()
    if (idx < 0 || idx >= deals.length) return res.status(404).json({ error: 'Deal not found' })
    deals[idx].valuationState = req.body
    writeDeals(deals)
    if (req.body.recoupLocked && deals[idx].mondayItemId) {
      const value = deals[idx].dealType === 'B2B' ? req.body.b2bMarginRate : req.body.commission
      if (value != null) updateMondayCommission(deals[idx].mondayItemId, value).catch(() => {})
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/deals/:index — remove a deal by index
app.delete('/api/deals/:index', (req, res) => {
  try {
    const idx = parseInt(req.params.index)
    const existing = readDeals()
    if (idx < 0 || idx >= existing.length) return res.status(404).json({ error: 'Deal not found' })
    const deal = existing[idx]
    for (const ag of deal.agreements || []) {
      const p = resolveAgreementPath(ag)
      if (p) { try { fs.unlinkSync(p) } catch {} }
    }
    existing.splice(idx, 1)
    writeDeals(existing)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════
// DATA MANAGER
// ═══════════════════════════════════════════════════

// Diligence-workbook sheet matcher — SHARED by the valuate endpoint and the Data
// Manager summary builder so the two can never drift. Matches "<Platform><sep><Kind><Rep|Adj>":
//   • <sep> is a dash OR space(s); the platform group is LAZY so bare "By Track (Reported)"
//     keeps no platform (deal name is used) instead of capturing "By".
//   • <Kind>: Track/Trk → track; Source/Brkdn/Breakdown → breakdown/source.
//   • the Rep/Adj separator is optional, so glued "TrkRep" also matches.
//   Examples: "SR1 - Track Rep", "BMI-Trk Rep", "MCDONNEL-TrkRep", "Avex Trk Rep".
const SHEET_KIND_RE = /^(?:(.+?)[\s–—―\-]+)??(?:By\s+)?(Track|Trk|Source|Brkdn|Breakdown)\s*\(?(Rep|Reported|Adj|Adjusted)\)?\s*$/i
const sheetKindIsTrack = kind => /^(?:Track|Trk)$/i.test(kind)

// GET /api/data/diligence-workbook?folder=<absolute-path>
// Reads the diligence workbook produced by the `diligence` skill and returns
// cross-platform monthly aggregates for the Track Rep + Track Adj sheets.
//
// Expected layout: <folder>/<basename>_Due Diligence/<basename> - Diligence Workbook.xlsx
// Sheets matched: `<Platform> <dash> {Track Rep|Track Adj}`. Other sheets are ignored.
// Returns: { folderName, months[], tracksLine[], tracksAdjLine[] } — months is the
// chronologically-sorted union of every Track sheet's month columns across platforms.
app.get('/api/data/diligence-workbook', async (req, res) => {
  try {
    const folder = req.query.folder
    if (!folder || typeof folder !== 'string' || !fs.existsSync(folder)) {
      return res.status(400).json({ error: 'invalid folder' })
    }
    const basename = path.basename(folder)
    const ddFolder = path.join(folder, `${basename}_Due Diligence`)
    if (!fs.existsSync(ddFolder)) return res.status(404).json({ error: 'no diligence folder yet' })
    const wbPath = resolveDiligenceWorkbookPath(ddFolder, basename)
    if (!wbPath) return res.status(404).json({ error: 'no diligence workbook yet' })

    const wb = XLSX.readFile(wbPath, { cellDates: true })
    // Pass 1: group matching sheet names by platform (see SHEET_KIND_RE). Bare sheet
    // names (no platform prefix) use the deal folder name as the platform identifier.
    const platformSheets = new Map() // name -> { entries: [{isTrack, isAdj, sheetName}] }
    for (const sheetName of wb.SheetNames) {
      const m = sheetName.match(SHEET_KIND_RE)
      if (!m) continue
      const name = (m[1] || basename).trim()
      const isTrack = sheetKindIsTrack(m[2])
      const isAdj = /^Adj/i.test(m[3])
      if (!platformSheets.has(name)) platformSheets.set(name, { entries: [] })
      platformSheets.get(name).entries.push({ isTrack, isAdj, sheetName })
    }

    // Build a month series from a set of sheet refs. Each Adj sheet contributes to
    // the adj line; each Rep sheet contributes to the rep line. Months are merged
    // by YYYY-MM key across all input sheets.
    function buildSeries(entries, platformName) {
      const parseHeader = parseMonthHeaderFor(platformName)
      const byMonth = new Map()
      for (const e of entries) {
        const ws = wb.Sheets[e.sheetName]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
        if (rows.length < 3) continue
        // Header row position varies — scan top 8 rows for first with a month-parseable cell at col >= 2.
        let headerIdx = -1, colMonths = null
        for (let i = 0; i < Math.min(rows.length, 8); i++) {
          const cand = (rows[i] || []).map(parseHeader)
          if (isHeaderRow(cand, rows[i] || [])) { headerIdx = i; colMonths = cand; break }
        }
        if (headerIdx < 0) continue
        const headerLen = (rows[headerIdx] || []).length
        // Projection-section boundary detector: scan headers left→right tracking the
        // max date seen. When we encounter a date column whose key is NOT strictly
        // later than the prior max, treat that as the start of a projection section
        // and ignore columns from that point onward.
        // Used by Lomeli's workbook — it has historical columns, then a "Decay"
        // parameter column, then projected future columns that repeat (and re-set)
        // the month labels. Without this boundary, projections double-count into
        // their corresponding historical buckets, inflating recent-month values
        // and skewing TTM. Standard workbooks (strictly chronological) are unaffected.
        let projectionStartCol = headerLen
        {
          let lastKey = ''
          for (let c = 2; c < headerLen; c++) {
            const mInfo = colMonths[c]
            if (!mInfo) continue
            if (mInfo.key <= lastKey) { projectionStartCol = c; break }
            lastKey = mInfo.key
          }
        }
        for (let r = headerIdx + 1; r < rows.length; r++) {
          const row = rows[r] || []
          const label = row[0]
          if (label == null) continue
          const labelStr = String(label).trim()
          // Use the shared isAggregateRow filter — the prior narrow "^total$|^grand total$"
          // missed qualified aggregates ("Reported Total", "Adjusted Total",
          // "GRAND TOTAL (Gross Royalty)", "(a) Reported Total", "Bridge", "Less:",
          // etc.) which then got double-counted into the per-month buckets — inflating
          // Lifetime / TTM / chart values 2x+. Now consistent with the per-track pass.
          if (!labelStr || isAggregateRow(labelStr)) continue
          for (let c = 2; c < projectionStartCol; c++) {
            const mInfo = colMonths[c]
            if (!mInfo) continue
            const cell = row[c]
            const val = typeof cell === 'number' ? cell : Number(cell)
            if (!Number.isFinite(val) || val === 0) continue
            let bucket = byMonth.get(mInfo.key)
            if (!bucket) { bucket = { label: mInfo.label, rep: 0, adj: 0 }; byMonth.set(mInfo.key, bucket) }
            if (e.isAdj) bucket.adj += val
            else bucket.rep += val
          }
        }
      }
      const sorted = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))
      return {
        keys: sorted.map(([k]) => k),
        months: sorted.map(([, v]) => v.label),
        tracksLine: sorted.map(([, v]) => v.rep),
        tracksAdjLine: sorted.map(([, v]) => v.adj),
      }
    }

    // Pass 2: per-platform series — prefer Track sheets; fall back to Breakdown
    // when a platform has no Track sheets (e.g. publishing statements that lack
    // track-level data, like UMPG on Too $hort).
    const platforms = []
    for (const [name, ps] of platformSheets) {
      const trackEntries = ps.entries.filter(e => e.isTrack)
      const useEntries = trackEntries.length ? trackEntries : ps.entries
      platforms.push({ name, ...buildSeries(useEntries, name) })
    }

    // Pass 2b: statements count = number of distinct reporting periods present
    // for each platform in the diligence workbook. This is derived directly from
    // the data that drives the chart, so the count always matches what the user
    // sees graphed — "if you can draw the line, you have the statements".
    //
    // Replaces the old folder-walk heuristic, which guessed at file attribution
    // by matching platform-name tokens against file paths. That broke whenever
    // folder names didn't include the platform name (CMG → "Back Catalog (Create)",
    // quote-sourced platforms, etc.) and produced misleading "?" markers despite
    // the workbook having full data.
    for (const p of platforms) {
      p.statementsCount = (p.months || []).length
    }

    // Pass 3: combined view — union all platforms' months by YYYY-MM key, sum lines.
    const combinedByMonth = new Map()
    for (const p of platforms) {
      for (let i = 0; i < p.months.length; i++) {
        const label = p.months[i]
        const parsed = parseMonthHeader(label)
        const key = parsed ? parsed.key : label
        if (!combinedByMonth.has(key)) combinedByMonth.set(key, { label, rep: 0, adj: 0 })
        const b = combinedByMonth.get(key)
        b.rep += p.tracksLine[i] || 0
        b.adj += p.tracksAdjLine[i] || 0
      }
    }
    const combinedSorted = [...combinedByMonth.entries()].sort(([a], [b]) => a.localeCompare(b))
    const combined = {
      keys: combinedSorted.map(([k]) => k),
      months: combinedSorted.map(([, v]) => v.label),
      tracksLine: combinedSorted.map(([, v]) => v.rep),
      tracksAdjLine: combinedSorted.map(([, v]) => v.adj),
    }

    // Pass 4: per-track lifetime extraction, ranked descending, with top-80% /
    // OTHER bundle per stage 7 of v2 spec. Each track's lifetime is summed on the
    // "net paid where distinct" basis — per platform: Adj line if it differs
    // anywhere from Rep, else Rep.
    //
    // ONLY Track sheets are used for this list (not Breakdown). Brkdn sheets carry
    // DSP/category-level rows ("Apple Music", "Spotify", country names) — those
    // aren't tracks. Platforms with no Track sheets (publishing platforms like
    // UMPG) contribute to the platform/chart aggregates but not the tracks list.
    //
    // Aggregate row filter is comprehensive — the diligence workbook embeds many
    // non-track rows in the Track sheets per the v2 spec (Grand Total, Reported
    // Total, Adjusted Total, bridge lines, memo notes, source-field captions).
    // Including any of these in the tracks list double-counts (totals = sum of
    // tracks) and pollutes the ranking with non-songs. Filter must catch:
    //   • "TOTAL" / "Grand Total" / "GRAND TOTAL (Gross Royalty)" / "TOTAL — X"
    //   • "Reported Total" / "Adjusted Total" with any qualifier/parenthetical
    //   • "(a)/(b)/(c) X" lettered list prefixes
    //   • "Less: X" / "Layer N — X Stripped" / "X Stripped"
    //   • "Adjustment Bridge" / "Bridge note" / "Bridge Tie" / "Bridge per X"
    //   • "— Memo: X" / "Net Payable to Seller" / "Source field: X"
    //   • "Statement PDF total" / "Reserve Account Release"
    function trackLifetimeFromEntries(entries, platformName) {
      const parseHeader = parseMonthHeaderFor(platformName)
      const trackMap = new Map()
      for (const e of entries) {
        const ws = wb.Sheets[e.sheetName]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
        if (rows.length < 3) continue
        let headerIdx = -1, colMonths = null
        for (let i = 0; i < Math.min(rows.length, 8); i++) {
          const cand = (rows[i] || []).map(parseHeader)
          if (isHeaderRow(cand, rows[i] || [])) { headerIdx = i; colMonths = cand; break }
        }
        if (headerIdx < 0) continue
        const headerLen = (rows[headerIdx] || []).length
        // Projection boundary — see buildSeries doc.
        let projectionStartCol = headerLen
        {
          let lastKey = ''
          for (let c = 2; c < headerLen; c++) {
            const mInfo = colMonths[c]
            if (!mInfo) continue
            if (mInfo.key <= lastKey) { projectionStartCol = c; break }
            lastKey = mInfo.key
          }
        }
        for (let r = headerIdx + 1; r < rows.length; r++) {
          const row = rows[r] || []
          // Track-label extraction. Most workbooks have title in col 0 and Work ID
          // / ISRC in col 1, but some (e.g. Landstrip Chip BMI sheets) swap them
          // — col 0 holds the numeric BMI Work # and col 1 holds the title. Detect
          // this by checking if col 0 is purely digits AND col 1 is non-numeric text.
          const a0 = row[0]; const a1 = row[1]
          const s0 = a0 == null ? '' : String(a0).trim()
          const s1 = a1 == null ? '' : String(a1).trim()
          if (!s0) continue
          // 6+ digits required so short numeric titles ("22", "42") aren't mistaken for Work IDs.
          const labelStr = (/^\d{6,}$/.test(s0) && s1 && !/^\d+$/.test(s1)) ? s1 : s0
          if (!labelStr) continue
          if (isAggregateRow(labelStr)) continue
          let lifetime = 0
          let firstKey = null // first month with non-zero earnings — drives Dollar Age
          const monthly = new Map() // YYYY-MM key -> summed value (for sparkline)
          for (let c = 2; c < projectionStartCol; c++) {
            const mInfo = colMonths[c]
            if (!mInfo) continue
            const cell = row[c]
            const val = typeof cell === 'number' ? cell : Number(cell)
            if (!Number.isFinite(val)) continue
            lifetime += val
            monthly.set(mInfo.key, (monthly.get(mInfo.key) || 0) + val)
            if (val !== 0 && (!firstKey || mInfo.key < firstKey)) firstKey = mInfo.key
          }
          if (lifetime !== 0) {
            const existing = trackMap.get(labelStr) || { lifetime: 0, firstKey: null, monthly: new Map() }
            existing.lifetime += lifetime
            if (firstKey && (!existing.firstKey || firstKey < existing.firstKey)) {
              existing.firstKey = firstKey
            }
            for (const [k, v] of monthly) existing.monthly.set(k, (existing.monthly.get(k) || 0) + v)
            trackMap.set(labelStr, existing)
          }
        }
      }
      return trackMap
    }

    // Dollar Age helper — years between the track's first earning month and "now".
    // Anchors to today's calendar date so the age advances naturally over time.
    // Returns null when firstKey is missing (track never had a non-zero month).
    const now = new Date()
    function ageYearsFromKey(key) {
      if (!key) return null
      const [y, m] = key.split('-').map(Number)
      if (!Number.isFinite(y) || !Number.isFinite(m)) return null
      const months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m)
      return Math.max(0, months / 12)
    }

    // Per-track TTM — sum of monthly values within the 12 months ending at
    // `lastKey` (the latest data month for this scope: combined or platform).
    // Anchored to a shared window so all tracks in a view are comparable.
    function ttmFromMonthly(monthly, lastKey) {
      if (!lastKey) return 0
      const [ly, lm] = lastKey.split('-').map(Number)
      let sm = lm - 11, sy = ly
      while (sm <= 0) { sm += 12; sy -= 1 }
      const startKey = `${sy}-${String(sm).padStart(2, '0')}`
      let sum = 0
      for (const [k, v] of monthly) {
        if (k >= startKey && k <= lastKey) sum += v
      }
      return sum
    }

    // Per-track Decay Rate — simple arithmetic mean of period-to-period decay
    // rates for the track. For each pair of consecutive entries in the track's
    // own time series, compute (1 - curr/prev) and average them. Positive
    // average = revenue decays on average per period; negative = grows.
    // Skips pairs where prev = 0 (decay undefined when starting from zero) —
    // covers track-debut periods and dormant→active transitions.
    // Returns null when there are no valid pairs.
    function decayRateFromMonthly(monthly) {
      const entries = [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      if (entries.length < 2) return null
      const rates = []
      for (let i = 1; i < entries.length; i++) {
        const prev = entries[i - 1][1]
        const curr = entries[i][1]
        if (prev > 0) rates.push(1 - (curr / prev))
      }
      if (rates.length === 0) return null
      return rates.reduce((s, r) => s + r, 0) / rates.length
    }

    // Reusable: take a Map<label, {lifetime, firstKey, monthly}> + an axis key
    // array and produce the { tracks, other, dealLifetime, dollarAge } shape
    // used by both the combined view and each per-platform view.
    function buildTracksOutput(trackMap, axisKeys) {
      const lastKey = axisKeys.length > 0 ? axisKeys[axisKeys.length - 1] : null
      const sortedTracks = [...trackMap.entries()]
        .map(([label, info]) => ({ label, lifetime: info.lifetime, firstKey: info.firstKey, monthly: info.monthly }))
        .filter(t => t.lifetime > 0)
        .sort((a, b) => b.lifetime - a.lifetime)
      const dealLifetime = sortedTracks.reduce((s, t) => s + t.lifetime, 0)
      const tracksTop = []
      const tracksOtherRaw = []
      if (dealLifetime > 0) {
        let cum = 0
        let cumReached = false
        for (const t of sortedTracks) {
          if (cumReached) { tracksOtherRaw.push(t); continue }
          tracksTop.push(t)
          cum += t.lifetime
          if (cum / dealLifetime >= 0.80) cumReached = true
        }
      }
      const lineFor = t => axisKeys.map(k => t.monthly.get(k) || 0)
      const tracks = tracksTop.map(t => ({
        label: t.label,
        lifetime: t.lifetime,
        pctOfLtv: dealLifetime > 0 ? t.lifetime / dealLifetime : 0,
        ageYears: ageYearsFromKey(t.firstKey),
        ttm: ttmFromMonthly(t.monthly, lastKey),
        decayRate: decayRateFromMonthly(t.monthly),
        line: lineFor(t),
      }))
      const otherTotal = tracksOtherRaw.reduce((s, t) => s + t.lifetime, 0)
      const otherAvgAge = (() => {
        const ages = tracksOtherRaw.map(t => ageYearsFromKey(t.firstKey)).filter(a => a != null)
        return ages.length > 0 ? ages.reduce((s, a) => s + a, 0) / ages.length : null
      })()
      // OTHER's TTM = sum of tail tracks' TTMs in the same window.
      const otherTtm = tracksOtherRaw.reduce((s, t) => s + ttmFromMonthly(t.monthly, lastKey), 0)
      // OTHER's Decay Rate = simple average of tail tracks' rates (skip nulls).
      const otherDecays = tracksOtherRaw.map(t => decayRateFromMonthly(t.monthly)).filter(r => r != null)
      const otherDecayRate = otherDecays.length > 0 ? otherDecays.reduce((s, r) => s + r, 0) / otherDecays.length : null
      const otherLine = axisKeys.map(k => tracksOtherRaw.reduce((s, t) => s + (t.monthly.get(k) || 0), 0))
      const other = tracksOtherRaw.length > 0 ? {
        label: `OTHER (${tracksOtherRaw.length} track${tracksOtherRaw.length === 1 ? '' : 's'})`,
        lifetime: otherTotal,
        pctOfLtv: dealLifetime > 0 ? otherTotal / dealLifetime : 0,
        componentCount: tracksOtherRaw.length,
        ageYears: otherAvgAge,
        ttm: otherTtm,
        decayRate: otherDecayRate,
        line: otherLine,
      } : null
      // Catalog-level Dollar Age — simple unweighted average of every track's age.
      const allAges = sortedTracks.map(t => ageYearsFromKey(t.firstKey)).filter(a => a != null)
      const dollarAge = allAges.length > 0 ? allAges.reduce((s, a) => s + a, 0) / allAges.length : null
      return { tracks, other, dealLifetime, dollarAge }
    }

    // Per-platform track maps + the combined map. Iterate each platform once,
    // run trackLifetimeFromEntries scoped to that platform's relevant sheets,
    // and merge into the combined aggregate.
    const allTrackLifetimes = new Map() // combined: label -> { lifetime, firstKey, monthly }
    const tracksByPlatformMap = new Map() // platformName -> Map<label, {lifetime, firstKey, monthly}>
    for (const [name, ps] of platformSheets) {
      const trackOnly = ps.entries.filter(e => e.isTrack)
      if (trackOnly.length === 0) continue // Brkdn-only platforms not eligible for track list
      const platform = platforms.find(p => p.name === name)
      const matches = platform.tracksLine.length === platform.tracksAdjLine.length
        && platform.tracksLine.every((v, i) => v === platform.tracksAdjLine[i])
      const wantAdj = !matches
      let relevant = trackOnly.filter(e => e.isAdj === wantAdj)
      if (relevant.length === 0) relevant = trackOnly.filter(e => e.isAdj === false)
      if (relevant.length === 0) relevant = trackOnly
      const platformTracks = trackLifetimeFromEntries(relevant, name)
      tracksByPlatformMap.set(name, platformTracks)
      for (const [label, info] of platformTracks) {
        const existing = allTrackLifetimes.get(label) || { lifetime: 0, firstKey: null, monthly: new Map() }
        existing.lifetime += info.lifetime
        if (info.firstKey && (!existing.firstKey || info.firstKey < existing.firstKey)) {
          existing.firstKey = info.firstKey
        }
        for (const [k, v] of info.monthly) existing.monthly.set(k, (existing.monthly.get(k) || 0) + v)
        allTrackLifetimes.set(label, existing)
      }
    }

    // Combined view — uses combined.keys as the axis.
    const combinedOutput = buildTracksOutput(allTrackLifetimes, combined.keys)
    const tracks = combinedOutput.tracks
    const other = combinedOutput.other
    const dealLifetime = combinedOutput.dealLifetime
    const dollarAge = combinedOutput.dollarAge

    // Per-platform views — each uses its own platform's month-key axis so the
    // sparkline shape reflects that platform's reporting cadence, not the
    // padded combined timeline.
    const tracksByPlatform = {}
    for (const [name, trackMap] of tracksByPlatformMap) {
      // Build the platform's axis from the union of its own track months.
      // (Equivalent to the platform's reported months in chronological order.)
      const platformKeySet = new Set()
      for (const info of trackMap.values()) {
        for (const k of info.monthly.keys()) platformKeySet.add(k)
      }
      const platformAxisKeys = [...platformKeySet].sort()
      tracksByPlatform[name] = buildTracksOutput(trackMap, platformAxisKeys)
    }

    res.json({ folderName: basename, platforms, combined, tracks, other, dealLifetime, dollarAge, tracksByPlatform })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Parse a Track sheet's column header cell into a sort key + display label.
// Accepts Date objects (cellDates: true), "YYYY-MM[-DD]", "M/YYYY", "MMM YYYY", etc.
// Returns null for non-month cells (the row-label col, the ISRC col, the LTM Total col, blanks).
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_MAP = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 }
function parseMonthHeader(v) {
  if (v == null || v === '') return null
  if (v instanceof Date && !isNaN(v)) {
    const y = v.getFullYear(), mo = v.getMonth() + 1
    return { key: `${y}-${String(mo).padStart(2,'0')}`, label: `${MONTH_NAMES[mo-1]} ${y}` }
  }
  const s = String(v).trim()
  if (!s || /ltm/i.test(s)) return null
  // YYYY-MM or YYYY/MM (optional -DD)
  let m = s.match(/^(\d{4})[-/](\d{1,2})/)
  if (m) return { key: `${m[1]}-${m[2].padStart(2,'0')}`, label: s }
  // M/YYYY or MM-YYYY
  m = s.match(/^(\d{1,2})[-/](\d{4})$/)
  if (m) return { key: `${m[2]}-${m[1].padStart(2,'0')}`, label: s }
  // M/YY or MM/YY — 2-digit year => 20yy
  m = s.match(/^(\d{1,2})[-/](\d{2})$/)
  if (m) return { key: `20${m[2]}-${m[1].padStart(2,'0')}`, label: s }
  // MMM YYYY / MMM-YYYY / MMM-YY (e.g. "Aug 2025", "Aug-21" — 2-digit year => 20yy)
  m = s.match(/^([A-Za-z]+)[-\s]+(\d{2}|\d{4})$/)
  if (m) {
    const mo = MONTH_MAP[m[1].slice(0,3).toLowerCase()]
    if (mo) {
      const yr = m[2].length === 4 ? m[2] : `20${m[2]}`
      return { key: `${yr}-${String(mo).padStart(2,'0')}`, label: s }
    }
  }
  // MMMyy / MMMyyyy — no separator (e.g. "Aug25", "Aug2025"); optional trailing apostrophe ("Aug22'").
  m = s.match(/^([A-Za-z]+)(\d{2,4})['’]?$/)
  if (m) {
    const mo = MONTH_MAP[m[1].slice(0,3).toLowerCase()]
    if (mo) {
      const yr = m[2].length === 4 ? m[2] : `20${m[2]}`
      return { key: `${yr}-${String(mo).padStart(2,'0')}`, label: s }
    }
  }
  // Quarterly: Q1-25, Q1 25, Q1/25, Q1'25, Q1-2025, Q12025, 1Q25, 1Q2025, etc.
  // Each quarter anchors to its START month so the YYYY-MM key sorts correctly and
  // the bucket spacing is meaningful (Q1→Jan, Q2→Apr, Q3→Jul, Q4→Oct).
  // The graph displays one point per reporting period (no interpolation across the
  // gap months) — quarterly deals naturally show ~4 points/year, semi-annual ~2/year.
  m = s.match(/^Q([1-4])['’\-/\s]*(\d{2,4})$/i) || s.match(/^([1-4])Q(\d{2,4})$/i)
  if (m) {
    const q = Number(m[1])
    const startMo = (q - 1) * 3 + 1
    const yr = m[2].length === 4 ? m[2] : `20${m[2]}`
    return { key: `${yr}-${String(startMo).padStart(2,'0')}`, label: s }
  }
  // Year-first quarterly: 2023Q1, 23Q1 (year then quarter). Same START-month anchor.
  m = s.match(/^(\d{2,4})Q([1-4])$/i)
  if (m) {
    const startMo = (Number(m[2]) - 1) * 3 + 1
    const yr = m[1].length === 4 ? m[1] : `20${m[1]}`
    return { key: `${yr}-${String(startMo).padStart(2,'0')}`, label: s }
  }
  // Half-yearly (semi-annual): 22H1 / 2022H1 (year-first) or H1-22 / H1 2022 (H-first).
  // H1 anchors to Jan, H2 to Jul (start month) — same convention as quarters.
  m = s.match(/^(\d{2,4})\s*H([12])$/i)
  if (m) {
    const yr = m[1].length === 4 ? m[1] : `20${m[1]}`
    return { key: `${yr}-${m[2] === '1' ? '01' : '07'}`, label: s }
  }
  m = s.match(/^H([12])['’\-/\s]*(\d{2,4})$/i)
  if (m) {
    const yr = m[2].length === 4 ? m[2] : `20${m[2]}`
    return { key: `${yr}-${m[1] === '1' ? '01' : '07'}`, label: s }
  }
  // Half-first half-yearly: 1H23 / 2H2024 (half then year). Same start-month anchor.
  m = s.match(/^([12])H(\d{2,4})$/i)
  if (m) {
    const yr = m[2].length === 4 ? m[2] : `20${m[2]}`
    return { key: `${yr}-${m[1] === '1' ? '01' : '07'}`, label: s }
  }
  // Annual: bare calendar year (2015) or fiscal year (FY2023 / FY 23). Anchor to Jan.
  m = s.match(/^((?:19|20)\d{2})$/)
  if (m) return { key: `${m[1]}-01`, label: s }
  m = s.match(/^FY\s?(\d{2}|\d{4})$/i)
  if (m) { const yr = m[1].length === 4 ? m[1] : `20${m[1]}`; return { key: `${yr}-01`, label: s } }
  return null
}

// Platform-prefixed period headers ("BMI 22Q1", "Pulse 23H1") — some workbooks
// repeat the sheet's platform name in every period column. Returns a parser that
// first tries the raw header, then retries with the platform prefix stripped.
// Anchored formats in parseMonthHeader keep this safe: "BMI Total" strips to
// "Total" which still parses to null, and already-parseable headers never strip.
function parseMonthHeaderFor(platformName) {
  const esc = String(platformName || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const prefixRe = esc ? new RegExp(`^${esc}[\\s–—―\\-]+`, 'i') : null
  return v => {
    const direct = parseMonthHeader(v)
    if (direct || !prefixRe || typeof v !== 'string') return direct
    const stripped = v.replace(prefixRe, '')
    return stripped === v ? null : parseMonthHeader(stripped)
  }
}

// A row is a period-header row if it has >=2 parseable period cells at col>=2, OR
// exactly one that is a STRONG (non-bare-year) format. Admits single-period sheets
// ("Dec23") and multi-year annual headers, while rejecting a lone stray year in a
// data row (a bare "2011" among royalty values). MUST stay identical to isHeaderRow
// in server/data-manager/pivot.js.
function isHeaderRow(cand, row) {
  const idxs = []
  for (let i = 2; i < cand.length; i++) if (cand[i]) idxs.push(i)
  if (idxs.length >= 2) return true
  if (idxs.length === 1) {
    const raw = row[idxs[0]] == null ? '' : String(row[idxs[0]]).trim()
    return !/^(?:FY\s?)?(?:19|20)\d{2}$/i.test(raw)
  }
  return false
}

// Shared aggregate-row filter — used by Valuate's track extraction AND
// the Data Manager summary's track-count pass. See full doc in the
// diligence-workbook handler for the exhaustive pattern coverage rationale.
function isAggregateRow(label) {
  const s = String(label).trim()
  if (!s) return true
  if (/\btotal\b/i.test(s)) return true
  if (/\bbridge\b/i.test(s)) return true
  if (/\bless:\s/i.test(s)) return true
  if (/^layer\s+\d/i.test(s)) return true
  if (/\bstripped\b/i.test(s)) return true
  if (/^net\s+payable/i.test(s)) return true
  if (/^—?\s*memo\b/i.test(s)) return true
  if (/^source\s+field\s*:/i.test(s)) return true
  if (/^statement\s+pdf/i.test(s)) return true
  if (/^reserve\s+account/i.test(s)) return true
  if (/^\([a-z]\)\s+(reported|adjusted|less:)/i.test(s)) return true
  return false
}

// Lightweight per-deal summary used by /api/data/folders to populate the Data
// Manager's sparkline / Lifetime / TTM / Tracks / Top80% columns. Reads the
// deal's diligence workbook, builds the combined revenue series + per-track
// rankings across all platforms, returns the line shape + headline totals +
// track counts. Uses the adjusted-revenue line when it differs from reported
// (matches Valuate page's auto-choose rule), else uses reported.
// Returns null when there's no workbook (frontend renders cells as "—").
//
// Cached in-memory by workbook mtime — re-reading + parsing every xlsx on
// every /api/data/folders call was the cause of slow Data Manager mounts.
// A quick fs.statSync (microseconds) gates the expensive XLSX.readFile.
// Resolves the diligence workbook path inside `_Due Diligence/`. Most deals use the
// canonical `<basename> - Diligence Workbook.xlsx`. Some legacy deals use variants
// (`Hirschmann DD Workbook.xlsx`, `Lambo4oe_Catalog_Diligence_Workbook.xlsx`). We
// accept any xlsx in the diligence folder whose name contains "workbook", except
// the by-statement variant (which is a sibling artifact, not the primary workbook).
// Returns null if no candidate found.
function resolveDiligenceWorkbookPath(ddFolder, basename) {
  try {
    const canonical = path.join(ddFolder, `${basename} - Diligence Workbook.xlsx`)
    if (fs.existsSync(canonical)) return canonical
    const candidates = fs.readdirSync(ddFolder)
      .filter(f => /\.xlsx$/i.test(f))
      .filter(f => !f.startsWith('~$'))
      .filter(f => /workbook/i.test(f))
      .filter(f => !/by[-_\s]statement/i.test(f))
      .sort((a, b) => a.length - b.length) // prefer closest-to-canonical
    if (candidates.length === 0) return null
    return path.join(ddFolder, candidates[0])
  } catch (e) { console.warn('[resolveDiligenceWorkbookPath]', ddFolder, e.message); return null }
}
const summaryCache = new Map() // wbPath -> { mtimeMs, summary }
function computeWorkbookSummary(folder) {
  try {
    const basename = path.basename(folder)
    const ddFolder = path.join(folder, `${basename}_Due Diligence`)
    if (!fs.existsSync(ddFolder)) return null
    const wbPath = resolveDiligenceWorkbookPath(ddFolder, basename)
    if (!wbPath) return null
    const mtimeMs = fs.statSync(wbPath).mtimeMs
    const cached = summaryCache.get(wbPath)
    if (cached && cached.mtimeMs === mtimeMs) return cached.summary
    const summary = computeWorkbookSummaryInner(wbPath, basename)
    summaryCache.set(wbPath, { mtimeMs, summary })
    return summary
  } catch (e) { console.warn('[computeWorkbookSummary]', folder, e.message); return null }
}
// Does a diligence workbook physically exist for this folder? This is the source of truth
// for the Data Manager "Diligence" ✓ — independent of whether computeWorkbookSummary can
// PARSE it. Some workbooks produced by the diligence skill use sheet-naming variants the
// summary parser doesn't recognize yet (e.g. "BMI-Trk Rep", "Kurate – Trk Rep"), but
// diligence WAS done — so they must still show ✓. A fresh fs check runs every request, so
// the status is always current on page load. (Summary still drives the data columns.)
function diligenceWorkbookExists(folder) {
  try {
    const basename = path.basename(folder)
    const ddFolder = path.join(folder, `${basename}_Due Diligence`)
    if (!fs.existsSync(ddFolder)) return false
    return resolveDiligenceWorkbookPath(ddFolder, basename) != null
  } catch { return false }
}
function computeWorkbookSummaryInner(wbPath, dealName) {
  try {
    const wb = XLSX.readFile(wbPath, { cellDates: true })
    const platformSheets = new Map()
    for (const sheetName of wb.SheetNames) {
      const m = sheetName.match(SHEET_KIND_RE)
      if (!m) continue
      const name = (m[1] || dealName).trim()
      const isTrack = sheetKindIsTrack(m[2])
      const isAdj = /^Adj/i.test(m[3])
      if (!platformSheets.has(name)) platformSheets.set(name, { entries: [] })
      platformSheets.get(name).entries.push({ isTrack, isAdj, sheetName })
    }
    function buildSeries(entries, platformName) {
      const parseHeader = parseMonthHeaderFor(platformName)
      const byMonth = new Map()
      for (const e of entries) {
        const ws = wb.Sheets[e.sheetName]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
        if (rows.length < 3) continue
        let headerIdx = -1, colMonths = null
        for (let i = 0; i < Math.min(rows.length, 8); i++) {
          const cand = (rows[i] || []).map(parseHeader)
          if (isHeaderRow(cand, rows[i] || [])) { headerIdx = i; colMonths = cand; break }
        }
        if (headerIdx < 0) continue
        const headerLen = (rows[headerIdx] || []).length
        // Projection-section boundary — see full doc in Valuate handler's buildSeries.
        let projectionStartCol = headerLen
        {
          let lastKey = ''
          for (let c = 2; c < headerLen; c++) {
            const mInfo = colMonths[c]
            if (!mInfo) continue
            if (mInfo.key <= lastKey) { projectionStartCol = c; break }
            lastKey = mInfo.key
          }
        }
        for (let r = headerIdx + 1; r < rows.length; r++) {
          const row = rows[r] || []
          const label = row[0]
          if (label == null) continue
          const labelStr = String(label).trim()
          // Use the shared isAggregateRow filter — the prior narrow "^total$|^grand total$"
          // missed qualified aggregates ("Reported Total", "Adjusted Total",
          // "GRAND TOTAL (Gross Royalty)", "(a) Reported Total", "Bridge", "Less:",
          // etc.) which then got double-counted into the per-month buckets — inflating
          // Lifetime / TTM / chart values 2x+. Now consistent with the per-track pass.
          if (!labelStr || isAggregateRow(labelStr)) continue
          for (let c = 2; c < projectionStartCol; c++) {
            const mInfo = colMonths[c]
            if (!mInfo) continue
            const cell = row[c]
            const val = typeof cell === 'number' ? cell : Number(cell)
            if (!Number.isFinite(val) || val === 0) continue
            let bucket = byMonth.get(mInfo.key)
            if (!bucket) { bucket = { label: mInfo.label, rep: 0, adj: 0 }; byMonth.set(mInfo.key, bucket) }
            if (e.isAdj) bucket.adj += val
            else bucket.rep += val
          }
        }
      }
      const sorted = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))
      return {
        keys: sorted.map(([k]) => k),
        months: sorted.map(([, v]) => v.label),
        rep: sorted.map(([, v]) => v.rep),
        adj: sorted.map(([, v]) => v.adj),
      }
    }
    const platforms = []
    for (const [name, ps] of platformSheets) {
      const trackEntries = ps.entries.filter(e => e.isTrack)
      const useEntries = trackEntries.length ? trackEntries : ps.entries
      platforms.push({ name, ...buildSeries(useEntries, name) })
    }
    if (platforms.length === 0) return null
    // Combined view by month key. Choose rep vs adj PER PLATFORM (not globally) — this mirrors the
    // per-platform basis the track walk below uses (platMatches -> wantAdj -> rep fallback). A
    // workbook can mix accounts that have Adj sheets with accounts that have only Rep sheets (e.g.
    // OwnBoss): a single global adjLine drops the rep-only accounts to zero, and an all-Rep workbook
    // (e.g. State Of Mine) zeroes out entirely. Per platform: take the adjusted line only when that
    // platform actually has adjusted data that differs from reported; otherwise reported. Keeps the
    // combined line consistent with the per-track lifetimes computed below.
    const combinedByMonth = new Map()
    let anyAdjUsed = false
    for (const p of platforms) {
      const platAdjHasData = p.adj.some(v => v !== 0)
      const platMatches = p.rep.length === p.adj.length && p.rep.every((v, i) => v === p.adj[i])
      const platUseAdj = platAdjHasData && !platMatches
      if (platUseAdj) anyAdjUsed = true
      const chosen = platUseAdj ? p.adj : p.rep
      for (let i = 0; i < p.keys.length; i++) {
        const key = p.keys[i]
        combinedByMonth.set(key, (combinedByMonth.get(key) || 0) + (chosen[i] || 0))
      }
    }
    const combinedSorted = [...combinedByMonth.entries()].sort(([a], [b]) => a.localeCompare(b))
    if (combinedSorted.length === 0) return null
    const keys = combinedSorted.map(([k]) => k)
    const line = combinedSorted.map(([, v]) => v)
    const lifetime = line.reduce((s, v) => s + v, 0)
    // TTM = trailing 12 calendar months anchored on the latest data month
    let ttm = lifetime
    const lastKey = keys[keys.length - 1]
    const [ly, lm] = lastKey.split('-').map(Number)
    const firstKey = keys[0]
    const [fy, fm] = firstKey.split('-').map(Number)
    const totalMonths = (ly - fy) * 12 + (lm - fm) + 1
    if (totalMonths >= 12) {
      let sm = lm - 11, sy = ly
      while (sm <= 0) { sm += 12; sy -= 1 }
      const ttmStartKey = `${sy}-${String(sm).padStart(2, '0')}`
      ttm = 0
      for (let i = 0; i < keys.length; i++) {
        if (keys[i] >= ttmStartKey && keys[i] <= lastKey) ttm += line[i] || 0
      }
    }

    // Track counts — mirrors the per-track extraction in /api/data/diligence-workbook.
    // trackCount = total distinct tracks with non-zero lifetime across all platforms
    //              (Track sheets only; Brkdn-only platforms contribute nothing).
    // top80Count = number of those tracks whose cumulative lifetime reaches 80% of
    //              total deal lifetime (rest get bundled as OTHER on the Valuate page).
    const trackTotals = new Map() // label -> summed lifetime across platforms
    for (const [name, ps] of platformSheets) {
      const trackOnly = ps.entries.filter(e => e.isTrack)
      if (trackOnly.length === 0) continue
      // Pick adj vs rep at the platform level — match Valuate's auto-choose rule.
      const p = platforms.find(x => x.name === name)
      const platMatches = p && p.rep.length === p.adj.length && p.rep.every((v, i) => v === p.adj[i])
      const wantAdj = !platMatches
      let relevant = trackOnly.filter(e => e.isAdj === wantAdj)
      if (relevant.length === 0) relevant = trackOnly.filter(e => !e.isAdj)
      if (relevant.length === 0) relevant = trackOnly
      const parseHeader = parseMonthHeaderFor(name)
      for (const e of relevant) {
        const ws = wb.Sheets[e.sheetName]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
        let headerIdx = -1, colMonths = null
        for (let i = 0; i < Math.min(rows.length, 8); i++) {
          const cand = (rows[i] || []).map(parseHeader)
          if (isHeaderRow(cand, rows[i] || [])) { headerIdx = i; colMonths = cand; break }
        }
        if (headerIdx < 0) continue
        const headerLen = (rows[headerIdx] || []).length
        // Projection boundary — see buildSeries doc.
        let projectionStartCol = headerLen
        {
          let lastKey = ''
          for (let c = 2; c < headerLen; c++) {
            const mInfo = colMonths[c]
            if (!mInfo) continue
            if (mInfo.key <= lastKey) { projectionStartCol = c; break }
            lastKey = mInfo.key
          }
        }
        for (let r = headerIdx + 1; r < rows.length; r++) {
          const row = rows[r] || []
          // Track-label extraction with swapped-column heuristic — see same logic
          // in /api/data/diligence-workbook for context (Landstrip Chip case).
          const a0 = row[0]; const a1 = row[1]
          const s0 = a0 == null ? '' : String(a0).trim()
          const s1 = a1 == null ? '' : String(a1).trim()
          if (!s0) continue
          // 6+ digits required so short numeric titles ("22", "42") aren't mistaken for Work IDs.
          const labStr = (/^\d{6,}$/.test(s0) && s1 && !/^\d+$/.test(s1)) ? s1 : s0
          if (!labStr || isAggregateRow(labStr)) continue
          let life = 0
          let firstKey = null
          for (let c = 2; c < projectionStartCol; c++) {
            const mInfo = colMonths[c]
            if (!mInfo) continue
            const v = row[c]
            const num = typeof v === 'number' ? v : Number(v)
            if (!Number.isFinite(num)) continue
            life += num
            if (num !== 0 && (!firstKey || mInfo.key < firstKey)) firstKey = mInfo.key
          }
          if (life !== 0) {
            const existing = trackTotals.get(labStr) || { lifetime: 0, firstKey: null }
            existing.lifetime += life
            if (firstKey && (!existing.firstKey || firstKey < existing.firstKey)) {
              existing.firstKey = firstKey
            }
            trackTotals.set(labStr, existing)
          }
        }
      }
    }
    const trackInfos = [...trackTotals.values()].filter(t => t.lifetime > 0)
    const ranked = trackInfos.map(t => t.lifetime).sort((a, b) => b - a)
    const trackCount = ranked.length
    const dealLife = ranked.reduce((s, v) => s + v, 0)
    let top80Count = 0
    if (dealLife > 0) {
      let cum = 0
      for (const v of ranked) {
        top80Count += 1
        cum += v
        if (cum / dealLife >= 0.80) break
      }
    }
    // Catalog Dollar Age — simple unweighted average of per-track ages (years
    // from each track's first non-zero earning month to today). Matches the
    // Valuate-page convention. Tracks with no firstKey are skipped.
    const now = new Date()
    function ageY(key) {
      if (!key) return null
      const [y, m] = key.split('-').map(Number)
      if (!Number.isFinite(y) || !Number.isFinite(m)) return null
      return Math.max(0, ((now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m)) / 12)
    }
    const ages = trackInfos.map(t => ageY(t.firstKey)).filter(a => a != null)
    const dollarAge = ages.length > 0 ? ages.reduce((s, a) => s + a, 0) / ages.length : null

    return { line, lifetime, ttm, hasAdj: anyAdjUsed, trackCount, top80Count, dollarAge, keys, trackInfos: [...trackTotals.values()] }
  } catch { return null }
}

// --- Container-folder support (Data Manager) ---------------------------------------------------
// A top-level "!"-prefixed folder is a CONTAINER: a collection of catalog subfolders, shown as one
// row whose data columns are a rollup of its catalogs and whose skill columns show X/N done.

// Immediate subdirectories of a folder, as absolute paths.
function listSubdirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => path.join(dir, e.name))
  } catch { return [] }
}

// The three skill flags that drive a catalog row's ✓/? marks — single source of truth so the
// catalog rows and the container child-counts can't drift.
function folderSkillFlags(folderPath) {
  const name = path.basename(folderPath)
  let hasExtract = false
  try {
    hasExtract = fs.readdirSync(folderPath, { withFileTypes: true })
      .some(s => s.isDirectory() && s.name.toLowerCase().endsWith('_data engine'))
  } catch {}
  const hasQuote = fs.existsSync(path.join(folderPath, `${name} - Quote.xlsx`))
  const hasDiligence = diligenceWorkbookExists(folderPath)
  return { hasDiligence, hasExtract, hasQuote }
}

// Strip the internal rollup fields (keys, trackInfos) before sending a summary to the client.
function publicSummary(s) {
  if (!s) return null
  const { line, lifetime, ttm, hasAdj, trackCount, top80Count, dollarAge } = s
  return { line, lifetime, ttm, hasAdj, trackCount, top80Count, dollarAge }
}

// Roll a container's child catalogs up into ONE virtual mega-catalog: sum the per-month series by
// calendar month and concat every per-track record, then run the SAME aggregation that
// computeWorkbookSummaryInner uses. The TTM + track formulas below MIRROR that function — keep them
// in sync if the single-deal aggregation ever changes.
function computeContainerRollup(childPaths) {
  const monthMap = new Map()
  let allTracks = []
  let contributing = 0
  for (const child of childPaths) {
    const s = computeWorkbookSummary(child)
    if (!s || !Array.isArray(s.keys)) continue
    contributing += 1
    for (let i = 0; i < s.keys.length; i++) {
      monthMap.set(s.keys[i], (monthMap.get(s.keys[i]) || 0) + (s.line[i] || 0))
    }
    if (Array.isArray(s.trackInfos)) allTracks = allTracks.concat(s.trackInfos)
  }
  if (contributing === 0) return null

  // Monthly: line / lifetime / TTM (trailing 12 calendar months on the merged series).
  const keys = [...monthMap.keys()].sort((a, b) => a.localeCompare(b))
  const line = keys.map(k => monthMap.get(k))
  const lifetime = line.reduce((sum, v) => sum + v, 0)
  let ttm = lifetime
  if (keys.length) {
    const lastKey = keys[keys.length - 1]
    const [ly, lm] = lastKey.split('-').map(Number)
    const [fy, fm] = keys[0].split('-').map(Number)
    if ((ly - fy) * 12 + (lm - fm) + 1 >= 12) {
      let sm = lm - 11, sy = ly
      while (sm <= 0) { sm += 12; sy -= 1 }
      const ttmStartKey = `${sy}-${String(sm).padStart(2, '0')}`
      ttm = 0
      for (let i = 0; i < keys.length; i++) {
        if (keys[i] >= ttmStartKey && keys[i] <= lastKey) ttm += line[i] || 0
      }
    }
  }

  // Tracks: count / top-80% / dollar-age over the combined track set.
  const live = allTracks.filter(t => t && t.lifetime > 0)
  const ranked = live.map(t => t.lifetime).sort((a, b) => b - a)
  const trackCount = ranked.length
  const dealLife = ranked.reduce((sum, v) => sum + v, 0)
  let top80Count = 0
  if (dealLife > 0) {
    let cum = 0
    for (const v of ranked) { top80Count += 1; cum += v; if (cum / dealLife >= 0.80) break }
  }
  const now = new Date()
  const ages = live.map(t => {
    if (!t.firstKey) return null
    const [y, m] = t.firstKey.split('-').map(Number)
    if (!Number.isFinite(y) || !Number.isFinite(m)) return null
    return Math.max(0, ((now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m)) / 12)
  }).filter(a => a != null)
  const dollarAge = ages.length > 0 ? ages.reduce((sum, a) => sum + a, 0) / ages.length : null

  return { line, lifetime, ttm, trackCount, top80Count, dollarAge }
}

// POST /api/data/open-folder — open a folder in the OS file browser.
// Body: { key: 'current' | 'materials-root' } OR { path: '<absolute-path>' }
// Used by:
//   - Data Manager's Import Data button (key: 'current')
//   - Data Manager's folder-name right-click (path: <folder path>)
//   - Deal Manager's Deal Materials unlinked button (key: 'materials-root')
// When `path` is supplied, it's resolved and must live inside DATA_ROOT (security guard).
// Projection params storage — one JSON per deal folder at
// `<folder>/<folder>_Projection.json`. Shape:
//   { catalogDefaults: {...} | null, trackOverrides: { [trackLabel]: {...} } }
// `chart:total` and `chart:adjusted` graphIds both write to catalogDefaults
// (they represent the same catalog projection from different views).
// `track:<label>` writes to trackOverrides[label].
function projectionJsonPathFor(folderPath) {
  const folderName = path.basename(folderPath)
  return path.join(folderPath, `${folderName}_Projection.json`)
}

app.get('/api/data/projection-params', (req, res) => {
  const folder = req.query.folder
  if (!folder || typeof folder !== 'string') return res.status(400).json({ error: 'folder required' })
  if (!fs.existsSync(folder)) return res.status(404).json({ error: 'folder not found' })
  const jsonPath = projectionJsonPathFor(folder)
  if (!fs.existsSync(jsonPath)) return res.json({ catalogDefaults: null, trackOverrides: {} })
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    res.json({
      catalogDefaults: data.catalogDefaults || null,
      trackOverrides: data.trackOverrides || {},
    })
  } catch (err) {
    res.status(500).json({ error: 'failed to read projection json: ' + err.message })
  }
})

app.post('/api/data/projection-params', (req, res) => {
  const { folder, graphId, params } = req.body || {}
  if (!folder || typeof folder !== 'string') return res.status(400).json({ error: 'folder required' })
  if (!fs.existsSync(folder)) return res.status(404).json({ error: 'folder not found' })
  if (!graphId || typeof graphId !== 'string') return res.status(400).json({ error: 'graphId required' })
  if (!params || typeof params !== 'object') return res.status(400).json({ error: 'params required' })
  const jsonPath = projectionJsonPathFor(folder)
  let data = { catalogDefaults: null, trackOverrides: {} }
  if (fs.existsSync(jsonPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
      data = {
        catalogDefaults: existing.catalogDefaults || null,
        trackOverrides: existing.trackOverrides || {},
      }
    } catch (err) {
      return res.status(500).json({ error: 'failed to read existing projection json: ' + err.message })
    }
  }
  if (graphId === 'chart:total' || graphId === 'chart:adjusted') {
    data.catalogDefaults = params
  } else if (graphId.startsWith('track:')) {
    const label = graphId.slice('track:'.length)
    data.trackOverrides[label] = params
  } else {
    return res.status(400).json({ error: 'unknown graphId: ' + graphId })
  }
  try {
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2))
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'failed to write projection json: ' + err.message })
  }
})

// Quote-file existence — gates the Valuate "key metrics" purple title. Checks the canonical
// quote/export output `<folder>/<basename> - Quote.xlsx`. Mirrors /api/data/diligence-workbook.
app.get('/api/data/quote-exists', (req, res) => {
  const folder = req.query.folder
  if (!folder || typeof folder !== 'string' || !fs.existsSync(folder)) {
    return res.status(400).json({ error: 'invalid folder' })
  }
  const basename = path.basename(folder)
  const quotePath = path.join(folder, `${basename} - Quote.xlsx`)
  res.json({ exists: fs.existsSync(quotePath) })
})

app.post('/api/data/open-folder', (req, res) => {
  try {
    const { key, path: pathParam } = req.body || {}
    const targets = {
      'current': path.join(DATA_ROOT, '1. Current'),
      'materials-root': MATERIALS_ROOT,
    }
    let target = targets[key]
    if (!target && pathParam) {
      const resolved = path.resolve(pathParam)
      const safeRoot = path.resolve(DATA_ROOT)
      if (resolved !== safeRoot && !resolved.startsWith(safeRoot + path.sep)) {
        return res.status(403).json({ error: 'path outside data root' })
      }
      if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'path not found' })
      target = resolved
    }
    if (!target) return res.status(400).json({ error: 'invalid key or path' })
    if (!fs.existsSync(target)) {
      try { fs.mkdirSync(target, { recursive: true }) } catch {}
    }
    openFile(target)
    res.json({ ok: true, folderPath: target })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/data/folders — list immediate subfolders of 1. Data/1. Current/.
// Newest first by mtime. For each:
//   - hasDiligence=true if it contains a subfolder whose name ends with "_Due Diligence"
// Returns empty array if directory isn't accessible.
// Self-contained: reads no Deal Manager state — Data Manager and Deal Manager stay
// decoupled per the v2 modularity rule (v3 will add the linking layer).
app.get('/api/data/folders', (req, res) => {
  try {
    const CURRENT_DIR = path.join(DATA_ROOT, '1. Current')
    // Drill-in: ?path=<container> lists that container's child catalogs (validated under DATA_ROOT);
    // with no path, list the top-level 1. Current folders.
    let baseDir = CURRENT_DIR
    let inDrill = false
    if (req.query.path) {
      const resolved = path.resolve(String(req.query.path))
      const safeRoot = path.resolve(DATA_ROOT)
      if (resolved !== safeRoot && !resolved.startsWith(safeRoot + path.sep)) {
        return res.status(403).json({ error: 'path outside data root' })
      }
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        return res.status(404).json({ error: 'folder not found' })
      }
      baseDir = resolved
      inDrill = true
    }
    if (!fs.existsSync(baseDir)) return res.json([])
    const entries = fs.readdirSync(baseDir, { withFileTypes: true })

    // Pre-list logs/ once for stale-run detection. A skill is "stale" (spinner should
    // clear) when its most recent log shows the process has ENDED — either it wrote the
    // "[spawn] exit code=" marker (finished, whether success or a hard blocker), or it's
    // gone quiet: empty + over 10 min old, OR over 1 hour old regardless of size. Stale
    // entries are returned per-folder so the frontend can auto-clear spinners that persist.
    const STALE_EMPTY_MS = 10 * 60 * 1000
    const STALE_OLD_MS = 60 * 60 * 1000
    let logFiles = []
    try { logFiles = fs.readdirSync(LOGS_DIR, { withFileTypes: true }).filter(f => f.isFile()).map(f => f.name) } catch {}
    const now = Date.now()
    function staleSkillsFor(folderName) {
      const safeFolder = folderName.replace(/[^a-zA-Z0-9_-]+/g, '_')
      const escaped = safeFolder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const stale = []
      for (const skill of ['diligence', 'catalog-extract']) {
        const pattern = new RegExp(`^${escaped}_${skill}_\\d+\\.log$`)
        const matching = logFiles.filter(f => pattern.test(f)).sort()
        if (matching.length === 0) continue
        const latest = matching[matching.length - 1]
        try {
          const logPath = path.join(LOGS_DIR, latest)
          const lstat = fs.statSync(logPath)
          const age = now - lstat.mtime.getTime()
          const empty = lstat.size === 0
          // A finished run appends "[spawn] exit code=" as its last line. Once present,
          // the process has ended — clear the spinner now instead of waiting out the
          // time-based fallbacks. Read only the tail (≤4 KB) to keep this cheap.
          let exited = false
          if (!empty) {
            try {
              const start = Math.max(0, lstat.size - 4096)
              const buf = Buffer.alloc(lstat.size - start)
              const fd = fs.openSync(logPath, 'r')
              try { fs.readSync(fd, buf, 0, buf.length, start) } finally { fs.closeSync(fd) }
              exited = buf.includes('[spawn] exit code=')
            } catch {}
          }
          if (exited || (empty && age > STALE_EMPTY_MS) || age > STALE_OLD_MS) stale.push(skill)
        } catch {}
      }
      return stale
    }

    const folders = entries
      .filter(e => e.isDirectory())
      .map(e => {
        const fullPath = path.join(baseDir, e.name)
        const mtime = fs.statSync(fullPath).mtime.toISOString()
        // Container = a top-level "!"-prefixed folder holding a collection of catalogs. One level
        // only, so drill-in children (inDrill) are always plain catalogs. The "!" is dropped for
        // display; the row shows a rollup of its catalogs + X/N done counts and is not runnable.
        if (!inDrill && e.name.startsWith('!')) {
          const childPaths = listSubdirs(fullPath)
          let dilDone = 0, quoteDone = 0, extractDone = 0
          for (const cp of childPaths) {
            const f = folderSkillFlags(cp)
            if (f.hasDiligence) dilDone += 1
            if (f.hasQuote) quoteDone += 1
            if (f.hasExtract) extractDone += 1
          }
          return {
            name: e.name, displayName: e.name.replace(/^!/, ''), path: fullPath, mtime,
            isContainer: true, childCount: childPaths.length, dilDone, quoteDone, extractDone,
            summary: computeContainerRollup(childPaths),
          }
        }
        // Regular catalog row (also used for a container's children in the drill-in view).
        const { hasDiligence, hasExtract, hasQuote } = folderSkillFlags(fullPath)
        const staleSkills = staleSkillsFor(e.name)
        const summary = computeWorkbookSummary(fullPath)
        return {
          name: e.name, displayName: e.name, path: fullPath, mtime,
          isContainer: false, hasDiligence, hasExtract, hasQuote, staleSkills,
          summary: publicSummary(summary),
        }
      })
      .sort((a, b) => {
        // Containers pinned to the top; each group newest-first by mtime.
        if (a.isContainer !== b.isContainer) return a.isContainer ? -1 : 1
        return b.mtime.localeCompare(a.mtime)
      })
    res.json(folders)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/data/run-skill — fire-and-forget Claude CLI subprocess for a known skill.
// Spawns `claude -p "/<skill>" --dangerously-skip-permissions` with cwd = selected folder.
// Skill discovery walks up from cwd to find <Data>/.claude/skills/<skill>/SKILL.md.
// Subprocess is detached + unref'd so the server isn't tied to its lifetime.
// stdout/stderr stream to <App Files>/logs/<folder>_<skill>_<timestamp>.log for debugging.
const ALLOWED_SKILLS = new Set(['diligence', 'catalog-extract'])
const LOGS_DIR = path.join(__dirname, '..', 'logs')
// Guards a folder against a second concurrent run of the same skill — two processes
// writing the same `_Due Diligence` / `_Data Engine` output would corrupt it. Keyed
// `${skill}\u0000${folderPath}`; entries are cleared on subprocess exit/error.
const RUNNING_SKILLS = new Set()

// Durable in-flight guard. RUNNING_SKILLS (in-memory) is lost when the server restarts, but a
// detached skill subprocess can outlive the server. Before starting a run, also check whether a
// prior run for this folder+skill is STILL ALIVE: find its most recent log, and if that log has
// no finished/errored marker, read back the PID recorded at the top and probe it. A live PID
// means a real run is in progress → refuse the second run so two processes can't write (and
// corrupt) the same workbook. A crashed run leaves a dead PID → not in flight → re-run allowed.
// Worst case (a recycled PID) is a harmless spurious "already running" — never a double-run.
function skillRunInFlight(folderPath, skill) {
  try {
    const safeFolder = path.basename(folderPath).replace(/[^a-zA-Z0-9_-]+/g, '_')
    const escaped = safeFolder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`^${escaped}_${skill}_\\d+\\.log$`)
    let matching = []
    try { matching = fs.readdirSync(LOGS_DIR).filter(f => pattern.test(f)).sort() } catch { return false }
    if (matching.length === 0) return false
    const logPath = path.join(LOGS_DIR, matching[matching.length - 1])
    const st = fs.statSync(logPath)
    const fd = fs.openSync(logPath, 'r')
    try {
      // Tail (≤4 KB): a finished or errored run wrote its marker here → definitively done.
      const tailStart = Math.max(0, st.size - 4096)
      const tail = Buffer.alloc(st.size - tailStart)
      fs.readSync(fd, tail, 0, tail.length, tailStart)
      const tailStr = tail.toString('utf8')
      if (tailStr.includes('[spawn] exit code=') || tailStr.includes('[spawn] error:')) return false
      // Head (≤2 KB): recover the PID recorded just after spawn.
      const head = Buffer.alloc(Math.min(2048, st.size))
      fs.readSync(fd, head, 0, head.length, 0)
      const m = head.toString('utf8').match(/\[spawn\] pid=(\d+)/)
      if (!m) return false
      const pid = Number(m[1])
      try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return false
  }
}

// Resolve the Claude Code CLI binary. Checks PATH first, then falls back to common
// install locations (Desktop-app bundle on Windows, npm-global on Mac). Cached in-memory
// AND on disk (logs/.claude-bin) — disk cache survives restarts and transient fs.existsSync
// flakes that occasionally happen on Windows AppData paths.
let CLAUDE_BIN_CACHE = null
const CLAUDE_BIN_CACHE_FILE = path.join(__dirname, '..', 'logs', '.claude-bin')
function persistClaudeBin(p) {
  try {
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true })
    fs.writeFileSync(CLAUDE_BIN_CACHE_FILE, p, 'utf8')
  } catch {}
}
// Verify a resolved claude binary actually EXECUTES — not just that the file exists. A
// desktop-app auto-update can leave a corrupt/incompatible claude.exe (valid PE header but the
// OS refuses to launch it → spawn EFTYPE = "not a valid application for this OS platform").
// `--version` is a fast, side-effect-free probe; status 0 means it runs. Guards against trusting
// a present-but-unrunnable binary and lets the resolver fall back to an older version that works.
// Also skips a PATH shim that can't be spawned shell-less (the real run uses shell:false too).
function claudeBinRuns(p) {
  try {
    const r = spawnSync(p, ['--version'], { timeout: 10000, windowsHide: true, stdio: 'ignore' })
    return !r.error && r.status === 0
  } catch {
    return false
  }
}
function findClaudeBin() {
  // In-memory cache — re-validate before trusting it. The Claude desktop app installs into a
  // versioned folder (claude-code\<ver>\claude.exe) and DELETES the previous version on auto-
  // update (cached path → ENOENT); a fresh update can also ship a corrupt/unrunnable binary
  // (→ EFTYPE). Verify the cached path still exists AND runs; if not, drop it and re-resolve.
  if (CLAUDE_BIN_CACHE) {
    if (fs.existsSync(CLAUDE_BIN_CACHE) && claudeBinRuns(CLAUDE_BIN_CACHE)) return CLAUDE_BIN_CACHE
    CLAUDE_BIN_CACHE = null
  }
  // Disk cache — accept only if the cached path still exists AND actually runs. A corrupt
  // auto-update can replace the cached binary in place (file present, but unrunnable), so
  // existence alone isn't enough — re-verify runnability before trusting it.
  try {
    const cached = fs.readFileSync(CLAUDE_BIN_CACHE_FILE, 'utf8').trim()
    if (cached && fs.existsSync(cached) && claudeBinRuns(cached)) { CLAUDE_BIN_CACHE = cached; return cached }
  } catch {}
  // Try PATH first
  const probe = os.platform() === 'win32'
    ? spawnSync('where', ['claude'], { encoding: 'utf8', windowsHide: true })
    : spawnSync('which', ['claude'], { encoding: 'utf8' })
  if (probe.status === 0 && probe.stdout?.trim()) {
    const fromPath = probe.stdout.trim().split(/\r?\n/)[0]
    if (claudeBinRuns(fromPath)) {
      CLAUDE_BIN_CACHE = fromPath
      persistClaudeBin(CLAUDE_BIN_CACHE)
      return CLAUDE_BIN_CACHE
    }
  }
  // Windows: the Claude desktop app is an MSIX packaged app. The familiar
  // %APPDATA%\Claude path is a SYMLINK into the package's LocalCache, and resolving
  // claude.exe THROUGH that symlink is unreliable for a background process (intermittent
  // "not found" even though the file exists). So scan the REAL LocalCache location first
  // (a plain directory, no reparse), then fall back to the %APPDATA% redirect for any
  // non-packaged install. Pick the newest version that actually has claude.exe.
  if (os.platform() === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    const bundleRoots = []
    try {
      const pkgDir = path.join(localAppData, 'Packages')
      if (fs.existsSync(pkgDir)) {
        for (const pkg of fs.readdirSync(pkgDir, { withFileTypes: true })) {
          if (pkg.isDirectory() && /^Claude_/i.test(pkg.name)) {
            bundleRoots.push(path.join(pkgDir, pkg.name, 'LocalCache', 'Roaming', 'Claude', 'claude-code'))
          }
        }
      }
    } catch {}
    bundleRoots.push(path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude-code'))
    for (const bundleRoot of bundleRoots) {
      let versions
      try {
        if (!fs.existsSync(bundleRoot)) continue
        versions = fs.readdirSync(bundleRoot, { withFileTypes: true })
          .filter(e => e.isDirectory())
          .map(e => e.name)
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      } catch { continue }
      for (const v of versions) {
        const candidate = path.join(bundleRoot, v, 'claude.exe')
        if (fs.existsSync(candidate) && claudeBinRuns(candidate)) { CLAUDE_BIN_CACHE = candidate; persistClaudeBin(candidate); return candidate }
      }
    }
  }
  // Mac fallbacks: common Node + bundled install locations
  if (os.platform() === 'darwin') {
    const home = os.homedir()
    const fixedPaths = [
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
      path.join(home, '.npm-global/bin/claude'),
      path.join(home, '.claude/local/claude'),
    ]
    for (const p of fixedPaths) {
      if (fs.existsSync(p) && claudeBinRuns(p)) { CLAUDE_BIN_CACHE = p; persistClaudeBin(p); return p }
    }
    // nvm: scan ~/.nvm/versions/node/* for the latest with claude
    try {
      const nvmRoot = path.join(home, '.nvm', 'versions', 'node')
      if (fs.existsSync(nvmRoot)) {
        const versions = fs.readdirSync(nvmRoot, { withFileTypes: true })
          .filter(e => e.isDirectory())
          .map(e => e.name)
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        for (const v of versions) {
          const candidate = path.join(nvmRoot, v, 'bin', 'claude')
          if (fs.existsSync(candidate) && claudeBinRuns(candidate)) { CLAUDE_BIN_CACHE = candidate; persistClaudeBin(candidate); return candidate }
        }
      }
    } catch {}
    // Mac Desktop-app bundled CLI (mirrors the Windows pattern; defensive in case it ships this way)
    try {
      const bundleRoot = path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code')
      if (fs.existsSync(bundleRoot)) {
        const versions = fs.readdirSync(bundleRoot, { withFileTypes: true })
          .filter(e => e.isDirectory())
          .map(e => e.name)
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        for (const v of versions) {
          const candidate = path.join(bundleRoot, v, 'claude')
          if (fs.existsSync(candidate) && claudeBinRuns(candidate)) { CLAUDE_BIN_CACHE = candidate; persistClaudeBin(candidate); return candidate }
        }
      }
    } catch {}
  }
  return null
}

app.post('/api/data/run-skill', (req, res) => {
  try {
    const { skill, folderPath, force } = req.body || {}
    if (!ALLOWED_SKILLS.has(skill)) return res.status(400).json({ error: 'invalid skill' })
    if (!folderPath || typeof folderPath !== 'string' || !fs.existsSync(folderPath)) {
      return res.status(400).json({ error: 'invalid folderPath' })
    }
    const runKey = `${skill}\u0000${folderPath}`
    if (RUNNING_SKILLS.has(runKey) || skillRunInFlight(folderPath, skill)) {
      return res.status(409).json({ error: `${skill} is already running for this folder — wait for it to finish.` })
    }
    // Global adaptive cap (US4): never exceed the effective cap (self-tunes on rate-limiting). The
    // client also disables the trigger at capacity; this is the authoritative backstop.
    const capActive = listSkillRuns().filter(r => r.state === 'running').length
    if (capActive >= diligenceEffectiveCap) {
      return res.status(409).json({ error: 'at_cap', effectiveCap: diligenceEffectiveCap, configuredCap: DILIGENCE_CAP_CEILING, message: `at capacity (${capActive} running) — wait for a run to finish` })
    }
    const claudeBin = findClaudeBin()
    if (!claudeBin) return res.status(500).json({ error: 'Claude CLI not found. Run RTHM Setup.command again, or install manually: npm install -g @anthropic-ai/claude-code' })
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true })
      // Tell Dropbox to ignore logs/ — per-machine, no value in syncing.
      // (Setup.command does this too, but covers the case where logs/ is first created at runtime.)
      if (os.platform() === 'darwin') {
        try { spawnSync('xattr', ['-w', 'com.dropbox.ignored', '1', LOGS_DIR], { stdio: 'ignore' }) } catch {}
      }
    }
    const safeFolder = path.basename(folderPath).replace(/[^a-zA-Z0-9_-]+/g, '_')
    const logPath = path.join(LOGS_DIR, `${safeFolder}_${skill}_${Date.now()}.log`)
    const prompt = `/${skill} ${JSON.stringify(folderPath)}${force ? ' --force' : ''}`
    const args = ['-p', prompt, '--dangerously-skip-permissions']

    // Sidecar debug file written BEFORE spawn so we have evidence even if the
    // subprocess dies immediately. Records resolved command + cwd + key env.
    const debugPath = logPath.replace(/\.log$/, '.spawn-debug.json')
    try {
      fs.writeFileSync(debugPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        claudeBin, args, cwd: folderPath,
        platform: os.platform(),
        host: os.hostname(),
        nodeVersion: process.version,
        env: { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA, PATH_present: !!process.env.PATH },
      }, null, 2))
    } catch {}

    // Fire-and-forget BACKGROUND run: the subprocess is DETACHED + unref'd so it survives this
    // server exiting (e.g. the heartbeat shutdown ~3s after the browser tab closes) and runs to
    // completion on its own. stdout+stderr go straight to the log file via inherited file
    // descriptors — NOT piped through this process — so logging keeps working after the parent is
    // gone. (The old "detached drops output on Windows" problem was about inheriting the parent's
    // OWN std fds; writing to file descriptors we opened here is reliable.)
    RUNNING_SKILLS.add(runKey)
    let outFd = 'ignore', errFd = 'ignore'
    try {
      outFd = fs.openSync(logPath, 'a')
      errFd = fs.openSync(logPath, 'a')
    } catch {
      if (typeof outFd === 'number') { try { fs.closeSync(outFd) } catch {} }
      outFd = 'ignore'; errFd = 'ignore'
    }
    const closeLogFds = () => { for (const fd of [outFd, errFd]) if (typeof fd === 'number') { try { fs.closeSync(fd) } catch {} } }
    let proc
    try {
      proc = spawn(claudeBin, args, {
        cwd: folderPath,
        stdio: ['ignore', outFd, errFd],
        shell: false,
        detached: true,
        windowsHide: true,
      })
    } catch (spawnErr) {
      RUNNING_SKILLS.delete(runKey)
      closeLogFds()
      // A corrupt/stale binary surfaces here as a synchronous spawn throw: EFTYPE (present but
      // unrunnable image), EACCES (not executable), or ENOENT (missing). Invalidate the cache so
      // the next run re-resolves and skips the bad binary via the runnability check above.
      if (spawnErr && ['EFTYPE', 'EACCES', 'ENOENT'].includes(spawnErr.code)) {
        CLAUDE_BIN_CACHE = null
        try { fs.unlinkSync(CLAUDE_BIN_CACHE_FILE) } catch {}
      }
      throw spawnErr
    }
    // The child inherited its own copies of the log fds — close ours so the parent doesn't keep
    // the file open and can exit cleanly while the child keeps writing.
    closeLogFds()
    // Record the PID at the top of the log so the durable in-flight guard (skillRunInFlight) can
    // tell whether a run that outlived a server restart is still alive.
    try { fs.appendFileSync(logPath, `[spawn] pid=${proc.pid} at ${new Date().toISOString()}\n`) } catch {}
    proc.on('exit', (code, signal) => {
      RUNNING_SKILLS.delete(runKey)
      // Append the finished marker so staleSkillsFor clears the spinner. Fires only while this
      // server is alive; if it already exited, the completed workbook on disk is the signal
      // instead (the folder flips to ✓ on the next Data Manager load).
      try { fs.appendFileSync(logPath, `\n[spawn] exit code=${code} signal=${signal} at ${new Date().toISOString()}\n`) } catch {}
    })
    proc.on('error', (err) => {
      RUNNING_SKILLS.delete(runKey)
      try { fs.appendFileSync(logPath, `\n[spawn] error: ${err.message}\n`) } catch {}
      // Self-heal: a stale or corrupt binary surfaces here as ENOENT (desktop app auto-updated
      // and removed the old version folder), EFTYPE (present but unrunnable image), or EACCES.
      // Invalidate the cache (memory + disk) so the next run re-resolves and skips the bad binary.
      if (err && ['ENOENT', 'EFTYPE', 'EACCES'].includes(err.code)) {
        CLAUDE_BIN_CACHE = null
        try { fs.unlinkSync(CLAUDE_BIN_CACHE_FILE) } catch {}
      }
    })
    // The listening server keeps the event loop alive; unref the child so IT alone can't, leaving
    // it free to outlive the server.
    proc.unref()
    res.json({ ok: true, pid: proc.pid, logPath, claudeBin, debugPath })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Skill-Run Monitor (Diligence Run Monitor feature) ───────────────────────
// Read-only run state derived from the LOGS_DIR ledger — the single source of truth for the
// persistent monitor and for re-attaching to detached runs that outlived the app. This block
// NEVER writes logs, source files, or workbooks.

// Cap CEILING for concurrent skill runs. Per-machine (NOT Dropbox-synced) because the Claude CLI
// can't report the account tier headlessly: default 2 (safe for a $20 Pro account); a Max machine
// sets DILIGENCE_MAX_CONCURRENT higher. The EFFECTIVE cap self-tunes downward on rate-limiting.
const DILIGENCE_CAP_CEILING = Math.max(1, parseInt(process.env.DILIGENCE_MAX_CONCURRENT, 10) || 2)
let diligenceEffectiveCap = DILIGENCE_CAP_CEILING

// Adaptive cap (US4): the EFFECTIVE cap self-tunes to what the signed-in account actually sustains —
// drop by 1 on an observed rate-limit failure, recover by 1 after 2 consecutive clean completions
// (count-based, deterministic — no wall-clock). Each finished run is counted exactly once.
const adaptiveProcessed = new Set()
let diligenceCleanStreak = 0
function updateAdaptiveCap(runs) {
  const newlyFinished = runs
    .filter(r => r.state !== 'running' && r.logFile && !adaptiveProcessed.has(r.logFile))
    .sort((a, b) => (Date.parse(a.finishedAt) || 0) - (Date.parse(b.finishedAt) || 0))
  for (const r of newlyFinished) {
    adaptiveProcessed.add(r.logFile)
    if (r.state === 'failed' && r.failureKind === 'rate_limit') {
      diligenceEffectiveCap = Math.max(1, diligenceEffectiveCap - 1)
      diligenceCleanStreak = 0
    } else {
      diligenceCleanStreak += 1
      if (diligenceCleanStreak >= 2) {
        diligenceEffectiveCap = Math.min(DILIGENCE_CAP_CEILING, diligenceEffectiveCap + 1)
        diligenceCleanStreak = 0
      }
    }
  }
}

// Latest "[stage] i/n label" marker a running skill emitted (logging-only; emitted by the skills).
function parseLatestStage(text) {
  const re = /\[stage\]\s+(\d+)\s*\/\s*(\d+)\s+(.+)/g
  let m, last = null
  while ((m = re.exec(text)) !== null) last = m
  if (!last) return null
  const i = Number(last[1]), n = Number(last[2])
  if (!Number.isFinite(i) || !Number.isFinite(n) || n <= 0) return null
  return { i, n, label: last[3].trim() }
}

// Classify a failure from the log tail so the monitor can show an actionable reason.
function classifyFailure(tail) {
  const t = (tail || '').toLowerCase()
  if (/rate.?limit|429|usage limit|quota|too many requests/.test(t)) return 'rate_limit'
  if (/\b401\b|invalid authentication|unauthorized|authentication_error|not logged in|please run.{0,8}login|enoent|eftype|eacces|not a valid application|command not found|claude (cli )?not found/.test(t)) return 'tooling_unavailable'
  return 'process_error'
}

// catalog-extract's real completion signal: a "<name>_Data Engine" subfolder with its manifest.
function extractOutputExists(folder) {
  try {
    for (const e of fs.readdirSync(folder, { withFileTypes: true })) {
      if (e.isDirectory() && /_Data Engine$/i.test(e.name) && fs.existsSync(path.join(folder, e.name, '.manifest.json'))) return true
    }
  } catch {}
  return false
}

// A run is genuinely "succeeded" only when its expected output exists (no false completions).
function outputExistsFor(skill, folder) {
  if (!folder) return false
  if (skill === 'diligence') return diligenceWorkbookExists(folder)
  if (skill === 'catalog-extract') return extractOutputExists(folder)
  return false
}

// "<safeFolder>_<skill>_<ts>.log" -> { skill, ts, safeFolder } | null.
function parseLogName(name) {
  for (const skill of ALLOWED_SKILLS) {
    const m = name.match(new RegExp(`^(.+)_${skill}_(\\d+)\\.log$`))
    if (m) return { skill, ts: Number(m[2]), safeFolder: m[1] }
  }
  return null
}

// The real catalog folder (cwd) is recorded in the spawn-debug sidecar — the reliable way to map a
// sanitized log name back to its folder (so we can verify output existence and show a real name).
function folderPathForLog(logFileName) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(LOGS_DIR, logFileName.replace(/\.log$/, '.spawn-debug.json')), 'utf8'))
    if (j && typeof j.cwd === 'string') return j.cwd
  } catch {}
  return null
}

// The machine that spawned a run (from the spawn-debug sidecar). logs/ syncs via Dropbox, so a run
// from another machine appears here; we use this to avoid probing a foreign PID against our own
// process table (which would misread a teammate's in-flight run as a failure).
function sidecarHost(logFileName) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(LOGS_DIR, logFileName.replace(/\.log$/, '.spawn-debug.json')), 'utf8'))
    if (j && typeof j.host === 'string') return j.host
  } catch {}
  return null
}

function lastMeaningfulLine(tail) {
  const lines = (tail || '').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('[spawn]') && !s.startsWith('[stage]'))
  return lines.length ? lines[lines.length - 1] : null
}

// Classify ONE run log into a Skill Run record. Liveness mirrors skillRunInFlight; this additionally
// derives stage / failureKind / true success. Never fabricates — succeeded needs exit 0 AND output.
function classifyRun(logFileName) {
  const meta = parseLogName(logFileName)
  if (!meta) return null
  const logPath = path.join(LOGS_DIR, logFileName)
  let st
  try { st = fs.statSync(logPath) } catch { return null }
  const folderPath = folderPathForLog(logFileName)
  const folderName = folderPath ? path.basename(folderPath) : meta.safeFolder
  const startedAt = new Date(meta.ts).toISOString()

  let head = '', tail = ''
  try {
    const fd = fs.openSync(logPath, 'r')
    try {
      const headLen = Math.min(2048, st.size)
      if (headLen > 0) { const b = Buffer.alloc(headLen); fs.readSync(fd, b, 0, headLen, 0); head = b.toString('utf8') }
      const tailLen = Math.min(65536, st.size)
      if (tailLen > 0) { const b = Buffer.alloc(tailLen); fs.readSync(fd, b, 0, tailLen, st.size - tailLen); tail = b.toString('utf8') }
    } finally { fs.closeSync(fd) }
  } catch {}

  const exitMatch = tail.match(/\[spawn\] exit code=(-?\d+|null)/)
  const errored = tail.includes('[spawn] error:')
  const stage = parseLatestStage(tail)

  let state, failureKind = null, error = null, finishedAt = null
  if (exitMatch || errored) {
    finishedAt = st.mtime.toISOString()
    const code = exitMatch ? exitMatch[1] : null
    if (code === '0' && outputExistsFor(meta.skill, folderPath)) {
      state = 'succeeded'
    } else {
      state = 'failed'
      failureKind = classifyFailure(tail)
      const spawnErr = (tail.match(/\[spawn\] error:.*/g) || []).pop()
      error = spawnErr ? spawnErr.replace('[spawn] error:', '').trim()
            : (lastMeaningfulLine(tail) || `run ended with exit code ${code}`)
    }
  } else {
    // No terminal marker yet. A run started on ANOTHER machine (logs/ syncs via Dropbox) can't have
    // its PID probed against our process table, so only probe our OWN runs; an unfinished foreign run
    // is shown as running on that machine rather than as a false failure.
    const host = sidecarHost(logFileName)
    if (host && host !== os.hostname()) {
      state = 'running'
    } else {
      const pidMatch = head.match(/\[spawn\] pid=(\d+)/)
      let alive = false
      if (pidMatch) { try { process.kill(Number(pidMatch[1]), 0); alive = true } catch (e) { alive = (e.code === 'EPERM') } }
      if (alive) {
        state = 'running'
      } else {
        state = 'failed'
        failureKind = 'process_error'
        error = pidMatch ? 'run ended without completing — process is gone and wrote no exit code' : 'run did not start'
        finishedAt = st.mtime.toISOString()
      }
    }
  }
  return { skill: meta.skill, folderPath, folderName, state, stage, failureKind, error, startedAt, finishedAt, logFile: logFileName }
}

// Latest run per (skill, folder). Keeps a finished run visible for RECENT_DONE_MS so re-attach can
// surface an outcome that completed while the app was closed.
const RECENT_DONE_MS = 60 * 60 * 1000
function listSkillRuns() {
  let names = []
  try { names = fs.readdirSync(LOGS_DIR, { withFileTypes: true }).filter(f => f.isFile() && f.name.endsWith('.log')).map(f => f.name) } catch {}
  const latest = new Map()
  for (const name of names) {
    const meta = parseLogName(name)
    if (!meta) continue
    // Cross-machine safety: logs/ syncs via Dropbox, so a run done on another machine appears here
    // with a foreign cwd (e.g. a Mac path on a Windows box). Only surface runs whose catalog folder
    // exists on THIS machine — otherwise a teammate's run would be misclassified locally.
    const fp = folderPathForLog(name)
    if (fp && !fs.existsSync(fp)) continue
    const key = `${meta.skill} ${meta.safeFolder}`
    const prev = latest.get(key)
    if (!prev || meta.ts > prev.ts) latest.set(key, name)
  }
  const now = Date.now()
  const runs = []
  for (const name of latest.values()) {
    const r = classifyRun(name)
    if (!r) continue
    if (r.state === 'running') { runs.push(r); continue }
    const finishedMs = r.finishedAt ? Date.parse(r.finishedAt) : 0
    if (now - finishedMs <= RECENT_DONE_MS) runs.push(r)
  }
  runs.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
  return runs
}

// GET /api/data/skill-runs — read-only run ledger + adaptive cap state. Drives the monitor + re-attach.
app.get('/api/data/skill-runs', (req, res) => {
  try {
    const runs = listSkillRuns()
    updateAdaptiveCap(runs)
    const activeCount = runs.filter(r => r.state === 'running').length
    res.json({
      configuredCap: DILIGENCE_CAP_CEILING,
      effectiveCap: diligenceEffectiveCap,
      activeCount,
      atCap: activeCount >= diligenceEffectiveCap,
      runs,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

let shutdownTimer = null
let activeConnections = 0

// Auto-shutdown when the UI is gone — but NEVER while a skill subprocess is still in flight.
// Diligence/extract runs are detached and survive the server, but keeping the server up lets the
// run finish cleanly (write its "[spawn] exit code=" marker so the spinner clears) and avoids
// concurrently --kill-others tearing down Vite the instant the browser tab closes mid-run. Exit
// only once the last connection is gone AND no skill is running.
function maybeShutdown() {
  if (activeConnections > 0) { shutdownTimer = null; return }
  if (RUNNING_SKILLS.size > 0) { shutdownTimer = setTimeout(maybeShutdown, 5000); return }
  process.exit(0)
}

app.get('/api/heartbeat', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  res.flushHeaders()

  activeConnections++
  if (shutdownTimer) { clearTimeout(shutdownTimer); shutdownTimer = null }

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000)

  req.on('close', () => {
    clearInterval(keepAlive)
    activeConnections--
    if (activeConnections <= 0) {
      shutdownTimer = setTimeout(maybeShutdown, 3000)
    }
  })
})


const PORT = 3001
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  // Pre-warm the Data Manager summary cache so the first /api/data/folders
  // request doesn't pay the cold-cache XLSX-parse cost. Walks every deal
  // folder once on a 100ms delay and runs computeWorkbookSummary on each;
  // the cache (keyed by workbook mtime) is then hot for any subsequent call.
  setTimeout(() => {
    try {
      const dir = path.join(DATA_ROOT, '1. Current')
      if (!fs.existsSync(dir)) return
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      const t0 = Date.now()
      let warmed = 0
      for (const e of entries) {
        if (!e.isDirectory()) continue
        try {
          const summary = computeWorkbookSummary(path.join(dir, e.name))
          if (summary) warmed += 1
        } catch {}
      }
      console.log(`[prewarm] data manager summary cache: ${warmed} folders in ${Date.now() - t0}ms`)
    } catch (err) {
      console.warn('[prewarm] failed:', err.message)
    }
  }, 100)
})
