// Bearbeitungsoperationen auf einem (Immer-)Entwurf des Dokuments.
import { linkedInfo } from './stoich'
import { tableGeom } from './stoichLayout'
import { bestBondAngle, buildGraph, type Graph } from './chem'
import { add, angleOf, dist, fromAngle, mid, mul, norm, perp, rotateAround, sub, type Pt } from './geom'
import type { Fragment } from './ocl'
import { pruneFills } from './rings'
import { pruneLinks } from './cycle'
import type { Anchor, Atom, Bond, BondType, Doc, Id, Selection } from './types'
import { emptySelection, uid } from './types'

export function newAtom(x: number, y: number, element = 'C'): Atom {
  return { id: uid('a'), x, y, element, charge: 0, radical: 0, lonePairs: 0 }
}

export function addAtom(d: Doc, x: number, y: number, element = 'C'): Atom {
  const a = newAtom(x, y, element)
  d.atoms[a.id] = a
  return a
}

export function findBond(d: Doc, a1: Id, a2: Id): Bond | null {
  for (const id in d.bonds) {
    const b = d.bonds[id]
    if ((b.a1 === a1 && b.a2 === a2) || (b.a1 === a2 && b.a2 === a1)) return b
  }
  return null
}

export function addBond(d: Doc, a1: Id, a2: Id, type: BondType = 'single'): Bond | null {
  if (a1 === a2) return null
  const ex = findBond(d, a1, a2)
  if (ex) return ex
  const b: Bond = { id: uid('b'), a1, a2, type, doublePos: 'auto' }
  d.bonds[b.id] = b
  return b
}

/** Atom in der Nähe eines Punktes (für das Zusammenführen) */
export function atomNear(d: Doc, p: Pt, tol: number, exclude?: Set<Id>): Atom | null {
  let best: Atom | null = null
  let bd = tol
  for (const id in d.atoms) {
    if (exclude?.has(id)) continue
    const a = d.atoms[id]
    const dd = dist(a, p)
    if (dd < bd) {
      bd = dd
      best = a
    }
  }
  return best
}

/**
 * Dreifachbindungen linear ausrichten (sp: 180°). Für jedes Ende A einer Dreifachbindung A≡B mit genau einem
 * weiteren Nachbarn C wird der kleinere der beiden Molekülteile (B-Seite bzw. C-Seite) um A gedreht, bis
 * C–A≡B gestreckt ist. Bindungslängen bleiben erhalten; Dreifachbindungen in Ringen (Cyclooctin …) bleiben unverändert.
 * atomIds: nur Dreifachbindungen an diesen Atomen prüfen.
 */
export function linearizeTriples(d: Doc, atomIds: Id[]) {
  const ids = new Set(atomIds)
  const triples = Object.values(d.bonds).filter((b) => b.type === 'triple' && (ids.has(b.a1) || ids.has(b.a2)))
  if (!triples.length) return
  for (const tb of triples) {
    for (const [A, B] of [
      [tb.a1, tb.a2],
      [tb.a2, tb.a1],
    ]) {
      const g = buildGraph(d)
      const others = (g.adj.get(A) ?? []).filter((nb) => nb.other.id !== B)
      if (others.length !== 1) continue
      const C = others[0].other.id
      // Teil hinter einer Bindung (ohne über diese Bindung zurückzugehen)
      const side = (from: Id, block: Id) => {
        const seen = new Set([from])
        const st = [from]
        while (st.length) {
          const u = st.pop()!
          for (const nb of g.adj.get(u) ?? []) {
            if ((u === from && nb.other.id === block) || seen.has(nb.other.id)) continue
            seen.add(nb.other.id)
            st.push(nb.other.id)
          }
        }
        return seen
      }
      const sideB = side(B, A)
      const sideC = side(C, A)
      if (sideB.has(A) || sideC.has(A) || sideB.has(C)) continue // Ring
      const a = d.atoms[A]
      const angB = angleOf(sub(d.atoms[B], a))
      const angC = angleOf(sub(d.atoms[C], a))
      let delta = angB + Math.PI - angC
      delta = Math.atan2(Math.sin(delta), Math.cos(delta))
      if (Math.abs(delta) < 1e-4) continue
      // kleineren Teil drehen: C-Seite um +delta oder B-Seite um −delta
      const [move, rot] = sideC.size <= sideB.size ? [sideC, delta] : [sideB, -delta]
      for (const id of move) {
        const q = rotateAround(d.atoms[id], a, rot)
        d.atoms[id].x = q.x
        d.atoms[id].y = q.y
      }
    }
  }
}

