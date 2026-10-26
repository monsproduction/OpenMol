// Brücke zu OpenChemLib: Dokument → OCL-Molekül (für Analyse, SMILES, Molfile)
// und OCL-Molekül → Dokument-Fragment (für Import und Vorlagen).
import * as OCL from 'openchemlib'
import { ABBREVIATIONS, canonicalAbbrev, condensedToSmiles } from './abbrev'
import { ATOMIC_WEIGHT, SYMBOL_SET } from './elements'
import { buildGraph } from './chem'
import { declash, layoutQuality, regularizeRingSystems, regularizeRings, type P2 } from './declash'
import { chemLabel } from './richtext'
import type { Atom, Bond, BondType, Doc, Id } from './types'
import { uid } from './types'

const M = OCL.Molecule

const fragCache = new Map<string, OCL.Molecule | null>()
function parseFragment(smiles: string): OCL.Molecule | null {
  if (fragCache.has(smiles)) return fragCache.get(smiles)!
  let m: OCL.Molecule | null = null
  try {
    m = M.fromSmiles(smiles)
  } catch {
    m = null
  }
  fragCache.set(smiles, m)
  return m
}

/** Liefert das SMILES-Fragment für ein Atom-Label oder null (= Platzhalter) */
export function labelSmiles(raw: string): { smiles: string | null; generic: boolean; charge?: number } {
  // Hochgestellte Zusätze (Fe^II) gehören nicht zur Formel – eine hochgestellte Ladung (^+, ^2−) aber schon
  const sup = /\^\{?(\d?)([+\-−])\}?$/.exec(raw)
  let label = raw.replace(/\^.*$/, '')
  let charge = 0
  if (canonicalAbbrev(label)) {
    // Kürzel mit Ladungszeichen im Namen (falls vorhanden) nicht zerlegen
  } else if (sup) charge = (sup[2] === '+' ? 1 : -1) * (sup[1] ? +sup[1] : 1)
  else {
    // Ladung am Ende: NH3+, CO2−, BF4−, NMe3+, O−, Fe2+ (Zahl nur hinter einem reinen Elementsymbol)
    const m = /^(.+?)(\d?)([+\-−⁺⁻]{1,2})$/.exec(label)
    if (m && !/[+\-−⁺⁻]/.test(m[1].slice(-1))) {
      const sign = /[+⁺]/.test(m[3][0]) ? 1 : -1
      const elemOnly = SYMBOL_SET.has(m[1])
      if (m[2] && elemOnly) {
        charge = sign * +m[2]
        label = m[1]
      } else {
        charge = sign * m[3].length
        label = m[1] + m[2]
      }
    }
  }
  const out = (r: { smiles: string | null; generic: boolean }) => (charge ? { ...r, charge } : r)
  const key = canonicalAbbrev(label)
  if (key) {
    const ab = ABBREVIATIONS[key]
    // Kürzel, das die Ladung schon enthält (PPh3 = Phosphonium): Ladungszeichen nicht doppelt zählen
    if (charge && /[+-]\]/.test(ab.smiles) && (charge > 0) === /\+\]/.test(ab.smiles)) charge = 0
    return out({ smiles: ab.generic ? null : ab.smiles, generic: !!ab.generic })
  }
  if (SYMBOL_SET.has(label)) return out({ smiles: `[${label}]`.replace(/^\[([BCNOPSFI]|Cl|Br)\]$/, '$1'), generic: false })
  const c = condensedToSmiles(label, (s) => SYMBOL_SET.has(s))
  return out({ smiles: c, generic: !c })
}

/** Ladung eines Labels auf das passende Atom des Fragments: negativ bevorzugt an ein endständiges,
 *  einfach gebundenes O/S (Carboxylat, Sulfonat), positiv an das erste N/P/S/O, sonst ans Ankeratom. */
function placeLabelCharge(frag: OCL.Molecule, charge: number): number {
  const n = frag.getAllAtoms()
  if (charge < 0) {
    for (let i = n - 1; i >= 0; i--) {
      const z = frag.getAtomicNo(i)
      if ((z === 8 || z === 16) && frag.getConnAtoms(i) === 1 && frag.getBondOrder(frag.getConnBond(i, 0)) === 1 && frag.getAtomCharge(i) === 0) return i
    }
  } else {
    for (let i = 0; i < n; i++) if ([7, 15, 16, 8].includes(frag.getAtomicNo(i)) && frag.getAtomCharge(i) === 0) return i
  }
  return 0
}

export interface OclResult {
  mol: OCL.Molecule
  /** Dokument-Atom → OCL-Atomindex (Ankeratom bei Abkürzungen) */
  map: Map<Id, number>
  generic: number
  unknownLabels: string[]
}

/** star: Atome, die als offene Valenz („*“, ohne Masse und ohne Platzhalter-Hinweis) eingehen – z. B. Polymer-Enden */
export function docToOCL(doc: Doc, atomIds?: Id[], opts?: { star?: Set<Id> }): OclResult {
  const ids = atomIds ?? Object.keys(doc.atoms)
  const idSet = new Set(ids)
  const mol = new M(ids.length * 2 + 8, ids.length * 2 + 8)
  const map = new Map<Id, number>()
  let generic = 0
  const unknownLabels: string[] = []
  const scale = 1 / doc.style.bondLength

  for (const id of ids) {
    const a = doc.atoms[id]
    const x = a.x * scale
    const y = a.y * scale
    if (opts?.star?.has(id)) {
      const k = mol.addAtom(0)
      mol.setAtomX(k, x)
      mol.setAtomY(k, y)
      map.set(id, k)
      continue
    }
    if (a.attach) {
      const k = mol.addAtom(0)
      mol.setAtomX(k, x)
      mol.setAtomY(k, y)
      map.set(id, k)
      generic++
      continue
    }
    if (a.label) {
      const ls = labelSmiles(chemLabel(a.label))
      const frag = ls.smiles ? parseFragment(ls.smiles) : null
      if (!frag) {
        const k = mol.addAtom(0)
        mol.setAtomX(k, x)
        mol.setAtomY(k, y)
        map.set(id, k)
        generic++
        if (!ls.generic) unknownLabels.push(chemLabel(a.label))
        continue
      }
      // Ladungen: aus dem Label (NH3+, CO2−) und vom Nutzer gesetzt (gilt dem Ankeratom); Fragment ist gecacht → nicht verändern
      const extra = new Map<number, number>()
      if (ls.charge) {
        frag.ensureHelperArrays(M.cHelperNeighbours)
        extra.set(placeLabelCharge(frag, ls.charge), ls.charge)
      }
      if (a.charge) extra.set(0, (extra.get(0) ?? 0) + a.charge)
      const attached = Object.values(doc.bonds).some((b) => (b.a1 === id && idSet.has(b.a2)) || (b.a2 === id && idSet.has(b.a1)))
      const offset = mol.getAllAtoms()
      for (let i = 0; i < frag.getAllAtoms(); i++) {
        const k = mol.addAtom(frag.getAtomicNo(i))
        mol.setAtomCharge(k, frag.getAtomCharge(i) + (extra.get(i) ?? 0))
        if (frag.getAtomMass(i)) mol.setAtomMass(k, frag.getAtomMass(i))
        // Ankeratom: das scheinbare Radikal im Einzelfragment ist nur die fehlende Bindung zum Molekül
        if (i > 0 || !attached) mol.setAtomRadical(k, frag.getAtomRadical(i))
        else if (a.radical === 1) mol.setAtomRadical(k, M.cAtomRadicalStateD)
        else if (a.radical === 2) mol.setAtomRadical(k, M.cAtomRadicalStateT)
        mol.setAtomX(k, x + i * 0.01)
        mol.setAtomY(k, y + i * 0.01)
      }
      for (let i = 0; i < frag.getAllBonds(); i++) {
        const b = mol.addBond(frag.getBondAtom(0, i) + offset, frag.getBondAtom(1, i) + offset)
        mol.setBondType(b, frag.getBondType(i))
      }
      map.set(id, offset)
      continue
    }
    const z = OCL.Molecule.getAtomicNoFromLabel(a.element)
    const k = mol.addAtom(z)
    mol.setAtomX(k, x)
    mol.setAtomY(k, y)
    if (a.charge) mol.setAtomCharge(k, a.charge)
    if (a.isotope) mol.setAtomMass(k, a.isotope)
    if (a.radical === 1) mol.setAtomRadical(k, M.cAtomRadicalStateD)
    if (a.radical === 2) mol.setAtomRadical(k, M.cAtomRadicalStateT)
    map.set(id, k)
  }

  for (const bid in doc.bonds) {
    const b = doc.bonds[bid]
    if (!idSet.has(b.a1) || !idSet.has(b.a2)) continue
    const k = mol.addBond(map.get(b.a1)!, map.get(b.a2)!)
    mol.setBondType(k, b.type === 'double' && b.crossed ? M.cBondTypeCross : oclBondType(b.type))
  }
  return { mol, map, generic, unknownLabels }
}

