// Geometrie von Katalysezyklen: runde/elliptische Kreisläufe mit Stationen (Unterbrechungen),
// Pfeilspitzen je Bogenstück sowie Zu- und Abflüssen (tangential einmündende Seitenpfeile).
import type { Box, Pt } from './geom'
import { layoutRich } from './richtext'
import type { Cycle, CycleArcLabel, CycleBranch, CycleLink, Doc, Id } from './types'
import { uid } from './types'

const RAD = Math.PI / 180
const norm360 = (a: number) => ((a % 360) + 360) % 360

export function ePoint(c: Cycle, deg: number): Pt {
  return { x: c.cx + c.rx * Math.cos(deg * RAD), y: c.cy + c.ry * Math.sin(deg * RAD) }
}

/** Tangente in Flussrichtung */
export function eTangent(c: Cycle, deg: number): Pt {
  const s = c.dir === 'cw' ? 1 : -1
  const x = -c.rx * Math.sin(deg * RAD) * s
  const y = c.ry * Math.cos(deg * RAD) * s
  const l = Math.hypot(x, y) || 1
  return { x: x / l, y: y / l }
}

/** Normale nach außen */
export function eNormal(c: Cycle, deg: number): Pt {
  const x = Math.cos(deg * RAD) / c.rx
  const y = Math.sin(deg * RAD) / c.ry
  const l = Math.hypot(x, y) || 1
  return { x: x / l, y: y / l }
}

/** Winkel eines Punkts auf dem Zyklus */
export function eAngle(c: Cycle, p: Pt): number {
  return norm360(Math.atan2((p.y - c.cy) / c.ry, (p.x - c.cx) / c.rx) / RAD)
}

/** Ungefährer Abstand eines Punkts von der Zykluslinie */
export function eDist(c: Cycle, p: Pt): number {
  const rho = Math.hypot((p.x - c.cx) / c.rx, (p.y - c.cy) / c.ry)
  return Math.abs(rho - 1) * Math.min(c.rx, c.ry)
}

const meanR = (c: Cycle) => (c.rx + c.ry) / 2

export function stationLabelSize(doc: Doc) {
  // Beschriftungen im Zyklus so groß wie die Atombeschriftungen
  return { size: doc.style.fontSize, font: doc.style.font }
}

/** Lücke einer Station in Grad (automatisch passend zur Beschriftung) */
export function stationGap(doc: Doc, c: Cycle, i: number): number {
  const st = c.stations[i]
  if (st.gap !== undefined) return st.gap
  if (!st.label) return c.gap
  const o = stationLabelSize(doc)
  const lay = layoutRich(st.label, o)
  const t = eTangent(c, st.angle)
  // Ausdehnung des Labels entlang der Tangente
  const ext = Math.abs(t.x) * lay.width + Math.abs(t.y) * lay.height
  return Math.max(c.gap * 0.6, ((ext + o.size * 1.1) / meanR(c)) / RAD)
}

/** Halbe Lückenbreiten einer Station: zur Seite kleinerer (lo) bzw. größerer Winkel (hi) */
export function stationHalfGaps(doc: Doc, c: Cycle, i: number): { lo: number; hi: number } {
  const st = c.stations[i]
  const g = stationGap(doc, c, i) / 2
  return { lo: st.gapLo ?? g, hi: st.gapHi ?? g }
}

export interface ArcSeg {
  /** Start- und Endwinkel in Flussrichtung */
  a0: number
  a1: number
  path: string
  tip: Pt
  dir: Pt
}

const f = (n: number) => Math.round(n * 100) / 100

function arcPath(c: Cycle, a0: number, a1: number): string {
  // a0 → a1 in Flussrichtung; Bogen ggf. in zwei Teile zerlegen (SVG-Bogen max. 360°)
  const p0 = ePoint(c, a0)
  const p1 = ePoint(c, a1)
  const span = Math.abs(a1 - a0)
  const sweep = c.dir === 'cw' ? 1 : 0
  if (span >= 359.9) {
    const mid = ePoint(c, (a0 + a1) / 2)
    return `M${f(p0.x)},${f(p0.y)} A${f(c.rx)},${f(c.ry)} 0 1 ${sweep} ${f(mid.x)},${f(mid.y)} A${f(c.rx)},${f(c.ry)} 0 1 ${sweep} ${f(p1.x)},${f(p1.y)}`
  }
  const large = span > 180 ? 1 : 0
  return `M${f(p0.x)},${f(p0.y)} A${f(c.rx)},${f(c.ry)} 0 ${large} ${sweep} ${f(p1.x)},${f(p1.y)}`
}

