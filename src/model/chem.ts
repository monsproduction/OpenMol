import { ABBREVIATIONS, canonicalAbbrev, condensedForms, condensedUnits } from './abbrev'
import { SYMBOL_SET, hasImplicitH, implicitHCount, maxValence } from './elements'
import { angleDiff, angleOf, largestGapBisector, sub, type Pt } from './geom'
import type { Atom, Bond, BondType, Doc, DocStyle, Id } from './types'
import { fontCss } from './types'
import { alkylPrefixAt, alkylPrefixSup, chemLabel, isRichLabel, parseRich } from './richtext'

export interface Nb {
  bond: Bond
  other: Atom
}

export interface Graph {
  adj: Map<Id, Nb[]>
}

export function buildGraph(doc: Doc): Graph {
  const adj = new Map<Id, Nb[]>()
  for (const id in doc.atoms) adj.set(id, [])
  for (const id in doc.bonds) {
    const b = doc.bonds[id]
    const a1 = doc.atoms[b.a1]
    const a2 = doc.atoms[b.a2]
    if (!a1 || !a2) continue
    adj.get(a1.id)!.push({ bond: b, other: a2 })
    adj.get(a2.id)!.push({ bond: b, other: a1 })
  }
  return { adj }
}

export function bondValue(t: BondType): number {
  if (t === 'double') return 2
  if (t === 'triple') return 3
  if (t === 'aromatic') return 1.5
  return 1
}

export function bondSum(g: Graph, atomId: Id): number {
  let s = 0
  for (const nb of g.adj.get(atomId) ?? []) s += bondValue(nb.bond.type)
  return Math.round(s)
}

export function hCount(g: Graph, a: Atom): number {
  if (a.label || a.attach) return 0
  if (!hasImplicitH(a.element)) return 0
  return implicitHCount(a.element, bondSum(g, a.id), a.charge, a.radical)
}

export function isValenceError(g: Graph, a: Atom): boolean {
  if (a.label || a.attach) return false
  return bondSum(g, a.id) + a.radical > maxValence(a.element, a.charge)
}

export function labelShown(g: Graph, a: Atom, style: DocStyle): boolean {
  if (a.attach) return false
  if (a.label) return true
  if (a.element !== 'C') return true
  if (a.isotope || a.showC) return true
  const deg = g.adj.get(a.id)?.length ?? 0
  if (deg === 0) return true
  return style.showCarbons
}

export function neighborAngles(g: Graph, a: Atom): number[] {
  return (g.adj.get(a.id) ?? []).map((nb) => angleOf(sub(nb.other, a)))
}

/** Beste Richtung für eine neue Bindung an ein vorhandenes Atom */
export function bestBondAngle(g: Graph, a: Atom): number {
  const nbs = g.adj.get(a.id) ?? []
  if (nbs.length === 0) return -Math.PI / 6
  if (nbs.length === 1) {
    const other = nbs[0].other
    const th = angleOf(sub(other, a))
    const c1 = th + (2 * Math.PI) / 3
    const c2 = th - (2 * Math.PI) / 3
    // Triple-/Kumulen-Bindung: linear fortsetzen
    if (nbs[0].bond.type === 'triple') return th + Math.PI
    // Zickzack: auf die Gegenseite des Vor-Nachbarn
    const prev = (g.adj.get(other.id) ?? []).find((n) => n.other.id !== a.id)
    if (prev) {
      const ab = sub(a, other)
      const zp = sub(prev.other, other)
      const sideZ = Math.sign(ab.x * zp.y - ab.y * zp.x)
      const s1 = Math.sign(ab.x * Math.sin(c1) - ab.y * Math.cos(c1))
      return s1 !== sideZ ? c1 : c2
    }
    // sonst: die Richtung, die "nach oben/rechts" zeigt
    const score = (c: number) => -Math.sin(c) * 0.5 + Math.cos(c)
    return score(c1) >= score(c2) ? c1 : c2
  }
  return largestGapBisector(nbs.map((nb) => angleOf(sub(nb.other, a))))
}

