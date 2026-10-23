import { StoichEditor } from './ui/StoichEditor'
import { subscribeSettings, useSettings } from './settings'
import { startI18n } from './i18n/i18n'
import { startAiBridge, stopAiBridge } from './tools/aiBridge'
import { useEffect } from 'react'
import { exampleCycle, exampleEsterification, exampleScheme, exampleSN2 } from './model/examples'
import { Canvas } from './render/Canvas'
import { replaceDoc, setState, setTool, useStore } from './store'
import { fitView } from './tools/actions'
import { handleKeyDown, handlePaste } from './tools/keyboard'
import { Dialogs, useFitOnFirstLoad } from './ui/Dialogs'
import { Icon } from './ui/Icons'
import { Inspector } from './ui/Inspector'
import { OptionsBar, Rail, useToolHint } from './ui/Toolbar'
import { TopBar } from './ui/TopBar'
import { Tooltip } from './ui/Tooltip'
import { ContextMenu } from './ui/ContextMenu'
import { desktop } from './desktop'

function Toast() {
  const t = useStore((s) => s.toast)
  if (!t) return null
  return (
    <div className={'toast ' + t.kind} role="status">
      {t.msg}
    </div>
  )
}

function EmptyState() {
  const empty = useStore(
    (s) =>
      !Object.keys(s.doc.atoms).length &&
      !Object.keys(s.doc.texts).length &&
      !Object.keys(s.doc.arrows).length &&
      !Object.keys(s.doc.shapes).length &&
      !Object.keys(s.doc.cycles ?? {}).length &&
      !Object.keys(s.doc.tables ?? {}).length,
  )
  const editing = useStore((s) => s.editing)
  if (!empty || editing) return null
  const load = (d: ReturnType<typeof exampleSN2>, name: string) => {
    replaceDoc(d, name)
    setTool('select')
    setTimeout(() => fitView(1.5), 0)
  }
  return (
    <div className="empty-state">
      <h1>Leere Zeichenfläche</h1>
      <p>Klicke mit dem Bindungswerkzeug irgendwo hin, um anzufangen – oder:</p>
      <div className="empty-actions">
        <button className="btn" onClick={() => setTool('ring', { ringSize: 6, ringAromatic: true })}>
          <Icon name="benzene" size={18} /> Benzolring zeichnen
        </button>
        <button className="btn" onClick={() => setState({ dialog: 'import' })}>
          <Icon name="import" size={18} /> SMILES / Name importieren
        </button>
        <button className="btn" onClick={() => setState({ dialog: 'templates' })}>
          <Icon name="template" size={18} /> Vorlage wählen
        </button>
      </div>
      <p className="muted">Beispiele:</p>
      <div className="empty-actions">
        <button className="btn ghost" onClick={() => load(exampleSN2(), 'SN2-Mechanismus')}>
          SN2-Mechanismus
        </button>
        <button className="btn ghost" onClick={() => load(exampleEsterification(), 'Veresterung')}>
          Fischer-Veresterung
        </button>
        <button className="btn ghost" onClick={() => load(exampleScheme(), 'Syntheseschema')}>
          Syntheseschema mit Farben
        </button>
        <button className="btn ghost" onClick={() => load(exampleCycle(), 'Katalysezyklus')}>
          Katalysezyklus
        </button>
      </div>
    </div>
  )
}

function StatusBar() {
  const doc = useStore((s) => s.doc)
  const sel = useStore((s) => s.sel)
  const nA = Object.keys(doc.atoms).length
  const nB = Object.keys(doc.bonds).length
  const ns = sel.atoms.length + sel.bonds.length + sel.arrows.length + sel.curved.length + sel.texts.length + sel.shapes.length + (sel.cycles?.length ?? 0) + (sel.tables?.length ?? 0)
  const hint = useToolHint()
  return (
    <footer className="statusbar">
      <span>
        {`${nA} Atome · ${nB} Bindungen`}
      </span>
      {ns > 0 && <span>{`${ns} ausgewählt`}</span>}
      <span className="grow status-hint" title={hint}>
        {hint}
      </span>
      <span className="muted autosave-note">{desktop ? 'Automatisch gesichert' : 'Automatisch im Browser gesichert'}</span>
      <button className="link" onClick={() => setState({ dialog: 'help' })}>
        Tastenkürzel (?)
      </button>
    </footer>
  )
}

export default function App() {
  const inspectorHidden = useStore((s) => s.inspectorHidden)
  const { aiControl, uiLang } = useSettings()
  useEffect(() => {
    // KI-Steuerung (MCP): Befehle beim lokalen MCP-Server abholen
    if (aiControl) startAiBridge()
    else stopAiBridge()
    return () => stopAiBridge()
  }, [aiControl])
  useFitOnFirstLoad()
  // Sprache der Oberfläche (Deutsch/Englisch) – folgt den Einstellungen
  useEffect(() => startI18n(subscribeSettings), [])
  useEffect(() => {
    // Entwicklung: http://localhost:5173/?demo=generalprobe baut das Schema aus Screenshots/Probe.png nach
    if (import.meta.env.DEV && new URLSearchParams(location.search).get('demo') === 'ansatz') {
      history.replaceState(null, '', location.pathname)
      void import('./dev/ansatz').then((m) => m.buildAnsatz())
    }
    // Entwicklung: ?demo=nachbau-suzuki usw. – Nachbauten von Schemata aus dem Internet (src/dev/nachbauten.ts)
    const demo = new URLSearchParams(location.search).get('demo') ?? ''
    if (import.meta.env.DEV && demo.startsWith('nachbau-')) {
      history.replaceState(null, '', location.pathname)
      void import('./dev/nachbauten').then((m) => m.buildNachbau(demo.slice(8)))
    }
    if (import.meta.env.DEV && new URLSearchParams(location.search).get('demo') === 'generalprobe') {
      // Parameter entfernen: beim Neuladen nicht erneut aufbauen (würde das gespeicherte Dokument ersetzen)
      history.replaceState(null, '', location.pathname)
      void import('./dev/generalprobe')
        .then((m) => m.buildGeneralprobe())
        .then(() => setTimeout(() => fitView(), 300))
    }
  }, [])
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('paste', handlePaste)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('paste', handlePaste)
    }
  }, [])
  return (
    // Sprachwechsel: Oberfläche neu aufbauen (Zustand liegt im Store und bleibt erhalten)
    <div className="app" key={uiLang}>
      <TopBar />
      <div className="main">
        <Rail />
        <div className="center">
          <OptionsBar />
          <div className="stage">
            <Canvas />
            <EmptyState />
          </div>
          <StoichEditor />
        </div>
        {!inspectorHidden && <Inspector />}
      </div>
      <StatusBar />
      <Dialogs />
      <Toast />
      <ContextMenu />
      <Tooltip />
    </div>
  )
}
