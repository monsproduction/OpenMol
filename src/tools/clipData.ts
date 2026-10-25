// OpenMol-Daten, die ein kopiertes Bild mitnimmt (Versuch „Word-Austausch“): die kopierte Zeichnung als komprimierter
// Text „OM1:…“. Er steckt in einem Textblock des PNG (tEXt „openmol“) bzw. im Titel eines HTML-Bildes und soll beim
// Zurückkopieren aus Word/PowerPoint wieder zu einer bearbeitbaren Struktur werden.
import type { ClipData } from '../model/ops'

const MARK = 'OM1:'

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}

/** Zeichnung → „OM1:…“ (deflate, base64url – nur Zeichen, die in PNG-Textblöcken und HTML-Attributen unverändert bleiben) */
export async function encodeClipPayload(clip: ClipData): Promise<string> {
  const json = JSON.stringify({ format: 'openmol-clip', version: 1, clip })
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate'))
  return MARK + b64url(new Uint8Array(await new Response(stream).arrayBuffer()))
}

/** „OM1:…“ → Zeichnung (null, wenn beschädigt oder kein OpenMol-Inhalt) */
export async function decodeClipPayload(payload: string): Promise<ClipData | null> {
  try {
    const bytes = fromB64url(payload.slice(MARK.length))
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
    const j = JSON.parse(await new Response(stream).text())
    const c = j?.format === 'openmol-clip' ? j.clip : null
    if (!c || !Array.isArray(c.atoms) || !Array.isArray(c.bonds)) return null
    for (const k of ['arrows', 'curved', 'texts', 'shapes'] as const) if (!Array.isArray(c[k])) c[k] = []
    return c as ClipData
  } catch {
    return null
  }
}

/** erstes „OM1:…“ in einem Text (HTML, Bilddaten als Latin-1 gelesen …) */
export function findClipPayload(text: string): string | null {
  return /OM1:[A-Za-z0-9_-]{16,}/.exec(text)?.[0] ?? null
}
