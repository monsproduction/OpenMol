// Nur Entwicklung: Nachbauten von Reaktionsschemata aus dem Internet (Test „Kann OpenMol das reproduzieren?“).
// Jeder Nachbau verwendet ausschließlich die Werkzeuge der Claude-Steuerung (dieselben Befehle wie per MCP).
// Aufruf: http://localhost:5173/?demo=nachbau-suzuki (bzw. -diels-alder, -fischer, -robinson, -sn2)
import { getState } from '../store'
import { __runTool as rt, insertAt } from '../tools/aiBridge'

type Builder = () => Promise<void>

const R1 = '<font color="#d42020">R<sup>1</sup></font>'
const R2 = '<font color="#1f3fd8">R<sup>2</sup></font>'
const Ln = 'L<sub><i>n</i></sub>'

/** Katalysezyklus der Suzuki-Kupplung – Vorlage: Wikipedia „Suzuki reaction“,
 *  commons.wikimedia.org/wiki/File:Reaciton_Mechanism_of_Suzuki_reaction.png */
async function suzuki() {
  await rt('new_document', { name: 'Nachbau Suzuki-Zyklus' })
  await rt('add_catalytic_cycle', {
    cx: 0,
    cy: 0,
    radius: 170,
    direction: 'cw',
    stations: [
      { label: Ln + 'Pd<sup>0</sup>', angle: -90 },
      { label: Ln + 'Pd(' + R1 + ')X', angle: -5 },
      { label: Ln + 'Pd(' + R1 + ')O<i>t</i>Bu', angle: 75 },
      { label: Ln + 'Pd(' + R1 + ')' + R2, angle: 195 },
    ],
    branches: [
      { type: 'in', station: 0, label: R1 + '–X' },
      { type: 'in', station: 1, label: 'NaO<i>t</i>Bu' },
      { type: 'out', station: 1, label: 'NaX' },
      { type: 'in', station: 2, label: 'D' },
      { type: 'out', station: 2, label: 'F' },
      { type: 'out', station: 3, label: R1 + '–' + R2 },
    ],
    arc_labels: [
      { angle: -45, label: '<i>OA</i>', side: 'in' },
      { angle: 135, label: '<i>TM</i>', side: 'in' },
      { angle: 240, label: '<i>RE</i>', side: 'in' },
    ],
  })
  for (const [t, x, y] of [
    ['A', 0, -125],
    ['B', 130, 40],
    ['C', 60, 120],
    ['E', -120, 20],
  ] as const)
    await rt('add_text', { text: `<b>${t}</b>`, x, y, size: 30 })
  await rt('add_text', { text: 'Pd-Präkatalysator', x: 0, y: -290, align: 'center' })
  await rt('add_arrow', { x1: 0, y1: -275, x2: 0, y2: -205 })
  await rt('add_text', { text: R2 + '–BY<sub>2</sub>', x: -150, y: 330, align: 'center' })
  await rt('add_arrow', { x1: -90, y1: 325, x2: 20, y2: 325, above: 'NaO<i>t</i>Bu' })
  await rt('add_text', { text: 'Na<sup>+</sup> [' + R2 + '–B(O<i>t</i>Bu)Y<sub>2</sub>]<sup>−</sup>', x: 30, y: 330 })
  // eingerahmte Verbindungen 1–3 (Rahmen mit Schatten hinter die Beschriftung)
  const boxes: [number, number, number, string][] = [
    [103, -217, 62, '1'],
    [-84, -225, 74, '3'],
    [-150, 324, 84, '2'],
  ]
  for (const [cx, cy, w, n] of boxes) {
    await rt('add_shape', { kind: 'rect', x1: cx - w / 2, y1: cy - 17, x2: cx + w / 2, y2: cy + 17, shadow: true })
    await rt('add_text', { text: `<b>${n}</b>`, x: cx, y: cy + 39, align: 'center' })
  }
  await rt('select', { ids: Object.keys(getState().doc.shapes) })
  await rt('run_action', { action: 'send_to_back' })
  await rt('clear_selection', {})
}

// ---------- Hilfen für Mechanismen ----------

