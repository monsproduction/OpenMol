import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { QUICK_GROUPS } from '../model/abbrev'
import type { ArrowKind, ArrowRoute, BondType, ShapeKind } from '../model/types'
import { selectionSize } from '../model/types'
import { setState, setTool, useStore, type ToolId } from '../store'
import { alignSelection, clean3D, cleanStructure, flatten3D, flip, numberCompounds, rotate, rotate3D, skew, tilt } from '../tools/actions'
import { cleanReaction } from '../tools/cleanup'
import { FillOptions } from './FillOptions'
import { Icon } from './Icons'

interface RailItem {
  tools: ToolId[]
  icon: string | ((s: ReturnType<typeof useToolState>) => string)
  title: string
  key?: string
}

function useToolState() {
  const tool = useStore((s) => s.tool)
  const opts = useStore((s) => s.opts)
  return { tool, opts }
}

const BOND_TYPES: { t: BondType; icon: string; name: string; key: string }[] = [
  { t: 'single', icon: 'single', name: 'Einfachbindung', key: '1' },
  { t: 'double', icon: 'double', name: 'Doppelbindung', key: '2' },
  { t: 'triple', icon: 'triple', name: 'Dreifachbindung', key: '3' },
  { t: 'wedge', icon: 'wedge', name: 'Keil (nach vorn)', key: 'W' },
  { t: 'hash', icon: 'hash', name: 'Schraffiert (nach hinten)', key: 'H' },
  { t: 'wavy', icon: 'wavy', name: 'Wellenlinie (unbestimmt)', key: '' },
  { t: 'bold', icon: 'bold', name: 'Fett', key: '' },
  { t: 'dashed', icon: 'dashed', name: 'Gestrichelt (partiell)', key: '' },
  { t: 'aromatic', icon: 'aromatic', name: 'Delokalisiert', key: '' },
]

const ARROWS: { k: ArrowKind; icon: string; name: string }[] = [
  { k: 'reaction', icon: 'reaction', name: 'Reaktionspfeil' },
  { k: 'equilibrium', icon: 'equilibrium', name: 'Gleichgewicht' },
  { k: 'resonance', icon: 'resonance', name: 'Mesomerie' },
  { k: 'retro', icon: 'retro', name: 'Retrosynthese' },
  { k: 'dashed', icon: 'dashed-arrow', name: 'Gestrichelt' },
  { k: 'failed', icon: 'failed', name: 'Keine Reaktion' },
]

const SHAPES: { k: ShapeKind; icon: string; name: string }[] = [
  { k: 'brackets', icon: 'brackets', name: 'Eckige Klammern' },
  { k: 'parens', icon: 'parens', name: 'Runde Klammern' },
  { k: 'braces', icon: 'braces', name: 'Geschweifte Klammern' },
  { k: 'rect', icon: 'rect', name: 'Rechteck' },
  { k: 'roundrect', icon: 'roundrect', name: 'Rechteck mit runden Ecken' },
  { k: 'ellipse', icon: 'ellipse', name: 'Ellipse' },
  { k: 'sphere', icon: 'sphere', name: 'Kugel (3D-schattiert)' },
]

const ELECTRON_TOOLS: { t: ToolId; icon: string; name: string }[] = [
  { t: 'charge+', icon: 'charge+', name: 'Positive Ladung' },
  { t: 'charge-', icon: 'charge-', name: 'Negative Ladung' },
  { t: 'lonepair', icon: 'lonepair', name: 'Freies Elektronenpaar' },
  { t: 'radical', icon: 'radical', name: 'Radikal' },
  { t: 'partial+', icon: 'partial+', name: 'Partialladung δ+' },
  { t: 'partial-', icon: 'partial-', name: 'Partialladung δ−' },
]

export const ATTACH = '⁓attach'

const ROUTES: { k: ArrowRoute; icon: string; name: string }[] = [
  { k: 'straight', icon: 'reaction', name: 'Gerader Pfeil' },
  { k: 'elbow-h', icon: 'elbow', name: 'Winkelpfeil (erst waagerecht)' },
  { k: 'elbow-v', icon: 'elbow-v', name: 'Winkelpfeil (erst senkrecht)' },
  { k: 'step-h', icon: 'step-h', name: 'Stufenpfeil (waagerecht – senkrecht – waagerecht)' },
  { k: 'step-v', icon: 'step-v', name: 'Stufenpfeil (senkrecht – waagerecht – senkrecht)' },
  { k: 'bracket-h', icon: 'bracket-h', name: 'Klammerpfeil (seitlich hinaus und zurück, z. B. 3 → 1 untereinander)' },
  { k: 'bracket-v', icon: 'bracket-v', name: 'Klammerpfeil (nach oben/unten hinaus und zurück)' },
]

