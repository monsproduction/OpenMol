// Einstellungen und Daten der Oberfläche als lesbare JSON-Dateien im App-Ordner
// (Mac: ~/Library/Application Support/OpenMol/). Die Oberfläche lädt beim Start alles auf einmal und schreibt
// danach einzelne Werte; geschrieben wird gebündelt und sicher (temporäre Datei, dann umbenennen).
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

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
    const j = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), file), 'utf8'))
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
  const p = path.join(app.getPath('userData'), file)
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
  // beim Beenden ausstehende Änderungen sofort schreiben
  app.on('will-quit', () => {
    for (const f of [...timers.keys()]) {
      clearTimeout(timers.get(f))
      writeNow(f)
    }
  })
}
