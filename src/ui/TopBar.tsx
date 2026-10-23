import { lsGet, lsSet } from '../storage'
import { useSyncExternalStore } from 'react'
import { redo, setState, toggleInspector, undo, useStore } from '../store'
import { fitView, zoomTo } from '../tools/actions'
import { newDocument, openFile, saveDocument } from '../tools/io'
import { Icon } from './Icons'
import { useAiStatus } from '../tools/aiBridge'

function Btn({ icon, title, onClick, disabled, label, active }: { icon: string; title: string; onClick: () => void; disabled?: boolean; label?: string; active?: boolean }) {
  return (
    <button className={'top-btn' + (label ? ' with-label' : '') + (active ? ' on' : '')} onClick={onClick} disabled={disabled} data-tip={title} aria-label={title}>
      <Icon name={icon} size={18} />
      {label && <span>{label}</span>}
    </button>
  )
}

// Hell/Dunkel: gemeinsamer Zustand für Knopf und Menüleiste (Desktop-App)
type Theme = 'light' | 'dark'
let theme: Theme = (() => {
  const t = lsGet('openmol:theme')
  if (t === 'light' || t === 'dark') return t
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
})()
document.documentElement.dataset.theme = theme
const themeListeners = new Set<() => void>()

export function setTheme(t: Theme) {
  theme = t
  document.documentElement.dataset.theme = t
  lsSet('openmol:theme', t)
  for (const l of themeListeners) l()
}

export const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark')

export function useTheme() {
  const t = useSyncExternalStore(
    (cb) => {
      themeListeners.add(cb)
      return () => themeListeners.delete(cb)
    },
    () => theme,
  )
  return [t, setTheme] as const
}

export function TopBar() {
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const zoom = useStore((s) => s.view.zoom)
  const fileName = useStore((s) => s.fileName)
  const [theme, setTheme] = useTheme()
  const inspectorHidden = useStore((s) => s.inspectorHidden)
  const aiStatus = useAiStatus()
  return (
    <header className="topbar">
      <div className="brand">
        {/* App-Icon (wie build/icon.svg, ohne Schatten) */}
        <svg width="26" height="26" viewBox="100 100 824 824" aria-hidden="true">
          <defs>
            <linearGradient id="om-logo-bg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#5ca6fa" />
              <stop offset="0.5" stopColor="#2f6be3" />
              <stop offset="1" stopColor="#153a9f" />
            </linearGradient>
          </defs>
          <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#om-logo-bg)" />
          <g fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round">
            <path d="M730 448 L730 662 L499 795 L268 662 L268 395 L499 261 L575 305" strokeWidth="44" />
            <path d="M499 383 L499 531 M499 531 L371 604 M499 531 L627 604" strokeWidth="26" />
          </g>
          <g fill="#fff">
            <circle cx="499" cy="383" r="34" />
            <circle cx="499" cy="531" r="46" />
            <circle cx="371" cy="604" r="42" />
            <circle cx="627" cy="604" r="42" />
            <path d="M724 252 C731 301 751 319 802 326 C751 333 731 351 724 400 C717 351 697 333 646 326 C697 319 717 301 724 252 Z" stroke="#fff" strokeWidth="14" strokeLinejoin="round" />
          </g>
        </svg>
        <span className="brand-name">OpenMol</span>
        <input
          className="file-name"
          value={fileName}
          onChange={(e) => setState({ fileName: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          aria-label="Dokumentname"
          spellCheck={false}
        />
      </div>
      <div className="top-group">
        <Btn icon="new" title="Neu" onClick={() => void newDocument()} />
        <Btn icon="open" title="Öffnen (⌘O) – Dokument, Molfile oder SMILES" onClick={() => void openFile()} />
        <Btn icon="save" title="Speichern (⌘S)" onClick={() => void saveDocument()} />
        <div className="top-sep" />
        <Btn icon="import" title="Struktur importieren (SMILES, Molfile, Name)" label="Import" onClick={() => setState({ dialog: 'import' })} />
        <Btn icon="export" title="Exportieren (⌘E)" label="Export" onClick={() => setState({ dialog: 'export' })} />
        <div className="top-sep" />
        <Btn icon="undo" title="Rückgängig (⌘Z)" onClick={undo} disabled={!canUndo} />
        <Btn icon="redo" title="Wiederholen (⇧⌘Z)" onClick={redo} disabled={!canRedo} />
      </div>
      <div className="top-group right">
        <Btn icon="zoomOut" title="Verkleinern" onClick={() => zoomTo(zoom / 1.25)} />
        <button className="zoom-val" onClick={() => zoomTo(1)} data-tip="Auf 100 % setzen">
          {Math.round(zoom * 100)} %
        </button>
        <Btn icon="zoomIn" title="Vergrößern" onClick={() => zoomTo(zoom * 1.25)} />
        <Btn icon="fit" title="Einpassen (⌘0)" onClick={() => fitView()} />
        <div className="top-sep" />
        <Btn icon={theme === 'dark' ? 'sun' : 'moon'} title={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
        <Btn icon="sidebar" title={inspectorHidden ? 'Inspektor einblenden (⌘\\)' : 'Inspektor ausblenden (⌘\\) – mehr Platz für die Zeichnung'} onClick={() => toggleInspector()} active={!inspectorHidden} />
        {aiStatus !== 'off' && (
          <button
            className={'ai-pill' + (aiStatus === 'connected' ? ' on' : '')}
            onClick={() => setState({ dialog: 'settings' })}
            data-tip={aiStatus === 'connected' ? 'Eine KI-Anwendung ist über MCP verbunden und kann die Zeichnung bearbeiten' : 'Warte auf eine KI-Anwendung (OpenMol-MCP-Server)'}
          >
            {aiStatus === 'connected' ? '● KI' : '○ KI'}
          </button>
        )}
        <Btn icon="settings" label="Einstellungen" title="Einstellungen (⌘,) – Dezimaltrennzeichen, Sprache, Inspektor, KI-Steuerung (MCP)" onClick={() => setState({ dialog: 'settings' })} />
        <Btn icon="help" title="Tastenkürzel & Hilfe (?)" onClick={() => setState({ dialog: 'help' })} />
      </div>
    </header>
  )
}
