// Updates: prüft die GitHub-Releases auf eine neuere Version und installiert sie auf Wunsch.
// - Windows: Herunterladen und Installieren übernimmt electron-updater (latest.yml im Release, Prüfsumme sha512).
// - Mac: automatisches Ersetzen der App erlaubt macOS nur bei Apple-signierten Apps. Daher wird die neue DMG nach
//   „Downloads“ geladen, mit der von GitHub angegebenen Prüfsumme (sha256) kontrolliert und geöffnet – der Nutzer
//   zieht OpenMol dann wie bei der Erstinstallation in „Programme“.
// Automatisch höchstens einmal am Tag (abschaltbar in den Einstellungen); nichts wird ohne Zustimmung geladen.
import { app, dialog, net, shell } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { menuLang } from './menu.mjs'
import { readStored } from './store.mjs'

const REPO = 'monsproduction/OpenMol'
// für Tests: eigene Quelle statt GitHub (gleiches Format wie die GitHub-API „releases/latest“)
const FEED = process.env.OPENMOL_UPDATE_FEED || `https://api.github.com/repos/${REPO}/releases/latest`
const DAY = 24 * 60 * 60 * 1000

const T = {
  de: {
    available: (v) => `OpenMol ${v} ist verfügbar`,
    current: (v) => `Installiert ist Version ${v}.`,
    download: 'Herunterladen',
    later: 'Später',
    skip: 'Diese Version überspringen',
    latest: 'OpenMol ist auf dem neuesten Stand',
    latestDetail: (v) => `Installiert ist die neueste Version (${v}).`,
    failed: 'Suche nach Updates fehlgeschlagen',
    failedDetail: 'GitHub ist gerade nicht erreichbar. Bitte später noch einmal versuchen.',
    devOnly: 'Updates gibt es nur in der installierten App.',
    downloading: 'Update wird heruntergeladen …',
    downloadFailed: 'Das Update konnte nicht heruntergeladen werden',
    badChecksum: 'Die heruntergeladene Datei ist beschädigt (Prüfsumme stimmt nicht) und wurde gelöscht.',
    macReady: (v) => `OpenMol ${v} wurde heruntergeladen`,
    macDetail: (f) =>
      `Die Datei „${f}“ liegt im Ordner „Downloads“.\n\nSo wird installiert: Im geöffneten Fenster OpenMol in den Ordner „Programme“ ziehen und „Ersetzen“ wählen. Dafür muss OpenMol beendet sein.`,
    openQuit: 'Öffnen und OpenMol beenden',
    openOnly: 'Nur öffnen',
    winReady: (v) => `OpenMol ${v} ist bereit zur Installation`,
    winDetail: 'OpenMol wird dafür kurz beendet und neu gestartet. Nicht gesicherte Änderungen werden vorher abgefragt.',
    restart: 'Jetzt neu starten und installieren',
    onQuit: 'Beim Beenden installieren',
    noAsset: 'Für dieses System liegt in der neuen Version noch kein Installer bei.',
    notes: 'Neuerungen:',
  },
  en: {
    available: (v) => `OpenMol ${v} is available`,
    current: (v) => `You have version ${v}.`,
    download: 'Download',
    later: 'Later',
    skip: 'Skip this version',
    latest: 'OpenMol is up to date',
    latestDetail: (v) => `You have the latest version (${v}).`,
    failed: 'Checking for updates failed',
    failedDetail: 'GitHub cannot be reached right now. Please try again later.',
    devOnly: 'Updates are only available in the installed app.',
    downloading: 'Downloading update …',
    downloadFailed: 'The update could not be downloaded',
    badChecksum: 'The downloaded file is damaged (checksum mismatch) and was deleted.',
    macReady: (v) => `OpenMol ${v} has been downloaded`,
    macDetail: (f) =>
      `The file “${f}” is in your Downloads folder.\n\nTo install: in the window that opens, drag OpenMol into the Applications folder and choose “Replace”. OpenMol has to be closed for this.`,
    openQuit: 'Open and quit OpenMol',
    openOnly: 'Open only',
    winReady: (v) => `OpenMol ${v} is ready to install`,
    winDetail: 'OpenMol will close and restart for this. You will be asked about unsaved changes first.',
    restart: 'Restart and install now',
    onQuit: 'Install when quitting',
    noAsset: 'The new version does not contain an installer for this system yet.',
    notes: 'What’s new:',
  },
}
const t = () => T[menuLang()] ?? T.de