function oclBondType(t: BondType): number {
  switch (t) {
    case 'double':
      return M.cBondTypeDouble
    case 'triple':
      return M.cBondTypeTriple
    case 'wedge':
      return M.cBondTypeUp
    case 'hash':
      return M.cBondTypeDown
    case 'aromatic':
      return M.cBondTypeDelocalized
    default:
      return M.cBondTypeSingle
  }
}

export function toSmiles(doc: Doc, atomIds?: Id[]): string {
  const { mol } = docToOCL(doc, atomIds)
  return mol.toIsomericSmiles().replace(/\[\?\]/g, '*')
}

export function toMolfile(doc: Doc, atomIds?: Id[]): string {
  const { mol } = docToOCL(doc, atomIds)
  return mol.toMolfile()
}

// ---------- Import ----------

export interface Fragment {
  atoms: Atom[]
  bonds: Bond[]
  /** Ringe mit aromatischem Kreis (z. B. η5-Cp) als Atom-ID-Zyklen */
  circles?: Id[][]
}

export function oclToFragment(mol: OCL.Molecule, bondLength: number, center?: { x: number; y: number }): Fragment {
  const n = mol.getAllAtoms()
  let hasCoords = false
  for (let i = 0; i < n; i++) if (mol.getAtomX(i) !== 0 || mol.getAtomY(i) !== 0) hasCoords = true
  if (!hasCoords && n > 1) {
    mol.inventCoordinates()
    declashMol(mol)
  }
  // Bindungslänge normalisieren – über den Median, damit absichtlich verlängerte Bindungen (Aufräumen)
  // die übrigen nicht verkürzen
  const nb = mol.getAllBonds()
  const lens: number[] = []
  for (let i = 0; i < nb; i++) {
    const a = mol.getBondAtom(0, i)
    const b = mol.getBondAtom(1, i)
    lens.push(Math.hypot(mol.getAtomX(a) - mol.getAtomX(b), mol.getAtomY(a) - mol.getAtomY(b)))
  }
  lens.sort((p, q) => p - q)
  const med = nb ? lens[Math.floor(nb / 2)] : 1
  const s = bondLength / (med || 1)
  let cx = 0
  let cy = 0
  for (let i = 0; i < n; i++) {
    cx += mol.getAtomX(i)
    cy += mol.getAtomY(i)
  }
  cx /= n || 1
  cy /= n || 1
  const c = center ?? { x: 0, y: 0 }
  const ids: Id[] = []
  const atoms: Atom[] = []
  for (let i = 0; i < n; i++) {
    const id = uid('a')
    ids.push(id)
    const label = mol.getAtomLabel(i)
    const custom = mol.getAtomCustomLabel(i)
    const z = mol.getAtomicNo(i)
    const rad = mol.getAtomRadical(i)
    const atom: Atom = {
      id,
      x: c.x + (mol.getAtomX(i) - cx) * s,
      y: c.y + (mol.getAtomY(i) - cy) * s,
      element: z === 0 ? 'C' : label,
      charge: mol.getAtomCharge(i),
      radical: rad === M.cAtomRadicalStateD ? 1 : rad === M.cAtomRadicalStateT || rad === M.cAtomRadicalStateS ? 2 : 0,
      lonePairs: 0,
    }
    if (z === 0) atom.label = custom || 'R'
    else if (custom) atom.label = custom
    const mass = mol.getAtomMass(i)
    if (mass) atom.isotope = mass
    atoms.push(atom)
  }
  const bonds: Bond[] = []
  for (let i = 0; i < nb; i++) {
    const t = mol.getBondType(i)
    let type: BondType = 'single'
    const order = mol.getBondOrder(i)
    if (t === M.cBondTypeUp) type = 'wedge'
    else if (t === M.cBondTypeDown) type = 'hash'
    else if (t === M.cBondTypeCross) type = 'double'
    else if (order === 2) type = 'double'
    else if (order === 3) type = 'triple'
    else if (t === M.cBondTypeDelocalized) type = 'aromatic'
    // gekreuzte Doppelbindung = E/Z unbestimmt (z. B. SMILES ohne / \ an einer stereogenen Doppelbindung)
    const crossed = t === M.cBondTypeCross
    bonds.push({ id: uid('b'), a1: ids[mol.getBondAtom(0, i)], a2: ids[mol.getBondAtom(1, i)], type, doublePos: 'auto', ...(crossed ? { crossed: true } : {}) })
  }
  return { atoms, bonds }
}

/** Liest SMILES oder Molfile; wirft bei Fehlern */
/** Überlappende Molekülteile im OCL-Layout auseinanderdrehen (Symmetrie bleibt erhalten) */
export function declashMol(mol: OCL.Molecule, orig?: P2[]) {
  try {
    // Metallkomplexe: Liganden einzeln auslegen und um das Metall anordnen
    const metal = metalLayout(mol, orig)
    const n = mol.getAllAtoms()
    const pos = Array.from({ length: n }, (_, i) => ({ x: mol.getAtomX(i), y: mol.getAtomY(i) }))
    const bonds: [number, number][] = []
    for (let i = 0; i < mol.getAllBonds(); i++) bonds.push([mol.getBondAtom(0, i), mol.getBondAtom(1, i)])
    mol.ensureHelperArrays(M.cHelperSymmetrySimple)
    const rank = Array.from({ length: n }, (_, i) => mol.getSymmetryRank(i))
    // zuerst gestauchte Einzelringe und anellierte Ringsysteme wieder regelmäßig machen, dann Überlappungen auflösen
    const reg = regularizeRings(pos, bonds)
    const rings: number[][] = []
    const rc = mol.getRingSet()
    for (let r = 0; r < rc.getSize(); r++) rings.push([...rc.getRingAtoms(r)])
    const isMetal = Array.from({ length: n }, (_, i) => mol.isMetalAtom(i))
    const plain = pos.map((p) => ({ ...p }))
    const regSys = regularizeRingSystems(pos, bonds, rings, isMetal)
    let changed = declash(pos, bonds, rank) || reg || regSys || metal
    if (regSys) {
      // ob das neu gesetzte Ringsystem am Ende wirklich besser ist, zeigt erst das fertige Layout (danach aufgelöste
      // Überlappungen können Bindungen verlängern, z. B. Penicillin) → beide Wege rechnen, den besseren nehmen
      declash(plain, bonds, rank)
      if (layoutQuality(plain, bonds) < layoutQuality(pos, bonds) - 1e-9) for (let i = 0; i < n; i++) pos[i] = plain[i]
      changed = true
    }
    if (!changed) return
    for (let i = 0; i < n; i++) {
      mol.setAtomX(i, pos[i].x)
      mol.setAtomY(i, pos[i].y)
    }
  } catch {
    // Layout bleibt dann unverändert
  }
}

