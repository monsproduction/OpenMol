import { dist, distToQuad, distToSegment, inBox, inPolygon, type Box, type Pt } from './geom'
import { fillContains } from './rings'
import { arcLabelPos, branchGeom, cubicDist, eDist, linkGeom } from './cycle'
import { arrowPoints, arrowTextBlocks, arrowTextOpts, curvedGeom, textBox, type Scene } from './scene'
import type { Selection } from './types'
import { CLOSED_SHAPES, emptySelection } from './types'
import { tableGeom } from './stoichLayout'
import type { Hover } from '../store'

export interface HitOpts {
  /** Toleranz in Dokument-Einheiten */
  tol: number
  lonePairs?: boolean
  only?: ('atom' | 'bond' | 'objects')[]
}

export function hitTest(scene: Scene, p: Pt, o: HitOpts): Hover {
  const doc = scene.doc
  const want = (k: 'atom' | 'bond' | 'objects') => !o.only || o.only.includes(k)
  if (o.lonePairs) {
    for (const [id, d] of scene.decor) {
      for (let i = 0; i < d.lonePairs.length; i++) {
        if (dist(p, d.lonePairs[i].c) < o.tol * 0.8) return { kind: 'lp', id, index: i }
      }
    }
  }
  if (want('atom')) {
    let best: string | null = null
    let bd = o.tol * 1.15
    for (const id in doc.atoms) {
      const a = doc.atoms[id]
      const dd = dist(p, a)
      if (dd < bd) {
        bd = dd
        best = id
      }
    }
    // Bei kleinem Zoom überdecken die Fangbereiche der Atome sonst die ganze Bindung: liegt der Punkt im
    // mittleren Teil einer Bindung und näher an ihr als am Atom, gewinnt die Bindung
    if (best && want('bond')) {
      for (const id in doc.bonds) {
        const b = doc.bonds[id]
        const a1 = doc.atoms[b.a1]
        const a2 = doc.atoms[b.a2]
        const vx = a2.x - a1.x
        const vy = a2.y - a1.y
        const l2 = vx * vx + vy * vy || 1
        const t = ((p.x - a1.x) * vx + (p.y - a1.y) * vy) / l2
        if (t < 0.25 || t > 0.75) continue
        const dd = distToSegment(p, a1, a2)
        if (dd < o.tol * 0.8 && dd < bd) return { kind: 'bond', id }
      }
    }
    if (best) return { kind: 'atom', id: best }
    // Klick auf die Beschriftung (z. B. das H in H₂N oder „Me“ in OMe) trifft ebenfalls das Atom
    for (const [id, dc] of scene.decor) {
      const l = dc.label
      if (!l) continue
      const a = doc.atoms[id]
      if (p.x >= a.x + l.left - 2 && p.x <= a.x + l.right + 2 && p.y >= a.y + l.top - 2 && p.y <= a.y + l.bottom + 2) return { kind: 'atom', id }
    }
  }
  if (want('objects')) {
    for (const id in doc.curved) {
      const cg = curvedGeom(scene, doc.curved[id])
      if (cg && distToQuad(p, cg.p0, cg.c, cg.p1) < o.tol * 0.8) return { kind: 'curved', id }
    }
  }
  if (want('bond')) {
    let best: string | null = null
    let bd = o.tol * 0.8
    for (const id in doc.bonds) {
      const b = doc.bonds[id]
      const dd = distToSegment(p, doc.atoms[b.a1], doc.atoms[b.a2])
      if (dd < bd) {
        bd = dd
        best = id
      }
    }
    if (best) return { kind: 'bond', id: best }
  }
  if (want('objects')) {
    for (const id in doc.texts) {
      const b = textBox(doc.texts[id], doc)
      if (inBox(p, { x1: b.x1 - 3, y1: b.y1 - 3, x2: b.x2 + 3, y2: b.y2 + 3 })) return { kind: 'text', id }
    }
    for (const id in doc.arrows) {
      const pts = arrowPoints(doc.arrows[id])
      for (let i = 1; i < pts.length; i++) if (distToSegment(p, pts[i - 1], pts[i]) < o.tol) return { kind: 'arrow', id }
      // Klick auf die Beschriftung gehört zum Pfeil
      for (const tb of arrowTextBlocks(doc, doc.arrows[id])) {
        const sz = arrowTextOpts(doc).size
        const x1 = tb.align === 'center' ? tb.x - tb.lay.width / 2 : tb.align === 'right' ? tb.x - tb.lay.width : tb.x
        if (inBox(p, { x1: x1 - 2, y1: tb.y - sz * 0.9, x2: x1 + tb.lay.width + 2, y2: tb.y - sz * 0.9 + tb.lay.height + 2 })) return { kind: 'arrow', id }
      }
    }
    for (const id in doc.shapes) {
      const s = doc.shapes[id]
      const x1 = Math.min(s.x1, s.x2)
      const x2 = Math.max(s.x1, s.x2)
      const y1 = Math.min(s.y1, s.y2)
      const y2 = Math.max(s.y1, s.y2)
      const t = o.tol * 0.8
      const nearEdge =
        inBox(p, { x1: x1 - t, y1: y1 - t, x2: x2 + t, y2: y2 + t }) && !inBox(p, { x1: x1 + t, y1: y1 + t, x2: x2 - t, y2: y2 - t })
      if (nearEdge) return { kind: 'shape', id }
      // gefüllte Flächen/Kugeln auch im Inneren greifbar
      if (CLOSED_SHAPES.has(s.kind) && (s.fill || s.kind === 'sphere' || s.shadow) && inBox(p, { x1, y1, x2, y2 })) {
        if (s.kind !== 'ellipse' && s.kind !== 'sphere') return { kind: 'shape', id }
        const cx = (x1 + x2) / 2
        const cy = (y1 + y2) / 2
        if (((p.x - cx) / Math.max(1, (x2 - x1) / 2)) ** 2 + ((p.y - cy) / Math.max(1, (y2 - y1) / 2)) ** 2 <= 1) return { kind: 'shape', id }
      }
    }
    // Katalysezyklen: Linie, Seitenpfeile und Stations-Beschriftungen
    for (const id in doc.cycles ?? {}) {
      const c = doc.cycles[id]
      if (eDist(c, p) < o.tol) return { kind: 'cycle', id }
      for (const b of c.branches) {
        const g = branchGeom(c, b)
        if (distToQuad(p, g.from, g.q, g.to) < o.tol) return { kind: 'cycle', id }
      }
      for (const l of c.links ?? []) {
        const g = linkGeom(doc, c, l)
        if (g && cubicDist(g, p) < o.tol) return { kind: 'cycle', id }
      }
      for (const al of c.arcLabels ?? []) {
        if (!al.label) continue
        const lp = arcLabelPos(doc, c, al)
        if (Math.abs(p.x - lp.x) < doc.style.fontSize * 2.5 && Math.abs(p.y - lp.y) < doc.style.fontSize) return { kind: 'cycle', id }
      }
    }
    // Ansatztabellen: Klick irgendwo in die Tabelle
    for (const id in doc.tables ?? {}) {
      const b = tableGeom(doc, doc.tables[id]).box
      if (inBox(p, { x1: b.x1 - 4, y1: b.y1 - 4, x2: b.x2 + 4, y2: b.y2 + 4 })) return { kind: 'table', id }
    }
    // Ringfüllungen: Klick in die Fläche
    for (const id in doc.fills ?? {}) {
      if (fillContains(doc, doc.fills[id], p)) return { kind: 'fill', id }
    }
  }
  return null
}

