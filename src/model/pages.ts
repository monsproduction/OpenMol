// Seitenlayouts wie in ChemDraw: ein Raster gleich großer Seiten (Spalten × Zeilen). Maßstab wie ChemDraw:
// 1 Dokument-Einheit = 0,36 pt, eine Bindung (40 Einheiten) = 14,4 pt, A4 = 1654 × 2339 Einheiten.
import { getScene, sceneBBox } from './scene'
import { MAX_PAGES, PAGE_FORMATS, type Doc, type PageLayout } from './types'

export const PT_PER_UNIT = 0.36
export { PAGE_FORMATS }

/** Größe einer Seite in Dokument-Einheiten */
export function pageDims(p: PageLayout): { w: number; h: number } {
  const f = PAGE_FORMATS.find((x) => x.id === p.format) ?? PAGE_FORMATS[4]
  const s = f.short / PT_PER_UNIT
  const l = f.long / PT_PER_UNIT
  return p.landscape ? { w: l, h: s } : { w: s, h: l }
}

/** alle Seiten (zeilenweise von links oben) */
export function pageRects(p: PageLayout): { x: number; y: number; w: number; h: number }[] {
  const { w, h } = pageDims(p)
  const out = []
  for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) out.push({ x: p.x + c * w, y: p.y + r * h, w, h })
  return out
}

/** gesamte Fläche aller Seiten */
export function sheetBox(p: PageLayout) {
  const { w, h } = pageDims(p)
  return { x1: p.x, y1: p.y, x2: p.x + p.cols * w, y2: p.y + p.rows * h }
}

/**
 * Layout für ein Format: so viele Seiten, dass die Zeichnung (mit Rand) darauf passt, Zeichnung mittig. Ein leeres
 * Dokument bekommt eine Seite um den Punkt `center`.
 */
export function fitLayout(doc: Doc, format: string, landscape: boolean, center: { x: number; y: number }): PageLayout {
  const { w, h } = pageDims({ format, landscape, x: 0, y: 0, cols: 1, rows: 1 })
  const box = sceneBBox(getScene(doc))
  if (!box) return { format, landscape: landscape || undefined, x: center.x - w / 2, y: center.y - h / 2, cols: 1, rows: 1 }
  const margin = Math.min(200, w * 0.1, h * 0.1)
  const cols = Math.max(1, Math.ceil((box.x2 - box.x1 + 2 * margin) / w))
  const rows = Math.max(1, Math.ceil((box.y2 - box.y1 + 2 * margin) / h))
  const cx = (box.x1 + box.x2) / 2
  // eine Seite: Zeichnung im oberen Teil (wie man ein Blatt beschreibt); mehrere: mittig
  const y = rows === 1 ? box.y1 - Math.min(h * 0.15, (h - (box.y2 - box.y1)) / 2) : (box.y1 + box.y2) / 2 - (rows * h) / 2
  return { format, landscape: landscape || undefined, x: cx - (cols * w) / 2, y, cols, rows }
}

/** Seite an einer Seite des Rasters anbauen */
export function addPageAt(p: PageLayout, side: 'top' | 'bottom' | 'left' | 'right'): PageLayout {
  const { w, h } = pageDims(p)
  if ((side === 'top' || side === 'bottom') && p.rows >= MAX_PAGES) return p
  if ((side === 'left' || side === 'right') && p.cols >= MAX_PAGES) return p
  if (side === 'top') return { ...p, rows: p.rows + 1, y: p.y - h }
  if (side === 'bottom') return { ...p, rows: p.rows + 1 }
  if (side === 'left') return { ...p, cols: p.cols + 1, x: p.x - w }
  return { ...p, cols: p.cols + 1 }
}

/** leere Randspalten/-zeilen entfernen (mindestens eine Seite bleibt) */
export function trimLayout(doc: Doc, p: PageLayout): PageLayout {
  const box = sceneBBox(getScene(doc))
  if (!box) return { ...p, cols: 1, rows: 1 }
  const { w, h } = pageDims(p)
  const c0 = Math.min(p.cols - 1, Math.max(0, Math.floor((box.x1 - p.x) / w)))
  const c1 = Math.max(c0, Math.min(p.cols - 1, Math.floor((box.x2 - p.x) / w)))
  const r0 = Math.min(p.rows - 1, Math.max(0, Math.floor((box.y1 - p.y) / h)))
  const r1 = Math.max(r0, Math.min(p.rows - 1, Math.floor((box.y2 - p.y) / h)))
  return { ...p, x: p.x + c0 * w, y: p.y + r0 * h, cols: c1 - c0 + 1, rows: r1 - r0 + 1 }
}
