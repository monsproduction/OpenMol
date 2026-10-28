// Kontextmenü (Rechtsklick auf die Zeichenfläche): die wichtigsten Befehle für die Auswahl bzw. – auf leerer Fläche –
// für das Dokument. Untermenüs öffnen sich beim Überfahren. Schließt bei Klick daneben, Escape oder Scrollen.
import { hasLocked, inGroup } from '../model/groups'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { selectionSize } from '../model/types'
import { ABBREVIATIONS, canonicalAbbrev } from '../model/abbrev'
import { chemLabel } from '../model/richtext'
import { clipboard, getState, setState, useStore } from '../store'
import {
  arrange,
  autoNumberAtoms,
  cleanStructure,
  clearAtomNumbers,
  contractGroups,
  createStoichTable,
  copySelection,
  deleteSelection,
  duplicateSelection,
  expandGroups,
  fitView,
  groupSelection,
  HIGHLIGHT_COLORS,
  lockSelection,
  ungroupSelection,
  unlockEverything,
  insertAnalysis,
  setHighlight,
  flip,
  pasteInternal,
  rotate,
  selectAll,
  selectWholeMolecules,
  toggleBold,
} from '../tools/actions'
import { cleanReaction } from '../tools/cleanup'
import { keyLabel } from '../i18n/i18n'

export interface MenuItem {
  label: string
  shortcut?: string
  /** kurze Erklärung (Tooltip) */
  tip?: string
  action?: () => void
  disabled?: boolean
  sub?: MenuItem[]
  /** Farbfeld vor dem Text (Textmarker-Farben) */
  swatch?: string
}
type Entry = MenuItem | 'sep'

const K = keyLabel

/** zusätzliche Einträge anderer Module (z. B. Analyse, Name ↔ Struktur), je nach Lage */
const extraProviders: ((ctx: { hasSel: boolean; hasAtoms: boolean; at: { x: number; y: number } }) => Entry[])[] = []
export function addContextMenuItems(p: (ctx: { hasSel: boolean; hasAtoms: boolean; at: { x: number; y: number } }) => Entry[]) {
  extraProviders.push(p)
}

