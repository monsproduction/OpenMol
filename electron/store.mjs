// Einstellungen und Daten der Oberfläche als lesbare JSON-Dateien im App-Ordner
// (Mac: ~/Library/Application Support/OpenMol/). Die Oberfläche lädt beim Start alles auf einmal und schreibt
// danach einzelne Werte; geschrieben wird gebündelt und sicher (temporäre Datei, dann umbenennen).
import { app, BrowserWindow, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

// ---------- Ort der eigenen Sammlungen ----------
// Standard: library.json im App-Ordner. Wählbar: ein eigener Ordner (z. B. iCloud, Dropbox, OneDrive) – dort liegt
// „OpenMol-Sammlungen.json“; so sind die Sammlungen auf mehreren Rechnern gleich. Der gewählte Ordner steht in
// library-location.json im App-Ordner (gehört bewusst nicht zur synchronisierten Datei).
const LIB_NAME = 'OpenMol-Sammlungen.json'
const locFile = () => path.join(app.getPath('userData'), 'library-location.json')
function libraryDir() {
  try {
    const d = JSON.parse(fs.readFileSync(locFile(), 'utf8'))?.dir
    if (typeof d === 'string' && path.isAbsolute(d)) return d
  } catch {
    // kein eigener Ort
  }
  return null
}
/** voller Pfad einer Datei: library.json ggf. im gewählten Ordner */
function filePath(file) {
  const dir = file === 'library.json' ? libraryDir() : null
  return dir ? path.join(dir, LIB_NAME) : path.join(app.getPath('userData'), file)
}
/** Änderungszeit der zuletzt gelesenen/geschriebenen Fassung (für Änderungen von einem anderen Rechner) */
const seenMtime = new Map()
const mtime = (p) => {
  try {
    return fs.statSync(p).mtimeMs
  } catch {
    return 0
  }
}

/** welcher Schlüssel in welche Datei gehört (Rest: settings.json) */
function fileFor(key) {
  if (key.startsWith('openmol:userlib')) return 'library.json'
  if (key.startsWith('openmol:autosave')) return 'autosave.json'
  return 'settings.json'
}

const data = new Map() // Dateiname → { Schlüssel: Wert (Text) }
const timers = new Map()

function load(file) {
  if (data.has(file)) return data.get(file)
  let v = {}
  try {
    const p = filePath(file)
    const j = JSON.parse(fs.readFileSync(p, 'utf8'))
    seenMtime.set(file, mtime(p))
    if (j && typeof j === 'object') v = j
  } catch {
    // fehlt oder beschädigt → leer beginnen (eine beschädigte Datei wird beim nächsten Schreiben ersetzt)
  }
  data.set(file, v)
  return v
}

function writeSoon(file) {
  clearTimeout(timers.get(file))
  timers.set(
    file,
    setTimeout(() => writeNow(file), 300),
  )
}

function writeNow(file) {
  timers.delete(file)
  const p = filePath(file)
  const tmp = p + '.tmp-' + process.pid
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    const text = JSON.stringify(data.get(file) ?? {}, null, 1)
    fs.writeFileSync(tmp, text)
    try {
      fs.renameSync(tmp, p)
    } catch {
      // Windows: Ziel kurz gesperrt (Virenscanner) → direkt schreiben
      fs.writeFileSync(p, text)
      fs.rmSync(tmp, { force: true })
    }
    seenMtime.set(file, mtime(p))
  } catch (e) {
    console.error('OpenMol: Speichern fehlgeschlagen', file, e)
  }
}

// Die Oberfläche speichert Text (oft JSON). Objekte, Listen, Zahlen und Wahrheitswerte kommen als echtes JSON in die
// Datei (lesbar), alles andere als Text; beim Laden wird daraus wieder genau der ursprüngliche Text.
function readable(text) {
  try {
    const j = JSON.parse(text)
    if (j !== null && typeof j !== 'string' && JSON.stringify(j) === text.trim()) return j
  } catch {
    // kein JSON
  }
  return text
}
const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v))

/** Wert aus den gespeicherten Einstellungen lesen (für den Hauptprozess, z. B. „automatisch nach Updates suchen“) */
export function readStored(key) {
  const v = load(fileFor(key))[key]
  if (typeof v !== 'string') return v
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}

