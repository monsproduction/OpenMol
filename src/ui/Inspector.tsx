import { useEffect, useMemo, useRef, useState } from 'react'
import { linearizeTriples, selectionAtomIds } from '../model/ops'
import { analyze, smilesToName, stereoCenters } from '../model/ocl'
import { isotopePattern } from '../model/isotopePattern'
import { hasLocked, inGroup } from '../model/groups'
import type { ArrowKind, ArrowRoute, BondType, Cycle, DocStyle, DoublePos, Shape, ShapeKind } from '../model/types'
import { CLOSED_SHAPES, FONTS, STYLE_PRESETS, emptySelection, selectionSize } from '../model/types'
import type { FillStyle } from '../model/rings'
import { arrowTextOpts, getScene, textBox } from '../model/scene'
import { FillOptions } from './FillOptions'
import { RichField } from './RichEditor'
import { applyAtomRich, applyAtomText, defaultBend } from '../render/Canvas'
import { NumSlider } from './NumSlider'
import { TABLE_FONT_FACTOR } from '../model/stoichLayout'
import { isRichLabel, richPlain, richToSymbolGreek } from '../model/richtext'
import { attachCycle, newArcLabel, newBranch, redistribute, stationHalfGaps, stationLabelSize } from '../model/cycle'
import {
  arrange,
  groupSelection,
  lockSelection,
  ungroupSelection,
  unlockEverything,
  bracketSelection,
  contractGroups,
  createStoichTable,
  expandGroups,
  fitCycleGaps,
  HIGHLIGHT_COLORS,
  lookupSelection,
  selectionBold,
  setHighlight,
  setPageFormat,
  fitSheet,
  trimPages,
  toggleBold,
} from '../tools/actions'
import { analyzePolymer, polymerUnits, type PolymerUnit } from '../model/polymer'
import { PAGE_FORMATS } from '../model/pages'
import { commit, setState, toast, useStore } from '../store'
import { fmtDec, useSettings } from '../settings'
import { fmtLetters } from '../i18n/i18n'
import { Icon } from './Icons'
import { moveSection, useSectionOrder, type SectionId } from './inspectorOrder'

const COLORS = ['#111418', '#d42a2a', '#2547d0', '#1f8f4e', '#d67a00', '#7a2fa0', '#8a8f98']
const BG_COLORS = ['#e8574f', '#f5dc3c', '#9fd3a8', '#a9c4ff', '#e3e6ec', '#ffffff']

function BgPick({ value, onChange }: { value: string | undefined; onChange: (c: string | undefined) => void }) {
  return (
    <div className="colors">
      <button className={'swatch none' + (!value ? ' active' : '')} onClick={() => onChange(undefined)} aria-label="Kein Hintergrund" />
      {BG_COLORS.map((c) => (
        <button key={c} className={'swatch' + (value === c ? ' active' : '')} style={{ background: c }} onClick={() => onChange(c)} aria-label={'Hintergrund ' + c} />
      ))}
      <input type="color" value={value ?? '#ffffff'} onChange={(e) => onChange(e.target.value)} aria-label="Eigene Hintergrundfarbe" />
    </div>
  )
}

const DOC_BG_COLORS = ['#f4f5f7', '#fbf6e9', '#eaf1fb', '#eef7ef', '#1e2026', '#000000']

/** Hintergrund des Dokuments: weiß (Standard) oder eine Farbe – gilt für Zeichenfläche, PNG und SVG */
function DocBgPick({ value, onChange }: { value: string | undefined; onChange: (c: string | undefined) => void }) {
  return (
    <div className="colors">
      <button className={'swatch' + (!value ? ' active' : '')} style={{ background: '#ffffff' }} onClick={() => onChange(undefined)} data-tip="Weiß (Standard)" aria-label="Weiß (Standard)" />
      {DOC_BG_COLORS.map((c) => (
        <button key={c} className={'swatch' + (value === c ? ' active' : '')} style={{ background: c }} onClick={() => onChange(c)} aria-label={'Hintergrund ' + c} />
      ))}
      <input type="color" value={value ?? '#ffffff'} onChange={(e) => onChange(e.target.value === '#ffffff' ? undefined : e.target.value)} aria-label="Eigene Hintergrundfarbe" />
    </div>
  )
}

/** sichtbare Kategorien in angezeigter Reihenfolge */
function visibleSections(el: HTMLElement): HTMLElement[] {
  const aside = el.closest('.inspector')
  if (!aside) return []
  return [...aside.querySelectorAll<HTMLElement>(':scope > .insp-section')].sort((a, b) => Number(a.style.order) - Number(b.style.order))
}

/**
 * Kategorie an der Überschrift ziehen (Zeiger-Ereignisse statt HTML-Drag&Drop – das ist bei Knöpfen nicht in allen
 * Browsern verlässlich). Erst ab 5 px Bewegung wird gezogen, ein einfacher Klick klappt weiter auf/zu.
 */
function dragSection(e: React.PointerEvent, sec: HTMLElement, id: SectionId, suppressClick: { current: boolean }) {
  if (e.button !== 0) return
  const x0 = e.clientX
  const y0 = e.clientY
  const aside = sec.closest<HTMLElement>('.inspector')
  let active = false
  let target: { id: SectionId; after: boolean } | null = null
  const clear = () => aside?.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'))
  const move = (ev: PointerEvent) => {
    if (!active) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
      active = true
      sec.classList.add('dragging')
      document.body.classList.add('dragging-section')
    }
    // am Rand der Leiste weiterscrollen
    if (aside) {
      const r = aside.getBoundingClientRect()
      if (ev.clientY < r.top + 30) aside.scrollTop -= 12
      else if (ev.clientY > r.bottom - 30) aside.scrollTop += 12
    }
    clear()
    target = null
    const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('.insp-section')
    if (!over || over === sec || over.parentElement !== sec.parentElement) return
    const r = over.getBoundingClientRect()
    const after = ev.clientY > r.top + r.height / 2
    target = { id: over.dataset.sec as SectionId, after }
    over.classList.add(after ? 'drop-after' : 'drop-before')
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    clear()
    sec.classList.remove('dragging')
    document.body.classList.remove('dragging-section')
    if (!active) return
    // ein direkt folgender Klick (Loslassen über der Überschrift) klappt nicht auf/zu; endet das Ziehen woanders,
    // kommt kein Klick – dann darf die Sperre den nächsten echten Klick nicht schlucken
    suppressClick.current = true
    setTimeout(() => (suppressClick.current = false), 0)
    if (target) moveSection(id, target.id, target.after)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}

function Section({ id, title, children, defaultOpen = true }: { id: SectionId; title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const ref = useRef<HTMLElement>(null)
  const dragged = useRef(false)
  const order = useSectionOrder()
  // ⌥↑/⌥↓ auf der Überschrift: eine Kategorie nach oben/unten
  const step = (dir: -1 | 1) => {
    const vis = visibleSections(ref.current!).map((x) => x.dataset.sec as SectionId)
    const other = vis[vis.indexOf(id) + dir]
    if (other) moveSection(id, other, dir > 0)
  }
  return (
    <section ref={ref} data-sec={id} style={{ order: order.indexOf(id) }} className={'insp-section' + (open ? ' open' : '')}>
      <button
        className="insp-head"
        onPointerDown={(e) => ref.current && dragSection(e, ref.current, id, dragged)}
        onClick={() => {
          if (!dragged.current) setOpen(!open)
        }}
        onKeyDown={(e) => {
          if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
          e.preventDefault()
          e.stopPropagation()
          step(e.key === 'ArrowUp' ? -1 : 1)
        }}
      >
        <span className="insp-grip" aria-hidden data-tip="Ziehen = Kategorie verschieben (oder ⌥↑ / ⌥↓)">
          ⠿
        </span>
        <span className="insp-title">{title}</span>
        <Icon name="chevron" size={16} />
      </button>
      {open && <div className="insp-body">{children}</div>}
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="insp-row">
      <label>{label}</label>
      <div className="insp-ctrl">{children}</div>
    </div>
  )
}

function Stepper({ value, onChange, min = -9, max = 9, fmt }: { value: number; onChange: (v: number) => void; min?: number; max?: number; fmt?: (v: number) => string }) {
  return (
    <div className="stepper">
      <button onClick={() => onChange(Math.max(min, value - 1))} aria-label="weniger">
        −
      </button>
      <span>{fmt ? fmt(value) : value}</span>
      <button onClick={() => onChange(Math.min(max, value + 1))} aria-label="mehr">
        +
      </button>
    </div>
  )
}

function Seg<T extends string>({ value, options, onChange }: { value: T | null; options: { v: T; label: string; icon?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.v} className={value === o.v ? 'active' : ''} onClick={() => onChange(o.v)} data-tip={o.label} aria-label={o.label}>
          {o.icon ? <Icon name={o.icon} size={16} /> : o.label}
        </button>
      ))}
    </div>
  )
}

function ColorPick({ value, onChange }: { value: string | undefined; onChange: (c: string | undefined) => void }) {
  return (
    <div className="colors">
      {COLORS.map((c) => (
        <button
          key={c}
          className={'swatch' + ((value ?? '#111418') === c ? ' active' : '')}
          style={{ background: c }}
          onClick={() => onChange(c === '#111418' ? undefined : c)}
          aria-label={'Farbe ' + c}
        />
      ))}
      <input type="color" value={value ?? '#111418'} onChange={(e) => onChange(e.target.value)} aria-label="Eigene Farbe" />
    </div>
  )
}

