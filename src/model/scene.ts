// Abgeleitete Geometrie eines Dokuments (wird pro Dokumentversion einmal berechnet).
import { atomDecor, type AtomDecor } from './annot'
import { buildGraph, smallestRingOfBond, type Graph } from './chem'
import { layoutRich } from './richtext'
import { cycleBox } from './cycle'
import { stereoCenters } from './ocl'
import { computeFrags, type Frag } from './order'
import { cyclicLoop } from './polymer'
import {
  add,
  dist,
  lerp,
  mid,
  mul,
  norm,
  perp,
  rectExit,
  sub,
  unionBox,
  type Box,
  type Pt,
} from './geom'
import { tableGeom } from './stoichLayout'
import type { Anchor, Arrow, Bond, CurvedArrow, Doc, Id, TextObj } from './types'

export interface Scene {
  doc: Doc
  g: Graph
  decor: Map<Id, AtomDecor>
  ringCenter: Map<Id, Pt | null>
  /** Tiefenbereich bei 3D-Strukturen (null = flach oder Tiefendarstellung aus) */
  depth: { zmin: number; zmax: number } | null
  /** Moleküle (Zusammenhangskomponenten) für die Ebenen-Reihenfolge */
  frags: Frag[]
  fragOf: Map<Id, number>
}

/** 0 = vorne, 1 = hinten */
export function depthT(scene: Scene, z: number | undefined): number {
  const d = scene.depth
  if (!d || d.zmax - d.zmin < 1e-6) return 0
  return Math.min(1, Math.max(0, (d.zmax - (z ?? 0)) / (d.zmax - d.zmin)))
}

const cache = new WeakMap<Doc, Scene>()

export function getScene(doc: Doc): Scene {
  let s = cache.get(doc)
  if (s) return s
  const g = buildGraph(doc)
  const decor = new Map<Id, AtomDecor>()
  // CIP-Deskriptoren nur berechnen, wenn sie angezeigt werden sollen
  const cip = doc.style.showCip || Object.values(doc.atoms).some((a) => a.showCip) ? stereoCenters(doc) : null
  for (const id in doc.atoms) decor.set(id, atomDecor(g, doc.atoms[id], doc.style, cip?.get(id)))
  const ringCenter = new Map<Id, Pt | null>()
  for (const id in doc.bonds) {
    const b = doc.bonds[id]
    if (b.type !== 'double' && b.type !== 'aromatic') continue
    const ring = smallestRingOfBond(g, b, 8)
    if (!ring) {
      ringCenter.set(id, null)
      continue
    }
    let x = 0
    let y = 0
    for (const aid of ring) {
      x += doc.atoms[aid].x
      y += doc.atoms[aid].y
    }
    ringCenter.set(id, { x: x / ring.length, y: y / ring.length })
  }
  let depth: Scene['depth'] = null
  if (doc.style.depth3d !== false) {
    let zmin = Infinity
    let zmax = -Infinity
    for (const id in doc.atoms) {
      const z = doc.atoms[id].z
      if (z === undefined) continue
      zmin = Math.min(zmin, z)
      zmax = Math.max(zmax, z)
    }
    if (zmax - zmin > doc.style.bondLength * 0.6) depth = { zmin, zmax }
  }
  const { frags, fragOf } = computeFrags(doc, g.adj)
  s = { doc, g, decor, ringCenter, depth, frags, fragOf }
  cache.set(doc, s)
  return s
}

/** Abstand vom Atomzentrum, an dem eine Bindung in Richtung dir enden soll */
export function clipRadius(scene: Scene, atomId: Id, dir: Pt): number {
  const d = scene.decor.get(atomId)
  if (!d?.label) return 0
  const hw = dir.x > 0 ? (d.label.hwR ?? d.label.hw) : dir.x < 0 ? (d.label.hwL ?? d.label.hw) : d.label.hw
  let r = rectExit(dir, hw, d.label.hh * 0.86)
  // Strahl durch ein Zusatzrechteck (Ladung am Anker)? Dann erst hinter dessen Rand enden
  for (const bx of d.label.clipBoxes ?? []) {
    let lo = 0
    let hi = Infinity
    for (const [dv, a0, a1] of [
      [dir.x, bx.x1, bx.x2],
      [dir.y, bx.y1, bx.y2],
    ] as const) {
      if (Math.abs(dv) < 1e-9) {
        if (0 < a0 || 0 > a1) hi = -1
        continue
      }
      const ta = a0 / dv
      const tb = a1 / dv
      lo = Math.max(lo, Math.min(ta, tb))
      hi = Math.min(hi, Math.max(ta, tb))
    }
    if (hi >= lo && hi < Infinity) r = Math.max(r, hi)
  }
  return r + scene.doc.style.fontSize * 0.06
}

