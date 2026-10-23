// Start und Ende einer Sitzung: OpenMol beginnt mit einem leeren Dokument. Wurde es beim letzten Mal nicht
// ordentlich beendet (Absturz), wird einmal angeboten, die automatisch gesicherte Zeichnung wiederherzustellen.
import { desktop } from './desktop'
import { T } from './i18n/i18n'
import { crashRecovery, markSession, openTab, replaceDoc, setState } from './store'
import { fitView } from './tools/actions'

let started = false
export function startSession() {
  if (started) return
  started = true
  const rec = crashRecovery()
  markSession(true)
  // ordentliches Ende im Browser (Tab schließen, neu laden); die Desktop-App meldet es beim Schließen selbst
  window.addEventListener('pagehide', () => markSession(false))
  if (!rec) return
  // kurz warten, damit die Oberfläche hinter der Frage schon sichtbar ist
  setTimeout(async () => {
    const msg =
      rec.length > 1
        ? T('OpenMol wurde beim letzten Mal nicht ordentlich beendet. Letzte Zeichnungen ({0}) wiederherstellen?').replace('{0}', String(rec.length))
        : T('OpenMol wurde beim letzten Mal nicht ordentlich beendet. Letzte Zeichnung wiederherstellen?')
    const names = rec.map((r) => r.name).join(', ')
    const yes = desktop
      ? (await desktop.confirm({ message: msg, detail: names, buttons: [T('Wiederherstellen'), T('Verwerfen')], cancelId: 1 })) === 0
      : window.confirm(msg)
    if (!yes) return
    // jede Zeichnung in ihren eigenen Tab; nicht gespeichert: beim Schließen wird wieder nachgefragt
    rec.forEach((r, i) => {
      if (i === 0) {
        replaceDoc(r.doc, r.name)
        setState({ dirty: true })
      } else openTab({ doc: r.doc, fileName: r.name, dirty: true })
    })
    setTimeout(() => fitView(1.5), 0)
  }, 400)
}
