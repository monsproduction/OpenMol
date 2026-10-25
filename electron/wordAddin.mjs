// Word-Add-in „OpenMol“ (Mac): In Word ein OpenMol-Bild markieren → „In OpenMol bearbeiten“ → OpenMol öffnet die
// Zeichnung in einem Tab → „Zurück nach Word“ ersetzt das Bild. Word zeigt Add-ins in einer Safari-Webansicht, die
// von einer HTTPS-Seite aus kein http://localhost erreicht (getestet unter macOS 26) – deshalb liefert OpenMol Add-in
// und Verbindung selbst über https://localhost:5185, mit einem Zertifikat nur für localhost, dem der Nutzer einmal
// vertraut. Die Zeichnung steckt im PNG selbst (Textblock „openmol“, siehe src/tools/clipData.ts).
import { app, dialog, nativeImage } from 'electron'
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ADDIN_PORT = 5185
const ORIGIN = `https://localhost:${ADDIN_PORT}`
const ADDIN_ID = 'd268be37-8286-438a-851f-51485a976169'
const STATIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'addin')
const dir = () => path.join(app.getPath('userData'), 'word-addin')
const certFile = () => path.join(dir(), 'localhost-cert.pem')
const keyFile = () => path.join(dir(), 'localhost-key.pem')
/** Ordner, aus dem Word für Mac selbst installierte Add-ins lädt (Sideloading) */
const wefDir = () => path.join(os.homedir(), 'Library', 'Containers', 'com.microsoft.Word', 'Data', 'Documents', 'wef')

const run = (cmd, args) =>
  new Promise((resolve) => execFile(cmd, args, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout) + String(stderr) })))

/** Zertifikat nur für localhost/127.0.0.1 (keine Zertifizierungsstelle, nur Webserver, 825 Tage – Apples Grenze) */
async function makeCert() {
  fs.mkdirSync(dir(), { recursive: true })
  const r = await run('/usr/bin/openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825',
    '-keyout', keyFile(), '-out', certFile(), '-subj', '/CN=OpenMol localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    '-addext', 'basicConstraints=critical,CA:FALSE',
    '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment',
    '-addext', 'extendedKeyUsage=serverAuth',
  ])
  if (!r.ok) throw new Error('Zertifikat konnte nicht erzeugt werden: ' + r.out)
  fs.chmodSync(keyFile(), 0o600)
}

/** vertraut macOS dem Zertifikat für HTTPS auf localhost? */
async function certTrusted() {
  return (await run('/usr/bin/security', ['verify-cert', '-c', certFile(), '-p', 'ssl', '-s', 'localhost', '-q'])).ok
}

function manifestXml() {
  const u = (p) => `${ORIGIN}/addin/${p}`
  return `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0" xmlns:ov="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="TaskPaneApp">
  <Id>${ADDIN_ID}</Id>
  <Version>1.0.0.0</Version>
  <ProviderName>OpenMol</ProviderName>
  <DefaultLocale>de-DE</DefaultLocale>
  <DisplayName DefaultValue="OpenMol"/>
  <Description DefaultValue="Mit OpenMol kopierte Strukturen in OpenMol bearbeiten"/>
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
        <bt:String id="OpenMol.Edit.Label" DefaultValue="In OpenMol bearbeiten"/>
      </bt:ShortStrings>
      <bt:LongStrings>
        <bt:String id="OpenMol.Edit.Tip" DefaultValue="Markierte, mit OpenMol kopierte Struktur in OpenMol öffnen und danach hier ersetzen"/>
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
  if (p === '/api/ping') return send(res, 200, { ok: true, app: 'OpenMol', version: app.getVersion() })
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

/** Server starten, wenn das Zertifikat schon eingerichtet ist (beim Start der App) */
export function startAddinServer(handlers) {
  onEdit = handlers.onEdit
  if (server || process.platform !== 'darwin' || !fs.existsSync(certFile()) || !fs.existsSync(keyFile())) return false
  server = https.createServer({ cert: fs.readFileSync(certFile()), key: fs.readFileSync(keyFile()) }, (req, res) => {
    handle(req, res).catch(() => send(res, 500, { error: 'Fehler' }))
  })
  server.on('error', (e) => {
    console.error('OpenMol: Word-Add-in-Server', e.message)
    server = null
  })
  server.listen(ADDIN_PORT, '127.0.0.1')
  return true
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
  if (process.platform !== 'darwin') return
  try {
    if (!fs.existsSync(certFile()) || !fs.existsSync(keyFile())) await makeCert()
    fs.mkdirSync(wefDir(), { recursive: true })
    fs.writeFileSync(path.join(wefDir(), 'OpenMol-Word-Addin.xml'), manifestXml())
    startAddinServer(handlers)
  } catch (e) {
    if (!test) await dialog.showMessageBox(win, { type: 'error', message: 'Word-Add-in konnte nicht eingerichtet werden', detail: String(e?.message ?? e) })
    return
  }
  const command = `security add-trusted-cert -r trustRoot -p ssl -k ~/Library/Keychains/login.keychain-db "${certFile()}"`
  if (test) {
    console.log('[word-addin] eingerichtet', { manifest: path.join(wefDir(), 'OpenMol-Word-Addin.xml'), trusted: await certTrusted(), command })
    return
  }
  const howTo = 'Word danach neu starten. Dann in Word: Einfügen ▸ Add-ins ▸ Meine Add-ins ▸ „OpenMol“ (unter „Entwickler-Add-ins“). Danach erscheint im Menüband „Start“ der Knopf „In OpenMol bearbeiten“.'
  if (await certTrusted()) {
    await dialog.showMessageBox(win, { type: 'info', message: 'Das Word-Add-in ist eingerichtet.', detail: howTo, buttons: ['OK'] })
    return
  }
  const r = await dialog.showMessageBox(win, {
    type: 'info',
    message: 'Dein Mac muss dem OpenMol-Zertifikat einmal vertrauen',
    detail:
      'Word zeigt Add-ins nur über HTTPS an. OpenMol hat dafür ein Zertifikat erzeugt, das ausschließlich für „localhost“ (diesen Rechner) gilt und nichts anderes beglaubigen kann. ' +
      '„Vertrauen …“ trägt es in deinen Schlüsselbund ein – macOS fragt dabei nach deinem Passwort.\n\nAlternativ im Terminal:\n' +
      command,
    buttons: ['Vertrauen …', 'Befehl in Zwischenablage', 'Abbrechen'],
    cancelId: 2,
  })
  if (r.response === 1) {
    const { clipboard } = await import('electron')
    await clipboard.writeText(command)
    return
  }
  if (r.response !== 0) return
  const t = await run('/usr/bin/security', ['add-trusted-cert', '-r', 'trustRoot', '-p', 'ssl', '-k', path.join(os.homedir(), 'Library', 'Keychains', 'login.keychain-db'), certFile()])
  const ok = await certTrusted()
  await dialog.showMessageBox(win, {
    type: ok ? 'info' : 'warning',
    message: ok ? 'Fertig – das Word-Add-in ist eingerichtet.' : 'Das Zertifikat ist noch nicht vertrauenswürdig.',
    detail: ok ? howTo : (t.out || 'Abgebrochen?') + '\n\nBefehl zum Wiederholen im Terminal:\n' + command,
    buttons: ['OK'],
  })
}