export function bondEnds(scene: Scene, b: Bond): { p1: Pt; p2: Pt; c1: number; c2: number } {
  const a1 = scene.doc.atoms[b.a1]
  const a2 = scene.doc.atoms[b.a2]
  const d = norm(sub(a2, a1))
  const c1 = clipRadius(scene, a1.id, d)
  const c2 = clipRadius(scene, a2.id, mul(d, -1))
  return { p1: add(a1, mul(d, c1)), p2: sub(a2, mul(d, c2)), c1, c2 }
}

/**
 * Schneidet eine (zur Bindung parallele) Linie p→q an den Label-Rechtecken der beiden Atome ab.
 * p liegt nahe a1, q nahe a2.
 */
export function clipParallel(scene: Scene, b: Bond, p: Pt, q: Pt): [Pt, Pt] {
  const fs = scene.doc.style.fontSize
  const v = sub(q, p)
  let t0 = 0
  let t1 = 1
  const exitT = (atomId: Id, fromStart: boolean) => {
    const d = scene.decor.get(atomId)
    if (!d?.label) return fromStart ? 0 : 1
    const a = scene.doc.atoms[atomId]
    const hwR = (d.label.hwR ?? d.label.hw) + fs * 0.06
    const hwL = (d.label.hwL ?? d.label.hw) + fs * 0.06
    const hh = d.label.hh * 0.86 + fs * 0.06
    // Slab-Verfahren: Parameterbereich, in dem die Linie im Rechteck liegt
    let lo = -Infinity
    let hi = Infinity
    for (const [o, dv, h0, h1] of [
      [p.x - a.x, v.x, hwL, hwR],
      [p.y - a.y, v.y, hh, hh],
    ] as const) {
      if (Math.abs(dv) < 1e-9) {
        if (o < -h0 || o > h1) return fromStart ? 0 : 1
        continue
      }
      const ta = (-h0 - o) / dv
      const tb = (h1 - o) / dv
      lo = Math.max(lo, Math.min(ta, tb))
      hi = Math.min(hi, Math.max(ta, tb))
    }
    if (lo > hi) return fromStart ? 0 : 1
    return fromStart ? Math.max(0, hi) : Math.min(1, lo)
  }
  t0 = exitT(b.a1, true)
  t1 = exitT(b.a2, false)
  if (t1 <= t0) return [p, p]
  return [add(p, mul(v, t0)), add(p, mul(v, t1))]
}

/** Seite der Zweitlinie einer Doppelbindung: +1 = perp(dir), -1 = Gegenseite, 0 = zentriert */
export function doubleSide(scene: Scene, b: Bond): number {
  const a1 = scene.doc.atoms[b.a1]
  const a2 = scene.doc.atoms[b.a2]
  const dir = sub(a2, a1)
  const n = perp(dir)
  if (b.doublePos === 'center') return 0
  if (b.doublePos === 'left') return 1
  if (b.doublePos === 'right') return -1
  const rc = scene.ringCenter.get(b.id)
  if (rc) return Math.sign(n.x * (rc.x - a1.x) + n.y * (rc.y - a1.y)) || 1
  let sum = 0
  let cnt1 = 0
  let cnt2 = 0
  for (const nb of scene.g.adj.get(a1.id) ?? []) {
    if (nb.other.id === a2.id) continue
    cnt1++
    sum += Math.sign(n.x * (nb.other.x - a1.x) + n.y * (nb.other.y - a1.y))
  }
  for (const nb of scene.g.adj.get(a2.id) ?? []) {
    if (nb.other.id === a1.id) continue
    cnt2++
    sum += Math.sign(n.x * (nb.other.x - a2.x) + n.y * (nb.other.y - a2.y))
  }
  if (cnt1 === 0 && cnt2 === 0) return 0
  // C=O, C=N mit beschriftetem Endatom und Nachbarn beidseits → zentriert
  const lab1 = !!scene.decor.get(a1.id)?.label
  const lab2 = !!scene.decor.get(a2.id)?.label
  if ((cnt1 === 0 && lab1) || (cnt2 === 0 && lab2)) {
    if (cnt1 >= 2 || cnt2 >= 2 || sum === 0) return 0
  }
  if (sum === 0) return 0
  return Math.sign(sum)
}

