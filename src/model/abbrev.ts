import { alkylPrefixAt } from './richtext'

// Abkürzungen / Funktionelle Gruppen. Das erste Atom im SMILES ist der Anknüpfungspunkt.
// "rev" ist die gespiegelte Schreibweise, wenn die Bindung von rechts kommt (OMe → MeO).

export interface Abbrev {
  smiles: string
  rev?: string
  /** generische Gruppe (R, X, Nu …) – keine echte Summenformel */
  generic?: boolean
}

export const ABBREVIATIONS: Record<string, Abbrev> = {
  Me: { smiles: 'C' },
  Et: { smiles: 'CC' },
  Pr: { smiles: 'CCC' },
  nPr: { smiles: 'CCC' },
  iPr: { smiles: 'C(C)C' },
  Bu: { smiles: 'CCCC' },
  nBu: { smiles: 'CCCC' },
  sBu: { smiles: 'C(C)CC' },
  iBu: { smiles: 'CC(C)C' },
  tBu: { smiles: 'C(C)(C)C' },
  // Schreibweisen mit Bindestrich
  'n-Pr': { smiles: 'CCC' },
  'i-Pr': { smiles: 'C(C)C' },
  'n-Bu': { smiles: 'CCCC' },
  's-Bu': { smiles: 'C(C)CC' },
  'sec-Bu': { smiles: 'C(C)CC' },
  'i-Bu': { smiles: 'CC(C)C' },
  't-Bu': { smiles: 'C(C)(C)C' },
  'tert-Bu': { smiles: 'C(C)(C)C' },
  Ph: { smiles: 'c1ccccc1' },
  C6H5: { smiles: 'c1ccccc1', rev: 'H5C6' },
  C6F5: { smiles: 'c1c(F)c(F)c(F)c(F)c1F', rev: 'F5C6' },
  C6H11: { smiles: 'C1CCCCC1', rev: 'H11C6' },
  Tol: { smiles: 'c1ccc(C)cc1' },
  'p-Tol': { smiles: 'c1ccc(C)cc1' },
  'o-Tol': { smiles: 'c1ccccc1C' },
  Mes: { smiles: 'c1c(C)cc(C)cc1C' },
  Dipp: { smiles: 'c1c(C(C)C)cccc1C(C)C' },
  Py: { smiles: 'c1ccccn1' },
  // Isotope
  D: { smiles: '[2H]' },
  T: { smiles: '[3H]' },
  CD3: { smiles: 'C([2H])([2H])[2H]', rev: 'D3C' },
  OD: { smiles: 'O[2H]', rev: 'DO' },
  Bn: { smiles: 'Cc1ccccc1' },
  Cy: { smiles: 'C1CCCCC1' },
  Vin: { smiles: 'C=C' },
  All: { smiles: 'CC=C' },
  OH: { smiles: 'O', rev: 'HO' },
  SH: { smiles: 'S', rev: 'HS' },
  NH2: { smiles: 'N', rev: 'H2N' },
  NH: { smiles: 'N', rev: 'HN' },
  CH3: { smiles: 'C', rev: 'H3C' },
  CH2: { smiles: 'C', rev: 'H2C' },
  OMe: { smiles: 'OC', rev: 'MeO' },
  OEt: { smiles: 'OCC', rev: 'EtO' },
  OPh: { smiles: 'Oc1ccccc1', rev: 'PhO' },
  OBn: { smiles: 'OCc1ccccc1', rev: 'BnO' },
  OtBu: { smiles: 'OC(C)(C)C', rev: 'tBuO' },
  SMe: { smiles: 'SC', rev: 'MeS' },
  NHMe: { smiles: 'NC', rev: 'MeHN' },
  NMe2: { smiles: 'N(C)C', rev: 'Me2N' },
  NEt2: { smiles: 'N(CC)CC', rev: 'Et2N' },
  CN: { smiles: 'C#N', rev: 'NC' },
  'C≡N': { smiles: 'C#N', rev: 'N≡C' },
  NO2: { smiles: '[N+](=O)[O-]', rev: 'O2N' },
  N3: { smiles: 'N=[N+]=[N-]' },
  CHO: { smiles: 'C=O', rev: 'OHC' },
  CO2H: { smiles: 'C(=O)O', rev: 'HO2C' },
  COOH: { smiles: 'C(=O)O', rev: 'HOOC' },
  CO2Me: { smiles: 'C(=O)OC', rev: 'MeO2C' },
  COOMe: { smiles: 'C(=O)OC', rev: 'MeOOC' },
  CO2Et: { smiles: 'C(=O)OCC', rev: 'EtO2C' },
  CO2tBu: { smiles: 'C(=O)OC(C)(C)C', rev: 'tBuO2C' },
  CONH2: { smiles: 'C(=O)N', rev: 'H2NOC' },
  COCl: { smiles: 'C(=O)Cl', rev: 'ClOC' },
  Ac: { smiles: 'C(C)=O' },
  OAc: { smiles: 'OC(C)=O', rev: 'AcO' },
  NHAc: { smiles: 'NC(C)=O', rev: 'AcHN' },
  Bz: { smiles: 'C(=O)c1ccccc1' },
  OBz: { smiles: 'OC(=O)c1ccccc1', rev: 'BzO' },
  Piv: { smiles: 'C(=O)C(C)(C)C' },
  OPiv: { smiles: 'OC(=O)C(C)(C)C', rev: 'PivO' },
  CF3: { smiles: 'C(F)(F)F', rev: 'F3C' },
  CCl3: { smiles: 'C(Cl)(Cl)Cl', rev: 'Cl3C' },
  OCF3: { smiles: 'OC(F)(F)F', rev: 'F3CO' },
  SO3H: { smiles: 'S(=O)(=O)O', rev: 'HO3S' },
  PO3H2: { smiles: 'P(=O)(O)O', rev: 'H2O3P' },
  SO2Cl: { smiles: 'S(=O)(=O)Cl', rev: 'ClO2S' },
  SO2Me: { smiles: 'S(=O)(=O)C', rev: 'MeO2S' },
  Boc: { smiles: 'C(=O)OC(C)(C)C' },
  NHBoc: { smiles: 'NC(=O)OC(C)(C)C', rev: 'BocHN' },
  Cbz: { smiles: 'C(=O)OCc1ccccc1' },
  NHCbz: { smiles: 'NC(=O)OCc1ccccc1', rev: 'CbzHN' },
  Fmoc: { smiles: 'C(=O)OCC1c2ccccc2-c2ccccc21' },
  Ts: { smiles: 'S(=O)(=O)c1ccc(C)cc1' },
  OTs: { smiles: 'OS(=O)(=O)c1ccc(C)cc1', rev: 'TsO' },
  NHTs: { smiles: 'NS(=O)(=O)c1ccc(C)cc1', rev: 'TsHN' },
  Ms: { smiles: 'S(=O)(=O)C' },
  OMs: { smiles: 'OS(=O)(=O)C', rev: 'MsO' },
  Tf: { smiles: 'S(=O)(=O)C(F)(F)F' },
  OTf: { smiles: 'OS(=O)(=O)C(F)(F)F', rev: 'TfO' },
  TMS: { smiles: '[Si](C)(C)C' },
  OTMS: { smiles: 'O[Si](C)(C)C', rev: 'TMSO' },
  TES: { smiles: '[Si](CC)(CC)CC' },
  OTES: { smiles: 'O[Si](CC)(CC)CC', rev: 'TESO' },
  TBS: { smiles: '[Si](C)(C)C(C)(C)C' },
  OTBS: { smiles: 'O[Si](C)(C)C(C)(C)C', rev: 'TBSO' },
  TBDMS: { smiles: '[Si](C)(C)C(C)(C)C' },
  OTBDMS: { smiles: 'O[Si](C)(C)C(C)(C)C', rev: 'TBDMSO' },
  TIPS: { smiles: '[Si](C(C)C)(C(C)C)C(C)C' },
  OTIPS: { smiles: 'O[Si](C(C)C)(C(C)C)C(C)C', rev: 'TIPSO' },
  TBDPS: { smiles: '[Si](c1ccccc1)(c1ccccc1)C(C)(C)C' },
  OTBDPS: { smiles: 'O[Si](c1ccccc1)(c1ccccc1)C(C)(C)C', rev: 'TBDPSO' },
  PMB: { smiles: 'Cc1ccc(OC)cc1' },
  OPMB: { smiles: 'OCc1ccc(OC)cc1', rev: 'PMBO' },
  THP: { smiles: 'C1CCCCO1' },
  OTHP: { smiles: 'OC1CCCCO1', rev: 'THPO' },
  Bpin: { smiles: 'B1OC(C)(C)C(C)(C)O1', rev: 'pinB' },
  PPh3: { smiles: '[P+](c1ccccc1)(c1ccccc1)c1ccccc1', rev: 'Ph3P' },
  // generische Platzhalter
  R: { smiles: '*', generic: true },
  "R'": { smiles: '*', generic: true },
  "R''": { smiles: '*', generic: true },
  R1: { smiles: '*', generic: true },
  R2: { smiles: '*', generic: true },
  R3: { smiles: '*', generic: true },
  R4: { smiles: '*', generic: true },
  Ar: { smiles: '*', generic: true },
  X: { smiles: '*', generic: true },
  Y: { smiles: '*', generic: true },
  Nu: { smiles: '*', generic: true },
  E: { smiles: '*', generic: true },
  LG: { smiles: '*', generic: true },
  Hal: { smiles: '*', generic: true },
  M: { smiles: '*', generic: true },
  PG: { smiles: '*', generic: true },
}