function entries(at: { x: number; y: number }, pick: boolean): Entry[] {
  const { sel, doc } = getState()
  // Rechtsklick auf ein einzelnes Atom/eine Bindung: Aktionen für Moleküle gelten dem ganzen Molekül
  const mol = (f: () => unknown) => () => {
    if (pick) selectWholeMolecules()
    void f()
  }
  const hasSel = selectionSize(sel) > 0
  const hasAtoms = sel.atoms.length > 0
  // ausgewählte Atome mit auflösbarem Kürzel (OMe, CF3 …)
  const hasAbbrev = sel.atoms.some((id) => {
    const l = doc.atoms[id]?.label
    const k = l ? canonicalAbbrev(chemLabel(l)) : null
    return !!k && !ABBREVIATIONS[k]?.generic
  })
  const highlight: MenuItem = {
    label: 'Textmarker',
    tip: 'Atome, Bindungen und Texte farbig hinterlegen – wie mit einem Leuchtstift',
    sub: [
      ...HIGHLIGHT_COLORS.map((h) => ({ label: h.name, swatch: h.c, action: () => setHighlight(h.c) })),
      { label: 'Textmarker entfernen', action: () => setHighlight(undefined) },
    ],
  }
  const extra = extraProviders.flatMap((p) => p({ hasSel, hasAtoms, at }))
  if (!hasSel) {
    return [
      { label: 'Einfügen', shortcut: K('⌘V'), action: () => void pasteInternal(at), disabled: !clipboard.data, tip: 'Kopiertes hier einfügen' },
      { label: 'Alles auswählen', shortcut: K('⌘A'), action: selectAll },
      ...(hasLocked(doc) ? [{ label: 'Alle entsperren', shortcut: K('⇧⌘L'), action: unlockEverything, tip: 'Gesperrte Objekte wieder anklickbar und verschiebbar machen' } as MenuItem] : []),
      'sep',
      {
        label: 'Name → Struktur …',
        tip: 'Verbindung per Namen suchen (PubChem) und hier einfügen',
        action: () => setState({ dialog: 'import', importAt: at }),
      },
      ...(extra.length ? (['sep', ...extra] as Entry[]) : []),
      'sep',
      { label: 'Reaktion aufräumen', action: cleanReaction, tip: 'Moleküle, Pfeile und Bedingungen ordentlich ausrichten' },
      { label: 'Ansicht einpassen', action: () => fitView() },
    ]
  }
  return [
    { label: 'Ausschneiden', shortcut: K('⌘X'), action: () => copySelection(true) },
    { label: 'Kopieren', shortcut: K('⌘C'), action: () => copySelection(false) },
    { label: 'Duplizieren', shortcut: K('⌘D'), action: duplicateSelection },
    { label: 'Löschen', shortcut: '⌫', action: deleteSelection },
    'sep',
    inGroup(doc, sel)
      ? { label: 'Gruppierung aufheben', shortcut: K('⇧⌘G'), action: ungroupSelection }
      : { label: 'Gruppieren', shortcut: K('⌘G'), action: groupSelection, tip: 'Als eine Einheit auswählen und verschieben (z. B. Molekül mit Beschriftung, Pfeil und Bedingungen)' },
    { label: 'Sperren', shortcut: K('⌘L'), action: lockSelection, tip: 'Nicht mehr anklickbar oder verschiebbar, bis „Alle entsperren“ (⇧⌘L)' },
    ...(hasLocked(doc) ? [{ label: 'Alle entsperren', shortcut: K('⇧⌘L'), action: unlockEverything } as MenuItem] : []),
    'sep',
    {
      label: 'Ebene',
      tip: 'Reihenfolge übereinanderliegender Objekte',
      sub: [
        { label: 'Ganz nach vorne', shortcut: K('⇧⌘F'), action: mol(() => arrange('front')) },
        { label: 'Eine Ebene nach vorne', shortcut: K('⌥⇧⌘F'), action: mol(() => arrange('forward')) },
        { label: 'Eine Ebene nach hinten', shortcut: K('⌥⇧⌘B'), action: mol(() => arrange('backward')) },
        { label: 'Ganz nach hinten', shortcut: K('⇧⌘B'), action: mol(() => arrange('back')) },
      ],
    },
    {
      label: 'Drehen & Spiegeln',
      sub: [
        { label: 'Horizontal spiegeln', action: mol(() => flip('h')) },
        { label: 'Vertikal spiegeln', action: mol(() => flip('v')) },
        { label: 'Um 90° im Uhrzeigersinn drehen', action: mol(() => rotate(90)) },
        { label: 'Um 90° gegen den Uhrzeigersinn drehen', action: mol(() => rotate(-90)) },
      ],
    },
    { label: 'Fett', shortcut: K('⌘B'), action: () => void toggleBold() },
    ...(hasAtoms || sel.texts.length ? [highlight] : []),
    // markierte Reaktion (mit Reaktionspfeil): Ansatztabelle direkt von hier
    ...(sel.arrows.length
      ? (['sep', { label: 'Ansatztabelle erstellen', tip: 'Stöchiometrische Ansatztabelle aus der markierten Reaktion', action: createStoichTable }] as Entry[])
      : []),
    ...(hasAtoms
      ? ([
          'sep',
          { label: 'Struktur → Name', tip: 'Namen der Verbindung (PubChem) als Text unter das Molekül setzen', action: mol(() => insertAnalysis(['name'])) },
          {
            label: 'Analyse',
            tip: 'Werte als Text unter das Molekül setzen',
            sub: [
              { label: 'Name', action: mol(() => insertAnalysis(['name'])) },
              { label: 'Summenformel', action: mol(() => insertAnalysis(['formula'])) },
              { label: 'Exakte Masse', action: mol(() => insertAnalysis(['exact'])) },
              { label: 'Molekulargewicht', action: mol(() => insertAnalysis(['mw'])) },
              { label: 'Isotopenmuster', action: mol(() => insertAnalysis(['isotopes'])) },
              'sep',
              { label: 'Atome nummerieren', tip: 'Nach vereinfachten IUPAC-Regeln (für NMR-Zuordnungen) – Vorschlag, bitte prüfen', action: mol(autoNumberAtoms) },
              { label: 'Atomnummern entfernen', action: mol(clearAtomNumbers) },
              { label: 'Name, Formel und Massen', action: mol(() => insertAnalysis(['name', 'formula', 'exact', 'mw'])) },
            ],
          },
          'sep',
          { label: 'Struktur bereinigen', action: mol(cleanStructure), tip: 'Regelmäßige Ringe, ideale Winkel, keine Überlappungen' },
          { label: 'Kürzel bilden', action: mol(contractGroups), tip: 'Gezeichnete Gruppen als OMe, CF3, tBu … zusammenfassen' },
          { label: 'Kürzel auflösen', action: expandGroups, disabled: !hasAbbrev, tip: 'OMe, CF3, tBu … wieder als einzelne Atome zeichnen' },
        ] as Entry[])
      : []),
    ...(extra.length ? (['sep', ...extra] as Entry[]) : []),
  ]
}

