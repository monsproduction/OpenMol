// Zwischenablage der Desktop-App: Bild mit OpenMol-Daten schreiben und Daten aus allen Formaten zurücklesen.
// Eigenes Modul, damit der automatische Test (electron/test-clipboard.mjs) genau diesen Code prüft – Electron hat die
// Zwischenablage-Schnittstelle schon einmal grundlegend geändert (44: nur noch read()/write() mit ClipboardItem).
import { clipboard, ClipboardItem } from 'electron'
import zlib from 'node:zlib'

const RAW = (format) => `electron application/osclipboard;format="${format}"`

/** wie die Zwischenablage zuletzt beschrieben wurde (für test-clipboard.mjs) */
export let lastWriteMode = ''

/**
 * PNG mit Datenblock auf die Zwischenablage. Mac: roh als public.png – als image/png würde Chromium es neu codieren
 * und den Datenblock verwerfen; Word und PowerPoint für Mac behalten es unverändert (getestet).
 * Windows (getestet 2026-10-26, Windows 11, Word aus Microsoft 365, Paint): nur roh im Format „PNG“. Gemeinsam mit
 * einem normalen Bild (image/png) setzt sich unter Windows das von Chromium neu codierte PNG durch – die Daten gehen
 * verloren; clipboard.read() zeigt das rohe „PNG“ nicht an (der Rücklese-Test liest es deshalb mit PowerShell). Das
 * rohe „PNG“ behält die Daten; Word übernimmt es, beim erneuten Kopieren aus Word stecken die Daten im Format
 * „Art::GVML ClipFormat“ (das scanClipboard() liest), und Paint fügt es als Bild ein.
 */
export async function writePng(data) {
  const blob = () => new Blob([Buffer.from(data)], { type: 'image/png' })
  if (process.platform === 'darwin') {
    await clipboard.write([new ClipboardItem({ [RAW('public.png')]: blob() })])
    lastWriteMode = 'mac-raw'
    return true
  }
  if (process.platform !== 'win32') {
    await clipboard.write([new ClipboardItem({ 'image/png': blob() })])
    lastWriteMode = 'plain'
    return true
  }
  await clipboard.write([new ClipboardItem({ [RAW('PNG')]: blob() })])
  lastWriteMode = 'win-raw-only'
  return true
}

const OM_RE = /OM1:[A-Za-z0-9_-]{16,}/

/**
 * Teile eines ZIP-Pakets (Office-Zeichnungsformat der Zwischenablage, Word-Dokument) entpacken – über das
 * Inhaltsverzeichnis am Ende, Teile bis 50 MB
 */
export function zipParts(buf) {
  const out = []
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0 || eocd + 22 > buf.length) return out
  let p = buf.readUInt32LE(eocd + 16)
  const n = buf.readUInt16LE(eocd + 10)
  for (let i = 0; i < n && p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50; i++) {
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const local = buf.readUInt32LE(p + 42)
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32)
    if (local + 30 > buf.length || size > 50e6) continue
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const data = buf.subarray(start, start + size)
    try {
      out.push(method === 8 ? zlib.inflateRawSync(data) : data)
    } catch {
      // beschädigter Teil – überspringen
    }
  }
  return out
}

/**
 * in einem Puffer nach „OM1:…“ suchen: direkt (PNG, ungepackt im Office-Format), in den gepackten Teilen eines
 * ZIP-Pakets (Titel des Alternativtexts im Office-Zeichnungsformat) und in data-URIs von HTML (base64)
 */
export function findPayload(buf) {
  const latin = buf.toString('latin1')
  const m = OM_RE.exec(latin)
  if (m) return m[0]
  if (latin.startsWith('PK\x03\x04'))
    for (const part of zipParts(buf)) {
      const z = OM_RE.exec(part.toString('latin1'))
      if (z) return z[0]
    }
  for (const d of latin.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)) {
    const n = OM_RE.exec(Buffer.from(d[1], 'base64').toString('latin1'))
    if (n) return n[0]
  }
  return null
}

/** prüfen, ob die Nutzlast eine gültige OpenMol-Zeichnung ist (deflate + JSON); hinten können bis zu drei Zeichen
 *  aus der PNG-Prüfsumme hängen (Bilder ohne Endpunkt) – wie beim Einlesen in der Oberfläche abschneiden */
export function validPayload(p) {
  const body = p.slice(4).replace(/\.$/, '')
  for (let cut = 0; cut <= 3; cut++) {
    try {
      const j = JSON.parse(zlib.inflateSync(Buffer.from(cut ? body.slice(0, -cut) : body, 'base64url')).toString('utf8'))
      if (j?.format === 'openmol-clip' && Array.isArray(j.clip?.atoms)) return true
    } catch {
      // nächste Länge versuchen
    }
  }
  return false
}

/**
 * Formate der Zwischenablage (auch die eigenen von Word/PowerPoint, z. B. com.microsoft.Art--GVML-ClipFormat) nach
 * OpenMol-Daten durchsuchen; Rückgabe: erste gültige Nutzlast oder null. Nur gerenderte Bilder (TIFF – oft mehrere MB –,
 * PDF, JPEG, unter Windows Bitmaps und Metafiles) werden übersprungen: darin stecken nie Daten.
 */
export async function scanClipboard() {
  for (const item of await clipboard.read()) {
    for (const type of item.types) {
      if (/tiff|pdf|jpeg|findtext|bmp|dib|bitmap|metafile|emf|wmf/i.test(type)) continue
      let buf
      try {
        buf = Buffer.from(await (await item.getType(type)).arrayBuffer())
      } catch {
        continue
      }
      const p = buf.length ? findPayload(buf) : null
      if (p && validPayload(p)) return p
    }
  }
  return null
}

