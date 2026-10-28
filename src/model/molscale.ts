// Größe eines Moleküls (Inspektor ▸ Größe, Standard 100 %): proportional wie bei einem Bild – Bindungslängen (die
// Koordinaten selbst), Linienstärke, Beschriftungen und Abstände wachsen gemeinsam. Gespeichert als Faktor an jedem
// Atom des Moleküls (Atom.scale, fehlt = 1); Darstellung und Abschneiden an Beschriftungen rechnen mit scaledStyle.
import { add, mul, sub, type Pt } from './geom'
import type { Atom, Bond, Doc, DocStyle, Id } from './types'

export const atomScale = (a: Atom | undefined) => a?.scale ?? 1
export const bondScale = (doc: Doc, b: Bond) => (atomScale(doc.atoms[b.a1]) + atomScale(doc.atoms[b.a2])) / 2

const styleCache = new WeakMap<DocStyle, Map<number, DocStyle>>()

/** Dokumentstil mit Bindungslänge, Linienstärke und Schriftgröße × s (zwischengespeichert) */
export function scaledStyle(style: DocStyle, s: number): DocStyle {
  if (s === 1) return style
  let m = styleCache.get(style)
  if (!m) styleCache.set(style, (m = new Map()))
  let v = m.get(s)
  if (!v) m.set(s, (v = { ...style, bondLength: style.bondLength * s, lineWidth: style.lineWidth * s, fontSize: style.fontSize * s }))
  return v
}

function fragmentsOf(doc: Doc, ids: Id[]): Id[][] {
  const adj = new Map<Id, Id[]>()
  for (const b of Object.values(doc.bonds)) {
    adj.set(b.a1, [...(adj.get(b.a1) ?? []), b.a2])
    adj.set(b.a2, [...(adj.get(b.a2) ?? []), b.a1])
  }
  const seen = new Set<Id>()
  const out: Id[][] = []
  for (const start of ids) {
    if (seen.has(start) || !doc.atoms[start]) continue
    const f: Id[] = []
    const st = [start]
    seen.add(start)
    while (st.length) {
      const u = st.pop()!
      f.push(u)
      for (const v of adj.get(u) ?? [])
        if (!seen.has(v)) {
          seen.add(v)
          st.push(v)
        }
    }
    out.push(f)
  }
  return out
}

/** Moleküle der Atome auf die Größe s bringen (um ihre Mitte; ganze Moleküle) */
export function setMolScale(d: Doc, atomIds: Id[], s: number) {
  for (const f of fragmentsOf(d, atomIds)) {
    const old = atomScale(d.atoms[f[0]])
    const k = s / old
    let cx = 0
    let cy = 0
    for (const id of f) {
      cx += d.atoms[id].x / f.length
      cy += d.atoms[id].y / f.length
    }
    for (const id of f) {
      const a = d.atoms[id]
      a.x = cx + (a.x - cx) * k
      a.y = cy + (a.y - cy) * k
      if (a.z !== undefined) a.z *= k
      // von Hand verschobene Ladungen, Elektronenpaare, Nummern mitziehen
      for (const key of ['chargeOff', 'partialOff', 'stereoOff', 'numOff'] as const) {
        const o = a[key]
        if (o) a[key] = { x: o.x * k, y: o.y * k }
      }
      for (const key of ['lpOff', 'radOff'] as const) {
        const arr = a[key]
        if (arr) a[key] = arr.map((o) => (o ? { x: o.x * k, y: o.y * k } : o))
      }
      if (Math.abs(s - 1) < 1e-6) delete a.scale
      else a.scale = s
    }
  }
}

/**
 * Nach jeder Änderung: an ein skaliertes Molekül neu gezeichnete Atome (Bindungswerkzeug, Ring, ChemDraw-Taste,
 * Vorlage …) übernehmen dessen Größe – ihre Lage wird um das Anknüpfungsatom gestreckt, sodass auch die neuen
 * Bindungen die skalierte Länge haben. Atome, die es vorher schon gab (before), bleiben, wo und wie groß sie sind.
 */
export function propagateMolScale(d: Doc, before?: Doc) {
  const scaled = Object.values(d.atoms).filter((a) => a.scale !== undefined && a.scale !== 1)
  if (!scaled.length) return
  const adj = new Map<Id, Id[]>()
  for (const b of Object.values(d.bonds)) {
    adj.set(b.a1, [...(adj.get(b.a1) ?? []), b.a2])
    adj.set(b.a2, [...(adj.get(b.a2) ?? []), b.a1])
  }
  const done = new Set<Id>()
  for (const a of scaled) {
    for (const nbId of adj.get(a.id) ?? []) {
      const nb = d.atoms[nbId]
      // nur neu gezeichnete Atome: ein schon vorhandenes Molekül, das angebunden wird, springt nicht
      if (!nb || nb.scale !== undefined || done.has(nbId) || before?.atoms[nbId]) continue
      // zusammenhängende neue (unskalierte) Atome hinter diesem Nachbarn
      const comp: Id[] = []
      const st = [nbId]
      const seen = new Set([nbId])
      while (st.length) {
        const u = st.pop()!
        comp.push(u)
        for (const v of adj.get(u) ?? [])
          if (!seen.has(v) && d.atoms[v] && d.atoms[v].scale === undefined && !before?.atoms[v]) {
            seen.add(v)
            st.push(v)
          }
      }
      const s = a.scale!
      const anchor: Pt = { x: a.x, y: a.y }
      for (const id of comp) {
        const c = d.atoms[id]
        const p = add(anchor, mul(sub(c, anchor), s))
        c.x = p.x
        c.y = p.y
        c.scale = s
        done.add(id)
      }
    }
  }
}