const REVERSED: Record<string, string> = {}
for (const [k, v] of Object.entries(ABBREVIATIONS)) if (v.rev) REVERSED[v.rev] = k

/** Liefert den kanonischen Schlüssel für ein Label (z. B. "MeO" → "OMe") */
export function canonicalAbbrev(label: string): string | null {
  if (ABBREVIATIONS[label]) return label
  if (REVERSED[label]) return REVERSED[label]
  return null
}

/** Häufig benötigte Gruppen für die Schnellauswahl */
export const QUICK_GROUPS = ['Me', 'Et', 'iPr', 'tBu', 'Ph', 'Bn', 'OMe', 'OAc', 'CO2H', 'CO2Me', 'CN', 'NO2', 'CF3', 'Boc', 'Ts', 'OTf', 'TBS', 'R', 'X', 'Nu']

/** Alkyl-/Arylgruppen, die in kondensierten Labels vorkommen dürfen (z. B. iPr2N, nBuLi, CMe2OH) */
const LABEL_GROUPS = ['Me', 'Et', 'Pr', 'nPr', 'iPr', 'Bu', 'nBu', 'sBu', 'iBu', 'tBu', 'Ph', 'Bn', 'Cy', 'n-Pr', 'i-Pr', 'n-Bu', 's-Bu', 'sec-Bu', 'i-Bu', 't-Bu', 'tert-Bu'].sort(
  (a, b) => b.length - a.length,
)