const HEADS: { k: 'end' | 'both' | 'none' | 'start'; icon: string; name: string }[] = [
  { k: 'end', icon: 'reaction', name: 'Spitze am Ende' },
  { k: 'start', icon: 'heads-start', name: 'Spitze am Anfang' },
  { k: 'both', icon: 'heads-both', name: 'Spitzen an beiden Enden' },
  { k: 'none', icon: 'heads-none', name: 'Ohne Spitze (Verbindungslinie)' },
]

const QUICK_ELEMENTS = ['H', 'C', 'N', 'O', 'S', 'P', 'F', 'Cl', 'Br', 'I', 'B', 'Si', 'Li', 'Na', 'K', 'Mg']

const RAIL: (RailItem | 'sep')[] = [
  { tools: ['select', 'lasso'], icon: (s) => (s.tool === 'lasso' ? 'lasso' : 'select'), title: 'Auswählen', key: 'V' },
  { tools: ['eraser'], icon: 'eraser', title: 'Radierer', key: 'E' },
  { tools: ['pan'], icon: 'pan', title: 'Ansicht verschieben', key: 'Leertaste' },
  { tools: ['rotate3d'], icon: 'rot3d', title: '3D drehen (Ziehen dreht im Raum)' },
  'sep',
  {
    tools: ['bond'],
    icon: (s) => BOND_TYPES.find((b) => b.t === s.opts.bondType)?.icon ?? 'single',
    title: 'Bindungen',
    key: '1 / 2 / 3',
  },
  { tools: ['chain'], icon: 'chain', title: 'Kette', key: 'K' },
  {
    tools: ['ring'],
    icon: (s) =>
      s.opts.ringKind === 'chair1' || s.opts.ringKind === 'chair2'
        ? s.opts.ringKind
        : s.opts.ringKind === 'cp'
          ? 'cyclopentadiene'
          : s.opts.ringSize === 6 && s.opts.ringAromatic
            ? 'benzene'
            : 'ring' + s.opts.ringSize,
    title: 'Ringe',
    key: 'R',
  },
  { tools: ['atom'], icon: 'atom', title: 'Atome & Gruppen' },
  {
    tools: ['charge+', 'charge-', 'lonepair', 'radical', 'partial+', 'partial-'],
    icon: (s) => (ELECTRON_TOOLS.some((e) => e.t === s.tool) ? s.tool : 'charge+'),
    title: 'Ladungen & Elektronen',
    key: '+ / −',
  },
  'sep',
  {
    tools: ['arrow'],
    icon: (s) => ARROWS.find((a) => a.k === s.opts.arrowKind)?.icon ?? 'reaction',
    title: 'Reaktionspfeile',
    key: 'A',
  },
  {
    tools: ['curved'],
    icon: (s) => (s.opts.curvedHead === 'half' ? 'curved-half' : 'curved-full'),
    title: 'Mechanismuspfeile (Elektronenfluss)',
    key: 'M',
  },
  { tools: ['plus'], icon: 'plus', title: 'Plus-Zeichen' },
  { tools: ['text'], icon: 'text', title: 'Text', key: 'T' },
  { tools: ['shape'], icon: (s) => SHAPES.find((x) => x.k === s.opts.shapeKind)?.icon ?? 'brackets', title: 'Klammern & Formen' },
  { tools: ['cycle'], icon: 'cycle', title: 'Katalysezyklus (Kreislauf mit Stationen, Zu- und Abflüssen)' },
  { tools: ['ringfill'], icon: 'ringfill', title: 'Ringfüllung & Farbverlauf' },
  'sep',
  { tools: ['template'], icon: 'template', title: 'Vorlagen-Bibliothek' },
]