/** Kleinster Ring, der eine Bindung enthält (Atom-IDs) oder null */
export function smallestRingOfBond(g: Graph, b: Bond, maxSize = 10): Id[] | null {
  const start = b.a1
  const goal = b.a2
  const prev = new Map<Id, Id | null>([[start, null]])
  let frontier = [start]
  for (let depth = 0; depth < maxSize && frontier.length; depth++) {
    const next: Id[] = []
    for (const id of frontier) {
      for (const nb of g.adj.get(id) ?? []) {
        if (nb.bond.id === b.id) continue
        const o = nb.other.id
        if (prev.has(o)) continue
        prev.set(o, id)
        if (o === goal) {
          const path: Id[] = []
          let cur: Id | null = o
          while (cur) {
            path.push(cur)
            cur = prev.get(cur) ?? null
          }
          return path
        }
        next.push(o)
      }
    }
    frontier = next
  }
  return null
}

/** Zusammenhängende Fragmente (Atom-ID-Listen) */
export function fragments(doc: Doc, g: Graph, atomIds?: Id[]): Id[][] {
  const allowed = atomIds ? new Set(atomIds) : null
  const seen = new Set<Id>()
  const out: Id[][] = []
  for (const id of atomIds ?? Object.keys(doc.atoms)) {
    if (seen.has(id)) continue
    const comp: Id[] = []
    const stack = [id]
    seen.add(id)
    while (stack.length) {
      const cur = stack.pop()!
      comp.push(cur)
      for (const nb of g.adj.get(cur) ?? []) {
        const o = nb.other.id
        if (seen.has(o) || (allowed && !allowed.has(o))) continue
        seen.add(o)
        stack.push(o)
      }
    }
    out.push(comp)
  }
  return out
}

// ---------- Beschriftungs-Layout ----------

export interface Token {
  t: string
  kind: 'n' | 'sub' | 'sup'
  x: number // linke Kante relativ zur Atomposition
  w: number
  dy: number // vertikaler Versatz relativ zur Grundlinie in em
  b?: boolean
  i?: boolean
  u?: boolean
  color?: string
  /** Schriftgröße relativ zur Atom-Schriftgröße (Rich-Label); dy gilt dann in dieser Größe */
  s?: number
}

type Piece = { t: string; kind: Token['kind']; b?: boolean; i?: boolean; u?: boolean; color?: string; s?: number }

const stemCache = new Map<string, number>()
/**
 * Strichstärke eines fetten Buchstabens (gemessen am senkrechten Strich des "l" der Schrift),
 * damit fette Bindungen genauso kräftig wirken wie fette Atom-Beschriftungen.
 */
export function boldStemWidth(font: string, size: number): number {
  let ratio = stemCache.get(font)
  if (ratio === undefined) {
    ratio = 0.14
    if (typeof document !== 'undefined') {
      const S = 200
      const c = document.createElement('canvas')
      c.width = S
      c.height = S
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (ctx) {
        ctx.fillStyle = '#000'
        ctx.font = `bold ${S * 0.8}px ${font}`
        ctx.textBaseline = 'alphabetic'
        ctx.fillText('l', S * 0.3, S * 0.85)
        const row = ctx.getImageData(0, Math.round(S * 0.55), S, 1).data
        let n = 0
        for (let x = 0; x < S; x++) if (row[x * 4 + 3] > 127) n++
        if (n > 0) ratio = n / (S * 0.8)
      }
    }
    stemCache.set(font, ratio)
  }
  return ratio * size
}

export interface LabelLayout {
  tokens: Token[]
  /** Halbbreite/-höhe des Ankerzeichens (für das Kürzen von Bindungen) */
  hw: number
  hh: number
  /** Halbbreite rechts/links inkl. direkt anschließender Hochstellung (Ladung in H3N⁺, Me3N⁺) */
  hwR?: number
  hwL?: number
  /** zusätzliche Kürzungsrechtecke (relativ), z. B. um eine Ladung direkt am Anker */
  clipBoxes?: { x1: number; y1: number; x2: number; y2: number }[]
  /** Ausdehnung des gesamten Labels relativ zur Atomposition */
  left: number
  right: number
  top: number
  bottom: number
  /** Position für eine Ladung (relativ) */
  chargePos: Pt
}

