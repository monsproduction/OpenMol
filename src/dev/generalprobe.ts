// Generalprobe: baut das Schema aus Screenshots/Probe.png mit den normalen App-Funktionen nach
// (SMILES-Import, 3D bereinigen, 3D drehen, Spiegeln, Kürzel bilden, Ring füllen, Texte, Pfeile, Klammern).
// Nur für die Entwicklung – wird von der App nicht importiert.
import { buildGraph } from '../model/chem'
import { getScene, sceneBBox } from '../model/scene'
import { applyRingFill, perceiveRings } from '../model/rings'
import { translateSelection } from '../model/ops'
import type { Arrow, Doc, Id, Shape, TextObj } from '../model/types'
import { STYLE_PRESETS, emptyDoc, emptySelection, uid } from '../model/types'
import { commit, getState, replaceDoc, setState } from '../store'
import { clean3D, contractGroups, fitView, flip, insertStructureText, rotate3D } from '../tools/actions'

/** Probe-Bildpunkte (2000 px breite Ansicht) → Dokument-Koordinaten */
const K = 1.29
const P = (x: number, y: number) => ({ x: x * K, y: y * K })

const OMe = 'OC'
const TF = 'OS(=O)(=O)C(F)(F)F'
const BPIN = 'B9OC(C)(C)C(C)(C)O9'

/** Pillar[5]aren, eine Einheit mit den Substituenten a/b statt OMe */
function pillar(a: string, b: string): string {
  let s = `C1c2cc(${a})c(cc2${b})C`
  for (let k = 0; k < 3; k++) s += `c2cc(${OMe})c(cc2${OMe})C`
  return s + `c2cc(${OMe})c1cc2${OMe}`
}

/** [3m]CPP mit m eingebauten Pillar[5]arenen (Muster A p p A p p …) */
function cppPA(m: number): string {
  const pattern: string[] = []
  for (let k = 0; k < m; k++) pattern.push('A', 'p', 'p')
  let d = 10
  const pil = (r2: number) => 'C' + 'c5cc(OC)c(cc5OC)C'.repeat(3) + 'c5cc(OC)c(cc5OC)C%' + r2
  const build = (i: number): string => {
    const last = i === pattern.length - 1
    const pre = i === 0 ? '%99' : ''
    const rest = last ? '' : build(i + 1)
    if (pattern[i] === 'p') {
      const k = d++
      return last ? `c${pre}%${k}ccc%99cc%${k}` : `c${pre}%${k}ccc(-${rest})cc%${k}`
    }
    const r1 = d++
    const r2 = d++
    const a6 = last ? `c%99(c%${r2}c%${r1})` : `c(c%${r2}c%${r1})-${rest}`
    return `c${pre}%${r1}c(${pil(r2)})c${a6}`
  }
  return build(0)
}

const doc = () => getState().doc
const selAtoms = (ids: Id[]) => setState({ sel: { ...emptySelection(), atoms: ids } })

function boxOf(ids: Id[]) {
  const d = doc()
  const set = new Set(ids)
  return sceneBBox(getScene(d), { atoms: set, bonds: new Set(Object.values(d.bonds).filter((b) => set.has(b.a1)).map((b) => b.id)) })!
}

/** Molekül so verschieben, dass die Mitte seines Rahmens bei p liegt */
function moveTo(ids: Id[], p: { x: number; y: number }) {
  const b = boxOf(ids)
  const dx = p.x - (b.x1 + b.x2) / 2
  const dy = p.y - (b.y1 + b.y2) / 2
  commit((d) => translateSelection(d, { ...emptySelection(), atoms: ids, bonds: Object.values(d.bonds).filter((x) => ids.includes(x.a1)).map((x) => x.id) }, dx, dy))
}