export function ContextMenu() {
  const cm = useStore((s) => s.contextMenu)
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [openSub, setOpenSub] = useState<number | null>(null)

  useEffect(() => {
    if (!cm) return
    setOpenSub(null)
    const close = (e: Event) => {
      if (e instanceof MouseEvent && box.current?.contains(e.target as Node)) return
      setState({ contextMenu: null })
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setState({ contextMenu: null })
      }
    }
    document.addEventListener('mousedown', close, true)
    document.addEventListener('wheel', close, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('mousedown', close, true)
      document.removeEventListener('wheel', close, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', close)
    }
  }, [cm])

  // im Fenster halten
  useLayoutEffect(() => {
    if (!cm || !box.current) return setPos(null)
    const r = box.current.getBoundingClientRect()
    setPos({ x: Math.min(cm.x, window.innerWidth - r.width - 6), y: Math.min(cm.y, window.innerHeight - r.height - 6) })
  }, [cm])

  if (!cm) return null
  const list = entries(cm.at, !!cm.pick)
  const run = (it: MenuItem) => {
    if (it.disabled || !it.action) return
    setState({ contextMenu: null })
    it.action()
  }
  return (
    <div className="ctx-menu" ref={box} style={{ left: pos?.x ?? cm.x, top: pos?.y ?? cm.y, visibility: pos ? 'visible' : 'hidden' }} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {list.map((it, i) =>
        it === 'sep' ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <div
            key={i}
            role="menuitem"
            aria-disabled={it.disabled || undefined}
            className={'ctx-item' + (it.disabled ? ' disabled' : '') + (it.sub ? ' has-sub' : '') + (openSub === i ? ' open' : '')}
            data-tip={it.tip}
            onMouseEnter={() => setOpenSub(it.sub ? i : null)}
            onClick={() => (it.sub ? setOpenSub(i) : run(it))}
          >
            <span className="ctx-label">{it.label}</span>
            {it.shortcut && <span className="ctx-key">{it.shortcut}</span>}
            {it.sub && <span className="ctx-arrow">›</span>}
            {it.sub && openSub === i && (
              <div className="ctx-menu ctx-sub" role="menu">
                {it.sub.map((s, j) => (
                  <div
                    key={j}
                    role="menuitem"
                    className={'ctx-item' + (s.disabled ? ' disabled' : '')}
                    data-tip={s.tip}
                    onClick={(e) => {
                      e.stopPropagation()
                      run(s)
                    }}
                  >
                    {s.swatch && <span className="ctx-swatch" style={{ background: s.swatch }} />}
                    <span className="ctx-label">{s.label}</span>
                    {s.shortcut && <span className="ctx-key">{s.shortcut}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ),
      )}
    </div>
  )
}