/**
 * Länge des Elementsymbols an Position i (1 oder 2, 0 = keins). Ein Kleinbuchstabe, der einen Alkyl-Präfix
 * beginnt, gehört nach B, C, N, O, P nicht zum Symbol: „NiPr2“ = N(iPr)2, „PtBu3“ = P(tBu)3, „OtBu“.
 * (Bei anderen Elementen gewinnt das Elementsymbol, z. B. „SiPr3“ = Si.)
 */
export function elementSymbolLen(s: string, i: number, isElement: (x: string) => boolean): number {
  if (!/[A-Z]/.test(s[i] ?? '')) return 0
  const two = s.slice(i, i + 2)
  if (two.length === 2 && /[a-z]/.test(two[1])) {
    const split = alkylPrefixAt(s, i + 1) > 0 && 'BCNOP'.includes(s[i])
    if (!split && isElement(two)) return 2
    if (isElement(s[i])) return 1
    return 0
  }
  return isElement(s[i]) ? 1 : 0
}

export interface LabelUnit {
  kind: 'el' | 'grp' | 'paren'
  /** Position im Label */
  start: number
  end: number
  /** Element, Gruppen-SMILES bzw. Klammerinhalt */
  el?: string
  smiles?: string
  n: number
}

/** Zerlegt ein kondensiertes Label in Elemente, Gruppen und Klammern (mit Anzahl); null = nicht interpretierbar */
export function condensedUnits(label: string, isElement: (s: string) => boolean): LabelUnit[] | null {
  const units: LabelUnit[] = []
  let i = 0
  const count = () => {
    const m = /^\d+/.exec(label.slice(i))
    if (!m) return 1
    i += m[0].length
    return parseInt(m[0], 10)
  }
  while (i < label.length) {
    const start = i
    if (label[i] === '(') {
      let depth = 0
      let j = i
      for (; j < label.length; j++) {
        if (label[j] === '(') depth++
        else if (label[j] === ')' && --depth === 0) break
      }
      if (j >= label.length) return null
      const innerText = label.slice(i + 1, j)
      // „(H)“ wie in iPr2N(H): Wasserstoff am vorherigen Atom
      const hm = /^H(\d*)$/.exec(innerText)
      const inner = hm ? `[H${hm[1]}]` : condensedToSmiles(innerText, isElement)
      if (!inner) return null
      i = j + 1
      const n = count()
      units.push({ kind: 'paren', start, end: i, smiles: inner, n })
      continue
    }
    const g = LABEL_GROUPS.find((x) => label.startsWith(x, i) && !/[a-z]/.test(label[i + x.length] ?? ''))
    if (g) {
      i += g.length
      const n = count()
      units.push({ kind: 'grp', start, end: i, smiles: ABBREVIATIONS[g].smiles, n })
      continue
    }
    const k = elementSymbolLen(label, i, isElement)
    if (!k) return null
    const el = label.slice(i, i + k)
    i += k
    const n = count()
    units.push({ kind: 'el', start, end: i, el, n })
  }
  return units.length ? units : null
}

