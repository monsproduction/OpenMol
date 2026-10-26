import { deleteItems, translateSelection } from '../model/ops'
import { emptySelection, selectionSize } from '../model/types'
import type { Doc, Id } from '../model/types'
import { parseRich, serializeRich, type Run } from '../model/richtext'
import { clipboard, commit, getState, redo, setState, setTool, toast, toggleInspector, undo, type Hotspot } from '../store'
import {
  arrange,
  groupSelection,
  lockSelection,
  ungroupSelection,
  unlockEverything,
  toggleBold,
  cleanStructure,
  copySelection,
  deleteSelection,
  duplicateSelection,
  fitView,
  insertStructureText,
  pasteInternal,
  rotate,
  rotate3D,
  selectAll,
  toggle3D,
  viewCenter,
} from './actions'
import { cleanReaction } from './cleanup'
import { ATOM_KEYS, BOND_KEYS, atomHotkey, bondHotkey, grabHotspot, hotspotFromSelection, liveHotspot, moveHotspot, reactionShortcut, selectHotspotMolecule } from './hotkeys'
import { openFile, printDocument, saveDocument } from './io'
import { decodeClipPayload, findClipPayload } from './clipData'
import { desktop } from '../desktop'
import { T } from '../i18n/i18n'

const ELEMENT_KEYS: Record<string, string> = {
  c: 'C',
  n: 'N',
  o: 'O',
  s: 'S',
  p: 'P',
  f: 'F',
  h: 'H',
  i: 'I',
  l: 'Cl',
  b: 'Br',
  k: 'K',
}

/**
 * Element setzen. C auf einem (unbeschrifteten) C-Atom schaltet dessen Beschriftung ein bzw. wieder aus –
 * nur für dieses Atom; alle anderen C-Atome bleiben unsichtbar.
 */
function setElement(d: Doc, ids: Id[], el: string) {
  const atoms = ids.map((id) => d.atoms[id]).filter(Boolean)
  if (el === 'C' && atoms.every((a) => a.element === 'C' && !a.label)) {
    const on = !atoms.every((a) => a.showC)
    for (const a of atoms) a.showC = on || undefined
    return
  }
  for (const a of atoms) {
    a.element = el
    a.label = undefined
    a.literal = undefined
    a.showC = undefined
  }
}

const ARROW_DIR: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}

let lastPointer: { x: number; y: number } | null = null
/** Mausposition beim Setzen des Hotspots: bewegt sich die Maus deutlich weg, endet der Hotspot – dann gelten die
 *  Buchstaben wieder als Werkzeug-Tasten (A = Pfeil, V = Auswahl …). Beim Tippen von Sequenzen steht die Maus still. */
let hotspotAnchor: { x: number; y: number } | null = null
const HOTSPOT_MOVE_PX = 48

export function trackPointer(p: { x: number; y: number } | null) {
  lastPointer = p
  const st = getState()
  if (!st.hotspot || !p) return
  if (!hotspotAnchor) hotspotAnchor = p
  else if (Math.hypot(p.x - hotspotAnchor.x, p.y - hotspotAnchor.y) * st.view.zoom > HOTSPOT_MOVE_PX) {
    hotspotAnchor = null
    setState({ hotspot: null })
  }
}

/** Objekt unter der Maus beim Setzen des Hotspots */
let hoverAtSet: string | null = null
const hoverKey = (h: Hotspot) => (h ? h.kind + ':' + h.id : null)

function setHotspot(h: Hotspot) {
  hotspotAnchor = lastPointer
  const hv = getState().hover
  hoverAtSet = hv?.kind === 'atom' || hv?.kind === 'bond' ? hoverKey({ kind: hv.kind, id: hv.id }) : null
  setState({ hotspot: h })
}

