import { deleteItems, linearizeTriples, translateSelection } from '../model/ops'
import { emptySelection, selectionSize } from '../model/types'
import type { Doc, Id } from '../model/types'
import { parseRich, serializeRich, type Run } from '../model/richtext'
import { clipboard, commit, getState, redo, setState, setTool, toggleInspector, undo } from '../store'
import {
  arrange,
  toggleBold,
  cleanStructure,
  copySelection,
  deleteSelection,
  duplicateSelection,
  fitView,
  insertStructureText,
  pasteInternal,
  selectAll,
  toggle3D,
  viewCenter,
} from './actions'
import { cleanReaction } from './cleanup'
import { openFile, saveDocument } from './io'

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

let lastPointer: { x: number; y: number } | null = null
export function trackPointer(p: { x: number; y: number } | null) {
  lastPointer = p
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
  // ---- Tasten über einem Atom ----
  if (hover?.kind === 'atom' && !e.altKey) {
    const id = hover.id
    const lower = k.length === 1 ? k.toLowerCase() : k
    if (ELEMENT_KEYS[lower] && k.length === 1) {
      e.preventDefault()
      // b = Brom, Umschalt+B = Bor; Umschalt+C = Chlor
      const el = e.shiftKey && lower === 'c' ? 'Cl' : e.shiftKey && lower === 'b' ? 'B' : ELEMENT_KEYS[lower]
      commit((d) => setElement(d, [id], el))
      return
    }
    if (/^[a-zA-Z]$/.test(k)) {
      // andere Buchstaben: genau dieser Buchstabe als Beschriftung (z. B. R für einen Rest, X, A, Z …)
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
    if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault()
      commit((d) => deleteItems(d, { ...emptySelection(), atoms: [id] }))
      setState({ hover: null })
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
  // ---- Tasten über einer Bindung ----
  if (hover?.kind === 'bond') {
    const id = hover.id
    const map: Record<string, 'single' | 'double' | 'triple' | 'wedge' | 'hash'> = { '1': 'single', '2': 'double', '3': 'triple', w: 'wedge', h: 'hash' }
    const bt = map[k.toLowerCase()]
    if (bt) {
      e.preventDefault()
      commit((d) => {
        const b = d.bonds[id]
        if ((bt === 'wedge' || bt === 'hash') && b.type === bt) {
          const tmp = b.a1
          b.a1 = b.a2
          b.a2 = tmp
        } else b.type = bt
        linearizeTriples(d, [b.a1, b.a2])
      })
      return
    }
    if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault()
      commit((d) => deleteItems(d, { ...emptySelection(), bonds: [id] }))
      setState({ hover: null })
      return
    }
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
  if (k === 'Enter' && st.sel.atoms.length === 1 && !hover) {
    // ausgewähltes Atom beschriften
    e.preventDefault()
    setState({ editing: { kind: 'atom', id: st.sel.atoms[0] } })
    return
  }
  if (k === 'Escape') {
    setState({ sel: emptySelection(), editing: null })
    if (st.tool !== 'select') setTool('select')
    return
  }
  if (k.startsWith('Arrow') && selectionSize(st.sel)) {
    e.preventDefault()
    const step = e.shiftKey ? 10 : 1
    const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0
    const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0
    commit((d) => translateSelection(d, st.sel, dx, dy))
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
      setTool('ring', { ringSize: 6, ringAromatic: true })
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
  e.preventDefault()
  const at = lastPointer ?? viewCenter()
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

