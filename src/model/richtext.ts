// Rich-Text: Speicherung als kleine HTML-Teilmenge (b, i, u, sup, sub, font color/face, span font-size in em),
// Zeilenumbruch = "\n". Wird für Texte, Reaktionsbedingungen und Klammer-Indizes genutzt.
import { textWidth } from './chem'
import { fontCss } from './types'

export interface Run {
  t: string
  b?: boolean
  i?: boolean
  u?: boolean
  sup?: boolean
  sub?: boolean
  color?: string
  font?: string
  /** als Summenformel formatieren (Zahlen tief, Ladungen hoch) */
  f?: boolean
  /** Schriftgröße relativ zur Grundgröße des Textes (1 = normal); wächst mit, wenn der ganze Text größer wird */
  s?: number
}

type Fmt = Omit<Run, 't'>

const cache = new Map<string, Run[][]>()

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Nur harmlose Farb-/Schriftwerte übernehmen (Werte landen in HTML-Attributen des Editors)
const safeColor = (c: string | null | undefined) => (c && /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,30}|rgba?\([\d\s.,%]+\))$/.test(c.trim()) ? c.trim() : undefined)
/** Größenfaktor aus „1.5em“ / „150%“ (andere Einheiten hängen von der Editor-Zoomstufe ab und werden ignoriert) */
const sizeFactor = (v: string | null | undefined): number | undefined => {
  const m = /^\s*([\d.]+)\s*(em|%)\s*$/.exec(v ?? '')
  if (!m) return undefined
  const x = parseFloat(m[1]) / (m[2] === '%' ? 100 : 1)
  return Number.isFinite(x) && x > 0 ? x : undefined
}
const clampSize = (x: number) => Math.min(10, Math.max(0.1, Math.round(x * 1000) / 1000))
const safeFont = (f: string | null | undefined) => {
  const v = f?.replace(/["']/g, '').split(',')[0].trim()
  return v && /^[\p{L}\p{N} ._-]{1,60}$/u.test(v) ? v : undefined
}

/** Zerlegt gespeicherten Rich-Text in Zeilen aus formatierten Abschnitten */
export function parseRich(src: string): Run[][] {
  const hit = cache.get(src)
  if (hit) return hit
  let lines: Run[][]
  if (!/[<&]/.test(src) || typeof DOMParser === 'undefined') {
    lines = src.split('\n').map((l) => (l ? [{ t: l }] : []))
  } else {
    lines = [[]]
    const doc = new DOMParser().parseFromString(`<div>${src}</div>`, 'text/html')
    const root = doc.body.firstChild as Element
    const push = (t: string, f: Fmt) => {
      const parts = t.split('\n')
      parts.forEach((p, k) => {
        if (k > 0) lines.push([])
        if (!p) return
        const line = lines[lines.length - 1]
        const last = line[line.length - 1]
        if (last && sameFmt(last, f)) last.t += p
        else line.push({ t: p, ...f })
      })
    }
    const walk = (node: Node, f: Fmt) => {
      if (node.nodeType === 3) {
        push(node.textContent ?? '', f)
        return
      }
      if (node.nodeType !== 1) return
      const el = node as HTMLElement
      const tag = el.tagName.toLowerCase()
      if (tag === 'br') {
        lines.push([])
        return
      }
      const nf: Fmt = { ...f }
      if (tag === 'b' || tag === 'strong') nf.b = true
      if (tag === 'i' || tag === 'em') nf.i = true
      if (tag === 'u') nf.u = true
      if (tag === 'sup') {
        nf.sup = true
        nf.sub = false
      }
      if (tag === 'sub') {
        nf.sub = true
        nf.sup = false
      }
      if (el.classList?.contains('formula')) nf.f = true
      if (tag === 'font') {
        const c = el.getAttribute('color')
        const face = el.getAttribute('face')
        if (safeColor(c)) nf.color = safeColor(c)
        if (safeFont(face)) nf.font = safeFont(face)
      }
      const st = el.style
      if (st) {
        if (safeColor(st.color)) nf.color = safeColor(st.color)
        if (safeFont(st.fontFamily)) nf.font = safeFont(st.fontFamily)
        if (st.fontWeight === 'bold' || Number(st.fontWeight) >= 600) nf.b = true
        if (st.fontWeight === 'normal') nf.b = false
        if (st.fontStyle === 'italic') nf.i = true
        if (st.textDecoration.includes('underline') || st.textDecorationLine?.includes('underline')) nf.u = true
        if (st.verticalAlign === 'super') nf.sup = true
        if (st.verticalAlign === 'sub') nf.sub = true
        // em-Angaben verschachteln sich wie im Browser
        const sf = sizeFactor(st.fontSize)
        if (sf !== undefined) {
          const s2 = clampSize((f.s ?? 1) * sf)
          // Rundungsreste verschachtelter Angaben (1,4 · 0,715) zählen als normale Größe
          nf.s = Math.abs(s2 - 1) < 0.005 ? undefined : s2
        }
      }
      const block = tag === 'div' || tag === 'p'
      if (block && el !== root) {
        const cur = lines[lines.length - 1]
        if (cur.length || lines.length > 1) lines.push([])
      }
      el.childNodes.forEach((c) => walk(c, nf))
    }
    walk(root, {})
    // abschließende Leerzeile durch Block-Elemente entfernen
    while (lines.length > 1 && lines[lines.length - 1].length === 0 && /<\/(div|p)>\s*$/i.test(src)) lines.pop()
  }
  cache.set(src, lines)
  return lines
}

function sameFmt(a: Fmt, b: Fmt) {
  return !!a.b === !!b.b && !!a.i === !!b.i && !!a.u === !!b.u && !!a.sup === !!b.sup && !!a.sub === !!b.sub && a.color === b.color && a.font === b.font && !!a.f === !!b.f && (a.s ?? 1) === (b.s ?? 1)
}

/** Zeilen → normalisierter Speicher-String */
export function serializeRich(lines: Run[][]): string {
  return lines
    .map((line) =>
      line
        .map((r) => {
          let s = escapeHtml(r.t)
          if (r.f) s = `<span class="formula">${s}</span>`
          const color = safeColor(r.color)
          const font = safeFont(r.font)
          if (color || font) s = `<font${color ? ` color="${color}"` : ''}${font ? ` face="${font}"` : ''}>${s}</font>`
          if (r.sup) s = `<sup>${s}</sup>`
          if (r.sub) s = `<sub>${s}</sub>`
          if (r.u) s = `<u>${s}</u>`
          if (r.i) s = `<i>${s}</i>`
          if (r.b) s = `<b>${s}</b>`
          if (r.s && r.s !== 1) s = `<span style="font-size:${clampSize(r.s)}em">${s}</span>`
          return s
        })
        .join(''),
    )
    .join('\n')
}

/** Bereinigt HTML aus einem contentEditable-Feld */
export function sanitizeRich(html: string): string {
  cache.delete(html)
  return serializeRich(parseRich(html.replace(/&nbsp;/g, ' ')))
}

/** Gespeicherter Text → HTML für den Editor */
export function richToEditorHtml(src: string): string {
  return serializeRich(parseRich(src)).replace(/\n/g, '<br>')
}

export function richPlain(src: string): string {
  return parseRich(src)
    .map((l) => l.map((r) => r.t).join(''))
    .join('\n')
}

// ---------- Chemische Formatierung ----------

export interface TextTok {
  t: string
  kind: 'n' | 'sub' | 'sup'
  /** kursiv (Alkyl-Präfixe wie das t in tBu) */
  i?: boolean
}

const ALKYL_PREFIX = /^(sec-|tert-|n-|i-|s-|t-|sec|tert|n|i|s|t)(?=(?:Bu|Pr|Pent|Hex|Hept|Oct|Am)(?![a-z]))/

/**
 * Länge eines Alkyl-Präfixes (n, s, i, t, sec, tert – z. B. das t in tBu oder das i in iPr2N) an Position i,
 * sonst 0. Davor darf kein Kleinbuchstabe stehen (sonst wäre es Teil eines Wortes/Elementsymbols).
 */
/** Einbuchstabige Präfixe (ᵗBu, ⁱPr) hochgestellt; Präfixe mit Bindestrich (sec-, tert-, n-) kursiv auf der Grundlinie */
export function alkylPrefixSup(prefix: string): boolean {
  return /^[nsit]$/.test(prefix)
}

export function alkylPrefixAt(s: string, i: number): number {
  if (i > 0 && /[a-z]/.test(s[i - 1])) return 0
  const m = ALKYL_PREFIX.exec(s.slice(i))
  return m ? m[1].length : 0
}

/** Ziffern nach Buchstaben tiefstellen (H2SO4), Ladungen am Wortende hochstellen (Na+), ^x hochstellen */
export function formatChemText(line: string): TextTok[] {
  const out: TextTok[] = []
  const push = (t: string, kind: TextTok['kind'], it = false) => {
    const last = out[out.length - 1]
    if (last && last.kind === kind && !!last.i === it) last.t += t
    else out.push(it ? { t, kind, i: true } : { t, kind })
  }
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    const prev = line[i - 1] ?? ''
    const next = line[i + 1] ?? ''
    const pk = alkylPrefixAt(line, i)
    if (pk) {
      const pre = line.slice(i, i + pk)
      push(pre, alkylPrefixSup(pre) ? 'sup' : 'n', true)
      i += pk - 1
    } else if (/\d/.test(ch) && /[A-Za-z)\]]/.test(prev) && !/[°]/.test(next)) push(ch, 'sub')
    else if (/\d/.test(ch) && out[out.length - 1]?.kind === 'sub' && /\d/.test(prev)) push(ch, 'sub')
    else if ((ch === '+' || ch === '−' || ch === '-') && /[A-Za-z0-9)\]]/.test(prev) && (next === '' || /[\s,;)]/.test(next)))
      push(ch === '-' ? '−' : ch, 'sup')
    else if (ch === '^' && next) {
      push(next, 'sup')
      i++
    } else push(ch, 'n')
  }
  return out
}

