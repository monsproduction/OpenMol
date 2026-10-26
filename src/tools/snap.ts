// Magnetische Hilfslinien: beim Verschieben an Kanten und Mitten anderer Objekte einrasten
import { fragments } from '../model/chem'
import type { Box } from '../model/geom'
import { selectionAtomIds } from '../model/ops'
import { arrowPoints, sceneBBox, textBox, type Scene } from '../model/scene'
import type { Selection } from '../model/types'
import { cycleBox } from '../model/cycle'
import { pageRects, PT_PER_UNIT } from '../model/pages'
import type { Doc } from '../model/types'

/** Dokument-Einheiten je mm des gedruckten Blatts */
export const UNITS_PER_MM = 72 / 25.4 / PT_PER_UNIT

/** Nullpunkt von Linealen und Raster: linke obere Ecke der Seiten, ohne Seitenlayout der Ursprung */
export function layoutOrigin(doc: Doc): { x: number; y: number } {
  const p = doc.style.page
  return p ? { x: p.x, y: p.y } : { x: 0, y: 0 }
}

/** Hilfslinien (Mitte bevorzugt) und – falls eingeschaltet – Seitenränder, Satzspiegel und Seitenmitte */
function addLayoutRefs(refs: SnapRefs, doc: Doc) {
  const aids = doc.style.aids
  // unendlich lange Linien: die angezeigte Hilfslinie reicht dann genau über das bewegte Objekt
  for (const x of aids?.guidesX ?? []) refs.v.push({ x, y1: Infinity, y2: -Infinity, center: true })
  for (const y of aids?.guidesY ?? []) refs.h.push({ y, x1: Infinity, x2: -Infinity, center: true })
  const page = doc.style.page
  if (!aids?.snapPage || !page) return
  const m = (aids.margin ?? 0) * UNITS_PER_MM
  for (const r of pageRects(page)) {
    const b = { x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y + r.h }
    addBox(refs, b)
    if (m > 0 && m * 2 < Math.min(r.w, r.h)) addBox(refs, { x1: b.x1 + m, y1: b.y1 + m, x2: b.x2 - m, y2: b.y2 - m })
  }
}

/** Verschiebung am Raster einrasten (Mitte des bewegten Objekts), nur auf Achsen ohne andere Hilfslinie */
export function gridSnapMove(doc: Doc, box: Box, dx: number, dy: number, guides: Guide[]): { dx: number; dy: number } {
  const g = (doc.style.aids?.grid ?? 0) * UNITS_PER_MM
  if (!(g > 0)) return { dx, dy }
  const o = layoutOrigin(doc)
  const cx = (box.x1 + box.x2) / 2 + dx
  const cy = (box.y1 + box.y2) / 2 + dy
  return {
    dx: guides.some((gd) => gd.kind === 'v') ? dx : dx + o.x + Math.round((cx - o.x) / g) * g - cx,
    dy: guides.some((gd) => gd.kind === 'h') ? dy : dy + o.y + Math.round((cy - o.y) / g) * g - cy,
  }
}

export interface HRef {
  y: number
  x1: number
  x2: number
  /** Mittellinie (bevorzugt beim Einrasten) */
  center: boolean
  /** Pfeilende */
  point?: boolean
}
export interface VRef {
  x: number
  y1: number
  y2: number
  center: boolean
  point?: boolean
}
export interface SnapRefs {
  h: HRef[]
  v: VRef[]
}
export interface Guide {
  kind: 'h' | 'v'
  pos: number
  a: number
  b: number
}

function addBox(refs: SnapRefs, b: Box, edges = true) {
  const cx = (b.x1 + b.x2) / 2
  const cy = (b.y1 + b.y2) / 2
  refs.h.push({ y: cy, x1: b.x1, x2: b.x2, center: true })
  refs.v.push({ x: cx, y1: b.y1, y2: b.y2, center: true })
  if (!edges) return
  refs.h.push({ y: b.y1, x1: b.x1, x2: b.x2, center: false }, { y: b.y2, x1: b.x1, x2: b.x2, center: false })
  refs.v.push({ x: b.x1, y1: b.y1, y2: b.y2, center: false }, { x: b.x2, y1: b.y1, y2: b.y2, center: false })
}

/** Referenzlinien aller nicht ausgewählten Objekte */
export function collectRefs(scene: Scene, sel: Selection): SnapRefs {
  const doc = scene.doc
  const refs: SnapRefs = { h: [], v: [] }
  const selAtoms = selectionAtomIds(doc, sel)
  const free = Object.keys(doc.atoms).filter((id) => !selAtoms.has(id))
  for (const f of fragments(doc, scene.g, free)) {
    const set = new Set(f)
    const bonds = new Set(Object.values(doc.bonds).filter((b) => set.has(b.a1) && set.has(b.a2)).map((b) => b.id))
    const b = sceneBBox(scene, { atoms: set, bonds })
    if (b) addBox(refs, b)
  }
  for (const id in doc.arrows) {
    if (sel.arrows.includes(id)) continue
    const pts = arrowPoints(doc.arrows[id])
    // jedes Pfeilsegment: Linie selbst ist die Referenz (z. B. Molekül auf Pfeilhöhe)
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const c = pts[i]
      if (Math.abs(a.y - c.y) < 0.5) refs.h.push({ y: a.y, x1: Math.min(a.x, c.x), x2: Math.max(a.x, c.x), center: true })
      if (Math.abs(a.x - c.x) < 0.5) refs.v.push({ x: a.x, y1: Math.min(a.y, c.y), y2: Math.max(a.y, c.y), center: true })
    }
    const s = pts[0]
    const e = pts[pts.length - 1]
    refs.v.push({ x: (s.x + e.x) / 2, y1: Math.min(s.y, e.y), y2: Math.max(s.y, e.y), center: true })
    // Pfeilspitzen und -anfänge: gleiche Höhe / gleiche Fluchtlinie
    for (const q of [s, e]) {
      refs.h.push({ y: q.y, x1: q.x, x2: q.x, center: true, point: true })
      refs.v.push({ x: q.x, y1: q.y, y2: q.y, center: true, point: true })
    }
  }
  for (const id in doc.texts) if (!sel.texts.includes(id)) addBox(refs, textBox(doc.texts[id], doc))
  for (const id in doc.cycles ?? {}) {
    if ((sel.cycles ?? []).includes(id)) continue
    addBox(refs, cycleBox(doc, doc.cycles[id]))
  }
  for (const id in doc.shapes) {
    if (sel.shapes.includes(id)) continue
    const s = doc.shapes[id]
    addBox(refs, { x1: Math.min(s.x1, s.x2), y1: Math.min(s.y1, s.y2), x2: Math.max(s.x1, s.x2), y2: Math.max(s.y1, s.y2) })
  }
  addLayoutRefs(refs, doc)
  return refs
}

