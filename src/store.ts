import { lsGet, lsSet } from './storage'
import { produce, setAutoFreeze } from 'immer'
import { useSyncExternalStore } from 'react'
import type { ClipData } from './model/ops'
import type { Doc, Id, Selection } from './model/types'
import { emptyDoc, emptySelection, normalizeDoc } from './model/types'

setAutoFreeze(false)

export type ToolId =
  | 'select'
  | 'lasso'
  | 'eraser'
  | 'bond'
  | 'chain'
  | 'ring'
  | 'atom'
  | 'charge+'
  | 'charge-'
  | 'radical'
  | 'lonepair'
  | 'partial+'
  | 'partial-'
  | 'arrow'
  | 'curved'
  | 'text'
  | 'plus'
  | 'shape'
  | 'template'
  | 'ringfill'
  | 'rotate3d'
  | 'cycle'
  | 'pan'

export type Hover =
  | { kind: 'atom'; id: Id }
  | { kind: 'bond'; id: Id }
  | { kind: 'lp'; id: Id; index: number }
  | { kind: 'arrow'; id: Id }
  | { kind: 'curved'; id: Id }
  | { kind: 'text'; id: Id }
  | { kind: 'shape'; id: Id }
  | { kind: 'fill'; id: Id }
  | { kind: 'decor'; id: Id; which: 'charge' | 'partial' | 'stereo' | 'lp' | 'rad'; index?: number }
  | { kind: 'cycle'; id: Id }
  | { kind: 'table'; id: Id }
  | null

export interface ToolOpts {
  bondType: import('./model/types').BondType
  ringSize: number
  ringAromatic: boolean
  element: string
  label: string | null
  arrowKind: import('./model/types').ArrowKind
  curvedHead: 'full' | 'half'
  shapeKind: import('./model/types').ShapeKind
  templateSmiles: string | null
  templateName: string
  fill: import('./model/rings').FillStyle
  /** Ringfüllung: nur der Ring · jeder Ring des Systems mit eigenem Verlauf · ganzes System mit einem Verlauf */
  fillScope: 'ring' | 'each' | 'system'
  /** Ringfüllung entfernen statt füllen */
  fillErase: boolean
  arrowRoute: import('./model/types').ArrowRoute
  arrowHeads: 'end' | 'both' | 'none' | 'start'
  /** magnetische Hilfslinien beim Verschieben */
  snap: boolean
  cycleMode: 'draw' | 'station' | 'in' | 'out' | 'pair' | 'second'
  cycleStations: number
  cycleDir: 'cw' | 'ccw'
}

export interface Editing {
  kind: 'atom' | 'text' | 'arrow' | 'station' | 'branch' | 'link' | 'arc'
  id: Id
  /** Zyklus: Index der Station bzw. ID des Seitenpfeils / Verbindungspfeils */
  part?: string
  /** bei Pfeilen: welche Beschriftung */
  which?: 'above' | 'below'
  /** neu erzeugtes Objekt (beim Abbrechen wieder entfernen) */
  fresh?: boolean
}

export interface View {
  zoom: number
  panX: number
  panY: number
}

export interface State {
  doc: Doc
  sel: Selection
  tool: ToolId
  opts: ToolOpts
  past: Doc[]
  future: Doc[]
  view: View
  hover: Hover
  editing: Editing | null
  toast: { msg: string; kind: 'info' | 'error'; t: number } | null
  dialog: null | 'import' | 'periodic' | 'help' | 'templates' | 'export' | 'saveTemplate' | 'settings'
  /** geöffneter Editor einer Ansatztabelle */
  tableEditor: Id | null
  /** offenes Kontextmenü: Bildschirmposition und Dokumentpunkt des Rechtsklicks */
  /** pick: der Rechtsklick hat selbst ein einzelnes Atom/eine Bindung ausgewählt */
  contextMenu: { x: number; y: number; at: { x: number; y: number }; pick?: boolean } | null
  /** Einfügepunkt für den Import-Dialog (Name → Struktur per Rechtsklick an dieser Stelle) */
  importAt: { x: number; y: number } | null
  /** rechte Seitenleiste (Inspektor) ausgeblendet */
  inspectorHidden: boolean
  fileName: string
  dirty: boolean
}

const AUTOSAVE_KEY = 'openmol:autosave'

function loadAutosave(): Doc | null {
  try {
    const s = lsGet(AUTOSAVE_KEY)
    if (!s) return null
    const d = JSON.parse(s) as Doc
    if (!d.atoms || !d.style) return null
    return normalizeDoc(d)
  } catch {
    return null
  }
}

function loadName(): string {
  try {
    return lsGet(AUTOSAVE_KEY + ':name') || 'Unbenannt'
  } catch {
    return 'Unbenannt'
  }
}

let state: State = {
  doc: loadAutosave() ?? emptyDoc(),
  sel: emptySelection(),
  tool: 'bond',
  opts: {
    bondType: 'single',
    ringSize: 6,
    ringAromatic: true,
    element: 'N',
    label: null,
    arrowKind: 'reaction',
    curvedHead: 'full',
    shapeKind: 'brackets',
    templateSmiles: null,
    templateName: '',
    fill: { mode: 'fill', grad: 'radial', c1: '#1d2bd8', c2: '#9aa6ff', angle: 0, opacity: 1 },
    fillScope: 'ring',
    fillErase: false,
    arrowRoute: 'straight',
    arrowHeads: 'end',
    snap: true,
    cycleMode: 'draw',
    cycleStations: 4,
    cycleDir: 'cw',
  },
  past: [],
  future: [],
  view: { zoom: 1, panX: 0, panY: 0 },
  hover: null,
  editing: null,
  toast: null,
  dialog: null,
  tableEditor: null,
  contextMenu: null,
  importAt: null,
  inspectorHidden: (() => {
    try {
      return lsGet('openmol:inspector-hidden') === '1'
    } catch {
      return false
    }
  })(),
  fileName: loadName(),
  dirty: false,
}

