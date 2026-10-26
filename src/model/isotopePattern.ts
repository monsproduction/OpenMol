// Isotopenmuster (Massenspektrum) einer Summenformel: Wahrscheinlichkeit jeder Nominalmasse (M, M+1, M+2 …) aus den
// natürlichen Häufigkeiten der stabilen Isotope (src/model/isotopes.ts), mit der mittleren exakten Masse je Peak.
// Rechnung: Element für Element falten (je Atom einmal), sehr kleine Peaks unterwegs verwerfen.
import { ISOTOPES } from './isotopes'

export interface IsoPeak {
  /** Nominalmasse (ganzzahlig) */
  nominal: number
  /** mittlere exakte Masse aller Isotopenkombinationen dieses Peaks (u) */
  mass: number
  /** relative Intensität, stärkster Peak = 100 */
  rel: number
}

type Dist = Map<number, { p: number; m: number }>

function fold(a: Dist, iso: [number, number, number][]): Dist {
  const out: Dist = new Map()
  for (const [n, x] of a)
    for (const [dn, dm, ab] of iso) {
      const p = x.p * ab
      const k = n + dn
      const o = out.get(k)
      // m = Summe(p·Masse), am Ende durch p geteilt
      if (o) {
        o.p += p
        o.m += p * (x.m / x.p + dm)
      } else out.set(k, { p, m: p * (x.m / x.p + dm) })
    }
  let max = 0
  for (const x of out.values()) max = Math.max(max, x.p)
  for (const [k, x] of out) if (x.p < max * 1e-9) out.delete(k)
  return out
}

/**
 * Muster für natürliche Atome (Element → Anzahl) und markierte Atome (Element + Nominalmasse, z. B. ¹³C, D).
 * minRel: kleinere Peaks (in % des stärksten) weglassen. null = Element ohne bekannte Isotopendaten.
 */
export function isotopePattern(natural: Record<string, number>, fixed: { el: string; nominal: number }[] = [], minRel = 0.1): IsoPeak[] | null {
  let d: Dist = new Map([[0, { p: 1, m: 0 }]])
  for (const [el, n] of Object.entries(natural)) {
    const iso = ISOTOPES[el]
    if (!iso) return null
    for (let i = 0; i < n; i++) d = fold(d, iso)
  }
  for (const f of fixed) {
    const iso = ISOTOPES[f.el]?.find((x) => x[0] === f.nominal)
    // markiertes, nicht stabiles Isotop (z. B. ¹⁴C): Masse ≈ Nominalmasse
    d = fold(d, [[f.nominal, iso ? iso[1] : f.nominal, 1]])
  }
  let max = 0
  for (const x of d.values()) max = Math.max(max, x.p)
  if (!max) return null
  return [...d]
    .map(([nominal, x]) => ({ nominal, mass: x.m / x.p, rel: (x.p / max) * 100 }))
    .filter((x) => x.rel >= minRel)
    .sort((a, b) => a.nominal - b.nominal)
}
