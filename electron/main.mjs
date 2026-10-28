// OpenMol als Desktop-App (Electron) – Hauptprozess.
// Die Oberfläche ist dieselbe React-App wie im Browser; sie wird über das eigene Protokoll app://openmol/ aus dem
// gebauten Ordner dist/ geladen (in der Entwicklung vom Vite-Server). Alles, was der Browser nicht kann
// (Datei-Dialoge, Menüleiste, Einstellungen als Datei), läuft hier und ist der Oberfläche nur über die schmale
// Brücke in preload.cjs zugänglich.
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron'
import { scanClipboard, writePng } from './clipboard.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildMenu, menuLang, setMenuLang } from './menu.mjs'
import { initStore } from './store.mjs'
import { checkForUpdates, scheduleAutoCheck } from './updater.mjs'
import { checkWordAddinOnStart, refreshAddinManifest, setResult, setupWordAddin } from './wordAddin.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(here, '..', 'dist')
const DEV_URL = process.env.OPENMOL_DEV_URL // gesetzt von electron/dev.mjs
const APP_ORIGIN = 'app://openmol'

// Sicherheitsregeln für die Oberfläche: nur eigene Inhalte; Netz nur zu PubChem, Wikidata und dem lokalen
// MCP-Server (KI-Steuerung)
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  'connect-src ' + ["'self'", 'https://pubchem.ncbi.nlm.nih.gov', 'https://query.wikidata.org', 'http://127.0.0.1:5181'].join(' '),
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ')

// für Tests: eigener Ordner für Einstellungen/Daten (statt ~/Library/Application Support/OpenMol)
if (process.env.OPENMOL_USERDATA) app.setPath('userData', path.resolve(process.env.OPENMOL_USERDATA))

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])

// nur eine laufende App; ein zweiter Start (z. B. Doppelklick auf eine Datei) übergibt seine Dateien
if (!app.requestSingleInstanceLock()) app.quit()

/** Dateien, die die Oberfläche lesen/schreiben darf: nur, was der Nutzer per Dialog gewählt oder geöffnet hat */
const allowed = new Set()
const allow = (p) => {
  allowed.add(path.resolve(p))
  return p
}

let win = null
let quitting = false
// beim Start übergebene Dateien (Finder-Doppelklick, bevor das Fenster bereit ist)
const pendingOpen = []

function isDocFile(p) {
  return /\.(openmol|chemdoc\.json|json|mol|sdf|smi|cdxml|txt)$/i.test(p)
}

function sendOpen(p) {
  if (!isDocFile(p)) return
  allow(p)
  if (win && !win.webContents.isLoading()) win.webContents.send('openmol:open-path', p)
  else pendingOpen.push(p)
}

// ---------- Fenster ----------

const boundsFile = () => path.join(app.getPath('userData'), 'window.json')
function loadBounds() {
  try {
    return JSON.parse(fs.readFileSync(boundsFile(), 'utf8'))
  } catch {
    return { width: 1400, height: 900 }
  }
}
function saveBounds() {
  if (!win || win.isDestroyed()) return
  try {
    fs.writeFileSync(boundsFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }))
  } catch {
    // ohne Schreibrecht: nächstes Mal Standardgröße
  }
}

function createWindow() {
  const b = loadBounds()
  win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width ?? 1400,
    height: b.height ?? 900,
    minWidth: 900,
    minHeight: 600,
    title: 'OpenMol',
    backgroundColor: '#14171c',
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  })
  if (b.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())
  win.on('resize', saveBounds)
  win.on('move', saveBounds)

  // keine fremden Seiten im App-Fenster: Links öffnen im Standardbrowser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const own = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith(APP_ORIGIN + '/')
    if (!own) {
      e.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })

  // Schließen: bei ungespeicherten Änderungen fragt die Oberfläche selbst nach (sie kennt den Zustand)
  // hängt die Oberfläche, darf das Schließen nicht an der Nachfrage scheitern (Autosave sichert die Zeichnung)
  let hung = false
  win.webContents.on('unresponsive', () => (hung = true))
  win.webContents.on('responsive', () => (hung = false))
  win.webContents.on('render-process-gone', () => (hung = true))
  win.on('close', (e) => {
    saveBounds()
    if (win.__closeOk || hung) return
    e.preventDefault()
    win.webContents.send('openmol:close-request', { quitting })
    // antwortet die Oberfläche nicht (z. B. gerade beschäftigt), nach 15 s trotzdem schließen dürfen
    clearTimeout(win.__closeTimer)
    win.__closeTimer = setTimeout(() => {
      if (win && !win.isDestroyed() && hung) {
        win.__closeOk = true
        win.close()
      }
    }, 15000)
  })
  win.on('closed', () => {
    win = null
  })
  win.webContents.on('did-finish-load', () => {
    for (const p of pendingOpen.splice(0)) win?.webContents.send('openmol:open-path', p)
  })

  void win.loadURL(DEV_URL ?? APP_ORIGIN + '/index.html')
}