/** Bogenstücke zwischen den Stationen (mit Platz für die Pfeilspitze) */
export function cycleSegments(doc: Doc, c: Cycle, headLen: number): ArcSeg[] {
  const segs: ArcSeg[] = []
  const r = meanR(c)
  const headDeg = c.heads ? (headLen * 0.7) / r / RAD : 0
  const n = c.stations.length
  if (n === 0) {
    const a0 = 0
    const a1 = c.dir === 'cw' ? 359.99 : -359.99
    const end = c.dir === 'cw' ? a1 - headDeg : a1 + headDeg
    segs.push({ a0, a1, path: arcPath(c, a0, end), tip: ePoint(c, a1), dir: eTangent(c, a1) })
    return segs
  }
  const order = c.stations.map((s, i) => ({ a: norm360(s.angle), i })).sort((p, q) => p.a - q.a)
  for (let k = 0; k < n; k++) {
    const cur = order[k]
    const nxt = order[(k + 1) % n]
    // Bogen von cur (Seite größerer Winkel) bis nxt (Seite kleinerer Winkel) – jede Seite einzeln einstellbar
    const g0 = stationHalfGaps(doc, c, cur.i).hi
    const g1 = stationHalfGaps(doc, c, nxt.i).lo
    let start: number
    let end: number
    if (c.dir === 'cw') {
      start = cur.a + g0
      end = nxt.a - g1 + (k === n - 1 || nxt.a <= cur.a ? 360 : 0)
      if (n === 1) end = cur.a + 360 - g1
      if (end - start < 2) continue
      const tipA = end
      segs.push({ a0: start, a1: end, path: arcPath(c, start, end - headDeg), tip: ePoint(c, tipA), dir: eTangent(c, tipA) })
    } else {
      start = nxt.a - g1 + (k === n - 1 || nxt.a <= cur.a ? 360 : 0)
      end = cur.a + g0
      if (n === 1) {
        start = cur.a + 360 - g1
        end = cur.a + g0
      }
      if (start - end < 2) continue
      segs.push({ a0: start, a1: end, path: arcPath(c, start, end + headDeg), tip: ePoint(c, end), dir: eTangent(c, end) })
    }
  }
  return segs
}

export interface BranchGeom {
  /** Punkt auf dem Zyklus */
  m: Pt
  /** freies Ende */
  e: Pt
  /** Kontrollpunkt (quadratische Bézierkurve) */
  q: Pt
  /** Pfad vom Anfang zum Ende (in Flussrichtung) */
  from: Pt
  to: Pt
  tipDir: Pt
}

export function branchGeom(c: Cycle, b: CycleBranch): BranchGeom {
  const m = ePoint(c, b.angle)
  const t = eTangent(c, b.angle)
  const n = eNormal(c, b.angle)
  const side = b.side === 'in' ? -1 : 1
  const flow = c.dir === 'cw' ? 1 : -1
  // Zufluss kommt von stromaufwärts, Abfluss läuft stromabwärts weg
  const along = b.type === 'in' ? -b.span * flow : b.span * flow
  const base = ePoint(c, b.angle + along)
  const e = { x: base.x + n.x * side * b.reach, y: base.y + n.y * side * b.reach }
  const k = Math.hypot(e.x - m.x, e.y - m.y) * 0.55
  const q = b.type === 'in' ? { x: m.x - t.x * k, y: m.y - t.y * k } : { x: m.x + t.x * k, y: m.y + t.y * k }
  const from = b.type === 'in' ? e : m
  const to = b.type === 'in' ? m : e
  const dx = to.x - q.x
  const dy = to.y - q.y
  const l = Math.hypot(dx, dy) || 1
  return { m, e, q, from, to, tipDir: { x: dx / l, y: dy / l } }
}

/** Bogenlänge, Seite und Abstand eines Seitenpfeils so, dass sein freies Ende bei `p` liegt */
export function branchFromPoint(c: Cycle, angle: number, type: 'in' | 'out', p: Pt): { span: number; side: 'in' | 'out'; reach: number } {
  const flow = c.dir === 'cw' ? 1 : -1
  let delta = (eAngle(c, p) - angle) * flow
  delta = ((delta % 360) + 540) % 360 - 180
  const span = Math.max(3, Math.min(160, type === 'out' ? delta : -delta))
  const rho = Math.hypot((p.x - c.cx) / c.rx, (p.y - c.cy) / c.ry)
  const signed = (rho - 1) * meanR(c)
  return { span, side: signed >= 0 ? 'out' : 'in', reach: Math.max(8, Math.abs(signed)) }
}

