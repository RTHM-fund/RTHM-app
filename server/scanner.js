// Data Manager — folder scanner (V2 Step 1)
// Walks a selected folder, identifies platform source data files, respects data integrity rule.
// Source files are never modified. Zips are read in-memory only.

const fs = require('fs').promises
const path = require('path')
const yauzl = require('yauzl')

// Unified skip list — applies to both filenames and folder names (case-insensitive substring)
const SKIP_WORDS = [
  'merged', 'summary', 'basic', 'quote', 'analytics', 'listing', 'combined',
  'analysis', 'analyses', 'updated', 'sale', 'edit', 'edited', 'working',
  'draft', 'temp', 'review', 'processed', 'archive'
]

const DATA_EXTENSIONS = new Set(['.csv', '.xlsx', '.xls', '.tsv'])
const ZIP_EXTENSION = '.zip'
const SYSTEM_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

function matchedSkipWord(name) {
  const lower = name.toLowerCase()
  return SKIP_WORDS.find(w => lower.includes(w)) || null
}

function isSystemFile(name) {
  if (name.startsWith('~$')) return true
  if (SYSTEM_FILES.has(name)) return true
  if (name.startsWith('.')) return true
  return false
}

function getExt(filename) {
  return path.extname(filename).toLowerCase()
}

function getBasename(filename) {
  return path.parse(filename).name.toLowerCase()
}

// Open a zip file with yauzl (lazy, autoClose off so we control lifecycle)
function openZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
      if (err) return reject(err)
      resolve(zipfile)
    })
  })
}

// Enumerate all entries in a zip (names + sizes only — no content reads)
function listZipEntries(zipfile) {
  return new Promise((resolve, reject) => {
    const entries = []
    zipfile.on('entry', (entry) => {
      entries.push(entry)
      zipfile.readEntry()
    })
    zipfile.on('end', () => resolve(entries))
    zipfile.on('error', reject)
    zipfile.readEntry()
  })
}

// Process one zip in-memory — enumerate contents, apply filters, return {included, skipped, error}
async function processZip(zipPath, relativePath) {
  const results = { included: [], skipped: [], error: null }
  let zipfile
  try {
    zipfile = await openZip(zipPath)
  } catch (err) {
    results.error = { path: relativePath, reason: `failed to open zip: ${err.message}` }
    return results
  }

  let entries
  try {
    entries = await listZipEntries(zipfile)
  } catch (err) {
    results.error = { path: relativePath, reason: `corrupt or unreadable zip: ${err.message}` }
    try { zipfile.close() } catch {}
    return results
  }
  try { zipfile.close() } catch {}

  if (entries.length === 0) {
    results.error = { path: relativePath, reason: 'zip contains no entries' }
    return results
  }

  for (const entry of entries) {
    const entryPath = entry.fileName // always forward-slash in zip spec
    if (entryPath.endsWith('/')) continue // directory entry
    if (entryPath.startsWith('__MACOSX/') || entryPath.includes('/__MACOSX/')) continue

    const entryName = entryPath.split('/').pop()
    if (isSystemFile(entryName)) continue

    const ext = getExt(entryName)
    const displayPath = `${relativePath}::${entryPath}`

    // Nested zip — fail loud for the whole zip
    if (ext === ZIP_EXTENSION) {
      results.error = { path: relativePath, reason: `nested zip detected: ${entryPath}` }
      return results
    }

    if (!DATA_EXTENSIONS.has(ext)) continue // silent skip non-data

    // Check zip-internal folders against skip list
    const folderParts = entryPath.split('/').slice(0, -1)
    const matchedFolder = folderParts.map(p => matchedSkipWord(p)).find(Boolean)
    if (matchedFolder) {
      results.skipped.push({ path: displayPath, reason: `folder skip: "${matchedFolder}"` })
      continue
    }

    // Check filename against skip list
    const matchedName = matchedSkipWord(entryName)
    if (matchedName) {
      results.skipped.push({ path: displayPath, reason: `filename skip: "${matchedName}"` })
      continue
    }

    if (entry.uncompressedSize === 0) continue // silent skip 0-byte

    results.included.push({
      path: displayPath,
      filename: entryName,
      ext,
      size: entry.uncompressedSize,
      source: `zip:${relativePath}`
    })
  }

  return results
}

