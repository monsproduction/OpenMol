// OpenMol-Daten, die ein kopiertes Bild mitnimmt: die kopierte Zeichnung als komprimierter Text „OM1:….“. Er steckt
// in einem Textblock des PNG (tEXt „openmol“) und – nach dem Bearbeiten über das Word-Add-in – im Titel des
// Alternativtexts. Aus Word/PowerPoint zurückkopiert wird daraus wieder eine bearbeitbare Struktur.
// Regel für künftige Versionen: „OM1“ und das Feld `version` nie umdeuten – ein neues Format bekommt „OM2:“, und der
// Leser für ältere Formate bleibt erhalten (Bilder in Word-Dokumenten leben lange).
import type { ClipData } from '../model/ops'
import type { DocStyle } from '../model/types'
import { emptyDoc, normalizeDoc } from '../model/types'

const MARK = 'OM1:'
/** Obergrenze für Objekte aus einem Bild (Schutz vor manipulierten Dokumenten) */
const MAX_OBJECTS = 20000

/**
 * Zeichnung aus einem Bild so prüfen wie eine geöffnete Datei: Word-Dokumente können von anderen stammen. Kaputte
 * Atome/Bindungen/Pfeile/Texte fallen weg (siehe normalizeDoc), zu große Inhalte werden abgelehnt.
 */
function sanitizeClip(c: Record<string, unknown>): ClipData | null {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((o) => o && typeof o === 'object' && typeof (o as { id?: unknown }).id === 'string') : [])
  const keys = ['atoms', 'bonds', 'arrows', 'curved', 'texts', 'shapes', 'fills', 'cycles', 'tables'] as const
  if (keys.reduce((n, k) => n + list(c[k]).length, 0) > MAX_OBJECTS) return null
  const byId = (v: unknown) => Object.fromEntries(list(v).map((o) => [(o as { id: string }).id, o]))
  const raw = Object.fromEntries(keys.map((k) => [k, byId(c[k])]))
  // Farbverläufe (Liste → Objekt; geprüft in normalizeDoc)
  const grads = Array.isArray(c.gradients) ? Object.fromEntries(c.gradients.filter((g) => g && typeof g.id === 'string').map((g) => [g.id, g])) : undefined
  const d = normalizeDoc({ ...emptyDoc(), ...raw, gradients: grads })
  return {
    atoms: Object.values(d.atoms),
    bonds: Object.values(d.bonds),
    arrows: Object.values(d.arrows),
    curved: Object.values(d.curved),
    texts: Object.values(d.texts),
    shapes: Object.values(d.shapes),
    fills: Object.values(d.fills),
    cycles: Object.values(d.cycles),
    tables: Object.values(d.tables),
    gradients: Object.values(d.gradients ?? {}),
  }
}

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
    if (!c || typeof c !== 'object' || !Array.isArray(c.atoms) || !Array.isArray(c.bonds)) return null
    const clip = sanitizeClip(c)
    if (!clip) return null
    // der Stil wird beim Anlegen des Dokuments mit normalizeDoc geprüft (siehe wordLink.ts)
    return { clip, style: j.style && typeof j.style === 'object' && !Array.isArray(j.style) ? j.style : undefined }
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
