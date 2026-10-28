// Word-Add-in „OpenMol“ (Mac, Windows UNGETESTET): In Word ein OpenMol-Bild markieren → „In OpenMol bearbeiten“ → OpenMol öffnet die
// Zeichnung in einem Tab → „Zurück nach Word“ ersetzt das Bild. Word zeigt Add-ins in einer Safari-Webansicht, die
// von einer HTTPS-Seite aus kein http://localhost erreicht (getestet unter macOS 26) – deshalb liefert OpenMol Add-in
// und Verbindung selbst über https://localhost:5185, mit einem Zertifikat nur für localhost, dem der Nutzer einmal
// vertraut. Die Zeichnung steckt im PNG selbst (Textblock „openmol“, siehe src/tools/clipData.ts).
// Windows: Zertifikat mit Node erzeugt (kein openssl), Vertrauen über die Windows-Zertifikatsverwaltung (certutil, nur
// für den Benutzer – Windows fragt selbst nach), Add-in über den Registry-Eintrag für Entwickler-Add-ins (WEF\Developer).
import { app, dialog, nativeImage } from 'electron'
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSelfSignedCert, thumbprint } from './selfsignedCert.mjs'
import { menuLang } from './menu.mjs'

/** Texte in der Sprache der OpenMol-Oberfläche (Dialoge, Manifest, Add-in-Seite) */
const en = () => menuLang() === 'en'
const tr = (de, english) => (en() ? english : de)

export const ADDIN_PORT = 5185
const ORIGIN = `https://localhost:${ADDIN_PORT}`
const ADDIN_ID = 'd268be37-8286-438a-851f-51485a976169'
const STATIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'addin')
const dir = () => path.join(app.getPath('userData'), 'word-addin')
const certFile = () => path.join(dir(), 'localhost-cert.pem')
const keyFile = () => path.join(dir(), 'localhost-key.pem')
/** dasselbe Zertifikat in DER – so liest es die Windows-Zertifikatsverwaltung */
const cerFile = () => path.join(dir(), 'localhost-cert.cer')
const WIN = process.platform === 'win32'
const SUPPORTED = process.platform === 'darwin' || WIN
/** Ordner, aus dem Word für Mac selbst installierte Add-ins lädt (Sideloading) */
const wefDir = () => path.join(os.homedir(), 'Library', 'Containers', 'com.microsoft.Word', 'Data', 'Documents', 'wef')
/** Windows: Manifest liegt bei OpenMol, Word findet es über den Registry-Eintrag */
const manifestFile = () => (WIN ? path.join(dir(), 'OpenMol-Word-Addin.xml') : path.join(wefDir(), 'OpenMol-Word-Addin.xml'))
const WEF_KEY = 'HKCU\\Software\\Microsoft\\Office\\16.0\\WEF\\Developer'
const sys32 = (exe) => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', exe)
const POWERSHELL = () => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => execFile(cmd, args, opts, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout) + String(stderr) || (err?.message ?? '') })))

/** Zertifikat nur für localhost/127.0.0.1 (keine Zertifizierungsstelle, nur Webserver, 825 Tage – Apples Grenze) */
async function makeCert() {
  fs.mkdirSync(dir(), { recursive: true })
  if (WIN) {
    const c = makeSelfSignedCert()
    fs.writeFileSync(keyFile(), c.keyPem)
    fs.writeFileSync(certFile(), c.certPem)
    fs.writeFileSync(cerFile(), c.der)
    return
  }
  const r = await run('/usr/bin/openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825',
    '-keyout', keyFile(), '-out', certFile(), '-subj', '/CN=OpenMol localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    '-addext', 'basicConstraints=critical,CA:FALSE',
    '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment',
    '-addext', 'extendedKeyUsage=serverAuth',
  ])
  if (!r.ok) throw new Error(tr('Zertifikat konnte nicht erzeugt werden: ', 'Could not create the certificate: ') + r.out)
  fs.chmodSync(keyFile(), 0o600)
}

/** Fingerabdruck des aktuellen Zertifikats (Windows benennt Zertifikate im Speicher danach) */
function certThumbprint() {
  return thumbprint(new crypto.X509Certificate(fs.readFileSync(certFile())).raw)
}