/** Struktur einfügen (linke Kante x, Mitte y); Atom-IDs in SMILES-Reihenfolge */
function mol(smiles: string, x: number, y: number): string[] {
  return insertAt(smiles, x, y)
}
const bondOf = (a: string, b: string) => Object.values(getState().doc.bonds).find((x) => (x.a1 === a && x.a2 === b) || (x.a1 === b && x.a2 === a))!.id
const A = (id: string) => ({ atom: id })
const Bd = (a: string, b: string) => ({ bond: bondOf(a, b) })
const LP = (id: string, index = 0) => ({ lone_pair_atom: id, index })
/** Mechanismuspfeil; ohne bend wählt die App die freieste Seite */
async function curved(from: object, to: object, bend?: number) {
  await rt('add_curved_arrow', { from, to, bend, color: '#1f3fd8' })
}
async function red(ids: string[], pairs: [string, string][] = []) {
  await rt('set_atoms', { ids, color: '#d42020' })
  if (pairs.length) await rt('set_bonds', { pairs, color: '#d42020' })
}
/** Ein-Atom-„Molekül“ als Beschriftung, z. B. ⊖:OEt (mit Ladung und freiem Elektronenpaar als Pfeilanker) */
async function labelAtom(label: string, x: number, y: number, charge = 0, lonePairs = 0) {
  const [id] = mol('[O-]', x, y)
  await rt('set_atoms', { ids: [id], label, charge, lone_pairs: lonePairs })
  return id
}
/** Atome an feste Positionen setzen (relativ zu einem Ursprung, Einheiten = Bindungslängen) */
async function place(ox: number, oy: number, pos: [string, number, number][]) {
  const L = getState().doc.style.bondLength
  await rt('edit_objects', { operations: pos.map(([id, x, y]) => ({ op: 'update', kind: 'atoms', id, data: { x: ox + x * L, y: oy + y * L } })) })
}
/** sichtbares H an einem Atom: Platzhalter-Cl aus dem SMILES wird zu H */
async function toH(id: string) {
  await rt('set_atoms', { ids: [id], element: 'H' })
}

/** Mechanismus der Robinson-Anellierung – Vorlage: Wikipedia „Robinson annulation“,
 *  commons.wikimedia.org/wiki/File:Robinson_annulation.png */
