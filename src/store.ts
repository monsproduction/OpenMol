import { lsGet, lsSet } from './storage'
import { produce, setAutoFreeze } from 'immer'
import { useSyncExternalStore } from 'react'
import type { ClipData } from './model/ops'
import type { Doc, Id, Selection } from './model/types'
import { emptyDoc, emptySelection, normalizeDoc, uid } from './model/types'

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
  | 'number'
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
  | { kind: 'decor'; id: Id; which: 'charge' | 'partial' | 'stereo' | 'lp' | 'rad' | 'num'; index?: number }
  | { kind: 'cycle'; id: Id }
  | { kind: 'table'; id: Id }
  | null

/** ChemDraw-Hotspot: Atom bzw. Bindung, an dem die nächste Hotkey-Taste wirkt (grüner Punkt) */
export type Hotspot = { kind: 'atom'; id: Id } | { kind: 'bond'; id: Id } | null

export interface ToolOpts {
  bondType: import('./model/types').BondType
  ringSize: number
  ringAromatic: boolean
  /** Ringform: regelmäßig (ringSize) oder feste Form (Sessel, Cyclopentadien) */
  ringKind: import('./model/ops').RingKind
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
  /** Nummerieren-Werkzeug: nächste Nummer und Strich (′, ″) für ein zweites Ringsystem */
  numNext: number
  numMark: '' | '′' | '″'
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
  hotspot: Hotspot
  editing: Editing | null
  toast: { msg: string; kind: 'info' | 'error'; t: number } | null
  dialog: null | 'import' | 'periodic' | 'help' | 'templates' | 'export' | 'saveTemplate' | 'settings' | 'about'
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
  /** gespeicherte Datei des aktiven Dokuments (Desktop-App; „Speichern“ schreibt ohne Dialog dorthin) */
  filePath: string | null
  /** alle offenen Dokumente (Tabs) in Anzeigereihenfolge – der Eintrag des aktiven Tabs ist nur ein Platzhalter,
   *  seine Daten liegen oben im Zustand (doc, past, future …) */
  tabs: TabData[]
  activeTab: Id
  /** Tabs, die eine Zeichnung aus Word bearbeiten: Tab → Sitzung des Word-Add-ins („Zurück nach Word“) */
  wordTabs: Record<Id, string>
}

/** ein offenes Dokument mit eigenem Verlauf, eigener Auswahl und Ansicht */
export interface TabData {
  id: Id
  doc: Doc
  past: Doc[]
  future: Doc[]
  sel: Selection
  view: View
  fileName: string
  dirty: boolean
  filePath: string | null
}

const AUTOSAVE_KEY = 'openmol:autosave'
/** Inhalte der übrigen Tabs für die Wiederherstellung nach einem Absturz */
const AUTOSAVE_TABS_KEY = 'openmol:autosave:tabs'

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

/**
 * Zeichnung aus der automatischen Sicherung – nur, wenn OpenMol beim letzten Mal nicht ordentlich beendet wurde
 * (Absturz) und sie Inhalt hat. Beim normalen Start beginnt OpenMol mit einem leeren Dokument.
 */
export function crashRecovery(): { doc: Doc; name: string }[] | null {
  if (lsGet(SESSION_KEY) !== '1') return null
  const out: { doc: Doc; name: string }[] = []
  const d = loadAutosave()
  if (d && hasContent(d)) out.push({ doc: d, name: loadName() })
  try {
    const rest = JSON.parse(lsGet(AUTOSAVE_TABS_KEY) || '[]') as { doc: Doc; name: string }[]
    for (const t of rest) if (t?.doc?.atoms && t.doc.style) out.push({ doc: normalizeDoc(t.doc), name: t.name || 'Unbenannt' })
  } catch {
    // beschädigte Sicherung der übrigen Tabs – nur das aktive Dokument wiederherstellen
  }
  return out.length ? out : null
}

export function hasContent(d: Doc): boolean {
  return (['atoms', 'texts', 'arrows', 'curved', 'shapes', 'cycles', 'tables'] as const).some((k) => Object.keys(d[k] ?? {}).length)
}

/** „Sitzung läuft“ (1) bzw. „ordentlich beendet“ (0) – Grundlage für die Wiederherstellung nach einem Absturz */
const SESSION_KEY = 'openmol:session-open'
export function markSession(open: boolean) {
  lsSet(SESSION_KEY, open ? '1' : '0')
}

let state: State = {
  doc: emptyDoc(),
  sel: emptySelection(),
  tool: 'bond',
  opts: {
    bondType: 'single',
    ringSize: 6,
    ringAromatic: true,
    ringKind: 'regular',
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
    numNext: 1,
    numMark: '',
  },
  past: [],
  future: [],
  view: { zoom: 1, panX: 0, panY: 0 },
  hover: null,
  hotspot: null,
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
  fileName: 'Unbenannt',
  dirty: false,
  filePath: null,
  tabs: [],
  activeTab: '',
  wordTabs: {},
}
state.activeTab = uid('tab')
state.tabs = [snapshot(state, state.activeTab)]

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

function saveNow() {
  window.clearTimeout(saveTimer)
  saveTimer = undefined
  try {
    lsSet(AUTOSAVE_KEY, JSON.stringify(state.doc))
    lsSet(AUTOSAVE_KEY + ':name', state.fileName)
  } catch {
    // Speicher voll oder gesperrt – Autosave ist nur eine Komfortfunktion
  }
}

function scheduleSave() {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(saveNow, 400)
}

// Geht das Fenster in den Hintergrund, sofort sichern: verdeckte Fenster bremsen Timer stark aus, die verzögerte
// Sicherung käme sonst womöglich erst spät (wichtig für die Wiederherstellung nach einem Absturz)
const flushSave = () => {
  if (saveTimer !== undefined) saveNow()
}
window.addEventListener('blur', flushSave)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushSave()
})