/**
 * Metallzentrum mit mehreren Liganden (Ru(bpy)₃, Ir(ppy)₃, Pd(PPh₃)₄ …): OpenChemLib legt Chelatringe über das Metall
 * als ein großes Ringsystem aus, das sich überlappt. Stattdessen wird jeder Ligand für sich ausgelegt (Donoratome
 * einander zugewandt), mit den Donoren zum Metall gedreht und gleichmäßig um das Metall verteilt – mit so kurzen
 * Metall–Ligand-Bindungen wie möglich, ohne dass sich Liganden berühren. Die Reihenfolge der Liganden folgt der
 * bisherigen Zeichnung (orig). Nur für genau ein Metall mit ≥ 3 Bindungen; η-Liganden (Cp, Aren) bleiben unberührt.
 */
function metalLayout(mol: OCL.Molecule, orig?: P2[]): boolean {
  const n = mol.getAllAtoms()
  if (n < 4) return false
  const adj: number[][] = Array.from({ length: n }, () => [])
  const bondList: [number, number][] = []
  for (let b = 0; b < mol.getAllBonds(); b++) {
    const a1 = mol.getBondAtom(0, b)
    const a2 = mol.getBondAtom(1, b)
    adj[a1].push(a2)
    adj[a2].push(a1)
    bondList.push([a1, a2])
  }
  const metals = Array.from({ length: n }, (_, i) => i).filter((i) => mol.isMetalAtom(i) && adj[i].length >= 3)
  if (metals.length !== 1) return false
  const mc = metals[0]
  // Liganden = Zusammenhangskomponenten ohne das Metall
  const comp = new Int32Array(n).fill(-1)
  const ligands: number[][] = []
  for (const s of adj[mc]) {
    if (comp[s] >= 0) continue
    const k = ligands.length
    const atoms: number[] = []
    const st = [s]
    comp[s] = k
    while (st.length) {
      const u = st.pop()!
      atoms.push(u)
      for (const v of adj[u])
        if (v !== mc && comp[v] < 0) {
          comp[v] = k
          st.push(v)
        }
    }
    ligands.push(atoms.sort((a, b) => a - b))
  }
  if (ligands.length < 2) return false
  const donorsOf = ligands.map((lg) => lg.filter((a) => adj[mc].includes(a)))
  for (let k = 0; k < ligands.length; k++) {
    if (ligands[k].some((a) => mol.isMetalAtom(a))) return false
    // η-Bindung (benachbarte Donoren) oder sehr viele Donoren: nicht anfassen
    const ds = donorsOf[k]
    if (ds.length > 4 || ds.some((a) => adj[a].some((b) => b !== mc && ds.includes(b)))) return false
  }
  if (ligands.length < 3 && donorsOf.every((d) => d.length < 2)) return false
  // Bindungslänge der Zeichnung
  const P0 = Array.from({ length: n }, (_, i) => ({ x: mol.getAtomX(i), y: mol.getAtomY(i) }))
  const ll = bondList
    .filter(([a, b]) => a !== mc && b !== mc)
    .map(([a, b]) => Math.hypot(P0[a].x - P0[b].x, P0[a].y - P0[b].y))
    .sort((a, b) => a - b)
  const L = ll[ll.length >> 1] || 1
  mol.ensureHelperArrays(M.cHelperParities)

  // jeden Liganden zusammen mit dem Metall auslegen (so ergibt sich die Richtung der Metallbindung bzw. der Chelatring
  // von selbst); lokale Lage: Metall im Ursprung, Donor-Schwerpunkt auf der +x-Achse
  type Lig = { atoms: number[]; local: P2[]; donors: number[] }
  const ligs: Lig[] = []
  for (let k = 0; k < ligands.length; k++) {
    const atoms = ligands[k]
    const di = donorsOf[k].map((a) => atoms.indexOf(a))
    let P: P2[]
    let Mp: P2
    if (atoms.length === 1) {
      P = [{ x: L, y: 0 }]
      Mp = { x: 0, y: 0 }
    } else {
      const sub = new M(0, 0)
      const inc = Array.from({ length: n }, (_, i) => comp[i] === k || i === mc)
      mol.copyMoleculeByAtoms(sub, inc, true, null)
      sub.inventCoordinates()
      declashMol(sub)
      const sl: number[] = []
      for (let b = 0; b < sub.getAllBonds(); b++) {
        const a1 = sub.getBondAtom(0, b)
        const a2 = sub.getBondAtom(1, b)
        sl.push(Math.hypot(sub.getAtomX(a1) - sub.getAtomX(a2), sub.getAtomY(a1) - sub.getAtomY(a2)))
      }
      sl.sort((a, b) => a - b)
      const f = L / (sl[sl.length >> 1] || 1)
      // copyMoleculeByAtoms behält die Reihenfolge der Atome bei (das Metall ist eines davon)
      const subIdx = (a: number) => [...atoms, mc].sort((p, q) => p - q).indexOf(a)
      P = atoms.map((a) => ({ x: sub.getAtomX(subIdx(a)) * f, y: sub.getAtomY(subIdx(a)) * f }))
      Mp = { x: sub.getAtomX(subIdx(mc)) * f, y: sub.getAtomY(subIdx(mc)) * f }
    }
    const D = di.reduce((t, j) => ({ x: t.x + P[j].x / di.length, y: t.y + P[j].y / di.length }), { x: 0, y: 0 })
    const t0 = -Math.atan2(D.y - Mp.y, D.x - Mp.x)
    const c0 = Math.cos(t0)
    const s0 = Math.sin(t0)
    let local = P.map((q) => ({ x: (q.x - Mp.x) * c0 - (q.y - Mp.y) * s0, y: (q.x - Mp.x) * s0 + (q.y - Mp.y) * c0 }))
    // Händigkeit wie in der bisherigen Zeichnung (nur Liganden ohne Stereozentren dürfen gespiegelt werden)
    if (orig && di.length >= 2 && !atoms.some((a) => mol.getAtomParity(a) !== 0)) {
      const Do = di.reduce((t, j) => ({ x: t.x + orig[atoms[j]].x / di.length, y: t.y + orig[atoms[j]].y / di.length }), { x: 0, y: 0 })
      const vo = { x: Do.x - orig[mc].x, y: Do.y - orig[mc].y }
      const fo = { x: orig[atoms[di[0]]].x - Do.x, y: orig[atoms[di[0]]].y - Do.y }
      const sideOrig = Math.sign(vo.x * fo.y - vo.y * fo.x)
      const sideNow = Math.sign(local[di[0]].y)
      if (sideOrig !== 0 && sideNow !== 0 && sideNow !== sideOrig) local = local.map((q) => ({ x: q.x, y: -q.y }))
    }
    ligs.push({ atoms, local, donors: di })
  }

  // Reihenfolge rund um das Metall wie bisher gezeichnet (ohne Vorlage: wie von OpenChemLib gesetzt)
  const ref = orig ?? P0
  const angle0 = ligs.map((lg) => {
    const D = lg.donors.reduce((t, j) => ({ x: t.x + ref[lg.atoms[j]].x, y: t.y + ref[lg.atoms[j]].y }), { x: 0, y: 0 })
    return Math.atan2(D.y / lg.donors.length - ref[mc].y, D.x / lg.donors.length - ref[mc].x)
  })
  const order = ligs.map((_l, i) => i).sort((a, b) => angle0[a] - angle0[b])
  const mpos = P0[mc]
  const isDonor = new Set(donorsOf.flat())

  // Güte einer Anordnung: zu nahe Atome verschiedener Liganden und sich kreuzende Bindungen
  const badness = (out: P2[]) => {
    let bad = 0
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        if (i === mc || j === mc || comp[i] === comp[j]) continue
        const d = Math.hypot(out[i].x - out[j].x, out[i].y - out[j].y)
        // Beschriftungen (alles außer C) brauchen mehr Platz als Linienenden
        const labeled = mol.getAtomicNo(i) !== 6 && mol.getAtomicNo(j) !== 6
        const dm = L * (labeled ? 1.05 : isDonor.has(i) && isDonor.has(j) ? 0.55 : 0.75)
        if (d < dm) bad += (dm - d) / L
      }
    const o = (p: P2, q: P2, w: P2) => (q.x - p.x) * (w.y - p.y) - (q.y - p.y) * (w.x - p.x)
    for (let i = 0; i < bondList.length; i++)
      for (let j = i + 1; j < bondList.length; j++) {
        const [a, b] = bondList[i]
        const [c, d] = bondList[j]
        if (a === c || a === d || b === c || b === d) continue
        if (o(out[a], out[b], out[c]) * o(out[a], out[b], out[d]) < 0 && o(out[c], out[d], out[a]) * o(out[c], out[d], out[b]) < 0) bad += 1
      }
    return bad
  }

  // Liganden um t nach außen gerückt (Metall–Donor-Bindungen werden länger) und gleichmäßig verteilt; einzähnige
  // Liganden zusätzlich alle gleich um ihr Donoratom gedreht (phi, Windrad – z. B. PPh₃ in Pd(PPh₃)₄)
  const spun = (phi: number) =>
    ligs.map((lg) => {
      if (lg.donors.length !== 1 || !phi) return lg.local
      const d = lg.local[lg.donors[0]]
      const c = Math.cos(phi)
      const s2 = Math.sin(phi)
      return lg.local.map((q) => ({ x: d.x + (q.x - d.x) * c - (q.y - d.y) * s2, y: d.y + (q.x - d.x) * s2 + (q.y - d.y) * c }))
    })
  const place = (t: number, phi: number) => {
    const locs = spun(phi)
    const half = ligs.map((lg, i) => Math.max(0, ...lg.donors.map((j) => Math.abs(Math.atan2(locs[i][j].y, locs[i][j].x + t)))))
    // freier Winkel nach Größe verteilt (PPh₃ bekommt mehr Platz als Cl); gleich große Liganden gleichmäßig
    const free = 2 * Math.PI - half.reduce((s2, h) => s2 + 2 * h, 0)
    if (free < 0) return null
    const w = ligs.map((lg) => Math.sqrt(lg.atoms.length))
    const wSum = w.reduce((a, b) => a + b, 0)
    const share = w.map((x) => (free * x) / wSum)
    const out = P0.map((q) => ({ ...q }))
    let th = angle0[order[0]] - half[order[0]] - share[order[0]] / 2
    for (const i of order) {
      const lg = ligs[i]
      const ang = th + share[i] / 2 + half[i]
      th += 2 * half[i] + share[i]
      const c = Math.cos(ang)
      const s2 = Math.sin(ang)
      lg.atoms.forEach((a, j) => {
        const x = locs[i][j].x + t
        const y = locs[i][j].y
        out[a] = { x: mpos.x + x * c - y * s2, y: mpos.y + x * s2 + y * c }
      })
    }
    return { out, bad: badness(out) }
  }
  const PHIS = ligs.some((lg) => lg.donors.length === 1 && lg.atoms.length > 1) ? [0, 15, -15, 30, -30, 45, -45].map((d) => (d * Math.PI) / 180) : [0]
  let best: { out: P2[]; bad: number } | null = null
  search: for (let t = 0; t <= L * 2.51; t += L * 0.05)
    for (const phi of PHIS) {
      const res = place(t, phi)
      if (!res) continue
      if (!best || res.bad < best.bad - 1e-9) best = res
      if (res.bad < 1e-9) break search
    }
  // nur übernehmen, wenn es besser ist als das bisherige Layout
  if (best && best.bad >= badness(P0) - 1e-9 && badness(P0) < 1e-9) best = null
  if (best && best.bad > badness(P0)) best = null
  if (!best) return false
  for (let i = 0; i < n; i++) {
    mol.setAtomX(i, best.out[i].x)
    mol.setAtomY(i, best.out[i].y)
  }
  return true
}