async function robinson() {
  await rt('new_document', { name: 'Nachbau Robinson-Anellierung' })
  const L = 40
  // Zeile 1
  const s1 = mol('O=C1CCCCC1(Cl)C', 0, 0)
  await toH(s1[7])
  await rt('set_atoms', { ids: [s1[8]], label: 'Me' })
  const e1 = await labelAtom('OEt', 150, 0, -1, 1)
  await rt('add_arrow', { x1: 210, y1: 0, x2: 320, y2: 0 })
  const s2 = mol('[O-]C1=C(C)CCCC1', 350, 0)
  await rt('set_atoms', { ids: [s2[0]], lone_pairs: 1 })
  await rt('set_atoms', { ids: [s2[3]], label: 'Me' })
  const mvk = mol('C=CC(C)=O', 470, -3 * L)
  // C=C-Ende zum Enolat (wie in der Vorlage)
  if (getState().doc.atoms[mvk[0]].x > getState().doc.atoms[mvk[4]].x) await rt('run_action', { action: 'flip_horizontal', ids: [mvk[0]] })
  await rt('set_atoms', { ids: [mvk[3]], label: 'Me' })
  await red(mvk, [
    [mvk[0], mvk[1]],
    [mvk[1], mvk[2]],
    [mvk[2], mvk[3]],
    [mvk[2], mvk[4]],
  ])
  await rt('add_arrow', { x1: 560, y1: 0, x2: 670, y2: 0 })
  const s3 = mol('O=C1CCCCC1(C)C/C=C(/C)[O-]', 700, 0)
  await rt('set_atoms', { ids: [s3[7]], label: 'Me' })
  await rt('set_atoms', { ids: [s3[11]], label: 'Me' })
  await rt('set_atoms', { ids: [s3[12]], lone_pairs: 1 })
  await red([s3[8], s3[9], s3[10], s3[11], s3[12]], [
    [s3[6], s3[8]],
    [s3[8], s3[9]],
    [s3[9], s3[10]],
    [s3[10], s3[11]],
    [s3[10], s3[12]],
  ])
  const hoet1 = mol('ClO', 930, -1.5 * L)
  await toH(hoet1[0])
  await rt('set_atoms', { ids: [hoet1[1]], label: 'OEt' })
  await rt('add_arrow', { x1: 1000, y1: 0, x2: 1110, y2: 0 })
  const s4 = mol('O=C1CCCCC1(C)CCC(=O)CCl', 1140, 0)
  await toH(s4[13])
  await rt('set_atoms', { ids: [s4[7]], label: 'Me' })
  await red([s4[8], s4[9], s4[10], s4[11], s4[12]], [
    [s4[6], s4[8]],
    [s4[8], s4[9]],
    [s4[9], s4[10]],
    [s4[10], s4[11]],
    [s4[10], s4[12]],
  ])
  const e2 = await labelAtom('OEt', 1330, 2.5 * L, -1, 1)
  // Zeile 1 → 2 (senkrecht)
  await rt('add_arrow', { x1: 1240, y1: 3.5 * L, x2: 1240, y2: 6 * L })
  // Zeile 2 (von rechts nach links)
  const y2 = 9 * L
  const s5 = mol('O=C1CCCCC1(C)CCC(=C)[O-]', 1140, y2)
  await rt('set_atoms', { ids: [s5[7]], label: 'Me' })
  await rt('set_atoms', { ids: [s5[12]], lone_pairs: 1 })
  await red([s5[8], s5[9], s5[10], s5[11], s5[12]], [
    [s5[6], s5[8]],
    [s5[8], s5[9]],
    [s5[9], s5[10]],
    [s5[10], s5[11]],
    [s5[10], s5[12]],
  ])
  await rt('add_arrow', { x1: 1100, y1: y2, x2: 990, y2: y2 })
  const s6 = mol('O=C1CCC2(C)CCCCC2([O-])C1', 800, y2)
  await rt('set_atoms', { ids: [s6[5]], label: 'Me' })
  await rt('set_atoms', { ids: [s6[11]], lone_pairs: 1 })
  await red([s6[0], s6[1], s6[2], s6[3], s6[12]], [
    [s6[0], s6[1]],
    [s6[1], s6[2]],
    [s6[2], s6[3]],
    [s6[3], s6[4]],
    [s6[1], s6[12]],
    [s6[12], s6[10]],
  ])
  const hoet2 = mol('ClO', 700, y2 - 1.5 * L)
  await toH(hoet2[0])
  await rt('set_atoms', { ids: [hoet2[1]], label: 'EtO' })
  await rt('add_arrow', { x1: 760, y1: y2, x2: 650, y2: y2 })
  const s7 = mol('O=C1CCC2(C)CCCCC2(O)C1Cl', 450, y2)
  await toH(s7[13])
  await rt('set_atoms', { ids: [s7[5]], label: 'Me' })
  await red([s7[0], s7[1], s7[2], s7[3], s7[12]], [
    [s7[0], s7[1]],
    [s7[1], s7[2]],
    [s7[2], s7[3]],
    [s7[3], s7[4]],
    [s7[1], s7[12]],
    [s7[12], s7[10]],
  ])
  const e3 = await labelAtom('EtO', 360, y2 - 2 * L, -1, 1)
  await rt('add_arrow', { x1: 410, y1: y2, x2: 300, y2: y2 })
  const s8 = mol('[O-]C1=CC2(O)CCCCC2(C)CC1', 60, y2)
  await rt('set_atoms', { ids: [s8[10]], label: 'Me' })
  await rt('set_atoms', { ids: [s8[0]], lone_pairs: 1 })
  await red([s8[0], s8[1], s8[2], s8[11], s8[12]], [
    [s8[0], s8[1]],
    [s8[1], s8[2]],
    [s8[2], s8[3]],
    [s8[9], s8[11]],
    [s8[11], s8[12]],
    [s8[12], s8[1]],
  ])
  // Zeile 2 → 3
  await rt('add_arrow', { x1: 140, y1: y2 + 3.5 * L, x2: 140, y2: y2 + 6 * L })
  const s9 = mol('O=C1CCC2(C)CCCCC2=C1', 60, y2 + 9 * L)
  await rt('set_atoms', { ids: [s9[5]], label: 'Me' })
  await red([s9[0], s9[1], s9[2], s9[3], s9[11]], [
    [s9[0], s9[1]],
    [s9[1], s9[2]],
    [s9[2], s9[3]],
    [s9[3], s9[4]],
    [s9[1], s9[11]],
    [s9[11], s9[10]],
  ])

  // Elektronenpfeile
  await curved(LP(e1), A(s1[7]))
  await curved(Bd(s1[6], s1[7]), Bd(s1[6], s1[1]))
  await curved(Bd(s1[1], s1[0]), A(s1[0]))
  await curved(LP(s2[0]), Bd(s2[0], s2[1]))
  await curved(Bd(s2[1], s2[2]), A(mvk[0]))
  await curved(Bd(mvk[0], mvk[1]), Bd(mvk[1], mvk[2]))
  await curved(Bd(mvk[2], mvk[4]), A(mvk[4]))
  await curved(LP(s3[12]), Bd(s3[12], s3[10]))
  await curved(Bd(s3[9], s3[10]), A(hoet1[0]))
  await curved(Bd(hoet1[0], hoet1[1]), A(hoet1[1]))
  await curved(LP(e2), A(s4[13]))
  await curved(Bd(s4[12], s4[13]), Bd(s4[12], s4[10]))
  await curved(Bd(s4[10], s4[11]), A(s4[11]))
  await curved(LP(s5[12]), Bd(s5[12], s5[10]))
  await curved(Bd(s5[10], s5[11]), A(s5[1]))
  await curved(Bd(s5[1], s5[0]), A(s5[0]))
  await curved(LP(s6[11]), A(hoet2[0]))
  await curved(Bd(hoet2[0], hoet2[1]), A(hoet2[1]))
  await curved(LP(e3), A(s7[13]))
  await curved(Bd(s7[12], s7[13]), Bd(s7[12], s7[1]))
  await curved(Bd(s7[1], s7[0]), A(s7[0]))
  await curved(LP(s8[0]), Bd(s8[0], s8[1]))
  await curved(Bd(s8[1], s8[2]), Bd(s8[2], s8[3]))
  await curved(Bd(s8[3], s8[4]), A(s8[4]))
  await rt('clear_selection', {})
}

