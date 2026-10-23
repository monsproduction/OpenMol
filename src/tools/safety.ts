// CAS-Nummern und GHS-Piktogramme der Ansatztabelle automatisch aus PubChem ergänzen (online). Jede Zeile wird nur
// einmal gesucht (safetyChecked); vorhandene CAS-Nummern werden nie überschrieben. Alle Ergebnisse kommen in einem
// Schritt in die Tabelle (ein Rückgängig-Schritt).
import { lookupRowSafety, rowMW } from '../model/stoich'
import type { Id } from '../model/types'
import { commit, getState, toast } from '../store'
import { getSettings } from '../settings'

const running = new Set<Id>()
// während einer laufenden Suche hinzugekommene Zeilen: danach noch einmal suchen
const queued = new Set<Id>()

/**
 * force: auch Zeilen erneut suchen, die schon geprüft wurden (Knopf „CAS & GHS suchen“).
 * quiet: ohne Meldung, wenn nichts gefunden wurde.
 * auto: automatischer Aufruf (neue Tabelle/neuer Stoff) – nur wenn in den Einstellungen erlaubt, und nie für Produkte
 *       (oft neue, unveröffentlichte Verbindungen; die schickt OpenMol nur auf ausdrücklichen Wunsch an PubChem).
 */
export async function fillSafety(tableId: Id, opts: { force?: boolean; quiet?: boolean; auto?: boolean } = {}) {
  if (opts.auto && !getSettings().autoPubchem) return
  if (running.has(tableId)) {
    if (!opts.auto || getSettings().autoPubchem) queued.add(tableId)
    return
  }
  const t0 = getState().doc.tables?.[tableId]
  if (!t0) return
  const todo = t0.rows.filter((r) => (opts.force || !r.safetyChecked) && !(opts.auto && r.role === 'product'))
  if (!todo.length) {
    if (!opts.quiet) toast('Alle Stoffe sind bereits nachgeschlagen')
    return
  }
  running.add(tableId)
  if (!opts.quiet) toast('CAS-Nummern und GHS-Symbole werden in PubChem gesucht …')
  const results = new Map<Id, Awaited<ReturnType<typeof lookupRowSafety>>>()
  let failed = false
  try {
    for (const r of todo) {
      try {
        results.set(r.id, await lookupRowSafety(getState().doc, r))
      } catch {
        failed = true // Netz/PubChem nicht erreichbar → später erneut versuchen
        break
      }
    }
  } finally {
    running.delete(tableId)
    if (queued.delete(tableId)) setTimeout(() => void fillSafety(tableId, { quiet: true, auto: true }), 0)
  }
  if (!results.size) {
    if (failed && !opts.quiet) toast('PubChem ist gerade nicht erreichbar', 'error')
    return
  }
  const missing: string[] = []
  let cas = 0
  let ghs = 0
  commit((d) => {
    const t = d.tables?.[tableId]
    if (!t) return
    for (const [rid, res] of results) {
      const r = t.rows.find((x) => x.id === rid)
      if (!r) continue
      r.safetyChecked = true
      if (!res) {
        missing.push(r.name ?? rowMW(d, r).formula ?? '?')
        continue
      }
      if (res.cas && !r.cas) {
        r.cas = res.cas
        cas++
      }
      if (res.ghs) {
        r.ghs = res.ghs.codes.length ? res.ghs.codes : undefined
        r.ghsSource = res.ghs.source
        if (res.ghs.codes.length) ghs++
      }
    }
  })
  if (cas || ghs || !opts.quiet) {
    const miss = missing.length ? ` – nicht in PubChem: ${missing.join(', ')}` : ''
    toast(`PubChem: ${cas} CAS-Nummer(n), ${ghs}× GHS-Symbole ergänzt – bitte prüfen${miss}`)
  }
}
