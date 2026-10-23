// Beispieldokumente für den Einstieg
import { oclToFragment, parseStructure } from './ocl'
import { insertFragment } from './ops'
import { buildGraph } from './chem'
import { applyRingFill, perceiveRings, ringSystem, type FillStyle } from './rings'
import { newBranch, newCycle } from './cycle'
import type { Doc, Id } from './types'
import { emptyDoc, uid } from './types'

function place(d: Doc, smiles: string, cx: number, cy: number): Id[] {
  const f = oclToFragment(parseStructure(smiles), d.style.bondLength, { x: cx, y: cy })
  return insertFragment(d, f).atoms
}

function find(d: Doc, ids: Id[], el: string, nth = 0): Id {
  return ids.filter((id) => d.atoms[id].element === el)[nth]
}

function bondBetween(d: Doc, a: Id, b: Id): Id {
  return Object.values(d.bonds).find((x) => (x.a1 === a && x.a2 === b) || (x.a1 === b && x.a2 === a))!.id
}

/** SN2: Hydroxid + Brommethan → Methanol + Bromid, mit Elektronenfluss */
export function exampleSN2(): Doc {
  const d = emptyDoc()
  // Nukleophil
  const o = place(d, '[OH-]', -150, 0)[0]
  d.atoms[o].lonePairs = 3
  // Substrat (Brommethan, C beschriftet)
  const sub = place(d, 'CBr', -50, 0)
  const c = find(d, sub, 'C')
  const br = find(d, sub, 'Br')
  d.atoms[c].label = 'CH3'
  d.atoms[c].x = -72
  d.atoms[c].y = 0
  d.atoms[br].x = -28
  d.atoms[br].y = 0
  d.atoms[br].lonePairs = 3
  d.atoms[c].partial = '+'
  d.atoms[br].partial = '-'
  const cBr = bondBetween(d, c, br)
  const id1 = uid('c')
  d.curved[id1] = { id: id1, head: 'full', from: { type: 'lp', id: o, index: 0 }, to: { type: 'atom', id: c }, bend: 0.45 }
  const id2 = uid('c')
  d.curved[id2] = { id: id2, head: 'full', from: { type: 'bond', id: cBr }, to: { type: 'atom', id: br }, bend: -0.6 }
  // Pfeil
  const ar = uid('r')
  d.arrows[ar] = { id: ar, kind: 'reaction', x1: 20, y1: 0, x2: 120, y2: 0, above: '<span class="formula">H2O</span>', below: 'SN2' }
  // Produkte
  const p = place(d, 'CO', 190, 0)
  const pc = find(d, p, 'C')
  const po = find(d, p, 'O')
  d.atoms[pc].label = 'H3C'
  d.atoms[pc].x = 175
  d.atoms[po].x = 215
  d.atoms[po].y = 0
  d.atoms[pc].y = 0
  d.atoms[po].lonePairs = 2
  const plus = uid('t')
  d.texts[plus] = { id: plus, x: 255, y: 0, text: '+', size: 26 }
  const brm = place(d, '[Br-]', 305, 0)[0]
  d.atoms[brm].lonePairs = 4
  // Titel
  const t = uid('t')
  d.texts[t] = { id: t, x: -175, y: -90, text: 'Nukleophile Substitution (SN2)', size: 18, bold: true }
  return d
}

/** Fischer-Veresterung als Reaktionsgleichung */
export function exampleEsterification(): Doc {
  const d = emptyDoc()
  place(d, 'CC(=O)O', -230, 0)
  const p1 = uid('t')
  d.texts[p1] = { id: p1, x: -178, y: 0, text: '+', size: 26 }
  place(d, 'CCO', -88, 0)
  const ar = uid('r')
  d.arrows[ar] = { id: ar, kind: 'equilibrium', x1: -30, y1: 0, x2: 80, y2: 0, above: '<span class="formula">H2SO4</span> (kat.)', below: 'Δ' }
  place(d, 'CC(=O)OCC', 170, 0)
  const p2 = uid('t')
  d.texts[p2] = { id: p2, x: 245, y: 0, text: '+', size: 26 }
  const w = uid('t')
  d.texts[w] = { id: w, x: 280, y: 0, text: 'H2O', size: 20, chem: true }
  const t = uid('t')
  d.texts[t] = { id: t, x: -270, y: -90, text: 'Fischer-Veresterung', size: 18, bold: true }
  return d
}

