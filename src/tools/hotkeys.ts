// ChemDraw-Hotkeys (nach dem „ChemDraw Hotkey Cheat Sheet“): Tasten über einem Atom bzw. einer Bindung – oder am
// Hotspot, dem zuletzt per Taste gezeichneten Atom/der Bindung (grüner Punkt). So lassen sich ganze Moleküle mit der
// Tastatur zeichnen, z. B. „1B79←←←←o↓↓↓↓o→→9“ (Pinakolboronat an Benzol). Pfeiltasten wandern zwischen Atomen und
// Bindungen weiter, Enter macht aus der Auswahl einen Hotspot, Leertaste/Tab aus dem Hotspot das ganze Molekül.
import { bestBondAngle, buildGraph, fragments } from '../model/chem'
import { add, angleOf, dot, fromAngle, mid, norm, sub, type Pt } from '../model/geom'
import { addAtom, addBond, findBond, linearizeTriples, pasteClip, extractClip, placeRing, planRing, planShapedRing, ringShape } from '../model/ops'
import { getScene, sceneBBox } from '../model/scene'
import type { BondType, Doc, Id, Selection } from '../model/types'
import { emptySelection, uid } from '../model/types'
import { commit, getState, setState, type Hotspot } from '../store'
import { completeSel } from './actions'

// ---------- Beschriftungen (Atom unter der Maus wird zu …) ----------

/** Element (mit impliziten H, z. B. o → OH) */
const ATOM_ELEMENT: Record<string, string> = {
  o: 'O',
  q: 'O',
  n: 'N',
  w: 'N',
  s: 'S',
  S: 'Si',
  p: 'P',
  f: 'F',
  l: 'Cl',
  C: 'Cl',
  L: 'Li',
  b: 'Br',
  B: 'B',
  h: 'H',
  i: 'I',
}
/** Gruppen-Beschriftung (gespiegelt, wenn die Bindung von rechts kommt: OMe → MeO) */
const ATOM_GROUP: Record<string, string> = {
  O: 'OMe',
  N: 'NO2',
  P: 'Ph',
  F: 'CF3',
  H: 'Cbz',
  y: 'Boc',
  Q: 'Fmoc',
  m: 'Me',
  M: 'MgBr',
  d: 'D',
  A: 'Ac',
  e: 'Et',
  E: 'CO2Me',
  Z: 'N3',
}
/** Ringe an einem Atom: Ringgröße (Atom wird Ringglied; bei ≥ 2 Nachbarn spiro) */
const ATOM_RING: Record<string, { n: number; aromatic?: boolean }> = {
  '3': { n: 6, aromatic: true },
  a: { n: 6, aromatic: true },
  '6': { n: 6 },
  '7': { n: 5 },
  v: { n: 3 },
  u: { n: 4 },
}
/** Tasten, die am Hotspot (ohne Maus darüber) als ChemDraw-Hotkey gelten – alle anderen bleiben Werkzeug-Tasten */
export const ATOM_KEYS = new Set([...Object.keys(ATOM_ELEMENT), ...Object.keys(ATOM_GROUP), ...Object.keys(ATOM_RING), 'c', '0', '1', '2', '4', '5', '8', '9', 'z', 'k', 'K'])

const BOND_TYPES: Record<string, BondType> = {
  '1': 'single',
  '2': 'double',
  '3': 'triple',
  w: 'wedge',
  h: 'hash',
  W: 'hash',
  H: 'hash',
  b: 'bold',
  B: 'double',
  d: 'dashed',
  D: 'aromatic',
  y: 'wavy',
}
const BOND_RING: Record<string, { n: number; aromatic?: boolean; cp?: boolean; chair?: 'chair1' | 'chair2' }> = {
  a: { n: 6, aromatic: true },
  z: { n: 5, cp: true },
  v: { n: 3 },
  '4': { n: 4 },
  '5': { n: 5 },
  '6': { n: 6 },
  '7': { n: 7 },
  '8': { n: 8 },
  '9': { n: 6, chair: 'chair1' },
  '0': { n: 6, chair: 'chair2' },
}
export const BOND_KEYS = new Set([...Object.keys(BOND_TYPES), ...Object.keys(BOND_RING)])