// ---------- Layout ----------

export interface RTok {
  t: string
  w: number
  size: number
  /** vertikaler Versatz relativ zur Grundlinie (px, positiv = nach unten) */
  dy: number
  b: boolean
  i: boolean
  u: boolean
  color?: string
  font: string
}

export interface RichLayout {
  /** y = Grundlinie der Zeile relativ zur Grundlinie, an der der Text verankert ist */
  lines: { toks: RTok[]; w: number; y: number }[]
  width: number
  /** Gesamthöhe; die Oberkante liegt wie bei einheitlicher Größe (die Zeilen wachsen nach unten) */
  height: number
  /** Zeilenhöhe bei Grundgröße */
  lineH: number
  /** Grundlinie der letzten Zeile (bei einheitlicher Größe = (Zeilen − 1) · lineH) */
  lastY: number
}

export interface RichOpts {
  size: number
  font?: string
  bold?: boolean
  italic?: boolean
  /** ganzer Text als Summenformel */
  chem?: boolean
}

const layoutCache = new Map<string, RichLayout>()

export function layoutRich(src: string, o: RichOpts): RichLayout {
  const key = src + '|' + o.size + '|' + o.font + '|' + o.bold + '|' + o.italic + '|' + o.chem
  const hit = layoutCache.get(key)
  if (hit) return hit
  const lineH = o.size * 1.25
  const baseFont = fontCss(o.font)
  const built = parseRich(src).map((line) => {
    const toks: RTok[] = []
    // größte Schrift der Zeile bestimmt ihre Höhe (leere Zeile: Grundgröße)
    const em = line.length ? Math.max(...line.map((r) => o.size * (r.s ?? 1))) : o.size
    for (const r of line) {
      const rs = o.size * (r.s ?? 1)
      const b = r.b ?? !!o.bold
      const i = r.i ?? !!o.italic
      const font = r.font ? fontCss(r.font) : baseFont
      const pieces =
        // nur als „Summenformel“ markierter Text wird chemisch formatiert (wie in ChemDraw)
        !r.sup && !r.sub && (r.f || o.chem === true) ? formatChemText(r.t) : [{ t: r.t, kind: r.sup ? 'sup' : r.sub ? 'sub' : 'n' }]
      for (const p of pieces) {
        const small = p.kind !== 'n'
        const size = small ? rs * 0.7 : rs
        const dy = p.kind === 'sub' ? rs * 0.3 : p.kind === 'sup' ? -rs * 0.42 : 0
        const it = i || !!(p as TextTok).i
        toks.push({ t: p.t, w: textWidth(p.t, size, b, it, font), size, dy, b, i: it, u: !!r.u, color: r.color, font })
      }
    }
    return { toks, w: toks.reduce((s, t) => s + t.w, 0), em }
  })
  // Grundlinien: Oberlänge ≈ 1,0 · Größe, Unterlänge/Durchschuss ≈ 0,25 · Größe (einheitlich: Abstand 1,25 · Größe).
  // Die erste Zeile rückt um ihre zusätzliche Oberlänge nach unten, damit die Oberkante gleich bleibt.
  if (!built.length) built.push({ toks: [], w: 0, em: o.size })
  let y = built[0].em - o.size
  const lines = built.map((l, i) => {
    if (i > 0) y += 0.25 * built[i - 1].em + l.em
    return { toks: l.toks, w: l.w, y }
  })
  const lastY = lines[lines.length - 1].y
  const height = lastY + 0.25 * built[built.length - 1].em + o.size
  const res = { lines, width: Math.max(4, ...lines.map((l) => l.w)), height, lineH, lastY }
  if (layoutCache.size > 2000) layoutCache.clear()
  layoutCache.set(key, res)
  return res
}

