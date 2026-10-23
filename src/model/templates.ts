// Vorlagenbibliothek. Strukturen als SMILES; Koordinaten erzeugt OpenChemLib.
// Sonderfall Sessel-Konformation: feste Koordinaten.
import type { Fragment } from './ocl'
import { cppFragment, pillarFragment } from './three'
import { uid } from './types'

export interface Template {
  name: string
  smiles?: string
  build?: (L: number) => Fragment
}

export interface TemplateGroup {
  name: string
  items: Template[]
}

function chair(L: number): Fragment {
  // Projektion eines idealen Sessels (Blick leicht von oben, etwas gedreht)
  const pts3d = Array.from({ length: 6 }, (_, k) => {
    const th = (k * Math.PI) / 3 + Math.PI / 12
    return { x: Math.cos(th), y: k % 2 === 0 ? 0.32 : -0.32, z: Math.sin(th) }
  })
  const tilt = (-18 * Math.PI) / 180
  const pts = pts3d.map((p) => ({ x: p.x, y: -(p.y * Math.cos(tilt) - p.z * Math.sin(tilt)) }))
  // auf Bindungslänge skalieren (mittlere projizierte Länge)
  let sum = 0
  for (let i = 0; i < 6; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % 6]
    sum += Math.hypot(a.x - b.x, a.y - b.y)
  }
  const s = (L * 1.15) / (sum / 6)
  const atoms = pts.map((p) => ({ id: uid('a'), x: p.x * s, y: p.y * s, element: 'C', charge: 0, radical: 0, lonePairs: 0 }))
  const bonds = atoms.map((a, i) => ({ id: uid('b'), a1: a.id, a2: atoms[(i + 1) % 6].id, type: 'single' as const, doublePos: 'auto' as const }))
  return { atoms, bonds }
}

// ---------- 3D-Ringe (Perspektive) ----------

interface Ring3D {
  atoms: Fragment['atoms']
  bonds: Fragment['bonds']
  ids: string[]
}

/** Ring in Perspektive: Ellipse, vordere Bindungen fett */
function ring3d(n: number, L: number, cx: number, cy: number, flat = 0.34): Ring3D {
  const R = L / (2 * Math.sin(Math.PI / n))
  const atoms = Array.from({ length: n }, (_, k) => {
    const th = Math.PI / 2 + (k * 2 * Math.PI) / n + (n % 2 === 0 ? Math.PI / n : 0)
    return { id: uid('a'), x: cx + R * 1.05 * Math.cos(th), y: cy + R * flat * Math.sin(th), element: 'C', charge: 0, radical: 0, lonePairs: 0 }
  })
  const bonds = atoms.map((a, i) => {
    const b = atoms[(i + 1) % n]
    const front = (a.y + b.y) / 2 > cy + 1e-6
    return { id: uid('b'), a1: a.id, a2: b.id, type: (front ? 'bold' : 'single') as 'bold' | 'single', doublePos: 'auto' as const }
  })
  return { atoms, bonds, ids: atoms.map((a) => a.id) }
}

function cp3d(L: number, circle: boolean): Fragment {
  const r = ring3d(5, L, 0, 0)
  return { atoms: r.atoms, bonds: r.bonds, circles: circle ? [r.ids] : [] }
}

function cpStar3d(L: number): Fragment {
  const r = ring3d(5, L, 0, 0)
  const atoms = [...r.atoms]
  const bonds = [...r.bonds]
  for (const a of r.atoms) {
    const len = Math.hypot(a.x, a.y * 1.6) || 1
    const m = { id: uid('a'), x: a.x + (a.x / len) * L * 0.85, y: a.y + ((a.y * 1.6) / len) * L * 0.85, element: 'C', charge: 0, radical: 0, lonePairs: 0 }
    atoms.push(m)
    bonds.push({ id: uid('b'), a1: a.id, a2: m.id, type: 'single', doublePos: 'auto' })
  }
  return { atoms, bonds, circles: [r.ids] }
}

function arene3d(L: number): Fragment {
  const r = ring3d(6, L, 0, 0)
  return { atoms: r.atoms, bonds: r.bonds, circles: [r.ids] }
}

function sandwich(L: number, metal: string, n: number): Fragment {
  const top = ring3d(n, L, 0, -L * 1.25)
  const bot = ring3d(n, L, 0, L * 1.25)
  const m = { id: uid('a'), x: 0, y: 0, element: metal, charge: 0, radical: 0, lonePairs: 0 }
  return { atoms: [...top.atoms, ...bot.atoms, m], bonds: [...top.bonds, ...bot.bonds], circles: [top.ids, bot.ids] }
}