// Cyclopentadien an einer Bindung (wie im Cheat Sheet): die Ansatzbindung selbst und die gegenüberliegende Kante 2–3
// werden Doppelbindungen, das CH2 sitzt neben dem ersten Bindungsatom (an Benzol: Inden)
const CP_ON_BOND = [true, false, true, false, false]

// ---------- Hilfen ----------

function nbCount(d: Doc, id: Id): number {
  return (buildGraph(d).adj.get(id) ?? []).length
}

/** neue Bindung vom Atom in Richtung ang (Standard: beste freie Richtung); vorhandenes Atom dort wird verwendet */
function sprout(d: Doc, from: Id, type: BondType = 'single', ang?: number, element = 'C'): Id {
  const a = d.atoms[from]
  const L = d.style.bondLength
  const dir = ang ?? bestBondAngle(buildGraph(d), a)
  const p = add(a, fromAngle(dir, L))
  const near = Object.values(d.atoms).find((o) => o.id !== from && Math.hypot(o.x - p.x, o.y - p.y) < L * 0.25)
  const t = near ?? addAtom(d, p.x, p.y, element)
  const b = findBond(d, from, t.id) ?? addBond(d, from, t.id, type)
  if (b && !near) b.type = type
  if (type === 'triple') linearizeTriples(d, [from, t.id])
  return t.id
}

/** zweite Zickzack-Richtung an einem Endatom (die, die „1“ nicht nimmt) */
function otherZigzag(d: Doc, id: Id): number | undefined {
  const g = buildGraph(d)
  const a = d.atoms[id]
  const nbs = g.adj.get(id) ?? []
  if (nbs.length === 0) return -Math.PI / 2
  if (nbs.length !== 1) return undefined
  const th = angleOf(sub(nbs[0].other, a))
  const best = bestBondAngle(g, a)
  const c1 = th + (2 * Math.PI) / 3
  const c2 = th - (2 * Math.PI) / 3
  return Math.abs(Math.atan2(Math.sin(c1 - best), Math.cos(c1 - best))) < 0.1 ? c2 : c1
}

/**
 * Zwei Substituenten an einem Atom mit genau zwei Nachbarn (gem-Dimethyl): symmetrisch zur Winkelhalbierenden, die
 * freie Lücke in drei gleiche Teile geteilt. Zweiter Wert = im Uhrzeigersinn (dort sitzt in ChemDraw der Hotspot).
 */
function gemAngles(d: Doc, id: Id): [number, number] | undefined {
  const g = buildGraph(d)
  const a = d.atoms[id]
  const nbs = g.adj.get(id) ?? []
  if (nbs.length !== 2) return undefined
  const [t0, t1] = nbs.map((nb) => angleOf(sub(nb.other, a)))
  const inner = Math.abs(Math.atan2(Math.sin(t0 - t1), Math.cos(t0 - t1)))
  const gap = 2 * Math.PI - inner
  const bis = bestBondAngle(g, a)
  return [bis - gap / 6, bis + gap / 6]
}

function setElement(d: Doc, id: Id, el: string) {
  const a = d.atoms[id]
  a.element = el
  a.label = undefined
  a.literal = undefined
  a.showC = undefined
  a.attach = undefined
}

function setGroup(d: Doc, id: Id, label: string) {
  const a = d.atoms[id]
  a.element = 'C'
  a.label = label
  a.literal = undefined
  a.showC = undefined
  a.attach = undefined
}

/**
 * Bei ungeraden Ringen gibt es zwei „gegenüberliegende“ Stellen; wie in ChemDraw die, die – vom Ansatz aus in den
 * Ring geschaut – links liegt. Rückgabe: Index k (Ecke k bzw. Kante k→k+1)
 */