const listeners = new Set<() => void>()
let saveTimer: number | undefined

function emit() {
  for (const l of listeners) l()
}

export function getState(): State {
  return state
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...p }
  if ('fileName' in p) scheduleSave()
  emit()
}

export function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state))
}

function scheduleSave() {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      lsSet(AUTOSAVE_KEY, JSON.stringify(state.doc))
      lsSet(AUTOSAVE_KEY + ':name', state.fileName)
    } catch {
      // Speicher voll oder gesperrt – Autosave ist nur eine Komfortfunktion
    }
  }, 400)
}

const MAX_HISTORY = 200

/** Änderung mit Undo-Eintrag */
export function commit(recipe: (d: Doc) => void | Selection, opts: { keepSel?: boolean } = {}) {
  let newSel: Selection | undefined
  const next = produce(state.doc, (d) => {
    const r = recipe(d as Doc)
    // nur echte Auswahl-Objekte übernehmen (versehentliche Rückgabewerte ignorieren)
    if (r && typeof r === 'object' && Array.isArray((r as Selection).atoms) && Array.isArray((r as Selection).bonds)) newSel = { ...emptySelection(), ...r }
  })
  if (next === state.doc) return
  state = {
    ...state,
    doc: next,
    past: [...state.past.slice(-MAX_HISTORY), state.doc],
    future: [],
    sel: newSel ?? (opts.keepSel === false ? emptySelection() : pruneSel(state.sel, next)),
    dirty: true,
  }
  scheduleSave()
  emit()
}

// ---------- Transaktionen (Ziehen) ----------

let txBase: Doc | null = null

export function beginTx() {
  txBase = state.doc
}

export function liveUpdate(recipe: (d: Doc) => void) {
  if (!txBase) beginTx()
  const next = produce(txBase!, (d) => {
    recipe(d as Doc)
  })
  state = { ...state, doc: next }
  emit()
}

export function endTx(sel?: Selection) {
  if (!txBase) return
  const base = txBase
  txBase = null
  if (state.doc === base) {
    if (sel) setState({ sel })
    return
  }
  state = {
    ...state,
    past: [...state.past.slice(-MAX_HISTORY), base],
    future: [],
    sel: sel ?? pruneSel(state.sel, state.doc),
    dirty: true,
  }
  scheduleSave()
  emit()
}

export function cancelTx() {
  if (!txBase) return
  state = { ...state, doc: txBase }
  txBase = null
  emit()
}

export function inTx() {
  return txBase !== null
}

export function undo() {
  if (!state.past.length) return
  const prev = state.past[state.past.length - 1]
  state = {
    ...state,
    doc: prev,
    past: state.past.slice(0, -1),
    future: [state.doc, ...state.future],
    sel: pruneSel(state.sel, prev),
    editing: null,
  }
  scheduleSave()
  emit()
}

export function redo() {
  if (!state.future.length) return
  const next = state.future[0]
  state = {
    ...state,
    doc: next,
    past: [...state.past, state.doc],
    future: state.future.slice(1),
    sel: pruneSel(state.sel, next),
    editing: null,
  }
  scheduleSave()
  emit()
}

export function replaceDoc(doc: Doc, fileName?: string) {
  state = {
    ...state,
    doc,
    past: [...state.past, state.doc],
    future: [],
    sel: emptySelection(),
    editing: null,
    fileName: fileName ?? state.fileName,
    dirty: false,
  }
  scheduleSave()
  emit()
}

export function pruneSel(s: Selection, d: Doc): Selection {
  return {
    atoms: (s.atoms ?? []).filter((id) => d.atoms[id]),
    bonds: (s.bonds ?? []).filter((id) => d.bonds[id]),
    arrows: (s.arrows ?? []).filter((id) => d.arrows[id]),
    curved: (s.curved ?? []).filter((id) => d.curved[id]),
    texts: (s.texts ?? []).filter((id) => d.texts[id]),
    shapes: (s.shapes ?? []).filter((id) => d.shapes[id]),
    fills: (s.fills ?? []).filter((id) => d.fills[id]),
    cycles: (s.cycles ?? []).filter((id) => d.cycles?.[id]),
    tables: (s.tables ?? []).filter((id) => d.tables?.[id]),
  }
}

export function toast(msg: string, kind: 'info' | 'error' = 'info') {
  const t = Date.now()
  setState({ toast: { msg, kind, t } })
  window.setTimeout(() => {
    if (state.toast?.t === t) setState({ toast: null })
  }, kind === 'error' ? 5000 : 2600)
}

export function setTool(tool: ToolId, opts: Partial<ToolOpts> = {}) {
  setState((s) => ({ tool, opts: { ...s.opts, ...opts }, editing: null }))
}

// interne Zwischenablage (zusätzlich zur System-Zwischenablage)
export const clipboard: { data: ClipData | null; pasteCount: number; smiles: string } = { data: null, pasteCount: 0, smiles: '' }

/** Inspektor (rechte Seitenleiste) ein-/ausblenden; die Wahl bleibt gespeichert */
export function toggleInspector(hidden = !state.inspectorHidden) {
  setState({ inspectorHidden: hidden })
  try {
    lsSet('openmol:inspector-hidden', hidden ? '1' : '0')
  } catch {
    // nicht speicherbar – gilt dann bis zum Neuladen
  }
}