/** Drehen um eine eingegebene Gradzahl (positiv = im Uhrzeigersinn, z. B. −30 = 30° gegen den Uhrzeigersinn) */
function RotateInput() {
  const [v, setV] = useState('')
  const apply = () => {
    const deg = parseFloat(v.replace(',', '.').replace('−', '-'))
    if (!Number.isFinite(deg) || deg === 0) return
    rotate(deg)
  }
  return (
    <label className="rot-input" data-tip="Um Gradzahl drehen: positiv = im Uhrzeigersinn, negativ = gegen den Uhrzeigersinn (Enter)">
      <input
        type="text"
        inputMode="decimal"
        value={v}
        placeholder="z. B. −30"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') apply()
          if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
        }}
      />
      <span>°</span>
      <button className="opt-btn small" onMouseDown={(e) => e.preventDefault()} onClick={apply}>
        Drehen
      </button>
    </label>
  )
}

/** Größe der Werkzeugknöpfe so wählen, dass immer alle Werkzeuge ohne Scrollen sichtbar sind (notfalls zweispaltig) */
function railFit(avail: number): { size: number; cols: 1 | 2 } {
  const groups: number[] = [0]
  for (const it of RAIL) {
    if (it === 'sep') groups.push(0)
    else groups[groups.length - 1]++
  }
  const SEP = 11 // Trennlinie 1px + 2×4px Rand + Abstand
  const GAP = 2
  const rowsFor = (cols: number) => groups.reduce((n, g) => n + Math.ceil(g / cols), 0)
  const sizeFor = (cols: number) => {
    const rows = rowsFor(cols)
    return Math.floor((avail - (groups.length - 1) * SEP - rows * GAP) / rows)
  }
  const one = Math.min(40, sizeFor(1))
  if (one >= 30) return { size: one, cols: 1 }
  return { size: Math.max(22, Math.min(40, sizeFor(2))), cols: 2 }
}