/** vertraut macOS bzw. Windows dem Zertifikat für HTTPS auf localhost? */
async function certTrusted() {
  if (WIN) {
    let t
    try {
      t = certThumbprint()
    } catch {
      return false
    }
    const r = await run(POWERSHELL(), ['-NoProfile', '-NonInteractive', '-Command', `Test-Path 'Cert:\\CurrentUser\\Root\\${t}'`], { windowsHide: true })
    return r.ok && /True/i.test(r.out)
  }
  return (await run('/usr/bin/security', ['verify-cert', '-c', certFile(), '-p', 'ssl', '-s', 'localhost', '-q'])).ok
}

/** Add-in bei Word eintragen: Mac – Manifest in den wef-Ordner; Windows – Manifest + Registry-Eintrag (nur Benutzer) */
async function installManifest() {
  fs.mkdirSync(path.dirname(manifestFile()), { recursive: true })
  fs.writeFileSync(manifestFile(), manifestXml())
  if (!WIN) return
  // Wert: Name und Inhalt = Pfad des Manifests (so trägt auch Microsofts Werkzeug office-addin-dev-settings ein)
  const r = await run(sys32('reg.exe'), ['add', WEF_KEY, '/v', manifestFile(), '/t', 'REG_SZ', '/d', manifestFile(), '/f'], { windowsHide: true })
  if (!r.ok) throw new Error(tr('Registry-Eintrag für Word fehlgeschlagen: ', 'Registry entry for Word failed: ') + r.out)
}

function manifestXml() {
  const u = (p) => `${ORIGIN}/addin/${p}`
  return `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0" xmlns:ov="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="TaskPaneApp">
  <Id>${ADDIN_ID}</Id>
  <Version>1.0.0.0</Version>
  <ProviderName>OpenMol</ProviderName>
  <DefaultLocale>${en() ? 'en-US' : 'de-DE'}</DefaultLocale>
  <DisplayName DefaultValue="OpenMol"/>
  <Description DefaultValue="${tr('Mit OpenMol kopierte Strukturen in OpenMol bearbeiten', 'Edit structures copied from OpenMol in OpenMol')}"/>
  <IconUrl DefaultValue="${u('icon-32.png')}"/>
  <HighResolutionIconUrl DefaultValue="${u('icon-64.png')}"/>
  <SupportUrl DefaultValue="https://github.com/monsproduction/OpenMol"/>
  <AppDomains>
    <AppDomain>${ORIGIN}</AppDomain>
  </AppDomains>
  <Hosts>
    <Host Name="Document"/>
  </Hosts>
  <Requirements>
    <Sets DefaultMinVersion="1.1">
      <Set Name="WordApi" MinVersion="1.1"/>
    </Sets>
  </Requirements>
  <DefaultSettings>
    <SourceLocation DefaultValue="${u('taskpane.html')}"/>
  </DefaultSettings>
  <Permissions>ReadWriteDocument</Permissions>
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="VersionOverridesV1_0">
    <Hosts>
      <Host xsi:type="Document">
        <DesktopFormFactor>
          <ExtensionPoint xsi:type="PrimaryCommandSurface">
            <OfficeTab id="TabHome">
              <Group id="OpenMol.Group">
                <Label resid="OpenMol.Group.Label"/>
                <Icon>
                  <bt:Image size="16" resid="Icon.16"/>
                  <bt:Image size="32" resid="Icon.32"/>
                  <bt:Image size="80" resid="Icon.80"/>
                </Icon>
                <Control xsi:type="Button" id="OpenMol.Edit">
                  <Label resid="OpenMol.Edit.Label"/>
                  <Supertip>
                    <Title resid="OpenMol.Edit.Label"/>
                    <Description resid="OpenMol.Edit.Tip"/>
                  </Supertip>
                  <Icon>
                    <bt:Image size="16" resid="Icon.16"/>
                    <bt:Image size="32" resid="Icon.32"/>
                    <bt:Image size="80" resid="Icon.80"/>
                  </Icon>
                  <Action xsi:type="ShowTaskpane">
                    <TaskpaneId>OpenMolPane</TaskpaneId>
                    <SourceLocation resid="Taskpane.Url"/>
                  </Action>
                </Control>
              </Group>
            </OfficeTab>
          </ExtensionPoint>
        </DesktopFormFactor>
      </Host>
    </Hosts>
    <Resources>
      <bt:Images>
        <bt:Image id="Icon.16" DefaultValue="${u('icon-16.png')}"/>
        <bt:Image id="Icon.32" DefaultValue="${u('icon-32.png')}"/>
        <bt:Image id="Icon.80" DefaultValue="${u('icon-80.png')}"/>
      </bt:Images>
      <bt:Urls>
        <bt:Url id="Taskpane.Url" DefaultValue="${u('taskpane.html')}"/>
      </bt:Urls>
      <bt:ShortStrings>
        <bt:String id="OpenMol.Group.Label" DefaultValue="OpenMol"/>
        <bt:String id="OpenMol.Edit.Label" DefaultValue="${tr('In OpenMol bearbeiten', 'Edit in OpenMol')}"/>
      </bt:ShortStrings>
      <bt:LongStrings>
        <bt:String id="OpenMol.Edit.Tip" DefaultValue="${tr('Markierte, mit OpenMol kopierte Struktur in OpenMol öffnen und danach hier ersetzen', 'Open the selected structure (copied from OpenMol) in OpenMol and replace it here afterwards')}"/>
      </bt:LongStrings>
    </Resources>
  </VersionOverrides>
</OfficeApp>
`
}

