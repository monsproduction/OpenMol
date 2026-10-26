// Export/Import: SVG, PNG, Molfile, SMILES, eigenes JSON-Format
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { extractClip, selectionAtomIds } from '../model/ops'
import { toMolfile, toSmiles } from '../model/ocl'
import { getScene, sceneBBox } from '../model/scene'
import { PT_PER_UNIT, pageRects } from '../model/pages'
import type { Doc } from '../model/types'
import { emptySelection, normalizeDoc, safeColor, selectionSize } from '../model/types'
import { DocContent } from '../render/DocSvg'
import { allTabs, getState, openTab, removeTab, replaceDoc, setState, switchTab, toast } from '../store'
import { completeSel, fitView, insertStructureText } from './actions'
import { encodeClipPayload } from './clipData'
import { T } from '../i18n/i18n'
import { desktop, type FileFilter } from '../desktop'

/** eigene Dateiendung; ältere Dateien (.chemdoc.json, .json) lassen sich weiter öffnen */
const FILE_EXT = '.openmol'
const DOC_FILTER: FileFilter[] = [{ name: 'OpenMol-Dokument', extensions: ['openmol'] }]
const EXPORT_FILTERS: Record<string, FileFilter[]> = {
  svg: [{ name: 'SVG-Grafik', extensions: ['svg'] }],
  png: [{ name: 'PNG-Bild', extensions: ['png'] }],
  mol: [{ name: 'Molfile', extensions: ['mol'] }],
  cdxml: [{ name: 'ChemDraw (CDXML)', extensions: ['cdxml'] }],
  json: [{ name: 'JSON', extensions: ['json'] }],
  pdf: [{ name: 'PDF', extensions: ['pdf'] }],
}

/** Desktop-App: Pfad des geöffneten bzw. zuletzt gespeicherten Dokuments („Speichern“ schreibt ohne Dialog dorthin) */
export const currentFilePath = () => getState().filePath

/**
 * Datei sichern: in der Desktop-App mit Sichern-Dialog, im Browser als Download.
 * Rückgabe: gespeichert (true) oder abgebrochen/fehlgeschlagen (false).
 */
export async function saveBlob(name: string, data: Blob): Promise<boolean> {
  if (!desktop) {
    download(name, data)
    return true
  }
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  const p = await desktop.saveDialog({ title: T('Exportieren'), defaultPath: name, filters: EXPORT_FILTERS[ext] ?? [{ name: ext.toUpperCase(), extensions: [ext] }] })
  if (!p) return false
  try {
    await desktop.writeFile(p, new Uint8Array(await data.arrayBuffer()))
    return true
  } catch (e) {
    toast(T('Datei konnte nicht gespeichert werden') + ': ' + (e instanceof Error ? e.message : String(e)), 'error')
    return false
  }
}

function download(name: string, data: Blob) {
  const url = URL.createObjectURL(data)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Zeichnung als SVG-Inhalt; im SVG-Kontext rendern (sonst hält React <linearGradient> usw. für HTML), äußeres <svg> wieder entfernen */
function innerMarkup(scene: ReturnType<typeof getScene>): string {
  return renderToStaticMarkup(createElement('svg', null, createElement(DocContent, { scene, exportMode: true })))
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '')
}