/** Neue Bindung an einem Atom in der besten freien Richtung */
export function sproutBond(d: Doc, atomId: Id, type: BondType, angle?: number): { atom: Atom; bond: Bond | null } {
  const g = buildGraph(d)
  const a = d.atoms[atomId]
  const ang = angle ?? bestBondAngle(g, a)
  const p = add(a, fromAngle(ang, d.style.bondLength))
  const ex = atomNear(d, p, d.style.bondLength * 0.25, new Set([atomId]))
  const target = ex ?? addAtom(d, p.x, p.y)
  const bond = addBond(d, atomId, target.id, type)
  if (bond && bond.type !== type && !ex) bond.type = type
  linearizeTriples(d, [atomId, target.id])
  return { atom: target, bond }
}

/** Ersetzt in gebogenen Pfeilen Verweise auf entfernte Objekte durch Punkte */
function detachAnchors(d: Doc, removedAtoms: Set<Id>, removedBonds: Set<Id>, snapshot: Doc) {
  const fix = (an: Anchor): Anchor => {
    if ((an.type === 'atom' || an.type === 'lp') && removedAtoms.has(an.id)) {
      const a = snapshot.atoms[an.id]
      return { type: 'point', x: a.x, y: a.y }
    }
    if (an.type === 'bond' && removedBonds.has(an.id)) {
      const b = snapshot.bonds[an.id]
      const m = mid(snapshot.atoms[b.a1], snapshot.atoms[b.a2])
      return { type: 'point', x: m.x, y: m.y }
    }
    return an
  }
  for (const id in d.curved) {
    const c = d.curved[id]
    c.from = fix(c.from)
    c.to = fix(c.to)
  }
}

export function deleteItems(d: Doc, sel: Selection, opts: { pruneOrphans?: boolean } = {}) {
  const snapshot: Doc = { ...d, atoms: { ...d.atoms }, bonds: { ...d.bonds } }
  for (const k in snapshot.atoms) snapshot.atoms[k] = { ...d.atoms[k] }
  for (const k in snapshot.bonds) snapshot.bonds[k] = { ...d.bonds[k] }
  const ra = new Set(sel.atoms)
  const rb = new Set(sel.bonds)
  for (const id in d.bonds) {
    const b = d.bonds[id]
    if (ra.has(b.a1) || ra.has(b.a2)) rb.add(id)
  }
  const touched = new Set<Id>()
  for (const id of rb) {
    const b = d.bonds[id]
    if (!b) continue
    touched.add(b.a1)
    touched.add(b.a2)
    delete d.bonds[id]
  }
  for (const id of ra) delete d.atoms[id]
  if (opts.pruneOrphans) {
    // Unbeschriftete C-Atome ohne Bindungen entfernen
    const g = buildGraph(d)
    for (const id of touched) {
      const a = d.atoms[id]
      if (!a) continue
      if ((g.adj.get(id)?.length ?? 0) === 0 && a.element === 'C' && !a.label && !a.charge && !a.lonePairs && !a.radical) {
        delete d.atoms[id]
        ra.add(id)
      }
    }
  }
  for (const id of sel.arrows) delete d.arrows[id]
  for (const id of sel.texts) delete d.texts[id]
  for (const id of sel.shapes) delete d.shapes[id]
  for (const id of sel.curved) delete d.curved[id]
  for (const id of sel.fills ?? []) delete d.fills[id]
  for (const id of sel.cycles ?? []) delete d.cycles[id]
  for (const id of sel.tables ?? []) delete d.tables[id]
  if (sel.cycles?.length) pruneLinks(d)
  detachAnchors(d, ra, rb, snapshot)
  pruneFills(d)
}

/** Atom `remove` in `keep` aufgehen lassen (Bindungen umhängen) */
export function mergeAtom(d: Doc, keep: Id, remove: Id) {
  if (keep === remove) return
  for (const id in d.bonds) {
    const b = d.bonds[id]
    if (b.a1 !== remove && b.a2 !== remove) continue
    const other = b.a1 === remove ? b.a2 : b.a1
    if (other === keep || findBond(d, keep, other)) {
      delete d.bonds[id]
      continue
    }
    if (b.a1 === remove) b.a1 = keep
    else b.a2 = keep
  }
  const r = d.atoms[remove]
  const k = d.atoms[keep]
  if (r && k && r.element !== 'C' && k.element === 'C' && !k.label) {
    k.element = r.element
    k.label = r.label
  }
  for (const id in d.curved) {
    const c = d.curved[id]
    for (const end of ['from', 'to'] as const) {
      const an = c[end]
      if ((an.type === 'atom' || an.type === 'lp') && an.id === remove) c[end] = { ...an, id: keep }
    }
  }
  for (const f of Object.values(d.fills ?? {})) f.rings = f.rings.map((r) => r.map((a) => (a === remove ? keep : a)))
  delete d.atoms[remove]
}