// ---------- Server ----------

let server = null
/** offene Bearbeitungen: Sitzung → fertiges Bild (base64) bzw. null, solange in OpenMol bearbeitet wird */
const sessions = new Map()
let onEdit = () => {}

const STATIC_FILES = { 'taskpane.html': 'text/html; charset=utf-8', 'taskpane.js': 'text/javascript; charset=utf-8' }

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

function icon(size) {
  const src = path.join(STATIC, 'icon.png')
  return nativeImage.createFromPath(src).resize({ width: size, height: size, quality: 'best' }).toPNG()
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const parts = []
    let n = 0
    req.on('data', (c) => {
      n += c.length
      if (n > limit) {
        reject(new Error('zu groß'))
        req.destroy()
      } else parts.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
    req.on('error', reject)
  })
}

async function handle(req, res) {
  // nur unter localhost:5185 ansprechbar (Schutz gegen DNS-Rebinding)
  if (req.headers.host !== `localhost:${ADDIN_PORT}` && req.headers.host !== `127.0.0.1:${ADDIN_PORT}`) return send(res, 403, { error: 'host' })
  const url = new URL(req.url ?? '/', ORIGIN)
  const p = url.pathname
  if (req.method === 'GET' && p.startsWith('/addin/')) {
    const name = p.slice('/addin/'.length)
    const ic = /^icon-(16|32|64|80)\.png$/.exec(name)
    if (ic) return send(res, 200, icon(Number(ic[1])), 'image/png')
    if (STATIC_FILES[name]) return send(res, 200, fs.readFileSync(path.join(STATIC, name)), STATIC_FILES[name])
    return send(res, 404, { error: 'nicht gefunden' })
  }
  if (p === '/api/ping') return send(res, 200, { ok: true, app: 'OpenMol', version: app.getVersion(), lang: menuLang() })
  // Daten an OpenMol schicken darf nur die eigene Add-in-Seite (andere Webseiten haben eine andere Herkunft)
  if (req.method === 'POST' && p === '/api/edit') {
    if (req.headers.origin !== ORIGIN || !/json/.test(req.headers['content-type'] ?? '')) return send(res, 403, { error: 'origin' })
    let j
    try {
      j = JSON.parse(await readBody(req, 20e6))
    } catch {
      return send(res, 400, { error: 'ungültig' })
    }
    if (typeof j?.payload !== 'string' || !/^OM1:[A-Za-z0-9_.-]+$/.test(j.payload)) return send(res, 400, { error: 'keine OpenMol-Daten' })
    const session = crypto.randomBytes(16).toString('hex')
    sessions.set(session, null)
    onEdit({ session, payload: j.payload })
    return send(res, 200, { session })
  }
  // Ergebnis abholen: die Sitzungskennung ist zufällig (128 Bit) und nur der Add-in-Seite bekannt
  if (req.method === 'GET' && p === '/api/result') {
    const s = url.searchParams.get('s') ?? ''
    if (!sessions.has(s)) return send(res, 404, { error: 'unbekannt' })
    const png = sessions.get(s)
    if (!png) return send(res, 200, { ready: false })
    sessions.delete(s)
    return send(res, 200, { ready: true, png })
  }
  return send(res, 404, { error: 'nicht gefunden' })
}

