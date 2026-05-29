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
const TERMS_ALL = ['12 months', '36 months', '60 months', '84 months']
const IQ_PAIRS = [['AC','AD'], ['AE','AF'], ['AG','AH'], ['AI','AJ']]
const VQ_PAIRS = [['AR','AS'], ['AT','AU'], ['AV','AW'], ['AX','AY']]
const DEFAULT_RATES = {
  Individual: { '12 months': 70, '36 months': 60, '60 months': 50, '84 months': 45 },
  B2B:        { '12 months': 74, '36 months': 64, '60 months': 54, '84 months': 50 }
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

const WANTED_COLS = ['A','C','AC','AD','AE','AF','AG','AH','AI','AJ','AN','AR','AS','AT','AU','AV','AW','AX','AY']

const IQ_COLS = ['AC','AD','AE','AF','AG','AH','AI','AJ']
const VQ_COLS = ['AR','AS','AT','AU','AV','AW','AX','AY']

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
    const initialQuote = {}
    IQ_COLS.forEach(col => { initialQuote[col] = sumCol(col) })
    const percentRaw = groupRows.find(r => r['AN'])?.['AN'] || ''
    const percent = parseFloat(percentRaw.replace(/[^0-9.-]/g, '')) || null
    const variableQuote = {}
    VQ_COLS.forEach(col => { variableQuote[col] = sumCol(col) })
    return { name, platform, initialQuote, percent, variableQuote }
  })
}

function colIndex(col) {
  let n = 0
  for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64)
  return n - 1
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
        if (cat.id !== 'Royalty Purchase Agreements') return 0
        const orders = {
          'Royalty Purchase Agreements': ['RTHM RPA', 'RTHM x RAS RPA'],
          'Deal Sheets': ['RTHM Deal Sheet'],
        }
        const order = orders[cat.id] || []
        const ai = order.indexOf(a.name)
        const bi = order.indexOf(b.name)
        if (ai !== -1 && bi !== -1) return ai - bi
        if (ai !== -1) return -1
        if (bi !== -1) return 1
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

