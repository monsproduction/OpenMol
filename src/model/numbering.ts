// Atomnummerierung für NMR-Zuordnungen nach VEREINFACHTEN IUPAC-Regeln – keine vollständige Nomenklatur (die gibt es
// offline nicht). Ergebnis ist ein Vorschlag, den man von Hand korrigiert (Werkzeug „Nummerieren“, Inspektor).
// Regeln, die umgesetzt sind:
//  • Stammsystem: Ringsystem mit der ranghöchsten charakteristischen Gruppe (sonst das größte), ohne Ringe die
//    längste Kohlenstoffkette durch das Kohlenstoffatom der Hauptgruppe
//  • häufige anellierte Ringe nach festem Muster (Naphthalin, Anthracen, Chinolin, Isochinolin, Indol, Benzofuran,
//    Benzothiophen, Benzimidazol, Benzoxazol, Benzothiazol) samt Lokanten wie 4a/8a
//  • Monocyclen: Heteroatome zuerst und so niedrig wie möglich (O > S > Se > N > P …), dann N–H, dann die
//    Hauptgruppe, dann die übrigen Substituenten
//  • Ketten: niedrigste Nummer für die Hauptgruppe, dann für Mehrfachbindungen, dann für Substituenten
//  • weitere Ringsysteme mit Strich (1′, 2′ … bzw. 1″ …, Anknüpfung = 1), Seitenketten-C-Atome fortlaufend
// Nicht umgesetzt: alphabetische Reihenfolge der Substituenten, verbrückte/spiro-Systeme, weitere anellierte Systeme
// (z. B. Phenanthren, Purin – dort fortlaufende Nummern mit Hinweis), Stereo-Regeln.
import * as OCL from 'openchemlib'
import { buildGraph, fragments } from './chem'
import { docToOCL } from './ocl'
import type { Doc, Id } from './types'

type Mol = OCL.Molecule

// ---------- feste Muster anellierter Ringe (SMILES-Atomreihenfolge → Lokant) ----------

// Pyrrol-artiger Stickstoff als [nH]: nur so liest OpenChemLib das Muster richtig (passt auch auf N-Methyl usw., geprüft)
const TEMPLATES: { name: string; smiles: string; loc: string[] }[] = [
  { name: 'Naphthalin', smiles: 'c1ccc2ccccc2c1', loc: ['2', '3', '4', '4a', '5', '6', '7', '8', '8a', '1'] },
  { name: 'Anthracen', smiles: 'c1ccc2cc3ccccc3cc2c1', loc: ['2', '3', '4', '4a', '10', '10a', '5', '6', '7', '8', '8a', '9', '9a', '1'] },
  { name: 'Chinolin', smiles: 'n1cccc2ccccc12', loc: ['1', '2', '3', '4', '4a', '5', '6', '7', '8', '8a'] },
  { name: 'Isochinolin', smiles: 'c1nccc2ccccc12', loc: ['1', '2', '3', '4', '4a', '5', '6', '7', '8', '8a'] },
  { name: 'Indol', smiles: '[nH]1ccc2ccccc12', loc: ['1', '2', '3', '3a', '4', '5', '6', '7', '7a'] },
  { name: 'Benzofuran', smiles: 'o1ccc2ccccc12', loc: ['1', '2', '3', '3a', '4', '5', '6', '7', '7a'] },
  { name: 'Benzothiophen', smiles: 's1ccc2ccccc12', loc: ['1', '2', '3', '3a', '4', '5', '6', '7', '7a'] },
  { name: 'Benzimidazol', smiles: '[nH]1cnc2ccccc12', loc: ['1', '2', '3', '3a', '4', '5', '6', '7', '7a'] },
  { name: 'Benzoxazol', smiles: 'o1cnc2ccccc12', loc: ['1', '2', '3', '3a', '4', '5', '6', '7', '7a'] },
  { name: 'Benzothiazol', smiles: 's1cnc2ccccc12', loc: ['1', '2', '3', '3a', '4', '5', '6', '7', '7a'] },
]

