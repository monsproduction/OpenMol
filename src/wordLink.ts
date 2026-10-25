// Bearbeiten aus Word (Word-Add-in, Mac und Windows): eine Zeichnung aus Word kommt in einen eigenen Tab; „Zurück nach Word“
// gibt das neue Bild (PNG mit OpenMol-Daten) an das wartende Add-in, das es in Word ersetzt. Siehe electron/wordAddin.mjs.
import { desktop } from './desktop'
import { T } from './i18n/i18n'
import { pasteClip } from './model/ops'
import { emptyDoc, normalizeDoc } from './model/types'
import { getState, openTab, setState, toast } from './store'
import { fitView } from './tools/actions'
import { decodeClipFull } from './tools/clipData'
import { imageWithClipData } from './tools/io'

/** Bearbeitung aus Word annehmen: Zeichnung samt Stil in einem neuen Tab öffnen und mit der Sitzung verknüpfen */
export async function openFromWord(e: { session: string; payload: string }) {
  const full = await decodeClipFull(e.payload)
  if (!full) return toast(T('Die Zeichnung aus Word konnte nicht gelesen werden'), 'error')
  // Stil aus dem Bild – wie beim Öffnen einer Datei geprüft
  const doc = normalizeDoc({ ...emptyDoc(), style: { ...emptyDoc().style, ...(full.style ?? {}) } })
  pasteClip(doc, full.clip, 0, 0)
  openTab({ doc, fileName: T('Aus Word') })
  setState({ wordTabs: { ...getState().wordTabs, [getState().activeTab]: e.session } })
  setTimeout(() => fitView(1.5), 50)
  toast(T('Aus Word geöffnet – nach dem Bearbeiten oben „Zurück nach Word“ klicken'))
}

/** „Zurück nach Word“: ganze Zeichnung des Tabs als Bild an Word geben */
export async function sendBackToWord() {
  const st = getState()
  const session = st.wordTabs[st.activeTab]
  if (!session || !desktop) return
  const r = await imageWithClipData(true)
  if (!r) return toast(T('Die Zeichnung ist leer'), 'error')
  if (!(await desktop.wordResult(session, r.png))) {
    return toast(T('Word wartet nicht mehr auf dieses Bild – bitte in Word erneut „In OpenMol bearbeiten“'), 'error')
  }
  // erledigt: das Ergebnis steckt jetzt in Word
  const w = { ...getState().wordTabs }
  delete w[st.activeTab]
  setState({ wordTabs: w, dirty: false })
  toast(T('An Word übergeben – das Bild wird dort ersetzt'))
}