/** Nach dem Verschieben: bewegte Atome mit deckungsgleichen anderen Atomen verschmelzen */
export function mergeOverlaps(d: Doc, moved: Id[], tol: number): number {
  const movedSet = new Set(moved)
  let n = 0
  for (const id of moved) {
    const a = d.atoms[id]
    if (!a) continue
    const other = atomNear(d, a, tol, movedSet)
    if (other) {
      mergeAtom(d, other.id, id)
      n++
    }
  }
  return n
}

// ---------- Ringe ----------

export interface RingPlan {
  pts: Pt[]
  /** vorhandene Atome an Ringpositionen (oder null) */
  existing: (Id | null)[]
}

function ringPts(center: Pt, n: number, R: number, startAngle: number): Pt[] {
  return Array.from({ length: n }, (_, i) => add(center, fromAngle(startAngle + (i * 2 * Math.PI) / n, R)))
}

/**
 * Ringe mit fester Form (nicht regelmäßig): Sesselkonformationen von Cyclohexan in beiden Ausrichtungen, wie in
 * ChemDraw gezeichnet (Eckpunkte in Bindungslängen, um den Schwerpunkt). Spiegelbild = zweiter Sessel.
 */
const CHAIR: Pt[] = [[-1.149, -0.515], [-0.338, -0.16], [0.524, -0.515], [1.132, 0.519], [0.372, 0.174], [-0.54, 0.498]].map(([x, y]) => ({ x, y }))
export type RingKind = 'regular' | 'chair1' | 'chair2' | 'cp'
export function ringShape(kind: RingKind): Pt[] | null {
  if (kind === 'chair1') return CHAIR
  if (kind === 'chair2') return CHAIR.map((p) => ({ x: -p.x, y: p.y })).reverse()
  return null
}

/**
 * Ring mit fester Form platzieren: ins Leere am Klickpunkt; an eine Bindung mit einer Kante (Form wird gedreht,
 * auf die Bindungslänge skaliert und zur freien Seite gelegt); an ein Atom mit einer Ecke (Form zeigt vom Molekül weg).
 */
export function planShapedRing(d: Doc, g: Graph, shape: Pt[], target: { type: 'point'; p: Pt } | { type: 'atom'; id: Id } | { type: 'bond'; id: Id }, cursor?: Pt): RingPlan {
  const L = d.style.bondLength
  let pts: Pt[]
  if (target.type === 'point') {
    pts = shape.map((q) => add(target.p, mul(q, L)))
  } else if (target.type === 'bond') {
    const b = d.bonds[target.id]
    const a1 = d.atoms[b.a1]
    const a2 = d.atoms[b.a2]
    // Seite wie bei regelmäßigen Ringen: dorthin, wo weniger Nachbarn liegen (sonst Seite des Mauszeigers)
    const m = mid(a1, a2)
    const nrm = perp(norm(sub(a2, a1)))
    let score = 0
    for (const id of [a1.id, a2.id])
      for (const nb of g.adj.get(id) ?? []) {
        if (nb.other.id === a1.id || nb.other.id === a2.id) continue
        score += Math.sign((nb.other.x - m.x) * nrm.x + (nb.other.y - m.y) * nrm.y)
      }
    let side = score > 0 ? -1 : 1
    if (score === 0 && cursor) side = Math.sign((cursor.x - m.x) * nrm.x + (cursor.y - m.y) * nrm.y) || 1
    // Ansatzkante: die Kante, von der aus die Form am weitesten zu einer Seite reicht (beim Sessel eine der steilen
    // Seitenkanten) – sonst läuft die Form entlang der Bindung weiter und trifft Nachbaratome
    let k = 0
    let far = -1
    for (let i = 0; i < shape.length; i++) {
      const p0 = shape[i]
      const e = sub(shape[(i + 1) % shape.length], p0)
      const dLine = Math.abs(e.x * -p0.y - e.y * -p0.x) / Math.hypot(e.x, e.y)
      if (dLine > far) {
        far = dLine
        k = i
      }
    }
    const rolled = [...shape.slice(k), ...shape.slice(0, k)]
    // Kante 0→1 der (umsortierten) Form auf die Bindung legen; von beiden Spiegelungen die mit Schwerpunkt auf der gewählten Seite
    let bestPts: Pt[] = []
    for (const flip of [1, -1]) {
      const sh = rolled.map((q) => ({ x: q.x, y: q.y * flip }))
      const e = sub(sh[1], sh[0])
      const t = sub(a2, a1)
      const s = Math.hypot(t.x, t.y) / Math.hypot(e.x, e.y)
      const rot = Math.atan2(t.y, t.x) - Math.atan2(e.y, e.x)
      const c = Math.cos(rot)
      const si = Math.sin(rot)
      const tp = sh.map((q) => {
        const v = sub(q, sh[0])
        return add(a1, { x: (v.x * c - v.y * si) * s, y: (v.x * si + v.y * c) * s })
      })
      const cen = tp.reduce((acc, q) => add(acc, mul(q, 1 / tp.length)), { x: 0, y: 0 })
      if (Math.sign((cen.x - m.x) * nrm.x + (cen.y - m.y) * nrm.y) === side || !bestPts.length) bestPts = tp
    }
    pts = bestPts
    pts[0] = { x: a1.x, y: a1.y }
    pts[1] = { x: a2.x, y: a2.y }
  } else {
    const a = d.atoms[target.id]
    const nbs = g.adj.get(a.id) ?? []
    let ang = nbs.length === 0 ? (cursor && dist(cursor, a) > 4 ? angleOf(sub(cursor, a)) : -Math.PI / 2) : bestBondAngle(g, a)
    if (nbs.length === 1) ang = angleOf(sub(a, nbs[0].other))
    // Ecke 0 der Form auf das Atom, Schwerpunkt der Form in Richtung ang
    const c0 = shape[0]
    const rot = ang - Math.atan2(-c0.y, -c0.x)
    const c = Math.cos(rot)
    const si = Math.sin(rot)
    pts = shape.map((q) => {
      const v = sub(q, c0)
      return add(a, { x: (v.x * c - v.y * si) * L, y: (v.x * si + v.y * c) * L })
    })
    pts[0] = { x: a.x, y: a.y }
  }
  const existing = pts.map((p) => atomNear(d, p, L * 0.3)?.id ?? null)
  return { pts, existing }
}

