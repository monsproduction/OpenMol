// Verknüpfung Ansatztabelle ↔ Reaktionspfeil: Temperatur, Zeit, Atmosphäre, Lösungsmittel (samt Volumenteilen und
// Zielkonzentration) stehen in beiden und werden nach jeder Änderung abgeglichen (läuft in jedem commit, siehe
// store.ts setCommitHook). Die Tabelle merkt sich die zuletzt abgeglichenen Werte (link); daran ist zu sehen, welche
// Seite sich geändert hat – die Tabelle hat Vorrang, wenn sich beide geändert haben.
// Grundsätze:
//  • Was abgeglichen wurde, wird im Pfeil immer wiedererkannt – auch Angaben ohne bekanntes Muster („0 °C → RT“,
//    „Sulfolan“, „2 h, dann 16 h“). Sonst hielte der nächste Abgleich sie für gelöscht und entfernte sie.
//  • Im Pfeiltext wird nur der betroffene Teil ersetzt; Formatierung am Rand des Teils (fett, Formel-Span) bleibt.
//  • Lösungsmittel vergleicht der Abgleich unabhängig von der Reihenfolge; neue kommen hinten dazu.
import { richPlain } from './richtext'
import { chemNameHtml, fmtNum, isAtmosphere, isTemperature, isTime, libLookup, rowFromName, solventMix, splitSolvents } from './stoich'
import type { Arrow, Doc, Id, ReactionLink, StoichTable } from './types'

type Field = 'temperature' | 'time' | 'atmosphere'
const FIELDS: Field[] = ['temperature', 'time', 'atmosphere']
const DETECT: Record<Field, (t: string) => boolean> = { temperature: isTemperature, time: isTime, atmosphere: isAtmosphere }
type Line = 'above' | 'below'
const LINES: Line[] = ['above', 'below']

// ---------- Pfeiltext in Teile zerlegen ----------