/** Alle Objekte in einem Rechteck bzw. Lasso */
export function selectInRegion(scene: Scene, region: { box?: Box; poly?: Pt[] }): Selection {
  const doc = scene.doc
  const inside = (p: Pt) => (region.box ? inBox(p, region.box) : region.poly ? inPolygon(p, region.poly) : false)
  const sel = emptySelection()
  for (const id in doc.atoms) if (inside(doc.atoms[id])) sel.atoms.push(id)
  const as = new Set(sel.atoms)
  for (const id in doc.bonds) {
    const b = doc.bonds[id]
    if (as.has(b.a1) && as.has(b.a2)) sel.bonds.push(id)
  }
  for (const id in doc.arrows) {
    const a = doc.arrows[id]
    if (inside({ x: a.x1, y: a.y1 }) && inside({ x: a.x2, y: a.y2 })) sel.arrows.push(id)
  }
  for (const id in doc.texts) {
    const b = textBox(doc.texts[id], doc)
    if (inside({ x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 })) sel.texts.push(id)
  }
  for (const id in doc.shapes) {
    const s = doc.shapes[id]
    if (inside({ x: s.x1, y: s.y1 }) && inside({ x: s.x2, y: s.y2 })) sel.shapes.push(id)
  }
  for (const id in doc.curved) {
    const cg = curvedGeom(scene, doc.curved[id])
    if (cg && inside(cg.p0) && inside(cg.p1)) sel.curved.push(id)
  }
  for (const id in doc.cycles ?? {}) {
    const c = doc.cycles[id]
    if (inside({ x: c.cx - c.rx, y: c.cy }) && inside({ x: c.cx + c.rx, y: c.cy }) && inside({ x: c.cx, y: c.cy - c.ry }) && inside({ x: c.cx, y: c.cy + c.ry })) sel.cycles.push(id)
  }
  for (const id in doc.fills ?? {}) {
    if (doc.fills[id].rings.every((r) => r.every((a) => as.has(a)))) sel.fills.push(id)
  }
  for (const id in doc.tables ?? {}) {
    const b = tableGeom(doc, doc.tables[id]).box
    if (inside({ x: b.x1, y: b.y1 }) && inside({ x: b.x2, y: b.y2 })) sel.tables.push(id)
  }
  return sel
}