export function planRing(d: Doc, g: Graph, n: number, target: { type: 'point'; p: Pt } | { type: 'atom'; id: Id } | { type: 'bond'; id: Id }, cursor?: Pt): RingPlan {
  const L = d.style.bondLength
  const R = L / (2 * Math.sin(Math.PI / n))
  const apothem = L / (2 * Math.tan(Math.PI / n))
  let pts: Pt[]
  if (target.type === 'point') {
    // Spitze oben (wie üblich für Sechsringe), bei ungeraden Ringen flache Unterseite
    const start = -Math.PI / 2
    pts = ringPts(target.p, n, R, start)
  } else if (target.type === 'atom') {
    const a = d.atoms[target.id]
    const nbs = g.adj.get(a.id) ?? []
    let ang: number
    if (nbs.length === 0 && cursor && dist(cursor, a) > 4) ang = angleOf(sub(cursor, a))
    else ang = nbs.length === 0 ? -Math.PI / 2 : bestBondAngle(g, a)
    if (nbs.length === 1) ang = angleOf(sub(a, nbs[0].other))
    // Spiro bei ≥2 Nachbarn, sonst ankondensiert über Bindung zum Ring-Zentrum in Gegenrichtung
    const center = add(a, fromAngle(ang, R))
    pts = ringPts(center, n, R, ang + Math.PI)
  } else {
    const b = d.bonds[target.id]
    const a1 = d.atoms[b.a1]
    const a2 = d.atoms[b.a2]
    const m = mid(a1, a2)
    const nrm = perp(norm(sub(a2, a1)))
    // Seite mit weniger Nachbarn wählen (bzw. Seite des Cursors)
    let score = 0
    for (const id of [a1.id, a2.id]) {
      for (const nb of g.adj.get(id) ?? []) {
        if (nb.other.id === a1.id || nb.other.id === a2.id) continue
        score += Math.sign((nb.other.x - m.x) * nrm.x + (nb.other.y - m.y) * nrm.y)
      }
    }
    let side = score > 0 ? -1 : score < 0 ? 1 : 1
    if (score === 0 && cursor) side = Math.sign((cursor.x - m.x) * nrm.x + (cursor.y - m.y) * nrm.y) || 1
    const center = add(m, mul(nrm, side * apothem))
    const start = angleOf(sub(a1, center))
    // Richtung so wählen, dass Punkt 1 = a2
    const step = (2 * Math.PI) / n
    const p1a = add(center, fromAngle(start + step, R))
    const dirSign = dist(p1a, a2) < dist(add(center, fromAngle(start - step, R)), a2) ? 1 : -1
    pts = Array.from({ length: n }, (_, i) => add(center, fromAngle(start + dirSign * i * step, R)))
    pts[0] = { x: a1.x, y: a1.y }
    pts[1] = { x: a2.x, y: a2.y }
  }
  const existing = pts.map((p) => atomNear(d, p, L * 0.3)?.id ?? null)
  return { pts, existing }
}