/** Mehrstufiges Syntheseschema mit Ringfüllungen, Bedingungen, Ausbeuten und Verbindungsnummern */
export function exampleScheme(): Doc {
  const d = emptyDoc()
  const blue: FillStyle = { mode: 'fill', grad: 'radial', c1: '#2c4fd8', c2: '#8fb0ff', angle: 0, opacity: 1 }
  const red: FillStyle = { mode: 'fill', grad: 'none', c1: '#e8574f', c2: '#e8574f', angle: 0, opacity: 1 }
  const mols: [string, number, FillStyle][] = [
    ['O=C1c2ccccc2-c2ccc(Br)cc21', -330, blue],
    ['O=C1c2ccccc2-c2ccc(-c3ccc(OC)cc3)cc21', 0, blue],
    ['OC1(c3ccccc3)c2ccccc2-c2ccc(-c3ccc(OC)cc3)cc21', 400, red],
  ]
  mols.forEach(([smi, x, style], i) => {
    const ids = place(d, smi, x, 0)
    const g = buildGraph(d)
    const rings = perceiveRings(d, g).filter((r) => r.every((a) => ids.includes(a)))
    // das Fluorenon-Gerüst (größtes anelliertes System) einfärben
    let best: string[][] = []
    for (const r of rings) {
      const sys = ringSystem(rings, r)
      if (sys.length > best.length) best = sys
    }
    if (best.length) applyRingFill(d, best, style, false)
    const ys = ids.map((id) => d.atoms[id].y)
    const t = uid('t')
    d.texts[t] = { id: t, x, y: Math.max(...ys) + 40, text: String(i + 1), size: 17, bold: true, align: 'center' }
  })
  const a1 = uid('r')
  d.arrows[a1] = { id: a1, kind: 'reaction', x1: -215, y1: 0, x2: -110, y2: 0, above: '<span class="formula">ArB(OH)2</span>', below: '<span class="formula">Pd(PPh3)4</span>, <span class="formula">K2CO3</span>\nToluol/<span class="formula">H2O</span>, 80 °C\n<b>77%</b>' }
  const a2 = uid('r')
  d.arrows[a2] = { id: a2, kind: 'reaction', x1: 140, y1: 0, x2: 245, y2: 0, above: 'PhMgBr', below: 'THF, 0 °C\n<b>88%</b>' }
  const t = uid('t')
  const top = Math.min(...Object.values(d.atoms).map((a) => a.y))
  d.texts[t] = { id: t, x: -400, y: top - 55, text: '<b>Syntheseschema</b> – Ringfüllungen, Bedingungen und Nummern', size: 18 }
  return d
}

/** Katalysezyklus (Sonogashira-Kupplung): Pd- und Cu-Zyklus greifen ineinander */
export function exampleCycle(): Doc {
  const d = emptyDoc()
  const pd = newCycle(0, 0, 150, 0, 'cw')
  pd.stations = [
    { angle: 270, label: 'R<sup>1</sup>–L<sub>n</sub>Pd(II)–X' },
    { angle: 30, label: 'R<sup>1</sup>–L<sub>n</sub>Pd(II)–C≡C–R<sup>2</sup>' },
    { angle: 180, label: 'L<sub>n</sub>Pd(0)' },
  ]
  pd.branches = [
    { ...newBranch(222, 'in', 150), label: 'R<sup>1</sup>–X', span: 26, reach: 55 },
    { ...newBranch(120, 'out', 150), label: 'R<sup>1</sup>–C≡C–R<sup>2</sup>', span: 26, reach: 55 },
  ]
  d.cycles[pd.id] = pd
  const cu = newCycle(150, -165, 90, 0, 'ccw')
  cu.stations = [
    { angle: 30, label: 'CuX' },
    { angle: 270, label: 'Cu–C≡C–R<sup>2</sup>' },
  ]
  // Durchlauf: Alkin + Base rein, [Base–H]⁺X⁻ raus an derselben Stelle
  cu.branches = [
    { ...newBranch(335, 'in', 90), label: 'H–C≡C–R<sup>2</sup> + Base', span: 26, reach: 50 },
    { ...newBranch(335, 'out', 90), label: '[Base–H]<sup>+</sup>X<sup>−</sup>', span: 26, reach: 46 },
  ]
  d.cycles[cu.id] = cu
  // Schrittbezeichnungen hängen an den Bögen und wandern mit dem Zyklus
  pd.arcLabels = [
    { id: uid('al'), angle: 225, side: 'out', label: '<b>oxidative\nAddition</b>' },
    { id: uid('al'), angle: 330, side: 'in', label: '<b>Trans-\nmetallierung</b>' },
    { id: uid('al'), angle: 105, side: 'in', label: '<b>reduktive\nEliminierung</b>' },
  ]
  const t = uid('t')
  d.texts[t] = { id: t, x: -300, y: -330, text: '<b>Sonogashira-Kupplung</b> – zwei ineinandergreifende Zyklen', size: 18 }
  return d
}