let templateMols: { t: (typeof TEMPLATES)[number]; mol: Mol }[] | null = null
function templates() {
  if (!templateMols)
    templateMols = TEMPLATES.map((t) => {
      const mol = OCL.Molecule.fromSmiles(t.smiles)
      mol.setFragment(true)
      return { t, mol }
    })
  return templateMols
}

/** Lokant als Zahl zum Vergleichen: „4a“ liegt zwischen 4 und 5 */
const locVal = (l: string) => {
  const m = /^(\d+)([a-z]?)/.exec(l)
  return m ? Number(m[1]) + (m[2] ? (m[2].charCodeAt(0) - 96) / 10 : 0) : 999
}

/** lexikografischer Vergleich zweier Bewertungen (Listen von Lokant-Listen) – kleiner ist besser */
function cmpScore(a: number[][], b: number[][]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? []
    const y = b[i] ?? []
    for (let j = 0; j < Math.max(x.length, y.length); j++) {
      if (x[j] === undefined) return -1
      if (y[j] === undefined) return 1
      if (x[j] !== y[j]) return x[j] - y[j]
    }
  }
  return 0
}

// ---------- Chemie auf dem OCL-Molekül ----------

const HETERO_PRIORITY: Record<number, number> = { 8: 1, 16: 2, 34: 3, 52: 4, 7: 5, 15: 6, 33: 7, 14: 8, 5: 9 }

function neighbors(mol: Mol, i: number): { j: number; order: number }[] {
  const out = []
  for (let k = 0; k < mol.getAllConnAtoms(i); k++) {
    const j = mol.getConnAtom(i, k)
    if (mol.getAtomicNo(j) > 1) out.push({ j, order: mol.getConnBondOrder(i, k) })
  }
  return out
}

/**
 * Rang der charakteristischen Gruppe an Atom x (kleiner = ranghöher, nach IUPAC-Reihenfolge vereinfacht); Nachbarn in
 * `ignore` zählen nicht (z. B. die anderen Ringatome)
 */
function groupRank(mol: Mol, x: number, ignore: Set<number>): number {
  const el = mol.getAtomicNo(x)
  const nb = neighbors(mol, x).filter((n) => !ignore.has(n.j))
  const hasH = (j: number) => mol.getAllHydrogens(j) > 0
  const isEl = (j: number, z: number) => mol.getAtomicNo(j) === z
  if (el === 6) {
    const dO = nb.some((n) => n.order === 2 && isEl(n.j, 8))
    const OH = nb.some((n) => n.order === 1 && isEl(n.j, 8) && hasH(n.j))
    const OR = nb.some((n) => n.order === 1 && isEl(n.j, 8) && !hasH(n.j))
    const N = nb.some((n) => n.order === 1 && isEl(n.j, 7))
    const hal = nb.some((n) => [9, 17, 35, 53].includes(mol.getAtomicNo(n.j)))
    if (dO && OH) return 1
    if (dO && OR) return 3
    if (dO && hal) return 4
    if (dO && N) return 5
    if (nb.some((n) => n.order === 3 && isEl(n.j, 7))) return 6
    if (dO && mol.getAllHydrogens(x) > 0) return 7
    if (dO) return 8
    if (OH) return 9
    if (nb.some((n) => n.order === 1 && isEl(n.j, 16) && hasH(n.j))) return 10
    // Amin: N ohne C=O und ohne N=O (Nitro, Amid zählen nicht)
    const carbonyl = (j: number) => isEl(j, 6) && neighbors(mol, j).some((m) => m.order === 2 && (isEl(m.j, 8) || isEl(m.j, 16)))
    if (nb.some((n) => n.order === 1 && isEl(n.j, 7) && !neighbors(mol, n.j).some((m) => m.j !== x && (carbonyl(m.j) || (isEl(m.j, 8) && m.order === 2) || isEl(m.j, 8))))) return 11
  }
  return 99
}

/** Ringsysteme (verbundene Ringe) als Atomlisten */
function ringSystems(mol: Mol): number[][] {
  const rs = mol.getRingSet()
  const rings: number[][] = []
  for (let r = 0; r < rs.getSize(); r++) rings.push(rs.getRingAtoms(r))
  const sys: Set<number>[] = []
  for (const r of rings) {
    const hit = sys.filter((s) => r.some((a) => s.has(a)))
    const merged = new Set(r)
    for (const s of hit) for (const a of s) merged.add(a)
    for (const s of hit) sys.splice(sys.indexOf(s), 1)
    sys.push(merged)
  }
  return sys.map((s) => [...s])
}