/** Position der Branch-Beschriftung: hinter dem freien Ende, vom Zyklus weg */
export function branchLabelPos(doc: Doc, c: Cycle, b: CycleBranch): { x: number; y: number; align: 'left' | 'center' | 'right' } {
  const g = branchGeom(c, b)
  const away = { x: g.e.x - g.q.x, y: g.e.y - g.q.y }
  const l = Math.hypot(away.x, away.y) || 1
  const d = { x: away.x / l, y: away.y / l }
  const fs = stationLabelSize(doc).size
  const p = { x: g.e.x + d.x * fs * 0.6, y: g.e.y + d.y * fs * 0.6 + fs * 0.35 }
  const align = d.x > 0.35 ? 'left' : d.x < -0.35 ? 'right' : 'center'
  if (align === 'center') p.y += d.y > 0 ? fs * 0.4 : -fs * 0.3
  return { ...p, align }
}

// ---------- Verbindungspfeile zwischen Zyklen ----------

export interface LinkGeom {
  /** kubische Bézierkurve p0 → p3 */
  p0: Pt
  c1: Pt
  c2: Pt
  p3: Pt
  tipDir: Pt
}

export function cubicAt(g: LinkGeom, t: number): Pt {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const cc = 3 * u * t * t
  const d = t * t * t
  return { x: a * g.p0.x + b * g.c1.x + cc * g.c2.x + d * g.p3.x, y: a * g.p0.y + b * g.c1.y + cc * g.c2.y + d * g.p3.y }
}

function unit(v: Pt): Pt {
  const l = Math.hypot(v.x, v.y) || 1
  return { x: v.x / l, y: v.y / l }
}

/** Geometrie eines Verbindungspfeils aus Start- und Zielwinkel (Endpunkte vorgegeben) */
export function linkCurve(a: Cycle, angle: number, b: Cycle | null, p3: Pt, tAngle: number | null, bend = 1): LinkGeom {
  const p0 = ePoint(a, angle)
  const d = unit({ x: p3.x - p0.x, y: p3.y - p0.y })
  const len = Math.hypot(p3.x - p0.x, p3.y - p0.y)
  // tangential in Flussrichtung verlassen; zeigt die Tangente vom Ziel weg, in Richtung Ziel abknicken
  let t0 = eTangent(a, angle)
  const dot0 = t0.x * d.x + t0.y * d.y
  if (dot0 < 0.2) t0 = unit({ x: t0.x * 0.35 + d.x, y: t0.y * 0.35 + d.y })
  let t1 = b && tAngle !== null ? eTangent(b, tAngle) : d
  const dot1 = t1.x * d.x + t1.y * d.y
  if (dot1 < 0.2) t1 = unit({ x: t1.x * 0.35 + d.x, y: t1.y * 0.35 + d.y })
  const k = Math.min(len * 0.45, 160) * bend
  const c1 = { x: p0.x + t0.x * k, y: p0.y + t0.y * k }
  const c2 = { x: p3.x - t1.x * k, y: p3.y - t1.y * k }
  const tip = unit({ x: p3.x - c2.x, y: p3.y - c2.y })
  return { p0, c1, c2, p3, tipDir: k > 0.5 ? tip : d }
}

export function linkGeom(doc: Doc, c: Cycle, l: CycleLink): LinkGeom | null {
  const b = doc.cycles?.[l.target]
  if (!b) return null
  return linkCurve(c, l.angle, b, ePoint(b, l.tAngle), l.tAngle, l.bend ?? 1)
}

export function cubicDist(g: LinkGeom, p: Pt): number {
  let best = Infinity
  let prev = g.p0
  for (let i = 1; i <= 32; i++) {
    const q = cubicAt(g, i / 32)
    const vx = q.x - prev.x
    const vy = q.y - prev.y
    const l2 = vx * vx + vy * vy || 1
    const t = Math.max(0, Math.min(1, ((p.x - prev.x) * vx + (p.y - prev.y) * vy) / l2))
    best = Math.min(best, Math.hypot(p.x - prev.x - vx * t, p.y - prev.y - vy * t))
    prev = q
  }
  return best
}

