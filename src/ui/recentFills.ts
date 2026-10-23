// Leiste der Ringfüllungen: genau 8 Plätze. Anfangs stehen dort Beispiele; jede neue eigene Füllung, die benutzt wird,
// kommt vorn hinzu und die älteste fällt hinten heraus – so werden die Beispiele nach und nach ersetzt.
// Nur eine Bequemlichkeit pro Browser (localStorage); fehlt der Speicher, gilt die Leiste nur für diese Sitzung.
import { useSyncExternalStore } from 'react'
import type { FillStyle } from '../model/rings'
import { lsGet, lsSet } from '../storage'

export interface BarFill {
  f: FillStyle
  /** Name der Beispiele (eigene Füllungen haben keinen) */
  name?: string
}

/** Beispiele, mit denen die Leiste beginnt */
export const DEFAULT_FILLS: BarFill[] = [
  { name: 'Blau (Verlauf)', f: { mode: 'fill', grad: 'radial', c1: '#1d2bd8', c2: '#9aa6ff', angle: 0, opacity: 1 } },
  { name: 'Hellblau', f: { mode: 'fill', grad: 'none', c1: '#4f8ef0', c2: '#4f8ef0', angle: 0, opacity: 1 } },
  { name: 'Rot', f: { mode: 'fill', grad: 'none', c1: '#e8574f', c2: '#e8574f', angle: 0, opacity: 1 } },
  { name: 'Rot (Verlauf)', f: { mode: 'fill', grad: 'linear', c1: '#c81e1e', c2: '#ff9a8a', angle: 90, opacity: 1 } },
  { name: 'Gelb', f: { mode: 'fill', grad: 'none', c1: '#f5dc3c', c2: '#f5dc3c', angle: 0, opacity: 1 } },
  { name: 'Gelb transparent', f: { mode: 'fill', grad: 'none', c1: '#f5dc3c', c2: '#f5dc3c', angle: 0, opacity: 0.35 } },
  { name: 'Grün (Verlauf)', f: { mode: 'fill', grad: 'radial', c1: '#0f8a43', c2: '#9be0b2', angle: 0, opacity: 1 } },
  { name: 'Grau', f: { mode: 'fill', grad: 'none', c1: '#c9ced6', c2: '#c9ced6', angle: 0, opacity: 1 } },
]

const KEY = 'openmol:fill-bar'
// frühere Fassung: zuletzt benutzte eigene Füllungen neben den festen Beispielen
const OLD_KEY = 'openmol:recent-fills'
const MAX = 8
const same = (a: FillStyle, b: FillStyle) => a.grad === b.grad && a.c1 === b.c1 && a.c2 === b.c2 && a.angle === b.angle && a.opacity === b.opacity

let list: BarFill[] = load()
const listeners = new Set<() => void>()

function load(): BarFill[] {
  try {
    const v = JSON.parse(lsGet(KEY) ?? 'null')
    if (Array.isArray(v) && v.length) return v.slice(0, MAX)
    // aus der früheren Fassung: dort gemerkte eigene Füllungen vorn, dann die Beispiele
    const old = JSON.parse(lsGet(OLD_KEY) ?? '[]')
    let out = [...DEFAULT_FILLS]
    if (Array.isArray(old)) for (const f of [...old].reverse()) out = add(out, f)
    return out
  } catch {
    return [...DEFAULT_FILLS]
  }
}

function add(l: BarFill[], f: FillStyle): BarFill[] {
  if (l.some((x) => same(x.f, f))) return l // schon in der Leiste: Plätze bleiben, wo sie sind
  return [{ f: { ...f, mode: 'fill' as const } }, ...l].slice(0, MAX)
}

/** benutzte Füllung in die Leiste aufnehmen (vorn; die älteste fällt heraus) */
export function rememberFill(f: FillStyle) {
  const next = add(list, f)
  if (next === list) return
  list = next
  try {
    lsSet(KEY, JSON.stringify(list))
  } catch {
    // ohne Speicher nur für diese Sitzung
  }
  for (const l of listeners) l()
}

export function useFillBar(): BarFill[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => list,
  )
}