/** Textfeld, das erst beim Verlassen/Enter übernimmt (ein Undo-Schritt) */
function LazyText({ value, onCommit, multiline, placeholder, focusEvent }: { value: string; onCommit: (v: string) => void; multiline?: boolean; placeholder?: string; focusEvent?: string }) {
  const [v, setV] = useState(value)
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null)
  useEffect(() => setV(value), [value])
  // wie RichField: Klick außerhalb übernimmt sofort, beim Verschwinden des Feldes wird Getipptes noch übernommen
  const latest = useRef({ v, value, onCommit })
  latest.current = { v, value, onCommit }
  useEffect(() => {
    const flush = () => {
      const l = latest.current
      if (l.v !== l.value) l.onCommit(l.v)
    }
    const outside = (e: PointerEvent) => {
      if (ref.current && document.activeElement === ref.current && !ref.current.contains(e.target as Node)) flush()
    }
    document.addEventListener('pointerdown', outside, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      flush()
    }
  }, [])
  useEffect(() => {
    if (!focusEvent) return
    const f = () => ref.current?.focus()
    window.addEventListener(focusEvent, f)
    return () => window.removeEventListener(focusEvent, f)
  }, [focusEvent])
  const props = {
    ref,
    value: v,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: () => v !== value && onCommit(v),
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (v !== value) onCommit(v)
      }
    },
    spellCheck: false,
  }
  return multiline ? <textarea rows={2} {...props} /> : <input {...props} />
}