/** Ring in zyklischer Reihenfolge (RingCollection liefert sie nicht garantiert) */
function cycleOrder(mol: Mol, atoms: number[]): number[] | null {
  const set = new Set(atoms)
  const out = [atoms[0]]
  const seen = new Set(out)
  while (out.length < atoms.length) {
    const cur = out[out.length - 1]
    const next = neighbors(mol, cur).find((n) => set.has(n.j) && !seen.has(n.j))
    if (!next) return null
    out.push(next.j)
    seen.add(next.j)
  }
  return out
}

// ---------- Nummerieren ----------

interface Ctx {
  mol: Mol
  /** OCL-Atom → Rang seiner Hauptgruppe im Stammsystem (Substituenten eingerechnet) */
  rank: (i: number, parent: Set<number>) => number
  substituted: (i: number, parent: Set<number>) => boolean
}

/** Bewertung einer Nummerierung (Atom → Lokantwert) nach den Regeln oben */
function score(ctx: Ctx, order: Map<number, number>, parent: Set<number>, withHetero: boolean): number[][] {
  const { mol } = ctx
  const atoms = [...order.keys()]
  const sorted = (xs: number[]) => xs.sort((a, b) => a - b)
  const het = atoms.filter((i) => mol.getAtomicNo(i) !== 6)
  const s: number[][] = []
  if (withHetero) {
    s.push(sorted(het.map((i) => order.get(i)!)))
    s.push(het.sort((a, b) => (HETERO_PRIORITY[mol.getAtomicNo(a)] ?? 20) - (HETERO_PRIORITY[mol.getAtomicNo(b)] ?? 20) || order.get(a)! - order.get(b)!).map((i) => order.get(i)!))
    s.push(sorted(het.filter((i) => mol.getAtomicNo(i) === 7 && mol.getAllHydrogens(i) > 0).map((i) => order.get(i)!)))
  }
  const best = Math.min(...atoms.map((i) => ctx.rank(i, parent)))
  if (best < 99) s.push(sorted(atoms.filter((i) => ctx.rank(i, parent) === best).map((i) => order.get(i)!)))
  s.push(sorted(atoms.filter((i) => ctx.substituted(i, parent)).map((i) => order.get(i)!)))
  return s
}

/** Ringsystem nummerieren: Muster, sonst Monocyclus nach Regeln; start = Anknüpfungsatom (bekommt die 1) */
function numberRingSystem(ctx: Ctx, system: number[], start?: number): Map<number, string> | null {
  const { mol } = ctx
  const set = new Set(system)
  let best: { order: Map<number, number>; labels: Map<number, string>; s: number[][] } | null = null
  const consider = (labels: Map<number, string>, withHetero: boolean) => {
    if (start !== undefined && labels.get(start) !== '1') return
    const order = new Map([...labels].map(([i, l]) => [i, locVal(l)]))
    const s = score(ctx, order, set, withHetero)
    if (!best || cmpScore(s, best.s) < 0) best = { order, labels, s }
  }
  // anellierte Muster: alle Zuordnungen, die genau dieses Ringsystem treffen
  for (const { t, mol: frag } of templates()) {
    if (frag.getAllAtoms() !== system.length) continue
    const ss = new OCL.SSSearcher()
    ss.setMol(frag, mol)
    if (!ss.findFragmentInMolecule({ countMode: 'rigorous' })) continue
    for (const m of ss.getMatchList()) {
      if (!m.every((i) => set.has(i))) continue
      consider(new Map(m.map((i, k) => [i, t.loc[k]])), false)
    }
    if (best) return (best as { labels: Map<number, string> }).labels
  }
  // Monocyclus (genau ein Ring: so viele Ringbindungen wie Atome)
  let inner = 0
  for (const i of system) inner += neighbors(mol, i).filter((n) => set.has(n.j)).length
  const ring = inner / 2 === system.length ? cycleOrder(mol, system) : null
  if (ring && ring.length === system.length && neighbors(mol, ring[ring.length - 1]).some((n) => n.j === ring[0])) {
    for (let k = 0; k < ring.length; k++)
      for (const dir of [1, -1]) {
        const labels = new Map<number, string>()
        for (let q = 0; q < ring.length; q++) labels.set(ring[(k + dir * q + ring.length) % ring.length], String(q + 1))
        consider(labels, true)
      }
    return best ? (best as { labels: Map<number, string> }).labels : null
  }
  return null
}

