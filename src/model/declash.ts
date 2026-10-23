// Überlappungen im automatischen 2D-Layout beheben (z. B. ortho-ständige Carbazole wie in 4CzIPN).
// Bindungswinkel haben Vorrang vor Bindungslängen:
// 1. Substituenten (Teile hinter einer Brückenbindung, nicht im Ring) werden auf ihre ideale Richtung gesetzt
//    (120°, äußere Winkelhalbierende; der Substituent symmetrisch zu seiner Bindung, Nitrile gestreckt).
// 2. Überlappungen werden durch Verlängern der verbindenden Bindung aufgelöst: alle beteiligten Substituenten
//    weichen gemeinsam und gleich weit aus (gleichwertige immer gleich), danach wird zurückgenommen, was nicht
//    nötig ist – unbeteiligte Gruppen (z. B. Nitrile, ein nicht eingeengtes Carbazol) bleiben normal lang.
// 3. Nur wenn das nicht reicht: Drehen um den Ankerpunkt (wie bisher, symmetrisch gekoppelt).

export interface P2 {
  x: number
  y: number
}

interface Branch {
  pivot: number
  child: number
  atoms: number[]
}

function segCross(a: P2, b: P2, c: P2, d: P2): boolean {
  const o = (p: P2, q: P2, r: P2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const d1 = o(a, b, c)
  const d2 = o(a, b, d)
  const d3 = o(c, d, a)
  const d4 = o(c, d, b)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/**
 * Verzerrte Einzelringe (3–8 Atome, nicht anelliert) wieder regelmäßig machen – OpenChemLib staucht bei sehr
 * gedrängten Molekülen (z. B. C(Ph)4) einzelne Ringe. Der Ring wird als regelmäßiges Vieleck neu gesetzt: das
 * Ringatom mit dem größten Rest dahinter bleibt stehen, die Ringmitte liegt auf der Achse seiner Bindung nach außen
 * (ideale 120°-Winkel); Substituenten an den übrigen Ringatomen werden starr mitgeführt (Bindung radial nach außen).
 * Gibt true zurück, wenn etwas verändert wurde.
 */
export function regularizeRings(pos: P2[], bonds: [number, number][]): boolean {
  const n = pos.length
  if (n < 3 || !bonds.length) return false
  const adj: number[][] = Array.from({ length: n }, () => [])
  for (const [a, b] of bonds) {
    adj[a].push(b)
    adj[b].push(a)
  }
  const lens = bonds.map(([a, b]) => Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y)).sort((x, y) => x - y)
  const L = lens[lens.length >> 1]
  if (!(L > 0)) return false
  // Brückenbindungen
  const disc = new Array(n).fill(-1)
  const low = new Array(n).fill(0)
  let time = 0
  const bridge = new Set<number>()
  const dfs = (u: number, parent: number) => {
    disc[u] = low[u] = time++
    let skipped = false
    for (const v of adj[u]) {
      if (v === parent && !skipped) {
        skipped = true
        continue
      }
      if (disc[v] === -1) {
        dfs(v, u)
        low[u] = Math.min(low[u], low[v])
        if (low[v] > disc[u]) {
          bridge.add(u * n + v)
          bridge.add(v * n + u)
        }
      } else low[u] = Math.min(low[u], disc[v])
    }
  }
  for (let i = 0; i < n; i++) if (disc[i] === -1) dfs(i, -1)
  const ringNb = (u: number) => adj[u].filter((v) => !bridge.has(u * n + v))
  const side = (from: number, blocked: number) => {
    const seen = new Set([from])
    const st = [from]
    while (st.length) {
      const u = st.pop()!
      for (const v of adj[u]) {
        if ((u === from && v === blocked) || seen.has(v)) continue
        seen.add(v)
        st.push(v)
      }
    }
    return [...seen]
  }
  let changed = false
  const done = new Set<number>()
  for (let s = 0; s < n; s++) {
    if (done.has(s) || ringNb(s).length !== 2) continue
    // Ring ablaufen; nur einfache Kreise (jedes Atom mit genau zwei Ringnachbarn)
    const ring = [s]
    let prev = s
    let cur = ringNb(s)[0]
    let ok = true
    while (cur !== s && ring.length <= 8) {
      if (ringNb(cur).length !== 2) {
        ok = false
        break
      }
      ring.push(cur)
      const nx = ringNb(cur).find((v) => v !== prev)!
      prev = cur
      cur = nx
    }
    ring.forEach((r) => done.add(r))
    if (!ok || cur !== s || ring.length < 3 || ring.length > 8) continue
    const k = ring.length
    // schon regelmäßig genug?
    const rl = ring.map((a, i) => Math.hypot(pos[a].x - pos[ring[(i + 1) % k]].x, pos[a].y - pos[ring[(i + 1) % k]].y) / L)
    if (Math.max(...rl.map((x) => Math.abs(x - 1))) < 0.04) continue
    // Ringatom mit dem größten Rest dahinter bleibt stehen
    const ext = ring.map((a) => adj[a].filter((v) => bridge.has(a * n + v)))
    let anchor = -1
    let best = -1
    ring.forEach((a, i) => {
      if (ext[i].length !== 1) return
      const sz = side(ext[i][0], a).length
      if (sz > best) {
        best = sz
        anchor = i
      }
    })
    const Rc = L / (2 * Math.sin(Math.PI / k))
    const area = ring.reduce((acc, a, i) => acc + pos[a].x * pos[ring[(i + 1) % k]].y - pos[ring[(i + 1) % k]].x * pos[a].y, 0)
    const sense = area >= 0 ? 1 : -1
    let center: P2
    let a0: number
    if (anchor >= 0) {
      const pa = pos[ring[anchor]]
      const px = pos[ext[anchor][0]]
      const ux = pa.x - px.x
      const uy = pa.y - px.y
      const ul = Math.hypot(ux, uy) || 1
      center = { x: pa.x + (ux / ul) * Rc, y: pa.y + (uy / ul) * Rc }
      a0 = Math.atan2(pa.y - center.y, pa.x - center.x)
    } else {
      anchor = 0
      center = { x: ring.reduce((t, a) => t + pos[a].x, 0) / k, y: ring.reduce((t, a) => t + pos[a].y, 0) / k }
      a0 = Math.atan2(pos[ring[0]].y - center.y, pos[ring[0]].x - center.x)
    }
    const np = ring.map((_a, i) => {
      const t = a0 + sense * (((i - anchor + k) % k) * 2 * Math.PI) / k
      return { x: center.x + Rc * Math.cos(t), y: center.y + Rc * Math.sin(t) }
    })
    // Substituenten an den übrigen Ringatomen starr mitführen (Bindung radial nach außen)
    ring.forEach((a, i) => {
      if (i === anchor) return
      const old = { ...pos[a] }
      const nw = np[i]
      const es = ext[i]
      if (!es.length) return
      // Richtung nach außen: ein Substituent auf der Radialen, zwei (geminal) mit der Winkelhalbierenden darauf
      const want = Math.atan2(nw.y - center.y, nw.x - center.x)
      const was = Math.atan2(es.reduce((t, w) => t + pos[w].y - old.y, 0), es.reduce((t, w) => t + pos[w].x - old.x, 0))
      const d = want - was
      const co = Math.cos(d)
      const si = Math.sin(d)
      for (const w of es)
        for (const b of side(w, a)) {
          const dx = pos[b].x - old.x
          const dy = pos[b].y - old.y
          pos[b] = { x: nw.x + dx * co - dy * si, y: nw.y + dx * si + dy * co }
        }
    })
    ring.forEach((a, i) => (pos[a] = np[i]))
    changed = true
  }
  // gestauchte/gestreckte frei drehbare Bindungen (tBu, Ar–B, Ar–Si …) auf Normallänge: die kleinere Seite rückt
  // entlang der Bindung nach; nötige Verlängerungen setzt danach die Überlappungsauflösung gezielt
  for (const [u, v] of bonds) {
    if (!bridge.has(u * n + v)) continue
    const dx = pos[v].x - pos[u].x
    const dy = pos[v].y - pos[u].y
    const l = Math.hypot(dx, dy)
    if (!(l > 0) || Math.abs(l / L - 1) < 0.03) continue
    const sv = side(v, u)
    const su = side(u, v)
    const move = sv.length <= su.length ? sv : su
    const sgn = move === sv ? 1 : -1
    const ds = L - l
    for (const a of move) pos[a] = { x: pos[a].x + ((sgn * dx) / l) * ds, y: pos[a].y + ((sgn * dy) / l) * ds }
    changed = true
  }
  return changed
}

/** Richtungen zweier Reste an einem Ringatom (geminal, z. B. C(Ph)2 im Acridan, gem-Dimethyl): symmetrisch zur äußeren
 *  Winkelhalbierenden, der freie Außenwinkel gleichmäßig auf drei Lücken verteilt (Sechsring: ±40°) */
function geminalTargets(pv: P2, r1: P2, r2: P2): [number, number] | null {
  const a1 = Math.atan2(r1.y - pv.y, r1.x - pv.x)
  const a2 = Math.atan2(r2.y - pv.y, r2.x - pv.x)
  const bx = -(Math.cos(a1) + Math.cos(a2))
  const by = -(Math.sin(a1) + Math.sin(a2))
  if (Math.hypot(bx, by) < 1e-6) return null
  const bis = Math.atan2(by, bx)
  const inner = Math.abs(Math.atan2(Math.sin(a1 - a2), Math.cos(a1 - a2)))
  const half = (2 * Math.PI - inner) / 6
  return [bis - half, bis + half]
}

/**
 * Anellierte Ringsysteme (Naphthalin, Acridan, Carbazol …) wieder regelmäßig machen – OpenChemLib staucht sie bei
 * gedrängten Molekülen (9,9-Diphenylacridan). rings: Ringe als Atomlisten in Ringreihenfolge (3–8 Atome).
 * Jeder Ring soll ein regelmäßiges Vieleck sein (alle Abstände im Ring als Zielwerte); das Ergebnis wird starr auf die
 * alte Lage gelegt, Substituenten wandern mit und stehen danach auf der äußeren Winkelhalbierenden.
 * skip: Atome, deren Ringe nicht angefasst werden (z. B. Metallzentren). Gibt true zurück, wenn etwas verändert wurde.
 */
export function regularizeRingSystems(pos: P2[], bonds: [number, number][], rings: number[][], skip?: boolean[]): boolean {
  const n = pos.length
  const rs = rings.filter((r) => r.length >= 3 && r.length <= 8 && !r.some((a) => skip?.[a]))
  if (rs.length < 2) return false
  const adj: number[][] = Array.from({ length: n }, () => [])
  for (const [a, b] of bonds) {
    adj[a].push(b)
    adj[b].push(a)
  }
  const lens = bonds.map(([a, b]) => Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y)).sort((x, y) => x - y)
  const L = lens[lens.length >> 1]
  if (!(L > 0)) return false
  // Ringe, die eine Bindung teilen, bilden ein System
  const parent = rs.map((_r, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const edgeKey = (a: number, b: number) => (a < b ? a * n + b : b * n + a)
  const edges = rs.map((r) => new Set(r.map((a, i) => edgeKey(a, r[(i + 1) % r.length]))))
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) if ([...edges[i]].some((e) => edges[j].has(e))) parent[find(i)] = find(j)
  const systems = new Map<number, number[][]>()
  rs.forEach((r, i) => systems.set(find(i), [...(systems.get(find(i)) ?? []), r]))
  // Brücken: nur über sie hängen Substituenten frei beweglich am System
  const bridgeSet = new Set<number>()
  {
    const disc = new Array(n).fill(-1)
    const low = new Array(n).fill(0)
    let time = 0
    const dfs = (u: number, par: number) => {
      disc[u] = low[u] = time++
      let skipped = false
      for (const v of adj[u]) {
        if (v === par && !skipped) {
          skipped = true
          continue
        }
        if (disc[v] === -1) {
          dfs(v, u)
          low[u] = Math.min(low[u], low[v])
          if (low[v] > disc[u]) bridgeSet.add(edgeKey(u, v))
        } else low[u] = Math.min(low[u], disc[v])
      }
    }
    for (let i = 0; i < n; i++) if (disc[i] === -1) dfs(i, -1)
  }
  const side = (from: number, blocked: number) => {
    const seen = new Set([from])
    const st = [from]
    while (st.length) {
      const u = st.pop()!
      for (const v of adj[u]) {
        if ((u === from && v === blocked) || seen.has(v)) continue
        seen.add(v)
        st.push(v)
      }
    }
    return [...seen]
  }
  let changed = false
  for (const sys of systems.values()) {
    if (sys.length < 2) continue
    // Zielabstände: jedes Atompaar eines Rings wie im regelmäßigen Vieleck
    const cons = new Map<number, number>()
    for (const r of sys) {
      const k = r.length
      const R = L / (2 * Math.sin(Math.PI / k))
      for (let i = 0; i < k; i++)
        for (let j = i + 1; j < k; j++) {
          const steps = Math.min(j - i, k - (j - i))
          cons.set(edgeKey(r[i], r[j]), 2 * R * Math.sin((Math.PI * steps) / k))
        }
    }
    const list = [...cons].map(([key, d]) => [Math.floor(key / n), key % n, d] as [number, number, number])
    const dev = (P: P2[]) => Math.max(...list.map(([a, b, d]) => Math.abs(Math.hypot(P[a].x - P[b].x, P[a].y - P[b].y) - d) / L))
    if (dev(pos) < 0.04) continue
    const atoms = [...new Set(sys.flat())]
    const P = pos.map((p) => ({ ...p }))
    for (let it = 0; it < 400; it++) {
      for (const [a, b, d] of list) {
        const dx = P[b].x - P[a].x
        const dy = P[b].y - P[a].y
        const l = Math.hypot(dx, dy) || 1e-9
        const f = ((l - d) / l) * 0.5
        P[a] = { x: P[a].x + dx * f, y: P[a].y + dy * f }
        P[b] = { x: P[b].x - dx * f, y: P[b].y - dy * f }
      }
    }
    // nur übernehmen, wenn das System danach wirklich regelmäßig ist (verbrückte Polycyclen wie Strychnin lassen sich
    // nicht aus regelmäßigen Vielecken bauen – dort bleibt das bisherige Layout)
    if (dev(P) >= dev(pos) - 1e-6 || dev(P) > 0.05) continue
    // starr auf die alte Lage legen (Schwerpunkt und mittlere Drehung), damit das System an seinem Platz bleibt
    const c0 = atoms.reduce((t, a) => ({ x: t.x + pos[a].x / atoms.length, y: t.y + pos[a].y / atoms.length }), { x: 0, y: 0 })
    const c1 = atoms.reduce((t, a) => ({ x: t.x + P[a].x / atoms.length, y: t.y + P[a].y / atoms.length }), { x: 0, y: 0 })
    let sxx = 0
    let sxy = 0
    for (const a of atoms) {
      const ox = pos[a].x - c0.x
      const oy = pos[a].y - c0.y
      const nx = P[a].x - c1.x
      const ny = P[a].y - c1.y
      sxx += nx * ox + ny * oy
      sxy += nx * oy - ny * ox
    }
    const th = Math.atan2(sxy, sxx)
    const co = Math.cos(th)
    const si = Math.sin(th)
    const fit = (q: P2) => ({ x: c0.x + (q.x - c1.x) * co - (q.y - c1.y) * si, y: c0.y + (q.x - c1.x) * si + (q.y - c1.y) * co })
    const inSys = new Set(atoms)
    const newPos = new Map(atoms.map((a) => [a, fit(P[a])]))
    // Substituenten (über Brücken) starr mitführen und auf die äußere Winkelhalbierende stellen
    const applyMoves = () => {
    for (const a of atoms) {
      const exo = adj[a].filter((v) => !inSys.has(v) && bridgeSet.has(edgeKey(a, v)))
      if (!exo.length) continue
      const ringNb = adj[a].filter((v) => inSys.has(v))
      const na = newPos.get(a)!
      let targets: number[] | null = null
      if (ringNb.length === 2) {
        const r1 = newPos.get(ringNb[0])!
        const r2 = newPos.get(ringNb[1])!
        if (exo.length === 1) {
          const bx = -((r1.x - na.x) / L + (r2.x - na.x) / L)
          const by = -((r1.y - na.y) / L + (r2.y - na.y) / L)
          if (Math.hypot(bx, by) > 1e-6) targets = [Math.atan2(by, bx)]
        } else if (exo.length === 2) targets = geminalTargets(na, r1, r2)
      }
      const old = pos[a]
      const curAng = exo.map((v) => Math.atan2(pos[v].y - old.y, pos[v].x - old.x))
      // Zuordnung in der bisherigen Reihenfolge (gegen den Uhrzeigersinn um die Winkelhalbierende)
      let order = exo.map((_v, i) => i)
      if (targets && exo.length === 2) {
        const mid = (targets[0] + targets[1]) / 2
        const rel = curAng.map((t) => Math.atan2(Math.sin(t - mid), Math.cos(t - mid)))
        order = rel[0] <= rel[1] ? [0, 1] : [1, 0]
      }
      exo.forEach((v, i) => {
        const want = targets ? targets[order.indexOf(i)] : curAng[i] + th
        const rot = want - curAng[i]
        const c2 = Math.cos(rot)
        const s2 = Math.sin(rot)
        for (const b of side(v, a)) {
          const dx = pos[b].x - old.x
          const dy = pos[b].y - old.y
          pos[b] = { x: na.x + dx * c2 - dy * s2, y: na.y + dx * s2 + dy * c2 }
        }
      })
    }
    }
    // Probe: das Neusetzen darf keine neuen Überlappungen erzeugen (sonst zurück)
    const backup = pos.map((q) => ({ ...q }))
    const closeBefore = closePairs(pos, adj, L, bonds)
    applyMoves()
    for (const a of atoms) pos[a] = newPos.get(a)!
    if (closePairs(pos, adj, L, bonds) > closeBefore) {
      for (let i = 0; i < n; i++) pos[i] = backup[i]
      continue
    }
    changed = true
  }
  return changed
}

/**
 * Gütemaß eines fertigen Layouts (kleiner = besser): Überlappungen und Kreuzungen, gestauchte Bindungen (stark) und
 * verlängerte Bindungen. Zum Vergleich zweier Varianten desselben Moleküls.
 */
export function layoutQuality(pos: P2[], bonds: [number, number][]): number {
  const n = pos.length
  const lens = bonds.map(([a, b]) => Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y))
  const sorted = [...lens].sort((x, y) => x - y)
  const L = sorted[sorted.length >> 1]
  if (!(L > 0)) return 0
  const adj: number[][] = Array.from({ length: n }, () => [])
  for (const [a, b] of bonds) {
    adj[a].push(b)
    adj[b].push(a)
  }
  let q = closePairs(pos, adj, L, bonds)
  for (const l of lens) {
    const r = l / L
    if (r < 0.95) q += (0.95 - r) * 8
    if (r > 1.05) q += (r - 1.05) * 2
  }
  return q
}