let measureCtx: CanvasRenderingContext2D | null = null
const widthCache = new Map<string, number>()
export const FONT_FAMILY = 'Arial, "Helvetica Neue", Helvetica, sans-serif'

export function textWidth(s: string, size: number, bold = false, italic = false, font: string = FONT_FAMILY): number {
  const key = s + '|' + size + '|' + bold + '|' + italic + '|' + font
  const c = widthCache.get(key)
  if (c !== undefined) return c
  if (!measureCtx && typeof document !== 'undefined') {
    measureCtx = document.createElement('canvas').getContext('2d')
  }
  let w: number
  if (measureCtx) {
    measureCtx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${font}`
    w = measureCtx.measureText(s).width
  } else {
    w = s.length * size * 0.6
  }
  if (widthCache.size > 20000) widthCache.clear()
  widthCache.set(key, w)
  return w
}

/** Zerlegt einen Labeltext in normale Zeichen, tiefgestellte Ziffern und hochgestellte Ladungen */
/** Label-Baustein; o = Position im Quelltext */
export type LabelTok = { t: string; kind: Token['kind']; i?: boolean; o: number }

export function tokenizeLabel(text: string, follow = ''): LabelTok[] {
  const out: LabelTok[] = []
  let at = 0
  const push = (t: string, kind: Token['kind'], it = false) => {
    const last = out[out.length - 1]
    if (last && last.kind === kind && !!last.i === it && last.o + last.t.length === at) last.t += t
    else out.push(it ? { t, kind, i: true, o: at } : { t, kind, o: at })
  }
  // `follow` = Text, der direkt dahinter folgt (z. B. der Anker „Bu“ hinter dem Präfix „t“)
  const full = text + follow
  for (let i = 0; i < text.length; i++) {
    at = i
    const ch = text[i]
    if (ch === '^') {
      // Rest hochgestellt, z. B. Fe^II oder Cu^2+
      const rest = text.slice(i + 1).replace(/-/g, '−')
      at = i + 1
      if (rest) push(rest, 'sup')
      break
    }
    // Alkyl-Präfix (tBu, iPr, nBu, sec-Bu …): hochgestellt und kursiv
    const pk = alkylPrefixAt(full, i)
    if (pk && i + pk <= text.length) {
      const pre = text.slice(i, i + pk)
      push(pre, alkylPrefixSup(pre) ? 'sup' : 'n', true)
      i += pk - 1
      continue
    }
    const prev = i > 0 ? text[i - 1] : ''
    if (/\d/.test(ch) && i > 0 && /[A-Za-z)\]'\d]/.test(prev) && !(out[out.length - 1]?.kind === 'sup')) push(ch, 'sub')
    else if ((ch === '+' || ch === '-' || ch === '−') && i === text.length - 1 && i > 0) push(ch === '-' ? '−' : ch, 'sup')
    else if ((ch === '+' || ch === '-' || ch === '−') && i === 0 && /[A-Z]/.test(text[1] ?? '')) push(ch === '-' ? '−' : ch, 'sup')
    else push(ch, 'n')
  }
  return out
}

function splitAnchor(text: string, fromEnd: boolean, known: boolean): [string, string, string] {
  // Anker = erste (bzw. letzte) Element-artige Einheit
  if (!fromEnd) {
    if (!known) {
      // kondensierte Formel (iPr2N, nBuLi …): Anker = erstes schweres Atom (= Anknüpfungspunkt der Formel)
      const units = condensedUnits(text, (x) => SYMBOL_SET.has(x))
      const u = units?.find((x) => x.kind === 'el' && x.el !== 'H')
      if (u) return [text.slice(0, u.start), u.el!, text.slice(u.start + u.el!.length)]
    }
    const pk = alkylPrefixAt(text, 0)
    if (pk) {
      const m2 = /^[A-Z][a-z]?/.exec(text.slice(pk))
      if (m2) return [text.slice(0, pk), m2[0], text.slice(pk + m2[0].length)]
    }
    const m = /^[a-z]*[A-Z][a-z]?/.exec(text)
    if (!m) return ['', text.slice(0, 1), text.slice(1)]
    let a = m[0]
    // „OtBu“: das t gehört zum Präfix, nicht zum Anker
    if (a.length >= 2 && /[a-z]$/.test(a) && alkylPrefixAt(text, a.length - 1) && 'BCNOP'.includes(a[a.length - 2])) a = a.slice(0, -1)
    return ['', a, text.slice(a.length)]
  }
  // Ladung am Ende (H3N+, Me3N+) bleibt hinter dem Anker
  const chg = /[+\-−]{1,2}$/.exec(text)?.[0] ?? ''
  const body = text.slice(0, text.length - chg.length)
  const m = /[A-Z][a-z]?\d*$/.exec(body) ?? (known ? /[A-Z][a-z]*\d*$/.exec(body) : null)
  if (!m) return [body.slice(0, -1), body.slice(-1), chg]
  const core = m[0].replace(/\d+$/, '')
  const tail = m[0].slice(core.length)
  return [body.slice(0, m.index), core, tail + chg]
}

/** Label als Ganzes zerlegen (Kontext für Tiefstellung/Präfixe) und an den Ankergrenzen aufteilen */
function splitTokens(before: string, anchor: string, after: string): [Piece[], Piece[]] {
  const toks = tokenizeLabel(before + anchor + after)
  const b1 = before.length
  const b2 = b1 + anchor.length
  const pre: Piece[] = []
  const post: Piece[] = []
  for (const tk of toks) {
    const s0 = tk.o
    const s1 = tk.o + tk.t.length
    const part = (x0: number, x1: number) => ({ t: tk.t.slice(Math.max(0, x0 - s0), Math.max(0, x1 - s0)), kind: tk.kind, i: tk.i })
    if (s0 < b1) {
      const p = part(s0, Math.min(s1, b1))
      if (p.t) pre.push(p)
    }
    if (s1 > b2) {
      const p = part(Math.max(s0, b2), s1)
      if (p.t) post.push(p)
    }
  }
  return [pre, post]
}

/**
 * Berechnet das Label eines Atoms. Die Bindungen zeigen auf den Anker (z. B. "O" in "OMe"),
 * Wasserstoffe werden – je nach Nachbarn – rechts, links, oben oder unten angefügt.
 */
export function layoutLabel(g: Graph, a: Atom, style: DocStyle): LabelLayout {
  const fs = style.fontSize
  const subFs = fs * 0.7
  const font = fontCss(style.font)
  const baseB = !!a.bold
  const baseI = !!a.italic
  const tw = (t: string, size: number, b = baseB, i = baseI) => textWidth(t, size, b, i, font)
  const nbAngles = neighborAngles(g, a)
  const dxs = (g.adj.get(a.id) ?? []).map((nb) => nb.other.x - a.x)
  const fromRight = dxs.length > 0 && dxs.every((d) => d > 1) // alle Nachbarn rechts
  const fromLeftOnly = dxs.length > 0 && dxs.every((d) => d < -1)

  let before: string
  let anchor: string
  let after: string
  type HSide = 'right' | 'left' | 'above' | 'below'
  let hSide: HSide | null = null
  let hText = ''

  let richBefore: Piece[] | null = null
  let richAnchor: Piece | null = null
  let richAfter: Piece[] | null = null
  if (a.label && isRichLabel(a.label)) {
    // Rich-Label: Formatierung je Abschnitt, automatische Tiefstellung nur in unformatierten Teilen
    const pieces: Piece[] = []
    for (const r of parseRich(a.label).flat()) {
      const b = r.b ?? baseB
      const i = r.i ?? baseI
      if (r.sup || r.sub) pieces.push({ t: r.t, kind: r.sup ? 'sup' : 'sub', b, i, u: r.u, color: r.color, s: r.s })
      else for (const p of tokenizeLabel(r.t)) pieces.push({ ...p, b, i: p.i || i, u: r.u, color: r.color, s: r.s })
    }
    const ai = Math.max(0, pieces.findIndex((p) => p.kind === 'n'))
    const ap = pieces[ai] ?? { t: '?', kind: 'n' as const }
    const m = /^[a-z]*[A-Z][a-z]?/.exec(ap.t)
    const at = m ? m[0] : ap.t.slice(0, 1)
    richAnchor = { ...ap, t: at }
    richBefore = pieces.slice(0, ai)
    const rest = ap.t.slice(at.length)
    richAfter = [...(rest ? [{ ...ap, t: rest }] : []), ...pieces.slice(ai + 1)]
    before = ''
    anchor = at
    after = ''
  } else if (a.label && a.literal) {
    // wörtlich: keine Spiegelung. Damit der Text nie über der Bindung liegt: Bindungen nur von rechts → Anker am
    // Textende (H3C → C), nur von links → am Textanfang; sonst erstes schweres Atom
    ;[before, anchor, after] = fromRight
      ? splitAnchor(a.label, true, true)
      : fromLeftOnly
        ? splitAnchor(a.label, false, true)
        : splitAnchor(a.label, false, false)
  } else if (a.label) {
    // Ladung am Ende (CO2−, NH3+, PPh3+) abtrennen, damit sich die Formel spiegeln lässt
    let base = a.label
    let chg = ''
    if (!canonicalAbbrev(chemLabel(a.label))) {
      const cm = /^(.*[^+\-−])([+\-−]{1,2})$/.exec(a.label)
      if (cm) {
        base = cm[1]
        chg = cm[2]
      }
    }
    const key = canonicalAbbrev(chemLabel(base))
    const ab = key ? ABBREVIATIONS[key] : null
    let text = base
    let rev = false
    if (ab?.rev) {
      if (fromRight) {
        text = ab.rev
        rev = true
      } else text = key!
    } else if (ab) {
      // Kürzel ohne Spiegelform (p-Tol, Mes): bei Bindung von rechts am Textende anknüpfen
      text = key!
      rev = fromRight
    } else if (dxs.length) {
      // kondensierte Formel: Schreibrichtung so wählen, dass der Text nicht über der Bindung liegt
      const forms = condensedForms(base, (x) => SYMBOL_SET.has(x))
      if (forms && fromRight) {
        text = forms.rev
        rev = true
      } else if (forms && fromLeftOnly) text = forms.fwd
    }
    if (chg) {
      // gespiegelt: negative Ladung am endständigen O/S steht vorn (−O2C, −O3S), sonst hinter dem Atom (H3N+, Me3N+)
      const negOx = /[−-]/.test(chg) && /(O\d*|S\d*)$/.test(base) && base.length > 1
      text = rev && negOx ? chg + text : text + chg
    }
    ;[before, anchor, after] = splitAnchor(text, rev, !!ab)
  } else {
    before = ''
    anchor = a.element
    after = ''
    const h = hCount(g, a)
    if (h > 0) {
      hText = h > 1 ? 'H' + h : 'H'
      if (nbAngles.length === 0) {
        // Einzelatom: H2O schreibt man "H2O", sonst "NH3", "CH4"
        hSide = ['O', 'S', 'Se', 'F', 'Cl', 'Br', 'I'].includes(a.element) ? 'left' : 'right'
      } else if (fromRight) hSide = 'left'
      else if (fromLeftOnly) hSide = 'right'
      else {
        // H bevorzugt rechts, dann links (wie üblich), oben/unten nur wenn seitlich kein Platz
        const gap = (dir: number) => Math.min(...nbAngles.map((n) => angleDiff(n, dir)))
        if (gap(0) >= Math.PI / 3) hSide = 'right'
        else if (gap(Math.PI) >= Math.PI / 3) hSide = 'left'
        else hSide = gap(-Math.PI / 2) >= gap(Math.PI / 2) ? 'above' : 'below'
      }
    }
  }

  const tokens: Token[] = []
  const anchorB = richAnchor?.b ?? baseB
  const anchorI = richAnchor?.i ?? baseI
  const anchorS = richAnchor?.s
  const anchorW = tw(anchor, fs * (anchorS ?? 1), anchorB, anchorI)
  const ax0 = -anchorW / 2
  const place = (parts: Piece[], startX: number, dir: 1 | -1): number => {
    // dir=1: von startX nach rechts; dir=-1: rechtsbündig bis startX
    const sized = parts.map((p) => {
      const b = p.b ?? baseB
      const i = p.i ?? baseI
      return { ...p, b, i, w: tw(p.t, (p.kind === 'n' ? fs : subFs) * (p.s ?? 1), b, i) }
    })
    let x = dir === -1 ? startX - sized.reduce((s, p) => s + p.w, 0) : startX
    const left = x
    for (const p of sized) {
      tokens.push({ t: p.t, kind: p.kind, x, w: p.w, dy: p.kind === 'sub' ? 0.3 : p.kind === 'sup' ? -0.45 : 0, b: p.b, i: p.i, u: p.u, color: p.color, s: p.s })
      x += p.w
    }
    return dir === -1 ? left : x
  }

  // Isotop links hochgestellt
  let left = ax0
  if (a.isotope && !a.label) {
    const t = String(a.isotope)
    const w = tw(t, subFs)
    tokens.push({ t, kind: 'sup', x: ax0 - w, w, dy: -0.45, b: baseB, i: baseI })
    left = ax0 - w
  }
  tokens.push({ t: anchor, kind: 'n', x: ax0, w: anchorW, dy: 0, b: anchorB, i: anchorI, u: richAnchor?.u, color: richAnchor?.color, s: anchorS })
  let right = -ax0
  if (richBefore?.length) left = Math.min(left, place(richBefore, left, -1))
  if (richAfter?.length) right = place(richAfter, right, 1)
  if (before || after) {
    const [pre, post] = splitTokens(before, anchor, after)
    if (pre.length) left = Math.min(left, place(pre, left, -1))
    if (post.length) right = place(post, right, 1)
  }

  // größere Zeichen im Rich-Label ragen weiter nach oben/unten (Grundlinie liegt ≈ 0,36 · Größe unter dem Atom)
  const maxS = Math.max(1, ...tokens.map((t) => t.s ?? 1))
  let top = Math.min(-fs * 0.42, fs * 0.36 - fs * 0.78 * maxS)
  let bottom = Math.max(fs * 0.42, fs * 0.36 + fs * 0.2 * maxS)
  let chargeAnchorX = right
  let chargeAnchorY = -fs * 0.42

  if (hSide && hText) {
    const hParts = tokenizeLabel(hText)
    if (hSide === 'right') {
      right = place(hParts, right, 1)
      chargeAnchorX = right
    } else if (hSide === 'left') {
      left = place(hParts, left, -1)
    } else {
      const wH = tw('H', fs)
      const yOff = hSide === 'above' ? -fs * 0.95 : fs * 0.95
      const startTok = tokens.length
      place(hParts, -wH / 2, 1)
      for (let i = startTok; i < tokens.length; i++) tokens[i].dy += yOff / fs
      if (hSide === 'above') top -= fs * 0.95
      else bottom += fs * 0.95
    }
  }

  // Hochgestelltes direkt am Anker (Ladung bei gespiegelter Formel) gehört zur Kürzungsbox der Bindung
  const hw0 = anchorW / 2 + fs * 0.12
  let hwR = hw0
  let hwL = hw0
  const clipBoxes: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (const t of tokens) {
    if (t.kind !== 'sup' || Math.abs(t.dy) > 0.6) continue
    const adjR = Math.abs(t.x - -ax0) < 1
    const adjL = Math.abs(t.x + t.w - ax0) < 1
    if (adjR) hwR = Math.max(hwR, t.x + t.w + fs * 0.06)
    if (adjL) hwL = Math.max(hwL, -t.x + fs * 0.06)
    if (adjR || adjL) clipBoxes.push({ x1: t.x - fs * 0.04, y1: -fs * 0.95, x2: t.x + t.w + fs * 0.08, y2: -fs * 0.1 })
  }
  return {
    tokens,
    hw: hw0,
    hwR: hwR > hw0 ? hwR : undefined,
    hwL: hwL > hw0 ? hwL : undefined,
    clipBoxes: clipBoxes.length ? clipBoxes : undefined,
    hh: fs * 0.5,
    left,
    right,
    top,
    bottom,
    chargePos: { x: chargeAnchorX + fs * 0.28, y: chargeAnchorY },
  }
}