interface Piece {
  /** Rich-Text des Teils (ohne Trennzeichen) */
  html: string
  /** Trennzeichen davor („, “, „\n“ …); leer = direkt angehängt (beim ersten Teil immer leer) */
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
    // „;“ am Ende einer HTML-Entität (&lt; &amp; &nbsp; &#8722;) trennt nicht
    const entity = ch === ';' && /&[#a-z0-9]+$/i.test(cur)
    if (depth === 0 && !entity && (ch === ',' || ch === ';' || ch === '\n')) {
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
  return out.map((p) => ({ html: p.html.trim(), sep: p.sep }))
}

const join = (ps: Piece[]) =>
  ps
    .filter((p) => p.html)
    .map((p, i) => (i ? p.sep : '') + p.html)
    .join('')

const plain = (html: string) => richPlain(html).replace(/\s+/g, ' ').trim()
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
/** HTML-Tags am Anfang bzw. Ende eines Teils (z. B. <b> … </b>, ein über das Komma reichender Formel-Span) */
const leadTags = (h: string) => /^(?:<[^>]+>)*/.exec(h)![0]
const trailTags = (h: string) => /(?:<[^>]+>)*$/.exec(h)![0]
const opens = (tags: string) => (tags.match(/<[a-z][^>]*>/gi) ?? []).length
const closes = (tags: string) => (tags.match(/<\/[a-z][^>]*>/gi) ?? []).length

// ---------- Werte beider Seiten ----------

interface Solvents {
  names: string[]
  parts?: number[]
  conc?: number
}

interface Values {
  temperature?: string
  time?: string
  atmosphere?: string
  solvents?: Solvents
}

/** Schlüssel eines Lösungsmittels: Bibliotheksname (AcOH = Essigsäure), sonst der Name */
const solvKey = (name: string) => (libLookup(name)?.names[0] ?? name).trim().toLowerCase()
const fmtPart = (p: number) => String(+p.toFixed(3))

/** Vergleichsschlüssel, unabhängig von der Reihenfolge: „acoh:10/h2o:2|c=0.41“ */
function solventsKey(s: Solvents | undefined): string | undefined {
  // ohne Lösungsmittel keine Angabe im Pfeil (auch keine Konzentration – sie gehört an das Lösungsmittel)
  if (!s?.names.length) return undefined
  const withParts = !!s.parts && s.parts.length === s.names.length && s.names.length > 1
  const items = s.names.map((n, i) => solvKey(n) + (withParts ? ':' + fmtPart(s.parts![i]) : '')).sort()
  return items.join('/') + (s.conc ? '|c=' + fmtPart(s.conc) : '')
}

/** Ort im Pfeiltext: Zeile, erster Teil und Anzahl Teile */
type Loc = { line: Line; i: number; n: number }

/**
 * Werte des Pfeils. Zuerst werden die zuletzt abgeglichenen Werte (link) gesucht – auch über mehrere Teile („2 h,
 * dann 16 h“) –, dann die üblichen Muster. Mehrere Lösungsmittel-Teile („THF, DMF“) und eine einzeln stehende
 * Konzentration („0.1 M“) zählen zum Lösungsmittel; die weiteren Teile stehen in extra.
 */
function arrowValues(a: Arrow, link?: Partial<ReactionLink>): { v: Values; loc: Partial<Record<Field | 'solvents', Loc>>; extra: Loc[] } {
  const v: Values = {}
  const loc: Partial<Record<Field | 'solvents', Loc>> = {}
  const extra: Loc[] = []
  const lines: Record<Line, Piece[]> = { above: split(a.above ?? ''), below: split(a.below ?? '') }
  const used = new Set<string>()
  const span = (line: Line, i: number, n: number) =>
    plain(
      lines[line]
        .slice(i, i + n)
        .map((p, k) => (k ? p.sep.trim() + ' ' : '') + p.html)
        .join(''),
    )
  const free = (line: Line, i: number, n: number) => {
    for (let k = i; k < i + n; k++) if (used.has(line + k) || !plain(lines[line][k]?.html ?? '')) return false
    return true
  }
  const take = (line: Line, i: number, n: number): Loc => {
    for (let k = i; k < i + n; k++) used.add(line + k)
    return { line, i, n }
  }
  // 1. zuletzt abgeglichene Werte wiederfinden (längste Spanne zuerst)
  for (const f of FIELDS) {
    const want = link?.[f]?.replace(/\s+/g, ' ').trim()
    if (!want) continue
    search: for (let n = 8; n >= 1; n--)
      for (const line of LINES)
        for (let i = 0; i + n <= lines[line].length; i++)
          if (free(line, i, n) && span(line, i, n) === want) {
            v[f] = link![f]
            loc[f] = take(line, i, n)
            break search
          }
  }
  if (link?.solvents) {
    // genau wie zuletzt – sonst der Teil, der die meisten der bisherigen Lösungsmittel nennt (auch unbekannte Stoffe
    // wie „Sulfolan“: geändert wurde dann z. B. nur das Verhältnis)
    const before = new Set(link.solvents.split('|')[0].split('/').map((x) => x.split(':')[0]))
    let best: { line: Line; i: number; s: Solvents; score: number } | null = null
    for (const line of LINES)
      for (let i = 0; i < lines[line].length; i++) {
        if (!free(line, i, 1)) continue
        const s = splitSolvents(span(line, i, 1))
        if (!s) continue
        const score = solventsKey(s) === link.solvents ? Infinity : s.names.filter((n) => before.has(solvKey(n))).length
        if (score > 0 && (!best || score > best.score)) best = { line, i, s, score }
      }
    if (best) {
      v.solvents = best.s
      loc.solvents = take(best.line, best.i, 1)
    }
  }
  // 2. übliche Muster
  for (const line of LINES)
    lines[line].forEach((_p, i) => {
      if (!free(line, i, 1)) return
      const t = span(line, i, 1)
      for (const f of FIELDS)
        if (!v[f] && DETECT[f](t)) {
          v[f] = t
          loc[f] = take(line, i, 1)
          return
        }
      const mix = solventMix(t)
      if (!mix) return
      if (!v.solvents) {
        v.solvents = mix
        loc.solvents = take(line, i, 1)
      } else {
        const names = [...v.solvents.names]
        for (const n of mix.names) if (!names.some((x) => solvKey(x) === solvKey(n))) names.push(n)
        v.solvents = { names, conc: v.solvents.conc ?? mix.conc }
        extra.push(take(line, i, 1))
      }
    })
  // einzeln stehende Konzentration („THF, 0.1 M“) gehört zum Lösungsmittel
  if (v.solvents && !v.solvents.conc)
    for (const line of LINES)
      lines[line].forEach((_p, i) => {
        if (v.solvents!.conc || !free(line, i, 1)) return
        const s = splitSolvents('x (' + span(line, i, 1) + ')')
        if (s?.conc && !s.parts) {
          v.solvents = { ...v.solvents!, conc: s.conc }
          extra.push(take(line, i, 1))
        }
      })
  return { v, loc, extra }
}

function tableValues(t: StoichTable): Values {
  const solv = t.rows.filter((r) => r.role === 'solvent' && (r.name ?? r.formula ?? '').trim())
  const names = solv.map((r) => (r.name ?? r.formula ?? '').trim())
  const parts = solv.length > 1 && solv.every((r) => r.parts !== undefined) ? solv.map((r) => r.parts!) : undefined
  return {
    temperature: t.temperature?.trim() || undefined,
    time: t.time?.trim() || undefined,
    atmosphere: t.atmosphere?.trim() || undefined,
    solvents: names.length ? { names, parts, conc: t.targetConc } : undefined,
  }
}

// ---------- Schreiben ----------

function solventsHtml(s: Solvents): string {
  const names = s.names.map(chemNameHtml).join('/')
  const inner = [s.parts && s.names.length > 1 ? s.parts.map(fmtPart).join(':') : '', s.conc ? fmtNum(s.conc, 'de', s.conc >= 0.1 ? 2 : 3) + ' M' : ''].filter(Boolean)
  if (!names) return inner.join(', ')
  return inner.length ? `${names} (${inner.join(', ')})` : names
}

/**
 * Teile ersetzen (html) bzw. entfernen (null) oder – wenn es sie nicht gibt – anfügen (unten; Lösungsmittel vorn).
 * Tags am Rand der ersetzten Teile bleiben erhalten.
 */
function writeArrow(a: Arrow, loc: Loc | undefined, html: string | null, front = false) {
  if (loc) {
    const ps = split(a[loc.line] ?? '')
    const first = ps[loc.i]
    const last = ps[loc.i + loc.n - 1]
    if (!first || !last) return
    const lead = leadTags(first.html)
    const trail = trailTags(last.html)
    if (html !== null) ps.splice(loc.i, loc.n, { html: lead + html + trail, sep: first.sep })
    else {
      ps.splice(loc.i, loc.n)
      const prev = ps[loc.i - 1]
      const next = ps[loc.i]
      // nicht ausgeglichene Tags (ein über das Komma reichender Span) an die Nachbarn weitergeben
      if (opens(lead) !== closes(trail)) {
        if (prev) prev.html += trail
        else if (next) next.html = trail + next.html
        if (next) next.html = lead + next.html
        else if (prev) prev.html += lead
      }
      // das Trennzeichen davor übernimmt der nächste Teil (sonst ginge z. B. ein Zeilenumbruch verloren)
      if (next) next.sep = loc.i > 0 ? first.sep : ''
    }
    a[loc.line] = join(ps)
    return
  }
  if (!html) return
  const ps = split(a.below ?? '').filter((p) => p.html)
  if (front) {
    if (ps[0]) ps[0] = { ...ps[0], sep: ', ' }
    ps.unshift({ html, sep: '' })
  } else ps.push({ html, sep: ', ' })
  a.below = join(ps)
}

/** Lösungsmittel im Pfeil schreiben: weitere Lösungsmittel-Teile entfernen, den ersten ersetzen (bzw. vorn anfügen) */
function writeArrowSolvents(a: Arrow, loc: Loc | undefined, extra: Loc[], html: string | null) {
  // von hinten entfernen, damit die Positionen davor gültig bleiben; ein entfernter Teil vor dem ersten auf derselben
  // Zeile verschiebt dessen Position
  for (const e of [...extra].sort((x, y) => (x.line === y.line ? y.i - x.i : x.line === 'below' ? -1 : 1))) {
    writeArrow(a, e, null)
    if (loc && e.line === loc.line && e.i < loc.i) loc = { ...loc, i: loc.i - e.n }
  }
  writeArrow(a, loc, html || null, true)
}

/** Reihenfolge für den Pfeil: vorhandene Lösungsmittel des Pfeils in dessen Reihenfolge, neue hinten */
function arrowOrder(table: Solvents, arrow: Solvents | undefined): Solvents {
  if (!arrow?.names.length) return table
  const idx = (n: string) => {
    const k = arrow.names.findIndex((x) => solvKey(x) === solvKey(n))
    return k < 0 ? Infinity : k
  }
  const order = table.names.map((_n, i) => i).sort((x, y) => idx(table.names[x]) - idx(table.names[y]) || x - y)
  return { names: order.map((i) => table.names[i]), parts: table.parts ? order.map((i) => table.parts![i]) : undefined, conc: table.conc }
}

function writeTableSolvents(t: StoichTable, s: Solvents | undefined, keepConc = false) {
  const want = s?.names ?? []
  const keyOf = (r: StoichTable['rows'][number]) => solvKey(r.name ?? r.formula ?? '')
  const old = t.rows.filter((r) => r.role === 'solvent')
  // in der Reihenfolge des Pfeils; vorhandene Zeilen behalten ihre Mengen, neue werden angelegt, fehlende fallen weg;
  // Lösungsmittel-Zeilen ohne Namen bleiben (sie stehen nicht im Pfeil)
  const used = new Set<StoichTable['rows'][number]>()
  const block = want.map((name, i) => {
    const r = old.find((x) => !used.has(x) && keyOf(x) === solvKey(name)) ?? { ...rowFromName(name, 'solvent'), role: 'solvent' as const }
    used.add(r)
    r.parts = s?.parts?.[i]
    return r
  })
  for (const r of old) if (!used.has(r) && !(r.name ?? r.formula ?? '').trim()) block.push(r)
  const others = t.rows.filter((r) => r.role !== 'solvent')
  // Platz: wo bisher das erste Lösungsmittel stand, sonst vor den Produkten
  const first = t.rows.findIndex((r) => r.role === 'solvent')
  const prod = others.findIndex((r) => r.role === 'product')
  const pos = first >= 0 ? t.rows.slice(0, first).filter((r) => r.role !== 'solvent').length : prod >= 0 ? prod : others.length
  others.splice(pos, 0, ...block)
  t.rows = others
  // Zielkonzentration kommt mit dem Lösungsmittel; ohne Lösungsmittel im Pfeil bleibt die der Tabelle
  if (!keepConc || s?.names.length) t.targetConc = s?.conc
}

// ---------- Abgleich ----------

function snapshot(t: StoichTable): Omit<ReactionLink, 'arrow'> {
  const tv = tableValues(t)
  return { temperature: tv.temperature, time: tv.time, atmosphere: tv.atmosphere, solvents: solventsKey(tv.solvents) }
}

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
  // Lösungsmittel: beide Listen vereinigen (Pfeil zuerst); Teile und Konzentration aus dem Pfeil, sonst aus der Tabelle
  const names = [...(av.solvents?.names ?? [])]
  for (const n of tv.solvents?.names ?? []) if (!names.some((x) => solvKey(x) === solvKey(n))) names.push(n)
  if (names.length) {
    const fromArrow = av.solvents?.parts && names.length === av.solvents.names.length
    const tableParts = (n: string) => tv.solvents?.parts?.[tv.solvents.names.findIndex((x) => solvKey(x) === solvKey(n))]
    const parts = fromArrow ? av.solvents!.parts : names.every((n) => tableParts(n) !== undefined) ? names.map((n) => tableParts(n)!) : undefined
    writeTableSolvents(t, { names, parts, conc: av.solvents?.conc ?? tv.solvents?.conc })
    const now = tableValues(t).solvents
    if (now && solventsKey(now) !== solventsKey(av.solvents)) writeArrowSolvents(a, loc.solvents, extra, solventsHtml(arrowOrder(now, av.solvents)))
  }
  t.link = { arrow: arrowId, ...snapshot(t) }
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
    for (const f of FIELDS) {
      // nach jedem Schreiben neu lesen: die Positionen im Pfeiltext können sich verschoben haben
      const { v: av, loc } = arrowValues(a, link)
      if (tv[f] !== link[f]) {
        if (tv[f] !== av[f]) writeArrow(a, loc[f], tv[f] ? esc(tv[f]!) : null)
      } else if (av[f] !== link[f]) t[f] = av[f]
    }
    const { v: av, loc, extra } = arrowValues(a, link)
    const tk = solventsKey(tv.solvents)
    const ak = solventsKey(av.solvents)
    if (tk !== link.solvents) {
      if (tk !== ak) writeArrowSolvents(a, loc.solvents, extra, tv.solvents ? solventsHtml(arrowOrder(tv.solvents, av.solvents)) : null)
    } else if (ak !== link.solvents) writeTableSolvents(t, av.solvents, true)
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