// ---------- Protokoll app://openmol/ (liefert dist/ aus) ----------

function serveApp() {
  protocol.handle('app', async (req) => {
    const u = new URL(req.url)
    if (u.host !== 'openmol') return new Response('not found', { status: 404 })
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html'
    const file = path.resolve(DIST, rel)
    // nichts außerhalb von dist/ ausliefern
    if (!file.startsWith(DIST + path.sep)) return new Response('forbidden', { status: 403 })
    const res = await net.fetch(pathToFileURL(file).toString())
    const headers = new Headers(res.headers)
    if (/\.html?$/i.test(file)) headers.set('Content-Security-Policy', CSP)
    return new Response(res.body, { status: res.status, headers })
  })
}

/** Menüpunkte, die der Hauptprozess selbst ausführt */
// Word-Add-in: eine Bearbeitung aus Word kommt an → Zeichnung in OpenMol öffnen, Fenster nach vorn
const addinHandlers = {
  onEdit: (edit) => {
    if (!win) createWindow()
    win.webContents.send('openmol:word-edit', edit)
    if (win.isMinimized()) win.restore()
    win.show()
    if (process.platform === 'win32') {
      // Windows holt ein Fenster eines anderen Programms sonst nicht nach vorn (blinkt nur in der Taskleiste) – UNGETESTET
      win.setAlwaysOnTop(true)
      win.focus()
      win.setAlwaysOnTop(false)
    } else win.focus()
    app.focus({ steal: true })
  },
}
const menuActions = {
  checkUpdates: () => void checkForUpdates(() => win, { manual: true }),
  wordAddin: () => void setupWordAddin(win, addinHandlers, !!process.env.OPENMOL_TEST_DIALOGS),
}

// ---------- Brücke zur Oberfläche ----------

const FILTERS = {
  doc: [
    { name: 'OpenMol-Dokument', extensions: ['openmol'] },
    { name: 'Alle unterstützten Formate', extensions: ['openmol', 'json', 'mol', 'sdf', 'smi', 'cdxml', 'txt'] },
  ],
  open: [
    { name: 'Alle unterstützten Formate', extensions: ['openmol', 'json', 'mol', 'sdf', 'smi', 'cdxml', 'txt'] },
    { name: 'OpenMol-Dokument', extensions: ['openmol', 'json'] },
    { name: 'ChemDraw (CDXML)', extensions: ['cdxml'] },
    { name: 'Molfile / SDF', extensions: ['mol', 'sdf'] },
    { name: 'SMILES', extensions: ['smi', 'txt'] },
  ],
}

// Nur für automatische Tests (Umgebungsvariable OPENMOL_TEST_DIALOGS = Ordner): Dialoge beantworten sich selbst –
// Sichern → Datei in diesem Ordner, Öffnen → Datei aus OPENMOL_TEST_OPEN, Rückfragen → Knopf OPENMOL_TEST_CONFIRM.
const TEST_DIR = process.env.OPENMOL_TEST_DIALOGS
const testDialogs = TEST_DIR
  ? {
      open: () => (process.env.OPENMOL_TEST_OPEN ? { canceled: false, filePaths: [process.env.OPENMOL_TEST_OPEN] } : { canceled: true, filePaths: [] }),
      save: (opts) => {
        console.log('[test-dialog] save', path.basename(opts.defaultPath ?? ''))
        return { canceled: false, filePath: path.join(TEST_DIR, path.basename(opts.defaultPath ?? 'Unbenannt')) }
      },
      confirm: (opts) => {
        console.log('[test-dialog] confirm', opts?.message ?? '', '|', (opts?.detail ?? '').replace(/\n/g, ' / '))
        return { response: Number(fs.existsSync(path.join(TEST_DIR, 'confirm.txt')) ? fs.readFileSync(path.join(TEST_DIR, 'confirm.txt'), 'utf8') : 0) }
      },
    }
  : null