/** Layoutfehler: nicht verbundene Atompaare (ohne 1-3-Nachbarn), die sich sehr nahe kommen, und (dreifach gezählt)
 *  sich kreuzende Bindungen */
function closePairs(pos: P2[], adj: number[][], L: number, bonds: [number, number][]): number {
  let c = 0
  for (let i = 0; i < bonds.length; i++)
    for (let j = i + 1; j < bonds.length; j++) {
      const [a, b] = bonds[i]
      const [e, f] = bonds[j]
      if (a === e || a === f || b === e || b === f) continue
      if (segCross(pos[a], pos[b], pos[e], pos[f])) c += 3
    }
  const n = pos.length
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (adj[i].includes(j) || adj[i].some((k) => adj[k].includes(j))) continue
      if (Math.hypot(pos[i].x - pos[j].x, pos[i].y - pos[j].y) < L * 0.6) c++
    }
  return c
}

/**
 * pos: Atompositionen (werden verändert), bonds: Atompaare, rank: Symmetrie-Rang je Atom (gleich = äquivalent).
 * Gibt true zurück, wenn etwas verändert wurde.
 */
export function declash(pos: P2[], bonds: [number, number][], rank: number[], labeled?: boolean[]): boolean {
  const n = pos.length
  if (n < 4 || !bonds.length) return false
  const adj: number[][] = Array.from({ length: n }, () => [])
  for (const [a, b] of bonds) {
    adj[a].push(b)
    adj[b].push(a)
  }
  let L = 0
  for (const [a, b] of bonds) L += Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y)
  L /= bonds.length
  if (!(L > 0)) return false

  // topologisch nahe Paare (1-2, 1-3, 1-4) nicht als Überlappung werten
  const near: Set<number>[] = Array.from({ length: n }, () => new Set<number>())
  for (let s = 0; s < n; s++) {
    let front = [s]
    const seen = new Set([s])
    for (let depth = 0; depth < 3; depth++) {
      const next: number[] = []
      for (const u of front)
        for (const v of adj[u])
          if (!seen.has(v)) {
            seen.add(v)
            next.push(v)
          }
      front = next
    }
    near[s] = seen
  }

  // Mindestabstand nicht direkt verbundener Atome (optional größer für beschriftete Atome)
  const DMIN0 = L * 0.6
  const DLAB = L * 1.05
  const DMIN = labeled?.some(Boolean) ? DLAB : DMIN0
  const lab = labeled ?? []
  const dmin = (i: number, j: number) => (lab[i] || lab[j] ? DLAB : DMIN0)
  const W_CROSS = L * L * 0.6
  // schnelle Nachschlagetabelle statt Mengen (die Kostenfunktion wird sehr oft ausgewertet)
  const nearM = new Uint8Array(n * n)
  for (let i = 0; i < n; i++) for (const j of near[i]) nearM[i * n + j] = 1
  const m = bonds.length
  const ba = Int32Array.from(bonds.map((b) => b[0]))
  const bb = Int32Array.from(bonds.map((b) => b[1]))
  const cost = (P: P2[]) => {
    let c = 0
    for (let i = 0; i < n; i++) {
      const pi = P[i]
      const row = i * n
      for (let j = i + 1; j < n; j++) {
        if (nearM[row + j]) continue
        const dx = pi.x - P[j].x
        if (dx > DMIN || dx < -DMIN) continue
        const dy = pi.y - P[j].y
        if (dy > DMIN || dy < -DMIN) continue
        const d2 = dx * dx + dy * dy
        const dm = dmin(i, j)
        if (d2 < dm * dm) c += (dm - Math.sqrt(d2)) ** 2
      }
    }
    for (let i = 0; i < m; i++) {
      const p1 = P[ba[i]]
      const p2 = P[bb[i]]
      const x1 = Math.min(p1.x, p2.x)
      const x2 = Math.max(p1.x, p2.x)
      const y1 = Math.min(p1.y, p2.y)
      const y2 = Math.max(p1.y, p2.y)
      for (let j = i + 1; j < m; j++) {
        const a = ba[i]
        const b = bb[i]
        const c2 = ba[j]
        const d = bb[j]
        if (a === c2 || a === d || b === c2 || b === d) continue
        const q1 = P[c2]
        const q2 = P[d]
        // Rahmen-Vorfilter
        if (Math.max(q1.x, q2.x) < x1 || Math.min(q1.x, q2.x) > x2 || Math.max(q1.y, q2.y) < y1 || Math.min(q1.y, q2.y) > y2) continue
        if (segCross(p1, p2, q1, q2)) c += W_CROSS
      }
    }
    return c
  }

  let cur = cost(pos)
  if (cur < 1e-9) return false

  // Brückenbindungen (Tarjan) = frei drehbare Verknüpfungen
  const disc = new Array(n).fill(-1)
  const low = new Array(n).fill(0)
  let time = 0
  const bridges: [number, number][] = []
  const dfs = (u: number, parent: number) => {
    disc[u] = low[u] = time++
    for (const v of adj[u]) {
      if (v === parent) continue
      if (disc[v] === -1) {
        dfs(v, u)
        low[u] = Math.min(low[u], low[v])
        if (low[v] > disc[u]) bridges.push([u, v])
      } else low[u] = Math.min(low[u], disc[v])
    }
  }
  for (let i = 0; i < n; i++) if (disc[i] === -1) dfs(i, -1)

  const side = (from: number, blocked: number) => {
    const seen = new Set([from])
    const st = [from]
    while (st.length) {
      const u = st.pop()!
      for (const v of adj[u]) {
        if ((u === from && v === blocked) || seen.has(v)) continue
        seen.add(v)
        st.push(v)
      }
    }
    return [...seen]
  }
  const branches: Branch[] = []
  for (const [u, v] of bridges) {
    const sv = side(v, u)
    const su = side(u, v)
    // kleinere Seite drehen; einzelne Endatome (H-lose Stummel) lohnen sich nicht
    const br = sv.length <= su.length ? { pivot: u, child: v, atoms: sv } : { pivot: v, child: u, atoms: su }
    if (br.atoms.length < 2 || br.atoms.length > n * 0.6) continue
    branches.push(br)
  }
  if (!branches.length) return false

  // symmetrisch gleichwertiger Partner je Zweig
  const partner = (b: Branch) =>
    branches.find(
      (o) =>
        o !== b &&
        rank[o.pivot] === rank[b.pivot] &&
        rank[o.child] === rank[b.child] &&
        o.atoms.length === b.atoms.length &&
        !o.atoms.some((a) => b.atoms.includes(a)),
    ) ?? null

  const rotated = (P: P2[], br: Branch, deg: number) => {
    const c = P[br.pivot]
    const t = (deg * Math.PI) / 180
    const co = Math.cos(t)
    const si = Math.sin(t)
    for (const a of br.atoms) {
      const dx = P[a].x - c.x
      const dy = P[a].y - c.y
      P[a] = { x: c.x + dx * co - dy * si, y: c.y + dx * si + dy * co }
    }
  }

  // große Moleküle: gröberes Raster, damit das Aufräumen flott bleibt
  if (n > 400) return false
  const orig = pos.map((p) => ({ ...p }))
  const origCost = cur
  const angOf = (v: P2) => Math.atan2(v.y, v.x)
  const rotateSet = (P: P2[], atoms: number[], center: P2, rad: number) => {
    const co = Math.cos(rad)
    const si = Math.sin(rad)
    const c = { ...center }
    for (const a of atoms) {
      const dx = P[a].x - c.x
      const dy = P[a].y - c.y
      P[a] = { x: c.x + dx * co - dy * si, y: c.y + dx * si + dy * co }
    }
  }
  const norm = (rad: number) => Math.atan2(Math.sin(rad), Math.cos(rad))

  // 1) Bindungswinkel idealisieren: Substituent an einem Ringatom (3 Nachbarn) auf die äußere Winkelhalbierende
  //    (120°), und der Substituent selbst symmetrisch zu dieser Bindung (Carbazol) bzw. gestreckt (Nitril)
  const inBranch = (br: Branch) => new Set(br.atoms)
  // geminale Reste an einem Ringatom (zwei Ringnachbarn + zwei frei drehbare Reste): gleichmäßig auffächern
  {
    const isBr = new Set(bridges.flatMap(([u, v]) => [u * n + v, v * n + u]))
    for (let c = 0; c < n; c++) {
      if (adj[c].length !== 4) continue
      const ringNb = adj[c].filter((v) => !isBr.has(c * n + v))
      const exo = adj[c].filter((v) => isBr.has(c * n + v))
      if (ringNb.length !== 2 || exo.length !== 2) continue
      const sides = exo.map((v) => side(v, c))
      if (sides.some((s) => s.length > n * 0.6)) continue
      const t = geminalTargets(pos[c], pos[ringNb[0]], pos[ringNb[1]])
      if (!t) continue
      const pc = pos[c]
      const ang = exo.map((v) => angOf({ x: pos[v].x - pc.x, y: pos[v].y - pc.y }))
      const mid = (t[0] + t[1]) / 2
      const rel = ang.map((a2) => norm(a2 - mid))
      const order = rel[0] <= rel[1] ? [0, 1] : [1, 0]
      const P = pos.map((p) => ({ ...p }))
      exo.forEach((_v, i) => rotateSet(P, sides[i], pc, norm(t[order.indexOf(i)] - ang[i])))
      // nur übernehmen, wenn es die Überlappungen nicht vergrößert
      const cP = cost(P)
      if (cP <= cur + 1e-9) {
        for (let i = 0; i < n; i++) pos[i] = P[i]
        cur = cP
      }
    }
  }
  for (const br of branches) {
    const set = inBranch(br)
    const outer = adj[br.pivot].filter((x) => !set.has(x))
    if (outer.length === 2) {
      const pv = pos[br.pivot]
      const u = outer.map((o) => {
        const d = { x: pos[o].x - pv.x, y: pos[o].y - pv.y }
        const l = Math.hypot(d.x, d.y) || 1
        return { x: d.x / l, y: d.y / l }
      })
      const ideal = { x: -(u[0].x + u[1].x), y: -(u[0].y + u[1].y) }
      if (Math.hypot(ideal.x, ideal.y) > 1e-6) {
        const curDir = { x: pos[br.child].x - pv.x, y: pos[br.child].y - pv.y }
        rotateSet(pos, br.atoms, pv, norm(angOf(ideal) - angOf(curDir)))
      }
    }
    const inner = adj[br.child].filter((x) => x !== br.pivot && set.has(x))
    if (inner.length === 1 || inner.length === 2) {
      const ch = pos[br.child]
      const want = angOf({ x: ch.x - pos[br.pivot].x, y: ch.y - pos[br.pivot].y })
      const v = inner.map((o) => {
        const d = { x: pos[o].x - ch.x, y: pos[o].y - ch.y }
        const l = Math.hypot(d.x, d.y) || 1
        return { x: d.x / l, y: d.y / l }
      })
      const bis = inner.length === 2 ? { x: v[0].x + v[1].x, y: v[0].y + v[1].y } : v[0]
      if (Math.hypot(bis.x, bis.y) > 1e-6) {
        rotateSet(
          pos,
          br.atoms.filter((a2) => a2 !== br.child),
          ch,
          norm(want - angOf(bis)),
        )
      }
    }
  }
  cur = cost(pos)

  // 1b) Vierbindiges Zentrum mit drei oder vier sperrigen Resten (C(Ph)4, Ph3C–R, Ar3Si–R …) kollidiert in der
  //     120°/60°-Anordnung → Kreuz (90°) wie in ChemDraw; der größte Rest bleibt stehen, die anderen werden starr um
  //     das Zentrum gedreht. Nur übernehmen, wenn es die Überlappung verringert.
  if (cur > 1e-9) {
    const isBridge = new Set(bridges.flatMap(([u, v]) => [u * n + v, v * n + u]))
    for (let c = 0; c < n; c++) {
      if (adj[c].length !== 4 || !adj[c].every((v) => isBridge.has(c * n + v))) continue
      const sides = adj[c].map((v) => side(v, c))
      if (sides.filter((s) => s.length >= 2).length < 3) continue
      const pc = pos[c]
      const ang = adj[c].map((v) => angOf({ x: pos[v].x - pc.x, y: pos[v].y - pc.y }))
      let big = 0
      sides.forEach((s, i) => {
        if (s.length > sides[big].length) big = i
      })
      // im Uhrzeigersinn vom größten Rest aus geordnet → Reihenfolge der Reste bleibt erhalten
      const order = [0, 1, 2, 3].sort((i, j) => ((ang[i] - ang[big] + 4 * Math.PI) % (2 * Math.PI)) - ((ang[j] - ang[big] + 4 * Math.PI) % (2 * Math.PI)))
      const P = pos.map((p) => ({ ...p }))
      order.forEach((i, k) => {
        if (k) rotateSet(P, sides[i], pc, norm(ang[big] + (k * Math.PI) / 2 - ang[i]))
      })
      const cP = cost(P)
      if (cP < cur - 1e-9) {
        for (let i = 0; i < n; i++) pos[i] = P[i]
        cur = cP
      }
    }
  }

  // 2) Platz schaffen, ohne die Winkel am Gerüst zu ändern:
  //    • Verlängern der verbindenden Bindung (Richtung bleibt ideal),
  //    • Wegdrehen des Substituenten um sein Anknüpfungsatom (die Bindung zum Gerüst bleibt, nur der Substituent
  //      dreht sich etwas aus der Symmetrie – so stehen z. B. zwei ortho-Carbazole nebeneinander, ohne dass die
  //      Bindungen sehr lang werden).
  //    Gleichwertige Zweige (Symmetrieklasse) immer gemeinsam. Zuerst nur die äußersten Substituenten; Gruppen
  //    darin (tBu am Carbazol) nur, wenn sie danach selbst noch kollidieren.
  const atomSets = branches.map((b) => new Set(b.atoms))
  const isNested = (i: number) =>
    branches.some((o, j) => j !== i && o.atoms.length > branches[i].atoms.length && branches[i].atoms.every((x) => atomSets[j].has(x)))
  const makeGroups = (bs: Branch[]) => {
    const groups = new Map<string, Branch[]>()
    for (const br of bs) {
      const key = rank[br.pivot] + ':' + rank[br.child] + ':' + br.atoms.length
      groups.set(key, [...(groups.get(key) ?? []), br])
    }
    return [...groups.values()].map((g) => g.filter((x, i) => !g.slice(0, i).some((o) => o.atoms.some((a2) => x.atoms.includes(a2)))))
  }
  const topGroups = makeGroups(branches.filter((_b, i) => !isNested(i)))
  const nestedGroups = makeGroups(branches.filter((_b, i) => isNested(i)))
  const stretched = new Map<Branch[], number>()
  const twisted = new Map<Branch[], number[]>()
  const flipped = new Set<Branch[]>()
  // auch große Schritte: eine Überkreuzung löst sich oft erst bei deutlicher Verlängerung (danach wird fein gekürzt)
  const STRETCH = [0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.5, 2].map((k) => k * L)
  const TWIST = n > 160 ? [8, 20, 35] : [4, 8, 14, 22, 32]
  const ALLOW_TWIST = false
  // Kosten: quadratisch (lieber mehrere etwas als eine sehr stark); kleine Gruppen (CN, OMe) teurer – den Platz
  // sollen die sperrigen Substituenten bekommen. 30° Drehung kosten so viel wie eine Bindungslänge Verlängerung.
  const sizeW = (g: Branch[]) => 1 + 4 / Math.max(1, g[0]?.atoms.length ?? 1)
  const W = L * L * 0.06
  const penalty = () => {
    let sum = 0
    for (const [g, s2] of stretched) sum += (s2 / L) ** 2 * W * g.length * sizeW(g)
    for (const [g, tw] of twisted) for (const t of tw) sum += (t / 30) ** 2 * W * sizeW(g)
    // Umklappen ändert keine Länge und keinen Winkel → sehr günstig, nur als Tie-Breaker
    sum += flipped.size * W * 0.05
    return sum
  }
  const shift = (P: P2[], g: Branch[], ds: number) => {
    for (const br of g) {
      const d = { x: P[br.child].x - P[br.pivot].x, y: P[br.child].y - P[br.pivot].y }
      const l = Math.hypot(d.x, d.y) || 1
      for (const a2 of br.atoms) P[a2] = { x: P[a2].x + (d.x / l) * ds, y: P[a2].y + (d.y / l) * ds }
    }
  }
  const twist = (P: P2[], g: Branch[], degs: number[]) => {
    g.forEach((br, k) => {
      if (!degs[k]) return
      rotateSet(
        P,
        br.atoms.filter((x) => x !== br.child),
        P[br.child],
        (degs[k] * Math.PI) / 180,
      )
    })
  }
  // Umklappen: Substituent an seiner Bindungsachse spiegeln (Biaryle wie BINAP: Gruppen nach außen statt
  // aufeinander zu); Längen und Winkel bleiben vollständig erhalten
  const flip = (P: P2[], g: Branch[]) => {
    for (const br of g) {
      const a0 = P[br.pivot]
      const a1 = P[br.child]
      const dx = a1.x - a0.x
      const dy = a1.y - a0.y
      const l2 = dx * dx + dy * dy || 1
      for (const x of br.atoms) {
        if (x === br.child) continue
        const px = P[x].x - a0.x
        const py = P[x].y - a0.y
        const t = (px * dx + py * dy) / l2
        const fx = t * dx
        const fy = t * dy
        P[x] = { x: a0.x + 2 * fx - px, y: a0.y + 2 * fy - py }
      }
    }
  }
  // Atome, die gerade an einer Überlappung (zu nah / Bindungen gekreuzt) beteiligt sind
  const clashAtoms = (P: P2[]) => {
    const out = new Set<number>()
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        if (nearM[i * n + j]) continue
        const dx = P[i].x - P[j].x
        const dy = P[i].y - P[j].y
        const dm = dmin(i, j)
        if (dx * dx + dy * dy < dm * dm) {
          out.add(i)
          out.add(j)
        }
      }
    for (let i = 0; i < m; i++)
      for (let j = i + 1; j < m; j++) {
        const a = ba[i]
        const b = bb[i]
        const c2 = ba[j]
        const d = bb[j]
        if (a === c2 || a === d || b === c2 || b === d) continue
        if (segCross(P[a], P[b], P[c2], P[d])) [a, b, c2, d].forEach((x) => out.add(x))
      }
    return out
  }
  // Symmetrie beim Wegdrehen wahren: Ein einzelner Substituent auf einer Spiegelachse (zwei gleichwertige Nachbarn
  // am Anknüpfungspunkt) bleibt symmetrisch; gleichwertige Zweige müssen danach Spiegel-/Drehbilder bleiben
  // (gleiche Abstände ihrer Atome zur Molekülmitte).
  const center = orig.reduce((acc, p) => ({ x: acc.x + p.x / n, y: acc.y + p.y / n }), { x: 0, y: 0 })
  const onMirror = (g: Branch[]) => {
    if (g.length !== 1) return false
    const br = g[0]
    const set = new Set(br.atoms)
    const outer = adj[br.pivot].filter((x) => !set.has(x))
    return outer.length === 2 && rank[outer[0]] === rank[outer[1]]
  }
  const signature = (P: P2[], br: Branch) => br.atoms.map((a2) => Math.hypot(P[a2].x - center.x, P[a2].y - center.y)).sort((p, q) => p - q)
  const asym = (P: P2[], g: Branch[]) => {
    const s0 = signature(P, g[0])
    let worst = 0
    for (const br of g.slice(1)) {
      const s1 = signature(P, br)
      for (let k = 0; k < Math.min(s0.length, s1.length); k++) worst = Math.max(worst, Math.abs(s1[k] - s0[k]))
    }
    return worst
  }
  // die Abweichung darf durch das Drehen nicht wachsen (die Ausgangslage muss nicht exakt symmetrisch sein)
  const stillSymmetric = (P: P2[], g: Branch[]) => g.length < 2 || asym(P, g) <= asym(pos, g) + L * 0.03
  const everInvolved = new Set<Branch[]>()
  const optimize = (groupList: Branch[][]) => {
    for (let iter = 0; iter < 40 && cur > 1e-9; iter++) {
      const base = cur + penalty()
      const hit = clashAtoms(pos)
      const involved = groupList.filter((g) => g.some((br) => br.atoms.some((a2) => hit.has(a2))))
      for (const g of involved) everInvolved.add(g)
      if (!involved.length) break
      let best: { P: P2[]; c: number; apply: () => void } | null = null
      const consider = (P: P2[], apply: () => void, undoPen: () => void) => {
        const c = cost(P) + penalty()
        undoPen()
        if (!best || c < best.c) best = { P, c, apply }
      }
      // a) alle Beteiligten gemeinsam verlängern
      const stretchMoves: Branch[][][] = [involved, ...involved.map((g) => [g])]
      for (const mv of stretchMoves)
        for (const ds of STRETCH) {
          if (mv.some((g) => (stretched.get(g) ?? 0) + ds > L * 2)) continue
          const P = pos.map((p) => ({ ...p }))
          for (const g of mv) shift(P, g, ds)
          const old = mv.map((g) => stretched.get(g) ?? 0)
          mv.forEach((g, k) => stretched.set(g, old[k] + ds))
          consider(
            P,
            () => mv.forEach((g, k) => stretched.set(g, old[k] + ds)),
            () => mv.forEach((g, k) => stretched.set(g, old[k])),
          )
        }
      // c) eine Klasse umklappen (einmal je Klasse)
      for (const g of involved) {
        if (flipped.has(g) || onMirror(g)) continue
        const P = pos.map((p) => ({ ...p }))
        flip(P, g)
        if (!stillSymmetric(P, g)) continue
        flipped.add(g)
        consider(
          P,
          () => flipped.add(g),
          () => flipped.delete(g),
        )
      }
      // b) eine Klasse wegdrehen – nur wenn ausdrücklich erlaubt (Standard: aus; Substituenten bleiben symmetrisch
      //    zu ihrer Bindung, es wird nur so weit wie nötig verlängert)
      for (const g of ALLOW_TWIST ? involved : []) {
        if (onMirror(g)) continue
        const prev = twisted.get(g) ?? g.map(() => 0)
        const patterns = g.length > 1 ? [g.map(() => 1), g.map((_x, k) => (k % 2 ? -1 : 1))] : [[1]]
        for (const pat of patterns)
          for (const a of TWIST)
            for (const sg of [1, -1]) {
              const degs = pat.map((x) => x * a * sg)
              const next = prev.map((t, k) => t + degs[k])
              if (next.some((t) => Math.abs(t) > 45)) continue
              const P = pos.map((p) => ({ ...p }))
              twist(P, g, degs)
              if (!stillSymmetric(P, g)) continue
              twisted.set(g, next)
              consider(
                P,
                () => twisted.set(g, next),
                () => twisted.set(g, prev),
              )
            }
      }
      const bb2 = best as { P: P2[]; c: number; apply: () => void } | null
      if (!bb2 || bb2.c >= base - 1e-6) break
      for (let i = 0; i < n; i++) pos[i] = bb2.P[i]
      bb2.apply()
      cur = cost(pos)
    }
  }
  // Ganzen Ablauf (Optimieren + Zurücknehmen) einmal ohne und einmal je mit vorab umgeklapptem Substituent
  // rechnen; das beste Ergebnis gewinnt (Umklappen hilft oft erst zusammen mit den übrigen Schritten).
  const pos0 = pos.map((p) => ({ ...p }))
  const cur0 = cur
  const runPhase = (pre: Branch[] | null, allAtOnce = false) => {
    for (let i = 0; i < n; i++) pos[i] = { ...pos0[i] }
    cur = cur0
    stretched.clear()
    twisted.clear()
    flipped.clear()
    everInvolved.clear()
    if (pre) {
      flip(pos, pre)
      flipped.add(pre)
      cur = cost(pos)
    }
    if (allAtOnce) optimize([...topGroups, ...nestedGroups])
    else {
      optimize(topGroups)
      if (cur > 1e-9 && nestedGroups.length) optimize([...topGroups, ...nestedGroups])
    }

    // Zurücknehmen, soweit es ohne (neue) Überlappung geht: a) alle Verlängerungen gemeinsam und gleichmäßig,
    // b) Drehungen gemeinsam, c) unbeteiligte Klassen ganz auf Normallänge (kleine zuerst)
    const tryApply = (f: (P: P2[]) => void) => {
      const P = pos.map((p) => ({ ...p }))
      f(P)
      const c = cost(P)
      if (c > cur + 1e-9) return false
      for (let i = 0; i < n; i++) pos[i] = P[i]
      cur = c
      return true
    }
    const active = () => [...stretched.entries()].filter(([, s2]) => s2 > 1e-6)
    for (const k of [0.5, 0.25, 0.1, 0.05, 0.02, 0.01]) {
      for (let rep = 0; rep < 20; rep++) {
        const act = active()
        if (!act.length) break
        const backs = act.map(([, s2]) => Math.min(s2, k * L))
        if (!tryApply((P) => act.forEach(([g], i) => shift(P, g, -backs[i])))) break
        act.forEach(([g, s2], i) => stretched.set(g, s2 - backs[i]))
      }
    }
    for (const k of [10, 5, 2]) {
      for (let rep = 0; rep < 20; rep++) {
        const act = [...twisted.entries()].filter(([, tw]) => tw.some((t) => Math.abs(t) > 0.5))
        if (!act.length) break
        const steps = act.map(([, tw]) => tw.map((t) => -Math.sign(t) * Math.min(Math.abs(t), k)))
        if (!tryApply((P) => act.forEach(([g], i) => twist(P, g, steps[i])))) break
        act.forEach(([g, tw], i) => twisted.set(g, tw.map((t, j) => t + steps[i][j])))
      }
    }
    // jede Klasse einzeln noch fein kürzen, wo Platz übrig ist (so kurz wie möglich, ohne Überlappung)
    for (const [g] of active())
      for (const k of [0.1, 0.05, 0.02, 0.01])
        for (let guard = 0; guard < 40; guard++) {
          const left = stretched.get(g) ?? 0
          if (left < 1e-6) break
          const d = Math.min(left, k * L)
          if (!tryApply((P) => shift(P, g, -d))) break
          stretched.set(g, left - d)
        }
    for (const [g, s2] of active()
      .filter(([g]) => !everInvolved.has(g))
      .sort((p, q) => p[0][0].atoms.length - q[0][0].atoms.length)) {
      if (tryApply((P) => shift(P, g, -s2))) stretched.set(g, 0)
    }
    return { P: pos.map((p) => ({ ...p })), c: cur, pen: penalty() }
  }
  // Umklappen eines in sich symmetrischen Substituenten (Phenyl, Carbazol, tBu …) ändert nichts → nicht probieren
  const symmetricAboutBond = (br: Branch) => {
    const inner = adj[br.child].filter((x) => x !== br.pivot)
    return inner.length <= 1 || inner.every((x) => rank[x] === rank[inner[0]])
  }
  const results = [runPhase(null)]
  if (results[0].c > 1e-9 || results[0].pen > W * 0.5) {
    const hit0 = clashAtoms(pos0)
    const cands = topGroups
      .filter((g) => !onMirror(g) && !g.every(symmetricAboutBond) && g.some((br) => br.atoms.some((x) => hit0.has(x))))
      .slice(0, 6)
    for (const g of cands) results.push(runPhase(g))
    // nur wenn es sonst deutlich gestreckt bleibt: innere Gruppen von Anfang an mitbewegen (z. B. PPh2 drehen statt
    // die Biarylbindung zu verlängern)
    const bestSoFar = Math.min(...results.map((r) => r.c * 20 + r.pen))
    if (nestedGroups.length && bestSoFar > W * 1.5) for (const pre of [null, ...cands]) results.push(runPhase(pre, true))
  }
  const score = (r: { c: number; pen: number }) => r.c * 20 + r.pen
  const bestRun = results.reduce((p, q) => (score(q) < score(p) - 1e-9 ? q : p))
  for (let i = 0; i < n; i++) pos[i] = bestRun.P[i]
  cur = bestRun.c

  // 3) nur falls noch nötig: Drehen um den Ankerpunkt (letzter Ausweg, deutlich teurer als Verlängern)
  const step = n > 150 ? 10 : 5
  const ANGLES: number[] = []
  for (let a2 = step; a2 <= 90; a2 += step) ANGLES.push(a2, -a2)
  const rotatePhase = (penalty: number) => {
    for (let iter = 0; iter < 10 && cur > 1e-9; iter++) {
      let best: { P: P2[]; c: number } | null = null
      for (const br of branches) {
        const pt = partner(br)
        for (const ang of ANGLES) {
          const signs = pt ? [1, -1] : [0]
          for (const sg of signs) {
            const P = pos.map((p) => ({ ...p }))
            rotated(P, br, ang)
            if (pt) rotated(P, pt, ang * sg)
            const c = cost(P) + Math.abs(ang) * L * L * penalty * (pt ? 2 : 1)
            if (!best || c < best.c) best = { P, c }
          }
        }
      }
      if (!best || best.c >= cur - 1e-6) break
      for (let i = 0; i < n; i++) pos[i] = best.P[i]
      cur = cost(pos)
    }
  }
  if (cur > 1e-9) rotatePhase(0.02)

  // ist das Ergebnis schlechter als vorher (z. B. Idealisieren verschlimmert es), bisheriges Verfahren verwenden
  if (cur > origCost - 1e-9 && origCost > 1e-9) {
    for (let i = 0; i < n; i++) pos[i] = orig[i]
    cur = origCost
    rotatePhase(0.0006)
  }
  const changed = pos.some((p, i) => Math.abs(p.x - orig[i].x) > 1e-6 || Math.abs(p.y - orig[i].y) > 1e-6)
  return changed
}