// ---------- Ankerpunkte für gebogene Pfeile ----------

export function anchorPoint(scene: Scene, a: Anchor): Pt | null {
  const doc = scene.doc
  switch (a.type) {
    case 'atom': {
      const at = doc.atoms[a.id]
      return at ? { x: at.x, y: at.y } : null
    }
    case 'bond': {
      const b = doc.bonds[a.id]
      if (!b) return null
      return mid(doc.atoms[b.a1], doc.atoms[b.a2])
    }
    case 'lp': {
      const d = scene.decor.get(a.id)
      const lp = d?.lonePairs[a.index] ?? d?.lonePairs[0]
      if (lp) return lp.c
      const at = doc.atoms[a.id]
      return at ? { x: at.x, y: at.y } : null
    }
    case 'point':
      return { x: a.x, y: a.y }
  }
}

function anchorClearance(scene: Scene, a: Anchor): number {
  const fs = scene.doc.style.fontSize
  if (a.type === 'atom') {
    const d = scene.decor.get(a.id)
    return d?.label ? Math.max(d.label.hw, d.label.hh) + fs * 0.15 : fs * 0.3
  }
  if (a.type === 'lp') return fs * 0.28
  if (a.type === 'bond') return fs * 0.15
  return 0
}

export interface CurveGeom {
  p0: Pt
  c: Pt
  p1: Pt
  /** Endrichtung (für die Pfeilspitze) */
  tip: Pt
  dirEnd: Pt
}

export function curvedGeom(scene: Scene, ca: CurvedArrow): CurveGeom | null {
  const s = anchorPoint(scene, ca.from)
  const e = anchorPoint(scene, ca.to)
  if (!s || !e) return null
  let d = dist(s, e)
  if (d < 1) d = 1
  const dir = norm(sub(e, s))
  const side = mul(perp(dir), Math.sign(ca.bend) || 1)
  // Enden seitlich (zur Bogenseite hin) vom Anker abheben
  const r0 = anchorClearance(scene, ca.from)
  const r1 = anchorClearance(scene, ca.to)
  const p0 = add(s, mul(norm(add(side, mul(dir, 0.6))), r0))
  const p1 = add(e, mul(norm(sub(side, mul(dir, 0.6))), r1))
  // kurze Pfeile (z. B. π-Bindung → Atom) brauchen einen Mindestbogen, sonst sind sie kaum sichtbar
  const L = scene.doc.style.bondLength
  const minOff = L * 0.85 * Math.max(0, 1 - d / (L * 1.8))
  const off = Math.max(Math.abs(ca.bend) * d, minOff)
  const c = add(mid(p0, p1), mul(side, off))
  const dirEnd = norm(sub(p1, c))
  return { p0, c, p1, tip: p1, dirEnd }
}

// ---------- Ringe ----------

/** Pfad aus mehreren Ringpolygonen, einheitlich orientiert (nahtlose Vereinigung bei nonzero) */
export function ringPolygonPath(polys: Pt[][]): string {
  const f = (n: number) => Math.round(n * 100) / 100
  return polys
    .map((poly) => {
      let area = 0
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]
        const b = poly[(i + 1) % poly.length]
        area += a.x * b.y - b.x * a.y
      }
      const pts = area < 0 ? [...poly].reverse() : poly
      return 'M' + pts.map((p) => `${f(p.x)},${f(p.y)}`).join(' L') + ' Z'
    })
    .join(' ')
}

// ---------- Text ----------

export function textLayoutOf(t: TextObj, doc?: Doc) {
  return layoutRich(t.text || ' ', { size: t.size, font: t.font ?? doc?.style.font, bold: t.bold, italic: t.italic, chem: t.chem })
}

export function textBox(t: TextObj, doc?: Doc): Box {
  const L = textLayoutOf(t, doc)
  const x1 = t.align === 'center' ? t.x - L.width / 2 : t.align === 'right' ? t.x - L.width : t.x
  const pad = t.bg ? t.size * 0.25 : 0
  return { x1: x1 - pad, y1: t.y - t.size * 0.5 - pad, x2: x1 + L.width + pad, y2: t.y - t.size * 0.5 + L.height + pad }
}

// ---------- Pfeilgeometrie ----------