/** Beschriftung neben der Kurvenmitte, auf der vom Zyklenpaar abgewandten Seite */
export function linkLabelPos(doc: Doc, c: Cycle, l: CycleLink): { x: number; y: number; align: 'left' | 'center' | 'right' } | null {
  const g = linkGeom(doc, c, l)
  const b = doc.cycles?.[l.target]
  if (!g || !b) return null
  const m = cubicAt(g, 0.5)
  const m2 = cubicAt(g, 0.52)
  const tg = unit({ x: m2.x - m.x, y: m2.y - m.y })
  const fs = stationLabelSize(doc).size
  // die Seite wählen, auf der das Label weiter von beiden Zykluslinien entfernt ist
  const n1 = { x: -tg.y, y: tg.x }
  const clear = (n: Pt) => {
    const q = { x: m.x + n.x * fs * 1.6, y: m.y + n.y * fs * 1.6 }
    return Math.min(eDist(c, q), eDist(b, q))
  }
  const n = clear(n1) >= clear({ x: -n1.x, y: -n1.y }) ? n1 : { x: -n1.x, y: -n1.y }
  const p = { x: m.x + n.x * fs * 0.7, y: m.y + n.y * fs * 0.7 + fs * 0.35 }
  const align = n.x > 0.35 ? 'left' : n.x < -0.35 ? 'right' : 'center'
  if (align === 'center') p.y += n.y > 0 ? fs * 0.4 : -fs * 0.3
  return { ...p, align }
}

export function newLink(angle: number, target: Id, tAngle: number): CycleLink {
  return { id: uid('k'), angle: norm360(angle), target, tAngle: norm360(tAngle), head: true }
}

/** Radius der Ellipse in Richtung (geometrischer Winkel, Bogenmaß) */
export function eRadiusAt(c: Cycle, rad: number): number {
  const co = Math.cos(rad)
  const si = Math.sin(rad)
  return (c.rx * c.ry) / Math.sqrt((c.ry * co) ** 2 + (c.rx * si) ** 2)
}

/** Verbindungen zu nicht mehr vorhandenen Zyklen entfernen */
export function pruneLinks(doc: Doc) {
  for (const id in doc.cycles ?? {}) {
    const c = doc.cycles[id]
    if (c.links?.some((l) => !doc.cycles[l.target] || l.target === id)) c.links = c.links.filter((l) => doc.cycles[l.target] && l.target !== id)
  }
}

export function cycleBox(doc: Doc, c: Cycle): Box {
  let b: Box = { x1: c.cx - c.rx - 8, y1: c.cy - c.ry - 8, x2: c.cx + c.rx + 8, y2: c.cy + c.ry + 8 }
  const grow = (p: Pt, pad = 10) => {
    b = { x1: Math.min(b.x1, p.x - pad), y1: Math.min(b.y1, p.y - pad), x2: Math.max(b.x2, p.x + pad), y2: Math.max(b.y2, p.y + pad) }
  }
  for (const br of c.branches) {
    const g = branchGeom(c, br)
    grow(g.e)
    grow(g.q, 2)
    if (br.label) {
      const lp = branchLabelPos(doc, c, br)
      const w = layoutRich(br.label, stationLabelSize(doc)).width
      grow({ x: lp.align === 'left' ? lp.x + w : lp.align === 'right' ? lp.x - w : lp.x, y: lp.y })
    }
  }
  for (const l of c.links ?? []) {
    const g = linkGeom(doc, c, l)
    if (!g) continue
    for (let i = 1; i < 8; i++) grow(cubicAt(g, i / 8), 4)
    if (l.label) {
      const lp = linkLabelPos(doc, c, l)
      if (lp) {
        const w = layoutRich(l.label, stationLabelSize(doc)).width
        grow({ x: lp.align === 'left' ? lp.x + w : lp.align === 'right' ? lp.x - w : lp.x - w / 2, y: lp.y })
        if (lp.align === 'center') grow({ x: lp.x + w / 2, y: lp.y })
      }
    }
  }
  for (const al of c.arcLabels ?? []) {
    if (!al.label) continue
    const lp = arcLabelPos(doc, c, al)
    const lay = layoutRich(al.label, stationLabelSize(doc))
    const x1 = lp.align === 'left' ? lp.x : lp.align === 'right' ? lp.x - lay.width : lp.x - lay.width / 2
    grow({ x: x1, y: lp.y - lay.lineH }, 2)
    grow({ x: x1 + lay.width, y: lp.y + lay.height - lay.lineH }, 2)
  }
  for (const st of c.stations) {
    if (!st.label) continue
    const p = ePoint(c, st.angle)
    const w = layoutRich(st.label, stationLabelSize(doc)).width
    grow({ x: p.x - w / 2, y: p.y }, 14)
    grow({ x: p.x + w / 2, y: p.y }, 14)
  }
  return b
}