export function Rail() {
  const ts = useToolState()
  const ref = useRef<HTMLElement>(null)
  const [fit, setFit] = useState<{ size: number; cols: 1 | 2 }>({ size: 40, cols: 1 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const next = railFit(el.clientHeight - 16)
      setFit((f) => (f.size === next.size && f.cols === next.cols ? f : next))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const { size, cols } = fit
  return (
    <nav
      ref={ref}
      className="rail"
      aria-label="Werkzeuge"
      style={{ width: cols * size + (cols - 1) * 2 + 16, gridTemplateColumns: `repeat(${cols}, ${size}px)` }}
    >
      {RAIL.map((it, i) => {
        if (it === 'sep') return <div key={i} className="rail-sep" />
        const active = it.tools.includes(ts.tool)
        const icon = typeof it.icon === 'function' ? it.icon(ts) : it.icon
        return (
          <button
            key={i}
            className={'rail-btn' + (active ? ' active' : '')}
            style={{ width: size, height: size, borderRadius: Math.round(size / 4) }}
            data-tip={it.title + (it.key ? `  (${it.key})` : '')}
            aria-label={it.title}
            onClick={() => {
              if (it.tools[0] === 'template') {
                setTool('template')
                setState({ dialog: 'templates' })
                return
              }
              if (active) return
              setTool(it.tools[0])
            }}
          >
            <Icon name={icon} size={Math.max(15, Math.round(size * 0.55))} />
          </button>
        )
      })}
    </nav>
  )
}

function OptBtn({ active, onClick, icon, title, label }: { active?: boolean; onClick: () => void; icon?: string; title: string; label?: string }) {
  return (
    <button className={'opt-btn' + (active ? ' active' : '') + (label && !icon ? ' text' : '')} onClick={onClick} data-tip={title} aria-label={title}>
      {icon && <Icon name={icon} size={18} />}
      {label && <span>{label}</span>}
    </button>
  )
}

// aktueller Werkzeughinweis – bei schmalem Fenster zeigt ihn die Statusleiste (in der Optionsleiste ist dann kein Platz)
let toolHint = ''
const hintListeners = new Set<() => void>()
export function useToolHint() {
  return useSyncExternalStore(
    (l) => {
      hintListeners.add(l)
      return () => hintListeners.delete(l)
    },
    () => toolHint,
  )
}

export function OptionsBar() {
  const { tool, opts } = useToolState()
  const sel = useStore((s) => s.sel)
  const hasSel = selectionSize(sel) > 0
  const [custom, setCustom] = useState('')

  let content: React.ReactNode = null
  let hint = ''
  switch (tool) {
    case 'select':
    case 'lasso':
      content = (
        <>
          <OptBtn icon="select" title="Rechteck-Auswahl" active={tool === 'select'} onClick={() => setTool('select')} />
          <OptBtn icon="lasso" title="Lasso-Auswahl" active={tool === 'lasso'} onClick={() => setTool('lasso')} />
          <OptBtn
            icon="magnet"
            title={'Magnetische Hilfslinien ' + (opts.snap ? 'an' : 'aus') + ' (beim Ziehen ⌘/Strg halten = kurz aus)'}
            active={opts.snap}
            onClick={() => setTool(tool, { snap: !opts.snap })}
          />
          <div className="opt-sep" />
          <OptBtn icon="rotateL" title="90° nach links drehen" onClick={() => rotate(-90)} />
          <OptBtn icon="rotateR" title="90° nach rechts drehen" onClick={() => rotate(90)} />
          <RotateInput />
          <OptBtn icon="flipH" title="Horizontal spiegeln" onClick={() => flip('h')} />
          <OptBtn icon="flipV" title="Vertikal spiegeln" onClick={() => flip('v')} />
          <OptBtn icon="clean" title="Struktur bereinigen (Layout neu berechnen)" onClick={cleanStructure} />
          <OptBtn icon="arrange" title="Reaktion aufräumen (Clean up Reaction, auch Kaskaden)" onClick={cleanReaction} />
          <div className="opt-sep" />
          <OptBtn icon="tiltX" title="3D: um waagerechte Achse drehen" onClick={() => tilt('x', 20)} />
          <OptBtn icon="tiltY" title="3D: um senkrechte Achse drehen" onClick={() => tilt('y', 20)} />
          <OptBtn icon="cube" title="3D bereinigen (räumliche Struktur berechnen, z. B. Cycloparaphenylene)" onClick={() => void clean3D()} />
          <OptBtn icon="flat" title="Zurück zu 2D (ursprüngliche Zeichnung vor dem 3D-Schritt)" onClick={flatten3D} />
          <OptBtn icon="skew" title="Neigen (Scherung)" onClick={() => skew(12)} />
          <OptBtn icon="number" title="Verbindungsnummern unter ausgewählte Moleküle setzen" onClick={numberCompounds} />
          {hasSel && (
            <>
              <div className="opt-sep" />
              <OptBtn icon="alignL" title="Links ausrichten" onClick={() => alignSelection('left')} />
              <OptBtn icon="alignC" title="Horizontal zentrieren" onClick={() => alignSelection('hcenter')} />
              <OptBtn icon="alignR" title="Rechts ausrichten" onClick={() => alignSelection('right')} />
              <OptBtn icon="alignT" title="Oben ausrichten" onClick={() => alignSelection('top')} />
              <OptBtn icon="alignM" title="Vertikal zentrieren" onClick={() => alignSelection('vcenter')} />
              <OptBtn icon="alignB" title="Unten ausrichten" onClick={() => alignSelection('bottom')} />
            </>
          )}
        </>
      )
      hint = 'Klick = Atom/Bindung · Doppelklick = ganzes Molekül · Ziehen verschiebt die Auswahl · rastet magnetisch ein (⌘ = aus) · Enter = Hotspot für ChemDraw-Tasten (2× Enter = Atom beschriften) · ⌥+Pfeiltasten = drehen · runder Griff = drehen'
      break
    case 'bond':
      content = BOND_TYPES.map((b) => (
        <OptBtn key={b.t} icon={b.icon} title={b.name + (b.key ? `  (${b.key})` : '')} active={opts.bondType === b.t} onClick={() => setTool('bond', { bondType: b.t })} />
      ))
      hint = 'Klick = Bindung anfügen · Ziehen = Richtung wählen · Klick auf Bindung = Bindungsordnung ändern'
      break
    case 'chain':
      hint = 'Ziehen, um eine Zickzack-Kette zu zeichnen – die Zahl zeigt die Anzahl der Bindungen'
      break
    case 'ring':
      content = (
        <>
          {[3, 4, 5, 6, 7, 8].map((n) => (
            <OptBtn
              key={n}
              icon={'ring' + n}
              title={['Cyclopropan', 'Cyclobutan', 'Cyclopentan', 'Cyclohexan', 'Cycloheptan', 'Cyclooctan'][n - 3]}
              active={opts.ringKind === 'regular' && opts.ringSize === n && !(n === 6 && opts.ringAromatic)}
              onClick={() => setTool('ring', { ringSize: n, ringAromatic: false, ringKind: 'regular' })}
            />
          ))}
          <OptBtn icon="chair1" title="Cyclohexan (Sessel)" active={opts.ringKind === 'chair1'} onClick={() => setTool('ring', { ringKind: 'chair1' })} />
          <OptBtn icon="chair2" title="Cyclohexan (Sessel, gespiegelt)" active={opts.ringKind === 'chair2'} onClick={() => setTool('ring', { ringKind: 'chair2' })} />
          <OptBtn icon="cyclopentadiene" title="Cyclopentadien" active={opts.ringKind === 'cp'} onClick={() => setTool('ring', { ringKind: 'cp' })} />
          <OptBtn icon="benzene" title="Benzol" active={opts.ringKind === 'regular' && opts.ringSize === 6 && opts.ringAromatic} onClick={() => setTool('ring', { ringSize: 6, ringAromatic: true, ringKind: 'regular' })} />
        </>
      )
      hint = 'Klick ins Leere = Ring · auf Atom = Spiro/angefügt · auf Bindung = ankondensiert'
      break
    case 'atom':
      content = (
        <>
          {QUICK_ELEMENTS.map((el) => (
            <OptBtn key={el} label={el} title={'Element ' + el} active={!opts.label && opts.element === el} onClick={() => setTool('atom', { element: el, label: null })} />
          ))}
          <OptBtn label="PSE…" title="Periodensystem" onClick={() => setState({ dialog: 'periodic' })} />
          <OptBtn icon="attach" title="Anknüpfungspunkt (Wellenlinie) – Klick auf ein Endatom" active={opts.label === ATTACH} onClick={() => setTool('atom', { label: ATTACH })} />
          <div className="opt-sep" />
          <select
            className="opt-select"
            value={opts.label ?? ''}
            onChange={(e) => setTool('atom', { label: e.target.value || null })}
            data-tip="Gruppen & Abkürzungen"
          >
            <option value="">Gruppe …</option>
            {QUICK_GROUPS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <input
            className="opt-input"
            placeholder="eigenes Label"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && custom.trim()) setTool('atom', { label: custom.trim() })
            }}
          />
        </>
      )
      hint = opts.label === ATTACH ? 'Klick auf ein Endatom macht daraus einen Anknüpfungspunkt (Wellenlinie)' : opts.label ? `Klick auf Atom setzt „${opts.label}“` : `Klick auf Atom setzt ${opts.element} · Tipp: Maus über Atom + Taste (N, O, S, …)`
      break
    case 'charge+':
    case 'charge-':
    case 'lonepair':
    case 'radical':
    case 'partial+':
    case 'partial-':
      content = ELECTRON_TOOLS.map((e) => <OptBtn key={e.t} icon={e.icon} title={e.name} active={tool === e.t} onClick={() => setTool(e.t)} />)
      hint =
        tool === 'lonepair' || tool === 'radical'
          ? 'Klick auf Atom = hinzufügen · Umschalt+Klick = entfernen'
          : 'Klick auf Atom ändert die Ladung'
      break
    case 'arrow':
      content = (
        <>
          {ARROWS.map((a) => (
            <OptBtn key={a.k} icon={a.icon} title={a.name} active={opts.arrowKind === a.k} onClick={() => setTool('arrow', { arrowKind: a.k })} />
          ))}
          <div className="opt-sep" />
          {ROUTES.map((r) => (
            <OptBtn key={r.k} icon={r.icon} title={r.name} active={opts.arrowRoute === r.k} onClick={() => setTool('arrow', { arrowRoute: r.k })} />
          ))}
          <div className="opt-sep" />
          {HEADS.map((h) => (
            <OptBtn key={h.k} icon={h.icon} title={h.name} active={opts.arrowHeads === h.k} onClick={() => setTool('arrow', { arrowHeads: h.k })} />
          ))}
        </>
      )
      hint = 'Ziehen zeichnet den Pfeil (Umschalt = freier Winkel) · Winkelpfeile verbinden auch Strukturen in Kaskaden'
      break
    case 'curved':
      content = (
        <>
          <OptBtn icon="curved-full" title="Elektronenpaar (2 e⁻)" active={opts.curvedHead === 'full'} onClick={() => setTool('curved', { curvedHead: 'full' })} label="2 e⁻" />
          <OptBtn icon="curved-half" title="Einzelelektron (Fischhaken, 1 e⁻)" active={opts.curvedHead === 'half'} onClick={() => setTool('curved', { curvedHead: 'half' })} label="1 e⁻" />
        </>
      )
      hint = 'Von Elektronenpaar/Bindung/Atom zum Ziel ziehen · Krümmung danach am runden Griff anpassen'
      break
    case 'text':
      hint = 'Klick = Text einfügen · Ziffern nach Buchstaben werden automatisch tiefgestellt (H2SO4) · ^ für hochgestellt'
      break
    case 'plus':
      hint = 'Klick setzt ein Plus-Zeichen zwischen Reaktanden'
      break
    case 'shape':
      content = SHAPES.map((s) => <OptBtn key={s.k} icon={s.icon} title={s.name} active={opts.shapeKind === s.k} onClick={() => setTool('shape', { shapeKind: s.k })} />)
      hint = 'Ziehen zeichnet die Form · Umschalt = Kreis/Quadrat · Füllung, Verlauf, Schatten und Klammer-Indizes (‡, n) im Eigenschaften-Panel'
      break
    case 'template':
      content = <OptBtn icon="template" label={opts.templateName || 'Vorlage wählen'} title="Vorlagen-Bibliothek öffnen" onClick={() => setState({ dialog: 'templates' })} />
      hint = opts.templateName ? 'Klick auf die Zeichenfläche fügt die Vorlage ein' : 'Bitte eine Vorlage auswählen'
      break
    case 'ringfill':
      content = (
        <>
          <OptBtn label="Ring" title="Nur den angeklickten Ring füllen (eigener Verlauf)" active={opts.fillScope === 'ring'} onClick={() => setTool('ringfill', { fillScope: 'ring' })} />
          <OptBtn label="Jeder Ring" title="Alle Ringe des Ringsystems füllen – jeder Ring mit eigenem Verlauf" active={opts.fillScope === 'each'} onClick={() => setTool('ringfill', { fillScope: 'each' })} />
          <OptBtn label="Ringsystem" title="Das ganze anellierte Ringsystem mit einem gemeinsamen Verlauf füllen" active={opts.fillScope === 'system'} onClick={() => setTool('ringfill', { fillScope: 'system' })} />
          <div className="opt-sep" />
          <OptBtn icon="eraser" label="Entfernen" title="Ringfüllung entfernen (je nach Bereich: Ring oder ganzes System)" active={opts.fillErase} onClick={() => setTool('ringfill', { fillErase: !opts.fillErase })} />
          <div className="opt-sep" />
          <FillOptions value={{ ...opts.fill, mode: 'fill' }} onChange={(f) => setTool('ringfill', { fill: { ...f, mode: 'fill' }, fillErase: false })} />
        </>
      )
      hint = opts.fillErase
        ? 'Klick auf einen gefüllten Ring entfernt die Füllung'
        : 'Klick = füllen (erneuter Klick auf denselben Ring entfernt) · ⇧+Klick oder Doppelklick = ganzes System mit einem Verlauf'
      break
    case 'rotate3d':
      content = (
        <>
          <OptBtn icon="tiltX" title="Um waagerechte Achse −15°" label="↑" onClick={() => rotate3D('x', -15)} />
          <OptBtn icon="tiltX" title="Um waagerechte Achse +15°" label="↓" onClick={() => rotate3D('x', 15)} />
          <OptBtn icon="tiltY" title="Um senkrechte Achse −15°" label="←" onClick={() => rotate3D('y', -15)} />
          <OptBtn icon="tiltY" title="Um senkrechte Achse +15°" label="→" onClick={() => rotate3D('y', 15)} />
          <div className="opt-sep" />
          <OptBtn icon="cube" label="3D bereinigen" title="Räumliche Struktur mit normalen Bindungslängen berechnen (OpenChemLib, MMFF94)" onClick={() => void clean3D()} />
          <OptBtn icon="flat" label="2D" title="Zurück zu 2D: ursprüngliche Zeichnung vor dem 3D-Drehen wiederherstellen" onClick={flatten3D} />
        </>
      )
      hint = 'Erst Molekül(teil) markieren · Ziehen dreht die Markierung im Raum · Umschalt = in der Ebene · hinten wird grau dargestellt'
      break
    case 'cycle':
      content = (
        <>
          <OptBtn icon="cycle" title="Zyklus aufziehen (Mittelpunkt → Radius)" label="Zeichnen" active={opts.cycleMode === 'draw'} onClick={() => setTool('cycle', { cycleMode: 'draw' })} />
          <OptBtn icon="cyc-station" title="Station (Lücke für eine Zwischenstufe) per Klick auf den Kreis" label="Station" active={opts.cycleMode === 'station'} onClick={() => setTool('cycle', { cycleMode: 'station' })} />
          <OptBtn icon="cyc-in" title="Zufluss (Edukt mündet ein): von außen auf den Kreis ziehen oder auf den Kreis klicken" label="Zufluss" active={opts.cycleMode === 'in'} onClick={() => setTool('cycle', { cycleMode: 'in' })} />
          <OptBtn icon="cyc-out" title="Abfluss (Produkt verlässt den Zyklus): vom Kreis weg ziehen oder auf den Kreis klicken" label="Abfluss" active={opts.cycleMode === 'out'} onClick={() => setTool('cycle', { cycleMode: 'out' })} />
          <OptBtn icon="cyc-pair" title="Durchlauf: Edukt rein und Nebenprodukt raus an derselben Stelle (z. B. Base → [Base]H⁺X⁻)" label="Durchlauf" active={opts.cycleMode === 'pair'} onClick={() => setTool('cycle', { cycleMode: 'pair' })} />
          <OptBtn icon="cyc-second" title="Zweiten Zyklus anhängen: auf die Stelle des Kreises klicken, an der er überlappen soll (kleiner, gegenläufig)" label="2. Zyklus" active={opts.cycleMode === 'second'} onClick={() => setTool('cycle', { cycleMode: 'second' })} />
          <div className="opt-sep" />
          <span className="opt-label">Stationen</span>
          <select className="opt-select" data-tip="Anzahl der Stationen (Zwischenstufen) eines neuen Zyklus" value={opts.cycleStations} onChange={(e) => setTool('cycle', { cycleStations: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <OptBtn icon="cw" title="Im Uhrzeigersinn" active={opts.cycleDir === 'cw'} onClick={() => setTool('cycle', { cycleDir: 'cw' })} />
          <OptBtn icon="ccw" title="Gegen den Uhrzeigersinn" active={opts.cycleDir === 'ccw'} onClick={() => setTool('cycle', { cycleDir: 'ccw' })} />
        </>
      )
      hint = {
        draw: 'Ziehen: Mittelpunkt → Radius · Doppelklick auf einen Bogen = Schrittbezeichnung, auf eine Lücke = Zwischenstufe',
        station: 'Klick auf den Kreis: neue Lücke für eine Zwischenstufe · Alt+Klick entfernt',
        in: 'Von außen auf den Kreis ziehen (oder auf den Kreis klicken) · Doppelklick auf das freie Ende beschriftet',
        out: 'Vom Kreis weg ziehen (oder auf den Kreis klicken) · Doppelklick auf das freie Ende beschriftet',
        pair: 'Klick auf den Kreis: Zufluss + Abfluss an derselben Stelle · Enden mit dem Auswahlwerkzeug verschieben',
        second: 'Klick auf den Kreis: zweiter, kleinerer Zyklus überlappt dort (gegenläufig) – danach frei verschiebbar',
      }[opts.cycleMode]
      break
    case 'eraser':
      hint = 'Klicken oder über Objekte ziehen zum Löschen'
      break
    case 'pan':
      hint = 'Ziehen verschiebt die Ansicht · Strg/⌘ + Mausrad zoomt'
      break
  }
  useEffect(() => {
    toolHint = hint
    hintListeners.forEach((l) => l())
  }, [hint])
  return (
    <div
      className="options-bar"
      // schmale Fenster: Leiste waagerecht scrollbar, Mausrad scrollt seitwärts (sonst wären Knöpfe abgeschnitten)
      onWheel={(e) => {
        const el = e.currentTarget
        if (el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY
      }}
    >
      <div className="opt-group">{content}</div>
      <div className="opt-hint">{hint}</div>
    </div>
  )
}
