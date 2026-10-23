// Desktop-App (Electron): Menüleiste, Fenstertitel, Nachfrage beim Schließen, Dateien aus dem Finder.
// Wird nur gestartet, wenn die Oberfläche in der Desktop-App läuft (siehe main.tsx).
import { desktop } from './desktop'
import { getSettings, subscribeSettings } from './settings'
import { getState, redo, setState, setTool, subscribe, toggleInspector, undo } from './store'
import {
  cleanStructure,
  contractGroups,
  copySelection,
  deleteSelection,
  duplicateSelection,
  expandGroups,
  fitView,
  insertAnalysis,
  selectAll,
  toggle3D,
  zoomTo,
} from './tools/actions'
import { cleanReaction } from './tools/cleanup'
import { exportCdxml } from './tools/cdxml'
import { confirmDiscard, copyImageToClipboard, currentFilePath, exportMolfile, exportPng, exportSvg, newDocument, openFile, openText, saveDocument } from './tools/io'
import { toggleTheme } from './ui/TopBar'

/** Fokus in einem Eingabefeld/bearbeitbaren Text: dort gelten die System-Befehle (Kopieren, Einfügen …) */
function editingText(): boolean {
  const el = document.activeElement as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

const EDIT_CMDS = new Set(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'delete'])

/** Befehl aus der Menüleiste ausführen – mit denselben Funktionen wie Knöpfe und Tastenkürzel */
export function runMenuCommand(cmd: string) {
  if (EDIT_CMDS.has(cmd) && editingText()) {
    desktop?.nativeEdit(cmd)
    return
  }
  // in einem offenen Dialog nur Bearbeiten-Befehle des Systems und Fenster-Befehle
  if (getState().dialog && !['settings', 'help'].includes(cmd)) return
  const zoom = getState().view.zoom
  const run: Record<string, () => unknown> = {
    new: newDocument,
    open: openFile,
    save: () => saveDocument(),
    saveAs: () => saveDocument(true),
    import: () => setState({ dialog: 'import' }),
    exportDialog: () => setState({ dialog: 'export' }),
    exportPng: () => exportPng(),
    exportSvg: () => exportSvg(),
    exportMol: exportMolfile,
    exportCdxml,
    settings: () => setState({ dialog: 'settings' }),
    help: () => setState({ dialog: 'help' }),
    settingsDir: () => desktop?.showSettingsDir(),
    undo,
    redo,
    cut: () => copySelection(true),
    copy: () => copySelection(false),
    // Einfügen läuft über das paste-Ereignis der Seite (System-Zwischenablage, auch Bilder/Text von außen)
    paste: () => desktop?.nativeEdit('paste'),
    copyImage: () => copyImageToClipboard(),
    duplicate: duplicateSelection,
    delete: deleteSelection,
    selectAll: () => {
      selectAll()
      setTool('select')
    },
    cleanStructure,
    cleanReaction,
    toggle3d: toggle3D,
    contract: contractGroups,
    expand: expandGroups,
    nameToStructure: () => setState({ dialog: 'import' }),
    structureToName: () => insertAnalysis(['name']),
    anFormula: () => insertAnalysis(['formula']),
    anMw: () => insertAnalysis(['mw']),
    anExact: () => insertAnalysis(['exact']),
    anAll: () => insertAnalysis(['name', 'formula', 'exact', 'mw']),
    fit: () => fitView(),
    zoomIn: () => zoomTo(zoom * 1.25),
    zoomOut: () => zoomTo(zoom / 1.25),
    zoom100: () => zoomTo(1),
    inspector: () => toggleInspector(),
    theme: toggleTheme,
  }
  const f = run[cmd]
  if (f) void f()
}

let started = false
export function startDesktop() {
  if (!desktop || started) return
  started = true
  document.documentElement.classList.add('desktop')

  // Fenstertitel: Dateiname, „bearbeitet“-Punkt im Schließen-Knopf (macOS), Datei im Titel per ⌘-Klick
  let last = ''
  const sync = () => {
    const { fileName, dirty } = getState()
    const s = { title: fileName || 'Unbenannt', dirty, path: currentFilePath() ?? undefined }
    const key = JSON.stringify(s)
    if (key === last) return
    last = key
    desktop!.setDocState(s)
  }
  subscribe(sync)
  sync()

  desktop.onMenu(runMenuCommand)
  desktop.onOpenPath(async (p) => {
    try {
      const f = await desktop!.readPath(p)
      await openText(f.name, f.text, f.path)
    } catch (e) {
      console.warn('Datei konnte nicht geöffnet werden', p, e)
    }
  })
  desktop.onCloseRequest(async () => {
    if (await confirmDiscard()) desktop!.closeOk()
    else desktop!.closeCancel()
  })

  // Menüleiste in der Sprache der Oberfläche
  let lang = getSettings().uiLang
  desktop.setUiLang(lang)
  subscribeSettings(() => {
    if (getSettings().uiLang === lang) return
    lang = getSettings().uiLang
    desktop!.setUiLang(lang)
  })
}