/** aromatic: Benzol (Kekulé-Muster); pattern: feste Doppelbindungen je Kante i→i+1 (z. B. Cyclopentadien) */
export function placeRing(d: Doc, plan: RingPlan, aromatic: boolean, fixed?: boolean[]): Id[] {
  const ids = plan.pts.map((p, i) => plan.existing[i] ?? addAtom(d, p.x, p.y).id)
  const n = ids.length
  const g = buildGraph(d)
  const hasDouble = (id: Id) => (g.adj.get(id) ?? []).some((nb) => nb.bond.type === 'double')
  const markDouble = (a: Id, b: Id, bond: Bond) => {
    g.adj.get(a)?.push({ bond: { ...bond, type: 'double' }, other: d.atoms[b] })
    g.adj.get(b)?.push({ bond: { ...bond, type: 'double' }, other: d.atoms[a] })
  }
  let pattern: boolean[] = Array(n).fill(false)
  if (aromatic) {
    // Kekulé-Muster wählen, das keine Kumulene erzeugt
    const tryPattern = (offset: number) => Array.from({ length: n }, (_, i) => (i + offset) % 2 === 0)
    let best = tryPattern(0)
    let bestBad = Infinity
    for (const off of [0, 1]) {
      const p = tryPattern(off)
      let bad = 0
      for (let i = 0; i < n; i++) {
        if (!p[i]) continue
        const a = ids[i]
        const b = ids[(i + 1) % n]
        const ex = findBond(d, a, b)
        if (ex && ex.type === 'double') continue
        if (hasDouble(a) || hasDouble(b)) bad++
      }
      if (bad < bestBad) {
        bestBad = bad
        best = p
      }
    }
    pattern = best
  }
  if (fixed) pattern = fixed
  for (let i = 0; i < n; i++) {
    const a = ids[i]
    const b = ids[(i + 1) % n]
    const ex = findBond(d, a, b)
    const wantDouble = pattern[i] && !hasDouble(a) && !hasDouble(b)
    if (ex) {
      // vorhandene Einfachbindung im Benzolring zur Doppelbindung machen
      if (wantDouble && ex.type === 'single') {
        ex.type = 'double'
        markDouble(a, b, ex)
      }
      continue
    }
    const nb = addBond(d, a, b, wantDouble ? 'double' : 'single')
    if (nb && wantDouble) markDouble(a, b, nb)
  }
  return ids
}

// ---------- Ketten ----------

export function chainPoints(start: Pt, end: Pt, L: number, firstUp?: boolean): Pt[] {
  const v = sub(end, start)
  const ang = Math.round(angleOf(v) / (Math.PI / 6)) * (Math.PI / 6)
  const dir = fromAngle(ang)
  const nrm = perp(dir)
  const stepX = L * Math.cos(Math.PI / 6)
  const stepY = L * Math.sin(Math.PI / 6)
  const proj = v.x * dir.x + v.y * dir.y
  const count = Math.max(1, Math.round(proj / stepX))
  // Zickzack-Seite: zum Cursor hin
  const crossV = v.x * nrm.x + v.y * nrm.y
  const sgn = firstUp !== undefined ? (firstUp ? 1 : -1) : crossV >= 0 ? 1 : -1
  const pts: Pt[] = [start]
  for (let i = 1; i <= count; i++) {
    const base = add(start, mul(dir, stepX * i))
    pts.push(i % 2 === 1 ? add(base, mul(nrm, sgn * stepY)) : base)
  }
  return pts
}

// ---------- Fragmente einfügen ----------

export function insertFragment(d: Doc, f: Fragment, mergeTol = 0): Selection {
  const sel = emptySelection()
  const idMap = new Map<Id, Id>()
  for (const a of f.atoms) {
    const ex = mergeTol > 0 ? atomNear(d, a, mergeTol) : null
    if (ex) {
      idMap.set(a.id, ex.id)
      continue
    }
    const na = { ...a, id: uid('a') }
    d.atoms[na.id] = na
    idMap.set(a.id, na.id)
    sel.atoms.push(na.id)
  }
  for (const b of f.bonds) {
    const a1 = idMap.get(b.a1)!
    const a2 = idMap.get(b.a2)!
    if (findBond(d, a1, a2)) continue
    const nb = { ...b, id: uid('b'), a1, a2 }
    d.bonds[nb.id] = nb
    sel.bonds.push(nb.id)
  }
  for (const ring of f.circles ?? []) {
    const id = uid('f')
    d.fills[id] = { id, rings: [ring.map((a) => idMap.get(a)!)], mode: 'circle', grad: 'none', c1: '#111418', c2: '#111418', angle: 0, opacity: 1 }
    sel.fills.push(id)
  }
  return sel
}

// ---------- Transformationen ----------

export function selectionAtomIds(d: Doc, sel: Selection): Set<Id> {
  const s = new Set(sel.atoms)
  for (const id of sel.bonds) {
    const b = d.bonds[id]
    if (!b) continue
    s.add(b.a1)
    s.add(b.a2)
  }
  return s
}

