// Ebenen-Reihenfolge aller Objekte: Moleküle (zusammenhängende Atome inkl. Ringfüllungen), Zyklen, Formen,
// Reaktionspfeile, Mechanismuspfeile und Texte. Ohne eigenen Wert gilt die Standardreihenfolge der Objektart
// (Zyklen < Formen < Moleküle < Pfeile < Mechanismuspfeile < Texte) – so bleibt alles wie bisher, bis der
// Nutzer etwas nach vorn/hinten verschiebt.
import type { Box } from './geom'
import { sceneBBox, type Scene } from './scene'
import type { Doc, Id, Selection } from './types'

export type OrderKind = 'cycle' | 'shape' | 'mol' | 'arrow' | 'curved' | 'text' | 'table'

export const KIND_BASE: Record<OrderKind, number> = {
  cycle: 200000,
  shape: 300000,
  mol: 400000,
  arrow: 500000,
  curved: 600000,
  text: 700000,
  table: 650000,
}
const KIND_RANK: Record<OrderKind, number> = { cycle: 0, shape: 1, mol: 2, arrow: 3, curved: 4, table: 5, text: 6 }

export interface Frag {
  atoms: Id[]
  bonds: Id[]
  fills: Id[]
}

export interface OrderItem {
  kind: OrderKind
  /** Objekt-ID bzw. bei Molekülen der Index in scene-Fragmenten */
  id: Id
  frag?: number
  key: number
  /** Einfügereihenfolge (stabil bei gleichen Werten) */
  idx: number
}

/** Moleküle = Zusammenhangskomponenten (Ringfüllungen gehören zu ihrem Molekül) */
export function computeFrags(doc: Doc, adj: Map<Id, { other: { id: Id }; bond: { id: Id } }[]>): { frags: Frag[]; fragOf: Map<Id, number> } {
  const fragOf = new Map<Id, number>()
  const frags: Frag[] = []
  for (const id in doc.atoms) {
    if (fragOf.has(id)) continue
    const k = frags.length
    const f: Frag = { atoms: [], bonds: [], fills: [] }
    const st = [id]
    fragOf.set(id, k)
    while (st.length) {
      const c = st.pop()!
      f.atoms.push(c)
      for (const nb of adj.get(c) ?? []) {
        if (fragOf.has(nb.other.id)) continue
        fragOf.set(nb.other.id, k)
        st.push(nb.other.id)
      }
    }
    frags.push(f)
  }
  for (const id in doc.bonds) {
    const k = fragOf.get(doc.bonds[id].a1)
    if (k !== undefined) frags[k].bonds.push(id)
  }
  for (const id in doc.fills ?? {}) {
    const a = doc.fills[id].rings[0]?.[0]
    const k = a ? fragOf.get(a) : undefined
    if (k !== undefined) frags[k].fills.push(id)
  }
  return { frags, fragOf }
}

function fragKey(doc: Doc, f: Frag): number {
  let k = -Infinity
  for (const id of f.atoms) {
    const o = doc.atoms[id]?.order
    if (o !== undefined && o > k) k = o
  }
  return k === -Infinity ? KIND_BASE.mol : k
}

/** Alle Objekte in Zeichenreihenfolge (hinten → vorn) */
export function orderItems(scene: Scene): OrderItem[] {
  const doc = scene.doc
  const items: OrderItem[] = []
  let idx = 0
  for (const id in doc.cycles ?? {}) items.push({ kind: 'cycle', id, key: doc.cycles[id].order ?? KIND_BASE.cycle, idx: idx++ })
  for (const id in doc.shapes) items.push({ kind: 'shape', id, key: doc.shapes[id].order ?? KIND_BASE.shape, idx: idx++ })
  scene.frags.forEach((f, k) => items.push({ kind: 'mol', id: 'm' + k, frag: k, key: fragKey(doc, f), idx: idx++ }))
  for (const id in doc.arrows) items.push({ kind: 'arrow', id, key: doc.arrows[id].order ?? KIND_BASE.arrow, idx: idx++ })
  for (const id in doc.curved) items.push({ kind: 'curved', id, key: doc.curved[id].order ?? KIND_BASE.curved, idx: idx++ })
  for (const id in doc.texts) items.push({ kind: 'text', id, key: doc.texts[id].order ?? KIND_BASE.text, idx: idx++ })
  for (const id in doc.tables ?? {}) items.push({ kind: 'table', id, key: doc.tables[id].order ?? KIND_BASE.table, idx: idx++ })
  return items.sort((a, b) => a.key - b.key || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.idx - b.idx)
}

function itemBox(scene: Scene, it: OrderItem): Box | null {
  if (it.kind === 'mol') {
    const f = scene.frags[it.frag!]
    return sceneBBox(scene, { atoms: new Set(f.atoms), bonds: new Set(f.bonds) })
  }
  const key = { cycle: 'cycles', shape: 'shapes', arrow: 'arrows', curved: 'curved', text: 'texts', table: 'tables' }[it.kind] as 'cycles'
  return sceneBBox(scene, { [key]: new Set([it.id]) })
}