async function molecule(smiles: string): Promise<Id[]> {
  const before = new Set(Object.keys(doc().atoms))
  insertStructureText(smiles, { x: 0, y: 0 })
  const ids = Object.keys(doc().atoms).filter((id) => !before.has(id))
  selAtoms(ids)
  return ids
}

/** Ringe (6er) der Atome; Farbe je Ring über die Funktion */
function fillRings(ids: Id[], color: (ring: Id[]) => string | null) {
  const d = doc()
  const set = new Set(ids)
  const rings = perceiveRings(d, buildGraph(d)).filter((r) => r.length === 6 && r.every((a) => set.has(a)))
  commit((dd) => {
    for (const r of rings) {
      const c = color(r)
      if (c) applyRingFill(dd, [r], { mode: 'fill', grad: 'none', c1: c, c2: c, angle: 0, opacity: 1 }, false)
    }
  })
}

/** Nachbarn eines Rings außerhalb des Rings */
function ringSubstituents(d: Doc, r: Id[]): Id[] {
  const set = new Set(r)
  const out: Id[] = []
  for (const b of Object.values(d.bonds)) {
    if (set.has(b.a1) && !set.has(b.a2)) out.push(b.a2)
    if (set.has(b.a2) && !set.has(b.a1)) out.push(b.a1)
  }
  return out
}

/** Pillararen so drehen, dass die Einheit mit den Atomen `front` vorn steht; danach um x kippen */
function pillarView(ids: Id[], front: Id[], tiltX: number) {
  selAtoms(ids)
  rotate3D('x', 24) // Kippung der 3D-Bereinigung zurücknehmen → Prismenachse senkrecht
  const d = doc()
  const c = ids.reduce((s, id) => ({ x: s.x + d.atoms[id].x / ids.length, z: s.z + (d.atoms[id].z ?? 0) / ids.length }), { x: 0, z: 0 })
  const f = front.reduce((s, id) => ({ x: s.x + d.atoms[id].x / front.length, z: s.z + (d.atoms[id].z ?? 0) / front.length }), { x: 0, z: 0 })
  const ang = (Math.atan2(-(f.x - c.x), f.z - c.z) * 180) / Math.PI
  selAtoms(ids)
  rotate3D('y', ang)
  selAtoms(ids)
  rotate3D('x', tiltX)
}

function text(x: number, y: number, html: string, opts: Partial<TextObj> = {}) {
  const id = uid('t')
  commit((d) => {
    d.texts[id] = { id, x, y, text: html, size: d.style.fontSize, ...opts }
  })
  return id
}

function arrow(p1: { x: number; y: number }, p2: { x: number; y: number }, extra: Partial<Arrow> = {}) {
  const id = uid('ar')
  commit((d) => {
    d.arrows[id] = { id, kind: 'reaction', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, above: '', below: '', ...extra }
  })
  return id
}

const GREY = '#b9b9b9'
const BLUE = '#5a73c3'
const ORANGE = '#e8941e'

/** Arenring, der zu dem Pillararen mit den markierten Substituenten gehört? (hat CH2-Nachbarn) */
function isPillarArene(d: Doc, r: Id[]) {
  const subs = ringSubstituents(d, r)
  const ch2 = subs.filter((a) => d.atoms[a] && !d.atoms[a].label && d.atoms[a].element === 'C' && Object.values(d.bonds).filter((b) => b.a1 === a || b.a2 === a).length === 2)
  return ch2.length >= 2
}

