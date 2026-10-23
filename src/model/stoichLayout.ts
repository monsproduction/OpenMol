// Geometrie der Ansatztabelle auf der Zeichenfläche (für Anzeige, Export, Treffer und CDXML).
// Stil wie in Publikationen: Linie oben, dünne Linie unter jeder Kopfzeile, Linie unten; Zahlen rechtsbündig.
import type { Box } from './geom'
import { getSettings } from '../settings'
import { layoutRich, wrapRich, type RichLayout } from './richtext'
import { STOICH_TEXT, computeTable, conditionsText, fmtNum, fmtQty, rowNameHtml, type TableCalc } from './stoich'
import type { Doc, StoichTable } from './types'

export interface TableCell {
  x: number
  /** Grundlinie */
  y: number
  lay: RichLayout
  align: 'left' | 'right'
  muted?: boolean
  /** GHS-Piktogramme statt Text (lay enthält die Codes als Text, z. B. für CDXML) */
  ghs?: string[]
  /** Kantenlänge eines Piktogramms */
  ghsSize?: number
}

export interface TableLine {
  x1: number
  x2: number
  y: number
  w: number
}

export interface TableGeom {
  cells: TableCell[]
  lines: TableLine[]
  box: Box
  calc: TableCalc
  /** Zeilenbereiche (y von–bis) je Tabellenzeile, für das Hervorheben im Editor */
  rowBands: { row: number; y1: number; y2: number }[]
}

/** Schriftgröße der Tabelle relativ zur Dokument-Schriftgröße (bei Faktor 1) */
export const TABLE_FONT_FACTOR = 0.62

const cache = new WeakMap<Doc, Map<string, TableGeom>>()

export function tableGeom(doc: Doc, t: StoichTable): TableGeom {
  let c = cache.get(doc)
  if (!c) {
    c = new Map()
    cache.set(doc, c)
  }
  const key = t.id + '|' + getSettings().decimal + '|' + JSON.stringify(t)
  const hit = c.get(key)
  if (hit) return hit
  const g = build(doc, t)
  c.set(key, g)
  return g
}