/** Wort, das mit einer Einheit beginnt (danach Wortende oder Satzzeichen) */
const UNIT_START =
  /^(?:[µμnmk]?(?:g|L|l|mol|M)|°C|°F|°|K|%|h|min|s|sec|d|Äq\.?|äq\.?|equiv\.?|eq\.?|mol\s?%|wt\s?%|vol\s?%|Gew\.-%|Vol\.-%|bar|mbar|atm|Torr|psi|Pa|kPa|ppm|nm|µm|mm|cm|Hz|kHz|MHz|rpm|U\/min|W|mW|V|mV|mA|J|kJ|kcal|cal)(?=$|[\s,.;:)\]/])/

/**
 * Rich-Text auf eine Höchstbreite umbrechen (an Leerzeichen, Formatierung bleibt erhalten; ein einzelnes
 * überlanges Wort bleibt ganz). Vorhandene Zeilenumbrüche bleiben bestehen. Ergebnis: eine Zeile je Eintrag.
 */
export function wrapRich(src: string, o: RichOpts, maxW: number): string[] {
  const trimEnd = (runs: Run[]): Run[] => {
    const out = runs.map((r) => ({ ...r }))
    while (out.length) {
      const last = out[out.length - 1]
      last.t = last.t.replace(/\s+$/, '')
      if (last.t) break
      out.pop()
    }
    return out
  }
  const width = (runs: Run[]) => layoutRich(serializeRich([trimEnd(runs)]), o).width
  const out: string[] = []
  for (const line of parseRich(src)) {
    // Wörter samt folgendem Leerraum; ein Wort kann aus mehreren Abschnitten bestehen (H<sub>2</sub>O)
    const words: Run[][] = []
    let cur: Run[] = []
    for (const r of line) {
      for (const part of r.t.split(/(?<=\s)(?=\S)/)) {
        if (!part) continue
        cur.push({ ...r, t: part })
        if (/\s$/.test(part)) {
          words.push(cur)
          cur = []
        }
      }
    }
    if (cur.length) words.push(cur)
    // Zahl und Einheit nie trennen (25 mL, 0 °C, 41 h, 2,2 Äq.): Einheit an das vorige Wort hängen
    const plain = (w: Run[]) => w.map((r) => r.t).join('')
    for (let k = words.length - 1; k > 0; k--) {
      if (/\d\s*$/.test(plain(words[k - 1])) && UNIT_START.test(plain(words[k]))) {
        words[k - 1] = [...words[k - 1], ...words[k]]
        words.splice(k, 1)
      }
    }
    let acc: Run[] = []
    for (const w of words) {
      const cand = [...acc, ...w]
      if (acc.length && width(cand) > maxW) {
        out.push(serializeRich([trimEnd(acc)]))
        acc = [...w]
      } else acc = cand
    }
    out.push(serializeRich([trimEnd(acc)]))
  }
  return out
}