/** längste Kohlenstoffkette (ohne Ringatome) durch das Atom der Hauptgruppe, nummeriert */
function numberChain(ctx: Ctx, carbons: number[]): Map<number, string> {
  const { mol } = ctx
  const set = new Set(carbons)
  const cn = (i: number) => neighbors(mol, i).filter((n) => set.has(n.j)).map((n) => n.j)
  // Baum: weiteste Wege per Tiefensuche
  const farthest = (from: number, avoid: number | null): number[] => {
    let bestPath = [from]
    const walk = (u: number, prev: number | null, path: number[]) => {
      if (path.length > bestPath.length) bestPath = [...path]
      for (const v of cn(u)) if (v !== prev && v !== avoid && !path.includes(v)) walk(v, u, [...path, v])
    }
    walk(from, null, [from])
    return bestPath
  }
  const none = new Set<number>()
  const ranks = carbons.map((i) => groupRank(mol, i, none))
  const top = Math.min(...ranks)
  let chain: number[]
  if (top < 99) {
    const p = carbons[ranks.indexOf(top)]
    // zwei längste Äste ab der Hauptgruppe
    const branches = cn(p)
      .map((v) => farthest(v, p))
      .sort((a, b) => b.length - a.length)
    chain = [...(branches[1] ?? []).reverse(), p, ...(branches[0] ?? [])]
  } else {
    const a = farthest(carbons[0], null)
    chain = farthest(a[a.length - 1], null)
  }
  const candidates = [chain, [...chain].reverse()]
  const chainSet = new Set(chain)
  let best: { c: number[]; s: number[][] } | null = null
  for (const c of candidates) {
    const order = new Map(c.map((i, k) => [i, k + 1]))
    const s: number[][] = []
    if (top < 99) s.push(c.filter((i) => groupRank(mol, i, none) === top).map((i) => order.get(i)!))
    // Mehrfachbindungen innerhalb der Kette (Lokant des ersten Atoms)
    const multi: number[] = []
    for (let k = 0; k + 1 < c.length; k++) {
      const nb = neighbors(mol, c[k]).find((n) => n.j === c[k + 1])
      if (nb && nb.order > 1) multi.push(k + 1)
    }
    s.push(multi)
    s.push(c.filter((i) => neighbors(mol, i).some((n) => !chainSet.has(n.j))).map((i) => order.get(i)!))
    if (!best || cmpScore(s, best.s) < 0) best = { c, s }
  }
  return new Map(best!.c.map((i, k) => [i, String(k + 1)]))
}

