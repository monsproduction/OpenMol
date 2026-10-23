// 3D-Funktionen: Atome tragen zusätzlich eine Tiefe z (positiv = zum Betrachter).
// Die Zeichenfläche zeigt die Projektion (x, y); Drehungen im Raum verändern x, y und z.
import type { Fragment } from './ocl'
import { cleanCoordinates, oclToFragment, parseStructure } from './ocl'
import { buildGraph, smallestRingOfBond, type Graph } from './chem'
import type { Doc, Id } from './types'
import { emptyDoc, uid } from './types'
import { insertFragment } from './ops'

export type V3 = [number, number, number]

const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm3 = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** Dreht Punkte um den Mittelpunkt: erst um die senkrechte Bildschirmachse (ay), dann um die waagerechte (ax), dann in der Ebene (az) */
export function rotate3(p: V3, c: V3, ax: number, ay: number, az = 0): V3 {
  let [x, y, z] = sub3(p, c)
  // um senkrechte Achse (Bildschirm-y)
  if (ay) {
    const cs = Math.cos(ay)
    const sn = Math.sin(ay)
    ;[x, z] = [x * cs + z * sn, -x * sn + z * cs]
  }
  // um waagerechte Achse (Bildschirm-x); y zeigt im Dokument nach unten
  if (ax) {
    const cs = Math.cos(ax)
    const sn = Math.sin(ax)
    ;[y, z] = [y * cs - z * sn, y * sn + z * cs]
  }
  if (az) {
    const cs = Math.cos(az)
    const sn = Math.sin(az)
    ;[x, y] = [x * cs - y * sn, x * sn + y * cs]
  }
  return [x + c[0], y + c[1], z + c[2]]
}

export function center3(doc: Doc, ids: Iterable<Id>): V3 {
  let x1 = Infinity
  let x2 = -Infinity
  let y1 = Infinity
  let y2 = -Infinity
  let zs = 0
  let n = 0
  for (const id of ids) {
    const a = doc.atoms[id]
    if (!a) continue
    x1 = Math.min(x1, a.x)
    x2 = Math.max(x2, a.x)
    y1 = Math.min(y1, a.y)
    y2 = Math.max(y2, a.y)
    zs += a.z ?? 0
    n++
  }
  return n ? [(x1 + x2) / 2, (y1 + y2) / 2, zs / n] : [0, 0, 0]
}

/** Eigenwerte/-vektoren einer symmetrischen 3×3-Matrix (Jacobi), absteigend sortiert */
export function eigenSym3(m: number[][]): { values: number[]; vectors: V3[] } {
  const a = m.map((r) => [...r])
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] ** 2
    if (off < 1e-14) break
    for (let p = 0; p < 3; p++)
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p]
          const akq = a[k][q]
          a[k][p] = c * akp - s * akq
          a[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k]
          const aqk = a[q][k]
          a[p][k] = c * apk - s * aqk
          a[q][k] = s * apk + c * aqk
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p]
          const vkq = v[k][q]
          v[k][p] = c * vkp - s * vkq
          v[k][q] = s * vkp + c * vkq
        }
      }
  }
  const pairs = [0, 1, 2].map((i) => ({ val: a[i][i], vec: [v[0][i], v[1][i], v[2][i]] as V3 }))
  pairs.sort((p, q) => q.val - p.val)
  return { values: pairs.map((p) => p.val), vectors: pairs.map((p) => p.vec) }
}

/**
 * Ausrichtung einer 3D-Struktur für die Zeichnung: Blickrichtung so, dass möglichst viele Ringe
 * von vorn zu sehen sind (Aromaten flach, Cycloparaphenylen von der Seite), größte Ausdehnung waagerecht.
 * Liefert Dokument-Koordinaten (y nach unten) mit Ursprung im Schwerpunkt.
 */