/**
 * Server starten (falls eingerichtet). Ergebnis: 'ok', 'busy' (Port 5185 von einem anderen Programm belegt),
 * 'none' (nicht eingerichtet bzw. nicht auf dem Mac)
 */
let starting = null
export function startAddinServer(handlers) {
  onEdit = handlers.onEdit
  if (server) return Promise.resolve('ok')
  // läuft gerade ein Start (Einrichtung und Startprüfung gleichzeitig), auf denselben warten
  if (starting) return starting
  if (!SUPPORTED || !fs.existsSync(certFile()) || !fs.existsSync(keyFile())) return Promise.resolve('none')
  starting = new Promise((resolve) => {
    const srv = https.createServer({ cert: fs.readFileSync(certFile()), key: fs.readFileSync(keyFile()) }, (req, res) => {
      handle(req, res).catch(() => send(res, 500, { error: 'Fehler' }))
    })
    srv.once('error', (e) => {
      console.error('OpenMol: Word-Add-in-Server', e.message)
      resolve(e.code === 'EADDRINUSE' ? 'busy' : 'none')
    })
    srv.listen(ADDIN_PORT, '127.0.0.1', () => {
      server = srv
      resolve('ok')
    })
  }).finally(() => {
    starting = null
  })
  return starting
}

function stopAddinServer() {
  server?.close()
  server = null
}

/** Tage, die das Zertifikat noch gilt (negativ = abgelaufen; null = keins/unlesbar) */
function certDaysLeft() {
  try {
    const c = new crypto.X509Certificate(fs.readFileSync(certFile()))
    return (new Date(c.validTo).getTime() - Date.now()) / 86400e3
  } catch {
    return null
  }
}

const PORT_BUSY = () =>
  tr(
    `Ein anderes Programm benutzt den Anschluss ${ADDIN_PORT} auf diesem Rechner. Bis es beendet ist, kann Word OpenMol nicht erreichen („In OpenMol bearbeiten“ meldet dann, dass OpenMol nicht antwortet).`,
    `Another program is using port ${ADDIN_PORT} on this computer. Until it is closed, Word cannot reach OpenMol (“Edit in OpenMol” then reports that OpenMol is not responding).`,
  )
const NOT_AVAILABLE = () => tr('Word-Add-in nicht verfügbar', 'Word add-in not available')

/**
 * Beim Start der App: Zertifikat 30 Tage vor Ablauf erneuern (dann muss der Mac dem neuen einmal vertrauen), Server
 * starten, einen belegten Anschluss melden. Nur wenn das Add-in eingerichtet ist.
 */
export async function checkWordAddinOnStart(win, handlers, test) {
  if (!SUPPORTED || !fs.existsSync(certFile())) return
  const days = certDaysLeft()
  let renewed = false
  if (days === null || days < 30) {
    try {
      await makeCert()
      renewed = true
    } catch (e) {
      console.error('OpenMol: Zertifikat erneuern', e)
    }
  }
  // Windows: Manifest bei jedem Start erneuern (Word liest es aus dem OpenMol-Ordner)
  if (WIN) await installManifest().catch((e) => console.error('OpenMol: Word-Add-in eintragen', e))
  const state = await startAddinServer(handlers)
  if (test) {
    console.log('[word-addin] Start', { daysLeft: days === null ? null : Math.round(days), renewed, server: state })
    return
  }
  if (state === 'busy') await dialog.showMessageBox(win, { type: 'warning', message: NOT_AVAILABLE(), detail: PORT_BUSY(), buttons: ['OK'] })
  else if (renewed && !(await certTrusted())) await askTrust(win, true)
}