export function handleKeyDown(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
  const st = getState()
  if (st.dialog) return
  const mod = e.metaKey || e.ctrlKey
  const k = e.key

  if (mod) {
    const lk = k.toLowerCase()
    // ⌘ + Pfeiltaste: Reaktions-Kürzel (Kopie der markierten Moleküle hinter einem neuen Reaktionspfeil, wie ChemDraw)
    if (k.startsWith('Arrow') && !e.shiftKey && !e.altKey && st.sel.atoms.length) {
      e.preventDefault()
      reactionShortcut(ARROW_DIR[k])
      return
    }
    // Anordnung wie in Keynote: ⇧⌘F/⇧⌘B ganz nach vorn/hinten, mit ⌥ eine Ebene (über e.code, da ⌥ die Taste verändert)
    if (e.shiftKey && (e.code === 'KeyF' || e.code === 'KeyB') && selectionSize(st.sel)) {
      e.preventDefault()
      arrange(e.code === 'KeyF' ? (e.altKey ? 'forward' : 'front') : e.altKey ? 'backward' : 'back')
      return
    }
    // ⇧⌘K Struktur aufräumen · ⇧⌘X Reaktion aufräumen · ⇧⌘D 2D ↔ 3D (wie ChemDraw; über e.code, Shift ändert die Taste)
    if (e.shiftKey && !e.altKey && (e.code === 'KeyK' || e.code === 'KeyX' || e.code === 'KeyD')) {
      e.preventDefault()
      if (e.code === 'KeyK') cleanStructure()
      else if (e.code === 'KeyX') cleanReaction()
      else toggle3D()
      return
    }
    // ⌘G gruppieren / ⇧⌘G auflösen · ⌘L sperren / ⇧⌘L alle entsperren (über e.code, Shift ändert die Taste)
    if (!e.altKey && (e.code === 'KeyG' || e.code === 'KeyL')) {
      e.preventDefault()
      if (e.code === 'KeyG') (e.shiftKey ? ungroupSelection : groupSelection)()
      else (e.shiftKey ? unlockEverything : lockSelection)()
      return
    }
    if (lk === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    } else if (lk === 'y') {
      e.preventDefault()
      redo()
    } else if (lk === 'a') {
      e.preventDefault()
      selectAll()
      setTool('select')
    } else if (lk === 'c') {
      if (selectionSize(st.sel)) {
        e.preventDefault()
        copySelection(false)
      }
    } else if (lk === 'x') {
      if (selectionSize(st.sel)) {
        e.preventDefault()
        copySelection(true)
      }
    } else if (lk === 'b' && !e.shiftKey && selectionSize(st.sel)) {
      // fett für alle ausgewählten Objekte (Atome samt Ladungen/Elektronen, Texte, Pfeile, Klammern, Zyklen …)
      e.preventDefault()
      toggleBold()
    } else if (lk === 'i' && (st.sel.atoms.length || st.sel.texts.length)) {
      // ausgewählte Atome/Texte kursiv umschalten
      e.preventDefault()
      const on = !(st.sel.atoms.every((id) => st.doc.atoms[id]?.italic) && st.sel.texts.every((id) => st.doc.texts[id]?.italic))
      commit((d) => {
        for (const id of st.sel.atoms) d.atoms[id].italic = on || undefined
        for (const id of st.sel.texts) d.texts[id].italic = on || undefined
      })
    } else if (lk === 'd') {
      e.preventDefault()
      duplicateSelection()
    } else if (lk === 's') {
      e.preventDefault()
      void saveDocument(e.shiftKey)
    } else if (lk === 'o') {
      e.preventDefault()
      void openFile()
    } else if (lk === 'e') {
      e.preventDefault()
      setState({ dialog: 'export' })
    } else if (lk === 'p' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      void printDocument()
    } else if (lk === '0') {
      e.preventDefault()
      fitView()
    } else if (k === ',') {
      e.preventDefault()
      setState({ dialog: 'settings' })
    } else if (k === '\\' || e.code === 'Backslash') {
      // Inspektor ein-/ausblenden
      e.preventDefault()
      toggleInspector()
    }
    // ⌘V wird über das paste-Ereignis behandelt
    return
  }

  const hover = st.hover
  // ---- ChemDraw-Hotkeys: über einem Atom/einer Bindung oder – ohne Auswahl – am Hotspot. Steht die Maus noch über
  // demselben Objekt wie beim Setzen des Hotspots, gilt der Hotspot (so lassen sich Sequenzen wie „a1o“ tippen) ----
  const hs = selectionSize(st.sel) ? null : liveHotspot(st.doc, st.hotspot)
  const hoverObj: Hotspot = hover?.kind === 'atom' || hover?.kind === 'bond' ? { kind: hover.kind, id: hover.id } : null
  const overAtomOrBond = !!hoverObj && (!hs || hoverKey(hoverObj) !== hoverAtSet)
  const tgt: Hotspot = overAtomOrBond ? hoverObj : hs
  if (tgt && !e.altKey && k.length === 1) {
    if (k === 'g') {
      // „grab“: Atom bzw. Bindung markieren
      e.preventDefault()
      grabHotspot(tgt)
      return
    }
    const keys = tgt.kind === 'atom' ? ATOM_KEYS : BOND_KEYS
    if (keys.has(k)) {
      e.preventDefault()
      let next: Hotspot | false = false
      commit((d) => {
        next = tgt.kind === 'atom' ? atomHotkey(d, tgt.id, k) : bondHotkey(d, tgt.id, k)
      })
      if (next !== false) setHotspot(next)
      return
    }
  }
  // ---- weitere Tasten über einem Atom (bzw. am Hotspot-Atom) ----
  const atomTgt = tgt?.kind === 'atom' ? tgt.id : null
  if (atomTgt && !e.altKey) {
    const id = atomTgt
    if (overAtomOrBond && /^[a-zA-Z]$/.test(k)) {
      // andere Buchstaben: genau dieser Buchstabe als Beschriftung (z. B. R für einen Rest, X, T …)
      e.preventDefault()
      const letter = k.toUpperCase()
      commit((d) => {
        const a = d.atoms[id]
        if (!a) return
        a.element = 'C'
        a.label = letter
        a.literal = undefined
        a.showC = undefined
      })
      setHotspot({ kind: 'atom', id })
      return
    }
    if (k === '*') {
      // Stereozentrum markieren / Markierung entfernen
      e.preventDefault()
      commit((d) => {
        const a = d.atoms[id]
        a.stereoMark = !a.stereoMark || undefined
        if (!a.stereoMark) a.stereoOff = undefined
      })
      return
    }
    if (k === '+' || k === '=' || k === '-' || k === '−') {
      e.preventDefault()
      commit((d) => {
        d.atoms[id].charge += k === '+' || k === '=' ? 1 : -1
      })
      return
    }
    if (k === '.') {
      commit((d) => {
        const a = d.atoms[id]
        a.radical = (a.radical + 1) % 3
      })
      return
    }
    if (k === ':') {
      commit((d) => {
        const a = d.atoms[id]
        a.lonePairs = (a.lonePairs + 1) % 5
      })
      return
    }
    if (k === 'Enter') {
      e.preventDefault()
      setState({ editing: { kind: 'atom', id } })
      return
    }
    if ((k === 'Delete' || k === 'Backspace') && overAtomOrBond) {
      e.preventDefault()
      commit((d) => deleteItems(d, { ...emptySelection(), atoms: [id] }))
      setState({ hover: null, hotspot: null })
      return
    }
  }
  // ---- Element-Taste bei markierten Atomen (ohne Maus darüber); Werkzeug-Tasten (H, K …) bleiben Werkzeuge ----
  if (!hover && !mod && !e.altKey && k.length === 1 && st.sel.atoms.length && !st.sel.texts.length && !st.sel.arrows.length) {
    const lower = k.toLowerCase()
    if (ELEMENT_KEYS[lower] && lower !== 'h' && lower !== 'k') {
      e.preventDefault()
      const el = e.shiftKey && lower === 'c' ? 'Cl' : e.shiftKey && lower === 'b' ? 'B' : ELEMENT_KEYS[lower]
      const ids = st.sel.atoms
      commit((d) => setElement(d, ids, el))
      return
    }
  }
  // ---- Entf über einer Bindung ----
  if (hover?.kind === 'bond' && (k === 'Delete' || k === 'Backspace')) {
    e.preventDefault()
    commit((d) => deleteItems(d, { ...emptySelection(), bonds: [hover.id] }))
    setState({ hover: null, hotspot: null })
    return
  }

  // ---- Allgemein ----
  if (k === 'Delete' || k === 'Backspace') {
    e.preventDefault()
    if (selectionSize(st.sel)) deleteSelection()
    else if (hover) {
      const s = emptySelection()
      if (hover.kind === 'arrow') s.arrows.push(hover.id)
      if (hover.kind === 'curved') s.curved.push(hover.id)
      if (hover.kind === 'text') s.texts.push(hover.id)
      if (hover.kind === 'shape') s.shapes.push(hover.id)
      if (hover.kind === 'table') s.tables.push(hover.id)
      if (hover.kind === 'cycle') s.cycles.push(hover.id)
      if (selectionSize(s)) {
        setState({ sel: s })
        deleteSelection()
        setState({ hover: null })
      }
    }
    return
  }
  if (k === 'Enter' && !hover) {
    // Molekül → Hotspot (wie ChemDraw): aus der Auswahl wird der Hotspot; am Hotspot-Atom: Beschriftung bearbeiten
    if (selectionSize(st.sel)) {
      const next = hotspotFromSelection(st.doc, st.sel)
      if (next) {
        e.preventDefault()
        setState({ sel: emptySelection() })
        setHotspot(next)
        return
      }
    } else if (hs?.kind === 'atom') {
      e.preventDefault()
      setState({ editing: { kind: 'atom', id: hs.id } })
      return
    }
  }
  if ((k === ' ' || k === 'Tab') && hs && !e.repeat) {
    // Hotspot → Molekül: ganzes Molekül markieren
    e.preventDefault()
    selectHotspotMolecule()
    return
  }
  if (k === 'Escape') {
    setState({ sel: emptySelection(), editing: null, hotspot: null })
    if (st.tool !== 'select') setTool('select')
    return
  }
  if (k.startsWith('Arrow') && selectionSize(st.sel)) {
    e.preventDefault()
    const dir = ARROW_DIR[k]
    if (e.altKey && e.shiftKey) {
      // ⇧⌥ + Pfeiltaste: echte 3D-Drehung (←/→ um die senkrechte, ↑/↓ um die waagerechte Achse)
      if (dir.x) rotate3D('y', 15 * dir.x)
      else rotate3D('x', -15 * dir.y)
    } else if (e.altKey) {
      // ⌥ + ←/→: um 15° drehen, ⌥ + ↑/↓: um 1° (Feinjustierung)
      rotate(dir.x ? 15 * dir.x : dir.y)
    } else {
      const step = e.shiftKey ? 10 : 1
      commit((d) => translateSelection(d, st.sel, dir.x * step, dir.y * step))
    }
    return
  }
  if (k.startsWith('Arrow') && hs) {
    // Hotspot zwischen Atomen und Bindungen weiterbewegen
    e.preventDefault()
    setState({ hotspot: moveHotspot(st.doc, hs, ARROW_DIR[k]) })
    return
  }
  if (e.altKey) return
  switch (k) {
    case 'v':
    case 'V':
      setTool('select')
      break
    case 'e':
    case 'E':
      setTool('eraser')
      break
    case '1':
      setTool('bond', { bondType: 'single' })
      break
    case '2':
      setTool('bond', { bondType: 'double' })
      break
    case '3':
      setTool('bond', { bondType: 'triple' })
      break
    case 'w':
    case 'W':
      setTool('bond', { bondType: 'wedge' })
      break
    case 'h':
    case 'H':
      setTool('bond', { bondType: 'hash' })
      break
    case 'k':
    case 'K':
      setTool('chain')
      break
    case 'r':
    case 'R':
    // J ebenfalls Benzol (über Atom/Bindung gelten die ChemDraw-Tasten oben)
    case 'j':
    case 'J':
      setTool('ring', { ringSize: 6, ringAromatic: true, ringKind: 'regular' })
      break
    case 'a':
    case 'A':
      setTool('arrow')
      break
    case 'm':
      setTool('curved', { curvedHead: 'full' })
      break
    case 'M':
      setTool('curved', { curvedHead: 'half' })
      break
    case 't':
    case 'T':
      setTool('text')
      break
    case '+':
      setTool('charge+')
      break
    case '-':
      setTool('charge-')
      break
    case '?':
      setState({ dialog: 'help' })
      break
  }
}

