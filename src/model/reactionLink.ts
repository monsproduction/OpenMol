// Verknüpfung Ansatztabelle ↔ Reaktionspfeil: Temperatur, Zeit, Atmosphäre und Lösungsmittel stehen in beiden und
// werden nach jeder Änderung abgeglichen (läuft in jedem commit, siehe store.ts setCommitHook). Die Tabelle merkt sich
// die zuletzt abgeglichenen Werte (link); daran ist zu sehen, welche Seite sich geändert hat – die Tabelle hat Vorrang,
// wenn sich beide geändert haben. Im Pfeiltext wird nur der betroffene Teil ersetzt, Formatierung und Rest bleiben.
import { richPlain } from './richtext'
import { chemNameHtml, isAtmosphere, isTemperature, isTime, libLookup, rowFromName, solventMix } from './stoich'
import type { Arrow, Doc, Id, ReactionLink, StoichTable } from './types'

type Field = 'temperature' | 'time' | 'atmosphere'
const FIELDS: Field[] = ['temperature', 'time', 'atmosphere']
const DETECT: Record<Field, (t: string) => boolean> = { temperature: isTemperature, time: isTime, atmosphere: isAtmosphere }

// ---------- Pfeiltext in Teile zerlegen ----------

interface Piece {
  /** Rich-Text des Teils (ohne Trennzeichen) */
  html: string
  /** Trennzeichen davor („, “, „\n“ …; beim ersten Teil leer) */
  sep: string
}

/** Rich-Text an Kommas, Semikolons und Zeilenumbrüchen außerhalb von Klammern und HTML-Tags teilen */
function split(html: string): Piece[] {
  const out: Piece[] = []
  let depth = 0
  let inTag = false
  let cur = ''
  let sep = ''
  for (let i = 0; i < html.length; i++) {
    const ch = html[i]
    if (inTag) {
      cur += ch
      if (ch === '>') inTag = false
      continue
    }
    if (ch === '<') {
      inTag = true
      cur += ch
      continue
    }
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (depth === 0 && (ch === ',' || ch === ';' || ch === '\n')) {
      out.push({ html: cur, sep })
      let s = ch
      while (i + 1 < html.length && html[i + 1] === ' ') s += html[++i]
      sep = s
      cur = ''
      continue
    }
    cur += ch
  }
  out.push({ html: cur, sep })
  // Leerzeichen am Rand gehören zum Trennzeichen davor bzw. fallen weg
  return out.map((p) => ({ html: p.html.trim(), sep: p.sep }))
}

const join = (ps: Piece[]) =>
  ps
    .filter((p) => p.html)
    .map((p, i) => (i ? p.sep || ', ' : '') + p.html)
    .join('')

const plain = (html: string) => richPlain(html).replace(/\s+/g, ' ').trim()
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

// ---------- Werte beider Seiten ----------

interface Values {
  temperature?: string
  time?: string
  atmosphere?: string
  /** Lösungsmittel: Namen und Volumenteile */
  solvents?: { names: string[]; parts?: number[] }
}

/** Schlüssel eines Lösungsmittels: Bibliotheksname (AcOH = Essigsäure), sonst der Name */
const solvKey = (name: string) => (libLookup(name)?.names[0] ?? name).trim().toLowerCase()
const fmtPart = (p: number) => String(+p.toFixed(2))

function solventsKey(s: Values['solvents']): string | undefined {
  if (!s?.names.length) return undefined
  const k = s.names.map(solvKey).join('/')
  return s.parts && s.names.length > 1 ? k + '|' + s.parts.map(fmtPart).join(':') : k
}

/** Wo im Pfeiltext steht was (Zeile above/below und Index des Teils) */
type Loc = { line: 'above' | 'below'; i: number }