export function translateSelection(d: Doc, sel: Selection, dx: number, dy: number) {
  for (const id of selectionAtomIds(d, sel)) {
    const a = d.atoms[id]
    if (!a) continue
    a.x += dx
    a.y += dy
  }
  for (const id of sel.arrows) {
    const a = d.arrows[id]
    a.x1 += dx
    a.x2 += dx
    a.y1 += dy
    a.y2 += dy
  }
  for (const id of sel.texts) {
    d.texts[id].x += dx
    d.texts[id].y += dy
  }
  for (const id of sel.shapes) {
    const s = d.shapes[id]
    s.x1 += dx
    s.x2 += dx
    s.y1 += dy
    s.y2 += dy
  }
  for (const id of sel.cycles ?? []) {
    const c = d.cycles[id]
    c.cx += dx
    c.cy += dy
  }
  for (const id of sel.tables ?? []) {
    const t = d.tables[id]
    if (!t) continue
    t.x += dx
    t.y += dy
  }
  for (const id of sel.curved) {
    const c = d.curved[id]
    for (const end of ['from', 'to'] as const) {
      const an = c[end]
      if (an.type === 'point') c[end] = { type: 'point', x: an.x + dx, y: an.y + dy }
    }
  }
}

export function transformSelection(d: Doc, sel: Selection, f: (p: Pt) => Pt, flips = false) {
  for (const id of selectionAtomIds(d, sel)) {
    const a = d.atoms[id]
    const p = f(a)
    a.x = p.x
    a.y = p.y
  }
  for (const id of sel.arrows) {
    const a = d.arrows[id]
    const p1 = f({ x: a.x1, y: a.y1 })
    const p2 = f({ x: a.x2, y: a.y2 })
    a.x1 = p1.x
    a.y1 = p1.y
    a.x2 = p2.x
    a.y2 = p2.y
  }
  for (const id of sel.texts) {
    const t = d.texts[id]
    const p = f(t)
    t.x = p.x
    t.y = p.y
  }
  for (const id of sel.shapes) {
    const s = d.shapes[id]
    const p1 = f({ x: s.x1, y: s.y1 })
    const p2 = f({ x: s.x2, y: s.y2 })
    s.x1 = p1.x
    s.y1 = p1.y
    s.x2 = p2.x
    s.y2 = p2.y
  }
  // Ansatztabellen drehen/spiegeln nicht mit, sondern wandern mit ihrer Mitte
  for (const id of sel.tables ?? []) {
    const t = d.tables[id]
    if (!t) continue
    const b = tableGeom(d, t).box
    const c = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 }
    const q = f(c)
    t.x += q.x - c.x
    t.y += q.y - c.y
  }
  // Katalysezyklen: Mittelpunkt transformieren und alle Winkel (Stationen, Zu-/Abflüsse, Schrittbezeichnungen,
  // Verbindungspfeile) mitdrehen; bei Spiegelung kehrt sich die Laufrichtung um
  const angleMaps = new Map<Id, (a: number) => number>()
  for (const id of sel.cycles ?? []) {
    const c = d.cycles[id]
    const o = { x: c.cx, y: c.cy }
    const p = f(o)
    const ex = sub(f({ x: o.x + 100, y: o.y }), p)
    const ey = sub(f({ x: o.x, y: o.y + 100 }), p)
    const mirror = ex.x * ey.y - ex.y * ey.x < 0
    const rot = Math.atan2(ex.y, ex.x)
    // Ellipse um ±90° gedreht: Breite und Höhe tauschen
    const quarter = Math.abs(Math.abs(Math.sin(rot)) - 1) < 0.02
    const rx0 = c.rx
    const ry0 = c.ry
    const rx1 = quarter ? ry0 : rx0
    const ry1 = quarter ? rx0 : ry0
    const map = (a: number) => {
      const t = (a * Math.PI) / 180
      const q = sub(f({ x: o.x + rx0 * Math.cos(t), y: o.y + ry0 * Math.sin(t) }), p)
      const deg = (Math.atan2(q.y / ry1, q.x / rx1) * 180) / Math.PI
      return Math.round(((deg % 360) + 360) % 360 * 100) / 100
    }
    angleMaps.set(id, map)
    c.cx = p.x
    c.cy = p.y
    c.rx = rx1
    c.ry = ry1
    for (const st of c.stations) {
      st.angle = map(st.angle)
      if (mirror && (st.gapLo !== undefined || st.gapHi !== undefined)) [st.gapLo, st.gapHi] = [st.gapHi, st.gapLo]
    }
    for (const b of c.branches) b.angle = map(b.angle)
    for (const al of c.arcLabels ?? []) al.angle = map(al.angle)
    for (const l of c.links ?? []) l.angle = map(l.angle)
    if (mirror) c.dir = c.dir === 'cw' ? 'ccw' : 'cw'
  }
  // Endwinkel von Verbindungspfeilen, die auf einen transformierten Zyklus zeigen
  if (angleMaps.size)
    for (const cid in d.cycles) for (const l of d.cycles[cid].links ?? []) if (angleMaps.has(l.target)) l.tAngle = angleMaps.get(l.target)!(l.tAngle)
  for (const id of sel.curved) {
    const c = d.curved[id]
    if (flips) c.bend = -c.bend
    for (const end of ['from', 'to'] as const) {
      const an = c[end]
      if (an.type === 'point') c[end] = { type: 'point', ...f(an) }
    }
  }
  if (flips) {
    // Keile/Schraffuren behalten ihre Geometrie; Doppelbindungsseite spiegeln
    for (const id in d.bonds) {
      const b = d.bonds[id]
      if (!sel.bonds.includes(id) && !(sel.atoms.includes(b.a1) && sel.atoms.includes(b.a2))) continue
      if (b.doublePos === 'left') b.doublePos = 'right'
      else if (b.doublePos === 'right') b.doublePos = 'left'
    }
  }
}