/**
 * Einfügen in ein Rich-Text-Feld (Pfeiltext, Text, Beschriftung): Text mit Fett/Kursiv/Unterstrichen/Hoch-/Tiefstellung
 * übernehmen; Schriftart, Farbe und Größe aus Word & Co. weglassen, damit der Text zum Dokumentstil passt
 */
function pasteIntoRichField(e: ClipboardEvent) {
  e.preventDefault()
  const html = e.clipboardData?.getData('text/html') ?? ''
  const text = e.clipboardData?.getData('text/plain') ?? ''
  const lines = html.trim() ? parseRich(html.replace(/<!--[\s\S]*?-->/g, '').replace(/&nbsp;/g, ' ')) : text.replace(/\r\n?/g, '\n').split('\n').map((l): Run[] => (l ? [{ t: l }] : []))
  const clean = serializeRich(lines.map((line) => line.map((r) => ({ t: r.t, b: r.b, i: r.i, u: r.u, sup: r.sup, sub: r.sub, f: r.f }))))
    .replace(/^\n+|\n+$/g, '')
    .replace(/\n/g, '<br>')
  if (clean) document.execCommand('insertHTML', false, clean)
}

/** Einfügen: interne Zwischenablage oder SMILES/Molfile aus der System-Zwischenablage */
export function handlePaste(e: ClipboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
  // Rich-Text-Felder bekommen den Text, nicht die Zeichenfläche
  if (t && (t.isContentEditable || t.closest?.('[contenteditable="true"], [contenteditable=""]'))) return pasteIntoRichField(e)
  if (getState().dialog) return
  const text = e.clipboardData?.getData('text/plain') ?? ''
  const html = e.clipboardData?.getData('text/html') ?? ''
  const images = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
  e.preventDefault()
  const at = lastPointer ?? viewCenter()
  // Bild mit OpenMol-Daten (z. B. aus Word zurückkopiert): wieder als bearbeitbare Zeichnung einfügen
  void (async () => {
    let payload = desktop ? await desktop.clipScan().catch(() => null) : null
    payload ??= findClipPayload(html)
    for (const f of images) {
      if (payload) break
      const bytes = new Uint8Array(await f.arrayBuffer())
      let s = ''
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      payload = findClipPayload(s)
    }
    const clip = payload ? await decodeClipPayload(payload) : null
    if (clip) {
      clipboard.data = clip
      clipboard.pasteCount = 0
      pasteInternal(at)
      toast(T('Als bearbeitbare Struktur eingefügt (OpenMol-Daten im Bild)'))
      return
    }
    pasteOrdinary(text, at)
  })()
}

/** Einfügen ohne OpenMol-Daten im Bild: eigene Zwischenablage, SMILES oder Molfile */
function pasteOrdinary(text: string, at: { x: number; y: number }) {
  // Wenn die System-Zwischenablage noch unseren eigenen SMILES-Export enthält → interne Daten (mit Pfeilen etc.)
  if (clipboard.data && (!text || text === clipboard.smiles)) {
    pasteInternal(at)
    return
  }
  if ((text.trim() && SMILES_LIKE.test(text.trim().split('\n')[0])) || text.includes('M  END')) {
    insertStructureText(text, at)
    return
  }
  if (clipboard.data) pasteInternal(at)
}

const SMILES_LIKE = /^[A-Za-z0-9@+\-[\]()=#$%/\\.*:]+$/

