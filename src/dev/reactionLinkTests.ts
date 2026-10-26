// Prüfreihe für die Verknüpfung Ansatztabelle ↔ Reaktionspfeil, Lösungsmittel und Zielkonzentration (nur für die
// Entwicklung). Im Browser: (await import('/src/dev/reactionLinkTests.ts')).run() → Liste der Fehler (leer = alles gut).
// Überschreibt das offene Dokument.
import { linkTable } from '../model/reactionLink'
import { computeTable, parseConditionText } from '../model/stoich'
import type { Doc, StoichRow, StoichTable } from '../model/types'
import { commit, getState, undo } from '../store'
import { duplicateSelection, selectAll } from '../tools/actions'

export function run(): string[] {
  const R: string[] = []
  const reset = () =>
    commit((d) => {
      for (const k of ['atoms', 'bonds', 'arrows', 'texts', 'tables', 'shapes', 'fills'] as const) for (const id in d[k]) delete d[k][id]
    })
  const mk = (below: string, above = '', rows: Partial<StoichRow>[] = [], extra: Partial<StoichTable> = {}) => {
    reset()
    commit((d) => {
      d.arrows.A = { id: 'A', kind: 'reaction', x1: 0, y1: 0, x2: 100, y2: 0, above, below }
      d.tables.T = { id: 'T', x: 0, y: 60, lang: 'de', rows: rows.map((r, i) => ({ id: 'r' + i, role: 'reagent', ...r })), ...extra }
      linkTable(d, 'T', 'A')
    })
  }
  const doc = () => getState().doc
  const ar = () => doc().arrows.A
  const tb = () => doc().tables.T
  const solv = () =>
    tb()
      .rows.filter((r) => r.role === 'solvent')
      .map((r) => (r.name ?? r.formula) + (r.parts ? ':' + r.parts : '') + (r.volume ? '@' + r.volume : ''))
      .join(',')
  const check = (name: string, got: unknown, want: unknown) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) R.push(`${name}: ${JSON.stringify(got)} (erwartet ${JSON.stringify(want)})`)
  }
  const cm = (f: (d: Doc) => void) => commit(f)
  // ein unbeteiligter Bearbeitungsschritt: der Abgleich läuft erneut und darf nichts verändern
  const touch = () => cm((d) => void (d.tables.T.notes = (d.tables.T.notes ?? '') + '.'))
  const T = (f: (t: StoichTable) => void) => cm((d) => f(d.tables.T))
  const A = (below: string) => cm((d) => void (d.arrows.A.below = below))

  // Formatierung im Pfeiltext bleibt
  mk('<span class="formula">THF</span>, <b>80 °C</b>, 16 h')
  check('Formatierung: T', tb().temperature, '80 °C')
  T((t) => (t.temperature = '60 °C'))
  check('Formatierung bleibt', ar().below, '<span class="formula">THF</span>, <b>60 °C</b>, 16 h')
  mk('<span class="formula">THF, 80 °C</span>')
  T((t) => (t.temperature = '25 °C'))
  check('Span über Komma', ar().below, '<span class="formula">THF, 25 °C</span>')
  T((t) => (t.temperature = undefined))
  check('Span über Komma, T entfernt', ar().below, '<span class="formula">THF</span>')

  // Angaben ohne bekanntes Muster bleiben erhalten
  mk('THF')
  T((t) => (t.temperature = '80'))
  touch()
  check('T ohne Einheit', tb().temperature, '80')
  T((t) => (t.temperature = '0 °C → RT'))
  touch()
  check('T mit Pfeil', [tb().temperature, ar().below], ['0 °C → RT', 'THF, 0 °C → RT'])
  T((t) => (t.time = '2 h, dann 16 h'))
  touch()
  touch()
  check('Zeit mit Komma', [tb().time, ar().below], ['2 h, dann 16 h', 'THF, 0 °C → RT, 2 h, dann 16 h'])
  T((t) => (t.time = '3 h'))
  check('Zeit mit Komma ersetzt', ar().below, 'THF, 0 °C → RT, 3 h')
  A('THF, 3 h')
  check('T im Pfeil gelöscht', tb().temperature ?? null, null)

  // unbekannte Lösungsmittel
  mk('80 °C')
  T((t) => void t.rows.push({ id: 'x', role: 'solvent', name: 'Sulfolan', volume: 0.002 }))
  touch()
  check('unbekanntes LM', [solv(), ar().below], ['Sulfolan@0.002', 'Sulfolan, 80 °C'])
  T((t) => void t.rows.push({ id: 'y', role: 'solvent', name: 'AcOH' }))
  touch()
  check('AcOH als LM', [solv(), ar().below], ['Sulfolan@0.002,AcOH', 'Sulfolan/AcOH, 80 °C'])
  A('Sulfolan/AcOH (3:1), 80 °C')
  check('Verhältnis am unbekannten Gemisch', solv(), 'Sulfolan:3@0.002,AcOH:1')
  A('Sulfolan/AcOH/Wasser (3:1:1), 80 °C')
  check('Wasser dazu', solv(), 'Sulfolan:3@0.002,AcOH:1,H2O:1')

  // Zusätze, Schreibweisen
  mk('dry THF, −78 °C, 2 h')
  touch()
  check('dry THF', [solv(), tb().temperature, ar().below], ['THF', '−78 °C', 'dry THF, −78 °C, 2 h'])
  mk('abs. EtOH, reflux')
  check('abs. EtOH', solv(), 'EtOH')
  mk('THF (abs.), 0 °C')
  check('THF (abs.)', solv(), 'THF')
  mk('THF (dry), 0 °C')
  A('THF (dry), 5 °C')
  check('Zusatz bleibt erkannt', [solv(), tb().temperature], ['THF', '5 °C'])
  mk('dcm, rt')
  check('Kleinschreibung', solv(), 'DCM')
  mk('THF/H2O 4:1, 80 °C')
  check('Verhältnis ohne Klammern', solv(), 'THF:4,H2O:1')
  mk('THF–H2O (4:1)')
  check('Gedankenstrich', solv(), 'THF:4,H2O:1')
  mk('THF, THF, 80 °C')
  check('doppelt', solv(), 'THF')
  T((t) => (t.temperature = '70 °C'))
  check('keine doppelten Zeilen', tb().rows.length, 1)
  mk('NaHMDS (2.0 M in THF), THF, 80 °C')
  check('Lösung ist kein LM', solv(), 'THF')

  // Konzentration
  mk('THF (0.1 M), 80 °C')
  check('THF (0.1 M)', [solv(), tb().targetConc], ['THF', 0.1])
  mk('THF/H<sub>2</sub>O (4:1, 0.2 M), 80 °C')
  check('Gemisch + c', [solv(), tb().targetConc], ['THF:4,H2O:1', 0.2])
  T((t) => (t.targetConc = 0.5))
  touch()
  check('Ziel-c → Pfeil', [ar().below, tb().targetConc], ['THF/H<sub>2</sub>O (4:1, 0,50 M), 80 °C', 0.5])
  mk('THF (0,1 M)')
  check('Dezimalkomma', tb().targetConc, 0.1)
  mk('THF, 0.2 M, 80 °C')
  check('c einzeln', tb().targetConc, 0.2)
  T((t) => (t.targetConc = 0.3))
  check('c einzeln ersetzt', ar().below, 'THF (0,30 M), 80 °C')
  mk('80 °C', '', [{ role: 'reactant', name: 'X' }], { targetConc: 0.4 })
  touch()
  check('Ziel-c ohne LM', [tb().targetConc, ar().below], [0.4, '80 °C'])
  const pc = parseConditionText('THF (0.1 M), 80 °C')
  check('Anlegen: THF (0.1 M) ist LM', [pc.rows.map((r) => r.role + ':' + r.name), pc.targetConc], [['solvent:THF'], 0.1])

  // Rollen, Mengen, Zeilen
  mk('THF, 80 °C', '', [{ role: 'reagent', name: 'DMF' }])
  T((t) => (t.rows.find((r) => r.name === 'DMF')!.role = 'solvent'))
  check('Rolle → LM', ar().below, 'THF/DMF, 80 °C')
  T((t) => (t.rows.find((r) => r.name === 'THF')!.role = 'reagent'))
  check('LM → Reagenz', ar().below, 'DMF, 80 °C')
  mk('THF/H2O (4:1), 80 °C')
  T((t) => (t.rows.find((r) => r.name === 'THF')!.volume = 0.004))
  A('THF/MeOH (4:1), 80 °C')
  check('Menge bleibt beim Tausch', solv(), 'THF:4@0.004,MeOH:1')
  mk('THF\n80 °C\n16 h')
  T((t) => (t.temperature = undefined))
  check('Zeile entfernt', ar().below, 'THF\n16 h')
  T((t) => (t.rows = t.rows.filter((r) => r.role !== 'solvent')))
  check('LM entfernt (erste Zeile)', ar().below, '16 h')
  mk('80 °C', 'THF')
  T((t) => void t.rows.push({ id: 'q', role: 'solvent', name: 'H2O' }))
  check('LM oben ergänzt', [ar().above, ar().below], ['THF/H<sub>2</sub>O', '80 °C'])
  mk('THF, 0–5 °C, 2–3 h')
  check('Bereiche', [tb().temperature, tb().time], ['0–5 °C', '2–3 h'])
  mk('THF, 80 ºC')
  check('Ordinal-º', tb().temperature, '80 ºC')

  // typische Schreibweisen in Schemata
  mk('THF, −78 °C → RT, 16 h')
  check('Temperaturverlauf', tb().temperature, '−78 °C → RT')
  mk('THF, 0 °C to rt')
  check('Verlauf mit to', tb().temperature, '0 °C to rt')
  mk('THF, unter Argon')
  check('unter Argon', tb().atmosphere, 'unter Argon')
  mk('THF, N<sub>2</sub> atm.')
  check('N2 atm.', tb().atmosphere, 'N2 atm.')
  mk('THF')
  T((t) => (t.temperature = '<5 °C'))
  touch()
  check('Sonderzeichen', [tb().temperature, ar().below], ['<5 °C', 'THF, &lt;5 °C'])
  T((t) => (t.notes = 'a, b, c'))
  T((t) => (t.time = '1 h, 2 h, 3 h, 4 h, 5 h, 6 h'))
  touch()
  check('lange Angabe', tb().time, '1 h, 2 h, 3 h, 4 h, 5 h, 6 h')
  mk('')
  T((t) => (t.temperature = '80 °C'))
  check('leerer Pfeil', ar().below, '80 °C')
  T((t) => void t.rows.push({ id: 's', role: 'solvent', name: 'THF', parts: 2 }, { id: 's2', role: 'solvent', name: 'H2O', parts: 0.5 }))
  check('Teile mit Komma', ar().below, 'THF/H<sub>2</sub>O (2:0.5), 80 °C')
  A('THF/H2O (2:0,5), 80 °C')
  touch()
  check('Teile mit Dezimalkomma zurück', solv(), 'THF:2,H2O:0.5')

  // Kopieren, Löschen, Rückgängig, mehrere Tabellen
  mk('THF, 80 °C')
  selectAll()
  duplicateSelection()
  check('Duplikat: je Tabelle eigener Pfeil', new Set(Object.values(doc().tables).map((t) => t.link?.arrow)).size, 2)
  mk('THF', '', [
    { role: 'reactant', name: 'X', formula: 'C6H6', mass: 0.1, driver: 'mass', ref: true },
    { role: 'reagent', name: 'nBuLi', formula: 'C4H9Li', conc: 0.01, eq: 1 },
  ], { targetConc: 1 })
  const c = computeTable(doc(), tb())
  check('Volumen nie negativ', (c.rows[tb().rows.findIndex((r) => r.role === 'solvent')].V ?? 0) >= 0, true)
  mk('THF, 80 °C')
  cm((d) => void delete d.arrows.A)
  check('Pfeil gelöscht → Link weg', tb().link ?? null, null)
  undo()
  check('Rückgängig → Link wieder da', tb().link?.arrow, 'A')
  reset()
  commit((d) => {
    d.arrows.A = { id: 'A', kind: 'reaction', x1: 0, y1: 0, x2: 100, y2: 0, above: '', below: 'THF, 80 °C' }
    d.tables.T = { id: 'T', x: 0, y: 60, lang: 'de', rows: [] }
    d.tables.U = { id: 'U', x: 0, y: 200, lang: 'de', rows: [] }
    linkTable(d, 'T', 'A')
    linkTable(d, 'U', 'A')
  })
  T((t) => (t.temperature = '50 °C'))
  check('zwei Tabellen, ein Pfeil', [ar().below, doc().tables.U.temperature], ['THF, 50 °C', '50 °C'])
  return R
}
