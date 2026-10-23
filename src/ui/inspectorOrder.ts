// Reihenfolge der Kategorien im Inspektor: per Ziehen an der Überschrift (oder ⌥↑/⌥↓) änderbar.
// Gilt pro Browser (localStorage); gerade nicht sichtbare Kategorien behalten ihren Platz in der Liste.
import { useSyncExternalStore } from 'react'
import { lsGet, lsSet } from '../storage'

/** alle Kategorien in der ursprünglichen Reihenfolge */
export const SECTION_IDS = [
  'docstyle',
  'structure',
  'atom',
  'bond',
  'arrow',
  'curved',
  'text',
  'shape',
  'cycle',
  'table',
  'reaction',
  'ringfill',
  'color',
  'analysis',
] as const
export type SectionId = (typeof SECTION_IDS)[number]

const KEY = 'openmol:inspector-order'
let order: SectionId[] = load()
const listeners = new Set<() => void>()

function load(): SectionId[] {
  try {
    const v = JSON.parse(lsGet(KEY) ?? '[]')
    const saved = Array.isArray(v) ? v.filter((x): x is SectionId => (SECTION_IDS as readonly string[]).includes(x)) : []
    // neue Kategorien (spätere Versionen) an ihrer ursprünglichen Stelle einfügen
    const out = [...new Set(saved)]
    SECTION_IDS.forEach((id, i) => {
      if (out.includes(id)) return
      const prev = SECTION_IDS.slice(0, i).reverse().find((p) => out.includes(p))
      out.splice(prev ? out.indexOf(prev) + 1 : 0, 0, id)
    })
    return out
  } catch {
    return [...SECTION_IDS]
  }
}

function save(next: SectionId[]) {
  order = next
  try {
    lsSet(KEY, JSON.stringify(order))
  } catch {
    // ohne Speicher nur für diese Sitzung
  }
  for (const l of listeners) l()
}

/** Kategorie `id` vor bzw. hinter `target` verschieben */
export function moveSection(id: SectionId, target: SectionId, after: boolean) {
  if (id === target) return
  const next = order.filter((x) => x !== id)
  next.splice(next.indexOf(target) + (after ? 1 : 0), 0, id)
  save(next)
}

export function resetSectionOrder() {
  save([...SECTION_IDS])
}

export function useSectionOrder(): SectionId[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => order,
  )
}