export function hoverToSel(h: Hover): Selection {
  const s = emptySelection()
  if (!h) return s
  if (h.kind === 'atom' || h.kind === 'lp') s.atoms.push(h.id)
  else if (h.kind === 'bond') s.bonds.push(h.id)
  else if (h.kind === 'arrow') s.arrows.push(h.id)
  else if (h.kind === 'curved') s.curved.push(h.id)
  else if (h.kind === 'text') s.texts.push(h.id)
  else if (h.kind === 'shape') s.shapes.push(h.id)
  else if (h.kind === 'fill') s.fills.push(h.id)
  else if (h.kind === 'cycle') s.cycles.push(h.id)
  else if (h.kind === 'table') s.tables.push(h.id)
  return s
}

export function mergeSel(a: Selection, b: Selection, toggle = false): Selection {
  const out = emptySelection()
  for (const k of Object.keys(out) as (keyof Selection)[]) {
    const set = new Set(a[k])
    for (const id of b[k]) {
      if (toggle && set.has(id)) set.delete(id)
      else set.add(id)
    }
    out[k] = [...set]
  }
  return out
}

export function selHas(s: Selection, h: Hover): boolean {
  if (!h) return false
  if (h.kind === 'atom' || h.kind === 'lp') return s.atoms.includes(h.id)
  if (h.kind === 'bond') return s.bonds.includes(h.id)
  if (h.kind === 'arrow') return s.arrows.includes(h.id)
  if (h.kind === 'curved') return s.curved.includes(h.id)
  if (h.kind === 'text') return s.texts.includes(h.id)
  if (h.kind === 'shape') return s.shapes.includes(h.id)
  if (h.kind === 'fill') return s.fills.includes(h.id)
  if (h.kind === 'cycle') return (s.cycles ?? []).includes(h.id)
  if (h.kind === 'table') return (s.tables ?? []).includes(h.id)
  return false
}