/** fertiges Bild (PNG mit OpenMol-Daten) für eine Sitzung bereitstellen */
export function setResult(session, png) {
  if (!sessions.has(session) || !(png instanceof Uint8Array)) return false
  sessions.set(session, Buffer.from(png).toString('base64'))
  return true
}

/**
 * Menü „Word-Add-in einrichten …“: Zertifikat erzeugen, Server starten, Add-in in Word eintragen und – falls nötig –
 * das Vertrauen in das Zertifikat einrichten lassen (macOS fragt dafür selbst nach dem Passwort).
 */
export async function setupWordAddin(win, handlers, test) {
  if (!SUPPORTED) return
  let state
  try {
    if (!fs.existsSync(certFile()) || !fs.existsSync(keyFile()) || (WIN && !fs.existsSync(cerFile())) || (certDaysLeft() ?? -1) < 30) {
      stopAddinServer()
      await makeCert()
    }
    await installManifest()
    state = await startAddinServer(handlers)
  } catch (e) {
    if (!test) await dialog.showMessageBox(win, { type: 'error', message: tr('Word-Add-in konnte nicht eingerichtet werden', 'The Word add-in could not be set up'), detail: String(e?.message ?? e) })
    return
  }
  if (test) {
    console.log('[word-addin] eingerichtet', { manifest: manifestFile(), trusted: await certTrusted(), server: state, command: trustCommand() })
    return
  }
  if (state === 'busy') return void (await dialog.showMessageBox(win, { type: 'warning', message: NOT_AVAILABLE(), detail: PORT_BUSY(), buttons: ['OK'] }))
  if (await certTrusted()) {
    await dialog.showMessageBox(win, { type: 'info', message: tr('Das Word-Add-in ist eingerichtet.', 'The Word add-in is set up.'), detail: HOW_TO(), buttons: ['OK'] })
    return
  }
  await askTrust(win, false)
}

const HOW_TO = () =>
  WIN
    ? tr(
        'Word danach ganz beenden und neu starten. Im Reiter „Start“ sollte dann der Knopf „In OpenMol bearbeiten“ erscheinen. Falls nicht: Reiter „Einfügen“ ▸ „Add-Ins abrufen“ bzw. „Meine Add-Ins“ ▸ „Entwickler-Add-Ins“ ▸ „OpenMol“.',
        'Then quit Word completely and start it again. The “Edit in OpenMol” button should appear on the Home tab. If not: Insert tab ▸ “Get Add-ins” or “My Add-ins” ▸ “Developer Add-ins” ▸ “OpenMol”.',
      )
    : tr(
        'Word danach ganz beenden (⌘Q) und neu starten. Dann in Word: Reiter „Einfügen“, beim Knopf „Meine Add-Ins“ auf den kleinen Pfeil ▾ klicken und unter „Entwickler-Add-Ins“ „OpenMol“ wählen. Danach erscheint im Reiter „Start“ der Knopf „In OpenMol bearbeiten“.',
        'Then quit Word completely (⌘Q) and start it again. In Word: Insert tab, click the small arrow ▾ next to “My Add-ins” and choose “OpenMol” under “Developer Add-ins”. The “Edit in OpenMol” button then appears on the Home tab.',
      )

const trustCommand = () =>
  WIN ? `certutil -user -addstore Root "${cerFile()}"` : `security add-trusted-cert -r trustRoot -p ssl -k ~/Library/Keychains/login.keychain-db "${certFile()}"`

