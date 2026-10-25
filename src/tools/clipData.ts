// OpenMol-Daten, die ein kopiertes Bild mitnimmt (Versuch „Word-Austausch“): die kopierte Zeichnung als komprimierter
// Text „OM1:…“. Er steckt in einem Textblock des PNG (tEXt „openmol“) bzw. im Titel eines HTML-Bildes und soll beim
// Zurückkopieren aus Word/PowerPoint wieder zu einer bearbeitbaren Struktur werden.
import type { ClipData } from '../model/ops'
import type { DocStyle } from '../model/types'

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

/**
 * Zeichnung → „OM1:….“ (deflate, base64url – nur Zeichen, die in PNG-Textblöcken und HTML-Attributen unverändert
 * bleiben). Der Punkt am Ende beendet die Daten: im PNG folgt sonst die Prüfsumme des Blocks, deren Bytes zufällig
 * wie weitere Zeichen aussehen können.
 */
export async function encodeClipPayload(clip: ClipData, style?: DocStyle): Promise<string> {
  // ohne Seitenlayout: das Bild zeigt nur die Zeichnung
  const st = style ? { ...style, page: undefined } : undefined
  const json = JSON.stringify({ format: 'openmol-clip', version: 1, clip, style: st })
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate'))
  return MARK + b64url(new Uint8Array(await new Response(stream).arrayBuffer())) + '.'
}

async function decodeOnce(body: string): Promise<{ clip: ClipData; style?: Partial<DocStyle> } | null> {
  try {
    const bytes = fromB64url(body)
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
    const j = JSON.parse(await new Response(stream).text())
    const c = j?.format === 'openmol-clip' ? j.clip : null
    if (!c || !Array.isArray(c.atoms) || !Array.isArray(c.bonds)) return null
    for (const k of ['arrows', 'curved', 'texts', 'shapes'] as const) if (!Array.isArray(c[k])) c[k] = []
    return { clip: c as ClipData, style: j.style && typeof j.style === 'object' ? j.style : undefined }
  } catch {
    return null
  }
}

/**
 * „OM1:…“ → Zeichnung samt Dokumentstil (null, wenn beschädigt oder kein OpenMol-Inhalt). Ohne Endpunkt (ältere
 * Bilder) können hinten bis zu drei Zeichen aus der PNG-Prüfsumme hängen – dann diese abschneiden.
 */
export async function decodeClipFull(payload: string): Promise<{ clip: ClipData; style?: Partial<DocStyle> } | null> {
  const body = payload.slice(MARK.length).replace(/\.$/, '')
  for (let cut = 0; cut <= 3 && cut < body.length; cut++) {
    const c = await decodeOnce(cut ? body.slice(0, -cut) : body)
    if (c) return c
  }
  return null
}

/** nur die Zeichnung (zum Einfügen in ein vorhandenes Dokument) */
export async function decodeClipPayload(payload: string): Promise<ClipData | null> {
  return (await decodeClipFull(payload))?.clip ?? null
}

/** erstes „OM1:…“ in einem Text (HTML, Bilddaten als Latin-1 gelesen …) */
export function findClipPayload(text: string): string | null {
  return /OM1:[A-Za-z0-9_-]{16,}/.exec(text)?.[0] ?? null
}
