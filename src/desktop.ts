// Brücke zur Desktop-App (Electron, siehe electron/preload.cjs). Im Browser ist `desktop` undefined – dann gelten
// die gewohnten Wege (Downloads, Datei-Auswahl des Browsers, localStorage).

export interface DesktopFile {
  path: string
  name: string
  text: string
}

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface McpInfo {
  command: string
  server: string
  env: Record<string, string>
  available: boolean
}

export interface DesktopApi {
  isDesktop: true
  platform: string
  store: { all: () => Record<string, string>; set: (key: string, value: string | null) => void; dir: () => string }
  openDialog: (opts?: { title?: string; filters?: FileFilter[] }) => Promise<DesktopFile | null>
  readPath: (p: string) => Promise<DesktopFile>
  saveDialog: (opts?: { title?: string; defaultPath?: string; filters?: FileFilter[] }) => Promise<string | null>
  writeFile: (p: string, data: string | Uint8Array) => Promise<boolean>
  setDocState: (s: { title: string; dirty: boolean; path?: string }) => void
  closeOk: () => void
  closeCancel: () => void
  openExternal: (url: string) => Promise<void>
  confirm: (opts: { message: string; detail?: string; buttons?: string[]; cancelId?: number; type?: string }) => Promise<number>
  nativeEdit: (cmd: string) => void
  setUiLang: (l: string) => void
  showSettingsDir: () => void
  /** mitgelieferter MCP-Server: Programm (OpenMol selbst), Server-Datei und Umgebung */
  mcpInfo: () => McpInfo
  onMenu: (cb: (cmd: string) => void) => () => void
  onOpenPath: (cb: (p: string) => void) => () => void
  onCloseRequest: (cb: (o: { quitting: boolean }) => void) => () => void
}

export const desktop: DesktopApi | undefined = (window as unknown as { openmol?: DesktopApi }).openmol