export function parseStructure(text: string): OCL.Molecule {
  const t = text.trim()
  if (!t) throw new Error('Kein Text eingegeben')
  if (t.includes('M  END') || t.includes('V2000') || t.includes('V3000')) {
    let mol: OCL.Molecule
    try {
      mol = M.fromMolfile(text)
    } catch {
      throw new Error('Das Molfile ist beschädigt oder unvollständig')
    }
    if (!mol.getAllAtoms()) throw new Error('Das Molfile enthält keine Atome')
    return mol
  }
  // sehr große Strukturen: Layout und Entwirren brauchen dann viele Sekunden (die Oberfläche stünde still)
  const atomCount = (t.match(/Cl|Br|\[[^\]]*\]|[BCNOPSFIbcnops*]/g) ?? []).length
  if (atomCount > MAX_SMILES_ATOMS) throw new Error(`Die Struktur ist zu groß (etwa ${atomCount} Atome, höchstens ${MAX_SMILES_ATOMS}).`)
  // Platzhalter * bzw. [*] (Rest, Anknüpfungspunkt): OpenChemLib läse daraus Kohlenstoff – vorher als Francium
  // markieren und danach zum Rest R machen (Francium selbst kommt in Strukturformeln praktisch nicht vor)
  const wild = /\*/.test(t) && !/Fr/.test(t)
  const smi = wild ? t.replace(/\[\*[^\]]*\]|\*/g, '[Fr]') : t
  // SMILES: OpenChemLib erzeugt die Koordinaten selbst – Überlappungen danach auflösen
  let mol: OCL.Molecule
  try {
    mol = M.fromSmiles(smi)
  } catch (e) {
    throw new Error(smilesErrorText(t, e instanceof Error ? e.message : String(e)))
  }
  if (!mol.getAllAtoms()) throw new Error('Kein gültiges SMILES')
  if (wild)
    for (let i = 0; i < mol.getAllAtoms(); i++)
      if (mol.getAtomicNo(i) === 87) {
        mol.setAtomicNo(i, 0)
        mol.setAtomCustomLabel(i, 'R')
      }
  declashMol(mol)
  return mol
}

/** Obergrenze für eingefügte SMILES (Atome) */
const MAX_SMILES_ATOMS = 2000

