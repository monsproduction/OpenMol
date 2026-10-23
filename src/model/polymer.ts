// Polymere: Klammern mit Index (z. B. „n“) markieren die Wiederholungseinheit.
// Bindungen, die eine Klammerseite kreuzen, verbinden die Einheit mit Endgruppen bzw. enden offen.
import { buildGraph } from './chem'
import type { Pt } from './geom'
import { analyze, parseFormula, type Analysis } from './ocl'
import type { Doc, Id, Shape } from './types'

export interface PolymerUnit {
  shape: Shape
  /** Atome der Wiederholungseinheit */
  unit: Id[]
  /** Bindungen, die eine Klammerseite kreuzen */
  crossing: Id[]
  /** Atome außerhalb, die über kreuzende Bindungen angebunden sind */
  outside: Id[]
  /** offene Enden: einzelne unbeschriftete C-Enden außerhalb (zählen nicht zur Formel) */
  openEnds: Id[]
  /** Endgruppen-Atome (außerhalb, keine offenen Enden) */
  endGroups: Id[]
}

const BRACKETS = new Set(['brackets', 'parens', 'braces'])

/** Klammern mit Index unten gelten als Polymer-Klammern */
export function isPolymerBracket(s: Shape): boolean {
  return BRACKETS.has(s.kind) && (!!s.sub?.trim() || !!s.cyclic)
}

/**
 * Ring einer zyklischen Wiederholungseinheit: Bogen von der linken zur rechten Stummel-Bindung (über oben,
 * außen um die Klammern herum). null, wenn links oder rechts keine Bindung aus der Klammer herausführt.
 */
export function cyclicLoop(doc: Doc, s: Shape): { p1: Pt; p2: Pt; rx: number; ry: number; cx: number; cy: number } | null {
  if (!s.cyclic) return null
  const x1 = Math.min(s.x1, s.x2)
  const x2 = Math.max(s.x1, s.x2)
  const y1 = Math.min(s.y1, s.y2)
  const y2 = Math.max(s.y1, s.y2)
  let left: Pt | null = null
  let right: Pt | null = null
  for (const b of Object.values(doc.bonds)) {
    const a = doc.atoms[b.a1]
    const c = doc.atoms[b.a2]
    if (!a || !c) continue
    for (const [inA, outA] of [
      [a, c],
      [c, a],
    ]) {
      if (outA.x < x1 && inA.x > x1 && segCrossesVertical(inA, outA, x1, y1, y2)) left = { x: outA.x, y: outA.y }
      if (outA.x > x2 && inA.x < x2 && segCrossesVertical(inA, outA, x2, y1, y2)) right = { x: outA.x, y: outA.y }
    }
  }
  if (!left || !right) return null
  const L = doc.style.bondLength
  const dx = (right.x - left.x) / 2
  const rx = dx * 1.3 + L * 0.4
  const ry = Math.max((y2 - y1) * 0.6, L * 1.4)
  const ym = (left.y + right.y) / 2
  const cy = ym - ry * Math.sqrt(Math.max(0, 1 - (dx / rx) ** 2))
  return { p1: left, p2: right, rx, ry, cx: (left.x + right.x) / 2, cy }
}

function segCrossesVertical(a: Pt, b: Pt, x: number, y1: number, y2: number): boolean {
  if ((a.x - x) * (b.x - x) > 0 || Math.abs(a.x - b.x) < 1e-9) return false
  const t = (x - a.x) / (b.x - a.x)
  const y = a.y + (b.y - a.y) * t
  return y >= y1 - 1 && y <= y2 + 1
}

