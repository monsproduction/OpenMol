// Gruppen und gesperrte Objekte. Eine Gruppe (⌘G) wird immer als Ganzes ausgewählt und verschoben; gesperrte Objekte
// lassen sich nicht anklicken, verschieben, radieren oder verändern (auch nichts anbauen), bis man sie entsperrt. Moleküle zählen dabei immer ganz
// (gespeichert sind einzelne Atome – später angefügte Atome desselben Moleküls gehören automatisch dazu).
import type { Doc, Id, ObjKind, ObjLists, Selection } from './types'
import { emptySelection } from './types'

const KINDS: ObjKind[] = ['atoms', 'bonds', 'arrows', 'curved', 'texts', 'shapes', 'fills', 'cycles', 'tables']

/** Atome zu ganzen Molekülen ergänzen, Bindungen dazwischen dazu */
function wholeMolecules(d: Doc, items: ObjLists): Selection {
  const s = emptySelection()
  for (const k of KINDS) s[k] = [...(items[k] ?? [])].filter((id) => d[k]?.[id])
  const start = new Set(s.atoms)
  for (const id of s.bonds) {
    const b = d.bonds[id]
    if (b) start.add(b.a1).add(b.a2)
  }
  if (start.size) {
    const adj = new Map<Id, Id[]>()
    for (const b of Object.values(d.bonds)) {
      adj.set(b.a1, [...(adj.get(b.a1) ?? []), b.a2])
      adj.set(b.a2, [...(adj.get(b.a2) ?? []), b.a1])
    }
    const seen = new Set(start)
    const st = [...start]
    while (st.length)
      for (const v of adj.get(st.pop()!) ?? [])
        if (!seen.has(v)) {
          seen.add(v)
          st.push(v)
        }
    s.atoms = [...seen]
    s.bonds = Object.values(d.bonds)
      .filter((b) => seen.has(b.a1) && seen.has(b.a2))
      .map((b) => b.id)
  }
  return s
}

const key = (k: ObjKind, id: Id) => k + ':' + id

/** je Dokument: Objekt → Gruppe bzw. gesperrt (zwischengespeichert, das Dokument ist unveränderlich) */
const cache = new WeakMap<Doc, { group: Map<string, Id>; members: Map<Id, Selection>; locked: Set<string> }>()

function index(d: Doc) {
  let c = cache.get(d)
  if (c) return c
  c = { group: new Map(), members: new Map(), locked: new Set() }
  for (const g of Object.values(d.groups ?? {})) {
    const m = wholeMolecules(d, g.items)
    c.members.set(g.id, m)
    for (const k of KINDS) for (const id of m[k]) c.group.set(key(k, id), g.id)
  }
  if (d.locked) {
    const m = wholeMolecules(d, d.locked)
    for (const k of KINDS) for (const id of m[k]) c.locked.add(key(k, id))
  }
  cache.set(d, c)
  return c
}

/** Auswahl um alle Gruppen ergänzen, aus denen sie etwas enthält */
export function withGroups(d: Doc, sel: Selection): Selection {
  if (!d.groups || !Object.keys(d.groups).length) return sel
  const c = index(d)
  const hit = new Set<Id>()
  for (const k of KINDS) for (const id of sel[k] ?? []) {
    const g = c.group.get(key(k, id))
    if (g) hit.add(g)
  }
  if (!hit.size) return sel
  const out: Selection = { ...emptySelection() }
  for (const k of KINDS) {
    const set = new Set(sel[k] ?? [])
    for (const g of hit) for (const id of c.members.get(g)![k]) set.add(id)
    out[k] = [...set]
  }
  return out
}

export function isLocked(d: Doc, k: ObjKind, id: Id): boolean {
  return !!d.locked && index(d).locked.has(key(k, id))
}

/**
 * Würde die Änderung before → after etwas Gesperrtes verändern? Gesperrte Objekte müssen unverändert bleiben, an
 * gesperrte Moleküle darf nichts angebaut werden (auch keine Bindung zwischen zwei gesperrten), und auf gesperrte Ringe
 * kommt keine neue Ringfüllung.
 */
export function touchesLocked(before: Doc, after: Doc): boolean {
  if (!before.locked || before === after) return false
  const was = wholeMolecules(before, before.locked)
  for (const k of KINDS)
    for (const id of was[k]) {
      const a = before[k]?.[id]
      const b = after[k]?.[id]
      if (a !== b && JSON.stringify(a) !== JSON.stringify(b)) return true
    }
  const now = wholeMolecules(after, before.locked)
  if (now.atoms.length > was.atoms.length || now.bonds.length > was.bonds.length) return true
  if (after.fills !== before.fills && was.atoms.length) {
    const locked = new Set(was.atoms)
    for (const f of Object.values(after.fills ?? {}))
      if (!before.fills?.[f.id] && f.rings.some((r) => r.length && r.every((id) => locked.has(id)))) return true
  }
  return false
}