// Recursive filesystem walker — collects loose data files + zips, records skipped items
async function walkDisk(rootPath, relativePath, accumulator) {
  const absDir = relativePath ? path.join(rootPath, relativePath) : rootPath
  let entries
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true })
  } catch (err) {
    accumulator.errors.push({ path: relativePath || '(root)', reason: `cannot read folder: ${err.message}` })
    return
  }

  for (const entry of entries) {
    const name = entry.name
    const childRel = relativePath ? path.join(relativePath, name) : name

    // Symlinks — skip (never follow)
    if (entry.isSymbolicLink()) {
      accumulator.skipped.push({ path: childRel, reason: 'symlink (not followed)' })
      continue
    }

    if (isSystemFile(name)) continue // silent

    if (entry.isDirectory()) {
      const skipWord = matchedSkipWord(name)
      if (skipWord) {
        accumulator.skipped.push({ path: childRel, reason: `folder skip: "${skipWord}"` })
        continue
      }
      await walkDisk(rootPath, childRel, accumulator)
      continue
    }

    if (!entry.isFile()) continue // ignore sockets, devices, etc.

    const ext = getExt(name)

    // Read size
    let stats
    try {
      stats = await fs.stat(path.join(rootPath, childRel))
    } catch (err) {
      accumulator.errors.push({ path: childRel, reason: `cannot stat file: ${err.message}` })
      continue
    }
    if (stats.size === 0) continue // silent skip

    // Filename skip applies only to data-relevant extensions (csv/xlsx/xls/tsv/zip)
    const isData = DATA_EXTENSIONS.has(ext) || ext === ZIP_EXTENSION
    if (!isData) continue // silent skip non-data

    const skipWord = matchedSkipWord(name)
    if (skipWord) {
      accumulator.skipped.push({ path: childRel, reason: `filename skip: "${skipWord}"` })
      continue
    }

    if (ext === ZIP_EXTENSION) {
      accumulator.zips.push({
        fullPath: path.join(rootPath, childRel),
        relativePath: childRel,
        name,
        size: stats.size
      })
    } else {
      accumulator.looseFiles.push({
        path: childRel,
        filename: name,
        ext,
        size: stats.size,
        source: 'direct'
      })
    }
  }
}

// Main entry point — scan a folder, return {included, skipped, errors, warnings}
async function scanFolder(rootPath) {
  let rootStat
  try {
    rootStat = await fs.stat(rootPath)
  } catch (err) {
    throw new Error(`folder not found: ${rootPath}`)
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`not a directory: ${rootPath}`)
  }

  const accumulator = { looseFiles: [], zips: [], skipped: [], errors: [] }
  await walkDisk(rootPath, '', accumulator)

  // Dedup — if zip basename matches any loose file basename anywhere in tree, skip zip
  const looseBasenames = new Set(accumulator.looseFiles.map(f => getBasename(f.filename)))
  const processableZips = []
  for (const zip of accumulator.zips) {
    const base = getBasename(zip.name)
    if (looseBasenames.has(base)) {
      accumulator.skipped.push({
        path: zip.relativePath,
        reason: `dedup: extracted version found (basename "${base}")`
      })
    } else {
      processableZips.push(zip)
    }
  }

  // Process remaining zips in-memory
  for (const zip of processableZips) {
    const zipResults = await processZip(zip.fullPath, zip.relativePath)
    if (zipResults.error) {
      accumulator.errors.push(zipResults.error)
      continue
    }
    accumulator.skipped.push(...zipResults.skipped)
    accumulator.looseFiles.push(...zipResults.included)
  }

  // Warnings — mixed file types
  const warnings = []
  const extCounts = {}
  for (const f of accumulator.looseFiles) {
    extCounts[f.ext] = (extCounts[f.ext] || 0) + 1
  }
  const distinctExts = Object.keys(extCounts)
  if (distinctExts.length > 1) {
    const summary = distinctExts.sort().map(e => `${e} (${extCounts[e]})`).join(', ')
    warnings.push(`mixed file types found: ${summary}. platforms usually export one type.`)
  }

  // Sort included alphabetically by path for predictable UI display
  accumulator.looseFiles.sort((a, b) => a.path.localeCompare(b.path))
  accumulator.skipped.sort((a, b) => a.path.localeCompare(b.path))

  return {
    folderPath: rootPath,
    included: accumulator.looseFiles,
    skipped: accumulator.skipped,
    errors: accumulator.errors,
    warnings
  }
}

module.exports = { scanFolder }