// Datei-Dialoge beginnen im zuletzt benutzten Ordner (Öffnen, Speichern und Export gemeinsam)
const dirFile = () => path.join(app.getPath('userData'), 'dialogs.json')
let lastDir = null
function startDir() {
  if (!lastDir) {
    try {
      lastDir = JSON.parse(fs.readFileSync(dirFile(), 'utf8')).lastDir ?? null
    } catch {
      lastDir = null
    }
  }
  return lastDir && fs.existsSync(lastDir) ? lastDir : app.getPath('documents')
}
function rememberDir(file) {
  lastDir = path.dirname(file)
  try {
    fs.writeFileSync(dirFile(), JSON.stringify({ lastDir }))
  } catch {
    // ohne Schreibrecht: nur für diese Sitzung
  }
}

function registerIpc() {
  ipcMain.handle('openmol:open-dialog', async (_e, opts = {}) => {
    const r = testDialogs ? testDialogs.open() : await dialog.showOpenDialog(win, {
      title: opts.title ?? 'Öffnen',
      defaultPath: startDir(),
      properties: ['openFile'],
      filters: opts.filters ?? FILTERS.open,
    })
    if (r.canceled || !r.filePaths[0]) return null
    rememberDir(r.filePaths[0])
    return readDoc(allow(r.filePaths[0]))
  })

  // Zuletzt verwendete Dokumente: nur vorhandene Dateien; öffnen nur, was in der Liste steht
  ipcMain.handle('openmol:recent', () =>
    loadRecent()
      .filter((x) => fs.existsSync(x.path))
      .slice(0, 8)
      .map((x) => ({ path: x.path, name: path.basename(x.path), time: x.time })),
  )
  ipcMain.handle('openmol:open-recent', async (_e, p) => {
    const abs = path.resolve(String(p))
    if (!loadRecent().some((x) => x.path === abs) || !fs.existsSync(abs)) return null
    return readDoc(allow(abs))
  })

  ipcMain.handle('openmol:read-path', async (_e, p) => {
    if (!allowed.has(path.resolve(p))) throw new Error('Datei nicht freigegeben')
    return readDoc(p)
  })

  ipcMain.handle('openmol:save-dialog', async (_e, opts = {}) => {
    const o = {
      title: opts.title ?? 'Speichern',
      defaultPath: path.join(opts.dir ?? startDir(), opts.defaultPath ?? ''),
      filters: opts.filters ?? FILTERS.doc,
    }
    const r = testDialogs ? testDialogs.save(o) : await dialog.showSaveDialog(win, o)
    if (r.canceled || !r.filePath) return null
    rememberDir(r.filePath)
    return allow(r.filePath)
  })

  // PDF: die Oberfläche liefert eine HTML-Seite mit je einem SVG pro Blatt; ein unsichtbares Fenster ohne JavaScript
  // druckt sie als Vektor-PDF (Schriften eingebettet). Gespeichert wird danach über den normalen Speichern-Dialog.
  /** Seiten in ein unsichtbares Fenster ohne JavaScript laden und damit arbeiten (PDF erzeugen bzw. drucken) */
  async function withPageWindow(html, size, fn) {
    const w = Number(size?.width)
    const h = Number(size?.height)
    if (typeof html !== 'string' || html.length > 200e6 || !(w > 0.5 && w < 200) || !(h > 0.5 && h < 200)) throw new Error('ungültige Seite')
    const tmp = path.join(app.getPath('temp'), `openmol-pdf-${process.pid}-${Date.now()}.html`)
    await fs.promises.writeFile(tmp, html, 'utf8')
    const pw = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false } })
    pw.webContents.on('will-navigate', (e) => e.preventDefault())
    try {
      await pw.loadFile(tmp)
      return await fn(pw.webContents, w, h)
    } finally {
      pw.destroy()
      fs.promises.rm(tmp, { force: true }).catch(() => {})
    }
  }
  ipcMain.handle('openmol:print-pdf', (_e, html, size) =>
    withPageWindow(html, size, async (wc, w, h) => {
      const buf = await wc.printToPDF({ pageSize: { width: w, height: h }, margins: { marginType: 'none' }, printBackground: true, preferCSSPageSize: true })
      return new Uint8Array(buf)
    }),
  )
  // Drucken: dieselben Seiten mit dem Druckdialog des Systems (Seitengröße in Mikrometern); Abbrechen ist kein Fehler
  ipcMain.handle('openmol:print', (_e, html, size) =>
    withPageWindow(
      html,
      size,
      (wc, w, h) =>
        new Promise((resolve) =>
          wc.print({ silent: false, printBackground: true, margins: { marginType: 'none' }, pageSize: { width: Math.round(w * 25400), height: Math.round(h * 25400) } }, (ok, reason) =>
            resolve({ ok, canceled: !ok && /cancel/i.test(String(reason ?? '')), reason: ok ? '' : String(reason ?? '') }),
          ),
        ),
    ),
  )

  // ---------- Zwischenablage: Bild mit OpenMol-Daten (OM1:…) schreiben und zurück lesen ----------
  // Wie genau geschrieben wird (Mac roh als public.png, Windows zusätzlich im Office-Format „PNG“): electron/clipboard.mjs
  ipcMain.handle('openmol:clip-write', (_e, kind, data) => (kind === 'png' && data instanceof Uint8Array ? writePng(data) : false))
  ipcMain.handle('openmol:clip-scan', () => scanClipboard())
  // „Zurück nach Word“: fertiges Bild für die wartende Add-in-Seite bereitlegen
  ipcMain.handle('openmol:word-result', (_e, session, png) => setResult(String(session), png))

  ipcMain.handle('openmol:write-file', async (_e, p, data) => {
    if (!allowed.has(path.resolve(p))) throw new Error('Datei nicht freigegeben')
    // sicher schreiben: erst daneben, dann umbenennen (kein halbes Dokument bei Absturz)
    const tmp = p + '.tmp-' + process.pid
    const buf = typeof data === 'string' ? data : Buffer.from(data)
    await fs.promises.writeFile(tmp, buf)
    try {
      await fs.promises.rename(tmp, p)
    } catch {
      // Windows: Ziel kurz gesperrt (Virenscanner, Vorschau) → direkt schreiben
      await fs.promises.writeFile(p, buf)
      await fs.promises.rm(tmp, { force: true })
    }
    return true
  })

  ipcMain.on('openmol:doc-state', (_e, s) => {
    if (!win) return
    if (process.platform === 'darwin') {
      // macOS: Punkt im Schließen-Knopf, Datei im Titel per ⌘-Klick
      win.setTitle(s.title || 'OpenMol')
      win.setDocumentEdited(!!s.dirty)
      win.setRepresentedFilename(s.path && fs.existsSync(s.path) ? s.path : '')
    } else {
      // Windows/Linux: „Name* – OpenMol“
      win.setTitle(`${s.title || 'Unbenannt'}${s.dirty ? '*' : ''} – OpenMol`)
    }
    if (s.path) {
      app.addRecentDocument(s.path)
      addRecent(s.path)
    }
  })

  ipcMain.on('openmol:close-ok', () => {
    if (!win) return
    win.__closeOk = true
    win.close()
    if (quitting) app.quit()
  })
  ipcMain.on('openmol:close-cancel', () => {
    quitting = false
  })

  // Lizenzen von Electron und Chromium (liegen der App bei; in der Entwicklung im Electron-Paket)
  ipcMain.handle('openmol:open-licenses', async () => {
    const f = app.isPackaged ? path.join(process.resourcesPath, 'LICENSES.chromium.html') : path.join(here, '..', 'node_modules', 'electron', 'dist', 'LICENSES.chromium.html')
    if (fs.existsSync(f)) await shell.openPath(f)
  })
  ipcMain.handle('openmol:open-external', async (_e, url) => {
    // Webseiten und E-Mail-Adressen (mailto: Kontakt in „Über OpenMol“)
    if (/^(https?:\/\/|mailto:[^\s/]+@[^\s/]+$)/i.test(url)) await shell.openExternal(url)
  })

  // Kopieren/Einfügen/Rückgängig in Textfeldern: das System übernimmt (vom Menü über die Oberfläche angestoßen)
  ipcMain.on('openmol:native-edit', (_e, cmd) => {
    const wc = win?.webContents
    if (!wc) return
    const f = { undo: 'undo', redo: 'redo', cut: 'cut', copy: 'copy', paste: 'paste', selectAll: 'selectAll', delete: 'delete' }[cmd]
    if (f) wc[f]()
  })

  // Sprache der Oberfläche → Menüleiste neu aufbauen
  ipcMain.on('openmol:ui-lang', (_e, l) => {
    const changed = l !== menuLang()
    setMenuLang(l)
    Menu.setApplicationMenu(buildMenu(() => win, menuActions))
    // Word-Add-in in derselben Sprache (wirkt nach einem Neustart von Word)
    if (changed) refreshAddinManifest()
  })

  // KI-Steuerung: der mitgelieferte MCP-Server; OpenMol selbst führt ihn aus (ELECTRON_RUN_AS_NODE=1 → wie Node.js),
  // daher braucht der Rechner kein eigenes Node.js
  ipcMain.on('openmol:mcp-info', (e) => {
    const server = app.isPackaged ? path.join(process.resourcesPath, 'mcp', 'server.mjs') : path.join(here, '..', 'mcp', 'server.mjs')
    e.returnValue = { command: process.execPath, server, env: { ELECTRON_RUN_AS_NODE: '1' }, available: fs.existsSync(server) }
  })

  // Updates: Version anzeigen, „Jetzt nach Updates suchen“
  ipcMain.on('openmol:app-version', (e) => {
    e.returnValue = app.getVersion()
  })
  ipcMain.on('openmol:update-check', () => void checkForUpdates(() => win, { manual: true }))

  ipcMain.on('openmol:show-settings-dir', () => {
    void shell.openPath(app.getPath('userData'))
  })

  ipcMain.handle('openmol:confirm', async (_e, opts) => {
    const r = testDialogs ? testDialogs.confirm(opts) : await dialog.showMessageBox(win, {
      type: opts.type ?? 'question',
      message: opts.message,
      detail: opts.detail,
      buttons: opts.buttons ?? ['OK', 'Abbrechen'],
      defaultId: 0,
      cancelId: opts.cancelId ?? (opts.buttons?.length ?? 2) - 1,
    })
    return r.response
  })
}

