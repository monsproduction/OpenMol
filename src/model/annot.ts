// Geometrie der Atom-Dekorationen: Label, Ladung, freie Elektronenpaare, Radikale, δ±
import { labelShown, layoutLabel, neighborAngles, type Graph, type LabelLayout } from './chem'
import { angleDiff, fromAngle, add, type Pt } from './geom'
import type { Atom, DocStyle } from './types'

export interface AtomDecor {
  label: LabelLayout | null
  /** Ladungsposition (absolut) */
  charge: Pt | null
  /** Freie Elektronenpaare: Mittelpunkt + Richtung (Winkel) */
  lonePairs: { c: Pt; angle: number }[]
  radicals: { c: Pt; angle: number }[]
  partial: Pt | null
  /** Stereo-Markierung: „*“ und/oder (R)/(S) */
  stereo: { c: Pt; star: boolean; cip: 'R' | 'S' | null } | null
  /** Radius, ab dem Bindungen gekürzt werden (für Atome ohne Label 0) */
  shown: boolean
}

const CANDIDATES = Array.from({ length: 16 }, (_, i) => -Math.PI / 2 + (i * Math.PI) / 8)

function decorRadius(lab: LabelLayout | null, angle: number, style: DocStyle): number {
  const fs = style.fontSize
  if (!lab) return fs * 0.42
  // Ellipse um das Ankerzeichen
  const rx = lab.hw + fs * 0.22
  const ry = lab.hh + fs * 0.12
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return (rx * ry) / Math.sqrt((ry * c) ** 2 + (rx * s) ** 2)
}

export function atomDecor(g: Graph, a: Atom, style: DocStyle, cip?: 'R' | 'S' | '?'): AtomDecor {
  const shown = labelShown(g, a, style)
  const label = shown ? layoutLabel(g, a, style) : null
  const occupied = neighborAngles(g, a)
  // vom Label belegte Richtungen (H rechts/links/oben/unten)
  if (label) {
    if (label.right > label.hw + 2) occupied.push(0)
    if (label.left < -label.hw - 2) occupied.push(Math.PI)
    if (label.top < -style.fontSize * 0.6) occupied.push(-Math.PI / 2)
    if (label.bottom > style.fontSize * 0.6) occupied.push(Math.PI / 2)
  }
  const pick = (preferred?: number): number => {
    let best = CANDIDATES[0]
    let bestScore = -Infinity
    for (const c of CANDIDATES) {
      let s = occupied.length ? Math.min(...occupied.map((o) => angleDiff(o, c))) : Math.PI
      if (preferred !== undefined) s -= angleDiff(c, preferred) * 0.08
      if (s > bestScore + 1e-6) {
        bestScore = s
        best = c
      }
    }
    occupied.push(best)
    return best
  }

  let charge: Pt | null = null
  if (a.charge) {
    if (a.chargeOff) {
      // vom Nutzer verschoben
      charge = add(a, a.chargeOff)
      occupied.push(Math.atan2(a.chargeOff.y, a.chargeOff.x))
    } else if (label) {
      // Standard: rechts oben hinter dem Label – außer dort verläuft eine Bindung (z. B. N⁺=O)
      const def = label.chargePos
      const defAng = Math.atan2(def.y, def.x)
      const nb = neighborAngles(g, a)
      const blocked = nb.some((n) => angleDiff(n, defAng) < Math.PI / 5)
      if (!blocked) {
        charge = add(a, def)
        occupied.push(defAng)
      } else {
        const ang = pick(-Math.PI / 4)
        charge = add(a, fromAngle(ang, decorRadius(label, ang, style) + style.fontSize * 0.12))
      }
    } else {
      const ang = pick(-Math.PI / 4)
      charge = add(a, fromAngle(ang, style.fontSize * 0.55))
    }
  }
  // vom Nutzer verschobene Elektronenpaare/Radikale belegen ihre Richtung zuerst
  for (const off of [...(a.lpOff ?? []).slice(0, a.lonePairs), ...(a.radOff ?? []).slice(0, a.radical)]) if (off) occupied.push(Math.atan2(off.y, off.x))
  const lonePairs: AtomDecor['lonePairs'] = []
  for (let i = 0; i < a.lonePairs; i++) {
    const off = a.lpOff?.[i]
    if (off) {
      lonePairs.push({ c: add(a, off), angle: Math.atan2(off.y, off.x) })
      continue
    }
    const ang = pick(lonePairs.length === 0 ? -Math.PI / 2 : undefined)
    lonePairs.push({ c: add(a, fromAngle(ang, decorRadius(label, ang, style))), angle: ang })
  }
  const radicals: AtomDecor['radicals'] = []
  for (let i = 0; i < a.radical; i++) {
    const off = a.radOff?.[i]
    if (off) {
      radicals.push({ c: add(a, off), angle: Math.atan2(off.y, off.x) })
      continue
    }
    const ang = pick(-Math.PI / 2)
    radicals.push({ c: add(a, fromAngle(ang, decorRadius(label, ang, style))), angle: ang })
  }
  let partial: Pt | null = null
  if (a.partial) {
    if (a.partialOff) partial = add(a, a.partialOff)
    else {
      const ang = pick(-Math.PI * 0.75)
      partial = add(a, fromAngle(ang, decorRadius(label, ang, style) + style.fontSize * 0.25))
    }
  }
  let stereo: AtomDecor['stereo'] = null
  const showCip = (a.showCip || style.showCip) && (cip === 'R' || cip === 'S') ? cip : null
  if (a.stereoMark || showCip) {
    let c: Pt
    if (a.stereoOff) c = add(a, a.stereoOff)
    else {
      // freie Richtung, bevorzugt rechts oben; „(R)“ ist breiter → etwas weiter weg
      const ang = pick(-Math.PI / 4)
      const extra = showCip ? style.fontSize * (a.stereoMark ? 0.55 : 0.45) * Math.abs(Math.cos(ang)) : 0
      c = add(a, fromAngle(ang, (label ? decorRadius(label, ang, style) : style.fontSize * 0.35) + style.fontSize * 0.2 + extra))
    }
    stereo = { c, star: !!a.stereoMark, cip: showCip }
  }
  return { label, charge, lonePairs, radicals, partial, stereo, shown }
}
