// Datei auf das Fenster ziehen = öffnen (OpenMol-Dokument, ChemDraw-CDXML, Molfile/SDF, SMILES) – im Browser und in
// der Desktop-App. Ohne diese Behandlung würde der Browser die Datei selbst anzeigen und die Zeichnung verlassen.
import { openText } from './tools/io'
import { toast } from './store'
import { T } from './i18n/i18n'

const OK = /\.(openmol|json|cdxml|mol|sdf|smi|txt)$/i
const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')

let started = false
export function startFileDrop() {
  if (started) return
  started = true
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'copy'
  })
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    const f = e.dataTransfer!.files[0]
    if (!f) return
    if (!OK.test(f.name)) {
      toast(T('Dieses Dateiformat kann OpenMol nicht öffnen') + ': ' + f.name, 'error')
      return
    }
    void f.text().then((text) => openText(f.name, text))
  })
}