/** Werte des Pfeils; mehrere Lösungsmittel-Teile („THF, DMF“) zählen zusammen, die weiteren stehen in extra */
function arrowValues(a: Arrow): { v: Values; loc: Partial<Record<Field | 'solvents', Loc>>; extra: Loc[] } {
  const v: Values = {}
  const loc: Partial<Record<Field | 'solvents', Loc>> = {}
  const extra: Loc[] = []
  for (const line of ['above', 'below'] as const)
    split(a[line] ?? '').forEach((p, i) => {
      const t = plain(p.html)
      if (!t) return
      for (const f of FIELDS)
        if (!v[f] && DETECT[f](t)) {
          v[f] = t
          loc[f] = { line, i }
          return
        }
      const mix = solventMix(t)
      if (!mix) return
      if (!v.solvents) {
        v.solvents = mix
        loc.solvents = { line, i }
      } else {
        v.solvents = { names: [...v.solvents.names, ...mix.names] }
        extra.push({ line, i })
      }
    })
  return { v, loc, extra }
}

/** Lösungsmittel im Pfeil schreiben: weitere Lösungsmittel-Teile entfernen, den ersten ersetzen (bzw. vorn anfügen) */
function writeArrowSolvents(a: Arrow, loc: Loc | undefined, extra: Loc[], html: string | null) {
  // von hinten entfernen, damit die Positionen davor gültig bleiben (die weiteren stehen immer hinter dem ersten)
  for (const e of [...extra].sort((x, y) => (x.line === y.line ? y.i - x.i : x.line === 'below' ? -1 : 1))) writeArrow(a, e, null)
  writeArrow(a, loc, html, true)
}

function tableValues(t: StoichTable): Values {
  const solv = t.rows.filter((r) => r.role === 'solvent')
  const names = solv.map((r) => (r.name ?? r.formula ?? '').trim()).filter(Boolean)
  const parts = solv.every((r) => r.parts !== undefined) && solv.length > 1 ? solv.map((r) => r.parts!) : undefined
  return {
    temperature: t.temperature?.trim() || undefined,
    time: t.time?.trim() || undefined,
    atmosphere: t.atmosphere?.trim() || undefined,
    solvents: names.length ? { names, parts } : undefined,
  }
}

// ---------- Schreiben ----------

function solventsHtml(s: NonNullable<Values['solvents']>): string {
  const names = s.names.map(chemNameHtml).join('/')
  return s.parts && s.names.length > 1 ? `${names} (${s.parts.map(fmtPart).join(':')})` : names
}

/** einen Teil des Pfeiltexts ersetzen, entfernen (html = null) oder – wenn es ihn nicht gibt – unten anfügen */
function writeArrow(a: Arrow, loc: Loc | undefined, html: string | null, front = false) {
  if (loc) {
    const ps = split(a[loc.line] ?? '')
    if (html === null) {
      // das Trennzeichen davor übernimmt der nächste Teil (sonst ginge z. B. ein Zeilenumbruch verloren)
      if (loc.i > 0 && ps[loc.i + 1]) ps[loc.i + 1] = { ...ps[loc.i + 1], sep: ps[loc.i].sep }
      ps.splice(loc.i, 1)
    }
    else ps[loc.i] = { ...ps[loc.i], html }
    a[loc.line] = join(ps)
    return
  }
  if (html === null) return
  // unten anfügen – vor einer fett gesetzten Ausbeutezeile bzw. Lösungsmittel an den Anfang
  const ps = split(a.below ?? '').filter((p) => p.html)
  if (front) ps.unshift({ html, sep: '' })
  else ps.push({ html, sep: ', ' })
  if (front && ps[1]) ps[1] = { ...ps[1], sep: ps[1].sep || ', ' }
  a.below = join(ps)
}

function writeTableSolvents(t: StoichTable, s: Values['solvents']) {
  const want = s?.names ?? []
  const keyOf = (r: StoichTable['rows'][number]) => solvKey(r.name ?? r.formula ?? '')
  const old = t.rows.filter((r) => r.role === 'solvent')
  // in der Reihenfolge des Pfeils; vorhandene Zeilen behalten ihre Mengen, neue werden angelegt, fehlende fallen weg
  const block = want.map((name, i) => {
    const r = old.find((x) => keyOf(x) === solvKey(name)) ?? { ...rowFromName(name, 'solvent'), role: 'solvent' as const }
    r.parts = s?.parts?.[i]
    return r
  })
  const others = t.rows.filter((r) => r.role !== 'solvent')
  // Platz: wo bisher das erste Lösungsmittel stand, sonst vor den Produkten
  const first = t.rows.findIndex((r) => r.role === 'solvent')
  const prod = others.findIndex((r) => r.role === 'product')
  const pos = first >= 0 ? t.rows.slice(0, first).filter((r) => r.role !== 'solvent').length : prod >= 0 ? prod : others.length
  others.splice(pos, 0, ...block)
  t.rows = others
}