/** Vertrauen in das Zertifikat einrichten lassen (macOS fragt dafür selbst nach dem Passwort, Windows mit einer Sicherheitswarnung) */
async function askTrust(win, renewed) {
  const pc = WIN ? 'Windows' : tr('dein Mac', 'your Mac')
  const r = await dialog.showMessageBox(win, {
    type: 'info',
    message: renewed
      ? tr('Das Zertifikat für das Word-Add-in wurde erneuert', 'The certificate for the Word add-in was renewed')
      : tr(`${WIN ? 'Windows' : 'Dein Mac'} muss dem OpenMol-Zertifikat einmal vertrauen`, `${WIN ? 'Windows' : 'Your Mac'} needs to trust the OpenMol certificate once`),
    detail:
      (renewed
        ? tr(
            `Das bisherige Zertifikat lief bald ab. Damit „In OpenMol bearbeiten“ in Word weiter funktioniert, muss ${pc} dem neuen einmal vertrauen. `,
            `The previous certificate was about to expire. For “Edit in OpenMol” to keep working in Word, ${pc} needs to trust the new one once. `,
          )
        : tr(
            'Word zeigt Add-ins nur über HTTPS an. OpenMol hat dafür ein Zertifikat erzeugt, das ausschließlich für „localhost“ (diesen Rechner) gilt und nichts anderes beglaubigen kann. ',
            'Word only shows add-ins over HTTPS. OpenMol has created a certificate for this that is valid only for “localhost” (this computer) and cannot certify anything else. ',
          )) +
      (WIN
        ? tr(
            '„Vertrauen …“ trägt es in die Zertifikate deines Windows-Benutzers ein – Windows zeigt dabei eine Sicherheitswarnung („Möchten Sie dieses Zertifikat installieren?“), die du mit „Ja“ bestätigst.\n\nAlternativ in der Eingabeaufforderung:\n',
            '“Trust …” adds it to the certificates of your Windows user – Windows shows a security warning (“Do you want to install this certificate?”), which you confirm with “Yes”.\n\nAlternatively in the command prompt:\n',
          )
        : tr(
            '„Vertrauen …“ trägt es in deinen Schlüsselbund ein – macOS fragt dabei nach deinem Passwort.\n\nAlternativ im Terminal:\n',
            '“Trust …” adds it to your keychain – macOS asks for your password.\n\nAlternatively in Terminal:\n',
          )) +
      trustCommand(),
    buttons: [tr('Vertrauen …', 'Trust …'), tr('Befehl in Zwischenablage', 'Copy command'), tr('Später', 'Later')],
    cancelId: 2,
  })
  if (r.response === 1) {
    const { clipboard } = await import('electron')
    await clipboard.writeText(trustCommand())
    return
  }
  if (r.response !== 0) return
  // Windows: ohne windowsHide, damit die Sicherheitswarnung sicher erscheint
  const t = WIN
    ? await run(sys32('certutil.exe'), ['-user', '-addstore', 'Root', cerFile()])
    : await run('/usr/bin/security', ['add-trusted-cert', '-r', 'trustRoot', '-p', 'ssl', '-k', path.join(os.homedir(), 'Library', 'Keychains', 'login.keychain-db'), certFile()])
  const ok = await certTrusted()
  await dialog.showMessageBox(win, {
    type: ok ? 'info' : 'warning',
    message: ok ? tr('Fertig – das Word-Add-in ist eingerichtet.', 'Done – the Word add-in is set up.') : tr('Das Zertifikat ist noch nicht vertrauenswürdig.', 'The certificate is not trusted yet.'),
    detail: ok
      ? renewed
        ? tr('Word einmal neu starten.', 'Restart Word once.')
        : HOW_TO()
      : (t.out || tr('Abgebrochen?', 'Cancelled?')) +
        tr(`\n\nBefehl zum Wiederholen ${WIN ? 'in der Eingabeaufforderung' : 'im Terminal'}:\n`, `\n\nCommand to retry ${WIN ? 'in the command prompt' : 'in Terminal'}:\n`) +
        trustCommand(),
    buttons: ['OK'],
  })
}

/**
 * Sprache der Oberfläche geändert: Manifest neu schreiben (nur wenn das Add-in eingerichtet ist), damit Word die Knöpfe
 * nach dem nächsten Neustart in dieser Sprache zeigt
 */
export function refreshAddinManifest() {
  if (!SUPPORTED || !fs.existsSync(certFile()) || !fs.existsSync(manifestFile())) return
  installManifest().catch((e) => console.error('OpenMol: Word-Add-in-Manifest', e))
}