// Nur für automatische Tests (wie bei den Datei-Dialogen): OPENMOL_TEST_DIALOGS = Ordner → Dialoge beantworten sich
// selbst (Knopf aus update-answer.txt, Standard 0) und stehen im Protokoll; geladen wird in diesen Ordner, nichts geöffnet
const TEST_DIR = process.env.OPENMOL_TEST_DIALOGS
async function ask(win, opts) {
  if (!TEST_DIR) return win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)
  console.log('[update-dialog]', opts.message, '|', (opts.buttons ?? []).join(' / '))
  const f = path.join(TEST_DIR, 'update-answer.txt')
  return { response: fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8')) : 0 }
}
const downloadDir = () => TEST_DIR ?? app.getPath('downloads')

// ---------- Zustand (letzte Prüfung, übersprungene Version) ----------

const stateFile = () => path.join(app.getPath('userData'), 'update.json')
function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
  } catch {
    return {}
  }
}
function writeState(s) {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(s, null, 1))
  } catch {
    // ohne Schreibrecht: beim nächsten Start erneut prüfen
  }
}

/** „1.10.2“ > „1.9.0“; Vorabversionen („-beta“) zählen nicht als neuer */
function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('-')[0].split('.').map(Number)
  const pb = String(b).replace(/^v/, '').split('-')[0].split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true
    if ((pa[i] || 0) < (pb[i] || 0)) return false
  }
  return false
}

const currentVersion = () => process.env.OPENMOL_TEST_VERSION || app.getVersion()

async function latestRelease() {
  const r = await net.fetch(FEED, { headers: { Accept: 'application/vnd.github+json' } })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  const j = await r.json()
  if (!j?.tag_name) throw new Error('keine Versionsangabe')
  return j
}

