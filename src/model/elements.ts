// Elementdaten: Symbole 1–118, Standard-Atommassen (IUPAC, gerundet) für gängige Elemente,
// typische Valenzen und Farben für die Anzeige.

export const SYMBOLS = [
  'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca',
  'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr',
  'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd',
  'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg',
  'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac', 'Th', 'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm',
  'Md', 'No', 'Lr', 'Rf', 'Db', 'Sg', 'Bh', 'Hs', 'Mt', 'Ds', 'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og',
]

export const SYMBOL_SET = new Set(SYMBOLS)

export function atomicNumber(sym: string): number {
  return SYMBOLS.indexOf(sym) + 1
}

/** Standard-Atommassen (g/mol) */
export const ATOMIC_WEIGHT: Record<string, number> = {
  H: 1.008, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998, Ne: 20.180,
  Na: 22.990, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.95, K: 39.098, Ca: 40.078,
  Sc: 44.956, Ti: 47.867, V: 50.942, Cr: 51.996, Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546,
  Zn: 65.38, Ga: 69.723, Ge: 72.630, As: 74.922, Se: 78.971, Br: 79.904, Kr: 83.798, Rb: 85.468, Sr: 87.62,
  Y: 88.906, Zr: 91.224, Nb: 92.906, Mo: 95.95, Ru: 101.07, Rh: 102.91, Pd: 106.42, Ag: 107.87, Cd: 112.41,
  In: 114.82, Sn: 118.71, Sb: 121.76, Te: 127.60, I: 126.90, Xe: 131.29, Cs: 132.91, Ba: 137.33, La: 138.91,
  Ce: 140.12, Hf: 178.49, Ta: 180.95, W: 183.84, Re: 186.21, Os: 190.23, Ir: 192.22, Pt: 195.08, Au: 196.97,
  Hg: 200.59, Tl: 204.38, Pb: 207.2, Bi: 208.98, U: 238.03,
}

/** Mögliche Valenzen (neutral) – die kleinste passende wird für implizite H verwendet */
const VALENCES: Record<string, number[]> = {
  H: [1], B: [3], C: [4], N: [3], O: [2], F: [1], Si: [4], P: [3, 5], S: [2, 4, 6], Cl: [1], Se: [2, 4, 6],
  Br: [1], I: [1, 3, 5], As: [3, 5], Ge: [4], Te: [2, 4, 6],
}

/** Elemente, an die implizite Wasserstoffe gezeichnet werden */
export function hasImplicitH(el: string): boolean {
  return el in VALENCES
}

export function implicitHCount(el: string, bondSum: number, charge: number, radical: number): number {
  const vals = VALENCES[el]
  if (!vals) return 0
  // Ladung verändert die effektive Valenz (isoelektronisch): N+ wie C, O+ wie N, C− wie N, …
  let adj = 0
  if (el === 'C' || el === 'Si' || el === 'Ge') adj = -Math.abs(charge)
  else if (el === 'B') adj = -charge
  else adj = charge
  const used = bondSum + radical
  for (const v of vals) {
    const eff = v + adj
    if (eff >= used) return Math.max(0, eff - used)
  }
  return 0
}

export function maxValence(el: string, charge: number): number {
  const vals = VALENCES[el]
  if (!vals) return 99
  let adj = 0
  if (el === 'C' || el === 'Si' || el === 'Ge') adj = -Math.abs(charge)
  else if (el === 'B') adj = -charge
  else adj = charge
  return vals[vals.length - 1] + adj
}

/** Farben im Stil gängiger Lehrbücher (optional, Standard ist schwarz) */
export const ELEMENT_COLOR: Record<string, string> = {
  N: '#2547d0',
  O: '#d42a2a',
  S: '#b8930a',
  P: '#d67a00',
  F: '#2d9b46',
  Cl: '#2d9b46',
  Br: '#a3341f',
  I: '#7a2fa0',
}

/** Position im Periodensystem (Zeile, Spalte), Lanthanoide/Actinoide in Zeilen 9/10 */
export function ptPosition(z: number): { row: number; col: number } {
  if (z === 1) return { row: 1, col: 1 }
  if (z === 2) return { row: 1, col: 18 }
  const periods = [
    [3, 10, 2],
    [11, 18, 3],
    [19, 36, 4],
    [37, 54, 5],
    [55, 86, 6],
    [87, 118, 7],
  ]
  for (const [start, end, row] of periods) {
    if (z < start || z > end) continue
    const i = z - start
    if (row <= 3) {
      if (i < 2) return { row, col: i + 1 }
      return { row, col: i + 11 }
    }
    if (row <= 5) return { row, col: i + 1 }
    // Perioden 6 und 7 mit f-Block
    if (i < 2) return { row, col: i + 1 }
    if (i < 17) return { row: row + 3, col: i + 1 } // La–Lu bzw. Ac–Lr
    return { row, col: i - 14 + 1 }
  }
  return { row: 1, col: 1 }
}

export type ElementCategory =
  | 'nonmetal'
  | 'noble'
  | 'alkali'
  | 'alkaline'
  | 'metalloid'
  | 'halogen'
  | 'transition'
  | 'post'
  | 'lanthanide'
  | 'actinide'

export function elementCategory(z: number): ElementCategory {
  const s = SYMBOLS[z - 1]
  if (['He', 'Ne', 'Ar', 'Kr', 'Xe', 'Rn', 'Og'].includes(s)) return 'noble'
  if (['F', 'Cl', 'Br', 'I', 'At', 'Ts'].includes(s)) return 'halogen'
  if (['H', 'C', 'N', 'O', 'P', 'S', 'Se'].includes(s)) return 'nonmetal'
  if (['Li', 'Na', 'K', 'Rb', 'Cs', 'Fr'].includes(s)) return 'alkali'
  if (['Be', 'Mg', 'Ca', 'Sr', 'Ba', 'Ra'].includes(s)) return 'alkaline'
  if (['B', 'Si', 'Ge', 'As', 'Sb', 'Te'].includes(s)) return 'metalloid'
  if (z >= 57 && z <= 71) return 'lanthanide'
  if (z >= 89 && z <= 103) return 'actinide'
  if (['Al', 'Ga', 'In', 'Sn', 'Tl', 'Pb', 'Bi', 'Po', 'Nh', 'Fl', 'Mc', 'Lv'].includes(s)) return 'post'
  return 'transition'
}
