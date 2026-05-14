const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawnSync, spawn } = require('child_process')
const mammoth = require('mammoth')
const PizZip = require('pizzip')
const Docxtemplater = require('docxtemplater')
const { google } = require('googleapis')
const { scanFolder } = require('./scanner')

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
const VQ_PAIRS = [['AP','AQ'], ['AR','AS'], ['AT','AU'], ['AV','AW']]
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
// file, never a half-written state. Backup is taken from the live file BEFORE
// the swap so it always reflects the most recently committed state.
function writeDeals(deals) {
  backupDealsBefore(DEALS_FILE)
  const tmpPath = DEALS_FILE + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(deals, null, 2))
  fs.renameSync(tmpPath, DEALS_FILE)
}

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

const WANTED_COLS = ['A','C','AC','AD','AE','AF','AG','AH','AI','AJ','AN','AP','AQ','AR','AS','AT','AU','AV','AW']

const IQ_COLS = ['AC','AD','AE','AF','AG','AH','AI','AJ']
const VQ_COLS = ['AP','AQ','AR','AS','AT','AU','AV','AW']

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
app.use(express.json())

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
      range: `${sheet.properties.title}!A7:AW`
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
      deals[idx].folderPath = null
      writeDeals(deals)
      return res.status(404).json({ error: 'Folder no longer exists', cleared: true })
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
  fs.writeFileSync(B2B_PARTNERS_FILE, JSON.stringify(data, null, 2))
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
      deals[idx].agreements.splice(agreeIdx, 1)
      writeDeals(deals)
      return res.status(404).json({ error: 'File not found on disk', cleared: true })
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
      deals[idx].agreements.splice(agreeIdx, 1)
      writeDeals(deals)
      return res.status(404).json({ error: 'File not found on disk', cleared: true })
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

// POST /api/data/pick-folder — open native folder picker, return selected path
app.post('/api/data/pick-folder', (req, res) => {
  try {
    let folderPath
    if (os.platform() === 'win32') {
      const result = spawnSync('powershell', ['-STA', '-Command',
        `$s = New-Object -ComObject Shell.Application; $f = $s.BrowseForFolder(0, 'Select folder containing royalty statements', 0x240, '${DATA_ROOT.replace(/'/g, "''")}'); if ($f) { $f.Self.Path } else { '' }`
      ], { encoding: 'utf8', timeout: 60000 })
      folderPath = result.stdout?.trim()
    } else {
      const result = spawnSync('osascript', ['-e', `POSIX path of (choose folder with prompt "Select folder containing royalty statements" default location POSIX file "${DATA_ROOT}")`],
        { encoding: 'utf8', timeout: 60000 })
      folderPath = result.stdout?.trim().replace(/\/$/, '')
    }

    if (!folderPath) return res.json({ cancelled: true })
    res.json({ ok: true, folderPath })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/data/scan-folder — recursively scan a picked folder for platform source data files.
// Never writes to disk, reads zips in-memory only, preserves data integrity per CLAUDE.md V2 rule.
app.post('/api/data/scan-folder', async (req, res) => {
  try {
    const { folderPath } = req.body || {}
    if (!folderPath || typeof folderPath !== 'string') {
      return res.status(400).json({ error: 'folderPath is required' })
    }
    const result = await scanFolder(folderPath)
    res.json({ ok: true, ...result })
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
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