export function Inspector() {
  useSettings() // Dezimaltrennzeichen geändert → neu anzeigen
  const doc = useStore((s) => s.doc)
  const sel = useStore((s) => s.sel)
  const atoms = sel.atoms.map((id) => doc.atoms[id]).filter(Boolean)
  const bonds = sel.bonds.map((id) => doc.bonds[id]).filter(Boolean)
  const arrows = sel.arrows.map((id) => doc.arrows[id]).filter(Boolean)
  const curved = sel.curved.map((id) => doc.curved[id]).filter(Boolean)
  const texts = sel.texts.map((id) => doc.texts[id]).filter(Boolean)
  const shapes = sel.shapes.map((id) => doc.shapes[id]).filter(Boolean)
  const none = selectionSize(sel) === 0
  // ganze Moleküle markiert (Doppelklick): Bindungstyp für alle Bindungen auf einmal ist dann nicht sinnvoll
  const wholeMolecules = useMemo(() => {
    if (atoms.length < 2) return false
    const ids = new Set(sel.atoms)
    const g = getScene(doc).g
    return sel.atoms.every((id) => (g.adj.get(id) ?? []).every((nb) => ids.has(nb.other.id)))
  }, [doc, sel.atoms, atoms.length])

  const setAtoms = (f: (a: (typeof atoms)[0]) => void) =>
    commit((d) => {
      for (const a of atoms) f(d.atoms[a.id])
    })
  const setBonds = (f: (b: (typeof bonds)[0]) => void) =>
    commit((d) => {
      for (const b of bonds) f(d.bonds[b.id])
      linearizeTriples(d, bonds.flatMap((b) => [b.a1, b.a2]))
    })
  const setStyle = (p: Partial<DocStyle>) =>
    commit((d) => {
      d.style = { ...d.style, ...p }
    })
  const setColorAll = (c: string | undefined) =>
    commit((d) => {
      for (const a of atoms) d.atoms[a.id].color = c
      for (const b of bonds) d.bonds[b.id].color = c
      for (const a of arrows) d.arrows[a.id].color = c
      for (const a of curved) d.curved[a.id].color = c
      for (const t of texts) d.texts[t.id].color = c
      for (const s of shapes) d.shapes[s.id].color = c
      for (const y of cycles) d.cycles[y.id].color = c
    })

  const fills = (sel.fills ?? []).map((id) => doc.fills[id]).filter(Boolean)
  const cycles = (sel.cycles ?? []).map((id) => doc.cycles?.[id]).filter(Boolean)
  const firstHighlight = atoms[0]?.highlight ?? texts[0]?.highlight
  const firstOpacity = atoms[0]?.opacity ?? bonds[0]?.opacity ?? arrows[0]?.opacity ?? curved[0]?.opacity ?? texts[0]?.opacity ?? shapes[0]?.opacity ?? 1
  const setOpacityAll = (o: number) =>
    commit((d) => {
      const v = o >= 0.999 ? undefined : o
      for (const a of atoms) d.atoms[a.id].opacity = v
      for (const b of bonds) d.bonds[b.id].opacity = v
      for (const a of arrows) d.arrows[a.id].opacity = v
      for (const a of curved) d.curved[a.id].opacity = v
      for (const t of texts) d.texts[t.id].opacity = v
      for (const s of shapes) d.shapes[s.id].opacity = v
      for (const y of cycles) d.cycles[y.id].opacity = v
      for (const f of fills) d.fills[f.id].opacity = o
    })
  const firstColor = atoms[0]?.color ?? bonds[0]?.color ?? arrows[0]?.color ?? curved[0]?.color ?? texts[0]?.color ?? shapes[0]?.color ?? cycles[0]?.color

  return (
    <aside className="inspector">
      {none && <DocSettings style={doc.style} setStyle={setStyle} />}
      {!none && <ArrangeBar />}

      {(atoms.length > 1 || bonds.length > 0) && <StructureActions />}

      {atoms.length > 0 && (
        <Section id="atom" title={atoms.length === 1 ? 'Atom' : `${atoms.length} Atome`}>
          {atoms.length === 1 && (
            <Row label="Element / Label">
              {isRichLabel(atoms[0].label) ? (
                <RichField value={atoms[0].label!} baseSize={doc.style.fontSize} onCommit={(v) => commit((d) => applyAtomRich(d, atoms[0].id, v))} />
              ) : (
                <LazyText value={atoms[0].label ?? atoms[0].element} onCommit={(v) => commit((d) => applyAtomText(d, atoms[0].id, v))} />
              )}
            </Row>
          )}
          <Row label="Schrift">
            <div className="seg">
              <button
                className={atoms.every((a) => a.bold) ? 'active' : ''}
                data-tip="Fett"
                onClick={() => {
                  const on = !atoms.every((a) => a.bold)
                  setAtoms((a) => {
                    a.bold = on || undefined
                    if (!on) a.boldBonds = undefined
                  })
                }}
              >
                <b>{fmtLetters().bold}</b>
              </button>
              <button
                className={atoms.every((a) => a.italic) ? 'active' : ''}
                data-tip="Kursiv"
                onClick={() => {
                  const on = !atoms.every((a) => a.italic)
                  setAtoms((a) => (a.italic = on || undefined))
                }}
              >
                <i>{fmtLetters().italic}</i>
              </button>
            </div>
            <span className="muted small">Hoch-/Tiefstellen: Atom auswählen + Enter</span>
          </Row>
          {atoms.some((a) => a.bold) && (
            <label className="check">
              <input
                type="checkbox"
                checked={atoms.filter((a) => a.bold).every((a) => a.boldBonds)}
                onChange={(e) => setAtoms((a) => (a.boldBonds = a.bold && e.target.checked ? true : undefined))}
              />{' '}
              Bindungen fett (Linienstärke wie fetter Buchstabe)
            </label>
          )}
          <Row label="Ladung">
            <Stepper value={atoms[0].charge} onChange={(v) => setAtoms((a) => (a.charge = v))} fmt={(v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0')} />
          </Row>
          <Row label="Freie e⁻-Paare">
            <Stepper value={atoms[0].lonePairs} min={0} max={4} onChange={(v) => setAtoms((a) => (a.lonePairs = v))} />
          </Row>
          <Row label="Radikal">
            <Seg
              value={String(atoms[0].radical) as '0' | '1' | '2'}
              options={[
                { v: '0', label: 'kein' },
                { v: '1', label: '•' },
                { v: '2', label: '••' },
              ]}
              onChange={(v) => setAtoms((a) => (a.radical = Number(v)))}
            />
          </Row>
          <Row label="Partialladung">
            <Seg
              value={(atoms[0].partial ?? 'none') as 'none' | '+' | '-'}
              options={[
                { v: 'none', label: 'keine' },
                { v: '+', label: 'δ+' },
                { v: '-', label: 'δ−' },
              ]}
              onChange={(v) => setAtoms((a) => (a.partial = v === 'none' ? undefined : v))}
            />
          </Row>
          <Row label="Stereozentrum">
            <label className="check" data-tip="Markierung „*“ am Atom (Taste * über dem Atom). Verschiebbar wie eine Ladung, Alt+Klick = automatische Position">
              <input
                type="checkbox"
                checked={atoms.every((a) => a.stereoMark)}
                onChange={(e) =>
                  setAtoms((a) => {
                    a.stereoMark = e.target.checked || undefined
                    if (!e.target.checked && !a.showCip) a.stereoOff = undefined
                  })
                }
              />{' '}
              *
            </label>
            <label className="check" data-tip="CIP-Konfiguration (R/S) automatisch bestimmen und am Atom anzeigen">
              <input type="checkbox" checked={atoms.every((a) => a.showCip)} onChange={(e) => setAtoms((a) => (a.showCip = e.target.checked || undefined))} /> R/S
            </label>
          </Row>
          {atoms.length === 1 && <CipInfo id={atoms[0].id} />}
          <Row label="Isotop (Masse)">
            <LazyText
              value={atoms[0].isotope ? String(atoms[0].isotope) : ''}
              placeholder="natürlich"
              onCommit={(v) => {
                // Massenzahl: ganze Zahl 1–300 (z. B. 13 für ¹³C), sonst natürlich
                const n = parseInt(v, 10)
                setAtoms((a) => (a.isotope = n >= 1 && n <= 300 ? n : undefined))
              }}
            />
          </Row>
          <Row label="Label-Hintergrund">
            <BgPick value={atoms[0].bg} onChange={(c) => setAtoms((a) => (a.bg = c))} />
          </Row>
          <Row label="Anknüpfung">
            <label className="check">
              <input type="checkbox" checked={!!atoms[0].attach} onChange={(e) => setAtoms((a) => (a.attach = e.target.checked || undefined))} /> Wellenlinie (Rest)
            </label>
          </Row>
        </Section>
      )}

      {bonds.length > 0 && !wholeMolecules && (
        <Section id="bond" title={bonds.length === 1 ? 'Bindung' : `${bonds.length} Bindungen`}>
          <Row label="Typ">
            <Seg<BondType>
              value={bonds.every((b) => b.type === bonds[0].type) ? bonds[0].type : null}
              options={[
                { v: 'single', label: 'Einfach', icon: 'single' },
                { v: 'double', label: 'Doppel', icon: 'double' },
                { v: 'triple', label: 'Dreifach', icon: 'triple' },
                { v: 'wedge', label: 'Keil', icon: 'wedge' },
                { v: 'hash', label: 'Schraffiert', icon: 'hash' },
              ]}
              onChange={(v) => setBonds((b) => (b.type = v))}
            />
          </Row>
          <Row label="">
            <Seg<BondType>
              value={bonds.every((b) => b.type === bonds[0].type) ? bonds[0].type : null}
              options={[
                { v: 'wavy', label: 'Wellenlinie', icon: 'wavy' },
                { v: 'bold', label: 'Fett', icon: 'bold' },
                { v: 'dashed', label: 'Gestrichelt', icon: 'dashed' },
                { v: 'aromatic', label: 'Delokalisiert', icon: 'aromatic' },
              ]}
              onChange={(v) => setBonds((b) => (b.type = v))}
            />
          </Row>
          {bonds.some((b) => b.type === 'double' || b.type === 'aromatic') && (
            <Row label="Zweitlinie">
              <Seg<DoublePos>
                value={bonds[0].doublePos}
                options={[
                  { v: 'auto', label: 'Auto' },
                  { v: 'center', label: 'Mitte' },
                  { v: 'left', label: 'Links' },
                  { v: 'right', label: 'Rechts' },
                ]}
                onChange={(v) => setBonds((b) => (b.doublePos = v))}
              />
            </Row>
          )}
          {bonds.some((b) => b.type === 'double') && (
            <Row label="E/Z">
              <label className="check" data-tip="Konfiguration der Doppelbindung unbestimmt – als gekreuzte Doppelbindung gezeichnet (SMILES ohne / \)">
                <input
                  type="checkbox"
                  checked={bonds.filter((b) => b.type === 'double').every((b) => b.crossed)}
                  onChange={(e) => setBonds((b) => (b.crossed = b.type === 'double' && e.target.checked ? true : undefined))}
                />{' '}
                unbestimmt (gekreuzt)
              </label>
            </Row>
          )}
          <Row label="Linienstärke">
            <NumSlider min={0.4} max={3} step={0.1} inputMin={0.1} inputMax={10} unit="×" value={bonds[0].width ?? 1} def={1} onChange={(v) => setBonds((b) => (b.width = v === 1 ? undefined : v))} />
          </Row>
          {bonds.some((b) => b.type === 'wedge' || b.type === 'hash') && (
            <Row label="Richtung">
              <button
                className="btn small"
                onClick={() =>
                  setBonds((b) => {
                    const t = b.a1
                    b.a1 = b.a2
                    b.a2 = t
                  })
                }
              >
                Umkehren
              </button>
            </Row>
          )}
        </Section>
      )}

      {arrows.length > 0 && (
        <Section id="arrow" title="Reaktionspfeil">
          <Row label="Art">
            <Seg<ArrowKind>
              value={arrows[0].kind}
              options={[
                { v: 'reaction', label: 'Reaktion', icon: 'reaction' },
                { v: 'equilibrium', label: 'Gleichgewicht', icon: 'equilibrium' },
                { v: 'resonance', label: 'Mesomerie', icon: 'resonance' },
                { v: 'retro', label: 'Retrosynthese', icon: 'retro' },
                { v: 'dashed', label: 'Gestrichelt', icon: 'dashed-arrow' },
                { v: 'failed', label: 'Keine Reaktion', icon: 'failed' },
              ]}
              onChange={(v) =>
                commit((d) => {
                  for (const a of arrows) d.arrows[a.id].kind = v
                })
              }
            />
          </Row>
          <Row label="Verlauf">
            <Seg<ArrowRoute>
              value={arrows[0].route ?? 'straight'}
              options={[
                { v: 'straight', label: 'Gerade', icon: 'reaction' },
                { v: 'elbow-h', label: 'Winkel (erst waagerecht)', icon: 'elbow' },
                { v: 'elbow-v', label: 'Winkel (erst senkrecht)', icon: 'elbow-v' },
                { v: 'step-h', label: 'Stufe waagerecht', icon: 'step-h' },
                { v: 'step-v', label: 'Stufe senkrecht', icon: 'step-v' },
                { v: 'bracket-h', label: 'Klammer seitlich', icon: 'bracket-h' },
                { v: 'bracket-v', label: 'Klammer oben/unten', icon: 'bracket-v' },
              ]}
              onChange={(v) =>
                commit((d) => {
                  for (const a of arrows) d.arrows[a.id].route = v === 'straight' ? undefined : v
                })
              }
            />
          </Row>
          <Row label="Spitzen">
            <Seg<'end' | 'start' | 'both' | 'none'>
              value={arrows[0].heads ?? 'end'}
              options={[
                { v: 'end', label: 'Ende', icon: 'reaction' },
                { v: 'start', label: 'Anfang', icon: 'heads-start' },
                { v: 'both', label: 'Beide', icon: 'heads-both' },
                { v: 'none', label: 'Keine', icon: 'heads-none' },
              ]}
              onChange={(v) =>
                commit((d) => {
                  for (const a of arrows) d.arrows[a.id].heads = v === 'end' ? undefined : v
                })
              }
            />
          </Row>
          {(arrows[0].route === 'bracket-h' || arrows[0].route === 'bracket-v') && (
            <Row label="Ausladung">
              <NumSlider
                min={-200}
                max={200}
                step={2}
                inputMin={-1000}
                inputMax={1000}
                value={arrows[0].reach ?? -30}
                onReset={() =>
                  commit((d) => {
                    for (const a of arrows) d.arrows[a.id].reach = undefined
                  })
                }
                onChange={(v) =>
                  commit((d) => {
                    for (const a of arrows) d.arrows[a.id].reach = v || -2
                  })
                }
              />
            </Row>
          )}
          {(arrows[0].route === 'step-h' || arrows[0].route === 'step-v') && (
            <Row label="Knickposition">
              <NumSlider
                min={0.05}
                max={0.95}
                step={0.05}
                scale={100}
                unit="%"
                value={arrows[0].stepPos ?? 0.5}
                onReset={() =>
                  commit((d) => {
                    for (const a of arrows) d.arrows[a.id].stepPos = undefined
                  })
                }
                onChange={(v) =>
                  commit((d) => {
                    for (const a of arrows) d.arrows[a.id].stepPos = v
                  })
                }
              />
            </Row>
          )}
          <Row label="Text-Position">
            <NumSlider
              min={0.1}
              max={0.9}
              step={0.05}
              scale={100}
              unit="%"
              value={arrows[0].labelPos ?? 0.5}
              onReset={() =>
                commit((d) => {
                  for (const a of arrows) d.arrows[a.id].labelPos = undefined
                })
              }
              onChange={(v) =>
                commit((d) => {
                  for (const a of arrows) d.arrows[a.id].labelPos = v
                })
              }
            />
          </Row>
          <Row label="Linienstärke">
            <NumSlider
              min={0.4}
              max={3}
              step={0.1}
              inputMin={0.1}
              inputMax={10}
              unit="×"
              value={arrows[0].width ?? 1}
              onReset={() =>
                commit((d) => {
                  for (const a of arrows) d.arrows[a.id].width = undefined
                })
              }
              onChange={(v) =>
                commit((d) => {
                  for (const a of arrows) d.arrows[a.id].width = v
                })
              }
            />
          </Row>
          {arrows.length === 1 && (
            <>
              <div className="insp-label">Über dem Pfeil (bzw. rechts bei senkrechtem Pfeil)</div>
              <RichField
                baseSize={arrowTextOpts(doc).size}
                focusEvent="focus-arrow-text"
                value={arrows[0].above}
                placeholder="z. B. 1. RMgBr, CeCl3"
                onCommit={(v) =>
                  commit((d) => {
                    d.arrows[arrows[0].id].above = v
                  })
                }
              />
              <div className="insp-label">Unter dem Pfeil (bzw. links)</div>
              <RichField
                baseSize={arrowTextOpts(doc).size}
                value={arrows[0].below}
                placeholder="z. B. THF, −78 °C, 2 h"
                onCommit={(v) =>
                  commit((d) => {
                    d.arrows[arrows[0].id].below = v
                  })
                }
              />
              <Row label="Ausbeute">
                <input
                  key={arrows[0].id + '|' + (arrows[0].yieldText ?? '')}
                  className="text-input"
                  type="text"
                  defaultValue={arrows[0].yieldText ?? ''}
                  placeholder="z. B. 86"
                  data-tip="Wird fett unter den Bedingungen angezeigt (senkrechter Pfeil: rechts darunter). Reine Zahl → „86%“"
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    if (v === (arrows[0].yieldText ?? '')) return
                    commit((d) => {
                      d.arrows[arrows[0].id].yieldText = v || undefined
                    })
                  }}
                />
              </Row>
            </>
          )}
        </Section>
      )}

      {curved.length > 0 && (
        <Section id="curved" title="Mechanismuspfeil">
          <Row label="Elektronen">
            <Seg
              value={curved[0].head}
              options={[
                { v: 'full', label: '2 e⁻ (Paar)' },
                { v: 'half', label: '1 e⁻ (Fischhaken)' },
              ]}
              onChange={(v) =>
                commit((d) => {
                  for (const c of curved) d.curved[c.id].head = v
                })
              }
            />
          </Row>
          <Row label="Krümmung">
            <NumSlider
              min={-1.2}
              max={1.2}
              step={0.05}
              inputMin={-3}
              inputMax={3}
              value={curved[0].bend}
              onReset={() => {
                // Ausgangszustand: Krümmung, die OpenMol beim Zeichnen gewählt hätte
                const sc = getScene(doc)
                commit((d) => {
                  for (const c of curved) d.curved[c.id].bend = defaultBend(sc, c.from, c.to)
                })
              }}
              onChange={(v) =>
                commit((d) => {
                  for (const c of curved) d.curved[c.id].bend = v
                })
              }
            />
          </Row>
          <Row label="">
            <button
              className="btn small"
              onClick={() =>
                commit((d) => {
                  for (const c of curved) d.curved[c.id].bend = -d.curved[c.id].bend
                })
              }
            >
              Seite wechseln
            </button>
            <button
              className="btn small"
              onClick={() =>
                commit((d) => {
                  for (const c of curved) {
                    const cc = d.curved[c.id]
                    const t = cc.from
                    cc.from = cc.to
                    cc.to = t
                    cc.bend = -cc.bend
                  }
                })
              }
            >
              Richtung umkehren
            </button>
          </Row>
        </Section>
      )}

      {texts.length > 0 && (
        <Section id="text" title="Text">
          {texts.length === 1 && (
            <RichField
              baseSize={texts[0].size}
              value={texts[0].text}
              onCommit={(v) =>
                commit((d) => {
                  d.texts[texts[0].id].text = v
                })
              }
            />
          )}
          <Row label="Schriftart">
            <select
              value={texts[0].font ?? ''}
              onChange={(e) =>
                commit((d) => {
                  // „Symbol“: Buchstaben werden griechisch (wie in ChemDraw), die Schriftart bleibt
                  if (e.target.value === '__symbol') for (const t of texts) d.texts[t.id].text = richToSymbolGreek(d.texts[t.id].text)
                  else for (const t of texts) d.texts[t.id].font = e.target.value || undefined
                })
              }
            >
              <option value="">{`Dokument (${doc.style.font})`}</option>
              {FONTS.map((f) => (
                <option key={f.name} value={f.name} style={{ fontFamily: f.css }}>
                  {f.name}
                </option>
              ))}
              <option value="__symbol">Symbol (griechisch: a → α)</option>
            </select>
          </Row>
          <Row label="Ausrichtung">
            <Seg<'left' | 'center' | 'right'>
              value={texts[0].align ?? 'left'}
              options={[
                { v: 'left', label: 'Links', icon: 'alignL' },
                { v: 'center', label: 'Zentriert', icon: 'alignC' },
                { v: 'right', label: 'Rechts', icon: 'alignR' },
              ]}
              onChange={(v) =>
                commit((d) => {
                  for (const t of texts) {
                    const tt = d.texts[t.id]
                    // Position so verschieben, dass der Text optisch stehen bleibt
                    const old = textBox(tt, d)
                    tt.align = v === 'left' ? undefined : v
                    tt.x = v === 'left' ? old.x1 + (tt.bg ? tt.size * 0.25 : 0) : v === 'center' ? (old.x1 + old.x2) / 2 : old.x2 - (tt.bg ? tt.size * 0.25 : 0)
                  }
                })
              }
            />
          </Row>
          <Row label="Hintergrund">
            <BgPick
              value={texts[0].bg}
              onChange={(c) =>
                commit((d) => {
                  for (const t of texts) d.texts[t.id].bg = c
                })
              }
            />
          </Row>
          <label className="check">
            <input
              type="checkbox"
              checked={texts[0].chem === true}
              onChange={(e) =>
                commit((d) => {
                  for (const t of texts) d.texts[t.id].chem = e.target.checked ? true : undefined
                })
              }
            />{' '}
            Ganzer Text als Summenformel (H2O → H₂O)
          </label>
          <Row label="Größe">
            <Stepper
              value={texts[0].size}
              min={6}
              max={96}
              onChange={(v) =>
                commit((d) => {
                  for (const t of texts) d.texts[t.id].size = v
                })
              }
            />
          </Row>
          <Row label="Stil">
            <div className="seg">
              <button
                className={texts[0].bold ? 'active' : ''}
                data-tip="Fett (ganzer Text)"
                onClick={() =>
                  commit((d) => {
                    for (const t of texts) d.texts[t.id].bold = !texts[0].bold
                  })
                }
              >
                <b>{fmtLetters().bold}</b>
              </button>
              <button
                className={texts[0].italic ? 'active' : ''}
                data-tip="Kursiv (ganzer Text)"
                onClick={() =>
                  commit((d) => {
                    for (const t of texts) d.texts[t.id].italic = !texts[0].italic
                  })
                }
              >
                <i>{fmtLetters().italic}</i>
              </button>
            </div>
          </Row>
        </Section>
      )}

      {shapes.length > 0 && (
        <Section id="shape" title="Form">
          <Row label="Art">
            <Seg<ShapeKind>
              value={shapes[0].kind}
              options={[
                { v: 'brackets', label: 'Eckig', icon: 'brackets' },
                { v: 'parens', label: 'Rund', icon: 'parens' },
                { v: 'braces', label: 'Geschweift', icon: 'braces' },
                { v: 'rect', label: 'Rechteck', icon: 'rect' },
                { v: 'roundrect', label: 'Runde Ecken', icon: 'roundrect' },
                { v: 'ellipse', label: 'Ellipse', icon: 'ellipse' },
                { v: 'sphere', label: 'Kugel', icon: 'sphere' },
              ]}
              onChange={(v) =>
                commit((d) => {
                  for (const s of shapes) d.shapes[s.id].kind = v
                })
              }
            />
          </Row>
          <Row label="Linie">
            <Seg
              value={shapes[0].dashed ? 'dashed' : 'solid'}
              options={[
                { v: 'solid', label: 'durchgezogen' },
                { v: 'dashed', label: 'gestrichelt' },
              ]}
              onChange={(v) =>
                commit((d) => {
                  for (const s of shapes) d.shapes[s.id].dashed = v === 'dashed'
                })
              }
            />
          </Row>
          {CLOSED_SHAPES.has(shapes[0].kind) ? (
            <ShapeFillSection shapes={shapes} />
          ) : (
            <>
              <Row label="Index oben">
                <LazyText
                  value={shapes[0].corner ?? ''}
                  placeholder="z. B. ‡, 2−"
                  onCommit={(v) =>
                    commit((d) => {
                      for (const s of shapes) d.shapes[s.id].corner = v || undefined
                    })
                  }
                />
              </Row>
              <label className="check" data-tip="Zyklische Wiederholungseinheit: die beiden aus den Klammern führenden Bindungen über einen Ring verbinden">
                <input
                  type="checkbox"
                  checked={!!shapes[0].cyclic}
                  onChange={(e) =>
                    commit((d) => {
                      for (const s of shapes) d.shapes[s.id].cyclic = e.target.checked || undefined
                    })
                  }
                />{' '}
                zyklisch (Ring schließen)
              </label>
              <Row label="Index unten">
                <LazyText
                  value={shapes[0].sub ?? ''}
                  placeholder="z. B. n, n − 3"
                  onCommit={(v) =>
                    commit((d) => {
                      for (const s of shapes) d.shapes[s.id].sub = v || undefined
                    })
                  }
                />
              </Row>
            </>
          )}
          {!CLOSED_SHAPES.has(shapes[0].kind) && (
            <div className="insp-chips">
              {['‡', '+', '−', '•'].map((c) => (
                <button
                  key={c}
                  className="chip"
                  data-tip="Index oben"
                  onClick={() =>
                    commit((d) => {
                      for (const s of shapes) d.shapes[s.id].corner = c
                    })
                  }
                >
                  {c}
                </button>
              ))}
              {['n', 'm', 'x'].map((c) => (
                <button
                  key={'s' + c}
                  className="chip"
                  data-tip="Index unten (Polymer)"
                  onClick={() =>
                    commit((d) => {
                      for (const s of shapes) d.shapes[s.id].sub = c
                    })
                  }
                >
                  <i>{c}</i>
                  <sub>↓</sub>
                </button>
              ))}
            </div>
          )}
        </Section>
      )}

      {cycles.length === 1 && <CycleSection c={cycles[0]} />}

      {(sel.tables ?? []).length === 1 && doc.tables[sel.tables[0]] && <TableSection id={sel.tables[0]} />}

      {(none || arrows.length > 0 || atoms.length > 1) && !(sel.tables ?? []).length && (
        <Section id="reaction" title="Reaktion">
          <div className="cyc-add">
            <button
              className="btn small"
              onClick={createStoichTable}
              data-tip="Stöchiometrische Ansatztabelle aus der gezeichneten Reaktion: Edukte (vor dem Pfeil), Reagenzien (am Pfeil und im Pfeiltext), Lösungsmittel, Produkte, Temperatur und Zeit"
            >
              <Icon name="table" size={14} /> Ansatztabelle erstellen
            </button>
          </div>
        </Section>
      )}

      {fills.length > 0 && (
        <Section id="ringfill" title={fills.length === 1 ? 'Ringfüllung' : `${fills.length} Ringfüllungen`}>
          <FillOptions
            compact
            value={fills[0]}
            onChange={(f) =>
              commit((d) => {
                for (const x of fills) Object.assign(d.fills[x.id], f)
              })
            }
          />
          <p className="muted small">Mehrere anellierte Ringe in einer Füllung teilen sich einen durchgehenden Farbverlauf.</p>
        </Section>
      )}

      {!none && (
        <Section id="color" title="Farbe & Deckkraft">
          <ColorPick value={firstColor} onChange={setColorAll} />
          <Row label="Fett">
            <div className="seg">
              <button className={selectionBold() ? 'active' : ''} data-tip="Fett (⌘B): Texte und Zeichen fett, Linien so dick wie ein fetter Buchstabe" onClick={() => toggleBold()}>
                <b>{fmtLetters().bold}</b>
              </button>
            </div>
          </Row>
          <Row label="Deckkraft">
            <NumSlider min={0.1} max={1} step={0.05} scale={100} digits={0} inputMin={0.01} unit="%" value={firstOpacity} def={1} onChange={setOpacityAll} />
          </Row>
          {(atoms.length > 0 || texts.length > 0) && (
            <Row label="Textmarker">
              <div className="hl-swatches">
                <button
                  className={'hl-swatch none' + (!firstHighlight ? ' active' : '')}
                  data-tip="Kein Textmarker"
                  aria-label="Kein Textmarker"
                  onClick={() => setHighlight(undefined)}
                />
                {HIGHLIGHT_COLORS.map((h) => (
                  <button
                    key={h.c}
                    className={'hl-swatch' + (firstHighlight === h.c ? ' active' : '')}
                    style={{ background: h.c }}
                    data-tip={`Textmarker ${h.name} – Atome, Bindungen und Texte farbig hinterlegen`}
                    aria-label={`Textmarker ${h.name}`}
                    onClick={() => setHighlight(h.c)}
                  />
                ))}
              </div>
            </Row>
          )}
        </Section>
      )}

      <AnalysisPanel />
    </aside>
  )
}