async function buildPillarMonomer(subst: string, color: string, center: { x: number; y: number }, mirror: boolean, labelX: boolean) {
  const ids = await molecule(pillar(subst, subst))
  await clean3D()
  // die funktionalisierte Einheit (trägt die Aryl-/OTf-Gruppen) nach vorn
  const d = doc()
  const rings = perceiveRings(d, buildGraph(d)).filter((r) => r.length === 6 && r.every((a) => ids.includes(a)))
  const front = rings.find((r) => ringSubstituents(d, r).some((a) => d.atoms[a].element === 'S' || (d.atoms[a].element === 'C' && rings.some((r2) => r2 !== r && r2.includes(a)))))
  pillarView(ids, front ?? rings[0], subst === TF ? -50 : -18)
  if (mirror) {
    selAtoms(ids)
    flip('h')
  }
  selAtoms(ids)
  contractGroups()
  const left = Object.keys(doc().atoms).filter((id) => ids.includes(id))
  if (labelX)
    commit((dd) => {
      for (const id of left) if (dd.atoms[id].element === 'Cl') {
        dd.atoms[id].element = 'C'
        dd.atoms[id].label = 'X'
      }
    })
  fillRings(left, () => color)
  moveTo(left, center)
  return left
}

async function buildProduct(color: string, center: { x: number; y: number }, mirror: boolean) {
  const ids = await molecule(cppPA(4))
  await clean3D()
  if (mirror) {
    selAtoms(ids)
    flip('h')
  }
  selAtoms(ids)
  contractGroups()
  const left = Object.keys(doc().atoms).filter((id) => ids.includes(id))
  const d = doc()
  // Arene der Pillararene farbig, CPP (Phenylene und gemeinsame Ringe) grau
  fillRings(left, (r) => {
    const subs = ringSubstituents(d, r)
    const hasOMe = subs.some((a) => d.atoms[a]?.label === 'OMe')
    return hasOMe && isPillarArene(d, r) ? color : GREY
  })
  moveTo(left, center)
  // Klammer „n − 3“ um das untere Pillararen samt seinen beiden Phenylenen
  const dd = doc()
  const set = new Set(left)
  const g = buildGraph(dd)
  const rings = perceiveRings(dd, g).filter((r) => r.length === 6 && r.every((a) => set.has(a)))
  // gemeinsame Ringe (2 Aryl- + 2 CH2-Nachbarn): der unterste
  const sharedRings = rings.filter((r) => {
    const subs = ringSubstituents(dd, r)
    return subs.filter((a) => rings.some((r2) => r2 !== r && r2.includes(a))).length === 2 && isPillarArene(dd, r)
  })
  const cy = (r: Id[]) => r.reduce((s, a) => s + dd.atoms[a].y, 0) / r.length
  const bottom = sharedRings.sort((a, b) => cy(b) - cy(a))[0]
  if (bottom) {
    // das ganze untere Pillararen: Atome, die von diesem Ring aus über CH2 erreichbar sind, ohne die Phenylene
    const bset = new Set(bottom)
    const aryl = ringSubstituents(dd, bottom).filter((a) => rings.some((r2) => r2 !== bottom && r2.includes(a)))
    const unit = new Set<Id>(bottom)
    const st = [...bottom]
    while (st.length) {
      const u = st.pop()!
      for (const nb of g.adj.get(u) ?? []) {
        if (unit.has(nb.other.id) || aryl.includes(nb.other.id)) continue
        if (bset.has(u) && aryl.includes(nb.other.id)) continue
        unit.add(nb.other.id)
        st.push(nb.other.id)
      }
    }
    // dazu die beiden Phenylene neben dem gemeinsamen Ring (seitlich ganz, nach oben nur bis zum gemeinsamen Ring)
    const b = boxOf([...unit])
    for (const a of aryl) {
      const r2 = rings.find((r) => r.includes(a))
      if (!r2) continue
      const pb = boxOf(r2)
      b.x1 = Math.min(b.x1, pb.x1)
      b.x2 = Math.max(b.x2, pb.x2)
    }
    const sb = boxOf(bottom)
    b.y1 = Math.min(b.y1, sb.y1 - 30)
    const pad = 12
    const id = uid('s')
    commit((d2) => {
      d2.shapes[id] = { id, kind: 'brackets', x1: b.x1 - pad, y1: b.y1 - pad, x2: b.x2 + pad, y2: b.y2 + pad, sub: 'n − 3' } as Shape
    })
  }
  return left
}