/** Dokument (oder Auswahl) als SVG-String */
export function exportSvgString(doc: Doc, opts: { onlySelection?: boolean; padding?: number; background?: string } = {}): {
  svg: string
  w: number
  h: number
} | null {
  let d = doc
  const { sel } = getState()
  if (opts.onlySelection && selectionSize(sel)) {
    const atoms = selectionAtomIds(doc, sel)
    d = {
      ...doc,
      atoms: Object.fromEntries([...atoms].map((id) => [id, doc.atoms[id]])),
      bonds: Object.fromEntries(Object.entries(doc.bonds).filter(([, b]) => atoms.has(b.a1) && atoms.has(b.a2))),
      arrows: Object.fromEntries(sel.arrows.map((id) => [id, doc.arrows[id]])),
      curved: Object.fromEntries(sel.curved.map((id) => [id, doc.curved[id]])),
      texts: Object.fromEntries(sel.texts.map((id) => [id, doc.texts[id]])),
      shapes: Object.fromEntries(sel.shapes.map((id) => [id, doc.shapes[id]])),
      fills: Object.fromEntries(Object.entries(doc.fills ?? {}).filter(([, f]) => f.rings.every((r) => r.every((a) => atoms.has(a))))),
      cycles: Object.fromEntries((sel.cycles ?? []).map((id) => [id, doc.cycles[id]])),
      tables: Object.fromEntries((sel.tables ?? []).map((id) => [id, doc.tables[id]])),
    }
    // gebogene Pfeile mit Ankern außerhalb der Auswahl weglassen
    for (const [id, c] of Object.entries(d.curved)) {
      const ok = (an: typeof c.from) =>
        an.type === 'point' || (an.type === 'bond' ? !!d.bonds[an.id] : !!d.atoms[an.id])
      if (!ok(c.from) || !ok(c.to)) delete d.curved[id]
    }
  }
  const scene = getScene(d)
  const box = sceneBBox(scene)
  if (!box) return null
  const pad = opts.padding ?? 12
  const x = box.x1 - pad
  const y = box.y1 - pad
  const w = Math.ceil(box.x2 - box.x1 + 2 * pad)
  const h = Math.ceil(box.y2 - box.y1 + 2 * pad)
  const inner = innerMarkup(scene)
  // Farbe wird von Hand ins SVG geschrieben – nur geprüfte Farbangaben (sonst ließe sich über eine Datei Code einschleusen)
  const bgc = safeColor(opts.background)
  const bg = bgc ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bgc}"/>` : ''
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">${bg}${inner}</svg>`
  return { svg, w, h }
}

function baseName() {
  return getState().fileName.replace(/\s+/g, '_') || 'struktur'
}

export function exportSvg(onlySelection = false) {
  const { doc } = getState()
  const r = exportSvgString(doc, { onlySelection, background: doc.style.background })
  if (!r) return toast('Nichts zu exportieren', 'error')
  void saveBlob(baseName() + '.svg', new Blob([r.svg], { type: 'image/svg+xml' }))
}

export async function svgToPngBlob(svg: string, w: number, h: number, scale: number): Promise<Blob> {
  const img = new Image()
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  await new Promise<void>((res, rej) => {
    img.onload = () => res()
    img.onerror = () => rej(new Error('SVG konnte nicht gerendert werden'))
    img.src = url
  })
  const c = document.createElement('canvas')
  c.width = Math.round(w * scale)
  c.height = Math.round(h * scale)
  const ctx = c.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.drawImage(img, 0, 0, w, h)
  URL.revokeObjectURL(url)
  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG fehlgeschlagen'))), 'image/png'))
}

// ---------- PNG-Auflösung (pHYs) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Schreibt die physikalische Auflösung in eine PNG-Datei, damit Word & Co. die richtige Größe verwenden */
export async function withPngDpi(blob: Blob, dpi: number): Promise<Blob> {
  const src = new Uint8Array(await blob.arrayBuffer())
  // IHDR endet nach 8 (Signatur) + 25 Byte
  const at = 33
  const ppm = Math.round(dpi / 0.0254)
  const chunk = new Uint8Array(21)
  const dv = new DataView(chunk.buffer)
  dv.setUint32(0, 9)
  chunk.set([0x70, 0x48, 0x59, 0x73], 4) // "pHYs"
  dv.setUint32(8, ppm)
  dv.setUint32(12, ppm)
  chunk[16] = 1 // Einheit: Meter
  dv.setUint32(17, crc32(chunk.subarray(4, 17)))
  const out = new Uint8Array(src.length + chunk.length)
  out.set(src.subarray(0, at), 0)
  out.set(chunk, at)
  out.set(src.subarray(at), at + chunk.length)
  return new Blob([out], { type: 'image/png' })
}

/** 1 Dokument-Einheit entspricht 0,36 pt (Bindungslänge 40 → 14,4 pt wie der ACS-Stil von ChemDraw) */
const UNITS_PER_INCH = 200

export async function renderPng(onlySelection: boolean, scale: number, transparent: boolean): Promise<Blob | null> {
  const { doc } = getState()
  const r = exportSvgString(doc, { onlySelection, background: transparent ? undefined : (doc.style.background ?? '#ffffff') })
  if (!r) return null
  const raw = await svgToPngBlob(r.svg, r.w, r.h, scale)
  return withPngDpi(raw, UNITS_PER_INCH * scale)
}

