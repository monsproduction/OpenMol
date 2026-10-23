// Ringerkennung für Ringfüllungen und aromatische Kreise
import { smallestRingOfBond, type Graph } from './chem'
import { inPolygon, type Pt } from './geom'
import type { Doc, Id, RingFill } from './types'
import { uid } from './types'

export function ringKey(r: Id[]): string {
  return [...r].sort().join(',')
}

/** Alle kleinsten Ringe (je Bindung der kleinste Ring, dedupliziert) */
export function perceiveRings(doc: Doc, g: Graph, maxSize = 12): Id[][] {
  const seen = new Set<string>()
  const out: Id[][] = []
  for (const id in doc.bonds) {
    const r = smallestRingOfBond(g, doc.bonds[id], maxSize)
    if (!r || r.length < 3) continue
    const k = ringKey(r)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(r)
  }
  return out
}

function polyArea(pts: Pt[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a / 2)
}

/** Kleinster Ring, der den Punkt enthält */
export function ringAt(doc: Doc, rings: Id[][], p: Pt): Id[] | null {
  let best: Id[] | null = null
  let bestA = Infinity
  for (const r of rings) {
    const pts = r.map((id) => doc.atoms[id])
    if (!inPolygon(p, pts)) continue
    const a = polyArea(pts)
    if (a < bestA) {
      bestA = a
      best = r
    }
  }
  return best
}

const shareBond = (a: Id[], b: Id[]) => a.filter((x) => b.includes(x)).length >= 2

/** Alle über gemeinsame Bindungen verbundenen Ringe (anelliertes System) */
export function ringSystem(rings: Id[][], start: Id[]): Id[][] {
  const keyStart = ringKey(start)
  const sys: Id[][] = [rings.find((r) => ringKey(r) === keyStart) ?? start]
  const used = new Set([keyStart])
  for (let i = 0; i < sys.length; i++) {
    for (const r of rings) {
      const k = ringKey(r)
      if (used.has(k) || !shareBond(sys[i], r)) continue
      used.add(k)
      sys.push(r)
    }
  }
  return sys
}

export type FillStyle = Pick<RingFill, 'mode' | 'grad' | 'c1' | 'c2' | 'angle' | 'opacity'>

const sameStyle = (f: RingFill, s: FillStyle) =>
  f.mode === s.mode && f.grad === s.grad && f.c1 === s.c1 && f.c2 === s.c2 && f.angle === s.angle && f.opacity === s.opacity

/** Ring(e) füllen; ein Klick auf einen schon gleich gefüllten Ring entfernt ihn wieder */
/** Füllung (Modus „fill“) von den angegebenen Ringen entfernen */
export function removeRingFill(d: Doc, rings: Id[][]) {
  const keys = new Set(rings.map(ringKey))
  for (const f of Object.values(d.fills)) {
    if (f.mode !== 'fill') continue
    f.rings = f.rings.filter((r) => !keys.has(ringKey(r)))
    if (!f.rings.length) delete d.fills[f.id]
  }
}

/** merge = false: nicht an eine benachbarte gleich gefüllte Fläche anschließen (eigener Verlauf je Ring) */
export function applyRingFill(d: Doc, ringsToFill: Id[][], style: FillStyle, toggle: boolean, merge = true) {
  const keys = new Set(ringsToFill.map(ringKey))
  // Ist bereits genau so gefüllt? → entfernen
  if (toggle && ringsToFill.length === 1) {
    for (const f of Object.values(d.fills)) {
      if (f.mode !== style.mode) continue
      const idx = f.rings.findIndex((r) => keys.has(ringKey(r)))
      if (idx < 0) continue
      if (sameStyle(f, style)) {
        f.rings.splice(idx, 1)
        if (!f.rings.length) delete d.fills[f.id]
        return
      }
    }
  }
  // aus anderen Füllungen gleichen Modus herausnehmen
  for (const f of Object.values(d.fills)) {
    if (f.mode !== style.mode) continue
    f.rings = f.rings.filter((r) => !keys.has(ringKey(r)))
    if (!f.rings.length) delete d.fills[f.id]
  }
  // an benachbarte Füllung mit gleichem Stil anschließen (gemeinsamer Verlauf)
  const neighbor = merge
    ? Object.values(d.fills).find((f) => sameStyle(f, style) && f.rings.some((r) => ringsToFill.some((n) => shareBond(r, n))))
    : undefined
  if (neighbor) {
    neighbor.rings.push(...ringsToFill.map((r) => [...r]))
    return neighbor.id
  }
  const id = uid('f')
  d.fills[id] = { id, rings: ringsToFill.map((r) => [...r]), ...style }
  return id
}

/** Entfernt Ringe mit gelöschten Atomen */
export function pruneFills(d: Doc) {
  for (const f of Object.values(d.fills ?? {})) {
    f.rings = f.rings.filter((r) => r.every((id) => d.atoms[id]))
    if (!f.rings.length) delete d.fills[f.id]
  }
}

export function fillContains(doc: Doc, f: RingFill, p: Pt): boolean {
  return f.rings.some((r) => {
    const pts = r.map((id) => doc.atoms[id]).filter(Boolean)
    return pts.length >= 3 && inPolygon(p, pts)
  })
}