function farIndex(pts: Pt[], from: Pt, edges: boolean): number {
  const n = pts.length
  const lo = Math.floor(n / 2)
  if (n % 2 === 0) return lo
  const c = pts.reduce((acc, q) => add(acc, { x: q.x / n, y: q.y / n }), { x: 0, y: 0 })
  const o = norm(sub(c, from))
  const left = { x: o.y, y: -o.x }
  const at = (k: number) => (edges ? mid(pts[k], pts[(k + 1) % n]) : pts[k])
  return dot(sub(at(lo), c), left) >= dot(sub(at(lo + 1), c), left) ? lo : lo + 1
}

/** Ring an einem Atom; Rückgabe: Ringglied gegenüber (neuer Hotspot) */
function ringAtAtom(d: Doc, id: Id, n: number, aromatic: boolean): Id {
  const plan = planRing(d, buildGraph(d), n, { type: 'atom', id })
  const ids = placeRing(d, plan, aromatic)
  const pts = ids.map((i) => d.atoms[i])
  return ids[farIndex(pts, d.atoms[id], false)] ?? id
}

// ---------- Tasten über einem Atom ----------

/**
 * ChemDraw-Hotkey an einem Atom ausführen (innerhalb von commit). Rückgabe: neuer Hotspot, oder false, wenn die
 * Taste hier nichts bedeutet.
 */
export function atomHotkey(d: Doc, id: Id, key: string): Hotspot | false {
  if (!d.atoms[id]) return false
  const at: Hotspot = { kind: 'atom', id }
  const n = nbCount(d, id)
  if (ATOM_ELEMENT[key]) {
    setElement(d, id, ATOM_ELEMENT[key])
    return at
  }
  if (ATOM_GROUP[key]) {
    setGroup(d, id, ATOM_GROUP[key])
    return at
  }
  if (key === 'c') {
    // C: Kohlenstoff; auf einem unbeschrifteten C-Atom die Beschriftung (CH3) ein-/ausblenden
    const a = d.atoms[id]
    if (a.element === 'C' && !a.label) a.showC = !a.showC || undefined
    else setElement(d, id, 'C')
    return at
  }
  const ring = ATOM_RING[key]
  if (ring) return { kind: 'atom', id: ringAtAtom(d, id, ring.n, !!ring.aromatic) }
  switch (key) {
    case '1':
      return { kind: 'atom', id: sprout(d, id) }
    case '0':
      // Bindung in die andere Richtung (am Ringatom: gerade nach außen)
      return { kind: 'atom', id: sprout(d, id, 'single', n >= 2 ? undefined : otherZigzag(d, id)) }
    case '8':
      return { kind: 'atom', id: sprout(d, id, 'double') }
    case 'z':
      return { kind: 'atom', id: sprout(d, id, 'triple') }
    case '2': {
      // Carbonyl: =O an diesem Atom; am Kettenende geht die Kette weiter
      if (n >= 2) {
        sprout(d, id, 'double', undefined, 'O')
        return at
      }
      const next = sprout(d, id)
      sprout(d, id, 'double', undefined, 'O')
      return { kind: 'atom', id: next }
    }
    case 'k': {
      // Sulfonyl: Atom wird S mit zwei =O; am Kettenende geht die Kette weiter
      setElement(d, id, 'S')
      const next = n >= 2 ? null : sprout(d, id)
      sprout(d, id, 'double', undefined, 'O')
      sprout(d, id, 'double', undefined, 'O')
      return next ? { kind: 'atom', id: next } : at
    }
    case '9':
    case '4':
    case '5': {
      // 9: Methyl-Verzweigung (am Ringatom: gem-Dimethyl), 4/5: Verzweigung als Keil/Schraffur
      const branch: BondType = key === '4' ? 'wedge' : key === '5' ? 'hash' : 'single'
      if (n >= 2) {
        if (key !== '9') return { kind: 'atom', id: sprout(d, id, branch) }
        const gem = gemAngles(d, id)
        sprout(d, id, 'single', gem?.[0])
        return { kind: 'atom', id: sprout(d, id, 'single', gem?.[1]) }
      }
      const next = sprout(d, id)
      sprout(d, id, branch)
      return { kind: 'atom', id: next }
    }
    case 'K': {
      // am Ringatom: gem-Dimethyl mit Keil und Schraffur; am Kettenende: quartäres C (tBu-artig)
      if (n >= 2) {
        const gem = gemAngles(d, id)
        sprout(d, id, 'wedge', gem?.[0])
        return { kind: 'atom', id: sprout(d, id, 'hash', gem?.[1]) }
      }
      const g = buildGraph(d)
      const a = d.atoms[id]
      const nbs = g.adj.get(id) ?? []
      const th = nbs.length ? angleOf(sub(nbs[0].other, a)) : Math.PI / 2
      sprout(d, id, 'single', th + Math.PI / 2)
      sprout(d, id, 'single', th - Math.PI / 2)
      return { kind: 'atom', id: sprout(d, id, 'single', th + Math.PI) }
    }
  }
  return false
}