// POST /api/save/invoice — fill invoice template and export as PDF to Downloads
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

    const tmpDir = path.join(os.tmpdir(), 'rthm-invoices')
    fs.mkdirSync(tmpDir, { recursive: true })
    const tmpDocx = path.join(tmpDir, docName)
    fs.writeFileSync(tmpDocx, filledBuf)

    const outDir = path.join(os.homedir(), 'Downloads')
    fs.mkdirSync(outDir, { recursive: true })

    const result = spawnSync(LIBRE_BIN, [
      '--headless', '--convert-to', 'pdf', '--outdir', outDir, tmpDocx
    ], { timeout: 30000 })

    fs.unlinkSync(tmpDocx)

    if (result.status !== 0) {
      return res.status(500).json({ error: 'PDF conversion failed: ' + (result.stderr?.toString() || 'unknown error') })
    }

    const pdfName = docName.replace(/\.docx$/i, '.pdf')
    res.json({ ok: true, pdfName })
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
      range: `${sheet.properties.title}!A7:AY`
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

    // Store relative to Dropbox root for cross-platform compat
    const relPath = folderPath.startsWith(DROPBOX_RTHM) ? folderPath.slice(DROPBOX_RTHM.length).replace(/^[/\\]/, '') : folderPath
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
    const resolved = path.isAbsolute(stored) ? stored : path.join(DROPBOX_RTHM, stored)
    if (!fs.existsSync(resolved)) {
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



    const iq = deal.initialQuote || {}
    const vq = deal.variableQuote || {}
    const hasVQ = VQ_PAIRS.some(([a, b]) => vq[a] || vq[b])
    const pairs = hasVQ ? VQ_PAIRS : IQ_PAIRS
    const source = hasVQ ? vq : iq
    const vs = deal.valuationState || {}
    const effectiveRates = vs.rates || DEFAULT_RATES[dealType] || DEFAULT_RATES.Individual

    const structuredRows = []
    for (const [term, key] of [['84 months','84'], ['60 months','60'], ['36 months','36'], ['12 months','12']]) {
      const termIdx = TERMS_ALL.indexOf(term)
      const [advCol, recoupCol] = pairs[termIdx]
      const rasAdvance = parseFloat(source[advCol]) || 0
      const rasRecoup = parseFloat(source[recoupCol]) || 0
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

    const effectiveRates = rates || DEFAULT_RATES[dealType] || DEFAULT_RATES.Individual

    const iq = deal.initialQuote || {}
    const vq = deal.variableQuote || {}
    const hasVQ = VQ_PAIRS.some(([a, b]) => vq[a] || vq[b])
    const pairs = hasVQ ? VQ_PAIRS : IQ_PAIRS
    const source = hasVQ ? vq : iq

    function fmtMoney(n) { return '$' + Math.round(n).toLocaleString('en-US') }
    function fmtPct(n) { return n + '%' }

    const fields = { 'Deal Name': deal.name, 'Date': dateStr, showPR }
    const b2bFields = {}
    const effectiveMargin = margin != null ? parseFloat(margin) : 0

    for (const [term, key] of [['84 months','84'], ['60 months','60'], ['36 months','36'], ['12 months','12']]) {
      const termIdx = TERMS_ALL.indexOf(term)
      const [advCol, recoupCol] = pairs[termIdx]
      const rasAdvance = parseFloat(source[advCol]) || 0
      const rasRecoup = parseFloat(source[recoupCol]) || 0
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
      const b2bRecoup = rasRecoup > 0 ? Math.round((b2bAdvance / rasRecoup) * 100) : 0
      const b2bPRAdvance = Math.round(advanceAmount * (1 - effectiveMargin / 100))
      b2bFields[`B2B Advance ${key}`] = fmtMoney(b2bAdvance)
      b2bFields[`B2B Recoup ${key}`] = fmtPct(b2bRecoup)
      b2bFields[`B2B PR ${key}`] = fmtMoney(b2bPRAdvance)
      b2bFields[`PR Total ${key}`] = fmtMoney(b2bPRAdvance + marketingBudget)
    }

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
    // Sheet-name patterns accepted (case-insensitive):
    //   `<Platform> – Track Rep`              (multi-platform standard)
    //   `Track Rep`                            (bare, single-platform — uses deal name)
    //   `<Platform> – Breakdown Adj`           (Brkdn alias also accepted)
    //   `By Track (Reported)` / `By Source (Adjusted)`  (legacy Hirschmann-style)
    // Normalizes: "By Track" → track, "By Source" → breakdown, "Reported"/"Adjusted"
    // → Rep/Adj. Bare sheet names attribute to deal folder name as platform.
    const sheetKindRe = /^(?:(.+?)\s*[–—―\-]\s*)?(?:By\s+)?(Track|Source|Brkdn|Breakdown)\s+\(?(Rep|Reported|Adj|Adjusted)\)?\s*$/i

    // Pass 1: group matching sheet names by platform. Bare sheet names (no prefix)
    // use the deal folder name as the platform identifier.
    const platformSheets = new Map() // name -> { entries: [{isTrack, isAdj, sheetName}] }
    for (const sheetName of wb.SheetNames) {
      const m = sheetName.match(sheetKindRe)
      if (!m) continue
      const name = (m[1] || basename).trim()
      const isTrack = /^Track$/i.test(m[2])
      const isAdj = /^Adj/i.test(m[3])
      if (!platformSheets.has(name)) platformSheets.set(name, { entries: [] })
      platformSheets.get(name).entries.push({ isTrack, isAdj, sheetName })
    }

    // Build a month series from a set of sheet refs. Each Adj sheet contributes to
    // the adj line; each Rep sheet contributes to the rep line. Months are merged
    // by YYYY-MM key across all input sheets.
    function buildSeries(entries) {
      const byMonth = new Map()
      for (const e of entries) {
        const ws = wb.Sheets[e.sheetName]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
        if (rows.length < 3) continue
        // Header row position varies — scan top 8 rows for first with a month-parseable cell at col >= 2.
        let headerIdx = -1, colMonths = null
        for (let i = 0; i < Math.min(rows.length, 8); i++) {
          const cand = (rows[i] || []).map(parseMonthHeader)
          if (cand.some((v, idx) => v && idx >= 2)) { headerIdx = i; colMonths = cand; break }
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
      platforms.push({ name, ...buildSeries(useEntries) })
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
    function trackLifetimeFromEntries(entries) {
      const trackMap = new Map()
      for (const e of entries) {
        const ws = wb.Sheets[e.sheetName]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
        if (rows.length < 3) continue
        let headerIdx = -1, colMonths = null
        for (let i = 0; i < Math.min(rows.length, 8); i++) {
          const cand = (rows[i] || []).map(parseMonthHeader)
          if (cand.some((v, idx) => v && idx >= 2)) { headerIdx = i; colMonths = cand; break }
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
      const platformTracks = trackLifetimeFromEntries(relevant)
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
  // MMM YYYY / MMM-YYYY (e.g. "Aug 2025")
  m = s.match(/^([A-Za-z]+)[-\s]+(\d{4})$/)
  if (m) {
    const mo = MONTH_MAP[m[1].slice(0,3).toLowerCase()]
    if (mo) return { key: `${m[2]}-${String(mo).padStart(2,'0')}`, label: s }
  }
  // MMMyy / MMMyyyy — no separator (e.g. "Aug25", "Aug2025"). Diligence-workbook default format.
  m = s.match(/^([A-Za-z]+)(\d{2,4})$/)
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
  m = s.match(/^Q([1-4])['\-/\s]?(\d{2,4})$/i) || s.match(/^([1-4])Q(\d{2,4})$/i)
  if (m) {
    const q = Number(m[1])
    const startMo = (q - 1) * 3 + 1
    const yr = m[2].length === 4 ? m[2] : `20${m[2]}`
    return { key: `${yr}-${String(startMo).padStart(2,'0')}`, label: s }
  }
  return null
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
function computeWorkbookSummaryInner(wbPath, dealName) {
  try {
    const wb = XLSX.readFile(wbPath, { cellDates: true })
    // See full pattern docs in computeDiligenceWorkbook above.
    const sheetKindRe = /^(?:(.+?)\s*[–—―\-]\s*)?(?:By\s+)?(Track|Source|Brkdn|Breakdown)\s+\(?(Rep|Reported|Adj|Adjusted)\)?\s*$/i
    const platformSheets = new Map()
    for (const sheetName of wb.SheetNames) {
      const m = sheetName.match(sheetKindRe)
      if (!m) continue
      const name = (m[1] || dealName).trim()
      const isTrack = /^Track$/i.test(m[2])
      const isAdj = /^Adj/i.test(m[3])
      if (!platformSheets.has(name)) platformSheets.set(name, { entries: [] })
      platformSheets.get(name).entries.push({ isTrack, isAdj, sheetName })
    }
    function buildSeries(entries) {
      const byMonth = new Map()
      for (const e of entries) {
        const ws = wb.Sheets[e.sheetName]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
        if (rows.length < 3) continue
        let headerIdx = -1, colMonths = null
        for (let i = 0; i < Math.min(rows.length, 8); i++) {
          const cand = (rows[i] || []).map(parseMonthHeader)
          if (cand.some((v, idx) => v && idx >= 2)) { headerIdx = i; colMonths = cand; break }
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
      platforms.push({ name, ...buildSeries(useEntries) })
    }
    if (platforms.length === 0) return null
    // Combined view by month key
    const combinedByMonth = new Map()
    for (const p of platforms) {
      for (let i = 0; i < p.keys.length; i++) {
        const key = p.keys[i]
        if (!combinedByMonth.has(key)) combinedByMonth.set(key, { rep: 0, adj: 0 })
        const b = combinedByMonth.get(key)
        b.rep += p.rep[i] || 0
        b.adj += p.adj[i] || 0
      }
    }
    const combinedSorted = [...combinedByMonth.entries()].sort(([a], [b]) => a.localeCompare(b))
    if (combinedSorted.length === 0) return null
    const keys = combinedSorted.map(([k]) => k)
    const repLine = combinedSorted.map(([, v]) => v.rep)
    const adjLine = combinedSorted.map(([, v]) => v.adj)
    const adjMatchesRep = repLine.every((v, i) => v === adjLine[i])
    const line = adjMatchesRep ? repLine : adjLine
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
      for (const e of relevant) {
        const ws = wb.Sheets[e.sheetName]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
        let headerIdx = -1, colMonths = null
        for (let i = 0; i < Math.min(rows.length, 8); i++) {
          const cand = (rows[i] || []).map(parseMonthHeader)
          if (cand.some((v, idx) => v && idx >= 2)) { headerIdx = i; colMonths = cand; break }
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

    return { line, lifetime, ttm, hasAdj: !adjMatchesRep, trackCount, top80Count, dollarAge }
  } catch { return null }
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
    if (!fs.existsSync(CURRENT_DIR)) return res.json([])
    const entries = fs.readdirSync(CURRENT_DIR, { withFileTypes: true })

    // Pre-list logs/ once for stale-run detection. A skill is "stale" if its most
    // recent log shows no progress: empty + over 10 min old, OR over 1 hour old
    // regardless of size. Stale entries are returned per-folder so the frontend
    // can auto-clear spinners that would otherwise persist in localStorage.
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
          const lstat = fs.statSync(path.join(LOGS_DIR, latest))
          const age = now - lstat.mtime.getTime()
          const empty = lstat.size === 0
          if ((empty && age > STALE_EMPTY_MS) || age > STALE_OLD_MS) stale.push(skill)
        } catch {}
      }
      return stale
    }

    const folders = entries
      .filter(e => e.isDirectory())
      .map(e => {
        const fullPath = path.join(CURRENT_DIR, e.name)
        const stat = fs.statSync(fullPath)
        let hasExtract = false
        try {
          const subs = fs.readdirSync(fullPath, { withFileTypes: true })
          hasExtract = subs.some(s => s.isDirectory() && s.name.toLowerCase().endsWith('_data engine'))
        } catch {}
        // Quote-export existence — drives the Data Manager "Valuation" green check.
        const hasQuote = fs.existsSync(path.join(fullPath, `${e.name} - Quote.xlsx`))
        const staleSkills = staleSkillsFor(e.name)
        // Summary (sparkline line + Lifetime + TTM). Returns null when there's no
        // diligence folder, no workbook, or the workbook is unparseable.
        const summary = computeWorkbookSummary(fullPath)
        // Rule: diligence is "done" only when we can actually read a parseable
        // workbook. An empty `_Due Diligence` folder doesn't count — if you can't
        // draw the line, diligence isn't done from the app's perspective.
        const hasDiligence = summary != null
        return { name: e.name, path: fullPath, mtime: stat.mtime.toISOString(), hasDiligence, hasExtract, hasQuote, staleSkills, summary }
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime))
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
// `${skill} ${folderPath}`; entries are cleared on subprocess exit/error.
const RUNNING_SKILLS = new Set()

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
function findClaudeBin() {
  // In-memory cache — re-validate before trusting it. The Claude desktop app installs into
  // a versioned folder (claude-code\<ver>\claude.exe) and DELETES the previous version on
  // auto-update, so any cached path goes stale (ENOENT) after every update. Verify it still
  // exists; if not, drop it and re-resolve.
  if (CLAUDE_BIN_CACHE) {
    if (fs.existsSync(CLAUDE_BIN_CACHE)) return CLAUDE_BIN_CACHE
    CLAUDE_BIN_CACHE = null
  }
  // Disk cache — accept only if the cached path still exists on disk (same staleness risk).
  try {
    const cached = fs.readFileSync(CLAUDE_BIN_CACHE_FILE, 'utf8').trim()
    if (cached && fs.existsSync(cached)) { CLAUDE_BIN_CACHE = cached; return cached }
  } catch {}
  // Try PATH first
  const probe = os.platform() === 'win32'
    ? spawnSync('where', ['claude'], { encoding: 'utf8', windowsHide: true })
    : spawnSync('which', ['claude'], { encoding: 'utf8' })
  if (probe.status === 0 && probe.stdout?.trim()) {
    CLAUDE_BIN_CACHE = probe.stdout.trim().split(/\r?\n/)[0]
    persistClaudeBin(CLAUDE_BIN_CACHE)
    return CLAUDE_BIN_CACHE
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
        if (fs.existsSync(candidate)) { CLAUDE_BIN_CACHE = candidate; persistClaudeBin(candidate); return candidate }
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
      if (fs.existsSync(p)) { CLAUDE_BIN_CACHE = p; persistClaudeBin(p); return p }
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
          if (fs.existsSync(candidate)) { CLAUDE_BIN_CACHE = candidate; persistClaudeBin(candidate); return candidate }
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
          if (fs.existsSync(candidate)) { CLAUDE_BIN_CACHE = candidate; persistClaudeBin(candidate); return candidate }
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
    const runKey = `${skill} ${folderPath}`
    if (RUNNING_SKILLS.has(runKey)) {
      return res.status(409).json({ error: `${skill} is already running for this folder — wait for it to finish.` })
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
        nodeVersion: process.version,
        env: { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA, PATH_present: !!process.env.PATH },
      }, null, 2))
    } catch {}

    // Use pipe-based stdio + Node streams instead of inheriting raw fds. On
    // Windows detached + fd inheritance can silently drop subprocess output —
    // a piped stream that we drain to the log file is reliable. Drop detached
    // so the subprocess stays attached and any exit code is observable.
    RUNNING_SKILLS.add(runKey)
    let proc
    try {
      proc = spawn(claudeBin, args, {
        cwd: folderPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      })
    } catch (spawnErr) {
      RUNNING_SKILLS.delete(runKey)
      throw spawnErr
    }
    const logStream = fs.createWriteStream(logPath, { flags: 'a' })
    proc.stdout.pipe(logStream, { end: false })
    proc.stderr.pipe(logStream, { end: false })
    proc.on('exit', (code, signal) => {
      RUNNING_SKILLS.delete(runKey)
      try {
        logStream.write(`\n[spawn] exit code=${code} signal=${signal} at ${new Date().toISOString()}\n`)
        logStream.end()
      } catch {}
    })
    proc.on('error', (err) => {
      RUNNING_SKILLS.delete(runKey)
      try { logStream.write(`\n[spawn] error: ${err.message}\n`); logStream.end() } catch {}
      // Self-heal: a stale binary path (desktop app auto-updated and removed the old version
      // folder) surfaces here as ENOENT. Invalidate the cache (memory + disk) so the next run
      // re-resolves to the current install instead of failing forever.
      if (err && err.code === 'ENOENT') {
        CLAUDE_BIN_CACHE = null
        try { fs.unlinkSync(CLAUDE_BIN_CACHE_FILE) } catch {}
      }
    })
    res.json({ ok: true, pid: proc.pid, logPath, claudeBin, debugPath })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

let shutdownTimer = null
let activeConnections = 0

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
      shutdownTimer = setTimeout(() => process.exit(0), 3000)
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