export function newCycle(cx: number, cy: number, r: number, stations: number, dir: 'cw' | 'ccw'): Cycle {
  return {
    id: uid('y'),
    cx,
    cy,
    rx: r,
    ry: r,
    dir,
    gap: 34,
    heads: true,
    stations: Array.from({ length: stations }, (_, i) => ({ angle: norm360(-90 + (i * 360) / stations) })),
    branches: [],
  }
}

/** Stationen gleichmäßig verteilen (Anzahl ändern), vorhandene Beschriftungen bleiben in Reihenfolge erhalten */
export function redistribute(c: Cycle, n: number) {
  const old = [...c.stations].sort((a, b) => norm360(a.angle + 90) - norm360(b.angle + 90))
  c.stations = Array.from({ length: n }, (_, i) => ({ ...(old[i] ?? {}), angle: norm360(-90 + (i * 360) / n) }))
}

export function newBranch(angle: number, type: 'in' | 'out', r: number): CycleBranch {
  return { id: uid('k'), angle: norm360(angle), type, side: 'out', span: 22, reach: Math.max(30, r * 0.35), head: type === 'out' }
}


// ---------- Schrittbezeichnungen ----------

/** Position einer Schrittbezeichnung: Textblock (zentriert) neben dem Bogen, innen oder außen */
export function arcLabelPos(doc: Doc, c: Cycle, l: CycleArcLabel): { x: number; y: number; align: 'left' | 'center' | 'right' } {
  const o = stationLabelSize(doc)
  const p = ePoint(c, l.angle)
  const n = eNormal(c, l.angle)
  const s = l.side === 'out' ? 1 : -1
  const lay = layoutRich(l.label || ' ', o)
  const dir = { x: n.x * s, y: n.y * s }
  // Abstand so, dass die nahe Kante des Textblocks ~0,6 Schriftgrößen von der Linie entfernt ist …
  const half = Math.abs(dir.x) * (lay.width / 2) + Math.abs(dir.y) * (lay.height / 2)
  let d = o.size * 0.6 + half + (l.off ?? 0)
  // … und der ganze Block (alle Ecken) mit Abstand innen bzw. außen liegt – der Bogen ist gekrümmt
  const margin = o.size * 0.35
  const clear = (dd: number) => {
    const bx = p.x + dir.x * dd
    const by = p.y + dir.y * dd
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const x = bx + (sx * lay.width) / 2
      const y = by + (sy * lay.height) / 2
      const rho = Math.hypot((x - c.cx) / (c.rx + (s > 0 ? -margin : margin)), (y - c.cy) / (c.ry + (s > 0 ? -margin : margin)))
      if (s > 0 ? rho < 1 : rho > 1) return false
    }
    return true
  }
  for (let k = 0; k < 40 && !clear(d); k++) d += o.size * 0.25
  const cx = p.x + dir.x * d
  const cy = p.y + dir.y * d
  return { x: cx, y: cy + o.size * 0.35 - lay.lastY / 2, align: 'center' }
}

export function newArcLabel(angle: number, side: 'in' | 'out' = 'in'): CycleArcLabel {
  return { id: uid('al'), angle: norm360(angle), side, label: '' }
}

/** Zu-/Abfluss-Paar an einer Stelle (Edukt rein, Nebenprodukt raus – wie D → [Base]H⁺X⁻) */
export function newBranchPair(angle: number, r: number): CycleBranch[] {
  const a = newBranch(angle, 'in', r)
  const b = newBranch(angle, 'out', r)
  return [a, b]
}

/**
 * Zweiter Zyklus, der den ersten an der Stelle `angle` überlappt (kleiner, gegenläufig, zwei Stationen
 * abseits der Überlappung) – wie der Cu-Zyklus an der Transmetallierung der Sonogashira-Kupplung.
 */
export function attachCycle(c: Cycle, angle: number): Cycle {
  const R = meanR(c)
  const r = Math.round(R * 0.5)
  const p = ePoint(c, angle)
  const n = eNormal(c, angle)
  const cx = p.x + n.x * r * 0.45
  const cy = p.y + n.y * r * 0.45
  const back = (Math.atan2(-n.y, -n.x) * 180) / Math.PI
  const nc = newCycle(cx, cy, r, 0, c.dir === 'cw' ? 'ccw' : 'cw')
  nc.stations = [{ angle: norm360(back - 105) }, { angle: norm360(back + 105) }]
  nc.color = c.color
  nc.width = c.width
  return nc
}
