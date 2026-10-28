import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import * as store from './store'
import * as actions from './tools/actions'
import * as scene from './model/scene'
import * as types from './model/types'
import { startDesktop } from './desktopApp'
import { startFileDrop } from './fileDrop'
import { startSession } from './session'
import { syncReactionLinks } from './model/reactionLink'
import { pruneGroups } from './model/groups'
import { newDoc } from './defaultStyle'
import { propagateMolScale } from './model/molscale'
import { pruneGradients } from './model/gradients'

// Nur in der Entwicklung: Zugriff für Tests über die Browser-Konsole
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__app = { store, actions, scene, types }
}

// neue Dokumente mit dem Standard-Dokumentstil aus den Einstellungen; das Startdokument ebenso, solange es leer ist
store.setNewDocFactory(newDoc)
{
  const st = store.getState()
  const d = st.doc
  const blank = !Object.keys(d.atoms).length && !Object.keys(d.texts).length && !Object.keys(d.arrows).length && !Object.keys(d.shapes).length && !Object.keys(d.tables ?? {}).length && !Object.keys(d.cycles ?? {}).length
  if (blank && !st.filePath && !st.dirty) store.setState({ doc: newDoc() })
}

// bei jeder Änderung: Ansatztabellen mit verknüpftem Reaktionspfeil abgleichen, Gruppen/Sperrliste aufräumen
store.setCommitHook((d, before) => {
  syncReactionLinks(d)
  pruneGroups(d)
  // an skalierte Moleküle neu gezeichnete Atome übernehmen deren Größe
  propagateMolScale(d, before)
  pruneGradients(d)
})

// Desktop-App: Menüleiste, Dateien, Fenster (im Browser ohne Wirkung)
startDesktop()
startFileDrop()
startSession()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