export async function exportPng(scale = 4, transparent = false, onlySelection = false) {
  try {
    const blob = await renderPng(onlySelection, scale, transparent)
    if (!blob) return toast('Nichts zu exportieren', 'error')
    await saveBlob(baseName() + '.png', blob)
  } catch (e) {
    toast(String(e), 'error')
  }
}

// ---------- Bild mit OpenMol-Daten (Austausch mit Word/PowerPoint) ----------

/** PNG-Textblock (tEXt) direkt nach dem Kopfblock einfügen */
function pngAddText(png: Uint8Array, keyword: string, text: string): Uint8Array {
  const data = new TextEncoder().encode(keyword + '\0' + text)
  const chunk = new Uint8Array(12 + data.length)
  const dv = new DataView(chunk.buffer)
  dv.setUint32(0, data.length)
  chunk.set([0x74, 0x45, 0x58, 0x74], 4) // "tEXt"
  chunk.set(data, 8)
  dv.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)))
  const at = 33 // nach Signatur (8) + IHDR (25)
  const out = new Uint8Array(png.length + chunk.length)
  out.set(png.subarray(0, at), 0)
  out.set(chunk, at)
  out.set(png.subarray(at), at + chunk.length)
  return out
}

/**
 * Bild der Auswahl (sonst der ganzen Zeichnung) mit den OpenMol-Daten: PNG mit Textblock „openmol“ = „OM1:….“.
 * Word und PowerPoint speichern das PNG unverändert; aus ihnen zurückkopiert macht OpenMol daraus wieder die Zeichnung.
 */
export async function imageWithClipData(wholeDrawing = false): Promise<{ png: Uint8Array; payload: string } | null> {
  const { doc, sel } = getState()
  const only = !wholeDrawing && selectionSize(sel) > 0
  const all = { ...emptySelection(), atoms: Object.keys(doc.atoms), bonds: Object.keys(doc.bonds), arrows: Object.keys(doc.arrows), curved: Object.keys(doc.curved), texts: Object.keys(doc.texts), shapes: Object.keys(doc.shapes), fills: Object.keys(doc.fills ?? {}), cycles: Object.keys(doc.cycles ?? {}), tables: Object.keys(doc.tables ?? {}) }
  const clip = extractClip(doc, completeSel(doc, only ? sel : all))
  const blob = await renderPng(only, 4, !doc.style.background)
  if (!blob) return null
  const payload = await encodeClipPayload(JSON.parse(JSON.stringify(clip)), doc.style)
  return { png: pngAddText(new Uint8Array(await blob.arrayBuffer()), 'openmol', payload), payload }
}

// ---------- PDF ----------

/**
 * PDF als HTML-Seite: je Blatt des Seitenlayouts ein SVG in Originalgröße (1 Einheit = 0,36 pt); ohne Seitenlayout
 * eine Seite in Größe der Zeichnung. Rückgabe mit Seitengröße in Zoll.
 */