// ---------- Tasten über einer Bindung ----------

export function bondHotkey(d: Doc, id: Id, key: string): Hotspot | false {
  const b = d.bonds[id]
  if (!b) return false
  const bt = BOND_TYPES[key]
  if (bt) {
    // Keil/Schraffur erneut: Richtung umdrehen
    if ((bt === 'wedge' || bt === 'hash') && b.type === bt) {
      const t = b.a1
      b.a1 = b.a2
      b.a2 = t
    } else b.type = bt
    linearizeTriples(d, [b.a1, b.a2])
    return { kind: 'bond', id }
  }
  const r = BOND_RING[key]
  if (!r) return false
  const g = buildGraph(d)
  const shape = r.chair ? ringShape(r.chair) : null
  const plan = shape ? planShapedRing(d, g, shape, { type: 'bond', id }) : planRing(d, g, r.n, { type: 'bond', id })
  const ids = placeRing(d, plan, !!r.aromatic, r.cp ? CP_ON_BOND : undefined)
  // neuer Hotspot: Bindung gegenüber der Ansatzbindung
  const pts = ids.map((i) => d.atoms[i])
  const k = farIndex(pts, mid(pts[0], pts[1]), true)
  const far = findBond(d, ids[k], ids[(k + 1) % ids.length])
  return far ? { kind: 'bond', id: far.id } : { kind: 'bond', id }
}

// ---------- Hotspot ----------

/** gültiger Hotspot (Atom/Bindung existiert noch) */
export function liveHotspot(doc: Doc, hs: Hotspot): Hotspot {
  if (!hs) return null
  if (hs.kind === 'atom' ? doc.atoms[hs.id] : doc.bonds[hs.id]) return hs
  return null
}

/** Pfeiltaste: vom Atom zur Bindung in dieser Richtung, von der Bindung zum Atom in dieser Richtung */
export function moveHotspot(doc: Doc, hs: Hotspot, dir: Pt): Hotspot {
  if (!hs) return null
  const L = doc.style.bondLength
  if (hs.kind === 'atom') {
    const a = doc.atoms[hs.id]
    let best: { id: Id; s: number } | null = null
    for (const nb of buildGraph(doc).adj.get(hs.id) ?? []) {
      const s = dot(norm(sub(nb.other, a)), dir)
      if (s > 0.3 && (!best || s > best.s)) best = { id: nb.bond.id, s }
    }
    return best ? { kind: 'bond', id: best.id } : hs
  }
  const b = doc.bonds[hs.id]
  const m = mid(doc.atoms[b.a1], doc.atoms[b.a2])
  const s1 = dot(sub(doc.atoms[b.a1], m), dir)
  const s2 = dot(sub(doc.atoms[b.a2], m), dir)
  const s = Math.max(s1, s2)
  if (s < L * 0.12) return hs
  return { kind: 'atom', id: s1 >= s2 ? b.a1 : b.a2 }
}