function DocSettings({ style, setStyle }: { style: DocStyle; setStyle: (p: Partial<DocStyle>) => void }) {
  const presetKey = Object.entries(STYLE_PRESETS).find(
    ([, p]) => p.style.lineWidth === style.lineWidth && p.style.fontSize === style.fontSize,
  )?.[0]
  return (
    <Section id="docstyle" title="Dokument-Stil">
      <Row label="Vorlage">
        <select
          data-tip="Stilvorlage für das ganze Dokument (Linienstärke, Schriftgröße, Ladungen) – z. B. wie in ACS-Zeitschriften"
          value={presetKey ?? ''}
          onChange={(e) => {
            const p = STYLE_PRESETS[e.target.value]
            if (p) setStyle({ lineWidth: p.style.lineWidth, fontSize: p.style.fontSize, chargeCircle: p.style.chargeCircle })
          }}
        >
          {!presetKey && <option value="">Benutzerdefiniert</option>}
          {Object.entries(STYLE_PRESETS).map(([k, p]) => (
            <option key={k} value={k}>
              {p.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Schriftart">
        <select value={style.font} onChange={(e) => setStyle({ font: e.target.value })} data-tip="Schriftart aller Atombeschriftungen und Texte im Dokument">
          {FONTS.map((f) => (
            <option key={f.name} value={f.name} style={{ fontFamily: f.css }}>
              {f.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Linienstärke">
        <NumSlider min={0.8} max={4} step={0.1} digits={2} inputMin={0.2} inputMax={10} value={style.lineWidth} def={STYLE_PRESETS.standard.style.lineWidth} onChange={(v) => setStyle({ lineWidth: v })} />
      </Row>
      <Row label="Schriftgröße">
        <NumSlider min={10} max={36} step={0.5} inputMin={4} inputMax={96} value={style.fontSize} def={STYLE_PRESETS.standard.style.fontSize} onChange={(v) => setStyle({ fontSize: v })} />
      </Row>
      <Row label="Hintergrund">
        <DocBgPick value={style.background} onChange={(c) => setStyle({ background: c })} />
      </Row>
      <Row label="Seitenformat">
        <select
          value={style.page?.format ?? ''}
          data-tip="Seitenformat wie in ChemDraw (eine Bindung = 14,4 pt). Mit den „+“ an den Rändern weitere Seiten anbauen; der PDF-Export erzeugt je Seite eine PDF-Seite"
          onChange={(e) => setPageFormat(e.target.value || null)}
        >
          <option value="">Unbegrenzt</option>
          {PAGE_FORMATS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </Row>
      {style.page && (
        <>
          <Row label="Orientierung">
            <div className="seg">
              <button className={!style.page.landscape ? 'active' : ''} data-tip="Hochformat" onClick={() => setPageFormat(style.page!.format, false)}>
                Hoch
              </button>
              <button className={style.page.landscape ? 'active' : ''} data-tip="Querformat" onClick={() => setPageFormat(style.page!.format, true)}>
                Quer
              </button>
            </div>
          </Row>
          <Row label="Seiten">
            <span className="muted small">{style.page.cols * style.page.rows === 1 ? '1 Seite' : `${style.page.cols} × ${style.page.rows} Seiten`}</span>
          </Row>
          <div className="cyc-add">
            <button className="btn small" onClick={trimPages} data-tip="Seiten am Rand ohne Inhalt entfernen">
              Leere entfernen
            </button>
            <button className="btn small" onClick={fitSheet} data-tip="Ansicht auf alle Seiten einpassen">
              Seiten einpassen
            </button>
          </div>
        </>
      )}
      <label className="check">
        <input type="checkbox" checked={style.chargeCircle} onChange={(e) => setStyle({ chargeCircle: e.target.checked })} /> Ladungen umkreist (⊕ ⊖)
      </label>
      <label className="check">
        <input type="checkbox" checked={style.colorAtoms} onChange={(e) => setStyle({ colorAtoms: e.target.checked })} /> Heteroatome farbig
      </label>
      <label className="check">
        <input type="checkbox" checked={style.showCarbons} onChange={(e) => setStyle({ showCarbons: e.target.checked })} /> Alle C-Atome beschriften
      </label>
      <label className="check">
        <input type="checkbox" checked={style.showWarnings} onChange={(e) => setStyle({ showWarnings: e.target.checked })} /> Valenzfehler markieren
      </label>
      <label className="check">
        <input type="checkbox" checked={style.depth3d !== false} onChange={(e) => setStyle({ depth3d: e.target.checked })} /> 3D-Tiefe darstellen (hinten grau)
      </label>
      <label className="check">
        <input type="checkbox" checked={!!style.showCip} onChange={(e) => setStyle({ showCip: e.target.checked || undefined })} /> R/S an allen Stereozentren anzeigen
      </label>
    </Section>
  )
}

/** Ebenen: Vordergrund/Hintergrund, eine Ebene vor/zurück (für alle Objektarten) */
function ArrangeBar() {
  const grouped = useStore((st) => inGroup(st.doc, st.sel))
  const locked = useStore((st) => hasLocked(st.doc))
  const btn = (mode: 'front' | 'forward' | 'backward' | 'back', icon: string, tip: string) => (
    <button className="icon-btn" data-tip={tip} onClick={() => arrange(mode)}>
      <Icon name={icon} size={18} />
    </button>
  )
  return (
    <div className="arrange-bar">
      <span className="muted small">Anordnung</span>
      {btn('front', 'order-front', 'In den Vordergrund (⇧⌘F)')}
      {btn('forward', 'order-forward', 'Eine Ebene nach vorn (⌥⇧⌘F)')}
      {btn('backward', 'order-backward', 'Eine Ebene nach hinten (⌥⇧⌘B)')}
      {btn('back', 'order-back', 'In den Hintergrund (⇧⌘B)')}
      <span className="arrange-sep" />
      {grouped ? (
        <button className="icon-btn" data-tip="Gruppierung aufheben (⇧⌘G)" onClick={ungroupSelection}>
          <Icon name="ungroup" size={18} />
        </button>
      ) : (
        <button className="icon-btn" data-tip="Gruppieren (⌘G): als eine Einheit auswählen und verschieben" onClick={groupSelection}>
          <Icon name="group" size={18} />
        </button>
      )}
      <button className="icon-btn" data-tip="Sperren (⌘L): nicht mehr anklickbar oder verschiebbar" onClick={lockSelection}>
        <Icon name="lock" size={18} />
      </button>
      {locked && (
        <button className="icon-btn" data-tip="Alle entsperren (⇧⌘L)" onClick={unlockEverything}>
          <Icon name="unlock" size={18} />
        </button>
      )}
    </div>
  )
}

/** Aktionen für eine markierte Struktur */
function StructureActions() {
  return (
    <Section id="structure" title="Struktur">
      <div className="cyc-add">
        <button className="btn small" onClick={() => setState({ dialog: 'saveTemplate' })} data-tip="Markierte Struktur mit eigenem Namen in einer eigenen Sammlung der Vorlagen-Bibliothek speichern">
          <Icon name="template" size={14} /> Zur Bibliothek hinzufügen
        </button>
      </div>
      <div className="cyc-add">
        <button className="btn small" onClick={() => lookupSelection('pubchem')} data-tip="PubChem-Eintrag des markierten Moleküls öffnen (online)">
          <Icon name="search" size={14} /> PubChem
        </button>
        <button className="btn small" onClick={() => lookupSelection('wikipedia')} data-tip="Englischen Wikipedia-Artikel des markierten Moleküls öffnen (online, über Wikidata)">
          <Icon name="search" size={14} /> Wikipedia
        </button>
      </div>
      <div className="cyc-add">
        <button className="btn small" onClick={contractGroups} data-tip="Ausgeschriebene Gruppen als Kürzel schreiben: OMe, OTf, Bpin, CO2Me, OAc, TBS, CF3, tBu … (Auswahl oder ganzes Dokument)">
          Kürzel bilden
        </button>
        <button className="btn small" onClick={expandGroups} data-tip="Kürzel (OMe, CF3, tBu, CO2Me, Bpin …) wieder als einzelne Atome zeichnen (Auswahl oder ganzes Dokument)">
          Kürzel auflösen
        </button>
      </div>
      <div className="cyc-add">
        <button className="btn small" onClick={() => bracketSelection(true)} data-tip="Zyklische Wiederholungseinheit (z. B. Pillar[5]aren): Klammern mit Index, die beiden herausführenden Bindungen werden über einen Ring verbunden">
          [ ]<sub>n</sub>○ Zyklisch
        </button>
        <button className="btn small" onClick={() => bracketSelection()} data-tip="Polymerklammern mit Index „n“ um die markierte Wiederholungseinheit. Endstummel (unbeschriftete C-Enden) werden von den Klammern geschnitten und zählen nicht zur Formel">
          [ ]<sub>n</sub> Polymerklammern
        </button>
      </div>
    </Section>
  )
}

/** Polymer: Wiederholungseinheit, Endgruppen, Gesamtmasse */
function PolymerView({ p }: { p: PolymerUnit }) {
  const doc = useStore((s) => s.doc)
  const pa = useMemo(() => {
    try {
      return analyzePolymer(doc, p)
    } catch {
      return null
    }
  }, [doc, p])
  if (!pa) return null
  const idx = (p.shape.sub ?? '').trim()
  const numeric = /^[1-9]\d*$/.test(idx)
  const setShape = (f: (s: Shape) => void) =>
    commit((d) => {
      const s = d.shapes[p.shape.id]
      if (s) f(s)
    })
  // Platzhalter (R, X …) oder unbekannte Labels: Massen nicht bestimmbar → nicht anzeigen
  const unitOk = pa.unit.generic === 0
  const endsOk = !pa.ends || pa.ends.generic === 0
  return (
    <div className="analysis polymer">
      <div className="formula">
        ({fmtFormula(pa.unit.formula)})<sub>
          <i>{idx}</i>
        </sub>
      </div>
      <dl>
        {unitOk && (
          <>
            <dt>Masse pro Wiederholungseinheit</dt>
            <dd>{fmtDec(pa.unit.mw, 2)} g/mol</dd>
          </>
        )}
        {pa.ends && (
          <>
            <dt>Endgruppen</dt>
            <dd>
              {fmtFormula(pa.ends.formula)}
              {endsOk && ` · ${fmtDec(pa.ends.mw, 2)} g/mol`}
            </dd>
          </>
        )}
        {p.shape.cyclic ? (
          <>
            <dt>Zyklisch</dt>
            <dd>Ring aus n Einheiten (ohne Endgruppen)</dd>
          </>
        ) : (
          p.openEnds.length > 0 && (
            <>
              <dt>Offene Enden</dt>
              <dd>{p.openEnds.length} (nicht mitgezählt)</dd>
            </>
          )
        )}
        {pa.n !== null && (
          <>
            <dt>{pa.nSource === 'mn' ? 'n̄ (aus Mn)' : 'n'}</dt>
            <dd>{Number.isInteger(pa.n) ? pa.n : fmtDec(pa.n, 1)}</dd>
          </>
        )}
        {unitOk && endsOk && (
          <>
            <dt>Gesamtmasse</dt>
            <dd>{pa.total !== null ? `${fmtDec(pa.total, 2)} g/mol` : '– (n angeben)'}</dd>
          </>
        )}
        {unitOk && endsOk && pa.totalFormula && (
          <>
            <dt>Summenformel gesamt</dt>
            <dd>{fmtFormula(pa.totalFormula)}</dd>
          </>
        )}
      </dl>
      {(!unitOk || !endsOk) && <p className="note">Enthält Platzhalter (R, X …) – Massen lassen sich nicht berechnen.</p>}
      {!numeric && (
        <div className="poly-inputs">
          <label>
            n =
            <input
              key={'n' + (p.shape.polyN ?? '')}
              type="number"
              min={1}
              step={1}
              defaultValue={p.shape.polyN ?? ''}
              placeholder="z. B. 50"
              onKeyDown={(e) => e.stopPropagation()}
              onBlur={(e) => {
                const v = parseFloat(e.target.value)
                setShape((s) => {
                  s.polyN = v > 0 ? v : undefined
                  if (v > 0) s.polyMn = undefined
                })
              }}
            />
          </label>
          <label>
            oder Mn =
            <input
              key={'m' + (p.shape.polyMn ?? '')}
              type="number"
              min={1}
              defaultValue={p.shape.polyMn ?? ''}
              placeholder="g/mol"
              onKeyDown={(e) => e.stopPropagation()}
              onBlur={(e) => {
                const v = parseFloat(e.target.value)
                setShape((s) => {
                  s.polyMn = v > 0 ? v : undefined
                  if (v > 0) s.polyN = undefined
                })
              }}
            />
          </label>
          <p className="muted small">Steht an der Klammer eine Zahl (z. B. 20), wird damit gerechnet.</p>
        </div>
      )}
    </div>
  )
}

function fmtFormula(f: string) {
  const parts = f.split(/(\d+)/)
  return parts.map((p, i) => (/^\d+$/.test(p) ? <sub key={i}>{p}</sub> : <span key={i}>{p}</span>))
}

function AnalysisPanel() {
  useSettings()
  const doc = useStore((s) => s.doc)
  const sel = useStore((s) => s.sel)
  const atomIds = useMemo(() => [...selectionAtomIds(doc, sel)], [doc, sel])
  const useSel = atomIds.length > 0
  // Polymer-Klammern: Wiederholungseinheit statt der gezeichneten Einzelstruktur auswerten
  const polys = useMemo(() => {
    try {
      // nur für ausgewählte Wiederholungseinheiten bzw. ausgewählte Polymerklammern
      return polymerUnits(doc).filter((p) => p.unit.some((id) => atomIds.includes(id)) || sel.shapes.includes(p.shape.id))
    } catch {
      return []
    }
  }, [doc, atomIds, sel.shapes])
  const res = useMemo(() => {
    if (!useSel) return null
    try {
      return analyze(doc, atomIds)
    } catch {
      return null
    }
  }, [doc, atomIds, useSel])
  const [name, setName] = useState<{ smiles: string; text: string } | null>(null)
  const [loading, setLoading] = useState(false)

  const lookup = async () => {
    if (!res) return
    setLoading(true)
    try {
      const r = await smilesToName(res.smiles)
      setName({ smiles: res.smiles, text: [r.title, r.iupac].filter((x, i, a) => x && a.findIndex((y) => y?.toLowerCase() === x.toLowerCase()) === i).join(' — ') })
    } catch (e) {
      setName({ smiles: res.smiles, text: e instanceof Error ? e.message : 'Fehler' })
    } finally {
      setLoading(false)
    }
  }

  // Analyse nur, wenn ein Molekül (bzw. eine Polymerklammer) ausgewählt ist – sonst nichts anzeigen
  if (!useSel && !polys.length) return null
  return (
    <Section id="analysis" title={polys.length ? 'Analyse (Polymer)' : 'Analyse'}>
      {polys.map((p) => (
        <PolymerView key={p.shape.id} p={p} />
      ))}
      {!res && !polys.length && <p className="muted">Zeichne eine Struktur, um Summenformel, Masse und Eigenschaften zu sehen.</p>}
      {res && !polys.length && (
        <div className="analysis">
          <div className="formula">
            {fmtFormula(res.formula)}
            {res.charge !== 0 && <sup>{(Math.abs(res.charge) > 1 ? Math.abs(res.charge) : '') + (res.charge > 0 ? '+' : '−')}</sup>}
            {res.generic > 0 && <span className="formula-rest"> + Platzhalter</span>}
          </div>
          <dl>
            {/* Mit Platzhaltern (R, X …) oder unbekannten Labels ist die Masse nicht bestimmbar → nichts anzeigen */}
            {res.generic === 0 && (
              <>
                <dt>Molmasse</dt>
                <dd>{fmtDec(res.mw, 2)} g/mol</dd>
                <dt>Exakte Masse</dt>
                <dd>{fmtDec(res.exact, 4)}</dd>
                <dt>Isotopenmuster</dt>
                <dd>
                  <IsoBars natural={res.natural} labeled={res.labeled} />
                </dd>
              </>
            )}
            {res.generic === 0 && res.composition.length > 0 && (
              <>
                <dt>Elementaranalyse</dt>
                <dd className="ea">
                  {res.composition.map((c) => (
                    <span key={c.el}>
                      {c.el} {fmtDec(c.pct, 2)} %
                    </span>
                  ))}
                </dd>
              </>
            )}
            {res.logP !== undefined && res.generic === 0 && (
              <>
                <dt>cLogP</dt>
                <dd>{fmtDec(res.logP, 2)}</dd>
                <dt>TPSA</dt>
                <dd>{fmtDec(res.tpsa!, 1)} Å²</dd>
                <dt>H-Donoren / -Akzeptoren</dt>
                <dd>
                  {res.donors} / {res.acceptors}
                </dd>
                <dt>Drehbare Bindungen</dt>
                <dd>{res.rotatable}</dd>
                <dt>Stereozentren</dt>
                <dd>{res.stereo}</dd>
              </>
            )}
            {res.fragments > 1 && (
              <>
                <dt>Fragmente</dt>
                <dd>{res.fragments}</dd>
              </>
            )}
          </dl>
          {res.generic > 0 && (
            <p className="note">
              Enthält {res.generic} Platzhalter (R, X …){res.unknownLabels.length ? ` bzw. unbekannte Labels (${res.unknownLabels.join(', ')})` : ''} – die Summenformel gilt nur für den Rest, Molmasse und Elementaranalyse lassen sich nicht berechnen.
            </p>
          )}
          <div className="smiles">
            <code title={res.smiles}>{res.smiles}</code>
            <button
              className="icon-btn"
              data-tip="SMILES kopieren"
              onClick={() => {
                navigator.clipboard?.writeText(res.smiles).then(
                  () => toast('SMILES kopiert'),
                  () => toast('Kopieren nicht möglich', 'error'),
                )
              }}
            >
              <Icon name="copy" size={16} />
            </button>
          </div>
          <button className="btn small wide" onClick={lookup} disabled={loading || res.generic > 0}>
            <Icon name="search" size={15} /> {loading ? 'Suche in PubChem …' : 'Name nachschlagen (PubChem, online)'}
          </button>
          {name && name.smiles === res.smiles && <p className="name-result">{name.text}</p>}
        </div>
      )}
    </Section>
  )
}

/** Füllung (Farbe/Verlauf), Schatten, Eckradius und Rahmen geschlossener Formen */
function ShapeFillSection({ shapes }: { shapes: Shape[] }) {
  const s0 = shapes[0]
  const set = (f: (s: Shape) => void) =>
    commit((d) => {
      for (const s of shapes) f(d.shapes[s.id])
    })
  const filled = !!s0.fill || s0.kind === 'sphere'
  const value: FillStyle = {
    mode: 'fill',
    grad: s0.fillGrad ?? 'none',
    c1: s0.fill ?? (s0.kind === 'sphere' ? '#d4d7dc' : '#ffffff'),
    c2: s0.fill2 ?? '#ffffff',
    angle: s0.fillAngle ?? 90,
    opacity: s0.fillOpacity ?? 1,
  }
  return (
    <>
      <Row label="Füllung">
        {s0.kind !== 'sphere' && (
          <label className="check">
            <input
              type="checkbox"
              checked={filled}
              onChange={(e) =>
                set((s) => {
                  s.fill = e.target.checked ? (s.fill ?? '#ffffff') : undefined
                  if (!e.target.checked) s.fillGrad = undefined
                })
              }
            />{' '}
            gefüllt
          </label>
        )}
      </Row>
      {filled && (
        <FillOptions
          compact
          shape
          value={value}
          onChange={(f) =>
            set((s) => {
              s.fill = f.c1
              s.fill2 = f.c2
              s.fillGrad = f.grad === 'none' ? undefined : f.grad
              s.fillAngle = f.angle
              s.fillOpacity = f.opacity >= 0.999 ? undefined : f.opacity
            })
          }
        />
      )}
      {s0.kind === 'sphere' && <p className="muted small">Die 3D-Schattierung (Glanzlicht, dunkler Rand) liegt über der gewählten Farbe bzw. dem Verlauf.</p>}
      <label className="check">
        <input type="checkbox" checked={!!s0.shadow} onChange={(e) => set((s) => (s.shadow = e.target.checked || undefined))} /> Schlagschatten
      </label>
      <label className="check">
        <input type="checkbox" checked={!s0.noStroke} onChange={(e) => set((s) => (s.noStroke = e.target.checked ? undefined : true))} /> Rahmen
      </label>
      {s0.kind === 'roundrect' && (
        <Row label="Eckradius">
          <NumSlider
            min={2}
            max={80}
            step={1}
            inputMin={0}
            inputMax={400}
            value={Math.round(s0.radius ?? Math.max(4, Math.min(Math.abs(s0.x2 - s0.x1), Math.abs(s0.y2 - s0.y1)) * 0.08))}
            onReset={() => set((s) => (s.radius = undefined))}
            onChange={(v) => set((s) => (s.radius = v))}
          />
        </Row>
      )}
    </>
  )
}

/** Erkannte Konfiguration des markierten Atoms */
function CipInfo({ id }: { id: string }) {
  const doc = useStore((s) => s.doc)
  const cip = useMemo(() => stereoCenters(doc).get(id), [doc, id])
  const text = !cip
    ? 'kein Stereozentrum'
    : cip === '?'
      ? 'Stereozentrum – Konfiguration offen (Keil/Strich setzen)'
      : `Stereozentrum (${cip})`
  return <div className="muted small cip-info">Erkannt: {text}</div>
}

function CycleSection({ c }: { c: Cycle }) {
  const doc = useStore((s) => s.doc)
  const set = (f: (cc: Cycle) => void) =>
    commit((d) => {
      f(d.cycles[c.id])
    })
  const r = (c.rx + c.ry) / 2
  return (
    <Section id="cycle" title="Katalysezyklus">
      <Row label="Stationen">
        <Stepper value={c.stations.length} min={0} max={12} onChange={(v) => set((cc) => redistribute(cc, v))} />
      </Row>
      <Row label="Richtung">
        <Seg<'cw' | 'ccw'>
          value={c.dir}
          options={[
            { v: 'cw', label: 'Uhrzeigersinn', icon: 'cw' },
            { v: 'ccw', label: 'Gegen Uhrzeigersinn', icon: 'ccw' },
          ]}
          onChange={(v) => set((cc) => (cc.dir = v))}
        />
      </Row>
      <Row label="Standardlücke">
        <NumSlider min={6} max={120} step={1} inputMin={0} inputMax={170} unit="°" value={c.gap} def={34} onChange={(v) => set((cc) => (cc.gap = v))} />
      </Row>
      <Row label="Breite">
        <NumSlider min={30} max={600} step={2} digits={0} inputMin={10} inputMax={2000} value={c.rx} onReset={() => set((cc) => (cc.rx = cc.ry))} onChange={(v) => set((cc) => (cc.rx = v))} />
      </Row>
      <Row label="Höhe">
        <NumSlider min={30} max={600} step={2} digits={0} inputMin={10} inputMax={2000} value={c.ry} onReset={() => set((cc) => (cc.ry = cc.rx))} onChange={(v) => set((cc) => (cc.ry = v))} />
      </Row>
      <Row label="Linie">
        <NumSlider min={0.4} max={3} step={0.1} inputMin={0.1} inputMax={10} unit="×" value={c.width ?? 1} onReset={() => set((cc) => (cc.width = undefined))} onChange={(v) => set((cc) => (cc.width = v))} />
      </Row>
      <label className="check">
        <input type="checkbox" checked={c.heads} onChange={(e) => set((cc) => (cc.heads = e.target.checked))} /> Pfeilspitzen am Ende jedes Bogens
      </label>
      <label className="check">
        <input type="checkbox" checked={!!c.dashed} onChange={(e) => set((cc) => (cc.dashed = e.target.checked || undefined))} /> gestrichelt
      </label>
      <div className="insp-label">Stationen (Zwischenstufen) – Doppelklick auf der Zeichenfläche beschriftet ebenfalls</div>
      <button className="btn small wide" onClick={() => fitCycleGaps(c.id)} data-tip="Moleküle/Texte, die auf der Zykluslinie liegen, bekommen passende Lücken">
        Lücken an Moleküle anpassen
      </button>
      {c.stations.map((st, i) => (
        <div key={i} className="cyc-station">
          <div className="cyc-item">
            <RichField value={st.label ?? ''} baseSize={stationLabelSize(doc).size} placeholder={`Station ${i + 1} (optional)`} onCommit={(v) => set((cc) => (cc.stations[i].label = richPlain(v).trim() ? v : undefined))} />
            <button className="icon-btn" data-tip="Station entfernen" onClick={() => set((cc) => cc.stations.splice(i, 1))}>
              <Icon name="trash" size={15} />
            </button>
          </div>
          <div className="cyc-row">
            <span className="muted small">Lücke</span>
            <NumSlider
              min={2}
              max={170}
              step={1}
              unit="°"
              value={Math.round(stationHalfGaps(doc, c, i).lo + stationHalfGaps(doc, c, i).hi)}
              onReset={() =>
                set((cc) => {
                  cc.stations[i].gap = undefined
                  cc.stations[i].gapLo = cc.stations[i].gapHi = undefined
                })
              }
              onChange={(v) =>
                set((cc) => {
                  // Regler: Lücke wieder symmetrisch
                  cc.stations[i].gap = v
                  cc.stations[i].gapLo = cc.stations[i].gapHi = undefined
                })
              }
            />
            <button
              className={'chip' + (st.gap === undefined && st.gapLo === undefined && st.gapHi === undefined ? ' active' : '')}
              data-tip="Automatisch (Standardlücke bzw. passend zur Beschriftung)"
              onClick={() =>
                set((cc) => {
                  cc.stations[i].gap = undefined
                  cc.stations[i].gapLo = cc.stations[i].gapHi = undefined
                })
              }
            >
              Auto
            </button>
          </div>
        </div>
      ))}
      <div className="insp-label">Zu- und Abflüsse</div>
      {c.branches.map((b, i) => (
        <div key={b.id} className="cyc-branch">
          <div className="cyc-row">
            <Seg<'in' | 'out'>
              value={b.type}
              options={[
                { v: 'in', label: 'Zufluss', icon: 'cyc-in' },
                { v: 'out', label: 'Abfluss', icon: 'cyc-out' },
              ]}
              onChange={(v) =>
                set((cc) => {
                  cc.branches[i].type = v
                  cc.branches[i].head = v === 'out'
                })
              }
            />
            <Seg<'out' | 'in'>
              value={b.side}
              options={[
                { v: 'out', label: 'außen' },
                { v: 'in', label: 'innen' },
              ]}
              onChange={(v) => set((cc) => (cc.branches[i].side = v))}
            />
            <label className="check small">
              <input type="checkbox" checked={!!b.head} onChange={(e) => set((cc) => (cc.branches[i].head = e.target.checked))} /> Spitze
            </label>
            <button className="icon-btn" data-tip="Entfernen" onClick={() => set((cc) => cc.branches.splice(i, 1))}>
              <Icon name="trash" size={15} />
            </button>
          </div>
          <RichField value={b.label ?? ''} baseSize={stationLabelSize(doc).size} placeholder={b.type === 'in' ? 'Edukt, z. B. R–X' : 'Produkt'} onCommit={(v) => set((cc) => (cc.branches[i].label = richPlain(v).trim() ? v : undefined))} />
        </div>
      ))}
      <div className="insp-label">Schrittbezeichnungen (z. B. „oxidative Addition“) – auch per Doppelklick auf einen Bogen</div>
      {(c.arcLabels ?? []).map((al, i) => (
        <div key={al.id} className="cyc-branch">
          <div className="cyc-row">
            <Seg<'in' | 'out'>
              value={al.side}
              options={[
                { v: 'in', label: 'innen' },
                { v: 'out', label: 'außen' },
              ]}
              onChange={(v) => set((cc) => (cc.arcLabels![i].side = v))}
            />
            <button className="icon-btn" data-tip="Entfernen" onClick={() => set((cc) => cc.arcLabels!.splice(i, 1))}>
              <Icon name="trash" size={15} />
            </button>
          </div>
          <RichField value={al.label} baseSize={stationLabelSize(doc).size} placeholder="Schritt" onCommit={(v) => set((cc) => (cc.arcLabels![i].label = v))} />
        </div>
      ))}
      {(c.links ?? []).length > 0 && (
        <>
          <div className="insp-label">Verbindungspfeile (ältere Darstellung)</div>
          {(c.links ?? []).map((l, i) => (
            <div key={l.id} className="cyc-row">
              <span className="muted small">Verbindung {i + 1}</span>
              <button className="icon-btn" data-tip="Verbindung entfernen" onClick={() => set((cc) => cc.links!.splice(i, 1))}>
                <Icon name="trash" size={15} />
              </button>
            </div>
          ))}
        </>
      )}
      <div className="cyc-add">
        <button className="btn small" onClick={() => set((cc) => cc.stations.push({ angle: 45 }))}>
          + Station
        </button>
        <button className="btn small" onClick={() => set((cc) => cc.branches.push(newBranch(cc.stations.length ? (cc.stations[0].angle + 360 / (2 * Math.max(1, cc.stations.length))) % 360 : 0, 'in', r)))}>
          + Zufluss
        </button>
        <button className="btn small" onClick={() => set((cc) => cc.branches.push(newBranch(cc.stations.length ? (cc.stations[cc.stations.length - 1].angle + 360 / (2 * Math.max(1, cc.stations.length))) % 360 : 180, 'out', r)))}>
          + Abfluss
        </button>
        <button
          className="btn small"
          onClick={() =>
            set((cc) => {
              // zwischen den ersten beiden Stationen (bzw. oben rechts)
              const st = [...cc.stations].map((x) => x.angle).sort((a2, b2) => a2 - b2)
              const ang = st.length > 1 ? (st[0] + st[1]) / 2 : -45
              cc.arcLabels = [...(cc.arcLabels ?? []), { ...newArcLabel(ang, 'in'), label: 'Schritt' }]
            })
          }
        >
          + Schritt
        </button>
      </div>
      <button
        className="btn small wide"
        data-tip="Kleineren, gegenläufigen Zyklus oben rechts überlappend anhängen (wie Cu-Zyklus bei der Sonogashira-Kupplung). Gezielt: Modus „2. Zyklus“ und auf den Kreis klicken"
        onClick={() => {
          const nc = attachCycle(c, -45)
          commit((d) => {
            d.cycles[nc.id] = nc
          })
          setState({ sel: { ...emptySelection(), cycles: [nc.id] } })
        }}
      >
        Zweiten Zyklus anhängen
      </button>
    </Section>
  )
}

/** Ausgewählte Ansatztabelle: öffnen, Sprache, Schriftgröße */
function TableSection({ id }: { id: string }) {
  const t = useStore((s) => s.doc.tables[id])
  const open = useStore((s) => s.tableEditor === id)
  const docFont = useStore((s) => s.doc.style.fontSize)
  if (!t) return null
  // gespeichert wird ein Faktor; angezeigt und eingegeben wird die tatsächliche Schriftgröße der Tabelle
  const base = docFont * TABLE_FONT_FACTOR
  const set = (f: (x: typeof t) => void) =>
    commit((d) => {
      const x = d.tables[id]
      if (x) f(x)
    })
  return (
    <Section id="table" title="Ansatztabelle">
      <div className="cyc-add">
        <button className="btn small" onClick={() => setState({ tableEditor: open ? null : id })} data-tip="Mengen, Einheiten, Lösungsmittel und Bedingungen bearbeiten (auch per Doppelklick auf die Tabelle)">
          <Icon name="table" size={14} /> {open ? 'Editor schließen' : 'Bearbeiten'}
        </button>
      </div>
      <Row label="Sprache">
        <div className="seg">
          {(['de', 'en'] as const).map((l) => (
            <button key={l} className={t.lang === l ? 'active' : ''} onClick={() => set((x) => (x.lang = l))}>
              {l === 'de' ? 'Deutsch' : 'English'}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Schriftgröße">
        <NumSlider min={0.6} max={1.6} step={0.05} scale={base} digits={1} inputMin={0.2} inputMax={4} value={t.scale ?? 1} def={1} onChange={(v) => set((x) => (x.scale = Math.abs(v - 1) < 1e-6 ? undefined : v))} />
      </Row>
      <p className="muted small">{`${t.rows.length} Stoffe · Werte mit Struktur verknüpft (⚭) folgen Änderungen an der Zeichnung.`}</p>
    </Section>
  )
}

/** Isotopenmuster (M, M+1, M+2 …) als kleine Balken: Masse und relative Intensität, Peaks ab 0,5 % */
function IsoBars({ natural, labeled }: { natural: Record<string, number>; labeled: { el: string; nominal: number }[] }) {
  const peaks = useMemo(() => isotopePattern(natural, labeled, 0.5), [natural, labeled])
  if (!peaks?.length) return <>–</>
  const base = peaks.reduce((a, b) => (b.rel > a.rel ? b : a)).nominal
  return (
    <div className="iso" title="Berechnet aus den natürlichen Isotopenhäufigkeiten; Massen des neutralen Moleküls (ohne Elektronenmasse)">
      {peaks.slice(0, 12).map((p) => (
        <div key={p.nominal} className="iso-row">
          <span className="iso-m">{fmtDec(p.mass, 4)}</span>
          <span className="iso-bar">
            <span style={{ width: p.rel + '%' }} />
          </span>
          <span className="iso-p">{p.nominal === base ? '100' : fmtDec(p.rel, p.rel >= 10 ? 1 : 2)} %</span>
        </div>
      ))}
    </div>
  )
}