function pick<R>(refs: R[], val: (r: R) => number, isCenter: (r: R) => boolean, primary: number[], secondary: number[], tol: number): number | null {
  // Zuerst Mitte/Pfeilenden (gleiche Höhe), erst wenn nichts passt Kanten
  let best: number | null = null
  for (const r of refs) {
    if (!isCenter(r)) continue
    for (const m of primary) {
      const d = val(r) - m
      if (Math.abs(d) <= tol && (best === null || Math.abs(d) < Math.abs(best))) best = d
    }
  }
  if (best !== null) return best
  for (const r of refs) {
    for (const m of [...primary, ...secondary]) {
      const d = val(r) - m
      if (Math.abs(d) <= tol * 0.8 && (best === null || Math.abs(d) < Math.abs(best))) best = d
    }
  }
  return best
}

function guidesFor(refs: SnapRefs, ys: number[], xs: number[], span: Box, snappedY: boolean, snappedX: boolean): Guide[] {
  const guides: Guide[] = []
  if (snappedY)
    for (const r of refs.h) {
      if (!ys.some((y) => Math.abs(y - r.y) < 0.5)) continue
      guides.push({ kind: 'h', pos: r.y, a: Math.min(r.x1, span.x1), b: Math.max(r.x2, span.x2) })
    }
  if (snappedX)
    for (const r of refs.v) {
      if (!xs.some((x) => Math.abs(x - r.x) < 0.5)) continue
      guides.push({ kind: 'v', pos: r.x, a: Math.min(r.y1, span.y1), b: Math.max(r.y2, span.y2) })
    }
  return guides
}

/**
 * Verschiebung so korrigieren, dass Kanten/Mitten einrasten; liefert Hilfslinien zur Anzeige.
 * `keys`: zusätzliche Fangpunkte der bewegten Objekte (z. B. Pfeilspitzen), die wie Mitten behandelt werden.
 */
export function snapMove(box: Box, dx: number, dy: number, refs: SnapRefs, tol: number, keys: { x: number; y: number }[] = [], keysOnly = false): { dx: number; dy: number; guides: Guide[] } {
  const cx = (box.x1 + box.x2) / 2 + dx
  const cy = (box.y1 + box.y2) / 2 + dy
  const kx = keys.map((k) => k.x + dx)
  const ky = keys.map((k) => k.y + dy)
  const primX = keysOnly ? kx : [cx, ...kx]
  const primY = keysOnly ? ky : [cy, ...ky]
  const secX = keysOnly ? [] : [box.x1 + dx, box.x2 + dx]
  const secY = keysOnly ? [] : [box.y1 + dy, box.y2 + dy]
  const bestY = pick(refs.h, (r) => r.y, (r) => r.center, primY, secY, tol)
  const bestX = pick(refs.v, (r) => r.x, (r) => r.center, primX, secX, tol)
  const ndx = dx + (bestX ?? 0)
  const ndy = dy + (bestY ?? 0)
  const nb = { x1: box.x1 + ndx, x2: box.x2 + ndx, y1: box.y1 + ndy, y2: box.y2 + ndy }
  const ys = [...(keysOnly ? [] : [nb.y1, (nb.y1 + nb.y2) / 2, nb.y2]), ...keys.map((k) => k.y + ndy)]
  const xs = [...(keysOnly ? [] : [nb.x1, (nb.x1 + nb.x2) / 2, nb.x2]), ...keys.map((k) => k.x + ndx)]
  return { dx: ndx, dy: ndy, guides: guidesFor(refs, ys, xs, nb, bestY !== null, bestX !== null) }
}

/** Einzelnen Punkt (z. B. Pfeilspitze) einrasten; `axes` begrenzt die Richtung */
export function snapPoint(p: { x: number; y: number }, refs: SnapRefs, tol: number, axes: 'xy' | 'x' | 'y' = 'xy'): { p: { x: number; y: number }; guides: Guide[] } {
  const bestY = axes === 'x' ? null : pick(refs.h, (r) => r.y, (r) => r.center, [p.y], [], tol)
  const bestX = axes === 'y' ? null : pick(refs.v, (r) => r.x, (r) => r.center, [p.x], [], tol)
  const q = { x: p.x + (bestX ?? 0), y: p.y + (bestY ?? 0) }
  return { p: q, guides: guidesFor(refs, [q.y], [q.x], { x1: q.x, x2: q.x, y1: q.y, y2: q.y }, bestY !== null, bestX !== null) }
}