/** Verständliche Meldung statt der technischen Parser-Meldung */
function smilesErrorText(t: string, msg: string): string {
  const pos = /position:?\s*(\d+)/i.exec(msg)
  const at = pos ? ` (Zeichen ${+pos[1] + 1})` : ''
  if (/unknown element/i.test(msg)) {
    if (/^[A-Za-zÄÖÜäöüß\s,-]{3,}$/.test(t) && /[a-zäöüß]{3}/.test(t))
      return `„${t}“ ist kein SMILES – Namen bitte in die Namenssuche (Import-Dialog, PubChem) eingeben.`
    return `Unbekanntes Element im SMILES${at}`
  }
  const ring = /ring closure:?\s*(\d+)/i.exec(msg)
  if (ring) return `Ring ${ring[1]} wird im SMILES nicht geschlossen`
  if (/closing '\)'/i.test(msg)) return `Schließende Klammer ohne öffnende${at}`
  if (/bracket|\]/i.test(msg)) return `Eckige Klammer im SMILES nicht korrekt${at}`
  return `Kein gültiges SMILES${at}`
}

/** Bereinigt die 2D-Koordinaten eines Fragments (OCL-Layout), Rückgabe: neue Positionen */
export function cleanCoordinates(doc: Doc, atomIds: Id[]): Map<Id, { x: number; y: number }> {
  const { mol, map } = docToOCL(doc, atomIds)
  // bisherige Lage (für die Reihenfolge der Liganden an Metallzentren)
  const orig: P2[] = Array.from({ length: mol.getAllAtoms() }, () => ({ x: 0, y: 0 }))
  for (const id of atomIds) {
    const k = map.get(id)
    if (k !== undefined) orig[k] = { x: doc.atoms[id].x, y: doc.atoms[id].y }
  }
  mol.inventCoordinates()
  declashMol(mol, orig)
  const frag = oclToFragment(mol, doc.style.bondLength)
  // Schwerpunkt der Originalpositionen beibehalten
  let ox = 0
  let oy = 0
  for (const id of atomIds) {
    ox += doc.atoms[id].x
    oy += doc.atoms[id].y
  }
  ox /= atomIds.length
  oy /= atomIds.length
  const out = new Map<Id, { x: number; y: number }>()
  for (const id of atomIds) {
    const k = map.get(id)!
    const fa = frag.atoms[k]
    out.set(id, { x: ox + fa.x, y: oy + fa.y })
  }
  return out
}

// ---------- Analyse ----------

export interface Analysis {
  formula: string
  mw: number
  exact: number
  composition: { el: string; pct: number }[]
  logP?: number
  tpsa?: number
  donors?: number
  acceptors?: number
  rotatable?: number
  stereo?: number
  smiles: string
  fragments: number
  generic: number
  unknownLabels: string[]
  /** Nettoladung (Summe der Formalladungen) */
  charge: number
  /** Atome je Element mit natürlicher Isotopenverteilung bzw. markierte Atome (für das Isotopenmuster) */
  natural: Record<string, number>
  labeled: { el: string; nominal: number }[]
}

export function analyze(doc: Doc, atomIds?: Id[], opts?: { star?: Set<Id> }): Analysis | null {
  const ids = atomIds ?? Object.keys(doc.atoms)
  if (!ids.length) return null
  const { mol, generic, unknownLabels } = docToOCL(doc, ids, opts)
  const mf = mol.getMolecularFormula()
  const counts = parseFormula(mf.formula)
  let total = 0
  for (const [el, n] of counts) total += (ATOMIC_WEIGHT[el] ?? 0) * n
  const composition = [...counts].map(([el, n]) => ({ el, pct: total ? ((ATOMIC_WEIGHT[el] ?? 0) * n * 100) / total : 0 }))
  const res: Analysis = {
    formula: hillFormula(mf.formula),
    mw: mf.relativeWeight,
    exact: mf.absoluteWeight,
    composition,
    smiles: mol.toIsomericSmiles().replace(/\[\?\]/g, '*'),
    fragments: countFragments(doc, ids),
    generic,
    unknownLabels,
    charge: 0,
    natural: {},
    labeled: [],
  }
  for (let i = 0; i < mol.getAllAtoms(); i++) {
    res.charge += mol.getAtomCharge(i)
    const el = mol.getAtomLabel(i)
    const mass = mol.getAtomMass(i)
    if (mass) res.labeled.push({ el, nominal: mass })
    else res.natural[el] = (res.natural[el] ?? 0) + 1
    const h = mol.getImplicitHydrogens(i)
    if (h) res.natural.H = (res.natural.H ?? 0) + h
  }
  try {
    const p = new OCL.MoleculeProperties(mol)
    res.logP = p.logP
    res.tpsa = p.polarSurfaceArea
    res.donors = p.donorCount
    res.acceptors = p.acceptorCount
    res.rotatable = p.rotatableBondCount
    res.stereo = p.stereoCenterCount
  } catch {
    // Eigenschaften nicht berechenbar (z. B. bei Platzhaltern)
  }
  return res
}

function countFragments(doc: Doc, ids: Id[]): number {
  const g = buildGraph(doc)
  const set = new Set(ids)
  const seen = new Set<Id>()
  let n = 0
  for (const id of ids) {
    if (seen.has(id)) continue
    n++
    const st = [id]
    seen.add(id)
    while (st.length) {
      const c = st.pop()!
      for (const nb of g.adj.get(c) ?? []) {
        if (!set.has(nb.other.id) || seen.has(nb.other.id)) continue
        seen.add(nb.other.id)
        st.push(nb.other.id)
      }
    }
  }
  return n
}

/** Summenformel in Hill-Ordnung: C, H, dann alphabetisch; ohne Kohlenstoff alles alphabetisch (OpenChemLib sortiert anders) */
export function hillFormula(f: string): string {
  const counts = parseFormula(f)
  const els = [...counts.keys()].sort()
  const order = counts.has('C') ? ['C', ...(counts.has('H') ? ['H'] : []), ...els.filter((e) => e !== 'C' && e !== 'H')] : els
  return order.map((e) => e + (counts.get(e)! > 1 ? counts.get(e) : '')).join('')
}

export function parseFormula(f: string): Map<string, number> {
  const out = new Map<string, number>()
  const re = /([A-Z][a-z]?)(\d*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(f))) {
    const n = m[2] ? parseInt(m[2], 10) : 1
    out.set(m[1], (out.get(m[1]) ?? 0) + n)
  }
  return out
}

// ---------- PubChem (online) ----------

const PUG = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound'

/**
 * Anfrage an PubChem/Wikidata: höchstens 4 je Sekunde und 2 gleichzeitig (PubChem antwortet sonst mit 503
 * „ServerBusy“), bei Überlastung bis zu dreimal mit wachsender Pause nachfassen. Ohne Netz kommt eine
 * verständliche Meldung.
 */
let nextSlot = 0
let running = 0
const waiting: (() => void)[] = []
async function netFetch(url: string, init?: RequestInit): Promise<Response> {
  if (running >= 2) await new Promise<void>((r) => waiting.push(r))
  running++
  try {
    for (let attempt = 0; ; attempt++) {
      const now = Date.now()
      const wait = Math.max(0, nextSlot - now)
      nextSlot = Math.max(now, nextSlot) + 250
      if (wait) await new Promise((r) => setTimeout(r, wait))
      let r: Response
      try {
        // beim Nachfassen am Cache vorbei: PubChem erlaubt das Zwischenspeichern auch seiner „überlastet“-Antwort,
        // sonst käme dieselbe Fehlermeldung immer wieder aus dem Cache
        r = await fetch(url, attempt ? { ...init, cache: 'reload' } : init)
      } catch {
        throw new Error('Der Online-Dienst (PubChem bzw. Wikidata) ist nicht erreichbar – besteht eine Internetverbindung?')
      }
      if ((r.status === 503 || r.status === 429) && attempt < 3) {
        await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)))
        continue
      }
      return r
    }
  } finally {
    running--
    waiting.shift()?.()
  }
}