export function rotateSelection(d: Doc, sel: Selection, center: Pt, angle: number) {
  transformSelection(d, sel, (p) => rotateAround(p, center, angle))
}

export function flipSelection(d: Doc, sel: Selection, center: Pt, axis: 'h' | 'v') {
  transformSelection(
    d,
    sel,
    (p) => (axis === 'h' ? { x: 2 * center.x - p.x, y: p.y } : { x: p.x, y: 2 * center.y - p.y }),
    true,
  )
}

// ---------- Kopieren ----------

export interface ClipData {
  atoms: Atom[]
  bonds: Bond[]
  arrows: Doc['arrows'][string][]
  curved: Doc['curved'][string][]
  texts: Doc['texts'][string][]
  shapes: Doc['shapes'][string][]
  fills?: Doc['fills'][string][]
  cycles?: Doc['cycles'][string][]
  tables?: Doc['tables'][string][]
}

export function extractClip(d: Doc, sel: Selection): ClipData {
  const atomIds = selectionAtomIds(d, sel)
  const bonds = Object.values(d.bonds).filter((b) => atomIds.has(b.a1) && atomIds.has(b.a2))
  const curved = sel.curved
    .map((id) => d.curved[id])
    .filter(Boolean)
    .map((c) => {
      const keep = (an: Anchor) =>
        an.type === 'point' ||
        ((an.type === 'atom' || an.type === 'lp') && atomIds.has(an.id)) ||
        (an.type === 'bond' && bonds.some((b) => b.id === an.id))
      return keep(c.from) && keep(c.to) ? c : null
    })
    .filter((c): c is NonNullable<typeof c> => !!c)
  return {
    atoms: [...atomIds].map((id) => d.atoms[id]).filter(Boolean),
    bonds,
    arrows: sel.arrows.map((id) => d.arrows[id]).filter(Boolean),
    curved,
    texts: sel.texts.map((id) => d.texts[id]).filter(Boolean),
    shapes: sel.shapes.map((id) => d.shapes[id]).filter(Boolean),
    fills: Object.values(d.fills ?? {}).filter((f) => f.rings.every((r) => r.every((a) => atomIds.has(a)))),
    cycles: (sel.cycles ?? []).map((id) => d.cycles[id]).filter(Boolean),
    // Ansatztabellen mit Momentaufnahme von Formel/Molmasse (falls die Struktur nicht mitkopiert wird)
    tables: (sel.tables ?? [])
      .map((id) => d.tables?.[id])
      .filter(Boolean)
      .map((t) => ({
        ...JSON.parse(JSON.stringify(t)),
        rows: t.rows.map((r) => {
          const info = r.atom ? linkedInfo(d, r.atom) : null
          return info ? { ...r, formula: r.formula ?? info.formula, mw: r.mw ?? info.mw } : { ...r }
        }),
      })),
  }
}