function build(doc: Doc, t: StoichTable): TableGeom {
  const L = t.lang
  const T = STOICH_TEXT[L]
  const size = doc.style.fontSize * TABLE_FONT_FACTOR * (t.scale ?? 1)
  const font = doc.style.font
  const lay = (html: string, bold = false) => layoutRich(html || ' ', { size, font, bold })
  const calc = computeTable(doc, t)
  const rowH = size * 1.55
  const gap = size * 1.1

  const amount = t.rows.map((r, i) => ({ r, i })).filter((x) => x.r.role === 'reactant' || x.r.role === 'reagent' || x.r.role === 'catalyst')
  const solvents = t.rows.map((r, i) => ({ r, i })).filter((x) => x.r.role === 'solvent')
  const products = t.rows.map((r, i) => ({ r, i })).filter((x) => x.r.role === 'product')
  const hasRho = amount.some(({ r }) => r.density)
  const hasSolvRho = solvents.some(({ r }) => r.density)
  const hasConc = amount.some(({ r }) => r.conc)
  const hasCas = t.rows.some((r) => r.cas)
  const casTxt = (r: (typeof t.rows)[number]) => (hasCas ? (r.cas ?? '') : null)
  // GHS-Spalte: Zelleninhalt als Marker, wird unten zu Piktogrammen
  const GHS_MARK = '\u0001'
  const hasGhs = t.rows.some((r) => r.ghs?.length)
  const ghsTxt = (r: (typeof t.rows)[number]) => (hasGhs ? GHS_MARK + (r.ghs ?? []).join(',') : null)
  // Piktogramme so groß wie die Zeilenhöhe (die offiziellen Grafiken haben etwas Rand um die Raute)
  const ghsSize = size * 1.5
  // jede Zahl mit ihrer Einheit dahinter (Spaltenköpfe nennen nur die Größe)
  const rhoTxt = (r: (typeof t.rows)[number]) => (r.density ? fmtNum(r.density, L, 3) + ' g/mL' : '')
  const concTxt = (r: (typeof t.rows)[number]) => (r.conc ? fmtNum(r.conc, L, r.conc >= 10 ? 1 : 2) + ' mol/L' : '')
  const mwTxt = (mw: number | undefined) => (mw ? fmtNum(mw, L, 2) + ' g/mol' : '')
  const eqNum = (v: number) => fmtNum(v, L, 2) + ' ' + T.eqUnit

  // Spalten: 0 Name · 1 CAS · 2 GHS · 3 M · 4 Äq. · 5 n · 6 m · 7 V · 8 ρ · 9 c (Produkte: 5 n theor. · 6 m theor. · 7 m erh. · 8 Ausbeute)
  type Row = { kind: 'head' | 'row'; cells: (string | null)[]; bold?: boolean[]; row?: number }
  const rows: Row[] = []
  const unitOf = (i: number, k: 'm' | 'n' | 'V' | 'obt') => t.rows[i].units?.[k]
  if (amount.length) {
    rows.push({ kind: 'head', cells: [T.reactants, hasCas ? T.cas : null, hasGhs ? 'GHS' : null, T.mw, T.eq, T.n, T.m, T.V, hasRho || hasSolvRho ? T.rho : null, hasConc ? T.concCol : null] })
    for (const { r, i } of amount) {
      const c = calc.rows[i]
      const isRef = i === calc.refIndex
      const eqTxt = c.eq === undefined ? '' : r.role === 'catalyst' && !isRef ? fmtNum(c.eq * 100, L, 1) + ' mol%' : eqNum(c.eq)
      rows.push({
        kind: 'row',
        row: i,
        cells: [
          rowNameHtml(doc, r) + (r.role === 'catalyst' ? ` <i>(${T.catalyst})</i>` : ''),
          casTxt(r),
          ghsTxt(r),
          mwTxt(c.mw),
          eqTxt,
          fmtQty('n', c.n, L, unitOf(i, 'n')),
          // Lösung: eingesetzt wird das Volumen (Masse des reinen Stoffes entfällt)
          r.conc ? '' : fmtQty('m', c.m, L, unitOf(i, 'm')),
          fmtQty('V', c.V, L, unitOf(i, 'V')),
          hasRho || hasSolvRho ? rhoTxt(r) : null,
          hasConc ? concTxt(r) : null,
        ],
        bold: [false, false, false, false, isRef, false, false, false, false, false],
      })
    }
  }
  if (solvents.length) {
    rows.push({ kind: 'head', cells: [T.solvents, hasCas ? '' : null, hasGhs ? '' : null, '', '', '', T.m, T.V, hasRho || hasSolvRho ? T.rho : null, hasConc ? '' : null] })
    for (const { r, i } of solvents) {
      const c = calc.rows[i]
      rows.push({
        kind: 'row',
        row: i,
        cells: [
          rowNameHtml(doc, r),
          casTxt(r),
          ghsTxt(r),
          '',
          '',
          '',
          fmtQty('m', c.m, L, unitOf(i, 'm')),
          fmtQty('V', c.V, L, unitOf(i, 'V')),
          hasRho || hasSolvRho ? rhoTxt(r) : null,
          hasConc ? '' : null,
        ],
      })
    }
  }
  if (products.length) {
    rows.push({ kind: 'head', cells: [T.products, hasCas ? T.cas : null, hasGhs ? 'GHS' : null, T.mw, T.eq, T.theoN, T.theoM, T.obt, T.yield, null] })
    for (const { r, i } of products) {
      const c = calc.rows[i]
      rows.push({
        kind: 'row',
        row: i,
        cells: [
          rowNameHtml(doc, r),
          casTxt(r),
          ghsTxt(r),
          mwTxt(c.mw),
          c.eq !== undefined && c.eq !== 1 ? eqNum(c.eq) : '',
          fmtQty('n', c.theoN, L, unitOf(i, 'n')),
          fmtQty('m', c.theoM, L, unitOf(i, 'm')),
          fmtQty('m', r.obtained, L, unitOf(i, 'obt')),
          c.yieldPct !== undefined ? fmtNum(c.yieldPct, L, 0) + ' %' : '',
          null,
        ],
      })
    }
  }

  // Spaltenbreiten
  const nCols = 10
  const widths = new Array(nCols).fill(0)
  const lays = rows.map((row) =>
    row.cells.map((txt, k) => {
      if (txt === null) return null
      if (txt.startsWith(GHS_MARK)) {
        const codes = txt.slice(1).split(',').filter(Boolean)
        const l = { ...lay(codes.join(' ')), width: codes.length ? codes.length * ghsSize * 1.02 : 0, ghs: codes }
        widths[k] = Math.max(widths[k], l.width)
        return l
      }
      const l = lay(txt, row.kind === 'head' || !!row.bold?.[k])
      widths[k] = Math.max(widths[k], l.width)
      return l
    }),
  )
  const xs: number[] = []
  let x = t.x
  for (let k = 0; k < nCols; k++) {
    xs.push(x)
    if (widths[k] > 0) x += widths[k] + gap
  }
  const right = x - gap
  const cells: TableCell[] = []
  const lines: TableLine[] = []
  const rowBands: TableGeom['rowBands'] = []
  let y = t.y
  lines.push({ x1: t.x, x2: right, y, w: 1.3 })
  rows.forEach((row, ri) => {
    const base = y + rowH * 0.68
    lays[ri].forEach((l, k) => {
      if (!l || widths[k] === 0) return
      const leftAligned = k <= 2
      const ghs = (l as { ghs?: string[] }).ghs
      cells.push({ x: leftAligned ? xs[k] : xs[k] + widths[k], y: base, lay: l, align: leftAligned ? 'left' : 'right', muted: row.kind === 'head', ...(ghs ? { ghs, ghsSize } : {}) })
    })
    if (row.kind === 'row' && row.row !== undefined) rowBands.push({ row: row.row, y1: y, y2: y + rowH })
    y += rowH
    if (row.kind === 'head') lines.push({ x1: t.x, x2: right, y: y - rowH * 0.12, w: 0.6 })
    else if (rows[ri + 1]?.kind === 'head') y += rowH * 0.25
  })
  lines.push({ x1: t.x, x2: right, y: y + rowH * 0.1, w: 1.3 })
  y += rowH * 0.1
  // Bedingungen und Notizen unter der Tabelle
  const cond = conditionsText(t, calc)
  const extra = [cond ? `<b>${T.conditions}:</b> ${cond}` : '', t.notes?.trim() ? t.notes.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;') : ''].filter(Boolean)
  // nicht breiter als die Tabelle: an Leerzeichen umbrechen (Folgezeilen enger als Tabellenzeilen)
  const maxW = Math.max(right - t.x, size * 20)
  for (const e of extra) {
    wrapRich(e, { size, font }, maxW).forEach((ln, k) => {
      y += k === 0 ? rowH : size * 1.3
      cells.push({ x: t.x, y: y - rowH * 0.32, lay: lay(ln), align: 'left' })
    })
  }
  const box: Box = { x1: t.x, y1: t.y, x2: Math.max(right, ...cells.map((c) => (c.align === 'left' ? c.x + c.lay.width : c.x))), y2: y + rowH * 0.15 }
  if (!rows.length) {
    // leere Tabelle: Platzhalter-Rahmen
    box.x2 = t.x + size * 14
    box.y2 = t.y + rowH * 2
    cells.push({ x: t.x + size * 0.5, y: t.y + rowH * 1.1, lay: lay(L === 'de' ? 'Ansatztabelle – Stoffe im Bereich unten hinzufügen' : 'Stoichiometry table – add compounds below'), align: 'left', muted: true })
  }
  return { cells, lines, box, calc, rowBands }
}
