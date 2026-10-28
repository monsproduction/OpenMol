// Eigene Vorlagen-Sammlungen: im Browser gespeichert (localStorage), als Datei export-/importierbar.
// Eine Vorlage ist ein Ausschnitt des Dokuments (ClipData) – Strukturen inkl. Labels, Formatierung,
// Ringfüllungen, 3D-Tiefe, auch Pfeile/Texte – zentriert um den Ursprung.
import { lsGet, lsSet, onExternalChange } from '../storage'
import { useSyncExternalStore } from 'react'
import type { ClipData } from './ops'
import { uid } from './types'

export interface UserTemplate {
  id: string
  name: string
  clip: ClipData
  created: number
}

export interface UserCollection {
  id: string
  name: string
  items: UserTemplate[]
}

export interface UserLib {
  collections: UserCollection[]
  /** ausgeblendete (gelöschte) mitgelieferte Sammlungen */
  hiddenBuiltin: string[]
}

const KEY = 'openmol:userlib:v1'
const FILE_FORMAT = 'openmol-vorlagen'
/** frühere Kennung (Molekül-Studio) – Dateien damit lassen sich weiter importieren */
const OLD_FORMAT = 'molekuel-studio-vorlagen'

function load(): UserLib {
  try {
    const raw = lsGet(KEY)
    if (raw) {
      const v = JSON.parse(raw) as Partial<UserLib>
      return { collections: Array.isArray(v.collections) ? v.collections : [], hiddenBuiltin: Array.isArray(v.hiddenBuiltin) ? v.hiddenBuiltin : [] }
    }
  } catch {
    // beschädigt oder nicht verfügbar → leer beginnen
  }
  return { collections: [], hiddenBuiltin: [] }
}

let lib: UserLib = load()
const listeners = new Set<() => void>()

// Sammlungen wurden außerhalb geändert (anderer Rechner über den Cloud-Ordner, Ortswechsel): neu laden
onExternalChange((key) => {
  if (key !== KEY) return
  lib = load()
  for (const l of listeners) l()
})

function save(next: UserLib) {
  lib = next
  lsSet(KEY, JSON.stringify(lib))
  for (const l of listeners) l()
}

export function getUserLib(): UserLib {
  return lib
}

export function useUserLib(): UserLib {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => lib,
  )
}

export function findUserTemplate(id: string): UserTemplate | null {
  for (const c of lib.collections) for (const t of c.items) if (t.id === id) return t
  return null
}

export function addCollection(name: string): UserCollection {
  const c: UserCollection = { id: uid('lib'), name: name.trim() || 'Eigene Vorlagen', items: [] }
  save({ ...lib, collections: [...lib.collections, c] })
  return c
}

export function renameCollection(id: string, name: string) {
  const n = name.trim()
  if (!n) return
  save({ ...lib, collections: lib.collections.map((c) => (c.id === id ? { ...c, name: n } : c)) })
}

export function deleteCollection(id: string) {
  save({ ...lib, collections: lib.collections.filter((c) => c.id !== id) })
}

export function addTemplate(collectionId: string, name: string, clip: ClipData): UserTemplate {
  const t: UserTemplate = { id: uid('tpl'), name: name.trim() || 'Ohne Namen', clip, created: Date.now() }
  save({ ...lib, collections: lib.collections.map((c) => (c.id === collectionId ? { ...c, items: [...c.items, t] } : c)) })
  return t
}

export function renameTemplate(id: string, name: string) {
  const n = name.trim()
  if (!n) return
  save({ ...lib, collections: lib.collections.map((c) => ({ ...c, items: c.items.map((t) => (t.id === id ? { ...t, name: n } : t)) })) })
}

export function deleteTemplate(id: string) {
  save({ ...lib, collections: lib.collections.map((c) => ({ ...c, items: c.items.filter((t) => t.id !== id) })) })
}

export function hideBuiltin(name: string) {
  if (lib.hiddenBuiltin.includes(name)) return
  save({ ...lib, hiddenBuiltin: [...lib.hiddenBuiltin, name] })
}

export function restoreBuiltin() {
  save({ ...lib, hiddenBuiltin: [] })
}

/** Alle eigenen Sammlungen als JSON-Datei */
export function exportUserLib(): string {
  return JSON.stringify({ format: FILE_FORMAT, version: 1, collections: lib.collections }, null, 1)
}

/**
 * Sammlungen aus einer Datei übernehmen. Gleichnamige Sammlungen werden zusammengeführt
 * (gleichnamige Vorlagen darin nicht doppelt angelegt). Gibt die Zahl neuer Vorlagen zurück.
 */
export function importUserLib(text: string): number {
  const v = JSON.parse(text) as { format?: string; collections?: UserCollection[] }
  if ((v.format !== FILE_FORMAT && v.format !== OLD_FORMAT) || !Array.isArray(v.collections)) throw new Error('Keine Vorlagen-Datei von OpenMol')
  let added = 0
  const cols = lib.collections.map((c) => ({ ...c, items: [...c.items] }))
  for (const ic of v.collections) {
    if (!ic || typeof ic.name !== 'string' || !Array.isArray(ic.items)) continue
    let target = cols.find((c) => c.name === ic.name)
    if (!target) {
      target = { id: uid('lib'), name: ic.name, items: [] }
      cols.push(target)
    }
    for (const it of ic.items) {
      if (!it?.clip || !Array.isArray(it.clip.atoms)) continue
      if (target.items.some((t) => t.name === it.name)) continue
      target.items.push({ id: uid('tpl'), name: String(it.name ?? 'Ohne Namen'), clip: it.clip, created: it.created ?? Date.now() })
      added++
    }
  }
  save({ ...lib, collections: cols })
  return added
}