/** Polylinie eines Reaktionspfeils (Start … Ende) */
export function arrowPoints(ar: Arrow): Pt[] {
  const s = { x: ar.x1, y: ar.y1 }
  const e = { x: ar.x2, y: ar.y2 }
  const t = ar.stepPos ?? 0.5
  switch (ar.route ?? 'straight') {
    case 'elbow-h':
      return [s, { x: e.x, y: s.y }, e]
    case 'elbow-v':
      return [s, { x: s.x, y: e.y }, e]
    case 'step-h': {
      const mx = s.x + (e.x - s.x) * t
      return [s, { x: mx, y: s.y }, { x: mx, y: e.y }, e]
    }
    case 'step-v': {
      const my = s.y + (e.y - s.y) * t
      return [s, { x: s.x, y: my }, { x: e.x, y: my }, e]
    }
    case 'bracket-h': {
      // Klammerpfeil: waagerecht hinaus, senkrecht, waagerecht zurück (z. B. 3 → 1 in einer Spalte)
      const r = ar.reach ?? -30
      const cx = (r < 0 ? Math.min(s.x, e.x) : Math.max(s.x, e.x)) + r
      return [s, { x: cx, y: s.y }, { x: cx, y: e.y }, e]
    }
    case 'bracket-v': {
      const r = ar.reach ?? -30
      const cy = (r < 0 ? Math.min(s.y, e.y) : Math.max(s.y, e.y)) + r
      return [s, { x: s.x, y: cy }, { x: e.x, y: cy }, e]
    }
    default:
      return [s, e]
  }
}

/** Segment, an dem die Bedingungen stehen (das längste) */
/** Segment, an dem die Bedingungen stehen: bei Winkelpfeilen das längste waagerechte, sonst das längste */
export function arrowLabelSegment(ar: Arrow): [Pt, Pt] {
  const pts = arrowPoints(ar)
  let best: [Pt, Pt] = [pts[0], pts[1]]
  let bl = -1
  let bestH: [Pt, Pt] | null = null
  let bhl = -1
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const l = dist(a, b)
    if (l > bl + 0.5) {
      bl = l
      best = [a, b]
    }
    if (Math.abs(a.y - b.y) < 0.5 && l > bhl + 0.5) {
      bhl = l
      bestH = [a, b]
    }
  }
  // Klammerpfeil: Bedingungen am Mittelstück
  if (ar.route === 'bracket-h' || ar.route === 'bracket-v') return [pts[1], pts[2]]
  if (pts.length > 2 && ar.labelSeg === 'v') {
    // längstes senkrechtes Teilstück (z. B. Winkelpfeil zwischen zwei Zeilen eines Schemas)
    let bv: [Pt, Pt] | null = null
    let bvl = -1
    for (let i = 1; i < pts.length; i++) {
      const l = dist(pts[i - 1], pts[i])
      if (Math.abs(pts[i - 1].x - pts[i].x) < 0.5 && l > bvl) {
        bvl = l
        bv = [pts[i - 1], pts[i]]
      }
    }
    if (bv && bvl > 10) return bv
  }
  return pts.length > 2 && bestH && bhl > 10 ? bestH : best
}

export function arrowTextOpts(doc: Doc, ar?: Arrow) {
  // Bedingungen und Ausbeute so groß wie die Atombeschriftungen (einheitliches Schriftbild in Reaktionen)
  return { size: doc.style.fontSize, font: doc.style.font, bold: ar?.bold || undefined }
}

/** Positionen der Bedingungs-Textblöcke: Mitte + Ausrichtung */
export type ArrowTextSide = 'above' | 'below'

/** Position eines Bedingungs-Textblocks (auch wenn er noch leer ist) */
export function arrowTextBlock(doc: Doc, ar: Arrow, which: ArrowTextSide) {
  const [a, b] = arrowLabelSegment(ar)
  const o = arrowTextOpts(doc, ar)
  const lw = doc.style.lineWidth
  const m = lerp(a, b, ar.labelPos ?? 0.5)
  const d = norm(sub(b, a))
  const vertical = Math.abs(d.y) > 0.7
  const lay = layoutRich(ar[which] || ' ', o)
  if (vertical) {
    // Senkrechter Pfeil: "über" = rechts, "unter" = links, vertikal zentriert
    const gap = o.size * 0.6 + lw * 2
    // rechts steht ggf. noch die Ausbeute darunter → beide zusammen vertikal zentrieren
    const extra = which === 'above' && yieldLabel(ar) ? yieldLayout(doc, ar).height + o.size * 0.25 : 0
    const y = m.y - (lay.height + extra) / 2 + o.size * 0.5
    return { lay, x: which === 'above' ? m.x + gap : m.x - gap, y, align: (which === 'above' ? 'left' : 'right') as 'left' | 'right' | 'center', vertical }
  }
  let n = perp(d)
  if (n.y > 0) n = mul(n, -1)
  const c =
    which === 'above' ? add(m, mul(n, o.size * 0.55 + lw * 2 + lay.lastY)) : add(m, mul(n, -(o.size * 1.15 + lw * 2)))
  return { lay, x: c.x, y: c.y, align: 'center' as 'left' | 'right' | 'center', vertical }
}