/** Fehlermeldung für eine fehlgeschlagene Antwort: „nicht gefunden“ nur bei 404/400, sonst Überlastung */
function pubchemError(r: Response, notFound: string): Error {
  if (r.status === 404 || r.status === 400) return new Error(notFound)
  return new Error('PubChem ist gerade überlastet oder nicht erreichbar – bitte gleich noch einmal versuchen.')
}

/**
 * Name → Struktur über PubChem: SMILES und, wenn abrufbar, PubChems eigene 2D-Darstellung als Molfile (ohne
 * explizite H). Die ist bei verbrückten Naturstoffen (Morphin, Strychnin …) die übliche Lehrbuch-Darstellung –
 * deutlich besser als ein neu berechnetes Layout. Weicht sie vom SMILES ab, wird sie verworfen.
 */
/** CAS-Nummer in einer Eingabe („50-78-2“, „CAS 50-78-2“, „CAS-Nr.: 50-78-2“) – sonst null */
export function casInInput(s: string): string | null {
  const m = /^\s*(?:CAS(?:[\s-]*(?:Nr|No|RN)\.?)?\s*:?\s*)?(\d{2,7}-\d{2}-\d)\s*$/i.exec(s)
  return m ? m[1] : null
}

/**
 * Name oder CAS-Nummer → Struktur (PubChem). CAS-Nummern werden vorher auf ihre Prüfziffer geprüft – ein
 * Tippfehler ergibt so eine klare Meldung statt „nicht gefunden“. (PubChem führt CAS-Nummern als Synonyme; die
 * Namenssuche findet sie direkt.)
 */
export async function nameToStructure(input: string): Promise<{ smiles: string; molfile?: string; title?: string }> {
  const cas = casInInput(input)
  if (cas && !casValid(cas)) throw new Error(`Ungültige CAS-Nummer ${cas}: Die Prüfziffer passt nicht – bitte die Nummer prüfen.`)
  const name = cas ?? input.trim()
  if (!name) throw new Error('Bitte einen Namen oder eine CAS-Nummer eingeben.')
  const [p, mf] = await Promise.all([
    nameToSmiles(name).catch((e) => {
      if (cas && /Kein Eintrag/.test(String(e?.message))) throw new Error(`Keine Verbindung mit der CAS-Nummer ${cas} in PubChem gefunden.`)
      throw e
    }),
    pubchem2D(name).catch(() => null),
  ])
  if (!mf) return p
  try {
    const same = M.fromMolfile(mf).toIsomericSmiles() === M.fromSmiles(p.smiles).toIsomericSmiles()
    return same ? { ...p, molfile: mf } : p
  } catch {
    return p
  }
}

async function pubchem2D(name: string): Promise<string | null> {
  const r = await netFetch(`${PUG}/name/${encodeURIComponent(name)}/SDF?record_type=2d`)
  if (!r.ok) return null
  const mol = M.fromMolfile(await r.text())
  if (!mol.getAllAtoms()) return null
  mol.removeExplicitHydrogens()
  return mol.toMolfile()
}

export async function nameToSmiles(name: string): Promise<{ smiles: string; title?: string }> {
  const r = await netFetch(`${PUG}/name/${encodeURIComponent(name)}/property/SMILES,IUPACName/JSON`)
  if (!r.ok) throw pubchemError(r, 'Kein Eintrag in PubChem gefunden (Namen bitte auf Englisch eingeben).')
  const j = await r.json()
  const p = j?.PropertyTable?.Properties?.[0]
  const smiles = p?.SMILES ?? p?.IsomericSMILES ?? p?.CanonicalSMILES
  if (!smiles) throw new Error('PubChem lieferte keine Struktur.')
  return { smiles, title: p?.IUPACName }
}

export async function smilesToName(smiles: string): Promise<{ iupac?: string; title?: string; cid?: number }> {
  const body = new URLSearchParams({ smiles })
  const r = await netFetch(`${PUG}/smiles/property/IUPACName,Title/JSON`, { method: 'POST', body })
  if (!r.ok) throw pubchemError(r, 'Struktur in PubChem nicht gefunden.')
  const j = await r.json()
  const p = j?.PropertyTable?.Properties?.[0]
  if (!p || (!p.IUPACName && !p.Title)) throw new Error('Struktur in PubChem nicht gefunden.')
  return { iupac: p.IUPACName, title: p.Title, cid: p.CID }
}

/** Formal gültige CAS-Nummer (Format und Prüfziffer) */
export function casValid(cas: string): boolean {
  const m = /^(\d{2,7})-(\d{2})-(\d)$/.exec(cas.trim())
  if (!m) return false
  const digits = (m[1] + m[2]).split('').reverse()
  const sum = digits.reduce((s, d, i) => s + Number(d) * (i + 1), 0)
  return sum % 10 === Number(m[3])
}

/**
 * CAS-Nummer aus den PubChem-Synonymen (erste formal gültige; PubChem führt die übliche Nummer in der Regel zuerst).
 * Suche per SMILES oder Name; null = nichts gefunden.
 */
export async function pubchemCas(q: { smiles?: string; name?: string }): Promise<string | null> {
  const r = q.smiles
    ? await netFetch(`${PUG}/smiles/synonyms/JSON`, { method: 'POST', body: new URLSearchParams({ smiles: q.smiles }) })
    : await netFetch(`${PUG}/name/${encodeURIComponent(q.name ?? '')}/synonyms/JSON`)
  if (r.status === 404 || r.status === 400) return null
  if (!r.ok) throw new Error('PubChem ist gerade nicht erreichbar.')
  const syn: unknown = (await r.json())?.InformationList?.Information?.[0]?.Synonym
  if (!Array.isArray(syn)) return null
  return (syn.find((x) => typeof x === 'string' && casValid(x)) as string | undefined) ?? null
}

/** PubChem-CID zu einem Namen (null = unbekannt) */
export async function pubchemCidByName(name: string): Promise<number | null> {
  const r = await netFetch(`${PUG}/name/${encodeURIComponent(name)}/cids/JSON`)
  if (r.status === 404 || r.status === 400) return null
  if (!r.ok) throw new Error('PubChem ist gerade nicht erreichbar.')
  const cid = (await r.json())?.IdentifierList?.CID?.[0]
  return typeof cid === 'number' && cid > 0 ? cid : null
}

/** CAS-Nummer zu einer CID (erste formal gültige aus den Synonymen) */
export async function pubchemCasByCid(cid: number): Promise<string | null> {
  const r = await netFetch(`${PUG}/cid/${cid}/synonyms/JSON`)
  if (r.status === 404 || r.status === 400) return null
  if (!r.ok) throw new Error('PubChem ist gerade nicht erreichbar.')
  const syn: unknown = (await r.json())?.InformationList?.Information?.[0]?.Synonym
  if (!Array.isArray(syn)) return null
  return (syn.find((x) => typeof x === 'string' && casValid(x)) as string | undefined) ?? null
}

/**
 * GHS-Piktogramme (GHS01 … GHS09) laut PubChem. PubChem sammelt mehrere Einstufungen, die sich unterscheiden können;
 * genommen wird die harmonisierte EU-Einstufung (CLP-Verordnung 1272/2008), sonst die erste ECHA-Meldung, sonst die
 * erste vorhandene Quelle. codes = [] heißt: Quelle vorhanden, aber keine Piktogramme; null = keine Angaben.
 */