/** gesperrte Objekte aus einer Auswahl entfernen */
export function withoutLocked(d: Doc, sel: Selection): Selection {
  if (!d.locked) return sel
  const out = { ...sel }
  for (const k of KINDS) out[k] = (sel[k] ?? []).filter((id) => !isLocked(d, k, id))
  return out
}

/** gehört etwas der Auswahl zu einer Gruppe? */
export function inGroup(d: Doc, sel: Selection): boolean {
  if (!d.groups) return false
  const c = index(d)
  return KINDS.some((k) => (sel[k] ?? []).some((id) => c.group.has(key(k, id))))
}

export const hasLocked = (d: Doc) => !!d.locked && KINDS.some((k) => (d.locked![k] ?? []).length > 0)

/** Auswahl als Gruppe speichern (bestehende Gruppen darin gehen in der neuen auf) */
export function makeGroup(d: Doc, sel: Selection, id: Id) {
  const items: ObjLists = {}
  for (const k of KINDS) if (sel[k]?.length) items[k] = [...sel[k]]
  const c = index(d)
  const groups = { ...(d.groups ?? {}) }
  for (const k of KINDS) for (const oid of sel[k] ?? []) {
    const g = c.group.get(key(k, oid))
    if (g) delete groups[g]
  }
  groups[id] = { id, items }
  d.groups = groups
}

/** Gruppen auflösen, aus denen die Auswahl etwas enthält */
export function removeGroups(d: Doc, sel: Selection): number {
  if (!d.groups) return 0
  const c = index(d)
  let n = 0
  for (const k of KINDS) for (const id of sel[k] ?? []) {
    const g = c.group.get(key(k, id))
    if (g && d.groups[g]) {
      delete d.groups[g]
      n++
    }
  }
  if (!Object.keys(d.groups).length) delete d.groups
  return n
}

export function lockItems(d: Doc, sel: Selection) {
  const l: ObjLists = { ...(d.locked ?? {}) }
  for (const k of KINDS) if (sel[k]?.length) l[k] = [...new Set([...(l[k] ?? []), ...sel[k]])]
  d.locked = l
}

export function unlockAll(d: Doc) {
  delete d.locked
}

/**
 * nach jeder Änderung: gelöschte Objekte aus Gruppen und Sperrliste entfernen, Gruppen mit weniger als zwei Objekten
 * auflösen (Moleküle zählen als ein Objekt)
 */
export function pruneGroups(d: Doc) {
  const clean = (items: ObjLists) => {
    let changed = false
    const out: ObjLists = {}
    for (const k of KINDS) {
      const list = items[k]
      if (!list) continue
      const keep = list.filter((id) => d[k]?.[id])
      if (keep.length !== list.length) changed = true
      if (keep.length) out[k] = keep
    }
    return { out, changed }
  }
  if (d.groups) {
    for (const g of Object.values(d.groups)) {
      const { out, changed } = clean(g.items)
      if (!changed) continue
      if (countObjects(d, out) < 2) delete d.groups[g.id]
      else d.groups[g.id] = { id: g.id, items: out }
    }
    if (!Object.keys(d.groups).length) delete d.groups
  }
  if (d.locked) {
    const { out, changed } = clean(d.locked)
    if (!KINDS.some((k) => out[k]?.length)) delete d.locked
    else if (changed) d.locked = out
  }
}

/** Anzahl Objekte; alle Atome/Bindungen eines Moleküls zählen als eines */
export function countObjects(d: Doc, items: ObjLists): number {
  const m = wholeMolecules(d, items)
  const adj = new Map<Id, Id[]>()
  for (const id of m.bonds) {
    const b = d.bonds[id]
    adj.set(b.a1, [...(adj.get(b.a1) ?? []), b.a2])
    adj.set(b.a2, [...(adj.get(b.a2) ?? []), b.a1])
  }
  const seen = new Set<Id>()
  let mols = 0
  for (const a of m.atoms) {
    if (seen.has(a)) continue
    mols++
    const st = [a]
    seen.add(a)
    while (st.length)
      for (const v of adj.get(st.pop()!) ?? [])
        if (!seen.has(v)) {
          seen.add(v)
          st.push(v)
        }
  }
  return mols + KINDS.filter((k) => k !== 'atoms' && k !== 'bonds').reduce((n, k) => n + (m[k]?.length ?? 0), 0)
}