export function initStore(ipcMain) {
  ipcMain.on('openmol:store-all', (e) => {
    const all = {}
    for (const f of ['settings.json', 'library.json', 'autosave.json']) for (const [k, v] of Object.entries(load(f))) all[k] = asText(v)
    e.returnValue = all
  })
  ipcMain.on('openmol:store-dir', (e) => {
    e.returnValue = app.getPath('userData')
  })
  ipcMain.on('openmol:store-set', (_e, key, value) => {
    if (typeof key !== 'string' || !key.startsWith('openmol:')) return
    const file = fileFor(key)
    const v = load(file)
    if (value === null || value === undefined) delete v[key]
    else v[key] = readable(String(value))
    writeSoon(file)
  })
  // Ort der Sammlungen: anzeigen, wählen (vorhandene Sammlungen dort werden zusammengeführt), zurücksetzen
  ipcMain.handle('openmol:library-location', () => ({ dir: libraryDir(), path: filePath('library.json') }))
  ipcMain.handle('openmol:library-choose', async (e, reset) => {
    let dir = null
    if (!reset) {
      const win = BrowserWindow.fromWebContents(e.sender)
      // Tests ohne Dialog: OPENMOL_TEST_LIBDIR
      const r = process.env.OPENMOL_TEST_LIBDIR
        ? { canceled: false, filePaths: [process.env.OPENMOL_TEST_LIBDIR] }
        : await dialog.showOpenDialog(win, { title: 'Ordner für eigene Sammlungen', properties: ['openDirectory', 'createDirectory'] })
      if (r.canceled || !r.filePaths[0]) return null
      dir = r.filePaths[0]
    }
    const r = moveLibrary(dir)
    // die Oberfläche übernimmt die zusammengeführten Sammlungen
    for (const [k, v] of Object.entries(r.values)) e.sender.send('openmol:store-reload', k, v)
    return r
  })
  // Änderungen von einem anderen Rechner (Cloud-Ordner): beim Zurückkehren ins Fenster neu lesen
  app.on('browser-window-focus', (_e, win) => {
    const p = filePath('library.json')
    if (!libraryDir() || timers.has('library.json') || mtime(p) <= (seenMtime.get('library.json') ?? 0)) return
    data.delete('library.json')
    const v = load('library.json')
    for (const [k, val] of Object.entries(v)) win.webContents.send('openmol:store-reload', k, asText(val))
  })
  // beim Beenden ausstehende Änderungen sofort schreiben
  app.on('will-quit', () => {
    for (const f of [...timers.keys()]) {
      clearTimeout(timers.get(f))
      writeNow(f)
    }
  })
}

/** Sammlungen zusammenführen: Sammlungen nach Id, darin Vorlagen nach Id (vorhandene bleiben, neue kommen dazu) */
function mergeLib(a, b) {
  const pa = typeof a === 'string' ? safeJson(a) : a
  const pb = typeof b === 'string' ? safeJson(b) : b
  if (!pa) return pb
  if (!pb) return pa
  const cols = [...(pa.collections ?? [])]
  for (const c of pb.collections ?? []) {
    const ex = cols.find((x) => x.id === c.id)
    if (!ex) cols.push(c)
    else for (const it of c.items ?? []) if (!(ex.items ?? []).some((x) => x.id === it.id)) (ex.items ??= []).push(it)
  }
  return { ...pa, collections: cols, hiddenBuiltin: [...new Set([...(pa.hiddenBuiltin ?? []), ...(pb.hiddenBuiltin ?? [])])] }
}
function safeJson(t) {
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

/** neuen Ort für die Sammlungen setzen (null = App-Ordner); Rückgabe: neuer Ort und zusammengeführter Inhalt */
function moveLibrary(dir) {
  // ausstehendes zuerst an den alten Ort schreiben
  if (timers.has('library.json')) {
    clearTimeout(timers.get('library.json'))
    writeNow('library.json')
  }
  const current = load('library.json')
  if (dir) fs.writeFileSync(locFile(), JSON.stringify({ dir }))
  else fs.rmSync(locFile(), { force: true })
  // am neuen Ort vorhandene Datei lesen und mit den aktuellen Sammlungen zusammenführen
  data.delete('library.json')
  const there = load('library.json')
  const merged = { ...there, ...current }
  for (const k of new Set([...Object.keys(current), ...Object.keys(there)])) if (k in current && k in there) merged[k] = mergeLib(there[k], current[k])
  data.set('library.json', merged)
  writeNow('library.json')
  return { dir, path: filePath('library.json'), values: Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, asText(v)])) }
}
