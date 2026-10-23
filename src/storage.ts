import { desktop } from './desktop'

// Gespeicherte Werte im Browser. Seit der Umbenennung in „OpenMol“ heißen die Schlüssel „openmol:…“; Werte unter
// den früheren Schlüsseln (Molekül-Studio / Neues Chemdraw) werden beim ersten Lesen übernommen.
const LEGACY: Record<string, string> = {
  'openmol:autosave': 'neues-chemdraw:autosave',
  'openmol:autosave:name': 'neues-chemdraw:autosave:name',
  'openmol:theme': 'neues-chemdraw:theme',
  'openmol:settings': 'molekuel-studio:settings',
  'openmol:inspector-hidden': 'molekuel-studio:inspector-hidden',
  'openmol:userlib:v1': 'molekuel-studio:userlib:v1',
}

// Desktop-App: Werte liegen in JSON-Dateien im App-Ordner (electron/store.mjs) – einmal beim Start laden, danach
// schreibt jede Änderung durch. Was noch aus einer früheren Browser-Nutzung im localStorage liegt, wird übernommen.
const fileStore: Record<string, string> | null = desktop ? desktop.store.all() : null

export function lsGet(key: string): string | null {
  if (fileStore) {
    if (key in fileStore) return fileStore[key]
    let v: string | null = null
    try {
      v = localStorage.getItem(key) ?? (LEGACY[key] ? localStorage.getItem(LEGACY[key]) : null)
    } catch {
      v = null
    }
    if (v !== null) lsSet(key, v)
    return v
  }
  try {
    const v = localStorage.getItem(key)
    if (v !== null) return v
    const old = LEGACY[key]
    const ov = old ? localStorage.getItem(old) : null
    if (ov !== null) localStorage.setItem(key, ov)
    return ov
  } catch {
    return null
  }
}

export function lsSet(key: string, value: string) {
  if (fileStore) {
    fileStore[key] = value
    desktop!.store.set(key, value)
    return
  }
  try {
    localStorage.setItem(key, value)
  } catch {
    // Speicher voll oder gesperrt
  }
}
