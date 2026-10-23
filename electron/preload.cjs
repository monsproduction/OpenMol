// Schmale Brücke zwischen Oberfläche und Hauptprozess: nur diese Funktionen sind in der Oberfläche als
// window.openmol sichtbar (kein Node, kein Dateisystem direkt).
const { contextBridge, ipcRenderer } = require('electron')

const on = (channel) => (cb) => {
  const h = (_e, ...args) => cb(...args)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

contextBridge.exposeInMainWorld('openmol', {
  isDesktop: true,
  platform: process.platform,
  // gespeicherte Einstellungen/Daten (Dateien im App-Ordner); einmal beim Start komplett laden, dann schreiben
  store: {
    all: () => ipcRenderer.sendSync('openmol:store-all'),
    set: (key, value) => ipcRenderer.send('openmol:store-set', key, value),
    dir: () => ipcRenderer.sendSync('openmol:store-dir'),
  },
  openDialog: (opts) => ipcRenderer.invoke('openmol:open-dialog', opts),
  readPath: (p) => ipcRenderer.invoke('openmol:read-path', p),
  saveDialog: (opts) => ipcRenderer.invoke('openmol:save-dialog', opts),
  writeFile: (p, data) => ipcRenderer.invoke('openmol:write-file', p, data),
  setDocState: (s) => ipcRenderer.send('openmol:doc-state', s),
  closeOk: () => ipcRenderer.send('openmol:close-ok'),
  closeCancel: () => ipcRenderer.send('openmol:close-cancel'),
  openExternal: (url) => ipcRenderer.invoke('openmol:open-external', url),
  confirm: (opts) => ipcRenderer.invoke('openmol:confirm', opts),
  nativeEdit: (cmd) => ipcRenderer.send('openmol:native-edit', cmd),
  setUiLang: (l) => ipcRenderer.send('openmol:ui-lang', l),
  showSettingsDir: () => ipcRenderer.send('openmol:show-settings-dir'),
  mcpInfo: () => ipcRenderer.sendSync('openmol:mcp-info'),
  onMenu: on('openmol:menu'),
  onOpenPath: on('openmol:open-path'),
  onCloseRequest: on('openmol:close-request'),
})
