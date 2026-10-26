import { useSettings } from '../settings'
import { withGroups, withoutLocked } from '../model/groups'
import { memo, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { bestBondAngle, buildGraph, textWidth, type Graph } from '../model/chem'
import { SYMBOL_SET } from '../model/elements'
import { canonicalAbbrev } from '../model/abbrev'
import {
  add,
  angleOf,
  dist,
  dot,
  fromAngle,
  mid,
  norm,
  perp,
  quadPoint,
  distToQuad,
  snapAngle,
  sub,
  type Pt,
} from '../model/geom'
import { hitTest, hoverToSel, mergeSel, selectInRegion, selHas } from '../model/hit'
import { oclToFragment, parseStructure } from '../model/ocl'
import {
  addAtom,
  addBond,
  atomNear,
  chainPoints,
  deleteItems,
  extractClip,
  mergeOverlaps,
  pasteClip,
  planRing,
  planShapedRing,
  placeRing,
  ringShape,
  type RingKind,
  rotateSelection,
  selectionAtomIds,
  sproutBond,
  translateSelection,
  type ClipData,
  linearizeTriples,
  remember2D,
} from '../model/ops'
import {
  anchorPoint,
  arrowNearForText,
  arrowPoints,
  arrowSideAt,
  arrowTextBlock,
  arrowTextOpts,
  curvedGeom,
  getScene,
  sceneBBox,
  textBox,
  type Scene,
} from '../model/scene'
import { ATTACH } from '../ui/Toolbar'
import { TEMPLATE_GROUPS } from '../model/templates'
import { applyRingFill, perceiveRings, removeRingFill, ringAt, ringSystem } from '../model/rings'
import { rememberFill } from '../ui/recentFills'
import type { Anchor, Atom, Bond, BondType, Cycle, CycleArcLabel, Doc, DoublePos, Id, PageLayout, Selection, TextObj } from '../model/types'
import { pageDims, sheetBox } from '../model/pages'
import { emptySelection, selectionSize, uid } from '../model/types'
import { NEED_3D_SELECTION, addPage, completeSel, insertFragmentAt, insertUserTemplateAt } from '../tools/actions'
import { findUserTemplate } from '../model/userlib'
import {
  beginTx,
  cancelTx,
  commit,
  endTx,
  getState,
  liveUpdate,
  setState,
  setTool,
  toast,
  useStore,
  type Hover,
  registerEditFlush,
  type View,
} from '../store'
import { trackPointer } from '../tools/keyboard'
import { arcLabelPos, attachCycle, branchFromPoint, branchGeom, branchLabelPos, cubicDist, eAngle, eDist, eNormal, ePoint, linkGeom, linkLabelPos, newArcLabel, newBranch, newBranchPair, newCycle, stationHalfGaps, stationLabelSize } from '../model/cycle'
import { center3, rotate3, type V3 } from '../model/three'
import { collectRefs, gridSnapMove, layoutOrigin, snapMove, snapPoint, UNITS_PER_MM, type Guide, type SnapRefs } from '../tools/snap'
import type { Box } from '../model/geom'
import { RichToolbar, richKeyDown } from '../ui/RichEditor'
import { layoutRich, parseRich, richPlain, richToEditorHtml, sanitizeRich } from '../model/richtext'
import { fontCss } from '../model/types'
import { DocContent, headPath } from './DocSvg'

const ACCENT = '#2f6bff'
const GUIDE = '#ff2d87'
/** Hilfslinien des Seitenlayouts (aus dem Lineal gezogen) */
const LAYOUT_GUIDE = '#00a2d6'
/** Breite der Lineale in Pixeln */
const RULER = 18

/** Hilfslinie setzen: neue anhängen bzw. vorhandene verschieben (für liveUpdate – läuft immer auf dem Ausgangsstand) */
function putGuide(d: Doc, axis: 'x' | 'y', index: number, isNew: boolean, v: number | null) {
  const a = (d.style.aids ??= {})
  const arr = axis === 'x' ? (a.guidesX ??= []) : (a.guidesY ??= [])
  if (v === null) {
    if (!isNew) arr.splice(index, 1)
  } else if (isNew) arr.push(v)
  else arr[index] = v
  if (!arr.length) delete a[axis === 'x' ? 'guidesX' : 'guidesY']
}

interface MoveSnap {
  box: Box
  refs: SnapRefs
  keys: Pt[]
  keysOnly: boolean
}

/** Startet das Verschieben; Einrasten nur, wenn ganze Moleküle (bzw. Objekte) bewegt werden */
function moveDrag(doc: Doc, sel: Selection, p: Pt, dup: boolean): Drag {
  const scene = getScene(doc)
  const atoms = selectionAtomIds(doc, sel)
  let whole = true
  for (const id of atoms) for (const nb of scene.g.adj.get(id) ?? []) if (!atoms.has(nb.other.id)) whole = false
  let snap: MoveSnap | null = null
  if (whole) {
    const box = sceneBBox(scene, { atoms, bonds: new Set(sel.bonds), arrows: new Set(sel.arrows), curved: new Set(sel.curved), texts: new Set(sel.texts), shapes: new Set(sel.shapes), cycles: new Set(sel.cycles ?? []), tables: new Set(sel.tables ?? []) })
    // Pfeilenden als zusätzliche Fangpunkte (bei reinen Pfeilen: nur diese, nicht der Textrahmen)
    const keys = sel.arrows.flatMap((id) => {
      const pts = arrowPoints(doc.arrows[id])
      return [pts[0], pts[pts.length - 1]]
    })
    const keysOnly = keys.length > 0 && atoms.size === 0 && !sel.texts.length && !sel.shapes.length
    if (box) snap = { box, refs: collectRefs(scene, dup ? emptySelection() : sel), keys, keysOnly }
  }
  return { mode: 'move', start: p, moved: false, sel, dup: dup ? extractClip(doc, sel) : null, snap, last: { x: 0, y: 0 } }
}

type Drag =
  | { mode: 'pan'; sx: number; sy: number; px: number; py: number }
  | { mode: 'move'; start: Pt; moved: boolean; sel: Selection; dup: ClipData | null; dupSel?: Selection; snap: MoveSnap | null; last: Pt; narrow?: Selection }
  | { mode: 'rect'; start: Pt; additive: boolean }
  /** Hilfslinie ziehen (aus dem Lineal neu bzw. eine vorhandene); zurück aufs Lineal = löschen */
  | { mode: 'guide'; axis: 'x' | 'y'; index: number; isNew: boolean }
  | { mode: 'lasso'; pts: Pt[]; additive: boolean }
  | { mode: 'rotate'; center: Pt; start: Pt; sel: Selection; bases: number[] }
  | { mode: 'bond'; start: Pt; down: Pt; from: Id | null; onBond: Id | null; fromText: Id | null }
  | { mode: 'chain'; start: Pt; down: Pt; from: Id | null }
  | { mode: 'arrow'; start: Pt; end?: Pt }
  | { mode: 'curved'; from: Anchor; start: Pt }
  | { mode: 'curved-bend'; id: Id }
  | { mode: 'curved-end'; id: Id; end: 'from' | 'to' }
  | { mode: 'arrow-end'; id: Id; end: 1 | 2; refs: SnapRefs }
  | { mode: 'shape'; start: Pt }
  | { mode: 'shape-corner'; id: Id; corner: 1 | 2; w0: number; h0: number }
  | { mode: 'cyc-box'; id: Id; fixed: Pt; rx0: number; ry0: number; off: Pt }
  | { mode: 'erase'; hits: Hover[] }
  | { mode: 'click'; start: Pt; h: Hover }
  | { mode: 'decor'; atom: Id; which: 'charge' | 'partial' | 'stereo' | 'lp' | 'rad'; index: number; grab: Pt }
  | { mode: 'cycle-draw'; start: Pt; draw: boolean; h: Hover }
  | { mode: 'cyc-from'; id: Id; angle: number; start: Pt; h: Hover }
  | { mode: 'cyc-lm' | 'cyc-le'; id: Id; lid: Id }
  | { mode: 'cyc-al'; id: Id; lid: Id }
  | { mode: 'cyc-r'; id: Id; start: Pt; rx0: number; ry0: number }
  | { mode: 'cyc-st'; id: Id; index: number }
  | { mode: 'cyc-gap'; id: Id; index: number; side: 'lo' | 'hi' }
  | { mode: 'cyc-bm' | 'cyc-be'; id: Id; bid: Id }
  | { mode: 'rot3d'; start: Pt; ids: Id[]; base: Map<Id, V3>; center: V3; moved: boolean }

type Preview =
  | { kind: 'lines'; segs: [Pt, Pt][]; label?: { p: Pt; text: string } }
  | { kind: 'rect'; a: Pt; b: Pt }
  | { kind: 'lasso'; pts: Pt[] }
  | { kind: 'curve'; p0: Pt; c: Pt; p1: Pt }
  | { kind: 'arrow'; a: Pt; b: Pt }
  | { kind: 'circle'; c: Pt; r: number }
  | { kind: 'cubic'; p0: Pt; c1: Pt; c2: Pt; p1: Pt; head: boolean }
  | null

interface Handle {
  kind: 'rotate' | 'curved-bend' | 'curved-from' | 'curved-to' | 'arrow-1' | 'arrow-2' | 'shape-1' | 'shape-2' | 'cyc-box' | 'cyc-r' | 'cyc-st' | 'cyc-gap' | 'cyc-bm' | 'cyc-be' | 'cyc-lm' | 'cyc-le' | 'cyc-al'
  id: Id
  p: Pt
  /** Zyklus: Stationsindex bzw. Seitenpfeil-ID */
  part?: string
}

const Content = memo(function Content({ scene }: { scene: Scene }) {
  return <DocContent scene={scene} />
})

function anchorFromHover(h: Hover): Anchor | null {
  if (!h) return null
  if (h.kind === 'atom') return { type: 'atom', id: h.id }
  if (h.kind === 'bond') return { type: 'bond', id: h.id }
  if (h.kind === 'lp') return { type: 'lp', id: h.id, index: h.index }
  return null
}

function sameAnchor(a: Anchor, b: Anchor) {
  if (a.type !== b.type) return false
  if (a.type === 'point' || b.type === 'point') return false
  return a.id === (b as { id: Id }).id
}

/** Klick mit Bindungswerkzeug auf eine vorhandene Bindung */
function modifyBond(b: Bond, type: BondType) {
  if (type === 'single') {
    if (b.type === 'single') b.type = 'double'
    else if (b.type === 'double') b.type = 'triple'
    else b.type = 'single'
    return
  }
  if (type === 'double' && b.type === 'double') {
    const order: DoublePos[] = ['auto', 'center', 'left', 'right']
    b.doublePos = order[(order.indexOf(b.doublePos) + 1) % order.length]
    return
  }
  if ((type === 'wedge' || type === 'hash') && b.type === type) {
    const t = b.a1
    b.a1 = b.a2
    b.a2 = t
    return
  }
  b.type = type
}

const GROUP_NOT_ELEMENT = new Set(['Pr', 'Ac'])

// Cyclopentadien: CH2 oben (Ecke 0), Doppelbindungen an den Kanten 1–2 und 3–4
const CP_PATTERN = [false, true, false, true, false]

/** Ring für das Ring-Werkzeug: regelmäßig (3–8, Benzol), Cyclopentadien oder Sessel */
function ringPlanFor(doc: Doc, g: Graph, o: { ringKind: RingKind; ringSize: number }, target: Parameters<typeof planRing>[3], cursor?: Pt) {
  const shape = ringShape(o.ringKind)
  if (shape) return planShapedRing(doc, g, shape, target, cursor)
  return planRing(doc, g, o.ringKind === 'cp' ? 5 : o.ringSize, target, cursor)
}

export function applyAtomText(d: Doc, id: Id, raw: string) {
  const a = d.atoms[id]
  if (!a) return
  const v = raw.trim()
  if (!v) {
    a.element = 'C'
    a.label = undefined
    a.literal = undefined
    return
  }
  a.literal = undefined
  const cap = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()
  // „Pr“ und „Ac“ sind beim Tippen Propyl und Acetyl (wie in ChemDraw); Praseodym/Actinium über das Periodensystem
  if (GROUP_NOT_ELEMENT.has(cap) && (v === cap || v === v.toLowerCase())) {
    a.label = cap
    a.element = 'C'
    a.literal = true
    a.showC = undefined
    return
  }
  // Element mit Ladung: Na+, Cl−, Fe3+, Cu2+, O2− (auch Fe+3)
  const withCharge = /^([A-Za-z]{1,2})(\d?)([+\-−])(\d?)$/.exec(v)
  // Symbol wie getippt (CO2− bleibt die Gruppe, nicht Cobalt); ganz klein geschrieben wird großgeschrieben (na+ → Na+)
  const chRaw = withCharge?.[1] ?? ''
  const chEl = SYMBOL_SET.has(chRaw) ? chRaw : chRaw === chRaw.toLowerCase() ? chRaw.charAt(0).toUpperCase() + chRaw.slice(1) : ''
  // Isotop vor dem Symbol: 13C, 2H, 18O, 15N
  const iso = /^(\d{1,3})([A-Z][a-z]?)$/.exec(v)
  if (SYMBOL_SET.has(v) || (SYMBOL_SET.has(cap) && v.length <= 2 && v === v.toLowerCase())) {
    a.element = SYMBOL_SET.has(v) ? v : cap
    a.label = undefined
  } else if (withCharge && SYMBOL_SET.has(chEl) && !(withCharge[2] && withCharge[4])) {
    a.element = chEl
    a.label = undefined
    a.charge = (withCharge[3] === '+' ? 1 : -1) * Number(withCharge[2] || withCharge[4] || 1)
  } else if (iso && SYMBOL_SET.has(iso[2]) && Number(iso[1]) > 0) {
    a.element = iso[2]
    a.label = undefined
    a.isotope = Number(iso[1])
  } else {
    // selbst eingetippt: genau so anzeigen (auch chemisch „falsche“ Formeln wie H3C an einem CH2)
    a.label = v
    a.element = 'C'
    a.literal = true
    a.showC = undefined
  }
}

// ---------- Text als Atom: ein freier Text, an den eine Bindung andockt, wird zum Atom („C“, „CH3“, „OMe“) ----------

/** Beschriftung, die ein freier Text als Atom bekäme – nur kurze, einzeilige Texte ohne Leerzeichen, die mit einem
 *  Buchstaben beginnen; sonst null (normale Texte wie „Schritt 1“ bleiben Texte) */
export function textAsAtomLabel(t: TextObj | undefined): string | null {
  if (!t) return null
  const plain = richPlain(t.text).trim()
  if (!plain || plain.length > 12 || /\s/.test(plain) || !/^[A-Za-z(]/.test(plain) || !/^[A-Za-z0-9()+\-−·']+$/.test(plain)) return null
  // nur chemisch sinnvolle Beschriftungen – „Hallo“, „pH“ oder „x“ bleiben Texte
  const core = plain.replace(/[+\-−]+\d*$|\d*[+\-−]+$/, '')
  if (SYMBOL_SET.has(core)) return plain // Element (auch mit Ladung: Na+, O−)
  if (canonicalAbbrev(core) || /^(R|X|Y|Z|Ar|Nu|E|Hal|Ln|M)\d*'*$/.test(core)) return plain // Kürzel und Platzhalter
  // Formel aus echten Elementsymbolen und Kürzeln (CH3, NO2, CO2Me, (CH2)3, H3C, NMe2)
  const toks = core.match(/Me|Et|Pr|Bu|Ph|Bn|Ac|[A-Z][a-z]?|\d+|[()·]/g)
  if (!toks || toks.join('') !== core) return null
  const groups = new Set(['Me', 'Et', 'Pr', 'Bu', 'Ph', 'Bn', 'Ac'])
  return toks.every((k) => /^\d+$/.test(k) || '()·'.includes(k) || SYMBOL_SET.has(k) || groups.has(k)) ? plain : null
}

/** Lage des Atoms für einen Text: Mitte des ersten Zeichens (dort sitzt bei „CH3“ das C) */
export function textAtomPos(doc: Doc, t: TextObj): Pt {
  const b = textBox(t, doc)
  const first = richPlain(t.text).trim().charAt(0)
  const w = textWidth(first, t.size, !!t.bold, false, fontCss(t.font ?? doc.style.font))
  return { x: b.x1 + w / 2, y: t.y }
}

/** Text in ein Atom umwandeln (der Text verschwindet); Rückgabe: Atom-Id oder null */
export function textToAtom(d: Doc, textId: Id): Id | null {
  const t = d.texts[textId]
  const label = textAsAtomLabel(t)
  if (!t || !label) return null
  const p = textAtomPos(d, t)
  const a = addAtom(d, p.x, p.y)
  applyAtomText(d, a.id, label)
  // ein bewusst geschriebenes „C“ bleibt sichtbar
  if (a.element === 'C' && !a.label) a.showC = true
  if (t.color) a.color = t.color
  delete d.texts[textId]
  return a.id
}

/** umwandelbarer Text an einem Punkt */
function textAtPoint(doc: Doc, p: Pt, pad: number): Id | null {
  for (const t of Object.values(doc.texts)) {
    if (!textAsAtomLabel(t)) continue
    const b = textBox(t, doc)
    if (p.x >= b.x1 - pad && p.x <= b.x2 + pad && p.y >= b.y1 - pad && p.y <= b.y2 + pad) return t.id
  }
  return null
}

export function Canvas() {
  useSettings() // Dezimaltrennzeichen (Ansatztabellen) geändert → neu zeichnen
  const doc = useStore((s) => s.doc)
  const sel = useStore((s) => s.sel)
  const tool = useStore((s) => s.tool)
  const opts = useStore((s) => s.opts)
  const view = useStore((s) => s.view)
  const hover = useStore((s) => s.hover)
  const hotspot = useStore((s) => s.hotspot)
  const editing = useStore((s) => s.editing)
  const scene = getScene(doc)
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)
  const spaceDown = useRef(false)
  const lastClick = useRef<{ t: number; p: Pt } | null>(null)
  const [preview, setPreview] = useState<Preview>(null)
  const [cursor, setCursor] = useState<Pt | null>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [eraseHits, setEraseHits] = useState<Hover[]>([])
  const [guides, setGuides] = useState<Guide[]>([])

  const L = doc.style.bondLength
  const fs = doc.style.fontSize
  const z = view.zoom
  const page = doc.style.page

  // Anfangsansicht: Ursprung in die Mitte
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    const { view: v, doc: d } = getState()
    if (v.panX === 0 && v.panY === 0) {
      const box = sceneBBox(getScene(d))
      if (box) {
        setState({ view: { zoom: 1, panX: el.clientWidth / 2 - (box.x1 + box.x2) / 2, panY: el.clientHeight / 2 - (box.y1 + box.y2) / 2 } })
      } else setState({ view: { zoom: 1, panX: el.clientWidth / 2, panY: el.clientHeight / 2 } })
    }
    return () => ro.disconnect()
  }, [])

  // Leertaste = Hand-Werkzeug
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        spaceDown.current = true
        wrapRef.current?.classList.add('panning')
        e.preventDefault()
      }
    }
    const ku = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDown.current = false
        wrapRef.current?.classList.remove('panning')
      }
    }
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => {
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
    }
  }, [])

  // Zoom mit Strg/⌘ + Mausrad bzw. Pinch, sonst verschieben
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // Auswahllisten und Felder der Text-Werkzeugleiste (Schriftart, Schriftgröße) scrollen selbst
      if (e.target instanceof Element && e.target.closest('select, [role="listbox"], input, textarea')) return
      e.preventDefault()
      const { view: v } = getState()
      const rect = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top
        const nz = Math.min(8, Math.max(0.04, v.zoom * Math.exp(-e.deltaY * 0.01)))
        const dx = (sx - v.panX) / v.zoom
        const dy = (sy - v.panY) / v.zoom
        setState({ view: { zoom: nz, panX: sx - dx * nz, panY: sy - dy * nz } })
      } else {
        setState({ view: { ...v, panX: v.panX - e.deltaX, panY: v.panY - e.deltaY } })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const toDoc = (e: { clientX: number; clientY: number }): Pt => {
    const rect = svgRef.current!.getBoundingClientRect()
    const v = getState().view
    return { x: (e.clientX - rect.left - v.panX) / v.zoom, y: (e.clientY - rect.top - v.panY) / v.zoom }
  }
  const tol = Math.max(9 / z, fs * 0.4)
  const hit = (p: Pt, extra: { lp?: boolean; only?: ('atom' | 'bond' | 'objects')[] } = {}) => {
    const st = getState()
    const h = hitTest(getScene(st.doc), p, { tol, lonePairs: extra.lp, only: extra.only })
    // gesperrte Objekte: mit Auswahl, Lasso und Radierer nicht zu treffen (zum Entsperren: Rechtsklick ▸ Alle entsperren)
    if (h && st.doc.locked && (st.tool === 'select' || st.tool === 'lasso' || st.tool === 'eraser')) {
      const hs = hoverToSel(h)
      if (selectionSize(withoutLocked(st.doc, hs)) < selectionSize(hs)) return null
    }
    return h
  }

  /** vorhandene Hilfslinie unter dem Mauszeiger (5 px Toleranz) */
  const guideNear = (p: Pt): { axis: 'x' | 'y'; index: number } | null => {
    const a = getState().doc.style.aids
    const zz = getState().view.zoom
    const ix = (a?.guidesX ?? []).findIndex((x) => Math.abs(x - p.x) * zz < 5)
    if (ix >= 0) return { axis: 'x', index: ix }
    const iy = (a?.guidesY ?? []).findIndex((y) => Math.abs(y - p.y) * zz < 5)
    return iy >= 0 ? { axis: 'y', index: iy } : null
  }

  // ---------- Griffe für ausgewählte Objekte ----------
  const selBox = useMemo(() => {
    if (!selectionSize(sel)) return null
    const atomIds = selectionAtomIds(doc, sel)
    return sceneBBox(scene, {
      atoms: atomIds,
      bonds: new Set(sel.bonds),
      arrows: new Set(sel.arrows),
      curved: new Set(sel.curved),
      texts: new Set(sel.texts),
      shapes: new Set(sel.shapes), cycles: new Set(sel.cycles ?? []), tables: new Set(sel.tables ?? []),
    })
  }, [doc, sel, scene])

  const handles: Handle[] = useMemo(() => {
    if (tool !== 'select' && tool !== 'lasso') return []
    const hs: Handle[] = []
    if (selBox && (selectionAtomIds(doc, sel).size > 1 || sel.arrows.length || sel.texts.length || (sel.cycles ?? []).length)) {
      hs.push({ kind: 'rotate', id: '', p: { x: (selBox.x1 + selBox.x2) / 2, y: selBox.y1 - 26 / z } })
    }
    for (const id of sel.curved) {
      const c = doc.curved[id]
      const cg = c && curvedGeom(scene, c)
      if (!cg) continue
      hs.push({ kind: 'curved-bend', id, p: quadPoint(cg.p0, cg.c, cg.p1, 0.5) })
      hs.push({ kind: 'curved-from', id, p: cg.p0 })
      hs.push({ kind: 'curved-to', id, p: cg.p1 })
    }
    for (const id of sel.arrows) {
      const a = doc.arrows[id]
      if (!a) continue
      hs.push({ kind: 'arrow-1', id, p: { x: a.x1, y: a.y1 } })
      hs.push({ kind: 'arrow-2', id, p: { x: a.x2, y: a.y2 } })
    }
    for (const id of sel.shapes) {
      const s = doc.shapes[id]
      if (!s) continue
      hs.push({ kind: 'shape-1', id, p: { x: s.x1, y: s.y1 } })
      hs.push({ kind: 'shape-2', id, p: { x: s.x2, y: s.y2 } })
    }
    for (const id of sel.cycles ?? []) {
      const c = doc.cycles[id]
      if (!c) continue
      // Griffe leicht nach außen versetzt, damit sie Beschriftungen nicht verdecken
      const outside = (deg: number, off: number) => {
        const q = ePoint(c, deg)
        const n = eNormal(c, deg)
        return { x: q.x + n.x * off, y: q.y + n.y * off }
      }
      hs.push({ kind: 'cyc-r', id, p: outside(-45, 14 / z) })
      // Eckgriffe des umgebenden Rechtecks: Größe wie bei Formen ziehen (⇧ = Seitenverhältnis behalten)
      const pad = 8 / z
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
        hs.push({ kind: 'cyc-box', id, p: { x: c.cx + sx * (c.rx + pad), y: c.cy + sy * (c.ry + pad) }, part: `${sx},${sy}` })
      c.stations.forEach((st, i) => {
        hs.push({ kind: 'cyc-st', id, p: outside(st.angle, (st.label ? fs * 0.95 : 0) + 10 / z), part: String(i) })
        // Lückenenden: Ziehen verändert die Breite der Lücke (Platz für Moleküle)
        const g = stationHalfGaps(doc, c, i)
        hs.push({ kind: 'cyc-gap', id, p: ePoint(c, st.angle - g.lo), part: i + ':lo' })
        hs.push({ kind: 'cyc-gap', id, p: ePoint(c, st.angle + g.hi), part: i + ':hi' })
      })
      for (const b of c.branches) {
        const g = branchGeom(c, b)
        hs.push({ kind: 'cyc-bm', id, p: g.m, part: b.id })
        hs.push({ kind: 'cyc-be', id, p: g.e, part: b.id })
      }
      for (const al of c.arcLabels ?? []) {
        // Griff an der dem Bogen zugewandten Kante der Schrittbezeichnung
        const b = arcLabelBox(doc, c, al)
        hs.push({ kind: 'cyc-al', id, p: { x: (b.x1 + b.x2) / 2, y: b.y1 - 4 / z }, part: al.id })
      }
      for (const l of c.links ?? []) {
        const g = linkGeom(doc, c, l)
        if (!g) continue
        hs.push({ kind: 'cyc-lm', id, p: g.p0, part: l.id })
        hs.push({ kind: 'cyc-le', id, p: g.p3, part: l.id })
      }
    }
    return hs
  }, [tool, selBox, sel, doc, scene, z, fs])

  // ---------- Pointer ----------

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return
    const st = getState()
    if (st.editing) {
      ;(document.activeElement as HTMLElement | null)?.blur()
    }
    svgRef.current?.setPointerCapture(e.pointerId)
    if (e.button === 1 || spaceDown.current || st.tool === 'pan') {
      drag.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, px: st.view.panX, py: st.view.panY }
      return
    }
    const p = toDoc(e)
    const t = st.tool
    // Lineal: Hilfslinie herausziehen (oben → waagerecht, links → senkrecht)
    {
      const rect = svgRef.current!.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      if (st.doc.style.aids?.rulers && (sx < RULER) !== (sy < RULER)) {
        const axis = sy < RULER ? 'y' : 'x'
        const index = (axis === 'x' ? st.doc.style.aids.guidesX : st.doc.style.aids.guidesY)?.length ?? 0
        beginTx()
        liveUpdate((d) => putGuide(d, axis, index, true, axis === 'x' ? p.x : p.y))
        drag.current = { mode: 'guide', axis, index, isNew: true }
        return
      }
    }

    if (t === 'select' || t === 'lasso') {
      // Griffe zuerst
      for (const hd of handles) {
        if (dist(hd.p, p) * z < 9) {
          beginTx()
          if (hd.kind === 'rotate') {
            const c = selBox ? mid({ x: selBox.x1, y: selBox.y1 }, { x: selBox.x2, y: selBox.y2 }) : p
            const cs = completeSel(st.doc, st.sel)
            // Richtungen der Bindungen und geraden Pfeile der Auswahl – daran rastet die Drehung ein
            const bases = [
              ...cs.bonds.map((id) => st.doc.bonds[id]).filter(Boolean).map((b) => angleOf(sub(st.doc.atoms[b.a2], st.doc.atoms[b.a1]))),
              ...cs.arrows.map((id) => st.doc.arrows[id]).filter((a) => a && (a.route ?? 'straight') === 'straight').map((a) => Math.atan2(a.y2 - a.y1, a.x2 - a.x1)),
            ]
            drag.current = { mode: 'rotate', center: c, start: p, sel: cs, bases }
          } else if (hd.kind === 'curved-bend') drag.current = { mode: 'curved-bend', id: hd.id }
          else if (hd.kind === 'curved-from') drag.current = { mode: 'curved-end', id: hd.id, end: 'from' }
          else if (hd.kind === 'curved-to') drag.current = { mode: 'curved-end', id: hd.id, end: 'to' }
          else if (hd.kind === 'arrow-1' || hd.kind === 'arrow-2')
            drag.current = { mode: 'arrow-end', id: hd.id, end: hd.kind === 'arrow-1' ? 1 : 2, refs: collectRefs(getScene(st.doc), { ...emptySelection(), arrows: [hd.id] }) }
          else if (hd.kind === 'cyc-r') {
            const c = st.doc.cycles[hd.id]
            drag.current = { mode: 'cyc-r', id: hd.id, start: p, rx0: c.rx, ry0: c.ry }
          } else if (hd.kind === 'cyc-st') drag.current = { mode: 'cyc-st', id: hd.id, index: Number(hd.part) }
          else if (hd.kind === 'cyc-gap') {
            const [idx, side] = hd.part!.split(':')
            drag.current = { mode: 'cyc-gap', id: hd.id, index: Number(idx), side: side === 'lo' ? 'lo' : 'hi' }
          }
          else if (hd.kind === 'cyc-bm' || hd.kind === 'cyc-be') drag.current = { mode: hd.kind, id: hd.id, bid: hd.part! }
          else if (hd.kind === 'cyc-lm' || hd.kind === 'cyc-le') drag.current = { mode: hd.kind, id: hd.id, lid: hd.part! }
          else if (hd.kind === 'cyc-al') drag.current = { mode: 'cyc-al', id: hd.id, lid: hd.part! }
          else if (hd.kind === 'cyc-box') {
            const c = st.doc.cycles[hd.id]
            const [sx, sy] = hd.part!.split(',').map(Number)
            // die gegenüberliegende Ecke bleibt stehen
            // Versatz zwischen Mauspunkt und echter Ecke (Griff sitzt etwas außerhalb) – kein Sprung beim Anfassen
            const off = { x: p.x - (c.cx + sx * c.rx), y: p.y - (c.cy + sy * c.ry) }
            drag.current = { mode: 'cyc-box', id: hd.id, fixed: { x: c.cx - sx * c.rx, y: c.cy - sy * c.ry }, rx0: c.rx, ry0: c.ry, off }
          } else {
            const sh = st.doc.shapes[hd.id]
            drag.current = { mode: 'shape-corner', id: hd.id, corner: hd.kind === 'shape-1' ? 1 : 2, w0: Math.abs(sh.x2 - sh.x1), h0: Math.abs(sh.y2 - sh.y1) }
          }
          return
        }
      }
      // Ladungen / Partialladungen frei verschieben (Alt+Klick = automatische Position)
      const dh = decorHit(getScene(st.doc), p, Math.max(fs * 0.34, 8 / z))
      if (dh) {
        if (e.altKey) {
          commit((doc) => {
            const a = doc.atoms[dh.atom]
            if (dh.which === 'charge') a.chargeOff = undefined
            else if (dh.which === 'stereo') a.stereoOff = undefined
            else if (dh.which === 'lp' || dh.which === 'rad') {
              const arr = dh.which === 'lp' ? a.lpOff : a.radOff
              if (arr) arr[dh.index] = null
            } else a.partialOff = undefined
          })
          return
        }
        beginTx()
        drag.current = { mode: 'decor', atom: dh.atom, which: dh.which, index: dh.index, grab: sub(dh.pos, p) }
        return
      }
      const h = hit(p)
      if (h) {
        let ns = st.sel
        // Gruppen werden immer als Ganzes gewählt
        const picked = withGroups(st.doc, completeSel(st.doc, hoverToSel(h)))
        if (e.shiftKey) {
          ns = mergeSel(st.sel, picked, selHas(st.sel, h))
        } else if (!selHas(st.sel, h)) {
          // Klick wählt genau das getroffene Atom bzw. die Bindung; ein ganzes Molekül markiert der Doppelklick
          ns = picked
        }
        setState({ sel: ns })
        beginTx()
        drag.current = moveDrag(st.doc, completeSel(st.doc, ns), p, e.altKey)
        // Klick (ohne Ziehen) auf ein Atom/eine Bindung einer größeren Auswahl: danach nur dieses markieren
        const one = picked
        if (!e.shiftKey && (h.kind === 'atom' || h.kind === 'bond') && selectionSize(ns) > selectionSize(one) && drag.current.mode === 'move') drag.current.narrow = one
      } else if (guideNear(p)) {
        const g = guideNear(p)!
        beginTx()
        drag.current = { mode: 'guide', axis: g.axis, index: g.index, isNew: false }
      } else if (selBox && selectionSize(st.sel) > 1 && !e.shiftKey && p.x >= selBox.x1 && p.x <= selBox.x2 && p.y >= selBox.y1 && p.y <= selBox.y2) {
        // Ziehen innerhalb des Auswahlrahmens verschiebt die Auswahl
        beginTx()
        drag.current = moveDrag(st.doc, completeSel(st.doc, st.sel), p, e.altKey)
      } else {
        if (!e.shiftKey) setState({ sel: emptySelection() })
        drag.current = t === 'lasso' ? { mode: 'lasso', pts: [p], additive: e.shiftKey } : { mode: 'rect', start: p, additive: e.shiftKey }
      }
      return
    }
    const h = hit(p, { lp: t === 'curved' })
    if (t === 'rotate3d') {
      // Drehen im Raum: nur die Markierung (Molekül oder Molekülteil), nie das ganze Dokument
      const ids = [...selectionAtomIds(st.doc, st.sel)]
      if (!ids.length) {
        toast(NEED_3D_SELECTION)
        return
      }
      const base = new Map<Id, V3>(ids.map((id) => [id, [st.doc.atoms[id].x, st.doc.atoms[id].y, st.doc.atoms[id].z ?? 0]]))
      beginTx()
      drag.current = { mode: 'rot3d', start: p, ids, base, center: center3(st.doc, ids), moved: false }
      return
    }
    switch (t) {
      case 'eraser':
        drag.current = { mode: 'erase', hits: h ? [h] : [] }
        setEraseHits(h ? [h] : [])
        return
      case 'bond': {
        // auf einem kurzen Text („C“, „CH3“) begonnen: der Text wird beim Loslassen zum Atom
        const fromText = h?.kind === 'text' && textAsAtomLabel(st.doc.texts[h.id]) ? h.id : null
        drag.current = {
          mode: 'bond',
          start: h?.kind === 'atom' ? { x: st.doc.atoms[h.id].x, y: st.doc.atoms[h.id].y } : fromText ? textAtomPos(st.doc, st.doc.texts[fromText]) : p,
          down: p,
          from: h?.kind === 'atom' ? h.id : null,
          onBond: h?.kind === 'bond' ? h.id : null,
          fromText,
        }
        return
      }
      case 'chain':
        drag.current = {
          mode: 'chain',
          start: h?.kind === 'atom' ? { x: st.doc.atoms[h.id].x, y: st.doc.atoms[h.id].y } : p,
          down: p,
          from: h?.kind === 'atom' ? h.id : null,
        }
        return
      case 'arrow': {
        // Pfeilanfang auf die Mittelhöhe eines nahen Moleküls einrasten
        let start = p
        if (st.opts.snap && !(e.metaKey || e.ctrlKey)) {
          const refs = collectRefs(getScene(st.doc), emptySelection())
          let best: number | null = null
          for (const r of refs.h) if (r.center && Math.abs(r.y - p.y) <= 8 / z && (best === null || Math.abs(r.y - p.y) < Math.abs(best - p.y))) best = r.y
          if (best !== null) start = { x: p.x, y: best }
        }
        drag.current = { mode: 'arrow', start }
        return
      }
      case 'curved':
        drag.current = { mode: 'curved', from: anchorFromHover(h) ?? { type: 'point', x: p.x, y: p.y }, start: p }
        return
      case 'shape':
        drag.current = { mode: 'shape', start: p }
        return
      case 'cycle': {
        if (e.altKey) {
          drag.current = { mode: 'click', start: p, h }
          return
        }
        // Jeder Modus macht genau eine Sache (vorhersehbar):
        // Zeichnen = neuer Zyklus (überall, auch auf/in einem anderen) · Zufluss = von außen auf die Linie ziehen
        // Abfluss = von der Linie weg ziehen · Station/Durchlauf/2. Zyklus = Klick auf die Linie
        const mode = st.opts.cycleMode
        if (mode === 'draw') {
          drag.current = { mode: 'cycle-draw', start: p, draw: true, h }
          return
        }
        const near = cycleNear(st.doc, p, tol * 1.4)
        if (mode === 'out' && near) {
          drag.current = { mode: 'cyc-from', id: near, angle: eAngle(st.doc.cycles[near], p), start: p, h }
          return
        }
        if (mode === 'in' && !near) {
          drag.current = { mode: 'cycle-draw', start: p, draw: false, h }
          return
        }
        drag.current = { mode: 'click', start: p, h }
        return
      }
      default:
        drag.current = { mode: 'click', start: p, h }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    const st = getState()
    if (d?.mode === 'pan') {
      setState({ view: { ...st.view, panX: d.px + e.clientX - d.sx, panY: d.py + e.clientY - d.sy } })
      return
    }
    const p = toDoc(e)
    trackPointer(p)
    if (!d) {
      let h = hit(p, { lp: st.tool === 'curved' })
      if (st.tool === 'select' || st.tool === 'lasso') {
        const dh = decorHit(getScene(st.doc), p, Math.max(fs * 0.34, 8 / z))
        if (dh) h = { kind: 'decor', id: dh.atom, which: dh.which, index: dh.index }
      }
      if (JSON.stringify(h) !== JSON.stringify(st.hover)) setState({ hover: h })
      if (st.tool === 'ring' || st.tool === 'template' || st.tool === 'ringfill') setCursor(p)
      // Mauszeiger über Hilfslinien bzw. Linealen: zeigt, dass man ziehen kann
      if (svgRef.current) {
        const rect = svgRef.current.getBoundingClientRect()
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top
        const onRuler = !!st.doc.style.aids?.rulers && (sx < RULER) !== (sy < RULER)
        const g = !h && (st.tool === 'select' || st.tool === 'lasso') ? guideNear(p) : null
        const c = onRuler ? (sy < RULER ? 'row-resize' : 'col-resize') : g ? (g.axis === 'x' ? 'col-resize' : 'row-resize') : ''
        if (svgRef.current.style.cursor !== c) svgRef.current.style.cursor = c
      }
      return
    }
    switch (d.mode) {
      case 'guide': {
        // am Raster einrasten, falls eingeschaltet
        const aids = st.doc.style.aids
        let v = d.axis === 'x' ? p.x : p.y
        const g = (aids?.grid ?? 0) * UNITS_PER_MM
        if (aids?.gridSnap && g > 0 && !(e.metaKey || e.ctrlKey)) {
          const o = layoutOrigin(st.doc)[d.axis]
          v = o + Math.round((v - o) / g) * g
        }
        liveUpdate((doc) => putGuide(doc, d.axis, d.index, d.isNew, v))
        return
      }
      case 'move': {
        let dx = p.x - d.start.x
        let dy = p.y - d.start.y
        if (!d.moved && Math.hypot(dx, dy) * z < 3) return
        d.moved = true
        // Magnetische Hilfslinien (⌘/Strg gedrückt halten = aus)
        let shown: Guide[] = []
        if (d.snap && st.opts.snap && !(e.metaKey || e.ctrlKey)) {
          const r = snapMove(d.snap.box, dx, dy, d.snap.refs, 7 / z, d.snap.keys, d.snap.keysOnly)
          dx = r.dx
          dy = r.dy
          shown = r.guides
        }
        // Raster (Dokument-Stil): wo keine andere Hilfslinie greift
        if (d.snap && st.doc.style.aids?.gridSnap && !(e.metaKey || e.ctrlKey)) ({ dx, dy } = gridSnapMove(st.doc, d.snap.box, dx, dy, shown))
        setGuides(shown)
        d.last = { x: dx, y: dy }
        if (d.dup) {
          const clip = d.dup
          liveUpdate((doc) => {
            d.dupSel = pasteClip(doc, clip, dx, dy)
          })
        } else liveUpdate((doc) => translateSelection(doc, d.sel, dx, dy))
        return
      }
      case 'rot3d': {
        const ddx = (p.x - d.start.x) * z
        const ddy = (p.y - d.start.y) * z
        if (!d.moved && Math.hypot(ddx, ddy) < 3) return
        d.moved = true
        // waagerecht ziehen = um senkrechte Achse, senkrecht ziehen = um waagerechte Achse; Umschalt = in der Ebene
        const ay = e.shiftKey ? 0 : ddx * 0.01
        const ax = e.shiftKey ? 0 : -ddy * 0.01
        const az = e.shiftKey ? Math.atan2(p.y - d.center[1], p.x - d.center[0]) - Math.atan2(d.start.y - d.center[1], d.start.x - d.center[0]) : 0
        liveUpdate((doc) => {
          remember2D(doc, d.ids)
          for (const id of d.ids) {
            const [x, y, zz] = rotate3(d.base.get(id)!, d.center, ax, ay, az)
            const a = doc.atoms[id]
            a.x = x
            a.y = y
            a.z = zz
          }
        })
        setPreview({ kind: 'lines', segs: [], label: { p: { x: d.center[0], y: d.center[1] }, text: `${Math.round((ay * 180) / Math.PI)}° / ${Math.round((ax * 180) / Math.PI)}°` } })
        return
      }
      case 'decor': {
        liveUpdate((doc) => {
          const a = doc.atoms[d.atom]
          const off = { x: p.x + d.grab.x - a.x, y: p.y + d.grab.y - a.y }
          if (d.which === 'charge') a.chargeOff = off
          else if (d.which === 'stereo') a.stereoOff = off
          else if (d.which === 'lp' || d.which === 'rad') {
            // jedes Elektronenpaar / jeder Radikalpunkt einzeln; Abstand mindestens knapp außerhalb des Atoms
            const l = Math.hypot(off.x, off.y)
            const minR = doc.style.fontSize * 0.35
            const o2 = l < minR ? { x: (off.x / (l || 1)) * minR, y: (off.y / (l || 1)) * minR } : off
            const key = d.which === 'lp' ? 'lpOff' : 'radOff'
            const arr = [...(a[key] ?? [])]
            arr[d.index] = o2
            a[key] = arr
          } else a.partialOff = off
        })
        return
      }
      case 'rect':
        setPreview({ kind: 'rect', a: d.start, b: p })
        return
      case 'lasso':
        d.pts.push(p)
        setPreview({ kind: 'lasso', pts: [...d.pts] })
        return
      case 'rotate': {
        let a = angleOf(sub(p, d.center)) - angleOf(sub(d.start, d.center))
        let snapped = ''
        if (e.shiftKey) a = snapAngle(a, 15)
        else if (st.opts.snap && !(e.metaKey || e.ctrlKey)) {
          // magnetisch: rastet ein, sobald eine Bindung bzw. ein Pfeil waagerecht oder senkrecht steht (±4°)
          let best: { delta: number; horiz: boolean } | null = null
          for (const th of d.bases) {
            const t = th + a
            const k = Math.round(t / (Math.PI / 2))
            const delta = (k * Math.PI) / 2 - t
            if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, horiz: k % 2 === 0 }
          }
          if (best && Math.abs(best.delta) < (4 * Math.PI) / 180) {
            a += best.delta
            snapped = best.horiz ? ' · waagerecht' : ' · senkrecht'
          }
        }
        liveUpdate((doc) => rotateSelection(doc, d.sel, d.center, a))
        setPreview({ kind: 'lines', segs: [], label: { p: add(d.center, { x: 0, y: 0 }), text: `${Math.round((a * 180) / Math.PI)}°${snapped}` } })
        return
      }
      case 'bond': {
        if (dist(p, d.down) * z < 5 || dist(p, d.start) < L * 0.3) {
          setPreview(null)
          return
        }
        const end = bondEnd(st.doc, d.start, d.from, p, e.shiftKey)
        setPreview({ kind: 'lines', segs: [[d.start, end]] })
        return
      }
      case 'chain': {
        if (dist(p, d.start) < L * 0.5) {
          setPreview(null)
          return
        }
        const pts = chainPoints(d.start, p, L, chainSide(st.doc, d.from, d.start, p))
        const segs: [Pt, Pt][] = []
        for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]])
        setPreview({ kind: 'lines', segs, label: { p: add(pts[pts.length - 1], { x: 10 / z, y: -14 / z }), text: String(pts.length - 1) } })
        return
      }
      case 'arrow': {
        const route = st.opts.arrowRoute
        let end = route === 'straight' ? arrowEnd(d.start, p, e.shiftKey) : p
        if (st.opts.snap && !(e.metaKey || e.ctrlKey)) {
          const horiz = route === 'straight' && Math.abs(end.y - d.start.y) < 0.5
          const r = snapPoint(end, collectRefs(getScene(st.doc), emptySelection()), 7 / z, horiz ? 'x' : 'xy')
          end = r.p
          setGuides(r.guides)
        }
        d.end = end
        if (route === 'straight') setPreview({ kind: 'arrow', a: d.start, b: end })
        else {
          const pts = arrowPoints({ id: '_', kind: 'reaction', x1: d.start.x, y1: d.start.y, x2: end.x, y2: end.y, above: '', below: '', route })
          const segs: [Pt, Pt][] = []
          for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]])
          setPreview({ kind: 'lines', segs })
        }
        return
      }
      case 'curved': {
        const h = hit(p, { lp: true })
        const toA = anchorFromHover(h) ?? { type: 'point' as const, x: p.x, y: p.y }
        const sc = getScene(st.doc)
        const ca = { id: '_', head: st.opts.curvedHead, from: d.from, to: toA, bend: defaultBend(sc, d.from, toA) }
        const cg = curvedGeom(sc, ca)
        if (cg && dist(cg.p0, cg.p1) > 4) setPreview({ kind: 'curve', p0: cg.p0, c: cg.c, p1: cg.p1 })
        if (JSON.stringify(h) !== JSON.stringify(st.hover)) setState({ hover: h })
        return
      }
      case 'curved-bend': {
        liveUpdate((doc) => {
          const c = doc.curved[d.id]
          const sc = getScene(doc)
          const s = anchorPoint(sc, c.from)
          const t = anchorPoint(sc, c.to)
          if (!s || !t) return
          const ln = Math.max(1, dist(s, t))
          const n = perp(norm(sub(t, s)))
          c.bend = Math.max(-1.5, Math.min(1.5, (2 * dot(sub(p, mid(s, t)), n)) / ln))
        })
        return
      }
      case 'curved-end': {
        const h = hit(p, { lp: true })
        const an = anchorFromHover(h) ?? { type: 'point' as const, x: p.x, y: p.y }
        liveUpdate((doc) => {
          doc.curved[d.id][d.end] = an
        })
        return
      }
      case 'arrow-end': {
        const snapOn = st.opts.snap && !(e.metaKey || e.ctrlKey)
        let gds: Guide[] = []
        liveUpdate((doc) => {
          const a = doc.arrows[d.id]
          const other = d.end === 1 ? { x: a.x2, y: a.y2 } : { x: a.x1, y: a.y1 }
          const routed = (a.route ?? 'straight') !== 'straight'
          let q = e.shiftKey || routed ? p : arrowEnd(other, p, false)
          if (snapOn) {
            // Spitze/Anfang an anderen Pfeilenden und Molekülmitten einrasten; gerade waagerechte Pfeile bleiben waagerecht
            const horiz = !routed && Math.abs(q.y - other.y) < 0.5
            const vert = !routed && Math.abs(q.x - other.x) < 0.5
            const r = snapPoint(q, d.refs, 7 / z, horiz ? 'x' : vert ? 'y' : 'xy')
            q = r.p
            gds = r.guides
          }
          if (d.end === 1) {
            a.x1 = q.x
            a.y1 = q.y
          } else {
            a.x2 = q.x
            a.y2 = q.y
          }
        })
        setGuides(gds)
        return
      }
      case 'shape':
        setPreview({ kind: 'rect', a: d.start, b: shapeEnd(st.opts.shapeKind, d.start, p, e.shiftKey) })
        return
      case 'cycle-draw': {
        const g = !d.draw && dist(d.start, p) * z > 8 ? cycleGesture(st.doc, d.start, p, tol, null) : null
        if (g) setPreview(g.preview)
        else if (d.draw) setPreview({ kind: 'circle', c: d.start, r: dist(d.start, p) })
        else setPreview(null)
        const hv: Hover = g?.target ? { kind: 'cycle', id: g.target } : null
        if (JSON.stringify(hv) !== JSON.stringify(st.hover)) setState({ hover: hv })
        return
      }
      case 'cyc-from': {
        const g = dist(d.start, p) * z > 5 ? cycleGesture(st.doc, d.start, p, tol, { id: d.id, angle: d.angle }) : null
        setPreview(g?.preview ?? null)
        const hv: Hover = g?.target ? { kind: 'cycle', id: g.target } : null
        if (JSON.stringify(hv) !== JSON.stringify(st.hover)) setState({ hover: hv })
        return
      }
      case 'cyc-al': {
        // Schrittbezeichnung entlang des Bogens schieben; innen/außen je nach Seite des Zeigers
        liveUpdate((doc) => {
          const c = doc.cycles[d.id]
          const al = c.arcLabels?.find((x) => x.id === d.lid)
          if (!al) return
          al.angle = eAngle(c, p)
          al.side = Math.hypot((p.x - c.cx) / c.rx, (p.y - c.cy) / c.ry) >= 1 ? 'out' : 'in'
        })
        return
      }
      case 'cyc-lm':
      case 'cyc-le': {
        liveUpdate((doc) => {
          const c = doc.cycles[d.id]
          const l = c.links?.find((x) => x.id === d.lid)
          if (!l) return
          if (d.mode === 'cyc-lm') {
            l.angle = eAngle(c, p)
            return
          }
          // Ende auf einen anderen Zyklus ziehen = neues Ziel
          const tg = cycleNear(doc, p, tol * 3, d.id) ?? l.target
          l.target = tg
          l.tAngle = eAngle(doc.cycles[tg], p)
        })
        return
      }
      case 'cyc-r': {
        liveUpdate((doc) => {
          const c = doc.cycles[d.id]
          if (e.altKey) {
            // Alt: Ellipse – Breite und Höhe getrennt
            c.rx = Math.max(20, d.rx0 * (Math.abs(p.x - c.cx) / Math.max(1, Math.abs(d.start.x - c.cx))))
            c.ry = Math.max(20, d.ry0 * (Math.abs(p.y - c.cy) / Math.max(1, Math.abs(d.start.y - c.cy))))
          } else {
            const k = dist(p, { x: c.cx, y: c.cy }) / Math.max(1, dist(d.start, { x: c.cx, y: c.cy }))
            c.rx = Math.max(20, d.rx0 * k)
            c.ry = Math.max(20, d.ry0 * k)
          }
        })
        return
      }
      case 'cyc-st': {
        liveUpdate((doc) => {
          const c = doc.cycles[d.id]
          let a = eAngle(c, p)
          if (!e.shiftKey) {
            // auf 5° runden, 0/90/180/270 magnetisch
            a = Math.round(a / 5) * 5
            for (const q of [0, 90, 180, 270, 360]) if (Math.abs(a - q) <= 5) a = q % 360
          }
          c.stations[d.index].angle = a
        })
        return
      }
      case 'cyc-gap': {
        liveUpdate((doc) => {
          const c = doc.cycles[d.id]
          const st = c.stations[d.index]
          // nur die gezogene Seite ändern – die andere Seite behält ihre aktuelle Breite
          const cur = stationHalfGaps(doc, c, d.index)
          const diff = Math.abs(((eAngle(c, p) - st.angle + 540) % 360) - 180)
          const v = Math.max(1, Math.min(85, Math.round(diff)))
          if (d.side === 'lo') {
            st.gapLo = v
            st.gapHi = cur.hi
          } else {
            st.gapHi = v
            st.gapLo = cur.lo
          }
        })
        return
      }
      case 'cyc-bm':
      case 'cyc-be': {
        liveUpdate((doc) => {
          const c = doc.cycles[d.id]
          const b = c.branches.find((x) => x.id === d.bid)
          if (!b) return
          if (d.mode === 'cyc-bm') {
            b.angle = eAngle(c, p)
            return
          }
          Object.assign(b, branchFromPoint(c, b.angle, b.type, p))
        })
        return
      }
      case 'shape-corner':
        liveUpdate((doc) => {
          const s = doc.shapes[d.id]
          let q = p
          if (e.shiftKey && d.w0 > 0 && d.h0 > 0) {
            // ⇧: Seitenverhältnis behalten (gegenüberliegende Ecke bleibt stehen)
            const fixed = d.corner === 1 ? { x: s.x2, y: s.y2 } : { x: s.x1, y: s.y1 }
            const dx = p.x - fixed.x
            const dy = p.y - fixed.y
            const k = Math.max(Math.abs(dx) / d.w0, Math.abs(dy) / d.h0)
            q = { x: fixed.x + Math.sign(dx || 1) * d.w0 * k, y: fixed.y + Math.sign(dy || 1) * d.h0 * k }
          }
          if (d.corner === 1) {
            s.x1 = q.x
            s.y1 = q.y
          } else {
            s.x2 = q.x
            s.y2 = q.y
          }
        })
        return
      case 'cyc-box':
        liveUpdate((doc) => {
          const c = doc.cycles[d.id]
          const q = { x: p.x - d.off.x, y: p.y - d.off.y }
          let w = Math.abs(q.x - d.fixed.x) / 2
          let h = Math.abs(q.y - d.fixed.y) / 2
          if (e.shiftKey) {
            // ⇧: Seitenverhältnis behalten
            const k = Math.max(w / d.rx0, h / d.ry0)
            w = d.rx0 * k
            h = d.ry0 * k
          }
          c.rx = Math.max(20, w)
          c.ry = Math.max(20, h)
          c.cx = d.fixed.x + Math.sign(q.x - d.fixed.x || 1) * c.rx
          c.cy = d.fixed.y + Math.sign(q.y - d.fixed.y || 1) * c.ry
        })
        return
      case 'erase': {
        const h = hit(p)
        if (h && !d.hits.some((x) => JSON.stringify(x) === JSON.stringify(h))) {
          d.hits.push(h)
          setEraseHits([...d.hits])
        }
        return
      }
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    setPreview(null)
    if (!d) return
    const st = getState()
    const p = toDoc(e)
    switch (d.mode) {
      case 'pan':
        return
      case 'guide': {
        // zurück aufs Lineal bzw. aus der Zeichenfläche gezogen = löschen
        const rect = svgRef.current!.getBoundingClientRect()
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top
        const out = sx < 0 || sy < 0 || sx > rect.width || sy > rect.height || (d.axis === 'x' ? sx < RULER : sy < RULER)
        if (out && d.isNew) cancelTx()
        else {
          if (out) liveUpdate((doc) => putGuide(doc, d.axis, d.index, false, null))
          endTx()
        }
        return
      }
      case 'move': {
        if (!d.moved) {
          endTx()
          if (d.narrow) setState({ sel: d.narrow })
          return
        }
        setGuides([])
        const dx = d.last.x
        const dy = d.last.y
        if (d.dup) {
          const clip = d.dup
          liveUpdate((doc) => {
            d.dupSel = pasteClip(doc, clip, dx, dy)
          })
          endTx(d.dupSel)
          return
        }
        const moved = [...selectionAtomIds(st.doc, d.sel)]
        liveUpdate((doc) => {
          translateSelection(doc, d.sel, dx, dy)
          mergeOverlaps(doc, moved, L * 0.2)
          // ein einzelner kurzer Text, auf einem Atom abgelegt, wird dessen Beschriftung („CH3“ an ein Kettenende)
          if (d.sel.texts.length === 1 && !moved.length && selectionSize(d.sel) === 1) {
            const t = doc.texts[d.sel.texts[0]]
            const label = textAsAtomLabel(t)
            if (t && label) {
              const at = atomNear(doc, textAtomPos(doc, t), L * 0.45)
              if (at) {
                applyAtomText(doc, at.id, label)
                delete doc.texts[t.id]
              }
            }
          }
        })
        endTx()
        return
      }
      case 'rect':
      case 'lasso': {
        const region =
          d.mode === 'rect'
            ? { box: { x1: Math.min(d.start.x, p.x), y1: Math.min(d.start.y, p.y), x2: Math.max(d.start.x, p.x), y2: Math.max(d.start.y, p.y) } }
            : { poly: d.pts }
        if (d.mode === 'rect' && dist(d.start, p) * z < 3) return
        const s = withGroups(st.doc, withoutLocked(st.doc, selectInRegion(getScene(st.doc), region)))
        setState({ sel: d.additive ? mergeSel(st.sel, s) : s })
        return
      }
      case 'cyc-box':
      case 'cyc-r':
      case 'cyc-st':
      case 'cyc-gap':
      case 'cyc-bm':
      case 'cyc-be':
      case 'cyc-lm':
      case 'cyc-le':
      case 'cyc-al':
      case 'rot3d':
      case 'decor':
      case 'rotate':
      case 'curved-bend':
      case 'curved-end':
      case 'arrow-end':
      case 'shape-corner':
        setGuides([])
        endTx()
        return
      case 'bond': {
        const type = st.opts.bondType
        const isClick = dist(p, d.down) * z < 5 || dist(p, d.start) < L * 0.3
        if (isClick) {
          if (d.onBond) {
            commit((doc) => {
              const b = doc.bonds[d.onBond!]
              modifyBond(b, type)
              linearizeTriples(doc, [b.a1, b.a2])
            })
          } else if (d.from) {
            commit((doc) => {
              sproutBond(doc, d.from!, type)
            })
          } else if (d.fromText) {
            commit((doc) => {
              const id = textToAtom(doc, d.fromText!)
              if (id) sproutBond(doc, id, type)
            })
          } else {
            commit((doc) => {
              const a = addAtom(doc, p.x, p.y)
              sproutBond(doc, a.id, type, -Math.PI / 6)
            })
          }
          return
        }
        const end = bondEnd(st.doc, d.start, d.from, p, e.shiftKey)
        // Ende auf einem kurzen Text: dieser wird zum Atom (Bindung endet dort)
        const toText = textAtPoint(st.doc, p, L * 0.15)
        commit((doc) => {
          const a1 = d.from ?? (d.fromText ? textToAtom(doc, d.fromText) : null) ?? (atomNear(doc, d.start, L * 0.2)?.id || addAtom(doc, d.start.x, d.start.y).id)
          const ex = atomNear(doc, end, L * 0.2, new Set([a1])) ?? (toText && toText !== d.fromText ? (() => {
            const id = textToAtom(doc, toText)
            return id ? doc.atoms[id] : null
          })() : null)
          const a2 = ex?.id ?? addAtom(doc, end.x, end.y).id
          const b = addBond(doc, a1, a2, type)
          if (b && ex) b.type = type
          linearizeTriples(doc, [a1, a2])
        })
        return
      }
      case 'chain': {
        if (dist(p, d.start) < L * 0.5) {
          if (d.from) commit((doc) => void sproutBond(doc, d.from!, 'single'))
          return
        }
        const pts = chainPoints(d.start, p, L, chainSide(st.doc, d.from, d.start, p))
        commit((doc) => {
          let prev = d.from ?? (atomNear(doc, pts[0], L * 0.2)?.id || addAtom(doc, pts[0].x, pts[0].y).id)
          for (let i = 1; i < pts.length; i++) {
            const ex = atomNear(doc, pts[i], L * 0.2, new Set([prev]))
            const id = ex?.id ?? addAtom(doc, pts[i].x, pts[i].y).id
            addBond(doc, prev, id, 'single')
            prev = id
          }
        })
        return
      }
      case 'arrow': {
        setGuides([])
        let end = d.end ?? (st.opts.arrowRoute === 'straight' ? arrowEnd(d.start, p, e.shiftKey) : p)
        if (dist(d.start, p) * z < 6) end = st.opts.arrowRoute === 'straight' ? { x: d.start.x + L * 3, y: d.start.y } : { x: d.start.x + L * 3, y: d.start.y + L * 2 }
        const id = uid('r')
        commit((doc) => {
          doc.arrows[id] = { id, kind: st.opts.arrowKind, x1: d.start.x, y1: d.start.y, x2: end.x, y2: end.y, above: '', below: '' }
          if (st.opts.arrowRoute !== 'straight') doc.arrows[id].route = st.opts.arrowRoute
          if (st.opts.arrowHeads !== 'end') doc.arrows[id].heads = st.opts.arrowHeads
        })
        setState({ sel: { ...emptySelection(), arrows: [id] } })
        return
      }
      case 'curved': {
        const h = hit(p, { lp: true })
        const toA = anchorFromHover(h) ?? { type: 'point' as const, x: p.x, y: p.y }
        if (sameAnchor(d.from, toA)) return
        const sc = getScene(st.doc)
        const s = anchorPoint(sc, d.from)
        const t = anchorPoint(sc, toA)
        if (!s || !t || dist(s, t) * z < 8) return
        const id = uid('c')
        commit((doc) => {
          doc.curved[id] = { id, head: st.opts.curvedHead, from: d.from, to: toA, bend: defaultBend(sc, d.from, toA) }
        })
        setState({ sel: { ...emptySelection(), curved: [id] }, hover: null })
        return
      }
      case 'cyc-from': {
        setState({ hover: null })
        if (dist(d.start, p) * z <= 5) {
          handleClick(d.start, d.h, e)
          return
        }
        const g = cycleGesture(st.doc, d.start, p, tol, { id: d.id, angle: d.angle })
        if (!g) return
        commit(g.apply)
        setState({ sel: { ...emptySelection(), cycles: [d.id] } })
        return
      }
      case 'cycle-draw': {
        setState({ hover: null })
        const g = !d.draw && dist(d.start, p) * z > 8 ? cycleGesture(st.doc, d.start, p, tol, null) : null
        if (g) {
          commit(g.apply)
          setState({ sel: { ...emptySelection(), cycles: [g.target!] } })
          return
        }
        if (!d.draw) {
          if (dist(d.start, p) * z <= 5) handleClick(d.start, d.h, e)
          return
        }
        // Klick (ohne Ziehen) auf einen vorhandenen Zyklus wählt ihn aus, statt einen neuen anzulegen
        if (dist(d.start, p) * z < 10) {
          const hit = cycleNear(st.doc, d.start, tol * 1.4)
          if (hit) {
            setState({ sel: { ...emptySelection(), cycles: [hit] } })
            return
          }
        }
        const r = dist(d.start, p) * z < 10 ? L * 3.2 : Math.max(L, dist(d.start, p))
        const c = newCycle(d.start.x, d.start.y, r, st.opts.cycleStations, st.opts.cycleDir)
        commit((doc) => {
          doc.cycles[c.id] = c
        })
        setState({ sel: { ...emptySelection(), cycles: [c.id] } })
        return
      }
      case 'shape': {
        if (dist(d.start, p) * z < 6) return
        const id = uid('s')
        const q = shapeEnd(st.opts.shapeKind, d.start, p, e.shiftKey)
        commit((doc) => {
          doc.shapes[id] = { id, kind: st.opts.shapeKind, x1: d.start.x, y1: d.start.y, x2: q.x, y2: q.y }
        })
        setState({ sel: { ...emptySelection(), shapes: [id] } })
        return
      }
      case 'erase': {
        const hits = d.hits
        setEraseHits([])
        if (!hits.length) return
        let s = emptySelection()
        for (const h of hits) s = mergeSel(s, hoverToSel(h))
        commit((doc) => deleteItems(doc, s, { pruneOrphans: true }))
        setState({ hover: null })
        return
      }
      case 'click':
        handleClick(d.start, d.h, e)
        return
    }
  }

  const handleClick = (p: Pt, h: Hover, e: React.PointerEvent) => {
    const st = getState()
    const t = st.tool
    const o = st.opts
    switch (t) {
      case 'ring': {
        const target =
          h?.kind === 'atom' ? { type: 'atom' as const, id: h.id } : h?.kind === 'bond' ? { type: 'bond' as const, id: h.id } : { type: 'point' as const, p }
        commit((doc) => {
          const plan = ringPlanFor(doc, buildGraph(doc), o, target, p)
          placeRing(doc, plan, o.ringKind === 'regular' && o.ringAromatic && o.ringSize === 6, o.ringKind === 'cp' ? CP_PATTERN : undefined)
        })
        return
      }
      case 'template': {
        if (o.templateName.startsWith('user:')) {
          const ut = findUserTemplate(o.templateName.slice(5))
          if (ut) insertUserTemplateAt(ut.clip, p)
          return
        }
        const tpl = TEMPLATE_GROUPS.flatMap((g) => g.items).find((x) => x.name === o.templateName)
        if (!tpl) return
        const frag = tpl.build ? tpl.build(L) : oclToFragment(parseStructure(tpl.smiles!), L)
        insertFragmentAt(frag, p)
        return
      }
      case 'atom': {
        if (h?.kind === 'atom') {
          commit((doc) => {
            const a = doc.atoms[h.id]
            if (o.label === ATTACH) {
              a.attach = !a.attach
              a.label = undefined
              a.element = 'C'
            } else if (o.label) {
              a.label = o.label
              a.element = 'C'
              a.attach = undefined
              a.literal = undefined
            } else if (o.element === 'C' && a.element === 'C' && !a.label) {
              // C auf ein C-Atom: Beschriftung dieses Atoms ein-/ausblenden
              a.showC = !a.showC || undefined
            } else {
              a.element = o.element
              a.label = undefined
              a.showC = undefined
            }
          })
        } else if (!h && o.label !== ATTACH) {
          commit((doc) => {
            const a = addAtom(doc, p.x, p.y, o.label ? 'C' : o.element)
            if (o.label) a.label = o.label
          })
        }
        return
      }
      case 'charge+':
      case 'charge-':
        if (h?.kind === 'atom')
          commit((doc) => {
            doc.atoms[h.id].charge += t === 'charge+' ? 1 : -1
          })
        return
      case 'partial+':
      case 'partial-':
        if (h?.kind === 'atom')
          commit((doc) => {
            const a = doc.atoms[h.id]
            const v = t === 'partial+' ? '+' : '-'
            a.partial = a.partial === v ? undefined : v
          })
        return
      case 'radical':
        if (h?.kind === 'atom')
          commit((doc) => {
            const a = doc.atoms[h.id]
            a.radical = e.shiftKey || e.altKey ? Math.max(0, a.radical - 1) : (a.radical + 1) % 3
          })
        return
      case 'lonepair':
        if (h?.kind === 'atom')
          commit((doc) => {
            const a = doc.atoms[h.id]
            a.lonePairs = e.shiftKey || e.altKey ? Math.max(0, a.lonePairs - 1) : Math.min(4, a.lonePairs + 1)
          })
        return
      case 'text': {
        if (h?.kind === 'text') {
          setState({ editing: { kind: 'text', id: h.id } })
        } else if (h?.kind === 'atom') {
          setState({ editing: { kind: 'atom', id: h.id } })
        } else if (h?.kind === 'arrow' || arrowNearForText(st.doc, p)) {
          // Klick an einen Pfeil = Pfeil beschriften (statt freiem Textfeld)
          const near = h?.kind === 'arrow' ? { id: h.id, which: arrowSideAt(st.doc.arrows[h.id], p) } : arrowNearForText(st.doc, p)!
          setState({ sel: { ...emptySelection(), arrows: [near.id] }, editing: { kind: 'arrow', id: near.id, which: near.which } })
        } else {
          const id = uid('t')
          commit((doc) => {
            doc.texts[id] = { id, x: p.x, y: p.y, text: '', size: Math.round(fs * 0.8) }
          })
          setState({ editing: { kind: 'text', id, fresh: true } })
        }
        return
      }
      case 'cycle': {
        const id = cycleNear(st.doc, p, tol * 1.6)
        if (!id) return
        const c = st.doc.cycles[id]
        const ang = eAngle(c, p)
        if (e.altKey) {
          // Alt+Klick: nächstgelegene Station bzw. Seitenpfeil entfernen
          commit((doc) => {
            const cc = doc.cycles[id]
            const bi = cc.branches.findIndex((b) => {
              const g = branchGeom(cc, b)
              return distToQuad(p, g.from, g.q, g.to) < tol * 1.6
            })
            if (bi >= 0) {
              cc.branches.splice(bi, 1)
              return
            }
            let best = -1
            let bd = 40
            cc.stations.forEach((s2, i) => {
              const dd = Math.abs(((s2.angle - ang + 540) % 360) - 180)
              if (dd < bd) {
                bd = dd
                best = i
              }
            })
            if (best >= 0) cc.stations.splice(best, 1)
          })
          return
        }
        if (o.cycleMode === 'station')
          commit((doc) => {
            doc.cycles[id].stations.push({ angle: Math.round(ang / 5) * 5 })
          })
        else if (o.cycleMode === 'in' || o.cycleMode === 'out') {
          const mode = o.cycleMode
          commit((doc) => {
            doc.cycles[id].branches.push(newBranch(ang, mode, (c.rx + c.ry) / 2))
          })
        } else if (o.cycleMode === 'pair') {
          commit((doc) => {
            doc.cycles[id].branches.push(...newBranchPair(ang, (c.rx + c.ry) / 2))
          })
        } else if (o.cycleMode === 'second') {
          const nc = attachCycle(c, ang)
          commit((doc) => {
            doc.cycles[nc.id] = nc
          })
          setState({ sel: { ...emptySelection(), cycles: [nc.id] } })
          return
        }
        setState({ sel: { ...emptySelection(), cycles: [id] } })
        return
      }
      case 'ringfill': {
        const rings = perceiveRings(st.doc, buildGraph(st.doc))
        const ring = ringAt(st.doc, rings, p)
        if (!ring) return
        // eigener Doppelklick-Test (das native dblclick-Ereignis geht verloren, wenn sich das Ziel-Element ändert)
        const now = performance.now()
        const dbl = lastClick.current && now - lastClick.current.t < 400 && dist(lastClick.current.p, p) * z < 6
        lastClick.current = dbl ? null : { t: now, p }
        // ⇧+Klick oder Doppelklick: immer ganzes System mit einem Verlauf
        const scope = e.shiftKey || dbl ? 'system' : o.fillScope
        const target = scope === 'ring' ? [ring] : ringSystem(rings, ring)
        if (o.fillErase) {
          commit((doc) => removeRingFill(doc, target))
          return
        }
        const style = { ...o.fill, mode: 'fill' as const }
        commit((doc) => {
          if (scope === 'system') applyRingFill(doc, target, style, false)
          else if (scope === 'each') for (const r of target) applyRingFill(doc, [r], style, false, false)
          else applyRingFill(doc, [ring], style, true, false)
        })
        rememberFill(style)
        return
      }
      case 'plus': {
        const id = uid('t')
        const size = Math.round(fs * 1.3)
        commit((doc) => {
          doc.texts[id] = { id, x: p.x - size * 0.29, y: p.y, text: '+', size }
        })
        return
      }
    }
  }

  // Rechtsklick: Objekt unter dem Zeiger auswählen (falls nicht schon Teil der Auswahl; Atom/Bindung = ganzes
  // Molekül), dann das Kontextmenü öffnen. Auf leerer Fläche: Auswahl aufheben, Menü für das Dokument.
  const onContextMenu = (e: React.MouseEvent) => {
    // in Textfeldern (Pfeiltext, Text, Beschriftung) das normale Menü des Browsers lassen (Einfügen, Rechtschreibung …)
    const tg = e.target as HTMLElement
    if (tg.closest?.('[contenteditable="true"], input, textarea, .rich-toolbar')) return
    e.preventDefault()
    const st = getState()
    if (st.editing) return
    const p = toDoc(e)
    const h = hit(p)
    // wie beim Klick nur das getroffene Objekt; Menüpunkte für ganze Moleküle (Name, Analyse …) erweitern dann selbst
    const pick = !!h && !selHas(st.sel, h) && (h.kind === 'atom' || h.kind === 'bond' || h.kind === 'lp')
    if (h && !selHas(st.sel, h)) setState({ sel: withGroups(st.doc, completeSel(st.doc, hoverToSel(h))) })
    else if (!h) setState({ sel: emptySelection() })
    if (st.tool !== 'select' && st.tool !== 'lasso') setTool('select')
    setState({ contextMenu: { x: e.clientX, y: e.clientY, at: p, pick }, hover: null })
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const st = getState()
    if (st.tool !== 'select' && st.tool !== 'lasso' && st.tool !== 'cycle') return
    const p = toDoc(e)
    const cyc = cycleLabelAt(st.doc, p, Math.max(tol * 1.8, fs))
    if (cyc) {
      setState({ sel: { ...emptySelection(), cycles: [cyc.id] }, editing: { kind: cyc.kind, id: cyc.id, part: cyc.part } })
      return
    }
    // Doppelklick auf einen Bogen: Schrittbezeichnung (z. B. „oxidative Addition“) anlegen
    const onCycle = cycleNear(st.doc, p, tol * 1.4)
    if (onCycle) {
      const al = newArcLabel(eAngle(st.doc.cycles[onCycle], p), 'in')
      commit((d) => {
        const c = d.cycles[onCycle]
        c.arcLabels = [...(c.arcLabels ?? []), al]
      })
      setState({ sel: { ...emptySelection(), cycles: [onCycle] }, editing: { kind: 'arc', id: onCycle, part: al.id, fresh: true } })
      return
    }
    const h = hit(p)
    if (!h || h.kind === 'arrow') {
      // Doppelklick auf/neben die Pfeilbeschriftung → diese Seite bearbeiten
      const near = h?.kind === 'arrow' ? { id: h.id, which: arrowSideAt(st.doc.arrows[h.id], p) } : arrowNearForText(st.doc, p)
      if (near) setState({ sel: { ...emptySelection(), arrows: [near.id] }, editing: { kind: 'arrow', id: near.id, which: near.which } })
      return
    }
    // Doppelklick auf Atom/Bindung markiert das ganze Molekül (beschriften: Enter oder Text-Werkzeug)
    if (h.kind === 'atom' || h.kind === 'lp' || h.kind === 'decor') setState({ sel: withGroups(st.doc, fragmentSel(st.doc, h.id)) })
    else if (h.kind === 'text') setState({ editing: { kind: 'text', id: h.id } })
    else if (h.kind === 'table') setState({ sel: { ...emptySelection(), tables: [h.id] }, tableEditor: h.id })
    else if (h.kind === 'bond') {
      setState({ sel: withGroups(st.doc, fragmentSel(st.doc, st.doc.bonds[h.id].a1)) })
    }
  }

  const onPointerLeave = () => {
    trackPointer(null)
    if (!drag.current) {
      setState({ hover: null })
      setCursor(null)
    }
  }

  useEffect(() => {
    // Abbruch eines laufenden Ziehvorgangs mit Esc
    const kd = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drag.current) {
        cancelTx()
        drag.current = null
        setPreview(null)
      }
    }
    window.addEventListener('keydown', kd)
    return () => window.removeEventListener('keydown', kd)
  }, [])

  // ---------- Overlays ----------
  const overlay: ReactElement[] = []
  const sw = 1 / z
  const hiAtom = (id: Id, color: string, op: number, key: string) => {
    const a = doc.atoms[id]
    if (!a) return
    const dd = scene.decor.get(id)
    if (dd?.label) {
      const l = dd.label
      overlay.push(
        <rect
          key={key}
          x={a.x + l.left - 3}
          y={a.y + l.top - 2}
          width={l.right - l.left + 6}
          height={l.bottom - l.top + 4}
          rx={5}
          fill={color}
          fillOpacity={op}
        />,
      )
    } else overlay.push(<circle key={key} cx={a.x} cy={a.y} r={Math.max(fs * 0.38, 7 / z)} fill={color} fillOpacity={op} />)
  }
  const hiBond = (id: Id, color: string, op: number, key: string) => {
    const b = doc.bonds[id]
    if (!b) return
    const a1 = doc.atoms[b.a1]
    const a2 = doc.atoms[b.a2]
    overlay.push(
      <line key={key} x1={a1.x} y1={a1.y} x2={a2.x} y2={a2.y} stroke={color} strokeOpacity={op} strokeWidth={Math.max(L * 0.32, 8 / z)} strokeLinecap="round" />,
    )
  }
  const hiBox = (b: { x1: number; y1: number; x2: number; y2: number }, color: string, key: string, dashed = true) =>
    overlay.push(
      <rect
        key={key}
        x={b.x1 - 4 / z}
        y={b.y1 - 4 / z}
        width={b.x2 - b.x1 + 8 / z}
        height={b.y2 - b.y1 + 8 / z}
        rx={4 / z}
        fill={color}
        fillOpacity={0.06}
        stroke={color}
        strokeWidth={sw}
        strokeDasharray={dashed ? `${4 / z} ${3 / z}` : undefined}
      />,
    )
  const hiCurved = (id: Id, color: string, op: number, key: string) => {
    const cg = doc.curved[id] && curvedGeom(scene, doc.curved[id])
    if (!cg) return
    overlay.push(
      <path
        key={key}
        d={`M${cg.p0.x},${cg.p0.y} Q${cg.c.x},${cg.c.y} ${cg.p1.x},${cg.p1.y}`}
        fill="none"
        stroke={color}
        strokeOpacity={op}
        strokeWidth={Math.max(8 / z, 6)}
        strokeLinecap="round"
      />,
    )
  }

  // Auswahl
  for (const id of sel.bonds) hiBond(id, ACCENT, 0.22, 'sb' + id)
  for (const id of sel.atoms) hiAtom(id, ACCENT, 0.28, 'sa' + id)
  for (const id of sel.curved) hiCurved(id, ACCENT, 0.22, 'sc' + id)
  for (const id of sel.texts) if (doc.texts[id]) hiBox(textBox(doc.texts[id], doc), ACCENT, 'st' + id)
  for (const id of sel.arrows) {
    const a = doc.arrows[id]
    if (a)
      overlay.push(
        <polyline key={'sr' + id} points={arrowPoints(a).map((q) => `${q.x},${q.y}`).join(' ')} fill="none" stroke={ACCENT} strokeOpacity={0.22} strokeWidth={Math.max(10 / z, 8)} strokeLinecap="round" strokeLinejoin="round" />,
      )
  }
  for (const id of sel.shapes) {
    const s = doc.shapes[id]
    if (s) hiBox({ x1: Math.min(s.x1, s.x2), y1: Math.min(s.y1, s.y2), x2: Math.max(s.x1, s.x2), y2: Math.max(s.y1, s.y2) }, ACCENT, 'ss' + id)
  }
  const hiCycle = (id: Id, color: string, op: number, key: string) => {
    const c = doc.cycles?.[id]
    if (!c) return
    overlay.push(<ellipse key={key} cx={c.cx} cy={c.cy} rx={c.rx} ry={c.ry} fill="none" stroke={color} strokeOpacity={op} strokeWidth={Math.max(9 / z, 7)} />)
    for (const b of c.branches) {
      const g = branchGeom(c, b)
      overlay.push(<path key={key + b.id} d={`M${g.from.x},${g.from.y} Q${g.q.x},${g.q.y} ${g.to.x},${g.to.y}`} fill="none" stroke={color} strokeOpacity={op} strokeWidth={Math.max(9 / z, 7)} strokeLinecap="round" />)
    }
    for (const l of c.links ?? []) {
      const g = linkGeom(doc, c, l)
      if (g) overlay.push(<path key={key + l.id} d={`M${g.p0.x},${g.p0.y} C${g.c1.x},${g.c1.y} ${g.c2.x},${g.c2.y} ${g.p3.x},${g.p3.y}`} fill="none" stroke={color} strokeOpacity={op} strokeWidth={Math.max(9 / z, 7)} strokeLinecap="round" />)
    }
  }
  for (const id of sel.cycles ?? []) hiCycle(id, ACCENT, 0.16, 'scy' + id)
  for (const id of sel.fills ?? []) {
    for (const [i, ring] of (doc.fills[id]?.rings ?? []).entries()) {
      const pts = ring.map((a) => doc.atoms[a]).filter(Boolean)
      overlay.push(<polygon key={'sf' + id + i} points={pts.map((q) => `${q.x},${q.y}`).join(' ')} fill="none" stroke={ACCENT} strokeWidth={2 * sw} strokeDasharray={`${4 / z} ${3 / z}`} />)
    }
  }
  if (selBox && (tool === 'select' || tool === 'lasso') && selectionSize(sel) > 1) hiBox(selBox, ACCENT, 'selbox')

  // Hover
  const hoverColor = tool === 'eraser' ? '#e5484d' : ACCENT
  const showHover = hover && !preview && !editing
  if (showHover && hover) {
    if (hover.kind === 'atom') hiAtom(hover.id, hoverColor, 0.18, 'ha')
    else if (hover.kind === 'bond') hiBond(hover.id, hoverColor, 0.16, 'hb')
    else if (hover.kind === 'curved') hiCurved(hover.id, hoverColor, 0.16, 'hc')
    else if (hover.kind === 'cycle') hiCycle(hover.id, hoverColor, 0.12, 'hcy')
    else if (hover.kind === 'decor') {
      const dd = scene.decor.get(hover.id)
      const c =
        hover.which === 'charge'
          ? dd?.charge
          : hover.which === 'stereo'
            ? dd?.stereo?.c
            : hover.which === 'lp'
              ? dd?.lonePairs[hover.index ?? 0]?.c
              : hover.which === 'rad'
                ? dd?.radicals[hover.index ?? 0]?.c
                : dd?.partial
      if (c) overlay.push(<circle key="hdc" cx={c.x} cy={c.y} r={fs * 0.36} fill={hoverColor} fillOpacity={0.18} stroke={hoverColor} strokeWidth={sw} />)
    }
    else if (hover.kind === 'lp') {
      const lp = scene.decor.get(hover.id)?.lonePairs[hover.index]
      if (lp) overlay.push(<circle key="hlp" cx={lp.c.x} cy={lp.c.y} r={fs * 0.32} fill={hoverColor} fillOpacity={0.25} />)
    } else if (hover.kind === 'text' && doc.texts[hover.id]) hiBox(textBox(doc.texts[hover.id], doc), hoverColor, 'ht', false)
    else if (hover.kind === 'arrow' && doc.arrows[hover.id]) {
      const a = doc.arrows[hover.id]
      overlay.push(
        <polyline key="hr" points={arrowPoints(a).map((q) => `${q.x},${q.y}`).join(' ')} fill="none" stroke={hoverColor} strokeOpacity={0.16} strokeWidth={Math.max(10 / z, 8)} strokeLinecap="round" strokeLinejoin="round" />,
      )
    } else if (hover.kind === 'fill' && doc.fills[hover.id]) {
      for (const [i, ring] of doc.fills[hover.id].rings.entries()) {
        const pts = ring.map((id) => doc.atoms[id]).filter(Boolean)
        overlay.push(<polygon key={'hf' + i} points={pts.map((q) => `${q.x},${q.y}`).join(' ')} fill={hoverColor} fillOpacity={0.12} stroke={hoverColor} strokeWidth={sw} />)
      }
    } else if (hover.kind === 'shape' && doc.shapes[hover.id]) {
      const s = doc.shapes[hover.id]
      hiBox({ x1: Math.min(s.x1, s.x2), y1: Math.min(s.y1, s.y2), x2: Math.max(s.x1, s.x2), y2: Math.max(s.y1, s.y2) }, hoverColor, 'hs', false)
    }
  }
  // ChemDraw-Hotspot: grüner Punkt rechts oben am Atom bzw. grünes Quadrat auf der Bindung
  if (hotspot && !editing && !preview) {
    const hc = '#22a447'
    if (hotspot.kind === 'atom' && doc.atoms[hotspot.id]) {
      const a = doc.atoms[hotspot.id]
      hiAtom(hotspot.id, hc, 0.14, 'hsa')
      overlay.push(<circle key="hsd" cx={a.x + fs * 0.55} cy={a.y - fs * 0.55} r={Math.max(3 / z, fs * 0.16)} fill={hc} />)
    } else if (hotspot.kind === 'bond' && doc.bonds[hotspot.id]) {
      const b = doc.bonds[hotspot.id]
      const a1 = doc.atoms[b.a1]
      const a2 = doc.atoms[b.a2]
      const r = Math.max(3 / z, fs * 0.18)
      hiBond(hotspot.id, hc, 0.14, 'hsb')
      if (a1 && a2) overlay.push(<rect key="hsq" x={(a1.x + a2.x) / 2 - r} y={(a1.y + a2.y) / 2 - r} width={2 * r} height={2 * r} fill={hc} />)
    }
  }
  for (const [i, h] of eraseHits.entries()) {
    if (!h) continue
    if (h.kind === 'atom') hiAtom(h.id, '#e5484d', 0.3, 'e' + i)
    else if (h.kind === 'bond') hiBond(h.id, '#e5484d', 0.3, 'e' + i)
    else if (h.kind === 'curved') hiCurved(h.id, '#e5484d', 0.3, 'e' + i)
  }

  // ab hier: über der Struktur
  const below = overlay.splice(0)

  // Ring-/Vorlagen-Vorschau
  if (!preview && cursor && tool === 'ring' && !editing) {
    const target =
      hover?.kind === 'atom'
        ? { type: 'atom' as const, id: hover.id }
        : hover?.kind === 'bond'
          ? { type: 'bond' as const, id: hover.id }
          : { type: 'point' as const, p: cursor }
    const plan = ringPlanFor(doc, scene.g, opts, target, cursor)
    const segs: [Pt, Pt][] = plan.pts.map((q, i) => [q, plan.pts[(i + 1) % plan.pts.length]])
    overlay.push(
      <g key="ringprev" opacity={0.45}>
        {segs.map(([a, b], i) => (
          <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={ACCENT} strokeWidth={doc.style.lineWidth} strokeLinecap="round" />
        ))}
        {opts.ringKind === 'regular' && opts.ringAromatic && opts.ringSize === 6 && (
          <circle cx={plan.pts.reduce((s, q) => s + q.x, 0) / 6} cy={plan.pts.reduce((s, q) => s + q.y, 0) / 6} r={L * 0.55} fill="none" stroke={ACCENT} strokeWidth={doc.style.lineWidth} strokeDasharray="3 3" />
        )}
      </g>,
    )
  }
  if (!preview && cursor && tool === 'ringfill' && !editing) {
    const ring = ringAt(doc, perceiveRings(doc, scene.g), cursor)
    if (ring) {
      const pts = ring.map((id) => doc.atoms[id])
      overlay.push(
        <polygon key="rfprev" points={pts.map((q) => `${q.x},${q.y}`).join(' ')} fill={opts.fill.c1} fillOpacity={0.35} stroke={ACCENT} strokeWidth={sw} />,
      )
    }
  }
  if (!preview && cursor && tool === 'template' && opts.templateName && !hover) {
    overlay.push(<circle key="tplprev" cx={cursor.x} cy={cursor.y} r={6 / z} fill={ACCENT} fillOpacity={0.5} />)
  }

  // Vorschau beim Ziehen
  if (preview) {
    if (preview.kind === 'lines') {
      preview.segs.forEach(([a, b], i) =>
        overlay.push(<line key={'pv' + i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={ACCENT} strokeWidth={doc.style.lineWidth * 1.2} strokeLinecap="round" opacity={0.7} />),
      )
      if (preview.label)
        overlay.push(
          <text key="pvl" x={preview.label.p.x} y={preview.label.p.y} fontSize={12 / z} fill={ACCENT} fontFamily="Inter, system-ui, sans-serif" fontWeight={600}>
            {preview.label.text}
          </text>,
        )
    } else if (preview.kind === 'rect') {
      const b = { x1: Math.min(preview.a.x, preview.b.x), y1: Math.min(preview.a.y, preview.b.y), x2: Math.max(preview.a.x, preview.b.x), y2: Math.max(preview.a.y, preview.b.y) }
      overlay.push(<rect key="pvr" x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} fill={ACCENT} fillOpacity={0.07} stroke={ACCENT} strokeWidth={sw} strokeDasharray={`${4 / z} ${3 / z}`} />)
    } else if (preview.kind === 'lasso') {
      overlay.push(<polygon key="pvl" points={preview.pts.map((q) => `${q.x},${q.y}`).join(' ')} fill={ACCENT} fillOpacity={0.07} stroke={ACCENT} strokeWidth={sw} strokeDasharray={`${4 / z} ${3 / z}`} />)
    } else if (preview.kind === 'curve') {
      const dEnd = norm(sub(preview.p1, preview.c))
      overlay.push(
        <g key="pvc" opacity={0.75}>
          <path d={`M${preview.p0.x},${preview.p0.y} Q${preview.c.x},${preview.c.y} ${preview.p1.x},${preview.p1.y}`} fill="none" stroke={ACCENT} strokeWidth={doc.style.lineWidth} />
          <path d={headPath(preview.p1, dEnd, 4 * doc.style.lineWidth + 5, opts.curvedHead === 'full' ? 'full' : 'left')} fill={ACCENT} />
        </g>,
      )
    } else if (preview.kind === 'cubic') {
      const dEnd = norm(sub(preview.p1, preview.c2))
      const hl = 4.5 * doc.style.lineWidth + 5
      const end = preview.head ? { x: preview.p1.x - dEnd.x * hl * 0.7, y: preview.p1.y - dEnd.y * hl * 0.7 } : preview.p1
      overlay.push(
        <g key="pvk" opacity={0.75}>
          <path d={`M${preview.p0.x},${preview.p0.y} C${preview.c1.x},${preview.c1.y} ${preview.c2.x},${preview.c2.y} ${end.x},${end.y}`} fill="none" stroke={ACCENT} strokeWidth={doc.style.lineWidth} strokeLinecap="round" />
          {preview.head && <path d={headPath(preview.p1, dEnd, hl, 'full')} fill={ACCENT} />}
        </g>,
      )
    } else if (preview.kind === 'circle') {
      overlay.push(
        <circle key="pvcy" cx={preview.c.x} cy={preview.c.y} r={Math.max(4 / z, preview.r)} fill="none" stroke={ACCENT} strokeWidth={doc.style.lineWidth} strokeDasharray={`${6 / z} ${4 / z}`} opacity={0.8} />,
      )
    } else if (preview.kind === 'arrow') {
      const dd = norm(sub(preview.b, preview.a))
      overlay.push(
        <g key="pva" opacity={0.75}>
          <line x1={preview.a.x} y1={preview.a.y} x2={preview.b.x - dd.x * 8} y2={preview.b.y - dd.y * 8} stroke={ACCENT} strokeWidth={doc.style.lineWidth} />
          <path d={headPath(preview.b, dd, 4.5 * doc.style.lineWidth + 5, 'full')} fill={ACCENT} />
        </g>,
      )
    }
  }

  // Magnetische Hilfslinien
  guides.forEach((gd, i) => {
    const ext = 14 / z
    overlay.push(
      gd.kind === 'h' ? (
        <line key={'gd' + i} x1={gd.a - ext} y1={gd.pos} x2={gd.b + ext} y2={gd.pos} stroke={GUIDE} strokeWidth={1.2 / z} />
      ) : (
        <line key={'gd' + i} x1={gd.pos} y1={gd.a - ext} x2={gd.pos} y2={gd.b + ext} stroke={GUIDE} strokeWidth={1.2 / z} />
      ),
    )
  })

  // Griffe
  for (const [i, hd] of handles.entries()) {
    if (hd.kind === 'rotate' && selBox) {
      const top = { x: hd.p.x, y: selBox.y1 - 4 / z }
      overlay.push(<line key={'hl' + i} x1={top.x} y1={top.y} x2={hd.p.x} y2={hd.p.y} stroke={ACCENT} strokeWidth={sw} />)
      overlay.push(
        <g key={'h' + i} className="handle rotate">
          <circle cx={hd.p.x} cy={hd.p.y} r={7 / z} fill="#fff" stroke={ACCENT} strokeWidth={1.5 / z} />
          <path
            d={`M${hd.p.x - 3 / z},${hd.p.y - 1 / z} A${3.2 / z},${3.2 / z} 0 1 0 ${hd.p.x + 1 / z},${hd.p.y - 3 / z}`}
            fill="none"
            stroke={ACCENT}
            strokeWidth={1.2 / z}
          />
        </g>,
      )
    } else {
      overlay.push(
        <rect
          key={'h' + i}
          className="handle"
          x={hd.p.x - 5 / z}
          y={hd.p.y - 5 / z}
          width={10 / z}
          height={10 / z}
          rx={hd.kind === 'curved-bend' ? 5 / z : 2 / z}
          fill="#fff"
          stroke={ACCENT}
          strokeWidth={1.5 / z}
        />,
      )
    }
  }

  const cursorClass = `tool-${tool}`
  const gridSize = L * z
  // Raster aus dem Dokument-Stil (mm): bei kleinem Zoom nur jede 2./5./10. Linie zeigen
  const aids = doc.style.aids
  const origin = layoutOrigin(doc)
  const gridU = aids?.grid ? aids.grid * UNITS_PER_MM : 0
  const gridStep = gridU ? gridU * ([1, 2, 5, 10, 20, 50, 100].find((f) => gridU * f * z >= 6) ?? 100) : 0

  return (
    <div ref={wrapRef} className={`canvas-wrap ${cursorClass}`} onContextMenu={onContextMenu}>
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
      >
        <defs>
          <pattern id="grid" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse" x={view.panX % gridSize} y={view.panY % gridSize}>
            <circle cx={1} cy={1} r={0.9} fill="var(--grid-dot)" />
          </pattern>
        </defs>
        {page ? (
          // Seitenlayout: graue Fläche um die Blätter (wie ChemDraw), kein Punktraster
          <rect width="100%" height="100%" fill="var(--page-backdrop)" />
        ) : (
          <>
            {doc.style.background && <rect width="100%" height="100%" fill={doc.style.background} />}
            {!gridStep && <rect width="100%" height="100%" fill="url(#grid)" />}
          </>
        )}
        <g transform={`translate(${view.panX},${view.panY}) scale(${z})`}>
          {page && <PageSheet page={page} background={doc.style.background} zoom={z} />}
          {gridStep > 0 && (
            // Raster (Dokument-Stil): über dem Blatt, unter der Zeichnung; nur auf dem Bildschirm
            <>
              <defs>
                <pattern id="lgrid" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse" x={origin.x} y={origin.y}>
                  <path d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`} fill="none" stroke="var(--grid-line)" strokeWidth={1 / z} />
                </pattern>
              </defs>
              {(() => {
                // mit Seitenlayout nur auf dem Blatt, sonst über die sichtbare Fläche
                const b = page ? sheetBox(page) : { x1: -view.panX / z, y1: -view.panY / z, x2: (size.w - view.panX) / z, y2: (size.h - view.panY) / z }
                return <rect x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} fill="url(#lgrid)" pointerEvents="none" />
              })()}
            </>
          )}
          <g className="overlay-below">{below}</g>
          <Content scene={scene} />
          <g className="overlay-above">{overlay}</g>
        </g>
        {/* Hilfslinien des Seitenlayouts (über die ganze Fläche) */}
        <g pointerEvents="none" stroke={LAYOUT_GUIDE} strokeWidth={1}>
          {(aids?.guidesX ?? []).map((x, i) => (
            <line key={'gx' + i} x1={view.panX + x * z} y1={0} x2={view.panX + x * z} y2={size.h} />
          ))}
          {(aids?.guidesY ?? []).map((y, i) => (
            <line key={'gy' + i} x1={0} y1={view.panY + y * z} x2={size.w} y2={view.panY + y * z} />
          ))}
        </g>
        {page && !editing && <PagePlusButtons page={page} view={view} />}
        {aids?.rulers && <Rulers view={view} w={size.w} h={size.h} origin={origin} />}
      </svg>
      {editing && <InlineEditor key={editing.id + (editing.which ?? '') + (editing.part ?? '')} />}
    </div>
  )
}

/**
 * Lineale oben und links in cm (Nullpunkt: linke obere Ecke der Seiten). Aus ihnen zieht man Hilfslinien heraus
 * (siehe onPointerDown); Teilstriche je nach Zoom alle 1/2/5 mm …
 */
function Rulers({ view, w, h, origin }: { view: { zoom: number; panX: number; panY: number }; w: number; h: number; origin: { x: number; y: number } }) {
  const pxPerMm = UNITS_PER_MM * view.zoom
  const minor = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((s) => s * pxPerMm >= 5) ?? 500
  const major = [10, 20, 50, 100, 200, 500, 1000, 2000].find((s) => s * pxPerMm >= 48 && s % minor === 0) ?? 2000
  const ticks = (axis: 'x' | 'y', len: number) => {
    const pan = axis === 'x' ? view.panX : view.panY
    const o = axis === 'x' ? origin.x : origin.y
    // sichtbarer Bereich in mm ab Nullpunkt
    const mm = (s: number) => ((s - pan) / view.zoom - o) / UNITS_PER_MM
    const from = Math.floor(mm(RULER) / minor) * minor
    const to = mm(len)
    const out = []
    for (let m = from; m <= to; m += minor) {
      const s = pan + (o + m * UNITS_PER_MM) * view.zoom
      if (s < RULER) continue
      const isMajor = Math.abs(m % major) < 1e-6
      const half = !isMajor && Math.abs(m % (major / 2)) < 1e-6
      const t = isMajor ? RULER * 0.55 : half ? RULER * 0.35 : RULER * 0.2
      out.push(
        axis === 'x' ? (
          <line key={m} x1={s} y1={RULER - t} x2={s} y2={RULER} />
        ) : (
          <line key={m} x1={RULER - t} y1={s} x2={RULER} y2={s} />
        ),
      )
      if (isMajor) {
        const label = String(Math.round(m) / 10)
        out.push(
          axis === 'x' ? (
            <text key={'t' + m} x={s + 2} y={9} fontSize={9} stroke="none">
              {label}
            </text>
          ) : (
            <text key={'t' + m} x={9} y={s + 2} fontSize={9} stroke="none" transform={`rotate(-90 9 ${s + 2})`} textAnchor="end">
              {label}
            </text>
          ),
        )
      }
    }
    return out
  }
  return (
    <g className="rulers">
      <rect x={0} y={0} width={w} height={RULER} className="ruler-bg" />
      <rect x={0} y={0} width={RULER} height={h} className="ruler-bg" />
      <g className="ruler-ticks">
        {ticks('x', w)}
        {ticks('y', h)}
      </g>
      <rect x={0} y={0} width={RULER} height={RULER} className="ruler-corner">
        <title>Lineale in cm – Hilfslinie herausziehen, zurück aufs Lineal ziehen zum Löschen</title>
      </rect>
    </g>
  )
}

/** Blätter des Seitenlayouts: weiße (bzw. farbige) Fläche mit Schatten, Seitengrenzen gestrichelt */
function PageSheet({ page, background, zoom }: { page: PageLayout; background?: string; zoom: number }) {
  const b = sheetBox(page)
  const { w, h } = pageDims(page)
  const lines = []
  for (let c = 1; c < page.cols; c++) lines.push(<line key={'c' + c} x1={b.x1 + c * w} y1={b.y1} x2={b.x1 + c * w} y2={b.y2} />)
  for (let r = 1; r < page.rows; r++) lines.push(<line key={'r' + r} x1={b.x1} y1={b.y1 + r * h} x2={b.x2} y2={b.y1 + r * h} />)
  const s = 1 / zoom
  return (
    <g className="page-sheet" pointerEvents="none">
      <rect x={b.x1 + 3 * s} y={b.y1 + 4 * s} width={b.x2 - b.x1} height={b.y2 - b.y1} fill="rgba(16,24,40,0.18)" />
      <rect x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} fill={background ?? '#ffffff'} stroke="var(--page-edge)" strokeWidth={s} />
      <g stroke="var(--page-edge)" strokeWidth={s} strokeDasharray={`${6 * s} ${5 * s}`}>
        {lines}
      </g>
    </g>
  )
}

/** große „+“-Knöpfe an den vier Rändern: eine weitere Seite gleichen Formats anbauen */
function PagePlusButtons({ page, view }: { page: PageLayout; view: View }) {
  const b = sheetBox(page)
  const sx = (x: number) => x * view.zoom + view.panX
  const sy = (y: number) => y * view.zoom + view.panY
  const cx = (sx(b.x1) + sx(b.x2)) / 2
  const cy = (sy(b.y1) + sy(b.y2)) / 2
  const off = 30
  const spots: { side: 'top' | 'bottom' | 'left' | 'right'; x: number; y: number; tip: string }[] = [
    { side: 'top', x: cx, y: sy(b.y1) - off, tip: 'Seite oben anbauen' },
    { side: 'bottom', x: cx, y: sy(b.y2) + off, tip: 'Seite unten anbauen' },
    { side: 'left', x: sx(b.x1) - off, y: cy, tip: 'Seite links anbauen' },
    { side: 'right', x: sx(b.x2) + off, y: cy, tip: 'Seite rechts anbauen' },
  ]
  return (
    <g className="page-plus">
      {spots.map((p) => (
        <g
          key={p.side}
          transform={`translate(${p.x},${p.y})`}
          data-tip={p.tip}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            addPage(p.side)
          }}
        >
          <circle r={18} />
          <path d="M -8 0 H 8 M 0 -8 V 8" />
        </g>
      ))}
    </g>
  )
}

/** Endpunkt einer neuen Bindung beim Ziehen */
/** Auswahl eines ganzen zusammenhängenden Moleküls (inkl. Ringfüllungen) */
function fragmentSel(doc: Doc, startAtom: Id): Selection {
  const g = getScene(doc).g
  const seen = new Set([startAtom])
  const stack = [startAtom]
  while (stack.length) {
    const c = stack.pop()!
    for (const nb of g.adj.get(c) ?? []) {
      if (!seen.has(nb.other.id)) {
        seen.add(nb.other.id)
        stack.push(nb.other.id)
      }
    }
  }
  const s = completeSel(doc, { ...emptySelection(), atoms: [...seen] })
  s.fills = Object.values(doc.fills ?? {}).filter((f) => f.rings.every((r) => r.every((a) => seen.has(a)))).map((f) => f.id)
  return s
}

/** Rahmen einer Schrittbezeichnung (für Treffer und Griff) */
function arcLabelBox(doc: Doc, c: Cycle, al: CycleArcLabel) {
  const lp = arcLabelPos(doc, c, al)
  const o = stationLabelSize(doc)
  const lay = layoutRich(al.label || ' ', o)
  const w = Math.max(lay.width, o.size * 2)
  return { x1: lp.x - w / 2, y1: lp.y - o.size * 0.95, x2: lp.x + w / 2, y2: lp.y - o.size * 0.95 + lay.height }
}

/** Endpunkt beim Aufziehen einer Form: Kugel immer rund, mit Umschalt auch Kreis/Quadrat */
function shapeEnd(kind: string, start: Pt, p: Pt, shift: boolean): Pt {
  if (kind !== 'sphere' && !(shift && (kind === 'ellipse' || kind === 'rect' || kind === 'roundrect'))) return p
  const dx = p.x - start.x
  const dy = p.y - start.y
  const m = Math.max(Math.abs(dx), Math.abs(dy))
  return { x: start.x + Math.sign(dx || 1) * m, y: start.y + Math.sign(dy || 1) * m }
}

/** Zyklus, dessen Linie nahe am Punkt liegt */
function cycleNear(doc: Doc, p: Pt, tol: number, exclude?: Id): Id | null {
  let best: Id | null = null
  let bd = tol
  for (const id in doc.cycles ?? {}) {
    if (id === exclude) continue
    const dd = eDist(doc.cycles[id], p)
    if (dd < bd) {
      bd = dd
      best = id
    }
  }
  return best
}

/**
 * Zieh-Gesten des Zyklus-Werkzeugs:
 * - von der Linie eines Zyklus auf einen anderen Zyklus → Verbindungspfeil
 * - von der Linie nach außen/innen → Abfluss
 * - aus dem freien Bereich auf eine Zykluslinie → Zufluss
 */
function cycleGesture(
  doc: Doc,
  start: Pt,
  p: Pt,
  tol: number,
  from: { id: Id; angle: number } | null,
): { preview: Preview; apply: (d: Doc) => void; target: Id | null } | null {
  const quadToCubic = (g: { from: Pt; q: Pt; to: Pt }, head: boolean): Preview => ({
    kind: 'cubic',
    p0: g.from,
    c1: { x: g.from.x + ((g.q.x - g.from.x) * 2) / 3, y: g.from.y + ((g.q.y - g.from.y) * 2) / 3 },
    c2: { x: g.to.x + ((g.q.x - g.to.x) * 2) / 3, y: g.to.y + ((g.q.y - g.to.y) * 2) / 3 },
    p1: g.to,
    head,
  })
  if (from) {
    const a = doc.cycles[from.id]
    if (!a) return null
    if (eDist(a, p) < tol * 1.4) return null
    const br = { ...newBranch(from.angle, 'out', (a.rx + a.ry) / 2), ...branchFromPoint(a, from.angle, 'out', p) }
    return {
      preview: quadToCubic(branchGeom(a, br), true),
      target: null,
      apply: (d) => {
        d.cycles[from.id].branches.push(br)
      },
    }
  }
  const tg = cycleNear(doc, p, tol * 1.6)
  if (!tg) return null
  const c = doc.cycles[tg]
  // Start zu nah an der Linie: kein sinnvoller Zufluss
  if (eDist(c, start) < tol * 1.4) return null
  const ang = eAngle(c, p)
  const br = { ...newBranch(ang, 'in', (c.rx + c.ry) / 2), ...branchFromPoint(c, ang, 'in', start) }
  return {
    preview: quadToCubic(branchGeom(c, br), false),
    target: tg,
    apply: (d) => {
      d.cycles[tg].branches.push(br)
    },
  }
}

/** Station (Lücke) oder Seitenpfeil-Ende eines Zyklus am Punkt – für das Beschriften per Doppelklick */
function cycleLabelAt(doc: Doc, p: Pt, tol: number): { kind: 'station' | 'branch' | 'link' | 'arc'; id: Id; part: string } | null {
  for (const id in doc.cycles ?? {}) {
    const c = doc.cycles[id]
    for (const al of c.arcLabels ?? []) {
      const b = arcLabelBox(doc, c, al)
      if (p.x > b.x1 - tol * 0.5 && p.x < b.x2 + tol * 0.5 && p.y > b.y1 - tol * 0.5 && p.y < b.y2 + tol * 0.5) return { kind: 'arc', id, part: al.id }
    }
    for (const l of c.links ?? []) {
      const g = linkGeom(doc, c, l)
      if (!g) continue
      const lp = l.label ? linkLabelPos(doc, c, l) : null
      if (lp && dist({ x: lp.x, y: lp.y - tol * 0.3 }, p) < tol * 2) return { kind: 'link', id, part: l.id }
      // Doppelklick auf das Mittelstück der Kurve (nicht auf die Zyklen-Enden)
      if (cubicDist(g, p) < tol * 0.8 && dist(g.p0, p) > tol * 1.5 && dist(g.p3, p) > tol * 1.5) return { kind: 'link', id, part: l.id }
    }
    for (const b of c.branches) {
      const g = branchGeom(c, b)
      if (dist(g.e, p) < tol * 1.3) return { kind: 'branch', id, part: b.id }
      if (b.label) {
        const lp = branchLabelPos(doc, c, b)
        if (dist({ x: lp.x, y: lp.y - tol * 0.3 }, p) < tol * 2) return { kind: 'branch', id, part: b.id }
      }
    }
    for (const [i, st] of c.stations.entries()) if (dist(ePoint(c, st.angle), p) < tol * 1.6) return { kind: 'station', id, part: String(i) }
  }
  return null
}

/** Ladung oder Partialladung unter dem Zeiger */
function decorHit(scene: Scene, p: Pt, tol: number): { atom: Id; which: 'charge' | 'partial' | 'stereo' | 'lp' | 'rad'; index: number; pos: Pt } | null {
  for (const [id, d] of scene.decor) {
    if (d.charge && dist(d.charge, p) < tol) return { atom: id, which: 'charge', index: 0, pos: d.charge }
    if (d.partial && dist(d.partial, p) < tol) return { atom: id, which: 'partial', index: 0, pos: d.partial }
    if (d.stereo && dist(d.stereo.c, p) < tol * (d.stereo.cip ? 1.4 : 1)) return { atom: id, which: 'stereo', index: 0, pos: d.stereo.c }
    for (let i = 0; i < d.lonePairs.length; i++) if (dist(d.lonePairs[i].c, p) < tol * 0.9) return { atom: id, which: 'lp', index: i, pos: d.lonePairs[i].c }
    for (let i = 0; i < d.radicals.length; i++) if (dist(d.radicals[i].c, p) < tol * 0.8) return { atom: id, which: 'rad', index: i, pos: d.radicals[i].c }
  }
  return null
}

function bondEnd(doc: Doc, start: Pt, from: Id | null, p: Pt, free: boolean): Pt {
  const L = doc.style.bondLength
  // Über einem (auch weit entfernten) Atom loslassen = verbinden; die Länge normalisiert „Struktur bereinigen“
  const near = atomNear(doc, p, L * 0.3, from ? new Set([from]) : undefined)
  if (near) return { x: near.x, y: near.y }
  let ang = angleOf(sub(p, start))
  if (!free) ang = snapAngle(ang, 15)
  return add(start, fromAngle(ang, L))
}

function arrowEnd(start: Pt, p: Pt, free: boolean): Pt {
  if (free) return p
  const ang = snapAngle(angleOf(sub(p, start)), 15)
  const l = dist(start, p)
  return add(start, fromAngle(ang, l))
}

function chainSide(doc: Doc, from: Id | null, start: Pt, p: Pt): boolean | undefined {
  if (!from) return undefined
  // Kette so beginnen, dass sie zickzackförmig an den vorhandenen Nachbarn anschließt
  const g = buildGraph(doc)
  const a = doc.atoms[from]
  if ((g.adj.get(from)?.length ?? 0) === 0) return undefined
  const best = bestBondAngle(g, a)
  const v = sub(p, start)
  const ang = Math.round(angleOf(v) / (Math.PI / 6)) * (Math.PI / 6)
  const dir = fromAngle(ang)
  const n = perp(dir)
  const b = fromAngle(best)
  return b.x * n.x + b.y * n.y >= 0
}

export function defaultBend(scene: Scene, from: Anchor, to: Anchor): number {
  const s = anchorPoint(scene, from)
  const t = anchorPoint(scene, to)
  if (!s || !t) return 0.4
  const m = mid(s, t)
  // Krümmung weg vom Schwerpunkt der umliegenden Atome
  let cx = 0
  let cy = 0
  let n = 0
  const L = scene.doc.style.bondLength
  for (const id in scene.doc.atoms) {
    const a = scene.doc.atoms[id]
    if (dist(a, m) < L * 2.5) {
      cx += a.x
      cy += a.y
      n++
    }
  }
  const nrm = perp(norm(sub(t, s)))
  if (!n) return 0.4
  const c = { x: cx / n, y: cy / n }
  const side = dot(nrm, sub(m, c)) >= 0 ? 1 : -1
  return 0.4 * side
}

// ---------- Inline-Editor ----------

function InlineEditor() {
  const editing = useStore((s) => s.editing)!
  const doc = useStore((s) => s.doc)
  if (editing.kind === 'atom') return doc.atoms[editing.id] ? <AtomInlineEditor id={editing.id} /> : null
  if (editing.kind === 'arrow') return doc.arrows[editing.id] ? <ArrowTextInlineEditor id={editing.id} which={editing.which ?? 'above'} /> : null
  if (editing.kind === 'station' || editing.kind === 'branch' || editing.kind === 'link' || editing.kind === 'arc') return doc.cycles?.[editing.id] ? <CycleLabelEditor id={editing.id} kind={editing.kind} part={editing.part ?? ''} /> : null
  return doc.texts[editing.id] ? <TextInlineEditor id={editing.id} fresh={!!editing.fresh} /> : null
}

function atomEditorHtml(a: Atom): string {
  let h = a.label ? richToEditorHtml(a.label) : a.element === 'C' ? '' : a.element.replace(/[<>&"]/g, '')
  if (h && a.italic) h = `<i>${h}</i>`
  if (h && a.bold) h = `<b>${h}</b>`
  return h
}

/** Label mit Formatierung übernehmen: einheitlich fett/kursiv → Atom-Schalter, sonst Rich-Label */
export function applyAtomRich(d: Doc, id: Id, html: string) {
  const a = d.atoms[id]
  if (!a) return
  const v = sanitizeRich(html)
  const runs = parseRich(v).flat()
  const plain = runs.map((r) => r.t).join('').trim()
  const fancy = runs.some((r) => r.sup || r.sub || r.u || r.color || r.font || (r.s !== undefined && r.s !== 1))
  const allB = runs.length > 0 && runs.every((r) => r.b)
  const allI = runs.length > 0 && runs.every((r) => r.i)
  const uniform = !fancy && runs.every((r) => !!r.b === allB && !!r.i === allI)
  applyAtomText(d, id, plain)
  if (!plain) {
    a.bold = a.italic = a.boldBonds = undefined
    return
  }
  if (uniform) {
    a.bold = allB || undefined
    a.italic = allI || undefined
    if (!a.bold) a.boldBonds = undefined
    return
  }
  // gemischte Formatierung: als Rich-Label speichern (Chemie nutzt nur den Klartext)
  a.label = v
  a.element = 'C'
  a.bold = a.italic = undefined
}

function AtomInlineEditor({ id }: { id: Id }) {
  const doc = useStore((s) => s.doc)
  const view = useStore((s) => s.view)
  const atom = doc.atoms[id]
  const ref = useRef<HTMLDivElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const done = useRef(false)
  // vor einem Tab-Wechsel sofort übernehmen (siehe registerEditFlush)
  const flushRef = useRef(() => {})
  useEffect(() => registerEditFlush(() => flushRef.current()), [])
  const initial = useRef(atom ? atomEditorHtml(atom) : '')
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = initial.current
    el.focus()
    const r = document.createRange()
    r.selectNodeContents(el)
    const s = window.getSelection()
    s?.removeAllRanges()
    s?.addRange(r)
  }, [])
  if (!atom) return null
  flushRef.current = () => finish(true)
  const finish = (apply: boolean) => {
    if (done.current) return
    done.current = true
    const html = ref.current?.innerHTML ?? ''
    if (apply && sanitizeRich(html) !== sanitizeRich(initial.current)) commit((d) => applyAtomRich(d, id, html))
    if (getState().editing?.id === id) setState({ editing: null })
  }
  const fs = doc.style.fontSize
  const z = view.zoom
  return (
    <div
      ref={wrap}
      className="inline-rich atom"
      style={{ left: atom.x * z + view.panX, top: atom.y * z + view.panY - fs * 0.75 * z }}
      onBlur={(e) => {
        if (wrap.current && e.relatedTarget instanceof Node && wrap.current.contains(e.relatedTarget)) return
        setTimeout(() => {
          if (wrap.current && document.activeElement && wrap.current.contains(document.activeElement)) return
          finish(true)
        }, 0)
      }}
    >
      <RichToolbar target={ref} baseSize={fs} formula={false} />
      <div
        ref={ref}
        className="inline-editor atom rich"
        contentEditable
        suppressContentEditableWarning
        data-placeholder="C"
        style={{ fontSize: fs * z, height: fs * 1.5 * z, lineHeight: `${fs * 1.5 * z}px`, fontFamily: fontCss(doc.style.font) }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (richKeyDown(e)) return
          if (e.key === 'Enter') {
            e.preventDefault()
            finish(true)
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            finish(false)
          }
        }}
        spellCheck={false}
      />
    </div>
  )
}

function CycleLabelEditor({ id, kind, part }: { id: Id; kind: 'station' | 'branch' | 'link' | 'arc'; part: string }) {
  const doc = useStore((s) => s.doc)
  const view = useStore((s) => s.view)
  const c = doc.cycles[id]
  const ref = useRef<HTMLDivElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const done = useRef(false)
  // vor einem Tab-Wechsel sofort übernehmen (siehe registerEditFlush)
  const flushRef = useRef(() => {})
  useEffect(() => registerEditFlush(() => flushRef.current()), [])
  const read = () =>
    (kind === 'station'
      ? c?.stations[Number(part)]?.label
      : kind === 'link'
        ? c?.links?.find((l) => l.id === part)?.label
        : kind === 'arc'
          ? c?.arcLabels?.find((l) => l.id === part)?.label
          : c?.branches.find((b) => b.id === part)?.label) ?? ''
  const initial = useRef(read())
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = richToEditorHtml(initial.current)
    el.focus()
    const r = document.createRange()
    r.selectNodeContents(el)
    const s2 = window.getSelection()
    s2?.removeAllRanges()
    s2?.addRange(r)
  }, [])
  if (!c) return null
  const size = stationLabelSize(doc).size
  let pos: { x: number; y: number; align: 'left' | 'center' | 'right' }
  if (kind === 'station') {
    const st = c.stations[Number(part)]
    if (!st) return null
    const p = ePoint(c, st.angle)
    pos = { x: p.x, y: p.y + size * 0.35, align: 'center' }
  } else if (kind === 'link') {
    const l = c.links?.find((x) => x.id === part)
    const lp = l && linkLabelPos(doc, c, l)
    if (!lp) return null
    pos = lp
  } else if (kind === 'arc') {
    const al = c.arcLabels?.find((x) => x.id === part)
    if (!al) return null
    // neue (leere) Bezeichnung: Platz für einen typischen Text einplanen, damit das Eingabefeld nicht auf dem Bogen liegt
    pos = arcLabelPos(doc, c, al.label ? al : { ...al, label: 'oxidative Addition' })
  } else {
    const b = c.branches.find((x) => x.id === part)
    if (!b) return null
    pos = branchLabelPos(doc, c, b)
  }
  flushRef.current = () => finish()
  const finish = () => {
    if (done.current) return
    done.current = true
    const raw = sanitizeRich(ref.current?.innerHTML ?? '')
    const v = richPlain(raw).trim() ? raw : ''
    if (v !== initial.current || (kind === 'arc' && !v))
      commit((d) => {
        const cc = d.cycles[id]
        if (kind === 'station') {
          const st = cc.stations[Number(part)]
          if (st) st.label = v || undefined
        } else if (kind === 'link') {
          const l = cc.links?.find((x) => x.id === part)
          if (l) l.label = v || undefined
        } else if (kind === 'arc') {
          // leere Schrittbezeichnung wieder entfernen
          if (v) {
            const al = cc.arcLabels?.find((x) => x.id === part)
            if (al) al.label = v
          } else cc.arcLabels = (cc.arcLabels ?? []).filter((x) => x.id !== part)
        } else {
          const b = cc.branches.find((x) => x.id === part)
          if (b) b.label = v || undefined
        }
      })
    if (getState().editing?.id === id) setState({ editing: null })
  }
  const z = view.zoom
  const tx = pos.align === 'center' ? '-50%' : pos.align === 'right' ? '-100%' : '0'
  return (
    <div
      ref={wrap}
      className="inline-rich arrowtext"
      style={{ left: pos.x * z + view.panX, top: (pos.y - size * 0.95) * z + view.panY, transform: `translateX(${tx})` }}
      onBlur={(e) => {
        if (wrap.current && e.relatedTarget instanceof Node && wrap.current.contains(e.relatedTarget)) return
        setTimeout(() => {
          if (wrap.current && document.activeElement && wrap.current.contains(document.activeElement)) return
          finish()
        }, 0)
      }}
    >
      <RichToolbar target={ref} baseSize={size} />
      <div
        ref={ref}
        className="inline-editor text rich"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={kind === 'station' ? 'Zwischenstufe, z. B. LnPd(0)' : kind === 'link' ? 'Übergang, z. B. Transmetallierung' : kind === 'arc' ? 'Schritt, z. B. oxidative Addition' : 'Edukt / Produkt'}
        style={{ fontSize: size * z, lineHeight: 1.25, minWidth: 120, fontFamily: fontCss(doc.style.font), textAlign: pos.align }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (richKeyDown(e)) return
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
            e.preventDefault()
            finish()
          }
        }}
        spellCheck={false}
      />
    </div>
  )
}

function ArrowTextInlineEditor({ id, which }: { id: Id; which: 'above' | 'below' }) {
  const doc = useStore((s) => s.doc)
  const view = useStore((s) => s.view)
  const ar = doc.arrows[id]
  const ref = useRef<HTMLDivElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const done = useRef(false)
  // vor einem Tab-Wechsel sofort übernehmen (siehe registerEditFlush)
  const flushRef = useRef(() => {})
  useEffect(() => registerEditFlush(() => flushRef.current()), [])
  const initial = useRef(ar?.[which] ?? '')
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = richToEditorHtml(initial.current)
    el.focus()
    const r = document.createRange()
    r.selectNodeContents(el)
    const s = window.getSelection()
    s?.removeAllRanges()
    s?.addRange(r)
  }, [])
  if (!ar) return null
  const blk = arrowTextBlock(doc, ar, which)
  const size = arrowTextOpts(doc).size
  flushRef.current = () => finish()
  const finish = () => {
    if (done.current) return
    done.current = true
    const v = richPlain(sanitizeRich(ref.current?.innerHTML ?? '')).trim() ? sanitizeRich(ref.current?.innerHTML ?? '') : ''
    if (v !== initial.current)
      commit((d) => {
        d.arrows[id][which] = v
      })
    if (getState().editing?.id === id) setState({ editing: null })
  }
  const z = view.zoom
  const lines = Math.max(1, blk.lay.lines.length)
  // Block so platzieren, dass er die spätere Darstellung überdeckt
  const top = (blk.y - size * 0.95) * z + view.panY
  const tx = blk.align === 'center' ? '-50%' : blk.align === 'right' ? '-100%' : '0'
  return (
    <div
      ref={wrap}
      className="inline-rich arrowtext"
      style={{ left: blk.x * z + view.panX, top, transform: `translateX(${tx})` }}
      onBlur={(e) => {
        if (wrap.current && e.relatedTarget instanceof Node && wrap.current.contains(e.relatedTarget)) return
        setTimeout(() => {
          if (wrap.current && document.activeElement && wrap.current.contains(document.activeElement)) return
          finish()
        }, 0)
      }}
    >
      <RichToolbar target={ref} baseSize={size} />
      <div
        ref={ref}
        className="inline-editor text rich"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={which === 'above' ? (blk.vertical ? 'Bedingungen rechts …' : 'Bedingungen über dem Pfeil …') : blk.vertical ? 'links …' : 'unter dem Pfeil …'}
        style={{
          fontSize: size * z,
          lineHeight: 1.25,
          minWidth: 140,
          minHeight: lines * size * 1.25 * z,
          fontFamily: fontCss(doc.style.font),
          textAlign: blk.align,
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (richKeyDown(e)) return
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
            e.preventDefault()
            finish()
          }
          if (e.key === 'Tab') {
            // Tab wechselt zwischen über/unter dem Pfeil
            e.preventDefault()
            finish()
            setState({ editing: { kind: 'arrow', id, which: which === 'above' ? 'below' : 'above' } })
          }
        }}
        spellCheck={false}
      />
    </div>
  )
}

function TextInlineEditor({ id, fresh }: { id: Id; fresh: boolean }) {
  const doc = useStore((s) => s.doc)
  const view = useStore((s) => s.view)
  const t = doc.texts[id]
  const ref = useRef<HTMLDivElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const done = useRef(false)
  // vor einem Tab-Wechsel sofort übernehmen (siehe registerEditFlush)
  const flushRef = useRef(() => {})
  useEffect(() => registerEditFlush(() => flushRef.current()), [])
  const initial = useRef(t?.text ?? '')
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = richToEditorHtml(initial.current)
    el.focus()
    const r = document.createRange()
    r.selectNodeContents(el)
    if (!fresh) {
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(r)
    }
  }, [fresh])
  if (!t) return null
  flushRef.current = () => finish()
  const finish = () => {
    if (done.current) return
    done.current = true
    const v = sanitizeRich(ref.current?.innerHTML ?? '')
    if (!richPlain(v).trim()) {
      commit((d) => {
        delete d.texts[id]
      })
    } else if (v !== initial.current) {
      commit((d) => {
        d.texts[id].text = v
      })
    }
    if (getState().editing?.id === id) setState({ editing: null })
  }
  const z = view.zoom
  const left = t.x * z + view.panX - 4
  const top = (t.y - t.size * 0.62) * z + view.panY
  return (
    <div
      ref={wrap}
      className="inline-rich"
      style={{ left, top }}
      onBlur={(e) => {
        if (wrap.current && e.relatedTarget instanceof Node && wrap.current.contains(e.relatedTarget)) return
        // Fokus wandert u. U. kurz in Farb-/Schriftauswahl
        setTimeout(() => {
          if (wrap.current && document.activeElement && wrap.current.contains(document.activeElement)) return
          finish()
        }, 0)
      }}
    >
      <RichToolbar target={ref} baseSize={t.size} />
      <div
        ref={ref}
        className="inline-editor text rich"
        contentEditable
        suppressContentEditableWarning
        data-placeholder="Text …"
        style={{
          fontSize: t.size * z,
          lineHeight: 1.25,
          minWidth: 120,
          fontFamily: fontCss(t.font ?? doc.style.font),
          fontWeight: t.bold ? 'bold' : undefined,
          fontStyle: t.italic ? 'italic' : undefined,
          color: t.color ?? '#111418',
          textAlign: t.align ?? 'left',
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (richKeyDown(e)) return
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
            e.preventDefault()
            ;(e.target as HTMLElement).blur()
            finish()
          }
        }}
        spellCheck={false}
      />
    </div>
  )
}