/** Text der Release-Notizen ohne Markdown-Zeichen, gekürzt */
function notesOf(rel) {
  const s = String(rel.body ?? '')
    .replace(/\r/g, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/^#+\s*/gm, '')
    .trim()
  return s.length > 700 ? s.slice(0, 700) + ' …' : s
}

// ---------- Prüfen ----------

let busy = false

/** manual: über Menü/Einstellungen ausgelöst → auch „kein Update“ und Fehler melden, übersprungene Version zeigen */
export async function checkForUpdates(getWin, { manual = false } = {}) {
  const win = getWin()
  if (busy) return
  if (!app.isPackaged && !process.env.OPENMOL_UPDATE_FEED) {
    if (manual) await ask(win, { type: 'info', message: t().devOnly })
    return
  }
  busy = true
  try {
    let rel
    try {
      rel = await latestRelease()
    } catch {
      if (manual) await ask(win, { type: 'warning', message: t().failed, detail: t().failedDetail })
      return
    }
    const state = readState()
    writeState({ ...state, lastCheck: Date.now() })
    const v = String(rel.tag_name).replace(/^v/, '')
    if (!newer(v, currentVersion())) {
      if (manual) await ask(win, { type: 'info', message: t().latest, detail: t().latestDetail(currentVersion()) })
      return
    }
    if (!manual && state.skip === v) return
    const notes = notesOf(rel)
    const r = await ask(win, {
      type: 'info',
      message: t().available(v),
      detail: t().current(currentVersion()) + (notes ? '\n\n' + t().notes + '\n' + notes : ''),
      buttons: [t().download, t().later, t().skip],
      defaultId: 0,
      cancelId: 1,
    })
    if (r.response === 2) writeState({ ...readState(), skip: v })
    if (r.response !== 0) return
    if (process.platform === 'darwin') await downloadMac(getWin, rel, v)
    else await downloadWin(getWin, v)
  } finally {
    busy = false
  }
}

/** beim Start: höchstens einmal am Tag, wenn in den Einstellungen erlaubt (Standard: an) */
export function scheduleAutoCheck(getWin) {
  setTimeout(() => {
    const settings = readStored('openmol:settings')
    if (settings && settings.autoUpdate === false) return
    if (Date.now() - (readState().lastCheck ?? 0) < DAY && !process.env.OPENMOL_UPDATE_FEED) return
    void checkForUpdates(getWin)
  }, 8000)
}

// ---------- Mac: DMG laden, prüfen, öffnen ----------

async function downloadMac(getWin, rel, v) {
  const assets = (rel.assets ?? []).filter((a) => /\.dmg$/i.test(a.name))
  const asset = assets.find((a) => a.name.includes(process.arch)) ?? assets[0]
  const win = getWin()
  if (!asset) {
    await ask(win, { type: 'warning', message: t().downloadFailed, detail: t().noAsset })
    return
  }
  const target = path.join(downloadDir(), path.basename(asset.name))
  const tmp = target + '.download'
  try {
    const r = await net.fetch(asset.browser_download_url)
    if (!r.ok || !r.body) throw new Error('HTTP ' + r.status)
    const total = Number(r.headers.get('content-length')) || asset.size || 0
    const hash = crypto.createHash('sha256')
    const out = fs.createWriteStream(tmp)
    let got = 0
    const reader = r.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      got += value.length
      if (!out.write(Buffer.from(value))) await new Promise((res) => out.once('drain', res))
      if (total) getWin()?.setProgressBar(got / total)
    }
    await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())))
    getWin()?.setProgressBar(-1)
    // Prüfsumme: GitHub gibt zu jeder Datei „sha256:…“ an; fehlt sie, wenigstens die Größe vergleichen
    const want = String(asset.digest ?? '').replace(/^sha256:/, '')
    if ((want && hash.digest('hex') !== want) || (!want && asset.size && got !== asset.size)) {
      fs.rmSync(tmp, { force: true })
      await ask(getWin(), { type: 'error', message: t().downloadFailed, detail: t().badChecksum })
      return
    }
    fs.renameSync(tmp, target)
  } catch (e) {
    getWin()?.setProgressBar(-1)
    fs.rmSync(tmp, { force: true })
    await ask(getWin(), { type: 'error', message: t().downloadFailed, detail: String(e?.message ?? e) })
    return
  }
  const r = await ask(getWin(), {
    type: 'info',
    message: t().macReady(v),
    detail: t().macDetail(path.basename(target)),
    buttons: [t().openQuit, t().openOnly],
    defaultId: 0,
    cancelId: 1,
  })
  if (TEST_DIR) console.log('[update] bereit:', target)
  else await shell.openPath(target)
  if (r.response === 0) app.quit()
}

// ---------- Windows: electron-updater ----------

let winUpdater = null
function updater() {
  if (winUpdater) return winUpdater
  const { autoUpdater } = createRequire(import.meta.url)('electron-updater')
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  winUpdater = autoUpdater
  return autoUpdater
}

async function downloadWin(getWin, v) {
  const u = updater()
  const onProgress = (p) => getWin()?.setProgressBar((p.percent ?? 0) / 100)
  u.on('download-progress', onProgress)
  try {
    // liest latest.yml aus dem Release (Version, Datei, Prüfsumme)
    const res = await u.checkForUpdates()
    if (!res?.updateInfo || !newer(res.updateInfo.version, currentVersion())) throw new Error(t().noAsset)
    await u.downloadUpdate()
  } catch (e) {
    getWin()?.setProgressBar(-1)
    await ask(getWin(), { type: 'error', message: t().downloadFailed, detail: String(e?.message ?? e) })
    return
  } finally {
    u.removeListener('download-progress', onProgress)
  }
  getWin()?.setProgressBar(-1)
  const r = await ask(getWin(), {
    type: 'info',
    message: t().winReady(v),
    detail: t().winDetail,
    buttons: [t().restart, t().onQuit],
    defaultId: 0,
    cancelId: 1,
  })
  // sonst installiert electron-updater beim nächsten Beenden (autoInstallOnAppQuit)
  if (r.response === 0) u.quitAndInstall()
}