export function orientForDrawing(pts: V3[], rings: number[][]): { out: V3[]; hoop: boolean } {
  const n = pts.length
  const c: V3 = [0, 0, 0]
  for (const p of pts) for (let k = 0; k < 3; k++) c[k] += p[k] / n
  const q = pts.map((p) => sub3(p, c))
  // Kovarianz der Positionen
  const cov = [0, 1, 2].map((i) => [0, 1, 2].map((j) => q.reduce((s, p) => s + p[i] * p[j], 0) / n))
  const pos = eigenSym3(cov)
  // Ringnormalen (Newell)
  const M = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  let ringCount = 0
  for (const r of rings) {
    if (r.length < 5) continue
    let nx = 0
    let ny = 0
    let nz = 0
    for (let i = 0; i < r.length; i++) {
      const a = q[r[i]]
      const b = q[r[(i + 1) % r.length]]
      nx += (a[1] - b[1]) * (a[2] + b[2])
      ny += (a[2] - b[2]) * (a[0] + b[0])
      nz += (a[0] - b[0]) * (a[1] + b[1])
    }
    const nn = norm3([nx, ny, nz])
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += nn[i] * nn[j]
    ringCount++
  }
  let view: V3
  let hoop = false
  if (ringCount > 0) {
    const e = eigenSym3(M)
    view = e.vectors[0]
    // Ringnormalen liegen in einer Ebene verteilt (z. B. Cycloparaphenylen) → Reifen
    hoop = ringCount >= 4 && e.values[1] > 0.45 * e.values[0]
  } else view = pos.vectors[2]
  view = norm3(view)
  // waagerechte Achse: größte Ausdehnung senkrecht zur Blickrichtung
  let ex = pos.vectors[0]
  ex = norm3(sub3(ex, view.map((v) => v * dot3(ex, view)) as V3))
  if (!isFinite(ex[0]) || Math.hypot(...ex) < 0.5) ex = norm3(cross3(view, [0, 0, 1]))
  const ey = cross3(view, ex) // rechtshändig: ex × ey = view
  let out: V3[] = q.map((p) => [dot3(p, ex), -dot3(p, ey), dot3(p, view)])
  if (hoop) {
    // Reifen leicht von oben betrachten (wie übliche CPP-Darstellungen)
    out = out.map((p) => rotate3(p, [0, 0, 0], (-25 * Math.PI) / 180, 0))
  }
  return { out, hoop }
}

// ---------- Cycloparaphenylen ----------