/** Anzeigetext der Ausbeute: reine Zahl → „86%“ */
export function yieldLabel(ar: Arrow): string {
  const t = (ar.yieldText ?? '').trim()
  if (!t) return ''
  return /^\d+([.,]\d+)?$/.test(t) ? t + '%' : t
}

function yieldLayout(doc: Doc, ar: Arrow) {
  const y = yieldLabel(ar)
  return layoutRich('<b>' + y.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</b>', arrowTextOpts(doc, ar))
}

/** Ausbeute-Block: waagerecht unter den Bedingungen, senkrecht rechts unter den Bedingungen */
export function arrowYieldBlock(doc: Doc, ar: Arrow) {
  const y = yieldLabel(ar)
  if (!y) return null
  const o = arrowTextOpts(doc)
  const lay = yieldLayout(doc, ar)
  const gapY = o.size * 0.25
  const [a, b] = arrowLabelSegment(ar)
  const d = norm(sub(b, a))
  if (Math.abs(d.y) > 0.7) {
    // rechts neben dem Pfeil, unter den (rechten) Bedingungen
    const ab = arrowTextBlock(doc, ar, 'above')
    if (ar.above) return { lay, x: ab.x, y: ab.y + ab.lay.height + gapY, align: 'left' as const, vertical: true }
    const m = lerp(a, b, ar.labelPos ?? 0.5)
    return { lay, x: ab.x, y: m.y + o.size * 0.35, align: 'left' as const, vertical: true }
  }
  const bl = arrowTextBlock(doc, ar, 'below')
  const yy = ar.below ? bl.y + bl.lay.height + gapY : bl.y
  return { lay, x: bl.x, y: yy, align: 'center' as const, vertical: false }
}

export function arrowTextBlocks(doc: Doc, ar: Arrow) {
  const blocks = (['above', 'below'] as const).filter((w) => ar[w]).map((w) => arrowTextBlock(doc, ar, w))
  const yb = arrowYieldBlock(doc, ar)
  return yb ? [...blocks, yb] : blocks
}

/** Auf welcher Seite des Pfeils liegt der Punkt (für das Beschriften per Doppelklick)? */
export function arrowSideAt(ar: Arrow, p: Pt): ArrowTextSide {
  const [a, b] = arrowLabelSegment(ar)
  const d = norm(sub(b, a))
  if (Math.abs(d.y) > 0.7) return p.x >= a.x ? 'above' : 'below'
  let n = perp(d)
  if (n.y > 0) n = mul(n, -1)
  return (p.x - a.x) * n.x + (p.y - a.y) * n.y >= 0 ? 'above' : 'below'
}

/** Pfeil, an dessen Beschriftungsbereich der Punkt liegt (Text-Werkzeug) */
export function arrowNearForText(doc: Doc, p: Pt): { id: Id; which: ArrowTextSide } | null {
  const fs = arrowTextOpts(doc).size
  for (const id in doc.arrows) {
    const ar = doc.arrows[id]
    const [a, b] = arrowLabelSegment(ar)
    const d = norm(sub(b, a))
    const l = dist(a, b)
    const t = (p.x - a.x) * d.x + (p.y - a.y) * d.y
    const off = Math.abs((p.x - a.x) * -d.y + (p.y - a.y) * d.x)
    if (t > -fs && t < l + fs && off < fs * 2.2) return { id, which: arrowSideAt(ar, p) }
  }
  return null
}

// ---------- Begrenzungsrahmen ----------

export function sceneBBox(scene: Scene, only?: Partial<Record<keyof Doc, Set<Id>>>): Box | null {
  const doc = scene.doc
  let box: Box | null = null
  const fs = doc.style.fontSize
  const want = (k: keyof Doc, id: Id) => !only || (only[k]?.has(id) ?? false)
  for (const id in doc.atoms) {
    if (!want('atoms', id)) continue
    const a = doc.atoms[id]
    const d = scene.decor.get(id)
    const l = d?.label
    box = unionBox(box, {
      x1: a.x + (l ? l.left : -2) - (d?.lonePairs.length ? fs * 0.4 : 0),
      y1: a.y + (l ? l.top : -2) - (d?.lonePairs.length || a.charge ? fs * 0.45 : 0),
      x2: a.x + (l ? l.right : 2) + (a.charge ? fs * 0.6 : 0) + (d?.lonePairs.length ? fs * 0.4 : 0),
      y2: a.y + (l ? l.bottom : 2) + (d?.lonePairs.length ? fs * 0.45 : 0),
    })
    // Atomnummer (und Stereo-Markierung) gehören zum Bild – sonst schneidet der Export sie ab
    for (const c of [d?.num?.c, d?.stereo?.c]) if (c) box = unionBox(box, { x1: c.x - fs * 0.45, y1: c.y - fs * 0.4, x2: c.x + fs * 0.45, y2: c.y + fs * 0.4 })
  }
  for (const id in doc.bonds) {
    if (!want('bonds', id)) continue
    const b = doc.bonds[id]
    const a1 = doc.atoms[b.a1]
    const a2 = doc.atoms[b.a2]
    box = unionBox(box, { x1: Math.min(a1.x, a2.x), y1: Math.min(a1.y, a2.y), x2: Math.max(a1.x, a2.x), y2: Math.max(a1.y, a2.y) })
  }
  for (const id in doc.arrows) {
    if (!want('arrows', id)) continue
    const ar = doc.arrows[id]
    const pad = 8
    for (const p of arrowPoints(ar)) box = unionBox(box, { x1: p.x - pad, y1: p.y - pad, x2: p.x + pad, y2: p.y + pad })
    for (const tb of arrowTextBlocks(doc, ar)) {
      const x1 = tb.align === 'center' ? tb.x - tb.lay.width / 2 : tb.align === 'right' ? tb.x - tb.lay.width : tb.x
      const sz = arrowTextOpts(doc).size
      box = unionBox(box, { x1, y1: tb.y - sz * 0.8, x2: x1 + tb.lay.width, y2: tb.y - sz * 0.8 + tb.lay.height })
    }
  }
  for (const id in doc.curved) {
    if (!want('curved', id)) continue
    const cg = curvedGeom(scene, doc.curved[id])
    if (!cg) continue
    for (let i = 0; i <= 8; i++) {
      const t = i / 8
      const p = add(mul(lerp(cg.p0, cg.c, t), 1 - t), mul(lerp(cg.c, cg.p1, t), t))
      box = unionBox(box, { x1: p.x - 6, y1: p.y - 6, x2: p.x + 6, y2: p.y + 6 })
    }
  }
  for (const id in doc.texts) {
    if (!want('texts', id)) continue
    box = unionBox(box, textBox(doc.texts[id], doc))
  }
  for (const id in doc.tables ?? {}) {
    if (!want('tables', id)) continue
    box = unionBox(box, tableGeom(doc, doc.tables[id]).box)
  }
  for (const id in doc.cycles ?? {}) {
    if (!want('cycles', id)) continue
    box = unionBox(box, cycleBox(doc, doc.cycles[id]))
  }
  for (const id in doc.shapes) {
    if (!want('shapes', id)) continue
    const s = doc.shapes[id]
    const idx = [s.corner, s.sub].filter(Boolean).map((t) => layoutRich(t!, { size: fs * 0.75, font: doc.style.font }).width + 4)
    const sh = s.shadow ? Math.max(3, Math.min(Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1)) * 0.035) : 0
    box = unionBox(box, {
      x1: Math.min(s.x1, s.x2) - 6,
      y1: Math.min(s.y1, s.y2) - 6,
      x2: Math.max(s.x1, s.x2) + Math.max(6 + sh, ...idx),
      y2: Math.max(s.y1, s.y2) + 6 + sh + (s.sub ? fs * 0.3 : 0),
    })
    const loop = cyclicLoop(doc, s)
    if (loop) box = unionBox(box, { x1: loop.cx - loop.rx - 4, y1: loop.cy - loop.ry - 4, x2: loop.cx + loop.rx + 4, y2: Math.max(loop.p1.y, loop.p2.y) + 4 })
  }
  return box
}