/** Enter bei Auswahl: einzelnes Atom/einzelne Bindung bzw. das zuletzt gezeichnete Atom des Moleküls wird Hotspot */
export function hotspotFromSelection(doc: Doc, sel: Selection): Hotspot {
  if (sel.atoms.length === 1 && doc.atoms[sel.atoms[0]]) return { kind: 'atom', id: sel.atoms[0] }
  if (sel.bonds.length === 1 && !sel.atoms.length && doc.bonds[sel.bonds[0]]) return { kind: 'bond', id: sel.bonds[0] }
  const chosen = new Set(sel.atoms)
  for (const id of sel.bonds) {
    const b = doc.bonds[id]
    if (b) chosen.add(b.a1).add(b.a2)
  }
  const ordered = Object.keys(doc.atoms).filter((id) => chosen.has(id))
  const last = ordered[ordered.length - 1]
  return last ? { kind: 'atom', id: last } : null
}

/** Leertaste/Tab: ganzes Molekül des Hotspots markieren */
export function selectHotspotMolecule() {
  const { doc, hotspot } = getState()
  const hs = liveHotspot(doc, hotspot)
  if (!hs) return false
  const start = hs.kind === 'atom' ? hs.id : doc.bonds[hs.id].a1
  const mol = fragments(doc, buildGraph(doc)).find((f) => f.includes(start)) ?? [start]
  setState({ sel: completeSel(doc, { ...emptySelection(), atoms: mol }), hotspot: null })
  return true
}

/** g: Hotspot (bzw. Atom/Bindung unter der Maus) als Auswahl übernehmen */
export function grabHotspot(target: Hotspot) {
  if (!target) return
  const s = emptySelection()
  if (target.kind === 'atom') s.atoms.push(target.id)
  else s.bonds.push(target.id)
  setState({ sel: s, hotspot: null })
}

// ---------- Reaktions-Kürzel: ⌘ + Pfeiltaste ----------

/**
 * Markierte Molekül(e) als Kopie in Pfeilrichtung neben einen neuen Reaktionspfeil setzen (Edukt → Produkt);
 * die Kopie wird markiert, so dass sich weitere Stufen anhängen lassen.
 */
export function reactionShortcut(dir: Pt) {
  const { doc, sel } = getState()
  const full = completeSel(doc, sel)
  const atomIds = new Set(full.atoms)
  if (!atomIds.size) return
  const box = sceneBBox(getScene(doc), { atoms: atomIds })
  if (!box) return
  const L = doc.style.bondLength
  const gap = L * 0.8
  const arrowLen = L * 3
  const horiz = dir.x !== 0
  const w = box.x2 - box.x1
  const h = box.y2 - box.y1
  const cx = (box.x1 + box.x2) / 2
  const cy = (box.y1 + box.y2) / 2
  // Pfeil von der Kante der Auswahl aus; Kopie um Breite/Höhe + Pfeil + Abstände versetzt
  const start = horiz ? { x: dir.x > 0 ? box.x2 + gap : box.x1 - gap, y: cy } : { x: cx, y: dir.y > 0 ? box.y2 + gap : box.y1 - gap }
  const end = add(start, { x: dir.x * arrowLen, y: dir.y * arrowLen })
  const shift = horiz ? dir.x * (w + 2 * gap + arrowLen) : dir.y * (h + 2 * gap + arrowLen)
  const clip = JSON.parse(JSON.stringify(extractClip(doc, { ...emptySelection(), atoms: full.atoms, bonds: full.bonds })))
  commit((d) => {
    const id = uid()
    d.arrows[id] = { id, kind: 'reaction', x1: start.x, y1: start.y, x2: end.x, y2: end.y, above: '', below: '' }
    return pasteClip(d, clip, horiz ? shift : 0, horiz ? 0 : shift)
  })
}