export const TEMPLATE_GROUPS: TemplateGroup[] = [
  {
    name: 'Ringe',
    items: [
      { name: 'Cyclopropan', smiles: 'C1CC1' },
      { name: 'Cyclobutan', smiles: 'C1CCC1' },
      { name: 'Cyclopentan', smiles: 'C1CCCC1' },
      { name: 'Cyclohexan', smiles: 'C1CCCCC1' },
      { name: 'Cyclohexan (Sessel)', build: chair },
      { name: 'Cycloheptan', smiles: 'C1CCCCCC1' },
      { name: 'Cyclooctan', smiles: 'C1CCCCCCC1' },
      { name: 'Cyclohexen', smiles: 'C1CCC=CC1' },
      { name: 'Cyclopentadien', smiles: 'C1C=CC=C1' },
    ],
  },
  {
    name: 'Aromaten',
    items: [
      { name: 'Benzol', smiles: 'C1=CC=CC=C1' },
      { name: 'Naphthalin', smiles: 'C1=CC=C2C=CC=CC2=C1' },
      { name: 'Anthracen', smiles: 'C1=CC=C2C=C3C=CC=CC3=CC2=C1' },
      { name: 'Phenanthren', smiles: 'C1=CC=C2C(=C1)C=CC3=CC=CC=C32' },
      { name: 'Biphenyl', smiles: 'C1=CC=C(C=C1)C2=CC=CC=C2' },
      { name: 'Toluol', smiles: 'CC1=CC=CC=C1' },
      { name: 'Phenol', smiles: 'OC1=CC=CC=C1' },
      { name: 'Anilin', smiles: 'NC1=CC=CC=C1' },
    ],
  },
  {
    name: 'Heterocyclen',
    items: [
      { name: 'Pyridin', smiles: 'C1=CC=NC=C1' },
      { name: 'Pyrimidin', smiles: 'C1=CN=CN=C1' },
      { name: 'Pyrrol', smiles: 'C1=CNC=C1' },
      { name: 'Furan', smiles: 'C1=COC=C1' },
      { name: 'Thiophen', smiles: 'C1=CSC=C1' },
      { name: 'Imidazol', smiles: 'C1=CN=CN1' },
      { name: 'Oxazol', smiles: 'C1=COC=N1' },
      { name: 'Thiazol', smiles: 'C1=CSC=N1' },
      { name: 'Indol', smiles: 'C1=CC=C2C(=C1)C=CN2' },
      { name: 'Chinolin', smiles: 'C1=CC=C2C(=C1)C=CC=N2' },
      { name: 'Purin', smiles: 'C1=C2C(=NC=N1)N=CN2' },
      { name: 'Piperidin', smiles: 'C1CCNCC1' },
      { name: 'Piperazin', smiles: 'C1CNCCN1' },
      { name: 'Morpholin', smiles: 'C1COCCN1' },
      { name: 'Tetrahydrofuran', smiles: 'C1CCOC1' },
      { name: 'Tetrahydropyran', smiles: 'C1CCOCC1' },
      { name: 'Epoxid (Oxiran)', smiles: 'C1CO1' },
    ],
  },
  {
    name: 'Polycyclen',
    items: [
      { name: 'Norbornan', smiles: 'C1CC2CCC1C2' },
      { name: 'Decalin', smiles: 'C1CCC2CCCCC2C1' },
      { name: 'Adamantan', smiles: 'C1C2CC3CC1CC(C2)C3' },
      { name: 'Steroid-Grundgerüst', smiles: 'C1CCC2C(C1)CCC3C2CCC4CCCC34' },
      { name: 'Indan', smiles: 'C1CC2=CC=CC=C2C1' },
    ],
  },
  {
    name: 'Funktionelle Gruppen',
    items: [
      { name: 'Carbonsäure', smiles: 'CC(=O)O' },
      { name: 'Ester', smiles: 'CC(=O)OC' },
      { name: 'Amid', smiles: 'CC(=O)N' },
      { name: 'Aldehyd', smiles: 'CC=O' },
      { name: 'Keton', smiles: 'CC(C)=O' },
      { name: 'Säurechlorid', smiles: 'CC(=O)Cl' },
      { name: 'Anhydrid', smiles: 'CC(=O)OC(C)=O' },
      { name: 'Nitril', smiles: 'CC#N' },
      { name: 'Nitro', smiles: 'C[N+](=O)[O-]' },
      { name: 'Sulfonsäure', smiles: 'CS(=O)(=O)O' },
      { name: 'Imin', smiles: 'CC=NC' },
      { name: 'Enol', smiles: 'CC(O)=C' },
      { name: 'Enamin', smiles: 'CC(N(C)C)=C' },
      { name: 'Michael-Akzeptor', smiles: 'C=CC(C)=O' },
    ],
  },
  {
    name: '3D & Metallocene',
    items: [
      { name: 'Cp-Ring (3D)', build: (L) => cp3d(L, false) },
      { name: 'η⁵-Cp (3D, Kreis)', build: (L) => cp3d(L, true) },
      { name: 'Cp* (3D)', build: cpStar3d },
      { name: 'Benzol (3D, η⁶)', build: arene3d },
      { name: 'Ferrocen (3D)', build: (L) => sandwich(L, 'Fe', 5) },
      { name: 'Ruthenocen (3D)', build: (L) => sandwich(L, 'Ru', 5) },
      { name: 'Dibenzolchrom (3D)', build: (L) => sandwich(L, 'Cr', 6) },
      { name: 'Cyclohexan (Sessel)', build: chair },
    ],
  },
  {
    name: 'Cycloparaphenylene (3D)',
    items: [5, 6, 7, 8, 9, 10, 12].map((n) => ({ name: `[${n}]Cycloparaphenylen`, build: (L: number) => cppFragment(n, L) })),
  },
  {
    name: 'Pillararene (3D)',
    items: [5, 6, 7].map((n) => ({ name: `Pillar[${n}]aren (OMe)`, build: (L: number) => pillarFragment(n, L) })),
  },
  {
    name: 'Aminosäuren',
    items: [
      { name: 'Glycin', smiles: 'C(C(=O)O)N' },
      { name: 'L-Alanin', smiles: 'C[C@@H](C(=O)O)N' },
      { name: 'L-Valin', smiles: 'CC(C)[C@@H](C(=O)O)N' },
      { name: 'L-Leucin', smiles: 'CC(C)C[C@@H](C(=O)O)N' },
      { name: 'L-Isoleucin', smiles: 'CC[C@H](C)[C@@H](C(=O)O)N' },
      { name: 'L-Prolin', smiles: 'C1C[C@H](NC1)C(=O)O' },
      { name: 'L-Phenylalanin', smiles: 'C1=CC=C(C=C1)C[C@@H](C(=O)O)N' },
      { name: 'L-Tryptophan', smiles: 'C1=CC=C2C(=C1)C(=CN2)C[C@@H](C(=O)O)N' },
      { name: 'L-Serin', smiles: 'C([C@@H](C(=O)O)N)O' },
      { name: 'L-Threonin', smiles: 'C[C@H]([C@@H](C(=O)O)N)O' },
      { name: 'L-Cystein', smiles: 'C([C@@H](C(=O)O)N)S' },
      { name: 'L-Methionin', smiles: 'CSCC[C@@H](C(=O)O)N' },
      { name: 'L-Asparaginsäure', smiles: 'C([C@@H](C(=O)O)N)C(=O)O' },
      { name: 'L-Glutaminsäure', smiles: 'C(CC(=O)O)[C@@H](C(=O)O)N' },
      { name: 'L-Asparagin', smiles: 'C([C@@H](C(=O)O)N)C(=O)N' },
      { name: 'L-Glutamin', smiles: 'C(CC(=O)N)[C@@H](C(=O)O)N' },
      { name: 'L-Lysin', smiles: 'C(CCN)C[C@@H](C(=O)O)N' },
      { name: 'L-Arginin', smiles: 'C(C[C@@H](C(=O)O)N)CN=C(N)N' },
      { name: 'L-Histidin', smiles: 'C1=C(NC=N1)C[C@@H](C(=O)O)N' },
      { name: 'L-Tyrosin', smiles: 'C1=CC(=CC=C1C[C@@H](C(=O)O)N)O' },
    ],
  },
  {
    name: 'Nukleobasen & Zucker',
    items: [
      { name: 'Adenin', smiles: 'C1=NC2=NC=NC(=C2N1)N' },
      { name: 'Guanin', smiles: 'C1=NC2=C(N1)C(=O)NC(=N2)N' },
      { name: 'Cytosin', smiles: 'C1=C(NC(=O)N=C1)N' },
      { name: 'Thymin', smiles: 'CC1=CNC(=O)NC1=O' },
      { name: 'Uracil', smiles: 'C1=CNC(=O)NC1=O' },
      { name: 'β-D-Glucopyranose', smiles: 'C([C@@H]1[C@H]([C@@H]([C@H]([C@@H](O1)O)O)O)O)O' },
    ],
  },
  {
    name: 'Bekannte Moleküle',
    items: [
      { name: 'Aspirin', smiles: 'CC(=O)OC1=CC=CC=C1C(=O)O' },
      { name: 'Paracetamol', smiles: 'CC(=O)NC1=CC=C(C=C1)O' },
      { name: 'Ibuprofen', smiles: 'CC(C)CC1=CC=C(C=C1)C(C)C(=O)O' },
      { name: 'Koffein', smiles: 'CN1C=NC2=C1C(=O)N(C(=O)N2C)C' },
      { name: 'Nikotin', smiles: 'CN1CCC[C@H]1C2=CN=CC=C2' },
      { name: 'Menthol', smiles: 'CC(C)[C@@H]1CC[C@@H](C)C[C@H]1O' },
    ],
  },
]
