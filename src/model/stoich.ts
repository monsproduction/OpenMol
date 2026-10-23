// Ansatztabelle (Stöchiometrie): Rechnen, Einheiten, Eingaben verstehen, Tabelle aus einer Reaktion anlegen.
// Bezug ist das limitierende Edukt (Referenz). Für jede Zeile zählt die zuletzt eingegebene Größe („driver“):
// Äquivalente → n, m, V werden berechnet; Masse/Volumen/Stoffmenge → Äquivalente werden zurückgerechnet.
import { ATOMIC_WEIGHT } from './elements'
import { fmtDec } from '../settings'
import { analyze, pubchemCasByCid, pubchemCidByName, pubchemGhs, pubchemLookup, toSmiles } from './ocl'
import type { Doc, Id, StoichRole, StoichRow, StoichTable, StoichUnitKey } from './types'
import { uid } from './types'

// ---------- Einheiten ----------

export type QtyKind = 'm' | 'n' | 'V'
export const UNITS: Record<QtyKind, [string, number][]> = {
  m: [
    ['µg', 1e-6],
    ['mg', 1e-3],
    ['g', 1],
    ['kg', 1e3],
  ],
  n: [
    ['nmol', 1e-9],
    ['µmol', 1e-6],
    ['mmol', 1e-3],
    ['mol', 1],
  ],
  V: [
    ['µL', 1e-6],
    ['mL', 1e-3],
    ['L', 1],
  ],
}

/** Einheit für einen Wert: gewählt oder automatisch (Zahl möglichst zwischen 1 und 1000) */
export function pickUnit(kind: QtyKind, v: number, chosen?: string): [string, number] {
  const list = UNITS[kind]
  const c = chosen && list.find((u) => u[0] === chosen)
  if (c) return c
  let best = list[0]
  for (const u of list) if (Math.abs(v) >= u[1] * 0.9999) best = u
  return best
}

/** Zahl mit sinnvoller Stellenzahl; Dezimaltrennzeichen aus den Einstellungen (unabhängig von der Tabellensprache) */
export function fmtNum(v: number, _lang: 'de' | 'en', digits?: number): string {
  const a = Math.abs(v)
  const d = digits ?? (a >= 100 ? 1 : a >= 10 ? 2 : a >= 1 ? 2 : a >= 0.1 ? 3 : 4)
  return fmtDec(v, d)
}

/** Wert mit Einheit, z. B. „105,0 mg“ */
export function fmtQty(kind: QtyKind, v: number | undefined, lang: 'de' | 'en', chosen?: string): string {
  if (v === undefined || !Number.isFinite(v)) return ''
  const [u, f] = pickUnit(kind, v, chosen)
  return fmtNum(v / f, lang) + ' ' + u
}

const UNIT_ALIASES: Record<string, [QtyKind, number]> = {}
for (const k of Object.keys(UNITS) as QtyKind[]) for (const [u, f] of UNITS[k]) UNIT_ALIASES[u.toLowerCase()] = [k, f]
Object.assign(UNIT_ALIASES, {
  ug: ['m', 1e-6],
  umol: ['n', 1e-6],
  ul: ['V', 1e-6],
  ml: ['V', 1e-3],
  l: ['V', 1],
  mmol: ['n', 1e-3],
})