// ---------- Abgleich ----------

/** Ansatztabelle mit einem Pfeil verknüpfen: Lücken auf beiden Seiten füllen (es geht nichts verloren), dann merken */
export function linkTable(d: Doc, tableId: Id, arrowId: Id) {
  const t = d.tables[tableId]
  const a = d.arrows[arrowId]
  if (!t || !a) return
  const { v: av, loc, extra } = arrowValues(a)
  const tv = tableValues(t)
  for (const f of FIELDS) {
    if (av[f]) t[f] = av[f]
    else if (tv[f]) writeArrow(a, undefined, esc(tv[f]!))
  }
  // Lösungsmittel: beide Listen vereinigen
  const names = [...(av.solvents?.names ?? [])]
  for (const n of tv.solvents?.names ?? []) if (!names.some((x) => solvKey(x) === solvKey(n))) names.push(n)
  if (names.length) {
    const parts = av.solvents?.parts && names.length === av.solvents.names.length ? av.solvents.parts : undefined
    const s = { names, parts }
    writeTableSolvents(t, s)
    if (solventsKey(s) !== solventsKey(av.solvents)) writeArrowSolvents(a, loc.solvents, extra, solventsHtml(s))
  }
  t.link = { arrow: arrowId, ...snapshot(t) }
}

function snapshot(t: StoichTable): Omit<ReactionLink, 'arrow'> {
  const tv = tableValues(t)
  return { temperature: tv.temperature, time: tv.time, atmosphere: tv.atmosphere, solvents: solventsKey(tv.solvents) }
}

/** nach jeder Änderung: geänderte Seite auf die andere übertragen (Tabelle hat Vorrang) */
export function syncReactionLinks(d: Doc) {
  for (const t of Object.values(d.tables ?? {})) {
    const link = t.link
    if (!link) continue
    const a = d.arrows[link.arrow]
    if (!a) {
      delete t.link
      continue
    }
    const tv = tableValues(t)
    const { v: av, loc, extra } = arrowValues(a)
    for (const f of FIELDS) {
      if (tv[f] !== link[f]) {
        if (tv[f] !== av[f]) writeArrow(a, loc[f], tv[f] ? esc(tv[f]!) : null)
      } else if (av[f] !== link[f]) t[f] = av[f]
    }
    const tk = solventsKey(tv.solvents)
    const ak = solventsKey(av.solvents)
    if (tk !== link.solvents) {
      if (tk !== ak) writeArrowSolvents(a, loc.solvents, extra, tv.solvents ? solventsHtml(tv.solvents) : null)
    } else if (ak !== link.solvents) writeTableSolvents(t, av.solvents)
    const snap = snapshot(t)
    // nur bei Änderung schreiben (sonst entstünde bei jedem commit ein neues Tabellen-Objekt)
    if (FIELDS.some((f) => link[f] !== snap[f]) || link.solvents !== snap.solvents) t.link = { arrow: link.arrow, ...snap }
  }
}

/** nächstliegender Reaktionspfeil über bzw. neben der Tabelle (zum nachträglichen Verknüpfen) */
export function nearestArrow(d: Doc, t: StoichTable): Id | null {
  let best: { id: Id; dist: number } | null = null
  for (const a of Object.values(d.arrows)) {
    if (a.kind === 'retro' || a.kind === 'resonance') continue
    const cx = (a.x1 + a.x2) / 2
    const cy = (a.y1 + a.y2) / 2
    const dist = Math.hypot(cx - t.x, (cy - t.y) * 1.5)
    if (!best || dist < best.dist) best = { id: a.id, dist }
  }
  return best?.id ?? null
}