/** Diels-Alder-Stufe aus Woodwards Cortison-Synthese – Vorlage: Wikipedia „Diels–Alder reaction“,
 *  commons.wikimedia.org/wiki/File:Cortisone_Diels-Alder_Woodward.png */
async function dielsAlder() {
  await rt('new_document', { name: 'Nachbau Diels-Alder (Woodward)' })
  await rt('draw_reaction', {
    reactants: ['COC1=CC(=O)C(C)=CC1=O'],
    reagents_above: ['C=CC=C'],
    below: 'PhH, 100 °C, 96 h',
    products: ['COC1=CC(=O)[C@]2(C)CC=CC[C@@H]2C1=O'],
  })
  await rt('contract_groups', {})
  // Methylgruppen als „Me“ wie in der Vorlage (endständige C an C, nicht das Butadien-Reagenz)
  const d = getState().doc
  const deg = (id: string) => Object.values(d.bonds).filter((b) => b.a1 === id || b.a2 === id)
  const me = Object.values(d.atoms)
    .filter((x) => x.element === 'C' && !x.label && deg(x.id).length === 1 && ['single', 'wedge', 'hash'].includes(deg(x.id)[0].type))
    .filter((x) => {
      const b = deg(x.id)[0]
      const o = d.atoms[b.a1 === x.id ? b.a2 : b.a1]
      return o.element === 'C' && deg(o.id).length >= 3
    })
    .map((x) => x.id)
  if (me.length) await rt('set_atoms', { ids: me, label: 'Me' })
}

/** SN2 mit Walden-Umkehr – Vorlage: Wikipedia „SN2 reaction“,
 *  commons.wikimedia.org/wiki/File:SN2_Walden_inversion_example.svg */
