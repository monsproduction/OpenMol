// Globale Einstellungen der App (im Browser gespeichert, gelten für alle Dokumente).
import { lsGet, lsSet } from './storage'
import { useSyncExternalStore } from 'react'

export interface AppSettings {
  /** Dezimaltrennzeichen für alle angezeigten Zahlen (Analyse, Ansatztabelle, Exporte) */
  decimal: ',' | '.'
  /** Sprache neu angelegter Ansatztabellen */
  tableLang: 'de' | 'en'
  /** KI-Steuerung über MCP erlauben (Brücke zum MCP-Server auf 127.0.0.1:5181) */
  aiControl: boolean
  /** Sprache der Oberfläche */
  uiLang: 'de' | 'en'
  /** Ansatztabelle: CAS-Nummern und GHS-Symbole automatisch in PubChem nachschlagen (Produkte nie automatisch) */
  autoPubchem: boolean
}

const KEY = 'openmol:settings'
const DEFAULTS: AppSettings = { decimal: ',', tableLang: 'de', aiControl: false, uiLang: 'de', autoPubchem: true }

function load(): AppSettings {
  try {
    const raw = lsGet(KEY)
    if (raw) {
      const v = JSON.parse(raw) as Partial<AppSettings>
      return {
        decimal: v.decimal === '.' ? '.' : ',',
        tableLang: v.tableLang === 'en' ? 'en' : 'de',
        aiControl: v.aiControl === true,
        uiLang: v.uiLang === 'en' ? 'en' : 'de',
        autoPubchem: v.autoPubchem !== false,
      }
    }
  } catch {
    // nicht lesbar → Standard
  }
  return { ...DEFAULTS }
}

let settings: AppSettings = load()
const listeners = new Set<() => void>()

export function getSettings(): AppSettings {
  return settings
}

export function setSettings(p: Partial<AppSettings>) {
  settings = { ...settings, ...p }
  lsSet(KEY, JSON.stringify(settings))
  for (const l of listeners) l()
}

/** Bei jeder Änderung der Einstellungen benachrichtigen (Rückgabe: abmelden) */
export function subscribeSettings(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useSettings(): AppSettings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => settings,
  )
}

/** Zahl mit festen Nachkommastellen und dem eingestellten Dezimaltrennzeichen */
export function fmtDec(v: number, digits: number): string {
  const s = v.toFixed(digits)
  return settings.decimal === ',' ? s.replace('.', ',') : s
}