export function polymerUnits(doc: Doc): PolymerUnit[] {
  const out: PolymerUnit[] = []
  const shapes = Object.values(doc.shapes).filter(isPolymerBracket)
  if (!shapes.length) return out
  const g = buildGraph(doc)
  for (const s of shapes) {
    const x1 = Math.min(s.x1, s.x2)
    const x2 = Math.max(s.x1, s.x2)
    const y1 = Math.min(s.y1, s.y2)
    const y2 = Math.max(s.y1, s.y2)
    const crossing = new Set<Id>()
    for (const b of Object.values(doc.bonds)) {
      const a = doc.atoms[b.a1]
      const c = doc.atoms[b.a2]
      // Bindungen durch die Klammer sind bei Polymeren Einfachbindungen (Mehrfachbindungen, die zufällig
      // die Klammerlinie schneiden, gehören zur Einheit)
      if (!a || !c || (b.type !== 'single' && b.type !== 'bold' && b.type !== 'wavy')) continue
      if (segCrossesVertical(a, c, x1, y1, y2) || segCrossesVertical(a, c, x2, y1, y2)) crossing.add(b.id)
    }
    // Startatome: innerhalb des Klammerrahmens; Einheit = alles, was ohne kreuzende Bindung erreichbar ist
    const seeds = Object.values(doc.atoms).filter((a) => a.x > x1 && a.x < x2 && a.y >= y1 - 2 && a.y <= y2 + 2)
    const unit = new Set<Id>()
    const stack = seeds.map((a) => a.id)
    for (const id of stack) unit.add(id)
    while (stack.length) {
      const id = stack.pop()!
      for (const nb of g.adj.get(id) ?? []) {
        if (crossing.has(nb.bond.id) || unit.has(nb.other.id)) continue
        unit.add(nb.other.id)
        stack.push(nb.other.id)
      }
    }
    if (!unit.size) continue
    // Die Einheit muss innerhalb der Klammern liegen. Läuft sie über einen Ring um die Klammern herum (z. B. eine
    // geklammerte Teilstrecke eines Makrozyklus, „n − 3“), ist es keine Polymerklammer → normale Analyse
    const tolX = doc.style.bondLength * 0.6
    if ([...unit].some((id) => doc.atoms[id].x < x1 - tolX || doc.atoms[id].x > x2 + tolX)) continue
    const outside = new Set<Id>()
    for (const bid of crossing) {
      const b = doc.bonds[bid]
      if (unit.has(b.a1) && !unit.has(b.a2)) outside.add(b.a2)
      else if (unit.has(b.a2) && !unit.has(b.a1)) outside.add(b.a1)
    }
    const openEnds: Id[] = []
    for (const id of outside) {
      const a = doc.atoms[id]
      const deg = g.adj.get(id)?.length ?? 0
      if (deg === 1 && a.element === 'C' && !a.label && !a.charge && !a.isotope) openEnds.push(id)
    }
    // Endgruppen: von den übrigen äußeren Atomen aus erreichbar, ohne in die Einheit zurückzukehren
    const endGroups = new Set<Id>()
    const st2 = [...outside].filter((id) => !openEnds.includes(id))
    for (const id of st2) endGroups.add(id)
    while (st2.length) {
      const id = st2.pop()!
      for (const nb of g.adj.get(id) ?? []) {
        if (unit.has(nb.other.id) || endGroups.has(nb.other.id)) continue
        endGroups.add(nb.other.id)
        st2.push(nb.other.id)
      }
    }
    out.push({ shape: s, unit: [...unit], crossing: [...crossing], outside: [...outside], openEnds, endGroups: [...endGroups] })
  }
  return out
}

export interface PolymerAnalysis {
  unit: Analysis
  ends: Analysis | null
  /** Kettenlänge: aus dem Index (Zahl), manuell oder aus Mn berechnet */
  n: number | null
  nSource: 'index' | 'manual' | 'mn' | null
  /** Gesamtmasse (g/mol), falls n bekannt */
  total: number | null
  totalFormula: string | null
}

const fmtCounts = (m: Map<string, number>) => {
  // Hill-Reihenfolge: C, H, dann alphabetisch
  const keys = [...m.keys()].sort((a, b) => (a === 'C' ? -1 : b === 'C' ? 1 : a === 'H' ? -1 : b === 'H' ? 1 : a.localeCompare(b)))
  return keys.map((k) => k + (m.get(k)! > 1 ? m.get(k) : '')).join('')
}

export function analyzePolymer(doc: Doc, p: PolymerUnit): PolymerAnalysis | null {
  // Einheit: Nachbarn außerhalb als offene Valenzen
  const unit = analyze(doc, [...p.unit, ...p.outside], { star: new Set(p.outside) })
  if (!unit) return null
  let ends: Analysis | null = null
  if (p.endGroups.length && !p.shape.cyclic) {
    const inner = new Set<Id>()
    for (const bid of p.crossing) {
      const b = doc.bonds[bid]
      if (p.endGroups.includes(b.a1)) inner.add(b.a2)
      if (p.endGroups.includes(b.a2)) inner.add(b.a1)
    }
    ends = analyze(doc, [...p.endGroups, ...inner], { star: inner })
  }
  const idx = (p.shape.sub ?? '').trim()
  let n: number | null = null
  let nSource: PolymerAnalysis['nSource'] = null
  // zyklisch: keine Endgruppen – n Einheiten zum Ring geschlossen
  if (p.shape.cyclic) ends = null
  const endMw = ends?.mw ?? 0
  if (/^[1-9]\d*$/.test(idx)) {
    n = parseInt(idx, 10)
    nSource = 'index'
  } else if (p.shape.polyN) {
    n = p.shape.polyN
    nSource = 'manual'
  } else if (p.shape.polyMn && unit.mw > 0) {
    n = Math.max(0, (p.shape.polyMn - endMw) / unit.mw)
    nSource = 'mn'
  }
  let total: number | null = null
  let totalFormula: string | null = null
  if (n !== null) {
    total = nSource === 'mn' ? p.shape.polyMn! : endMw + n * unit.mw
    if (Number.isInteger(n)) {
      const m = new Map<string, number>()
      for (const [el, c] of parseFormula(unit.formula)) m.set(el, (m.get(el) ?? 0) + c * n)
      if (ends) for (const [el, c] of parseFormula(ends.formula)) m.set(el, (m.get(el) ?? 0) + c)
      totalFormula = fmtCounts(m)
    }
  }
  return { unit, ends, n, nSource, total, totalFormula }
}