async function sn2() {
  await rt('new_document', { name: 'Nachbau SN2 (Walden-Umkehr)' })
  const L = 40
  const blue = '#1f3fd8'
  const redC = '#e02020'
  mol('[Na+]', 0, 0)
  const ho = mol('ClO', 1.3 * L, -0.3 * L)
  await toH(ho[0])
  await rt('set_atoms', { ids: [ho[1]], charge: -1 })
  await place(0, 0, [
    [ho[1], 2, 0],
    [ho[0], 1.55, -0.8],
  ])
  const sub = mol('C[C@@H](F)Br', 3.6 * L, 0)
  // wie in der Vorlage: CH3 oben, F links unten (Strichkeil), Br rechts unten
  await place(0, 0, [
    [sub[1], 4.4, 0.2],
    [sub[0], 4.4, -0.8],
    [sub[2], 3.6, 0.75],
    [sub[3], 5.25, 0.75],
  ])
  await rt('set_atoms', { ids: [sub[0]], label: 'CH3' })
  await rt('set_atoms', { ids: [sub[0], sub[1], sub[2]], color: blue })
  await rt('set_bonds', { pairs: [[sub[0], sub[1]], [sub[1], sub[2]]], color: blue })
  await rt('add_curved_arrow', { from: A(ho[1]), to: A(sub[1]), color: redC })
  await rt('add_curved_arrow', { from: Bd(sub[1], sub[3]), to: A(sub[3]), color: redC })
  await rt('add_arrow', { x1: 6 * L, y1: 0, x2: 7.6 * L, y2: 0 })
  // Übergangszustand: H–O···C(CH3)(F)(H)···Br
  const ts = mol('ClOC(C)(F)(Cl)Br', 8.4 * L, 0)
  await toH(ts[0])
  await toH(ts[5])
  await rt('set_atoms', { ids: [ts[3]], label: 'CH3' })
  // linear O···C···Br, CH3 oben, F und H unten
  await place(0, 0, [
    [ts[0], 8.5, -0.75],
    [ts[1], 9.0, 0],
    [ts[2], 10.4, 0],
    [ts[3], 10.4, -1.0],
    [ts[4], 10.0, 0.85],
    [ts[5], 10.65, 0.9],
    [ts[6], 11.8, 0],
  ])
  await rt('set_bonds', { pairs: [[ts[1], ts[2]], [ts[2], ts[6]]], type: 'dashed' })
  await rt('set_bonds', { pairs: [[ts[2], ts[4]]], type: 'hash' })
  await rt('set_bonds', { pairs: [[ts[2], ts[5]]], type: 'wedge' })
  await rt('set_atoms', { ids: [ts[2], ts[3], ts[4], ts[5]], color: blue })
  await rt('set_bonds', { pairs: [[ts[2], ts[3]], [ts[2], ts[4]], [ts[2], ts[5]]], color: blue })
  const box = Object.values(getState().doc.atoms).filter((x) => ts.includes(x.id))
  const x1 = Math.min(...box.map((x) => x.x)) - 0.7 * L
  const x2 = Math.max(...box.map((x) => x.x)) + 0.8 * L
  const y1 = Math.min(...box.map((x) => x.y)) - 0.6 * L
  const y2 = Math.max(...box.map((x) => x.y)) + 0.6 * L
  await rt('add_shape', { kind: 'brackets', x1, y1, x2, y2, corner: '‡' })
  await rt('add_text', { text: '⊖', x: x2 + 0.35 * L, y: y1 + 1.1 * L, align: 'center' })
  await rt('add_text', { text: 'Na<sup>⊕</sup>', x: x2 + 0.6 * L, y: y2, align: 'left' })
  await rt('add_arrow', { x1: x2 + 0.3 * L, y1: (y1 + y2) / 2, x2: x2 + 2.3 * L, y2: (y1 + y2) / 2 })
  const pr = mol('ClO[C@H](C)F', x2 + 2.8 * L, (y1 + y2) / 2)
  await toH(pr[0])
  await rt('set_atoms', { ids: [pr[3]], label: 'CH3' })
  const px = x2 + 2.8 * L
  const py = (y1 + y2) / 2
  await place(px, py, [
    [pr[0], 0, -0.75],
    [pr[1], 0.45, 0],
    [pr[2], 1.4, -0.3],
    [pr[3], 2.3, -0.75],
    [pr[4], 1.4, 0.7],
  ])
  // Stereochemie wie gezeichnet: F als Strichkeil (Walden-Umkehr gegenüber dem Edukt)
  await rt('set_bonds', { pairs: [[pr[2], pr[4]]], type: 'hash' })
  const fb = Object.values(getState().doc.bonds).find((b) => (b.a1 === pr[4] && b.a2 === pr[2]) || (b.a1 === pr[2] && b.a2 === pr[4]))!
  if (fb.a1 !== pr[2]) await rt('set_bonds', { ids: [fb.id], reverse: true })
  for (const b of Object.values(getState().doc.bonds)) if ((b.a1 === pr[2] || b.a2 === pr[2]) && b.id !== fb.id && (b.type === 'wedge' || b.type === 'hash')) await rt('set_bonds', { ids: [b.id], type: 'single' })
  await rt('set_atoms', { ids: [pr[2], pr[3], pr[4]], color: blue })
  await rt('set_bonds', { pairs: [[pr[2], pr[3]], [pr[2], pr[4]]], color: blue })
  await rt('add_text', { text: 'NaBr', x: x2 + 6.3 * L, y: (y1 + y2) / 2 + 6, align: 'left' })
  await rt('clear_selection', {})
}