// ---------- Schrift „Symbol“ (wie in ChemDraw: lateinische Buchstaben → griechische) ----------

/** Belegung der klassischen Symbol-Schrift (Adobe Symbol Encoding) für A–Z und a–z */
const SYMBOL_LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const SYMBOL_GREEK = 'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖαβχδεφγηιϕκλμνοπθρστυϖωξψζ'

/** Text so umwandeln, als wäre er in der Schrift „Symbol“ gesetzt (a → α, b → β, D → Δ …); andere Zeichen bleiben */
export function toSymbolGreek(s: string): string {
  return s.replace(/[A-Za-z]/g, (c) => SYMBOL_GREEK[SYMBOL_LATIN.indexOf(c)] ?? c)
}

/** Ganzen Rich-Text in Symbol umwandeln (Formatierung bleibt) */
export function richToSymbolGreek(src: string): string {
  return serializeRich(parseRich(src).map((line) => line.map((r) => ({ ...r, t: toSymbolGreek(r.t) }))))
}

/** Chemisch relevanter Teil eines Labels: Rich-Text-Tags entfernt, hochgestellte Zusätze (Fe^II, Fe<sup>II</sup>) ignoriert */
export function chemLabel(label: string): string {
  if (!label.includes('<') && !label.includes('&')) return label.replace(/\^.*$/, '')
  return parseRich(label)
    .flat()
    .filter((r) => !r.sup)
    .map((r) => r.t)
    .join('')
    .replace(/\^.*$/, '')
    .trim()
}

export const isRichLabel = (label: string | undefined) => !!label && /<[a-z]/i.test(label)