// ---------- Zuletzt verwendete Dokumente (leere Zeichenfläche zeigt sie an) ----------

const recentFile = () => path.join(app.getPath('userData'), 'recent.json')
function loadRecent() {
  try {
    const j = JSON.parse(fs.readFileSync(recentFile(), 'utf8'))
    return Array.isArray(j) ? j.filter((x) => typeof x?.path === 'string') : []
  } catch {
    return []
  }
}
function addRecent(p) {
  const abs = path.resolve(p)
  const list = loadRecent().filter((x) => x.path !== abs)
  list.unshift({ path: abs, time: Date.now() })
  try {
    fs.writeFileSync(recentFile(), JSON.stringify(list.slice(0, 12)))
  } catch {
    // nicht schreibbar – Liste ist nur eine Bequemlichkeit
  }
}

async function readDoc(p) {
  const buf = await fs.promises.readFile(p)
  return { path: p, name: path.basename(p), text: buf.toString('utf8') }
}

// ---------- App-Lebenszyklus ----------

app.on('open-file', (e, p) => {
  // macOS: Doppelklick im Finder, Ablegen aufs Dock-Icon, „Zuletzt geöffnet“
  e.preventDefault()
  sendOpen(p)
})

app.on('second-instance', (_e, argv) => {
  for (const a of argv.slice(1)) if (!a.startsWith('-') && fs.existsSync(a)) sendOpen(a)
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('before-quit', () => {
  quitting = true
})


app.whenReady().then(() => {
  initStore(ipcMain)
  serveApp()
  registerIpc()
  Menu.setApplicationMenu(buildMenu(() => win, menuActions))
  // Windows/Linux: Datei als Startargument
  for (const a of process.argv.slice(1)) if (!a.startsWith('-') && fs.existsSync(a) && isDocFile(a)) sendOpen(a)
  createWindow()
  scheduleAutoCheck(() => win)
  // Word-Add-in (Mac): Server nur, wenn es schon eingerichtet ist (Menü „Word-Add-in einrichten …“); Zertifikat
  // rechtzeitig erneuern, belegten Anschluss melden
  win.webContents.once('did-finish-load', () => void checkWordAddinOnStart(win, addinHandlers, !!process.env.OPENMOL_TEST_DIALOGS))
  // nur für automatische Tests: Einrichtung ohne Menü und ohne Dialoge
  if (process.env.OPENMOL_TEST_WORDADDIN) void setupWordAddin(win, addinHandlers, true)
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow()
  })
})

app.on('window-all-closed', () => {
  // wie bei Mac-Apps üblich läuft die App ohne Fenster weiter; Windows/Linux beenden
  if (process.platform !== 'darwin') app.quit()
})
