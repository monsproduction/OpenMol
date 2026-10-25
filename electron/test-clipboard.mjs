// Automatischer Test der Zwischenablage (läuft vor jedem Release, siehe package.json „test:clipboard“): Bild mit
// OpenMol-Daten schreiben und zurücklesen, Daten im Office-ZIP-Format und mit angehängten Prüfsummen-Bytes finden.
// Prüft genau den Code der App (electron/clipboard.mjs) – Electron hat die Zwischenablage schon einmal umgebaut.
// Aufruf: npx electron electron/test-clipboard.mjs   (überschreibt kurz die Zwischenablage, Text wird zurückgelegt)
import { app, clipboard } from 'electron'
import zlib from 'node:zlib'
import { findPayload, scanClipboard, validPayload, writePng } from './clipboard.mjs'

const fails = []
const check = (name, ok) => {
  console.log((ok ? 'OK    ' : 'FEHLER') + ' ' + name)
  if (!ok) fails.push(name)
}

function chunk(type, data) {
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(body))
  return Buffer.concat([head, body, crc])
}

/** gültiges 1×1-PNG mit Textblock „openmol“ */
function pngWithText(text) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const pixels = zlib.deflateSync(Buffer.from([0, 255, 255, 255, 255]))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('tEXt', Buffer.from('openmol\0' + text, 'latin1')), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))])
}

/** ZIP mit einem gepackten Teil (wie das Office-Zeichnungsformat mit dem Titel des Alternativtexts) */
function zipWith(name, content) {
  const data = zlib.deflateRawSync(Buffer.from(content))
  const n = Buffer.from(name)
  const lh = Buffer.alloc(30)
  lh.writeUInt32LE(0x04034b50, 0)
  lh.writeUInt16LE(8, 8)
  lh.writeUInt32LE(data.length, 18)
  lh.writeUInt16LE(n.length, 26)
  const body = Buffer.concat([lh, n, data])
  const cd = Buffer.alloc(46)
  cd.writeUInt32LE(0x02014b50, 0)
  cd.writeUInt16LE(8, 10)
  cd.writeUInt32LE(data.length, 20)
  cd.writeUInt16LE(n.length, 28)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(cd.length + n.length, 12)
  eocd.writeUInt32LE(body.length, 16)
  return Buffer.concat([body, cd, n, eocd])
}

app.whenReady().then(async () => {
  let saved = ''
  try {
    saved = await clipboard.readText()
  } catch {
    // keine Textdaten
  }
  const clip = { atoms: [{ id: 'a', x: 0, y: 0, element: 'C', charge: 0, radical: 0, lonePairs: 0 }], bonds: [], arrows: [], curved: [], texts: [], shapes: [] }
  const payload = 'OM1:' + zlib.deflateSync(JSON.stringify({ format: 'openmol-clip', version: 1, clip })).toString('base64url')
  try {
    check('Nutzlast gültig', validPayload(payload))
    check('Nutzlast mit Endpunkt gültig', validPayload(payload + '.'))
    check('Nutzlast mit angehängten Prüfsummen-Bytes gültig', validPayload(payload + 'H7'))
    check('Daten im PNG gefunden', findPayload(pngWithText(payload + '.')) === payload)
    check('Daten im gepackten Office-ZIP gefunden', findPayload(zipWith('drs/e2oDoc.xml', `<pic:cNvPr id="1" title="${payload}" descr="OpenMol-Struktur"/>`)) === payload)
    check('Kaputtes ZIP ohne Absturz', findPayload(Buffer.from('PK\x03\x04kaputt' + 'x'.repeat(50))) === null)
    if (process.platform === 'darwin') {
      await writePng(pngWithText(payload + '.'))
      check('Zwischenablage: geschrieben und wiedergefunden (Mac, roh als public.png)', (await scanClipboard()) === payload)
    } else console.log('–      Zwischenablage-Test nur auf dem Mac (Windows schreibt noch ohne Daten)')
  } catch (e) {
    check('Test lief ohne Fehler: ' + e.message, false)
  } finally {
    if (saved) await clipboard.writeText(saved).catch(() => {})
    else clipboard.clear()
  }
  console.log(fails.length ? `\n${fails.length} Fehler – Zwischenablage funktioniert nicht wie erwartet` : '\nZwischenablage-Test bestanden')
  app.exit(fails.length ? 1 : 0)
})