/** [n]Cycloparaphenylen als ideale 3D-Struktur (ebene Ringe auf einem Reifen), leicht von oben betrachtet */
export function cppFragment(n: number, L: number, tiltDeg = -24): Fragment {
  const R0 = (r: number) => {
    // Abstand der para-Atome benachbarter Ringe minus Bindungslänge
    const f0 = (2 * Math.PI) / n
    const t0: V3 = [Math.cos(0 + Math.PI / 2), 0, Math.sin(0 + Math.PI / 2)]
    const c0: V3 = [r * Math.cos(0), 0, r * Math.sin(0)]
    const t1: V3 = [Math.cos(f0 + Math.PI / 2), 0, Math.sin(f0 + Math.PI / 2)]
    const c1: V3 = [r * Math.cos(f0), 0, r * Math.sin(f0)]
    const a: V3 = [c0[0] + L * t0[0], 0, c0[2] + L * t0[2]]
    const b: V3 = [c1[0] - L * t1[0], 0, c1[2] - L * t1[2]]
    return Math.hypot(a[0] - b[0], a[2] - b[2]) - L
  }
  let lo = L * 0.5
  let hi = L * 40
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2
    if (R0(m) > 0) hi = m
    else lo = m
  }
  const R = (lo + hi) / 2
  const atoms: Fragment['atoms'] = []
  const bonds: Fragment['bonds'] = []
  const ringIds: string[][] = []
  const tilt = (tiltDeg * Math.PI) / 180
  for (let k = 0; k < n; k++) {
    // versetzt, damit kein Ring genau seitlich (hochkant) steht: gerade n um einen halben Ringschritt, ungerade n um
    // einen viertel – sonst liegt bei ungeradem n ein Ring genau bei 180° und erscheint nur als Strich
    const phi = (2 * Math.PI * k) / n + (n % 2 ? Math.PI / (2 * n) : Math.PI / n)
    const c: V3 = [R * Math.cos(phi), 0, R * Math.sin(phi)]
    const t: V3 = [Math.cos(phi + Math.PI / 2), 0, Math.sin(phi + Math.PI / 2)]
    const axis: V3 = [0, 1, 0]
    const ids: string[] = []
    for (let j = 0; j < 6; j++) {
      const th = (j * Math.PI) / 3
      const p: V3 = [
        c[0] + L * (Math.cos(th) * t[0] + Math.sin(th) * axis[0]),
        c[1] + L * (Math.cos(th) * t[1] + Math.sin(th) * axis[1]),
        c[2] + L * (Math.cos(th) * t[2] + Math.sin(th) * axis[2]),
      ]
      const [x, y, z] = rotate3(p, [0, 0, 0], tilt, 0)
      const id = uid('a')
      atoms.push({ id, x, y, z, element: 'C', charge: 0, radical: 0, lonePairs: 0 })
      ids.push(id)
    }
    for (let j = 0; j < 6; j++)
      bonds.push({ id: uid('b'), a1: ids[j], a2: ids[(j + 1) % 6], type: j % 2 === 0 ? 'double' : 'single', doublePos: 'auto' })
    ringIds.push(ids)
  }
  // para-Atome verbinden: Atom 0 (in +t-Richtung) mit Atom 3 (−t) des nächsten Rings
  for (let k = 0; k < n; k++) bonds.push({ id: uid('b'), a1: ringIds[k][0], a2: ringIds[(k + 1) % n][3], type: 'single', doublePos: 'auto' })
  return { atoms, bonds }
}

// ---------- Idealisierte Reifen-Geometrie (Nanohoops, Cycloparaphenylene) ----------

interface RingStep {
  unit: number
  inAtom: Id
  outAtom: Id
}

/**
 * Ein einzelner Makrozyklus aus Einheiten (in Reihenfolge entlang des Rings) in lokalen Koordinaten:
 * Reifenachse = y, Mittelpunkt im Ursprung, noch nicht gekippt. Kreisform (CPP & Co.) oder – wenn sich große
 * Einheiten und Ein-Atom-Brücken abwechseln (Pillararene) – regelmäßiges Prisma. null = passt nicht.
 */