/** Pd- und Cu-Zyklus der Sonogashira-Kupplung – Vorlage: Wikipedia „Sonogashira coupling“,
 *  commons.wikimedia.org/wiki/File:Sonogashira-reaction-mechanism.png */
async function sonogashira() {
  await rt('new_document', { name: 'Nachbau Sonogashira (Pd- und Cu-Zyklus)' })
  const alk = (l: string, r: string) => `${l}–C≡C–${r}`
  const blueR2 = '<font color="#1f3fd8">R<sup>2</sup></font>'
  await rt('add_catalytic_cycle', {
    cx: 0,
    cy: 0,
    radius: 150,
    direction: 'cw',
    stations: [
      { label: Ln + 'Pd<sup>0</sup>', angle: -90 },
      { label: Ln + 'Pd(' + R1 + ')X', angle: 0 },
      { label: Ln + 'Pd(' + R1 + ')' + alk('', blueR2).slice(1), angle: 180 },
    ],
    branches: [
      { type: 'in', station: 0, label: R1 + '–X' },
      { type: 'out', station: 2, label: alk(R1, blueR2) },
    ],
    arc_labels: [
      { angle: -45, label: '<b><i>OA</i></b>', side: 'in' },
      { angle: -135, label: '<b><i>RE</i></b>', side: 'in' },
      { angle: 90, label: '<b><i>TM</i></b>', side: 'in' },
    ],
  })
  await rt('add_catalytic_cycle', {
    cx: 0,
    cy: 330,
    radius: 140,
    direction: 'ccw',
    stations: [
      { label: 'CuX', angle: 180 },
      { label: 'CuX / H–C≡C–' + blueR2 + ' (π)', angle: 90 },
      { label: '[Cu–C≡C–' + blueR2 + ']<sub><i>n</i></sub>', angle: 0 },
    ],
    branches: [
      { type: 'in', station: 0, label: 'H–C≡C–' + blueR2 },
      { type: 'in', station: 1, label: 'base' },
      { type: 'out', station: 1, label: 'base·HX' },
    ],
  })
  const [pd, cu] = Object.keys(getState().doc.cycles)
  await rt('run_action', { action: 'dock_cycle', cycle_id: cu, target_cycle_id: pd })
  await rt('add_text', { text: '<i>Pd-Zyklus</i>', x: 0, y: 30, align: 'center' })
  const cuC = getState().doc.cycles[cu]
  await rt('add_text', { text: '<i>Cu-Zyklus</i>', x: cuC.cx, y: cuC.cy, align: 'center' })
  for (const [t, x, y] of [
    ['A', 0, -105],
    ['B', 105, 45],
    ['C', -105, 45],
    ['D', cuC.cx - 105, cuC.cy + 10],
    ['E', cuC.cx, cuC.cy + 100],
    ['F', cuC.cx + 105, cuC.cy - 30],
  ] as const)
    await rt('add_text', { text: `<b><font color="#9aa0a6">${t}</font></b>`, x, y, size: 28, align: 'center' })
  await rt('add_text', { text: 'Pd-Präkatalysator', x: 0, y: -255, align: 'center' })
  await rt('add_arrow', { x1: 0, y1: -240, x2: 0, y2: -185 })
  await rt('clear_selection', {})
}

export const NACHBAUTEN: Record<string, Builder> = { suzuki, robinson, 'diels-alder': dielsAlder, sn2, sonogashira }

export async function buildNachbau(name: string) {
  const b = NACHBAUTEN[name]
  if (!b) return
  await b()
  await rt('run_action', { action: 'fit_view' })
}