export async function buildGeneralprobe() {
  const d0 = emptyDoc()
  d0.style = { ...STYLE_PRESETS.acs.style }
  replaceDoc(d0, 'Generalprobe')

  // ---------- linke Spalte ----------
  const m2 = await buildPillarMonomer(TF, GREY, P(148, 300), false, false)
  const b2 = boxOf(m2)
  text(P(148, 470).x, b2.y2 + 34, '<b>2</b>', { align: 'center' })
  arrow(P(148, 525), P(148, 632), { below: 'a)' })
  const rac = await buildPillarMonomer('-c4ccc(Cl)cc4', GREY, P(165, 840), false, true)
  const br = boxOf(rac)
  text(P(165, 0).x, br.y2 + 30, 'racemic mixture', { align: 'center' })
  const y3 = br.y2 + 95
  text(P(150, 0).x, y3, '<b>3  X = Cl</b>')
  text(P(150, 0).x, y3 + 58, '<b>1  X = Bpin</b>')
  arrow({ x: P(140, 0).x, y: y3 }, { x: P(140, 0).x, y: y3 + 58 }, { route: 'bracket-h', reach: -60, below: 'b)' })
  arrow({ x: P(148, 0).x, y: y3 + 110 }, { x: P(148, 0).x, y: y3 + 250 }, { below: 'c), d)' })
  text(
    P(50, 0).x,
    y3 + 300,
    'Statistical mixture of isomers:\n<b>[9]CPP-PA<sub>3</sub></b>:   2%, 4 isomers\n<b>[12]CPP-PA<sub>4</sub></b>: 9%, 6 isomers\n<b>[15]CPP-PA<sub>5</sub></b>: 7%, 8 isomers',
  )

  // ---------- Mitte: enantiomerenreine Bausteine ----------
  const pR = await buildPillarMonomer('-c4ccc(' + BPIN + ')cc4', BLUE, P(625, 380), true, false)
  const bR = boxOf(pR)
  text((bR.x1 + bR.x2) / 2, bR.y2 + 40, '<b>p<i>R</i>-1</b>', { align: 'center' })
  text((bR.x1 + bR.x2) / 2, bR.y2 + 76, '93% <i>ee</i>', { align: 'center' })
  const pS = await buildPillarMonomer('-c4ccc(' + BPIN + ')cc4', ORANGE, P(625, 1220), false, false)
  const bS = boxOf(pS)
  text((bS.x1 + bS.x2) / 2, bS.y2 + 40, '<b>p<i>S</i>-1</b>', { align: 'center' })
  text((bS.x1 + bS.x2) / 2, bS.y2 + 76, '97% <i>ee</i>', { align: 'center' })
  arrow(P(808, 360), P(915, 360), { above: 'c), d)' })
  arrow(P(808, 1195), P(915, 1195), { above: 'c), d)' })

  // ---------- rechts: Produkte ----------
  await buildProduct(BLUE, P(1395, 375), false)
  await buildProduct(ORANGE, P(1395, 1195), true)
  const legend = (y: number, cfg: string) =>
    text(
      P(1640, 0).x,
      P(0, y).y,
      `n = 3: <b>all-p<i>${cfg}</i>-[9]CPP-PA<sub>3</sub>:</b>\nn = 4: <b>all-p<i>${cfg}</i>-[12]CPP-PA<sub>4</sub>:</b>\nn = 5: <b>all-p<i>${cfg}</i>-[15]CPP-PA<sub>5</sub>:</b>`,
    )
  legend(673, 'R')
  legend(1494, 'S')
  text(P(1960, 0).x, P(0, 673).y, '3%\n10%\n7%', { align: 'right' })
  text(P(1960, 0).x, P(0, 1494).y, '2%\n6%\n7%', { align: 'right' })

  setState({ sel: emptySelection() })
  fitView()
}