/** Zahl mit Komma oder Punkt */
export function parseNum(s: string): number | null {
  const t = s.trim().replace(/\s/g, '').replace(',', '.').replace('−', '-')
  if (!t) return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

/**
 * Eingabe einer Menge verstehen: „105“, „105 mg“, „0,105 g“, „1,2 mmol“, „250 µL“. Ohne Einheit gilt
 * `defUnit`. Steht eine Einheit einer anderen Größe dabei (z. B. „2 mL“ im Massenfeld), kommt deren Art zurück.
 */
export function parseQty(text: string, kind: QtyKind, defUnit: string): { kind: QtyKind; value: number } | null {
  const m = /^\s*([-−]?[\d.,]+)\s*([a-zA-Zµμ]+)?\s*$/.exec(text)
  if (!m) return null
  const v = parseNum(m[1])
  // negative Mengen gibt es nicht – wie eine unlesbare Eingabe behandeln
  if (v === null || v < 0) return null
  if (!m[2]) {
    const u = UNITS[kind].find((x) => x[0] === defUnit) ?? pickUnit(kind, 1)
    return { kind, value: v * u[1] }
  }
  const al = UNIT_ALIASES[m[2].replace('μ', 'µ').toLowerCase()]
  if (!al) return null
  return { kind: al[0], value: v * al[1] }
}

// ---------- Bibliothek: Lösungsmittel und gängige Reagenzien ----------
// Summenformeln (Molmasse wird daraus berechnet); Dichten in g/mL bei 20–25 °C (Literaturwerte, in der Tabelle
// änderbar).

export interface LibEntry {
  names: string[]
  formula: string
  density?: number
  solvent?: boolean
}

export const LIBRARY: LibEntry[] = [
  { names: ['THF', 'Tetrahydrofuran'], formula: 'C4H8O', density: 0.889, solvent: true },
  { names: ['2-MeTHF'], formula: 'C5H10O', density: 0.854, solvent: true },
  { names: ['DCM', 'CH2Cl2', 'Dichlormethan', 'dichloromethane'], formula: 'CH2Cl2', density: 1.326, solvent: true },
  { names: ['DCE', '1,2-Dichlorethan', '1,2-dichloroethane'], formula: 'C2H4Cl2', density: 1.253, solvent: true },
  { names: ['CHCl3', 'Chloroform'], formula: 'CHCl3', density: 1.489, solvent: true },
  { names: ['Toluol', 'toluene', 'PhMe'], formula: 'C7H8', density: 0.867, solvent: true },
  { names: ['Benzol', 'benzene', 'C6H6'], formula: 'C6H6', density: 0.876, solvent: true },
  { names: ['PhCl', 'Chlorbenzol', 'chlorobenzene'], formula: 'C6H5Cl', density: 1.106, solvent: true },
  { names: ['DMF', 'N,N-Dimethylformamid'], formula: 'C3H7NO', density: 0.944, solvent: true },
  { names: ['DMSO', 'Dimethylsulfoxid'], formula: 'C2H6OS', density: 1.1, solvent: true },
  { names: ['NMP'], formula: 'C5H9NO', density: 1.028, solvent: true },
  { names: ['MeCN', 'CH3CN', 'Acetonitril', 'acetonitrile'], formula: 'C2H3N', density: 0.786, solvent: true },
  { names: ['MeOH', 'Methanol'], formula: 'CH4O', density: 0.792, solvent: true },
  { names: ['EtOH', 'Ethanol'], formula: 'C2H6O', density: 0.789, solvent: true },
  { names: ['iPrOH', 'IPA', 'Isopropanol', '2-propanol'], formula: 'C3H8O', density: 0.786, solvent: true },
  { names: ['Et2O', 'Diethylether', 'diethyl ether', 'ether'], formula: 'C4H10O', density: 0.713, solvent: true },
  { names: ['1,4-Dioxan', 'Dioxan', '1,4-dioxane', 'dioxane'], formula: 'C4H8O2', density: 1.033, solvent: true },
  { names: ['DME', 'Dimethoxyethan'], formula: 'C4H10O2', density: 0.868, solvent: true },
  { names: ['Hexan', 'n-Hexan', 'hexane', 'n-hexane'], formula: 'C6H14', density: 0.655, solvent: true },
  { names: ['EtOAc', 'Ethylacetat', 'ethyl acetate', 'AcOEt'], formula: 'C4H8O2', density: 0.902, solvent: true },
  { names: ['Aceton', 'acetone'], formula: 'C3H6O', density: 0.784, solvent: true },
  { names: ['H2O', 'Wasser', 'water'], formula: 'H2O', density: 0.997, solvent: true },
  { names: ['Pyridin', 'pyridine'], formula: 'C5H5N', density: 0.982, solvent: true },
  { names: ['Et3N', 'NEt3', 'TEA', 'Triethylamin', 'triethylamine'], formula: 'C6H15N', density: 0.726 },
  { names: ['DIPEA', 'DIEA', 'Hünig-Base', "Hünig's base"], formula: 'C8H19N', density: 0.742 },
  { names: ['AcOH', 'Essigsäure', 'acetic acid'], formula: 'C2H4O2', density: 1.049 },
  { names: ['TFA', 'Trifluoressigsäure'], formula: 'C2HF3O2', density: 1.489 },
  { names: ['NaHMDS'], formula: 'C6H18NNaSi2' },
  { names: ['LiHMDS'], formula: 'C6H18LiNSi2' },
  { names: ['KHMDS'], formula: 'C6H18KNSi2' },
  { names: ['LDA'], formula: 'C6H14LiN' },
  { names: ['nBuLi', 'n-BuLi'], formula: 'C4H9Li' },
  { names: ['sBuLi', 's-BuLi'], formula: 'C4H9Li' },
  { names: ['tBuLi', 't-BuLi'], formula: 'C4H9Li' },
  { names: ['KOtBu', 'tBuOK'], formula: 'C4H9KO' },
  { names: ['NaOtBu', 'tBuONa'], formula: 'C4H9NaO' },
  { names: ['DMAP'], formula: 'C7H10N2' },
  { names: ['NBS'], formula: 'C4H4BrNO2' },
  { names: ['NIS'], formula: 'C4H4INO2' },
  { names: ['NCS'], formula: 'C4H4ClNO2' },
  { names: ['mCPBA'], formula: 'C7H5ClO3' },
  { names: ['TBAF'], formula: 'C16H36FN' },
  { names: ['DCC'], formula: 'C13H22N2' },
  { names: ['HATU'], formula: 'C10H15F6N6OP' },
  { names: ['AIBN'], formula: 'C8H12N4' },
  { names: ['PPh3'], formula: 'C18H15P' },
  { names: ['B2pin2'], formula: 'C12H24B2O4' },
  { names: ['DIBAL', 'DIBAL-H'], formula: 'C8H19Al' },
  { names: ['LiAlH4', 'LAH'], formula: 'AlH4Li' },
  { names: ['NaBH4'], formula: 'BH4Na' },
  { names: ['Pd(PPh3)4'], formula: 'C72H60P4Pd' },
  { names: ['Pd(OAc)2'], formula: 'C4H6O4Pd' },
  { names: ['Pd2(dba)3'], formula: 'C51H42O3Pd2' },
  { names: ['Pd(dppf)Cl2', 'PdCl2(dppf)'], formula: 'C34H28Cl2FeP2Pd' },
]

const LIB_INDEX = new Map<string, LibEntry>()
for (const e of LIBRARY) for (const n of e.names) LIB_INDEX.set(n.toLowerCase(), e)

export function libLookup(name: string): LibEntry | null {
  return LIB_INDEX.get(name.trim().toLowerCase()) ?? null
}

/** Molmasse aus einer Summenformel (auch mit Klammern, z. B. Ca(OH)2); null = keine gültige Formel */
export function formulaMW(f: string): number | null {
  const s = f.replace(/\s/g, '').replace(/[·•.]\d*H2O$/, '')
  if (!s || !/^[A-Z(]/.test(s)) return null
  let i = 0
  const group = (): number | null => {
    let sum = 0
    while (i < s.length && s[i] !== ')') {
      if (s[i] === '(') {
        i++
        const inner = group()
        if (inner === null || s[i] !== ')') return null
        i++
        const m = /^\d+/.exec(s.slice(i))
        const n = m ? parseInt(m[0], 10) : 1
        if (m) i += m[0].length
        sum += inner * n
        continue
      }
      const m = /^([A-Z][a-z]?)(\d*)/.exec(s.slice(i))
      if (!m || !ATOMIC_WEIGHT[m[1]]) return null
      i += m[0].length
      sum += ATOMIC_WEIGHT[m[1]] * (m[2] ? parseInt(m[2], 10) : 1)
    }
    return sum
  }
  const v = group()
  return v !== null && i === s.length && v > 0 ? v : null
}

// ---------- Rechnen ----------

export interface RowCalc {
  mw?: number
  formula?: string
  /** Struktur enthält Platzhalter (R, X …) → keine Molmasse */
  generic?: boolean
  linked: boolean
  eq?: number
  n?: number
  m?: number
  V?: number
  /** Produkt */
  theoN?: number
  theoM?: number
  obtN?: number
  yieldPct?: number
}

export interface TableCalc {
  rows: RowCalc[]
  nRef?: number
  refIndex: number
  /** Konzentration des Bezugsedukts bezogen auf alle Lösungsmittel (mol/L) */
  cRef?: number
  solventV?: number
}

const fragCache = new WeakMap<Doc, Map<Id, { mw?: number; formula: string; generic: boolean }>>()

function fragmentAtoms(doc: Doc, start: Id): Id[] {
  const adj = new Map<Id, Id[]>()
  for (const b of Object.values(doc.bonds)) {
    adj.set(b.a1, [...(adj.get(b.a1) ?? []), b.a2])
    adj.set(b.a2, [...(adj.get(b.a2) ?? []), b.a1])
  }
  const seen = new Set([start])
  const st = [start]
  while (st.length) {
    const u = st.pop()!
    for (const v of adj.get(u) ?? []) if (!seen.has(v)) {
      seen.add(v)
      st.push(v)
    }
  }
  return [...seen]
}

/** Formel und Molmasse der verknüpften Struktur (live aus der Zeichnung) */
export function linkedInfo(doc: Doc, atom: Id): { mw?: number; formula: string; generic: boolean } | null {
  if (!doc.atoms[atom]) return null
  let c = fragCache.get(doc)
  if (!c) {
    c = new Map()
    fragCache.set(doc, c)
  }
  const hit = c.get(atom)
  if (hit) return hit
  const ids = fragmentAtoms(doc, atom)
  const r = analyze(doc, ids)
  const info = r ? { mw: r.generic ? undefined : r.mw, formula: r.formula, generic: r.generic > 0 } : { formula: '', generic: true }
  for (const id of ids) c.set(id, info)
  return info
}

/** PubChem-CID einer Zeile: verknüpfte Struktur bzw. eingegebener SMILES, sonst Name (auch die anderen Namen aus der
 *  Bibliothek, z. B. „toluene“ zu „Toluol“) und Summenformel. null = nicht gefunden */
async function rowCid(doc: Doc, r: StoichRow): Promise<number | null> {
  if (r.atom && doc.atoms[r.atom]) {
    if (linkedInfo(doc, r.atom)?.generic) return null
    return (await pubchemLookup(toSmiles(doc, fragmentAtoms(doc, r.atom))))?.cid ?? null
  }
  if (r.smiles) return (await pubchemLookup(r.smiles))?.cid ?? null
  const lib = r.name ? libLookup(r.name) : null
  const names = [...new Set([r.name?.trim(), ...(lib?.names ?? []), r.formula].filter((x): x is string => !!x))]
  for (const n of names) {
    const cid = await pubchemCidByName(n)
    if (cid) return cid
  }
  return null
}

/** CAS-Nummer und GHS-Piktogramme einer Zeile aus PubChem (null = Stoff in PubChem nicht gefunden) */
export async function lookupRowSafety(doc: Doc, r: StoichRow): Promise<{ cas: string | null; ghs: { codes: string[]; source: string } | null } | null> {
  const cid = await rowCid(doc, r)
  if (!cid) return null
  const [cas, ghs] = await Promise.all([pubchemCasByCid(cid), pubchemGhs(cid)])
  return { cas, ghs }
}

/** CAS-Nummer einer Zeile über PubChem; null = nicht gefunden */
export async function lookupRowCas(doc: Doc, r: StoichRow): Promise<string | null> {
  return (await lookupRowSafety(doc, r))?.cas ?? null
}

export function rowMW(doc: Doc, r: StoichRow): { mw?: number; formula?: string; generic: boolean; linked: boolean } {
  if (r.atom) {
    const li = linkedInfo(doc, r.atom)
    if (li) return { mw: li.mw, formula: li.formula, generic: li.generic, linked: true }
  }
  const fromFormula = r.formula ? formulaMW(r.formula) : null
  return { mw: r.mw ?? fromFormula ?? undefined, formula: r.formula, generic: false, linked: false }
}

const isAmountRole = (role: StoichRole) => role === 'reactant' || role === 'reagent' || role === 'catalyst'

export function computeTable(doc: Doc, t: StoichTable): TableCalc {
  const rows: RowCalc[] = t.rows.map((r) => ({ ...rowMW(doc, r) }))
  let refIndex = t.rows.findIndex((r) => r.ref && isAmountRole(r.role))
  if (refIndex < 0) refIndex = t.rows.findIndex((r) => r.role === 'reactant')
  // Stoffmenge aus der eingegebenen Menge
  const nFromAmount = (r: StoichRow, mw?: number): number | undefined => {
    const d = r.driver ?? (r.mass !== undefined ? 'mass' : r.volume !== undefined ? 'volume' : r.moles !== undefined ? 'moles' : 'eq')
    if (d === 'moles' && r.moles !== undefined) return r.moles
    if (d === 'mass' && r.mass !== undefined && mw) return r.mass / mw
    if (d === 'volume' && r.volume !== undefined) {
      if (r.conc) return r.volume * r.conc
      if (r.density && mw) return (r.volume * 1000 * r.density) / mw
    }
    return undefined
  }
  const fill = (r: StoichRow, c: RowCalc, n: number | undefined) => {
    c.n = n
    if (n === undefined) return
    const d = r.driver
    c.m = d === 'mass' && r.mass !== undefined ? r.mass : c.mw ? n * c.mw : undefined
    c.V =
      d === 'volume' && r.volume !== undefined
        ? r.volume
        : r.conc
          ? n / r.conc
          : r.density && c.m !== undefined
            ? c.m / (r.density * 1000)
            : undefined
  }
  let nRef: number | undefined
  if (refIndex >= 0) {
    const r = t.rows[refIndex]
    const c = rows[refIndex]
    nRef = nFromAmount(r, c.mw)
    c.eq = 1
    fill(r, c, nRef)
  }
  let solventV = refIndex >= 0 && t.rows[refIndex].conc && rows[refIndex].V ? rows[refIndex].V! : 0
  t.rows.forEach((r, i) => {
    if (i === refIndex) return
    const c = rows[i]
    if (isAmountRole(r.role)) {
      if (!r.driver || r.driver === 'eq') {
        c.eq = r.eq ?? 1
        fill(r, c, nRef !== undefined ? c.eq * nRef : undefined)
      } else {
        const n = nFromAmount(r, c.mw)
        c.eq = n !== undefined && nRef ? n / nRef : undefined
        fill(r, c, n)
      }
      // eingesetzte Lösung: ihr Volumen gehört zum Reaktionsvolumen
      if (r.conc && c.V) solventV += c.V
    } else if (r.role === 'solvent') {
      c.V = r.volume
      c.m = r.volume !== undefined && r.density ? r.volume * 1000 * r.density : undefined
      c.n = c.m !== undefined && c.mw ? c.m / c.mw : undefined
      if (r.volume) solventV += r.volume
    } else if (r.role === 'product') {
      c.eq = r.eq ?? 1
      c.theoN = nRef !== undefined ? c.eq * nRef : undefined
      c.theoM = c.theoN !== undefined && c.mw ? c.theoN * c.mw : undefined
      c.obtN = r.obtained !== undefined && c.mw ? r.obtained / c.mw : undefined
      c.yieldPct = c.obtN !== undefined && c.theoN ? (c.obtN / c.theoN) * 100 : undefined
    }
  })
  return { rows, nRef, refIndex, solventV: solventV || undefined, cRef: nRef !== undefined && solventV ? nRef / solventV : undefined }
}

// ---------- Texte (DE/EN) ----------

export const STOICH_TEXT = {
  de: {
    reactants: 'Edukte und Reagenzien',
    solvents: 'Lösungsmittel',
    products: 'Produkte',
    name: 'Substanz',
    cas: 'CAS-Nr.',
    mw: 'M',
    eq: 'Äq.',
    eqUnit: 'Äq.',
    n: 'n',
    m: 'm',
    V: 'V',
    rho: 'ρ',
    concCol: 'c',
    theoN: 'n (theor.)',
    theoM: 'm (theor.)',
    obt: 'm (erhalten)',
    yield: 'Ausbeute',
    conditions: 'Bedingungen',
    conc: 'c',
    catalyst: 'Kat.',
  },
  en: {
    reactants: 'Reactants and reagents',
    solvents: 'Solvents',
    products: 'Products',
    name: 'Compound',
    cas: 'CAS No.',
    mw: 'MW',
    eq: 'equiv.',
    eqUnit: 'equiv',
    n: 'n',
    m: 'm',
    V: 'V',
    rho: 'ρ',
    concCol: 'c',
    theoN: 'n (theor.)',
    theoM: 'm (theor.)',
    obt: 'm (isolated)',
    yield: 'Yield',
    conditions: 'Conditions',
    conc: 'c',
    catalyst: 'cat.',
  },
}

/** Summenformel als Rich-Text (Ziffern tiefgestellt) */
export function formulaHtml(f: string): string {
  return f.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/(\d+)/g, '<sub>$1</sub>')
}

/** Anzeigename einer Zeile (Rich-Text) */
export function rowNameHtml(doc: Doc, r: StoichRow): string {
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const info = rowMW(doc, r)
  // Namen, die wie eine Formel geschrieben sind (K2CO3, Pd(PPh3)4, Et3N, CH2Cl2): Ziffern tiefstellen;
  // echte Namen mit Ziffern (1,4-Dioxan, 2-MeTHF, 18-Krone-6) bleiben unverändert
  const nameHtml = (x: string) => (/^[A-Z([][A-Za-z0-9()[\]·]*$/.test(x) && /[A-Za-z)\]]\d/.test(x) ? formulaHtml(x) : esc(x))
  const nm = r.name?.trim()
  const base = nm ? nameHtml(nm) : info.formula ? formulaHtml(info.formula) : '–'
  // Lösung: „NaHMDS (in n-Hexan)“, „EtMgBr (in Et₂O)“ – die Konzentration steht in der eigenen Spalte c
  if (r.conc && r.role !== 'solvent' && r.solvent?.trim()) return `${base} <i>(in ${nameHtml(r.solvent.trim())})</i>`
  return base
}

/** „NaHMDS (2.0 M in n-Hexan)“, „nBuLi 2,5 M in Hexan“, „HCl (4 M in Dioxan)“ → Name, Konzentration, Lösungsmittel */
export function parseSolution(text: string): { name: string; conc: number; solvent?: string } | null {
  const m = /^(.*?)[\s,]*\(?\s*([\d.,]+)\s*(?:M|mol\/L|mol\/l|mol L-1)\b\s*(?:in\s+([^,()]+?))?\s*\)?\s*$/.exec(text.trim())
  if (!m || !m[1].trim()) return null
  const conc = parseNum(m[2])
  if (conc === null || conc <= 0) return null
  return { name: m[1].trim(), conc, solvent: m[3]?.trim() }
}

export function conditionsText(t: StoichTable, calc: TableCalc): string {
  const L = t.lang
  const parts: string[] = []
  if (t.temperature?.trim()) parts.push(t.temperature.trim())
  if (t.time?.trim()) parts.push(t.time.trim())
  if (t.atmosphere?.trim()) parts.push(t.atmosphere.trim().replace(/^N2$/, 'N<sub>2</sub>'))
  if (calc.cRef) parts.push(`${STOICH_TEXT[L].conc} = ${fmtNum(calc.cRef, L, calc.cRef >= 0.1 ? 2 : 3)} mol/L`)
  return parts.join(', ')
}

// ---------- Eingaben in Zeilen übernehmen ----------

export function newRow(role: StoichRole, extra: Partial<StoichRow> = {}): StoichRow {
  return { id: uid('sr'), role, ...extra }
}

/** Zeile aus einem eingegebenen Namen/Formel: Bibliothek, sonst Summenformel, sonst nur Name */
export function rowFromName(name: string, role?: StoichRole): StoichRow {
  const sol = parseSolution(name)
  if (sol) {
    const r = rowFromName(sol.name, role)
    if (r.role === 'solvent') r.role = 'reagent'
    return { ...r, conc: sol.conc, solvent: sol.solvent, density: undefined }
  }
  const t = name.trim()
  const lib = libLookup(t)
  if (lib) return newRow(role ?? (lib.solvent ? 'solvent' : 'reagent'), { name: lib.names[0], formula: lib.formula, density: lib.density })
  // Summenformel nur, wenn kein Element doppelt vorkommt (K2CO3, NaCl) – „CCO“ ist ein SMILES (Ethanol)
  const els = t.replace(/[·•.]\d*H2O$/, '').match(/[A-Z][a-z]?/g) ?? []
  const mw = new Set(els).size === els.length ? formulaMW(t) : null
  if (mw) return newRow(role ?? 'reagent', { name: t, formula: t.replace(/[·•.]\d*H2O$/, '') })
  return newRow(role ?? 'reagent', { name: t })
}

// ---------- Aus einer gezeichneten Reaktion ----------

export interface ParsedConditions {
  temperature?: string
  time?: string
  atmosphere?: string
  rows: StoichRow[]
}

/** Pfeiltext (z. B. „NaHMDS (2.1 equiv), THF, 80 °C, 16 h, N2“) in Reagenzien, Lösungsmittel und Bedingungen zerlegen */
export function parseConditionText(plain: string): ParsedConditions {
  const out: ParsedConditions = { rows: [] }
  // an Kommas/Semikolons/Zeilen trennen – aber nicht innerhalb von Klammern („NaHMDS (2.0 M in THF, 2.1 equiv)“)
  const tokens: string[] = []
  let depth = 0
  let curTok = ''
  for (const ch of plain) {
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (depth === 0 && /[,;\n]/.test(ch)) {
      tokens.push(curTok)
      curTok = ''
    } else curTok += ch
  }
  tokens.push(curTok)
  for (let i = tokens.length - 1; i >= 0; i--) {
    tokens[i] = tokens[i].trim()
    if (!tokens[i]) tokens.splice(i, 1)
  }
  for (let tok of tokens) {
    const temp = /^(?:[-−–]?\d+(?:[.,]\d+)?\s*(?:[-−–]\s*[-−–]?\d+(?:[.,]\d+)?\s*)?°\s*C|RT|rt|r\.t\.|Raumtemperatur|room temperature|reflux|Rückfluss|Δ)$/.exec(tok)
    if (temp) {
      out.temperature = tok
      continue
    }
    const time = /^(\d+(?:[.,]\d+)?\s*(?:h|min|d|s|Std\.?)|overnight|über Nacht|o\/n)$/i.exec(tok)
    if (time) {
      out.time = tok
      continue
    }
    if (/^(N2|Ar|Argon|Stickstoff|nitrogen|argon|Luft|air|O2)$/i.test(tok)) {
      out.atmosphere = tok
      continue
    }
    // Äquivalente in Klammern: „K2CO3 (2.0 equiv)“, „NaH (1,5 Äq.)“
    let eq: number | undefined
    const em = /\(\s*([\d.,]+)\s*(?:equiv\.?|eq\.?|Äq\.?|äq\.?)\s*\)\s*$/.exec(tok)
    if (em) {
      eq = parseNum(em[1]) ?? undefined
      tok = tok.slice(0, em.index).trim()
    } else {
      const em2 = /[,;]\s*([\d.,]+)\s*(?:equiv\.?|eq\.?|Äq\.?|äq\.?)\s*\)\s*$/.exec(tok)
      if (em2) {
        eq = parseNum(em2[1]) ?? undefined
        tok = (tok.slice(0, em2.index) + ')').trim()
      }
    }
    // Katalysator-Menge in mol%: „Pd(PPh3)4 (5 mol%)“ → Katalysator mit 0,05 Äq.
    let cat = false
    const mp = /\(\s*([\d.,]+)\s*mol\s*%\s*\)\s*$/i.exec(tok)
    if (mp) {
      const v = parseNum(mp[1])
      if (v !== null) {
        eq = v / 100
        cat = true
      }
      tok = tok.slice(0, mp.index).trim()
    }
    // Lösungsmittelgemische „Toluol/H2O“, „THF/H2O (4:1)“ → einzelne Lösungsmittel
    const mix = tok.replace(/\s*\([\d.,:\s]+\)\s*$/, '').split('/')
    if (mix.length > 1 && mix.every((x) => libLookup(x)?.solvent)) {
      for (const x of mix) out.rows.push(rowFromName(x, 'solvent'))
      continue
    }
    const row = rowFromName(tok)
    if (cat) row.role = 'catalyst'
    if (eq !== undefined && row.role !== 'solvent') row.eq = eq
    out.rows.push(row)
  }
  return out
}

export const STOICH_ROLES: { v: StoichRole; de: string; en: string }[] = [
  { v: 'reactant', de: 'Edukt', en: 'Reactant' },
  { v: 'reagent', de: 'Reagenz', en: 'Reagent' },
  { v: 'catalyst', de: 'Katalysator', en: 'Catalyst' },
  { v: 'solvent', de: 'Lösungsmittel', en: 'Solvent' },
  { v: 'product', de: 'Produkt', en: 'Product' },
]

export const UNIT_KEYS: Record<StoichUnitKey, QtyKind> = { m: 'm', n: 'n', V: 'V', obt: 'm' }
