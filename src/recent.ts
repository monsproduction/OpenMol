// Zuletzt verwendete Dokumente für die leere Zeichenfläche. Desktop: die Dateien selbst (Liste im Hauptprozess).
// Browser: es gibt keine Dateipfade – dort merkt sich OpenMol eine Kopie der zuletzt geöffneten/gespeicherten Dokumente
// (höchstens 6, je höchstens 400 kB) im Speicher des Browsers.
import { desktop } from './desktop'
import { lsGet, lsSet } from './storage'
import type { Doc } from './model/types'

export interface RecentDoc {
  name: string
  time: number
  /** Desktop: Dateipfad */
  path?: string
}

const KEY = 'openmol:recent-docs'
const MAX = 6
const MAX_SIZE = 400_000

interface Stored {
  name: string
  time: number
  json: string
}

function stored(): Stored[] {
  try {
    const v = JSON.parse(lsGet(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x?.name === 'string' && typeof x?.json === 'string') : []
  } catch {
    return []
  }
}

/** Browser: Dokument merken (beim Öffnen und Speichern) */
export function rememberDoc(name: string, doc: Doc) {
  if (desktop) return
  const json = JSON.stringify({ format: 'openmol', doc })
  if (json.length > MAX_SIZE) return
  const list = [{ name, time: Date.now(), json }, ...stored().filter((x) => x.name !== name)].slice(0, MAX)
  try {
    lsSet(KEY, JSON.stringify(list))
  } catch {
    // Speicher voll – dann eben ohne Liste
  }
}

export async function recentDocs(): Promise<RecentDoc[]> {
  if (desktop) {
    try {
      return await desktop.recentDocs()
    } catch {
      return []
    }
  }
  return stored().map(({ name, time }) => ({ name, time }))
}

/** Inhalt zum Öffnen: Dateiname (mit Endung), Text, ggf. Pfad; null = nicht mehr vorhanden */
export async function loadRecent(r: RecentDoc): Promise<{ name: string; text: string; path?: string } | null> {
  if (desktop && r.path) return desktop.openRecent(r.path)
  const s = stored().find((x) => x.name === r.name)
  return s ? { name: s.name + '.openmol', text: s.json } : null
}