const overlap = (a: Box | null, b: Box | null) => !!a && !!b && a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2

/** Welche Ebenen-Objekte sind (ganz oder teilweise) ausgewählt? */
export function selectedItems(scene: Scene, items: OrderItem[], sel: Selection): Set<string> {
  const out = new Set<string>()
  const frags = new Set<number>()
  for (const id of sel.atoms) {
    const k = scene.fragOf.get(id)
    if (k !== undefined) frags.add(k)
  }
  for (const id of sel.bonds) {
    const b = scene.doc.bonds[id]
    const k = b ? scene.fragOf.get(b.a1) : undefined
    if (k !== undefined) frags.add(k)
  }
  for (const id of sel.fills ?? []) {
    const a = scene.doc.fills[id]?.rings[0]?.[0]
    const k = a ? scene.fragOf.get(a) : undefined
    if (k !== undefined) frags.add(k)
  }
  const ids = new Set([...sel.cycles ?? [], ...sel.shapes, ...sel.arrows, ...sel.curved, ...sel.texts, ...sel.tables ?? []])
  for (const it of items) if ((it.kind === 'mol' && frags.has(it.frag!)) || (it.kind !== 'mol' && ids.has(it.id))) out.add(it.kind + ':' + it.id)
  return out
}

export type OrderMode = 'front' | 'back' | 'forward' | 'backward'

/**
 * Neue Ebenen-Werte für die Auswahl. Vorn/hinten: ganz nach vorn/hinten (relative Reihenfolge der
 * Auswahl bleibt). Eine Ebene: am nächsten überlappenden Objekt vorbei (sonst am nächsten überhaupt).
 */
export function reorderKeys(scene: Scene, sel: Selection, mode: OrderMode): Map<string, number> | null {
  const items = orderItems(scene)
  const chosen = selectedItems(scene, items, sel)
  if (!chosen.size) return null
  const keyOf = (it: OrderItem) => it.kind + ':' + it.id
  const selList = items.filter((it) => chosen.has(keyOf(it)))
  const rest = items.filter((it) => !chosen.has(keyOf(it)))
  let newOrder: OrderItem[]
  if (mode === 'front') newOrder = [...rest, ...selList]
  else if (mode === 'back') newOrder = [...selList, ...rest]
  else {
    // Auswahl als Block um ein (überlappendes) Objekt verschieben
    const selBox = selList.map((it) => itemBox(scene, it)).reduce<Box | null>((acc, b) => (b ? (acc ? { x1: Math.min(acc.x1, b.x1), y1: Math.min(acc.y1, b.y1), x2: Math.max(acc.x2, b.x2), y2: Math.max(acc.y2, b.y2) } : b) : acc), null)
    const pos = items.map((it) => chosen.has(keyOf(it)))
    const first = pos.indexOf(true)
    const last = pos.lastIndexOf(true)
    if (mode === 'forward') {
      const above = items.slice(last + 1).filter((it) => !chosen.has(keyOf(it)))
      if (!above.length) return null
      const target = above.find((it) => overlap(selBox, itemBox(scene, it))) ?? above[0]
      const ti = rest.indexOf(target)
      newOrder = [...rest.slice(0, ti + 1), ...selList, ...rest.slice(ti + 1)]
    } else {
      const below = items.slice(0, first).filter((it) => !chosen.has(keyOf(it))).reverse()
      if (!below.length) return null
      const target = below.find((it) => overlap(selBox, itemBox(scene, it))) ?? below[0]
      const ti = rest.indexOf(target)
      newOrder = [...rest.slice(0, ti), ...selList, ...rest.slice(ti)]
    }
  }
  // gleichmäßig durchnummerieren; neue Objekte (Standardwerte ≥ 200000) landen weiterhin vorn in ihrer Art
  const res = new Map<string, number>()
  newOrder.forEach((it, i) => res.set(keyOf(it), (i + 1) * 10))
  return res
}

/** Ebenen-Werte ins Dokument schreiben (Moleküle: alle Atome) */
export function applyOrder(d: Doc, scene: Scene, keys: Map<string, number>) {
  for (const [k, v] of keys) {
    const [kind, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)] as [OrderKind, string]
    if (kind === 'mol') {
      const f = scene.frags[Number(id.slice(1))]
      for (const a of f?.atoms ?? []) if (d.atoms[a]) d.atoms[a].order = v
    } else if (kind === 'cycle' && d.cycles[id]) d.cycles[id].order = v
    else if (kind === 'shape' && d.shapes[id]) d.shapes[id].order = v
    else if (kind === 'arrow' && d.arrows[id]) d.arrows[id].order = v
    else if (kind === 'curved' && d.curved[id]) d.curved[id].order = v
    else if (kind === 'text' && d.texts[id]) d.texts[id].order = v
    else if (kind === 'table' && d.tables?.[id]) d.tables[id].order = v
  }
}

