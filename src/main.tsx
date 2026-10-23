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

// Nur in der Entwicklung: Zugriff für Tests über die Browser-Konsole
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__app = { store, actions, scene, types }
}

// Desktop-App: Menüleiste, Dateien, Fenster (im Browser ohne Wirkung)
startDesktop()
startFileDrop()
startSession()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