/**
 * Schreibrichtungen einer kondensierten Formel: vorwärts (Anknüpfungsatom vorn, „NiPr2“, „CH2OH“) und
 * gespiegelt (Anknüpfungsatom hinten, „iPr2N“, „HOH2C“) – für Bindungen, die von rechts kommen.
 */
export function condensedForms(label: string, isElement: (s: string) => boolean): { fwd: string; rev: string } | null {
  const units = condensedUnits(label, isElement)
  if (!units) return null
  type Block = { el: string; h: string; hRev?: string; subs: string[] }
  const blocks: Block[] = []
  const pending: string[] = []
  for (const u of units) {
    const txt = label.slice(u.start, u.end)
    if (u.kind === 'el' && u.el === 'H') {
      if (!blocks.length) return null
      blocks[blocks.length - 1].h += txt
    } else if (u.kind === 'paren' && /^\[H\d*\]$/.test(u.smiles ?? '') && blocks.length) {
      // „(H)“ gehört zum Atom davor: vorwärts bleibt die Klammer (N(H)Me), gespiegelt MeHN
      const b = blocks[blocks.length - 1]
      b.h += txt
      b.hRev = (b.hRev ?? '') + txt.replace(/[()]/g, '')
    } else if (u.kind === 'el' && !(u.n > 1 && blocks.length)) {
      // „C2H5“: Kette am Anfang bleibt ein Block (gespiegelt „H5C2“)
      blocks.push({ el: txt, h: '', subs: [] })
    } else (blocks.length ? blocks[blocks.length - 1].subs : pending).push(txt)
  }
  if (!blocks.length) return null
  blocks[0].subs.unshift(...pending)
  const fwd = blocks.map((b) => b.el + b.h + b.subs.join('')).join('')
  const rev = [...blocks]
    .reverse()
    .map((b) => b.subs.join('') + (b.hRev !== undefined ? b.h.replace(/\(H\d*\)/g, '') + b.hRev : b.h) + b.el)
    .join('')
  return { fwd, rev }
}

/**
 * Einfache Auflösung kondensierter Formeln wie "CH2OH", "OCH2CH3", "iPr2N", "NiPr2", "CMe2OH" oder "N(iPr)2"
 * zu einem SMILES-Fragment. Schwere Atome werden zu einer Kette verbunden, Mehrfach-Indizes (CF3) und
 * Gruppen (Me, iPr, …) als Substituenten des vorherigen (bzw. ersten) schweren Atoms,
 * H-Zahlen über Klammeratome. Das erste schwere Atom ist der Anknüpfungspunkt. null = nicht interpretierbar.
 */
const VALENCE: Record<string, number> = { C: 4, N: 3, O: 2, S: 6, P: 5, Si: 4, B: 3, Se: 6 }