export function pdfHtml(doc: Doc): { html: string; width: number; height: number; pages: number } | null {
  const scene = getScene(doc)
  let pages: { x: number; y: number; w: number; h: number }[]
  if (doc.style.page) pages = pageRects(doc.style.page)
  else {
    const box = sceneBBox(scene)
    if (!box) return null
    const pad = 24
    // mindestens 1 Zoll je Richtung, Zeichnung mittig: Chromium lehnt kleinere Seiten ab (unter ~0,8 Zoll
    // „content area is empty“ – z. B. ein einzelnes Brombenzol)
    const min = 72 / PT_PER_UNIT
    const w = Math.max(box.x2 - box.x1 + 2 * pad, min)
    const h = Math.max(box.y2 - box.y1 + 2 * pad, min)
    pages = [{ x: (box.x1 + box.x2 - w) / 2, y: (box.y1 + box.y2 - h) / 2, w, h }]
  }
  const inner = innerMarkup(scene)
  const bg = safeColor(doc.style.background) ?? '#ffffff'
  const W = +(pages[0].w * PT_PER_UNIT).toFixed(2)
  const H = +(pages[0].h * PT_PER_UNIT).toFixed(2)
  const sheets = pages.map(
    (p) =>
      `<div class="sheet"><svg xmlns="http://www.w3.org/2000/svg" width="${W}pt" height="${H}pt" viewBox="${p.x} ${p.y} ${p.w} ${p.h}"><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${bg}"/>${inner}</svg></div>`,
  )
  const css = `@page{size:${W}pt ${H}pt;margin:0}html,body{margin:0;padding:0}.sheet{width:${W}pt;height:${H}pt;overflow:hidden;break-after:page}.sheet:last-child{break-after:auto}svg{display:block}`
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${baseName().replace(/[<>&"]/g, '')}</title><style>${css}</style></head><body>${sheets.join('')}</body></html>`
  return { html, width: W / 72, height: H / 72, pages: pages.length }
}

/** PDF exportieren: Desktop als Vektor-PDF (je Blatt eine Seite), im Browser über den Druckdialog („Als PDF sichern“) */
export async function exportPdf() {
  const r = pdfHtml(getState().doc)
  if (!r) return toast('Nichts zu exportieren', 'error')
  if (desktop) {
    try {
      const bytes = await desktop.printPdf(r.html, { width: r.width, height: r.height })
      await saveBlob(baseName() + '.pdf', new Blob([bytes as BlobPart], { type: 'application/pdf' }))
    } catch (e) {
      toast(T('PDF konnte nicht erstellt werden') + ': ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
    return
  }
  browserPrint(r.html)
}

/** im Browser: Seiten in einem unsichtbaren Rahmen über den Druckdialog des Browsers */
function browserPrint(html: string) {
  const f = document.createElement('iframe')
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  f.srcdoc = html
  f.onload = () => {
    f.contentWindow?.focus()
    f.contentWindow?.print()
    setTimeout(() => f.remove(), 60_000)
  }
  document.body.appendChild(f)
}

/** Drucken (⌘P): dieselben Seiten wie beim PDF-Export (Seitenlayout aus dem Dokument-Stil, je Blatt eine Seite) */
export async function printDocument() {
  const r = pdfHtml(getState().doc)
  if (!r) return toast('Nichts zu drucken', 'error')
  if (!desktop) return browserPrint(r.html)
  try {
    const res = await desktop.print(r.html, { width: r.width, height: r.height })
    if (!res.ok && !res.canceled) toast(T('Drucken fehlgeschlagen') + (res.reason ? ': ' + res.reason : ''), 'error')
  } catch (e) {
    toast(T('Drucken fehlgeschlagen') + ': ' + (e instanceof Error ? e.message : String(e)), 'error')
  }
}

/** Kopiert die Auswahl (oder alles) als PNG – direkt in Word, PowerPoint, Keynote … einfügbar */
export async function copyImageToClipboard(silent = false) {
  const { sel } = getState()
  const only = selectionSize(sel) > 0
  try {
    // Desktop-App: über den Hauptprozess – die Web-Zwischenablage verlangt ein Fenster im Vordergrund und eine
    // Nutzeraktion (bei Menübefehlen nicht immer gegeben); schlägt sie fehl, bliebe der alte Inhalt liegen. Das PNG
    // trägt die OpenMol-Daten (Word/PowerPoint behalten es unverändert): zurückkopiert wird es wieder bearbeitbar
    if (desktop) {
      const r = await imageWithClipData()
      if (!r || !(await desktop.clipWrite('png', r.png))) throw new Error('leer')
      if (!silent) toast('Als Bild kopiert – in Word/PowerPoint einfach einfügen')
      return true
    }
    // Promise im ClipboardItem: funktioniert auch in Safari innerhalb der Nutzeraktion. Transparenter Hintergrund
    // (passt auf farbige Folien), außer das Dokument hat eine eigene Hintergrundfarbe; weiß gefüllte Objekte bleiben weiß
    const png = renderPng(only, 4, !getState().doc.style.background).then((b) => {
      if (!b) throw new Error('leer')
      return b
    })
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
    if (!silent) toast('Als Bild kopiert – in Word/PowerPoint einfach einfügen')
    return true
  } catch (e) {
    console.warn('Bild-Kopie fehlgeschlagen:', e)
    if (!silent) toast('Bild konnte nicht kopiert werden (Browser-Berechtigung)', 'error')
    return false
  }
}

function selectedAtomIds(): string[] | undefined {
  const { doc, sel } = getState()
  const ids = [...selectionAtomIds(doc, sel)]
  return ids.length ? ids : undefined
}

export function exportMolfile() {
  const { doc } = getState()
  if (!Object.keys(doc.atoms).length) return toast('Keine Struktur vorhanden', 'error')
  const mf = toMolfile(doc, selectedAtomIds())
  void saveBlob(baseName() + '.mol', new Blob([mf], { type: 'chemical/x-mdl-molfile' }))
}

export async function copySmiles() {
  const { doc } = getState()
  if (!Object.keys(doc.atoms).length) return toast('Keine Struktur vorhanden', 'error')
  const smi = toSmiles(doc, selectedAtomIds())
  try {
    await navigator.clipboard.writeText(smi)
    toast('SMILES kopiert: ' + (smi.length > 60 ? smi.slice(0, 60) + '…' : smi))
  } catch {
    // Desktop-App kennt kein prompt(): SMILES dann in der Meldung zeigen
    if (desktop) toast('SMILES: ' + smi)
    else window.prompt('SMILES:', smi)
  }
}

const hasContent = (doc: Doc) => (['atoms', 'texts', 'arrows', 'curved', 'shapes', 'cycles', 'tables'] as const).some((k) => Object.keys(doc[k] ?? {}).length)
const docJson = (doc: Doc) => JSON.stringify({ format: 'openmol', version: 1, doc }, null, 1)
const stripExt = (f: string) => f.replace(/\.openmol$|\.chemdoc\.json$|\.json$|\.mol$|\.sdf$|\.smi$|\.txt$|\.cdxml$/i, '')

/**
 * Speichern. Desktop: beim ersten Mal (oder „Speichern unter“) mit Dialog, danach direkt in dieselbe Datei.
 * Browser: als Download. Rückgabe: gespeichert?
 */
export async function saveDocument(saveAs = false): Promise<boolean> {
  const { doc, fileName } = getState()
  const base = fileName || 'Unbenannt'
  if (!desktop) {
    download(base + FILE_EXT, new Blob([docJson(doc)], { type: 'application/json' }))
    setState({ dirty: false })
    toast('Gespeichert')
    return true
  }
  let p = saveAs ? null : getState().filePath
  if (!p) {
    p = await desktop.saveDialog({ title: saveAs ? T('Speichern unter') : T('Speichern'), defaultPath: base + FILE_EXT, filters: DOC_FILTER })
    if (!p) return false
  }
  try {
    await desktop.writeFile(p, docJson(getState().doc))
  } catch (e) {
    toast(T('Datei konnte nicht gespeichert werden') + ': ' + (e instanceof Error ? e.message : String(e)), 'error')
    return false
  }
  setState({ dirty: false, filePath: p, fileName: stripExt(p.split(/[\\/]/).pop() ?? base) })
  toast('Gespeichert')
  return true
}

/**
 * Ungespeicherte Änderungen vor dem Verwerfen (Neu, Öffnen, Schließen): Desktop fragt „Sichern / Nicht sichern /
 * Abbrechen“, der Browser nur nach Bestätigung. Rückgabe: weitermachen?
 */
export async function confirmDiscard(): Promise<boolean> {
  const { doc, dirty, fileName } = getState()
  if (!dirty || !hasContent(doc)) return true
  if (!desktop) return window.confirm(T('Nicht gespeicherte Änderungen gehen verloren. Fortfahren?'))
  const r = await desktop.confirm({
    type: 'warning',
    message: T('Änderungen an „{0}“ sichern?').replace('{0}', fileName || 'Unbenannt'),
    detail: T('Ohne Sichern gehen die Änderungen verloren.'),
    buttons: [T('Sichern'), T('Nicht sichern'), T('Abbrechen')],
    cancelId: 2,
  })
  if (r === 0) return saveDocument()
  return r === 1
}

/**
 * Beim Beenden: alle Tabs mit ungesicherten Änderungen in einer Liste – „Alle sichern“ (nacheinander, unbenannte mit
 * Dialog), „Nicht sichern“ oder „Abbrechen“. Rückgabe: beenden?
 */
export async function confirmDiscardAll(): Promise<boolean> {
  const open = allTabs().filter((t) => t.dirty && hasContent(t.doc))
  if (!open.length) return true
  if (open.length === 1) {
    switchTab(open[0].id)
    return confirmDiscard()
  }
  if (!desktop) return window.confirm(T('Nicht gespeicherte Änderungen gehen verloren. Fortfahren?'))
  const r = await desktop.confirm({
    type: 'warning',
    message: T('{0} Dokumente haben ungesicherte Änderungen. Sichern?').replace('{0}', String(open.length)),
    detail: open.map((t) => '• ' + (t.fileName || 'Unbenannt')).join('\n') + '\n\n' + T('Ohne Sichern gehen die Änderungen verloren.'),
    buttons: [T('Alle sichern'), T('Nicht sichern'), T('Abbrechen')],
    cancelId: 2,
  })
  if (r !== 0) return r === 1
  for (const t of open) {
    switchTab(t.id)
    if (!(await saveDocument())) return false
  }
  return true
}

/** Neues Dokument in einem neuen Tab – immer im Standardstil (jede Datei bringt ihren eigenen Stil mit) */
export function newDocument() {
  openTab()
}

/** Tab schließen; bei ungesicherten Änderungen wird erst nachgefragt (dazu wird der Tab angezeigt) */
export async function closeTab(id = getState().activeTab): Promise<boolean> {
  const t = allTabs().find((x) => x.id === id)
  if (!t) return false
  if (t.dirty && hasContent(t.doc)) {
    switchTab(id)
    if (!(await confirmDiscard())) return false
  }
  removeTab(id)
  return true
}

/**
 * Geöffnetes Dokument anzeigen: ein leerer, unveränderter Tab wird wiederverwendet, sonst kommt es in einen neuen Tab.
 */
function showDocument(doc: Doc, name: string, path: string | null, dirty: boolean) {
  const st = getState()
  if (!st.dirty && !st.filePath && !hasContent(st.doc) && !st.past.length) {
    replaceDoc(doc, name)
    setState({ filePath: path, dirty, past: [] })
  } else openTab({ doc, fileName: name, filePath: path, dirty })
  setTimeout(() => fitView(1.5), 0)
}

/** Inhalt einer Datei öffnen: OpenMol-Dokumente (und ChemDraw-CDXML) ersetzen das Dokument, Strukturdateien werden eingefügt */
export async function openText(fname: string, text: string, path?: string) {
  const name = stripExt(fname)
  if (/\.(openmol|json)$/i.test(fname)) {
    let d: Doc
    try {
      const j = JSON.parse(text)
      d = (j.doc ?? j) as Doc
      if (!d.atoms) throw new Error(T('Kein gültiges Dokument'))
    } catch (e) {
      toast(T('Datei konnte nicht geöffnet werden') + ': ' + (e instanceof Error ? e.message : String(e)), 'error')
      return
    }
    // schon offen: zu diesem Tab wechseln
    const already = path ? allTabs().find((t) => t.filePath === path) : undefined
    if (already) return switchTab(already.id)
    showDocument(normalizeDoc(d), name, path ?? null, false)
    return
  }
  if (/\.cdxml$/i.test(fname)) {
    const { importCdxml } = await import('./cdxmlImport')
    let r: ReturnType<typeof importCdxml>
    try {
      r = importCdxml(text)
    } catch (e) {
      toast(T('ChemDraw-Datei konnte nicht gelesen werden') + ': ' + (e instanceof Error ? e.message : String(e)), 'error')
      return
    }
    // kein OpenMol-Dokument: „Speichern“ fragt nach einem Namen (die CDXML-Datei wird nicht überschrieben)
    showDocument(r.doc, name, null, true)
    if (r.skipped.length) toast(T('Nicht übernommen') + ': ' + r.skipped.join(', '))
    return
  }
  if (insertStructureText(text)) setTimeout(() => fitView(1.5), 0)
}

export async function openFile() {
  if (desktop) {
    const f = await desktop.openDialog({ title: T('Öffnen') })
    if (f) await openText(f.name, f.text, f.path)
    return
  }
  const inp = document.createElement('input')
  inp.type = 'file'
  inp.accept = '.openmol,.json,.cdxml,.mol,.sdf,.smi,.txt'
  inp.onchange = async () => {
    const f = inp.files?.[0]
    if (!f) return
    await openText(f.name, await f.text())
  }
  inp.click()
}