function ringLocal(doc: Doc, units: Id[][], order: RingStep[], frontUnit?: number): Map<Id, V3> | null {
  const L = doc.style.bondLength
  // ebenes 2D-Layout jeder Einheit (regelmäßige Ringe)
  const local = order.map((o) => {
    const pos = units[o.unit].length > 1 ? cleanCoordinates(doc, units[o.unit]) : new Map([[units[o.unit][0], { x: 0, y: 0 }]])
    const pin = pos.get(o.inAtom)!
    const pout = pos.get(o.outAtom)!
    let ex = { x: pout.x - pin.x, y: pout.y - pin.y }
    const w = Math.hypot(ex.x, ex.y)
    ex = w > 1e-6 ? { x: ex.x / w, y: ex.y / w } : { x: 1, y: 0 }
    const ey = { x: -ex.y, y: ex.x }
    const uv = new Map<Id, { u: number; v: number }>()
    for (const [id, p] of pos) uv.set(id, { u: (p.x - pin.x) * ex.x + (p.y - pin.y) * ex.y, v: (p.x - pin.x) * ey.x + (p.y - pin.y) * ey.y })
    return { w, uv }
  })
  const n = order.length
  const out = new Map<Id, V3>()
  // Pillar[n]aren-Typ: große Einheiten (Arene) und einzelne Brückenatome (CH₂) wechseln sich ab.
  // Die Achse CH₂–Aren–CH₂ bleibt gerade (sp²: exocyclische Bindungen auf der Ringachse), geknickt wird nur am
  // Brückenatom → regelmäßiges m-Eck: Arene als aufrechte Wände entlang der Kanten, CH₂ auf den Ecken.
  const single = order.map((o) => units[o.unit].length === 1)
  const alternating = n % 2 === 0 && n >= 6 && single.every((sg, k) => (k % 2 === 0 ? sg === single[0] : sg !== single[0]))
  if (alternating) {
    const shift = single[0] ? 0 : 1 // Reihenfolge mit einem Brückenatom beginnen
    const ord = [...order.slice(shift), ...order.slice(0, shift)]
    const loc = [...local.slice(shift), ...local.slice(0, shift)]
    const m = n / 2
    const E = Math.max(...loc.filter((_l, k) => k % 2 === 1).map((l) => l.w + 2 * L))
    const Rp = E / (2 * Math.sin(Math.PI / m))
    // Drehung: keine Wand genau seitlich (hochkant), bevorzugt eine Wand vorn
    const edgeMid = (j: number, rot: number) => rot + ((j + 0.5) * 2 * Math.PI) / m
    const scoreP = (rot: number) => Math.min(...Array.from({ length: m }, (_x, j) => Math.abs(Math.sin(edgeMid(j, rot)))))
    let bestRot = Math.PI / 2 - edgeMid(0, 0)
    let bestScore = -1
    for (let j = 0; j < m; j++)
      for (const rot of [Math.PI / 2 - edgeMid(j, 0), Math.PI / 2 - edgeMid(j, 0) + Math.PI / m]) {
        const sc = scoreP(rot) + (rot === Math.PI / 2 - edgeMid(j, 0) ? 0.02 : 0)
        if (sc > bestScore + 1e-9) {
          bestScore = sc
          bestRot = rot
        }
      }
    const V = (j: number): V3 => {
      const th = bestRot + (j * 2 * Math.PI) / m
      return [Rp * Math.cos(th), 0, Rp * Math.sin(th)]
    }
    for (let k = 0; k < n; k++) {
      const j = Math.floor(k / 2)
      if (k % 2 === 0) {
        // Brückenatom auf der Ecke
        for (const id of units[ord[k].unit]) out.set(id, V(j))
        continue
      }
      const a0 = V(j)
      const e = norm3(sub3(V(j + 1), a0))
      const start: V3 = [a0[0] + e[0] * L, 0, a0[2] + e[2] * L]
      for (const [id, { u, v }] of loc[k].uv) out.set(id, [start[0] + u * e[0], start[1] + v, start[2] + u * e[2]])
    }
    return out
  }
  // Reifenradius: Sehnen der Einheiten + Verbindungsbindungen schließen den Kreis
  const total = (R: number) => local.reduce((s, l) => s + 2 * Math.asin(Math.min(1, l.w / (2 * R))), 0) + n * 2 * Math.asin(Math.min(1, L / (2 * R)))
  let lo = Math.max(L, ...local.map((l) => l.w)) / 2 + 1e-6
  let hi = L * 400
  if (total(lo) < 2 * Math.PI) return null
  for (let i = 0; i < 100; i++) {
    const m = (lo + hi) / 2
    if (total(m) > 2 * Math.PI) lo = m
    else hi = m
  }
  const R = (lo + hi) / 2
  const beta = 2 * Math.asin(L / (2 * R))
  const P = (phi: number): V3 => [R * Math.cos(phi), 0, R * Math.sin(phi)]
  // Drehung um die Reifenachse: möglichst keine Einheit genau seitlich (hochkant); bevorzugt eine Einheit vorn
  const alphas = local.map((l) => 2 * Math.asin(Math.min(1, l.w / (2 * R))))
  const mids: number[] = []
  {
    let ph = 0
    for (const al of alphas) {
      mids.push(ph + al / 2)
      ph += al + beta
    }
  }
  const score = (rot: number) => Math.min(...mids.map((m) => Math.abs(Math.sin(m + rot))))
  let bestRot = Math.PI / 2 - mids[0]
  let bestScore = -1
  mids.forEach((m, k) => {
    const cands = [Math.PI / 2 - m, Math.PI / 2 - (m + (mids[(k + 1) % mids.length] + (k === mids.length - 1 ? 2 * Math.PI : 0))) / 2]
    cands.forEach((rot, ci) => {
      const sc = score(rot) + (ci === 0 ? 0.02 : 0) // Gleichstand: Einheit vorn
      if (sc > bestScore + 1e-9) {
        bestScore = sc
        bestRot = rot
      }
    })
  })
  // Verbund: die Einheit, an der ein weiterer Zyklus hängt, genau nach vorn → angesetzte Zyklen symmetrisch verteilt
  const fk = frontUnit === undefined ? -1 : order.findIndex((o) => o.unit === frontUnit)
  if (fk >= 0) bestRot = Math.PI / 2 - mids[fk]
  let phi = bestRot
  for (const [k, lk] of local.entries()) {
    const alpha = alphas[k]
    const a = P(phi)
    const b = P(phi + alpha)
    const e = norm3(sub3(b, a))
    for (const [id, { u, v }] of lk.uv) out.set(id, [a[0] + u * e[0], a[1] + v, a[2] + u * e[2]])
    phi += alpha + beta
  }
  return out
}