export function condensedToSmiles(label: string, isElement: (s: string) => boolean): string | null {
  // Alkylkette CnH2n+1 usw. (C2H5, C4H9): Kohlenstoffkette, Wasserstoffe über die Wertigkeit
  const alkyl = /^C(\d+)H(\d+)$/.exec(label)
  if (alkyl && +alkyl[1] > 1 && +alkyl[1] <= 30) return 'C'.repeat(+alkyl[1])
  const units = condensedUnits(label, isElement)
  if (!units) return null
  type Heavy = { el: string; h: number; subs: string[]; used: number }
  const chain: Heavy[] = []
  const pending: string[] = []
  const atom = (el: string, h: number) => `[${el}${h ? 'H' + (h > 1 ? h : '') : ''}]`
  for (let ui = 0; ui < units.length; ui++) {
    const u = units[ui]
    const last = chain[chain.length - 1]
    if (u.kind === 'el' && u.el === 'H') {
      if (!last) return null
      last.h += u.n
      last.used += u.n
      continue
    }
    if (u.kind === 'el') {
      // Sauerstoff hinter C/S/P/N: Doppelbindung, soweit die Wertigkeit reicht (CONHMe → C(=O)NHMe,
      // SO2NH2 → S(=O)(=O)NH2, CO2H → C(=O)OH, SO3H → S(=O)(=O)OH). Folgt ein H, trägt das letzte O die Kette weiter.
      const next = units[ui + 1]
      if (u.el === 'O' && last && VALENCE[last.el] && last.el !== 'O' && last.el !== 'H') {
        const chainO = next?.kind === 'el' && next.el === 'H' ? 1 : 0
        const nSub = u.n - chainO
        const needLater = chainO || ui + 1 < units.length ? 1 : 0
        const before = VALENCE[last.el] - last.used - needLater
        let free = before
        const subs: string[] = []
        for (let k = 0; k < nSub; k++) {
          if (free >= 2) {
            subs.push('=O')
            free -= 2
          } else if (free >= 1 && (nSub > 1 || needLater === 0)) {
            subs.push('O')
            free -= 1
          } else break
        }
        if (subs.length === nSub && (nSub > 0 || chainO)) {
          last.subs.push(...subs)
          last.used += before - free
          if (chainO) {
            last.used += 1
            chain.push({ el: 'O', h: 0, subs: [], used: 1 })
          }
          continue
        }
      }
      if (u.n > 1 && last) {
        for (let k = 0; k < u.n; k++) last.subs.push(atom(u.el!, 0))
        last.used += u.n
        continue
      }
      for (let k = 0; k < u.n; k++) {
        if (chain.length) chain[chain.length - 1].used += 1
        chain.push({ el: u.el!, h: 0, subs: [], used: 1 })
      }
      continue
    }
    // „(H)“, „(H2)“: Wasserstoffe am vorherigen Atom
    const hp = u.kind === 'paren' ? /^\[H(\d*)\]$/.exec(u.smiles!) : null
    if (hp) {
      if (!last) return null
      const nh = (hp[1] ? +hp[1] : 1) * u.n
      last.h += nh
      last.used += nh
      continue
    }
    // „(O)“ wie in S(O)Me oder C(O)Me: Oxo-Gruppe, wenn die Wertigkeit reicht
    if (u.kind === 'paren' && u.smiles === '[O]' && last && VALENCE[last.el] && last.el !== 'O') {
      const needLater = ui + 1 < units.length ? 1 : 0
      if (VALENCE[last.el] - last.used - needLater >= 2 * u.n) {
        for (let k = 0; k < u.n; k++) last.subs.push('=O')
        last.used += 2 * u.n
        continue
      }
    }
    // Gruppe oder Klammer: Substituent am vorherigen schweren Atom (am Anfang: am ersten)
    for (let k = 0; k < u.n; k++) {
      if (last) {
        last.subs.push(u.smiles!)
        last.used += 1
      } else pending.push(u.smiles!)
    }
  }
  if (!chain.length) {
    // nur Gruppen: eine einzelne (z. B. „(iPr)“) oder eine Kette gleicher Glieder (z. B. „(CH2)5“)
    if (pending.length === 1) return pending[0]
    if (pending.length > 1 && pending.every((x) => x === pending[0]) && /^\[?[A-Z][a-z]?(H\d*)?\]?$/.test(pending[0])) return pending.join('')
    return null
  }
  chain[0].subs.unshift(...pending)
  let out = ''
  for (const c of chain) {
    out += atom(c.el, c.h)
    for (const sub of c.subs) out += `(${sub})`
  }
  return out
}