export async function pubchemGhs(cid: number): Promise<{ codes: string[]; source: string } | null> {
  const r = await netFetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON?heading=GHS%20Classification`)
  if (r.status === 404 || r.status === 400) return null
  if (!r.ok) throw new Error('PubChem ist gerade nicht erreichbar.')
  const j = await r.json()
  const refs = new Map<number, string>(((j?.Record?.Reference ?? []) as { ReferenceNumber: number; SourceName: string }[]).map((x) => [x.ReferenceNumber, x.SourceName]))
  const found: { source: string; codes: string[] }[] = []
  const walk = (o: unknown) => {
    if (!o || typeof o !== 'object') return
    const rec = o as { Name?: string; ReferenceNumber?: number; Value?: unknown }
    if (rec.Name === 'Pictogram(s)') {
      const codes = [...new Set(JSON.stringify(rec.Value ?? '').match(/GHS0[1-9]/g) ?? [])].sort()
      found.push({ source: refs.get(rec.ReferenceNumber ?? -1) ?? 'PubChem', codes })
    }
    for (const v of Object.values(o)) walk(v)
  }
  walk(j)
  if (!found.length) return null
  const pick = found.find((f) => /1272\/2008/.test(f.source)) ?? found.find((f) => /ECHA|European Chemicals Agency/i.test(f.source)) ?? found[0]
  const source = /1272\/2008/.test(pick.source) ? 'EU-Einstufung (CLP, Verordnung 1272/2008)' : /ECHA|European Chemicals Agency/i.test(pick.source) ? 'ECHA-Meldung' : pick.source
  return { codes: pick.codes, source }
}

/** Summenformel und Molmasse zu einer CID (für Stoffe, die nur als Name in der Ansatztabelle stehen, z. B. „MeI“) */
export async function pubchemFormula(cid: number): Promise<{ formula: string; mw: number } | null> {
  const r = await netFetch(`${PUG}/cid/${cid}/property/MolecularFormula,MolecularWeight/JSON`)
  if (r.status === 404 || r.status === 400) return null
  if (!r.ok) throw new Error('PubChem ist gerade nicht erreichbar.')
  const p = (await r.json())?.PropertyTable?.Properties?.[0]
  const mw = Number(p?.MolecularWeight)
  return typeof p?.MolecularFormula === 'string' && mw > 0 ? { formula: p.MolecularFormula, mw } : null
}

/** alle Texte eines PubChem-Abschnitts (PUG View, z. B. „Density“) */
async function pubchemStrings(cid: number, heading: string): Promise<string[]> {
  const r = await netFetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON?heading=${encodeURIComponent(heading)}`)
  if (r.status === 404 || r.status === 400) return []
  if (!r.ok) throw new Error('PubChem ist gerade nicht erreichbar.')
  const out: string[] = []
  const walk = (o: unknown) => {
    if (!o || typeof o !== 'object') return
    const s = (o as { String?: unknown }).String
    if (typeof s === 'string') out.push(s)
    for (const v of Object.values(o)) walk(v)
  }
  walk((await r.json())?.Record)
  return out
}

/**
 * Flüssig bei Raumtemperatur? Aus den Beschreibungen („Physical Description“): je Text zählt der zuerst genannte
 * Zustand; Lösungen und Listen aus Industriemeldungen („Liquid; Gas Vapor; CBI …“) zählen nicht. Flüssig nur bei
 * klarer Mehrheit (mind. zwei Texte).
 */
export function liquidFromDescriptions(texts: string[]): boolean {
  let liquid = 0
  let other = 0
  for (const t of texts) {
    if (/solution|aqueous|CBI|;\s*(liquid|solid|gas)/i.test(t)) continue
    const m = /\b(liquid|oil|solid|crystal|crystals|crystalline|powder|needles|flakes|prisms|plates|gas|granules)\b/i.exec(t)
    if (!m) continue
    if (/^(liquid|oil)$/i.test(m[1])) liquid++
    else other++
  }
  return liquid >= 2 && liquid > other * 2
}

/**
 * Dichte (g/mL) aus den PubChem-Angaben („Density“): Zahlen am Textanfang (auch „Relative density (water = 1): …“),
 * ohne Gas-/Dampf-/Lösungsdichten; der Median gleicht Ausreißer aus. null = nichts Brauchbares.
 */
export function densityFromTexts(texts: string[]): number | null {
  const vals: number[] = []
  for (const t of texts) {
    if (/g\/L|air|vapou?r|gas|solution|aqueous|bulk/i.test(t)) continue
    const m = /^\s*(?:Sp\.? ?gr\.?\s*=?\s*|Relative density \(water ?= ?1\):?\s*|Density:?\s*)?(\d+(?:\.\d+)?)(?![\d.])/i.exec(t)
    if (!m) continue
    const v = Number(m[1])
    if (v >= 0.4 && v <= 25) vals.push(v)
  }
  if (!vals.length) return null
  vals.sort((a, b) => a - b)
  const med = vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2
  return Math.round(med * 1000) / 1000
}

/** Dichte eines bei Raumtemperatur flüssigen Stoffs laut PubChem (null = fest/gasförmig/unbekannt) */
export async function pubchemLiquidDensity(cid: number): Promise<number | null> {
  if (!liquidFromDescriptions(await pubchemStrings(cid, 'Physical Description'))) return null
  return densityFromTexts(await pubchemStrings(cid, 'Density'))
}

/** PubChem-Eintrag zur Struktur: CID, InChIKey, Titel – null, wenn es keinen gibt */
export async function pubchemLookup(smiles: string): Promise<{ cid: number; inchikey?: string; title?: string } | null> {
  const body = new URLSearchParams({ smiles })
  const r = await netFetch(`${PUG}/smiles/property/InChIKey,Title/JSON`, { method: 'POST', body })
  if (r.status === 404 || r.status === 400) return null
  if (!r.ok) throw new Error('PubChem ist gerade nicht erreichbar.')
  const p = (await r.json())?.PropertyTable?.Properties?.[0]
  if (!p?.CID) return null
  return { cid: p.CID, inchikey: p.InChIKey, title: p.Title }
}

/**
 * Englischer Wikipedia-Artikel zur Struktur – über Wikidata (PubChem-CID bzw. InChIKey),
 * damit nur wirklich passende Artikel gefunden werden. null = kein Artikel.
 */
export async function wikipediaLookup(smiles: string): Promise<{ url: string; title?: string } | null> {
  const pc = await pubchemLookup(smiles)
  if (!pc) return null
  const conds = [`{ ?item wdt:P662 "${pc.cid}" }`]
  if (pc.inchikey && /^[A-Z-]+$/.test(pc.inchikey)) conds.push(`{ ?item wdt:P235 "${pc.inchikey}" }`)
  const q = `SELECT ?article WHERE { ${conds.join(' UNION ')} ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . } LIMIT 1`
  const r = await netFetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, { headers: { Accept: 'application/sparql-results+json' } })
  if (!r.ok) throw new Error('Wikidata/Wikipedia ist gerade nicht erreichbar.')
  const url = (await r.json())?.results?.bindings?.[0]?.article?.value as string | undefined
  return url ? { url, title: pc.title } : null
}

export type CipLabel = 'R' | 'S' | '?'

const cipCache = new WeakMap<Doc, Map<Id, CipLabel>>()

/**
 * Stereozentren des Dokuments mit CIP-Deskriptor (R/S). „?“ = Stereozentrum ohne festgelegte Konfiguration
 * (keine Keil-/Strichbindung) oder nicht eindeutig bestimmbar.
 */