interface UnitLink {
  atom: Id
  other: Id
  otherUnit: number
  bond: Id
}

/** Reihenfolge der Einheiten entlang eines einfachen Rings (jede Einheit genau zwei Verbindungen) */
function ringOrder(units: Id[][], links: UnitLink[][], members: number[]): RingStep[] | null {
  const order: RingStep[] = []
  const first = members[0]
  let cur = first
  let inAtom = links[first][0].atom
  let cameFrom: Id | null = links[first][0].other
  for (let step = 0; step < members.length; step++) {
    const l = links[cur]
    if (l.length !== 2 || (l[0].atom === l[1].atom && units[cur].length > 1)) return null
    const inLink = l.find((x) => x.atom === inAtom && x.other === cameFrom) ?? l.find((x) => x.atom === inAtom)
    if (!inLink) return null
    const out = l[0] === inLink ? l[1] : l[0]
    order.push({ unit: cur, inAtom, outAtom: out.atom })
    cur = out.otherUnit
    cameFrom = out.atom
    inAtom = out.other
    if (cur === first && step < members.length - 1) return null
  }
  return cur === first ? order : null
}

/** Starre Abbildung (Drehung + Verschiebung) einer ebenen Punktgruppe src auf dieselbe Form dst */
function planarFit(src: V3[], dst: V3[]): ((p: V3) => V3) | null {
  const cen = (ps: V3[]): V3 => ps.reduce<V3>((s, p) => [s[0] + p[0] / ps.length, s[1] + p[1] / ps.length, s[2] + p[2] / ps.length], [0, 0, 0])
  const cs = cen(src)
  const cd = cen(dst)
  let i0 = -1
  for (let i = 0; i < src.length; i++) if (Math.hypot(...sub3(src[i], cs)) > 1e-6) {
    i0 = i
    break
  }
  if (i0 < 0) return (p) => [p[0] - cs[0] + cd[0], p[1] - cs[1] + cd[1], p[2] - cs[2] + cd[2]]
  let i1 = -1
  let best = 1e-6
  for (let i = 0; i < src.length; i++) {
    const c = Math.hypot(...cross3(sub3(src[i0], cs), sub3(src[i], cs)))
    if (c > best) {
      best = c
      i1 = i
    }
  }
  const frame = (ps: V3[], c: V3): [V3, V3, V3] => {
    const e1 = norm3(sub3(ps[i0], c))
    const e3 = i1 >= 0 ? norm3(cross3(sub3(ps[i0], c), sub3(ps[i1], c))) : norm3(cross3(e1, Math.abs(e1[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]))
    return [e1, cross3(e3, e1), e3]
  }
  const fs = frame(src, cs)
  const fd = frame(dst, cd)
  return (p) => {
    const q = sub3(p, cs)
    const a = [dot3(q, fs[0]), dot3(q, fs[1]), dot3(q, fs[2])]
    return [cd[0] + a[0] * fd[0][0] + a[1] * fd[1][0] + a[2] * fd[2][0], cd[1] + a[0] * fd[0][1] + a[1] * fd[1][1] + a[2] * fd[2][1], cd[2] + a[0] * fd[0][2] + a[1] * fd[1][2] + a[2] * fd[2][2]]
  }
}

/**
 * Erkennt Makrozyklen aus Ringeinheiten (z. B. [n]CPP, Pillararene, auch mit anellierten oder substituierten
 * Einheiten) und legt sie idealisiert an: jede Einheit flach und regelmäßig (2D-Layout), tangential auf einem
 * Reifen bzw. als Wand eines Prismas. Mehrere Makrozyklen, die sich Einheiten teilen (z. B. CPP mit eingebauten
 * Pillararenen), werden einzeln aufgebaut und am gemeinsamen Ring zusammengesetzt – jeder angesetzte Zyklus
 * nach außen. Gibt null zurück, wenn die Struktur kein solcher Reifen bzw. Verbund ist.
 */
export function hoopLayout(doc: Doc, g: Graph, ids: Id[], tiltDeg?: number): Map<Id, V3> | null {
  const idSet = new Set(ids)
  const bonds = Object.values(doc.bonds).filter((b) => idSet.has(b.a1) && idSet.has(b.a2))
  // Verbindungsbindungen: liegen in keinem kleinen Ring, aber in einem großen Makrozyklus
  const linkers = bonds.filter((b) => !smallestRingOfBond(g, b, 8) && smallestRingOfBond(g, b, 500))
  if (linkers.length < 3) return null
  const linkerIds = new Set(linkers.map((b) => b.id))
  // Einheiten = Zusammenhangskomponenten ohne Verbindungsbindungen
  const unitOf = new Map<Id, number>()
  const units: Id[][] = []
  for (const id of ids) {
    if (unitOf.has(id)) continue
    const comp: Id[] = []
    const st = [id]
    unitOf.set(id, units.length)
    while (st.length) {
      const c = st.pop()!
      comp.push(c)
      for (const nb of g.adj.get(c) ?? []) {
        if (linkerIds.has(nb.bond.id) || !idSet.has(nb.other.id) || unitOf.has(nb.other.id)) continue
        unitOf.set(nb.other.id, units.length)
        st.push(nb.other.id)
      }
    }
    units.push(comp)
  }
  if (units.length < 3) return null
  const links = units.map(() => [] as UnitLink[])
  for (const b of linkers) {
    const u1 = unitOf.get(b.a1)!
    const u2 = unitOf.get(b.a2)!
    if (u1 === u2) return null
    links[u1].push({ atom: b.a1, other: b.a2, otherUnit: u2, bond: b.id })
    links[u2].push({ atom: b.a2, other: b.a1, otherUnit: u1, bond: b.id })
  }

  // Makrozyklen = zweifach zusammenhängende Blöcke des Einheiten-Graphen (Tarjan über Kanten)
  const disc = new Array(units.length).fill(-1)
  const low = new Array(units.length).fill(0)
  let time = 0
  const edgeStack: string[] = []
  const blocks: Set<string>[] = []
  const dfs = (u: number, viaBond: string | null) => {
    disc[u] = low[u] = time++
    for (const l of links[u]) {
      if (l.bond === viaBond) continue
      const v = l.otherUnit
      if (disc[v] === -1) {
        edgeStack.push(l.bond)
        dfs(v, l.bond)
        low[u] = Math.min(low[u], low[v])
        if (low[v] >= disc[u]) {
          const blk = new Set<string>()
          let e: string | undefined
          do {
            e = edgeStack.pop()
            if (e) blk.add(e)
          } while (e && e !== l.bond)
          blocks.push(blk)
        }
      } else if (disc[v] < disc[u]) {
        edgeStack.push(l.bond)
        low[u] = Math.min(low[u], disc[v])
      }
    }
  }
  dfs(0, null)
  if (disc.some((d) => d === -1)) return null
  // jeder Block muss ein einfacher Ring sein (jede Einheit genau zwei Verbindungen darin)
  const rings: { members: number[]; order: RingStep[] }[] = []
  for (const blk of blocks) {
    const mem = new Set<number>()
    const bl = units.map(() => [] as UnitLink[])
    for (let u = 0; u < units.length; u++)
      for (const l of links[u])
        if (blk.has(l.bond)) {
          mem.add(u)
          bl[u].push(l)
        }
    const members = [...mem]
    if (members.length < 3 || members.some((u) => bl[u].length !== 2)) return null
    const order = ringOrder(units, bl, members)
    if (!order) return null
    rings.push({ members, order })
  }
  if (!rings.length) return null

  // jeden Ring einzeln anlegen; Hauptring (der mit den meisten Anknüpfungen, bevorzugt ein runder Reifen, sonst
  // der größte) so gedreht, dass eine Anknüpfungs-Einheit vorn steht
  const ringsOfUnit = new Map<number, number[]>()
  rings.forEach((r, k) => r.members.forEach((u) => ringsOfUnit.set(u, [...(ringsOfUnit.get(u) ?? []), k])))
  const sharedUnits = (k: number) => rings[k].members.filter((u) => (ringsOfUnit.get(u) ?? []).length > 1)
  const isPrism = (k: number) => rings[k].order.some((o) => units[o.unit].length === 1)
  const scoreRing = (k: number) => sharedUnits(k).length * 1000 + (isPrism(k) ? 0 : 500) + rings[k].members.reduce((s, u) => s + units[u].length, 0)
  const first = rings.map((_r, k) => k).sort((a, b) => scoreRing(b) - scoreRing(a))[0]
  const layouts = rings.map((r, k) => ringLocal(doc, units, r.order, rings.length > 1 && k === first ? rings[k].order.find((o) => sharedUnits(k).includes(o.unit))?.unit : undefined))
  if (layouts.some((l) => !l)) return null
  const out = new Map<Id, V3>()
  if (rings.length === 1) for (const [id, p] of layouts[0]!) out.set(id, p)
  else {
    for (const [id, p] of layouts[first]!) out.set(id, p)
    const placed = new Set([first])
    const queue = [first]
    while (queue.length) {
      const k = queue.shift()!
      // Mittelpunkt des Rings, an den angesetzt wird (zum Bestimmen von „außen“)
      const memAtoms = rings[k].members.flatMap((u) => units[u])
      const ck = memAtoms.reduce<V3>((s, id) => {
        const p = out.get(id)!
        return [s[0] + p[0] / memAtoms.length, s[1] + p[1] / memAtoms.length, s[2] + p[2] / memAtoms.length]
      }, [0, 0, 0])
      for (const u of rings[k].members) {
        for (const j of ringsOfUnit.get(u) ?? []) {
          if (placed.has(j)) continue
          const lay = layouts[j]!
          const shAtoms = units[u]
          const fit = planarFit(
            shAtoms.map((id) => lay.get(id)!),
            shAtoms.map((id) => out.get(id)!),
          )
          if (!fit) return null
          const moved = new Map<Id, V3>()
          for (const [id, p] of lay) moved.set(id, fit(p))
          // angesetzter Ring nach außen: liegt sein Schwerpunkt auf derselben Seite der gemeinsamen Ringebene wie
          // der Mittelpunkt des Hauptrings, an dieser Ebene spiegeln
          const sp = shAtoms.map((id) => out.get(id)!)
          const c0 = sp.reduce<V3>((s, p) => [s[0] + p[0] / sp.length, s[1] + p[1] / sp.length, s[2] + p[2] / sp.length], [0, 0, 0])
          let nrm: V3 = [0, 0, 0]
          for (let i = 0; i < sp.length; i++) {
            const c = cross3(sub3(sp[i], c0), sub3(sp[(i + 1) % sp.length], c0))
            const sgn = dot3(c, nrm) < 0 ? -1 : 1
            nrm = [nrm[0] + c[0] * sgn, nrm[1] + c[1] * sgn, nrm[2] + c[2] * sgn]
          }
          nrm = norm3(nrm)
          const otherAtoms = rings[j].members.filter((x) => x !== u).flatMap((x) => units[x])
          const cj = otherAtoms.reduce<V3>((s, id) => {
            const p = moved.get(id)!
            return [s[0] + p[0] / otherAtoms.length, s[1] + p[1] / otherAtoms.length, s[2] + p[2] / otherAtoms.length]
          }, [0, 0, 0])
          if (dot3(sub3(cj, c0), nrm) * dot3(sub3(ck, c0), nrm) > 0) {
            for (const [id, p] of moved) {
              const dd = dot3(sub3(p, c0), nrm)
              moved.set(id, [p[0] - 2 * dd * nrm[0], p[1] - 2 * dd * nrm[1], p[2] - 2 * dd * nrm[2]])
            }
          }
          for (const [id, p] of moved) if (!out.has(id)) out.set(id, p)
          placed.add(j)
          queue.push(j)
        }
      }
    }
    if (placed.size !== rings.length) return null
  }
  if (ids.some((id) => !out.has(id))) return null
  // Ansicht kippen: einzelner Reifen leicht von oben, Verbund stärker (angesetzte Ringe zeigen dann nach außen)
  const tilt = ((tiltDeg ?? (rings.length > 1 ? -47 : -24)) * Math.PI) / 180
  for (const [id, p] of out) out.set(id, rotate3(p, [0, 0, 0], tilt, 0))
  // Schwerpunkt der Zeichnung beibehalten
  let cx = 0
  let cy = 0
  let qx = 0
  let qy = 0
  let qz = 0
  for (const id of ids) {
    cx += doc.atoms[id].x / ids.length
    cy += doc.atoms[id].y / ids.length
    const q = out.get(id)!
    qx += q[0] / ids.length
    qy += q[1] / ids.length
    qz += q[2] / ids.length
  }
  for (const [id, q] of out) out.set(id, [q[0] - qx + cx, q[1] - qy + cy, q[2] - qz])
  return out
}

/** Pillar[n]aren (1,4-Dimethoxy, CH₂-verbrückt) als 3D-Prisma – für die Vorlagen-Bibliothek */
export function pillarFragment(n: number, L: number): Fragment {
  // SMILES: n Einheiten c1cc(OC)c(cc1OC)C…, letzte Einheit schließt den Makrozyklus
  let smi = 'C1'
  for (let k = 0; k < n; k++) smi += k < n - 1 ? 'c2cc(OC)c(cc2OC)C' : 'c2cc(OC)c1cc2OC'
  const frag = oclToFragment(parseStructure(smi), L)
  const doc = emptyDoc()
  doc.style.bondLength = L
  const sel = insertFragment(doc, frag)
  const hoop = hoopLayout(doc, buildGraph(doc), sel.atoms)
  if (hoop) {
    for (const [id, p] of hoop) {
      doc.atoms[id].x = p[0]
      doc.atoms[id].y = p[1]
      doc.atoms[id].z = p[2]
    }
  }
  return { atoms: Object.values(doc.atoms), bonds: Object.values(doc.bonds) }
}
