// Export/Import: SVG, PNG, Molfile, SMILES, eigenes JSON-Format
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { selectionAtomIds } from '../model/ops'
import { toMolfile, toSmiles } from '../model/ocl'
import { getScene, sceneBBox } from '../model/scene'
import type { Doc } from '../model/types'
import { emptyDoc, normalizeDoc, selectionSize } from '../model/types'
import { DocContent } from '../render/DocSvg'
import { getState, replaceDoc, setState, toast } from '../store'
import { fitView, insertStructureText } from './actions'
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
}

/** Desktop-App: Pfad des geöffneten bzw. zuletzt gespeicherten Dokuments („Speichern“ schreibt ohne Dialog dorthin) */
let filePath: string | null = null
export const currentFilePath = () => filePath

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
  // im SVG-Kontext rendern (sonst hält React <linearGradient> usw. für HTML), äußeres <svg> wieder entfernen
  const inner = renderToStaticMarkup(createElement('svg', null, createElement(DocContent, { scene, exportMode: true })))
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '')
  const bg = opts.background ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${opts.background}"/>` : ''
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">${bg}${inner}</svg>`
  return { svg, w, h }
}

function baseName() {
  return getState().fileName.replace(/\s+/g, '_') || 'struktur'
}

export function exportSvg(onlySelection = false) {
  const r = exportSvgString(getState().doc, { onlySelection })
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

function crc32(bytes: Uint8Array): number {
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
  const r = exportSvgString(getState().doc, { onlySelection, background: transparent ? undefined : '#ffffff' })
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

/** Kopiert die Auswahl (oder alles) als PNG – direkt in Word, PowerPoint, Keynote … einfügbar */
export async function copyImageToClipboard(silent = false) {
  const { sel } = getState()
  const only = selectionSize(sel) > 0
  try {
    // Promise im ClipboardItem: funktioniert auch in Safari innerhalb der Nutzeraktion. Transparenter Hintergrund
    // (passt auf farbige Folien); weiß gefüllte Objekte der Zeichnung bleiben weiß
    const png = renderPng(only, 4, true).then((b) => {
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
  let p = saveAs ? null : filePath
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
  filePath = p
  setState({ dirty: false, fileName: stripExt(p.split(/[\\/]/).pop() ?? base) })
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

export async function newDocument() {
  const { doc } = getState()
  if (!(await confirmDiscard())) return
  filePath = null
  replaceDoc({ ...emptyDoc(), style: { ...doc.style } }, 'Unbenannt')
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
    if (!(await confirmDiscard())) return
    replaceDoc(normalizeDoc(d), name)
    filePath = path ?? null
    setTimeout(() => fitView(1.5), 0)
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
    if (!(await confirmDiscard())) return
    replaceDoc(r.doc, name)
    // kein OpenMol-Dokument: „Speichern“ fragt nach einem Namen (die CDXML-Datei wird nicht überschrieben)
    filePath = null
    setState({ dirty: true })
    setTimeout(() => fitView(1.5), 0)
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
