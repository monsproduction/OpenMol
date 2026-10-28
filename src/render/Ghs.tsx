// GHS-Gefahrenpiktogramme (GHS01 … GHS09): die offiziellen Grafiken (gemeinfrei, Wikimedia Commons), fest eingebunden
// – funktionieren ohne Internet und in PNG/SVG-Exporten.
import { GHS_ART } from './ghsArt'
import { EN } from '../i18n/en'

export const GHS_NAMES: Record<string, string> = {
  GHS01: 'GHS01 – Explosiv',
  GHS02: 'GHS02 – Entzündbar',
  GHS03: 'GHS03 – Brandfördernd (oxidierend)',
  GHS04: 'GHS04 – Gas unter Druck',
  GHS05: 'GHS05 – Ätzend',
  GHS06: 'GHS06 – Akut giftig',
  GHS07: 'GHS07 – Achtung (reizend, gesundheitsschädlich)',
  GHS08: 'GHS08 – Gesundheitsgefahr',
  GHS09: 'GHS09 – Umweltgefährlich',
}

/** Name des Piktogramms; Englisch über das Wörterbuch der Oberfläche (SVG-Inhalte werden dort nicht übersetzt) */
export function ghsName(code: string, lang: 'de' | 'en'): string {
  const de = GHS_NAMES[code] ?? code
  return lang === 'en' ? (EN[de] ?? de) : de
}

/** Piktogramm mit der linken oberen Ecke bei (x, y) und Kantenlänge size (Zeichnungseinheiten) */
export function GhsIcon({ code, x, y, size, lang = 'de' }: { code: string; x: number; y: number; size: number; lang?: 'de' | 'en' }) {
  const art = GHS_ART[code]
  if (!art)
    return (
      <text x={x} y={y + size * 0.6} fontSize={size * 0.3} fontFamily="Arial, sans-serif">
        {code}
      </text>
    )
  // Originalpiktogramm (Raute mit rotem Rand ist Teil der Grafik); Inhalt ist eine feste, bereinigte Grafik aus ghsArt.ts
  return (
    <svg x={x} y={y} width={size} height={size} viewBox={art.viewBox} overflow="visible">
      <title>{ghsName(code, lang)}</title>
      <g dangerouslySetInnerHTML={{ __html: art.body }} />
    </svg>
  )
}