export function pasteClip(d: Doc, c: ClipData, dx: number, dy: number): Selection {
  const sel = emptySelection()
  const am = new Map<Id, Id>()
  const bm = new Map<Id, Id>()
  for (const a of c.atoms) {
    const id = uid('a')
    am.set(a.id, id)
    d.atoms[id] = { ...a, id, x: a.x + dx, y: a.y + dy }
    sel.atoms.push(id)
  }
  for (const b of c.bonds) {
    const id = uid('b')
    bm.set(b.id, id)
    d.bonds[id] = { ...b, id, a1: am.get(b.a1)!, a2: am.get(b.a2)! }
    sel.bonds.push(id)
  }
  for (const a of c.arrows) {
    const id = uid('r')
    d.arrows[id] = { ...a, id, x1: a.x1 + dx, x2: a.x2 + dx, y1: a.y1 + dy, y2: a.y2 + dy }
    sel.arrows.push(id)
  }
  for (const t of c.texts) {
    const id = uid('t')
    d.texts[id] = { ...t, id, x: t.x + dx, y: t.y + dy }
    sel.texts.push(id)
  }
  for (const s of c.shapes) {
    const id = uid('s')
    d.shapes[id] = { ...s, id, x1: s.x1 + dx, x2: s.x2 + dx, y1: s.y1 + dy, y2: s.y2 + dy }
    sel.shapes.push(id)
  }
  const mapAnchor = (an: Anchor): Anchor => {
    if (an.type === 'point') return { type: 'point', x: an.x + dx, y: an.y + dy }
    if (an.type === 'bond') return { type: 'bond', id: bm.get(an.id)! }
    return { ...an, id: am.get(an.id)! }
  }
  for (const cv of c.curved) {
    const id = uid('c')
    d.curved[id] = { ...cv, id, from: mapAnchor(cv.from), to: mapAnchor(cv.to) }
    sel.curved.push(id)
  }
  const ym = new Map<Id, Id>()
  for (const cy of c.cycles ?? []) {
    const id = uid('y')
    ym.set(cy.id, id)
    d.cycles[id] = { ...JSON.parse(JSON.stringify(cy)), id, cx: cy.cx + dx, cy: cy.cy + dy }
    sel.cycles.push(id)
  }
  // Verbindungspfeile nur behalten, wenn der Zielzyklus mitkopiert wurde
  for (const id of ym.values()) {
    const cy = d.cycles[id]
    if (!cy.links) continue
    cy.links = cy.links.filter((l) => ym.has(l.target)).map((l) => ({ ...l, id: uid('k'), target: ym.get(l.target)! }))
  }
  for (const f of c.fills ?? []) {
    const id = uid('f')
    d.fills[id] = { ...f, id, rings: f.rings.map((r) => r.map((a) => am.get(a)!)) }
    sel.fills.push(id)
  }
  for (const t of c.tables ?? []) {
    const id = uid('st')
    d.tables[id] = {
      ...JSON.parse(JSON.stringify(t)),
      id,
      x: t.x + dx,
      y: t.y + dy,
      rows: t.rows.map((r) => {
        const atom = r.atom ? (am.get(r.atom) ?? (d.atoms[r.atom] ? r.atom : undefined)) : undefined
        return { ...r, id: uid('sr'), atom }
      }),
    }
    sel.tables.push(id)
  }
  return sel
}

/** Vor dem ersten 3D-Schritt die 2D-Lage merken (nur für Atome, die noch flach sind) */
export function remember2D(d: Doc, ids: Iterable<Id>) {
  for (const id of ids) {
    const a = d.atoms[id]
    if (a && a.z === undefined && !a.flat2d) a.flat2d = { x: a.x, y: a.y }
  }
}

/**
 * Zurück zur ursprünglichen 2D-Zeichnung: gemerkte Lagen wiederherstellen (am aktuellen Ort des Moleküls).
 * Atome ohne gemerkte Lage (in 3D ergänzt) wandern mit ihrem nächsten wiederhergestellten Nachbarn mit.
 * Ohne gemerkte Lagen: nur die Tiefe entfernen. Gibt die Zahl wiederhergestellter Atome zurück.
 */
export function restore2D(d: Doc, ids: Id[]): number {
  const set = new Set(ids.filter((id) => d.atoms[id]))
  const known = [...set].filter((id) => d.atoms[id].flat2d)
  if (known.length) {
    let cx = 0
    let cy = 0
    let fx = 0
    let fy = 0
    for (const id of known) {
      const a = d.atoms[id]
      cx += a.x / known.length
      cy += a.y / known.length
      fx += a.flat2d!.x / known.length
      fy += a.flat2d!.y / known.length
    }
    const shift = new Map<Id, { dx: number; dy: number }>()
    for (const id of known) {
      const a = d.atoms[id]
      const nx = a.flat2d!.x - fx + cx
      const ny = a.flat2d!.y - fy + cy
      shift.set(id, { dx: nx - a.x, dy: ny - a.y })
    }
    // übrige Atome: Verschiebung des nächsten bekannten Nachbarn übernehmen (Breitensuche über Bindungen)
    const adj = new Map<Id, Id[]>()
    for (const b of Object.values(d.bonds)) {
      if (!set.has(b.a1) || !set.has(b.a2)) continue
      adj.set(b.a1, [...(adj.get(b.a1) ?? []), b.a2])
      adj.set(b.a2, [...(adj.get(b.a2) ?? []), b.a1])
    }
    const queue = [...known]
    while (queue.length) {
      const u = queue.shift()!
      for (const v of adj.get(u) ?? []) {
        if (shift.has(v)) continue
        shift.set(v, shift.get(u)!)
        queue.push(v)
      }
    }
    for (const [id, s2] of shift) {
      const a = d.atoms[id]
      a.x += s2.dx
      a.y += s2.dy
    }
  }
  for (const id of set) {
    delete d.atoms[id].z
    delete d.atoms[id].flat2d
  }
  return known.length
}