const MAX_HISTORY = 200

/** Änderung mit Undo-Eintrag */
/** neues leeres Dokument (mit dem Standard-Dokumentstil aus den Einstellungen, siehe main.tsx) */
let newDocFactory: () => Doc = emptyDoc
export function setNewDocFactory(f: () => Doc) {
  newDocFactory = f
}

/** läuft am Ende jedes commit im selben Schritt (gleicher Rückgängig-Schritt), z. B. Abgleich Pfeil ↔ Ansatztabelle */
let commitHook: ((d: Doc, before: Doc) => void) | null = null
/** f(d, before): d = Entwurf nach der Änderung, before = Stand davor */
export function setCommitHook(f: ((d: Doc, before: Doc) => void) | null) {
  commitHook = f
}

export function commit(recipe: (d: Doc) => void | Selection, opts: { keepSel?: boolean } = {}) {
  let newSel: Selection | undefined
  const next = produce(state.doc, (d) => {
    const r = recipe(d as Doc)
    commitHook?.(d as Doc, state.doc)
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
  flushEditing()
  state = {
    ...state,
    doc,
    past: [...state.past, state.doc],
    future: [],
    sel: emptySelection(),
    hotspot: null,
    editing: null,
    fileName: fileName ?? state.fileName,
    dirty: false,
  }
  scheduleSave()
  emit()
}

// ---------- Tabs ----------

/** offener Editor auf der Zeichenfläche (Text, Beschriftung …): vor einem Dokumentwechsel sofort übernehmen – sonst
 *  speichert er erst nach dem Wechsel und schriebe ins falsche Dokument */
let editFlush: (() => void) | null = null
export function registerEditFlush(f: () => void): () => void {
  editFlush = f
  return () => {
    if (editFlush === f) editFlush = null
  }
}
function flushEditing() {
  const f = editFlush
  editFlush = null
  f?.()
}

function snapshot(s: State, id: Id): TabData {
  return { id, doc: s.doc, past: s.past, future: s.future, sel: s.sel, view: s.view, fileName: s.fileName, dirty: s.dirty, filePath: s.filePath }
}

/** alle Tabs mit aktuellem Stand (auch des aktiven) */
export function allTabs(): TabData[] {
  return state.tabs.map((t) => (t.id === state.activeTab ? snapshot(state, t.id) : t))
}

/** Tab-Daten in den Zustand laden (vorübergehende Zustände wie Hover, Bearbeiten, Menüs enden) */
function load(tabs: TabData[], t: TabData) {
  if (txBase) {
    state = { ...state, doc: txBase }
    txBase = null
  }
  state = {
    ...state,
    tabs,
    activeTab: t.id,
    doc: t.doc,
    past: t.past,
    future: t.future,
    sel: t.sel,
    view: t.view,
    fileName: t.fileName,
    dirty: t.dirty,
    filePath: t.filePath,
    hover: null,
    hotspot: null,
    editing: null,
    contextMenu: null,
    tableEditor: null,
  }
  scheduleSave()
  saveOtherTabs()
  emit()
}

/** neuen Tab hinter dem aktiven öffnen (leer oder mit einem Dokument) und aktivieren */
export function openTab(init: { doc?: Doc; fileName?: string; filePath?: string | null; dirty?: boolean } = {}) {
  flushEditing()
  const tabs = allTabs()
  const t: TabData = {
    id: uid('tab'),
    doc: init.doc ?? newDocFactory(),
    past: [],
    future: [],
    sel: emptySelection(),
    view: { ...state.view },
    fileName: init.fileName ?? 'Unbenannt',
    dirty: init.dirty ?? false,
    filePath: init.filePath ?? null,
  }
  tabs.splice(tabs.findIndex((x) => x.id === state.activeTab) + 1, 0, t)
  load(tabs, t)
}

export function switchTab(id: Id) {
  if (id === state.activeTab) return
  flushEditing()
  const tabs = allTabs()
  const t = tabs.find((x) => x.id === id)
  if (t) load(tabs, t)
}

/** Nachbar-Tab aktivieren (+1 = nächster, −1 = vorheriger; am Ende geht es vorn weiter) */
export function cycleTab(step: number) {
  const i = state.tabs.findIndex((t) => t.id === state.activeTab)
  const n = state.tabs.length
  if (n > 1) switchTab(state.tabs[(i + step + n) % n].id)
}

/** Tab ohne Rückfrage entfernen; der letzte Tab wird durch ein leeres Dokument ersetzt */
export function removeTab(id: Id) {
  flushEditing()
  const all = allTabs()
  const i = all.findIndex((t) => t.id === id)
  if (i < 0) return
  const tabs = all.filter((t) => t.id !== id)
  if (!tabs.length) {
    const t: TabData = { id: uid('tab'), doc: newDocFactory(), past: [], future: [], sel: emptySelection(), view: state.view, fileName: 'Unbenannt', dirty: false, filePath: null }
    load([t], t)
  } else if (id === state.activeTab) load(tabs, tabs[Math.min(i, tabs.length - 1)])
  else {
    state = { ...state, tabs }
    saveOtherTabs()
    emit()
  }
}

/** Inhalte der nicht aktiven Tabs sichern (sie ändern sich nur beim Wechseln, Öffnen oder Schließen) */
function saveOtherTabs() {
  try {
    const rest = state.tabs.filter((t) => t.id !== state.activeTab && hasContent(t.doc)).map((t) => ({ name: t.fileName, doc: t.doc }))
    lsSet(AUTOSAVE_TABS_KEY, JSON.stringify(rest))
  } catch {
    // Speicher voll oder gesperrt – Autosave ist nur eine Komfortfunktion
  }
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