export function stereoCenters(doc: Doc): Map<Id, CipLabel> {
  const c = cipCache.get(doc)
  if (c) return c
  const res = new Map<Id, CipLabel>()
  try {
    const { mol, map } = docToOCL(doc)
    mol.ensureHelperArrays(M.cHelperCIP)
    for (const [id, k] of map) {
      const a = doc.atoms[id]
      if (!a || a.label || a.attach) continue
      if (!mol.isAtomStereoCenter(k)) continue
      // Metallzentren und an Metalle gebundene Donoratome: CIP aus einer 2D-Zeichnung nicht sinnvoll („?“ überall)
      if (mol.isMetalAtom(k)) continue
      let metalNb = false
      for (let j = 0; j < mol.getAllConnAtoms(k); j++) if (mol.isMetalAtom(mol.getConnAtom(k, j))) metalNb = true
      if (metalNb) continue
      const p = mol.getAtomCIPParity(k)
      res.set(id, p === M.cAtomCIPParityRorM ? 'R' : p === M.cAtomCIPParitySorP ? 'S' : '?')
    }
  } catch {
    // Analyse optional – bei Fehlern keine Deskriptoren
  }
  cipCache.set(doc, res)
  return res
}

// ---------- Kürzel bilden (OMe, OTf, Bpin … aus ausgezeichneten Atomen zusammenfassen) ----------

/** Gruppen, die „Kürzel bilden“ erkennt (Phenyl & Co. bleiben gezeichnet) */
const CONTRACT_KEYS = [
  'OMe', 'OEt', 'OiPr', 'OtBu', 'OPh', 'OBn', 'OAc', 'OTf', 'OTs', 'OMs', 'OTMS', 'OTES', 'OTBS', 'OTIPS', 'OPiv',
  'Bpin', 'CO2Me', 'CO2Et', 'CO2tBu', 'NHBoc', 'NHCbz', 'NHAc', 'NMe2', 'NEt2', 'SMe', 'CF3', 'tBu', 'iPr',
  'TMS', 'TES', 'TBS', 'TIPS', 'Ts', 'Ms', 'Tf', 'Ac', 'NO2',
]

/**
 * Vergleichscode einer Gruppe nur aus Element, Ladung und Bindungsordnungen. Aus SMILES gelesene Klammeratome
 * ([Si], [N+]) tragen sonst Zusatzangaben im Code, die ein gezeichnetes Atom nicht hat (TMS, NO2 wurden nie erkannt).
 */
function bareCode(m: OCL.Molecule): string {
  const b = new M(m.getAllAtoms(), m.getAllBonds())
  for (let i = 0; i < m.getAllAtoms(); i++) {
    const k = b.addAtom(m.getAtomicNo(i))
    b.setAtomCharge(k, m.getAtomCharge(i))
  }
  for (let i = 0; i < m.getAllBonds(); i++) b.setBondOrder(b.addBond(m.getBondAtom(0, i), m.getBondAtom(1, i)), m.getBondOrder(i))
  return b.getIDCode()
}

let groupCodeMap: Map<string, string> | null = null
function groupCodes(): Map<string, string> {
  if (groupCodeMap) return groupCodeMap
  groupCodeMap = new Map()
  for (const key of CONTRACT_KEYS) {
    const ab = ABBREVIATIONS[key]
    if (!ab || ab.generic) continue
    try {
      // Anknüpfung wie beim Vergleich: Platzhalter-Atom (Ordnungszahl 0) am ersten Atom des Kürzels
      const m = M.fromSmiles(ab.smiles)
      const k = m.addAtom(0)
      m.addBond(k, 0)
      const code = bareCode(m)
      if (!groupCodeMap.has(code)) groupCodeMap.set(code, key)
    } catch {
      // Kürzel ohne gültiges SMILES überspringen
    }
  }
  return groupCodeMap
}

/**
 * Erkennt in den Atomen `ids` Gruppen, die als Kürzel geschrieben werden können. Ergebnis: Ankeratom (bleibt,
 * bekommt das Label), übrige Atome der Gruppe (werden gelöscht) und das Kürzel. Größere Gruppen haben Vorrang
 * (OTf statt Tf), Gruppen überschneiden sich nicht. Ist der Rest kleiner als die Gruppe (Neopentan = CH3–tBu),
 * kommt die Gruppe nur nachrangig zum Zug und nur, wenn der Rest gezeichnet bleibt (kein „tBu–OMe“).
 */
export function findContractibleGroups(doc: Doc, ids: Id[]): { anchor: Id; remove: Id[]; key: string }[] {
  const codes = groupCodes()
  const scope = new Set(ids.filter((id) => doc.atoms[id]))
  const g = buildGraph(doc)
  const found: { anchor: Id; remove: Id[]; key: string; size: number; rest: Id[] | null }[] = []
  for (const b of Object.values(doc.bonds)) {
    if (!scope.has(b.a1) || !scope.has(b.a2)) continue
    if (b.type !== 'single' && b.type !== 'wedge' && b.type !== 'hash' && b.type !== 'bold') continue
    for (const [core, anchor] of [
      [b.a1, b.a2],
      [b.a2, b.a1],
    ]) {
      // Seite hinter der Bindung (ohne die Bindung selbst); liegt die Bindung in einem Ring, erreicht man core wieder
      const side = new Set([anchor])
      const st = [anchor]
      let ring = false
      while (st.length && side.size <= 26) {
        const u = st.pop()!
        for (const nb of g.adj.get(u) ?? []) {
          if (u === anchor && nb.other.id === core) continue
          if (nb.other.id === core) {
            ring = true
            break
          }
          if (side.has(nb.other.id)) continue
          side.add(nb.other.id)
          st.push(nb.other.id)
        }
        if (ring) break
      }
      if (ring || side.size > 25) continue
      const sideIds = [...side]
      if (sideIds.some((id) => !scope.has(id) || doc.atoms[id].label || doc.atoms[id].attach)) continue
      // der Rest des Moleküls muss größer sein als die Gruppe
      const restIds: Id[] = []
      {
        const seen = new Set([core])
        const s2 = [core]
        while (s2.length) {
          const u = s2.pop()!
          restIds.push(u)
          for (const nb of g.adj.get(u) ?? []) if (!seen.has(nb.other.id) && !side.has(nb.other.id)) {
            seen.add(nb.other.id)
            s2.push(nb.other.id)
          }
        }
      }
      const minor = restIds.length < Math.max(2, sideIds.length)
      let code = ''
      try {
        const { mol, map } = docToOCL(doc, sideIds)
        const k = mol.addAtom(0)
        mol.addBond(k, map.get(anchor)!)
        code = bareCode(mol)
      } catch {
        continue
      }
      const key = codes.get(code)
      if (key) found.push({ anchor, remove: sideIds.filter((id) => id !== anchor), key, size: sideIds.length, rest: minor ? restIds : null })
    }
  }
  found.sort((p, q) => Number(!!p.rest) - Number(!!q.rest) || q.size - p.size)
  const used = new Set<Id>()
  const out: { anchor: Id; remove: Id[]; key: string }[] = []
  for (const f of found) {
    if (used.has(f.anchor) || f.remove.some((id) => used.has(id))) continue
    if (f.rest?.some((id) => used.has(id))) continue
    used.add(f.anchor)
    for (const id of f.remove) used.add(id)
    // nachrangige Gruppe: der kleinere Rest bleibt gezeichnet
    for (const id of f.rest ?? []) used.add(id)
    out.push({ anchor: f.anchor, remove: f.remove, key: f.key })
  }
  return out
}