/** Nummern für ein Molekül (OCL); Ergebnis: OCL-Atom → Lokant, dazu ein Hinweis, falls ein Teil ohne Regel blieb */
function numberMolecule(mol: Mol): { labels: Map<number, string>; fallback: boolean } {
  mol.ensureHelperArrays(OCL.Molecule.cHelperRings)
  const heavy: number[] = []
  for (let i = 0; i < mol.getAllAtoms(); i++) if (mol.getAtomicNo(i) > 1) heavy.push(i)
  const ctx: Ctx = {
    mol,
    rank: (i, parent) => {
      let r = groupRank(mol, i, parent)
      for (const n of neighbors(mol, i)) if (!parent.has(n.j) && mol.getAtomicNo(n.j) === 6) r = Math.min(r, groupRank(mol, n.j, new Set([i])))
      return r
    },
    substituted: (i, parent) => neighbors(mol, i).some((n) => !parent.has(n.j)),
  }
  const systems = ringSystems(mol)
  const labels = new Map<number, string>()
  let fallback = false
  let parent: number[]
  if (systems.length) {
    const val = (s: number[]) => {
      const set = new Set(s)
      return [Math.min(...s.map((i) => ctx.rank(i, set))), -s.length, -s.filter((i) => mol.getAtomicNo(i) !== 6).length]
    }
    systems.sort((a, b) => cmpScore([val(a)], [val(b)]))
    parent = systems[0]
    // Ringsequenz (Biaryl): die Verknüpfung bekommt 1 bzw. 1′ – wie „1,1′-Biphenyl“
    const pset = new Set(parent)
    const link = parent.find((i) => neighbors(mol, i).some((n) => !pset.has(n.j) && systems.some((s) => s !== parent && s.includes(n.j))))
    const l = (link !== undefined ? numberRingSystem(ctx, parent, link) : null) ?? numberRingSystem(ctx, parent)
    if (l) for (const [i, x] of l) labels.set(i, x)
    else {
      fallback = true
      parent.forEach((i, k) => labels.set(i, String(k + 1)))
    }
  } else {
    const carbons = heavy.filter((i) => mol.getAtomicNo(i) === 6)
    if (!carbons.length) return { labels, fallback }
    for (const [i, x] of numberChain(ctx, carbons)) labels.set(i, x)
    parent = [...labels.keys()]
  }
  // weitere Ringsysteme mit Strich, Seitenketten-C fortlaufend – vom Stammsystem aus in Lokant-Reihenfolge
  let next = Math.max(0, ...[...labels.values()].map((l) => parseInt(l, 10) || 0)) + 1
  let primes = 0
  const sysOf = new Map<number, number[]>()
  for (const s of systems) for (const i of s) sysOf.set(i, s)
  const queue = [...labels.keys()].sort((a, b) => locVal(labels.get(a)!) - locVal(labels.get(b)!))
  const visited = new Set(queue)
  while (queue.length) {
    const u = queue.shift()!
    for (const { j } of neighbors(mol, u)) {
      if (visited.has(j)) continue
      const sys = sysOf.get(j)
      if (sys && !sys.some((i) => labels.has(i))) {
        primes++
        const mark = primes === 1 ? '′' : primes === 2 ? '″' : '‴'
        // Anknüpfung = 1′ (Phenyl, Pyridyl …); bei Mustern wie Naphthalin-2-yl gilt deren eigene Nummerierung
        const l = numberRingSystem(ctx, sys, j) ?? numberRingSystem(ctx, sys)
        if (!l) fallback = true
        const lab = l ?? new Map(sys.map((i, k) => [i, String(k + 1)]))
        for (const [i, x] of lab) {
          labels.set(i, x + mark)
          visited.add(i)
        }
        queue.push(...[...lab.keys()].sort((a, b) => locVal(lab.get(a)!) - locVal(lab.get(b)!)))
        continue
      }
      visited.add(j)
      // nur Kohlenstoff bekommt eine fortlaufende Nummer, Heteroatome der Seitenkette werden nur durchlaufen
      if (mol.getAtomicNo(j) === 6) labels.set(j, String(next++))
      queue.push(j)
    }
  }
  return { labels, fallback }
}

/**
 * Atomnummern für die Moleküle der gegebenen Atome (ganze Moleküle); Rückgabe: Dokument-Atom → Lokant. Atome mit
 * Kürzel (OMe, CO2H …) und Wasserstoff bekommen keine Nummer. fallback: ein Ringsystem ohne passende Regel.
 */
export function autoNumber(doc: Doc, atomIds: Id[]): { nums: Map<Id, string>; fallback: boolean } {
  const nums = new Map<Id, string>()
  let fallback = false
  const g = buildGraph(doc)
  for (const frag of fragments(doc, g, atomIds)) {
    const { mol, map } = docToOCL(doc, frag)
    const r = numberMolecule(mol)
    fallback ||= r.fallback
    for (const [id, idx] of map) {
      const a = doc.atoms[id]
      if (!a || a.label || a.element === 'H') continue
      const l = r.labels.get(idx)
      if (l) nums.set(id, l)
    }
  }
  return { nums, fallback }
}
