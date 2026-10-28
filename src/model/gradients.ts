// Farbverläufe für Linien, Beschriftungen und Textmarker (Inspektor ▸ Farbe & Deckkraft): Objekte tragen statt einer
// Farbe den Verweis „grad:<id>“ (in color bzw. highlight); der Verlauf selbst steht in doc.gradients und spannt sich
// über alle Objekte, die ihn verwenden – z. B. über das ganze markierte Molekül.
import type { Doc, Gradient, Id } from './types'

export const GRAD_PREFIX = 'grad:'
export const isGrad = (c: string | undefined): c is string => !!c && c.startsWith(GRAD_PREFIX)
export const gradId = (c: string) => c.slice(GRAD_PREFIX.length)
/** Element-Id im SVG */
export const gradElId = (id: Id) => 'og-' + id.replace(/[^A-Za-z0-9_-]/g, '')

/** Farbe für die Darstellung: Verlauf als url(#…), fehlender Verlauf → undefined (Standardfarbe) */
export function paint(doc: Doc, c: string | undefined): string | undefined {
  if (!isGrad(c)) return c
  return doc.gradients?.[gradId(c)] ? `url(#${gradElId(gradId(c))})` : undefined
}

/** eine feste Farbe (für CDXML, Farbwähler …): bei Verläufen die erste Farbe */
export function solid(doc: Doc, c: string | undefined): string | undefined {
  if (!isGrad(c)) return c
  return doc.gradients?.[gradId(c)]?.c1
}

type ColorField = 'color' | 'highlight'
const KINDS = ['atoms', 'bonds', 'arrows', 'curved', 'texts', 'shapes', 'cycles'] as const

/** alle Verweise auf Verläufe (Objektart, Id, Feld) */
function* refs(doc: Doc): Generator<{ kind: (typeof KINDS)[number]; id: Id; field: ColorField; gid: Id }> {
  for (const kind of KINDS)
    for (const o of Object.values((doc[kind] ?? {}) as Record<Id, { id: Id; color?: string; highlight?: string }>)) {
      if (!o) continue
      if (isGrad(o.color)) yield { kind, id: o.id, field: 'color', gid: gradId(o.color) }
      if (isGrad(o.highlight)) yield { kind, id: o.id, field: 'highlight', gid: gradId(o.highlight) }
    }
}

/** nach jeder Änderung: nicht mehr verwendete Verläufe entfernen */
export function pruneGradients(d: Doc) {
  if (!d.gradients) return
  const used = new Set<Id>()
  for (const r of refs(d)) used.add(r.gid)
  for (const id of Object.keys(d.gradients)) if (!used.has(id)) delete d.gradients[id]
  if (!Object.keys(d.gradients).length) delete d.gradients
}

/** Objekte je Verlauf (für die Fläche, über die er sich spannt) */
export function gradientMembers(doc: Doc): Map<Id, Partial<Record<(typeof KINDS)[number], Set<Id>>>> {
  const out = new Map<Id, Partial<Record<(typeof KINDS)[number], Set<Id>>>>()
  for (const r of refs(doc)) {
    let m = out.get(r.gid)
    if (!m) out.set(r.gid, (m = {}))
    ;(m[r.kind] ??= new Set()).add(r.id)
  }
  return out
}

export function validGradient(g: unknown, id: Id, safe: (c: unknown) => string | undefined): Gradient | null {
  if (!g || typeof g !== 'object') return null
  const x = g as Partial<Gradient>
  const c1 = safe(x.c1)
  const c2 = safe(x.c2)
  if (!c1 || !c2) return null
  return { id, c1, c2, grad: x.grad === 'radial' ? 'radial' : 'linear', angle: typeof x.angle === 'number' && Number.isFinite(x.angle) ? x.angle : 0 }
}
