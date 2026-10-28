// Breite Prüfreihe mit ungewöhnlichen Eingaben (nur für die Entwicklung). Im Browser:
//   (await import('/src/dev/featureTests.ts')).run() → Liste der Fehler (leer = alles gut)
// Überschreibt das offene Dokument. Ergänzt src/dev/reactionLinkTests.ts (Ansatztabelle ↔ Pfeil).
import { autoNumber } from '../model/numbering'
import { isotopePattern } from '../model/isotopePattern'
import { analyze, parseStructure } from '../model/ocl'
import { extractClip, pasteClip } from '../model/ops'
import { computeTable, parseConditionText, solventMix } from '../model/stoich'
import { emptyDoc, emptySelection, normalizeDoc, type Doc } from '../model/types'
import { getScene, sceneBBox } from '../model/scene'
import { buildCdxml } from '../tools/cdxml'
import { importCdxml } from '../tools/cdxmlImport'
import { decodeClipFull, encodeClipPayload } from '../tools/clipData'
import { exportSvgString, pdfHtml } from '../tools/io'
import { commit, getState, redo, replaceDoc, setState, undo } from '../store'
import {
  autoNumberAtoms,
  cleanStructure,
  completeSel,
  groupSelection,
  insertStructureText,
  lockSelection,
  scaleMolecules,
  selectAll,
  setGradient,
  ungroupSelection,
  unlockEverything,
} from '../tools/actions'
import { newDoc, resetDefaultStyle, saveDefaultStyle } from '../defaultStyle'
import { getSettings, setSettings } from '../settings'

export async function run(): Promise<string[]> {
  const R: string[] = []
  const fail = (name: string, msg: unknown) => R.push(`${name}: ${msg instanceof Error ? msg.message : String(msg)}`)
  const check = (name: string, ok: boolean, info: unknown = '') => {
    if (!ok) fail(name, typeof info === 'string' ? info || 'falsch' : JSON.stringify(info))
  }
  const T = async (name: string, f: () => unknown) => {
    try {
      await f()
    } catch (e) {
      fail(name + ' (Ausnahme)', e)
    }
  }
  const fresh = () => replaceDoc(emptyDoc(), 'Test')
  const doc = () => getState().doc
  /** alle Ausgaben eines Dokuments erzeugen – darf nie abstürzen und muss gültig aussehen */
  const allExports = (name: string) => {
    const d = doc()
    const svg = exportSvgString(d)?.svg
    check(name + ': SVG', !svg || (svg.includes('<svg') && !svg.includes('NaN') && !svg.includes('="undefined"')), svg?.slice(0, 200))
    const pdf = pdfHtml(d)
    check(name + ': PDF-Seite', !pdf || (pdf.width >= 1 && pdf.height >= 1 && !pdf.html.includes('NaN')), pdf && [pdf.width, pdf.height])
    const cdx = buildCdxml(d)
    check(name + ': CDXML', cdx.includes('<CDXML') && !cdx.includes('NaN') && !cdx.includes('grad:'), cdx.slice(0, 80))
    // Rundreise über die Datei
    const back = normalizeDoc(JSON.parse(JSON.stringify(d)))
    check(name + ': Datei-Rundreise', Object.keys(back.atoms).length === Object.keys(d.atoms).length && Object.keys(back.bonds).length === Object.keys(d.bonds).length)
    const bb = sceneBBox(getScene(d))
    check(name + ': Rahmen', !bb || [bb.x1, bb.y1, bb.x2, bb.y2].every(Number.isFinite), bb)
  }

  // ---------- Strukturen mit ungewöhnlichen Eingaben ----------
  for (const s of ['', '   ', 'C1CC', '[Xx]', 'c1ccccc', 'C'.repeat(400), '[Fe+3].[Cl-].[Cl-].[Cl-]', 'O=C=O', '[2H]C([2H])([2H])I', 'C1CC2CCC1C2', 'C12C3C4C1C5C2C3C45', '[NH4+].[O-]C(=O)C', '😀', 'name:', '<svg onload=alert(1)>']) {
    await T('Struktur ' + JSON.stringify(s.slice(0, 30)), async () => {
      fresh()
      await insertStructureText(s)
      allExports('Struktur ' + JSON.stringify(s.slice(0, 20)))
    })
  }

  // ---------- Analyse und Isotopenmuster ----------
  await T('Isotope: Tc (keine stabilen Isotope)', () => check('Tc', isotopePattern({ Tc: 1 }) === null))
  await T('Isotope: großes Molekül', () => {
    const t0 = performance.now()
    const p = isotopePattern({ C: 300, H: 602, Br: 6 })
    check('C300H602Br6 schnell', performance.now() - t0 < 2000, Math.round(performance.now() - t0) + ' ms')
    check('C300H602Br6 Peaks', !!p && p.length > 3 && p.every((x) => Number.isFinite(x.mass) && x.rel > 0))
  })
  await T('Isotope: leer', () => check('leer', JSON.stringify(isotopePattern({})) !== undefined))

  // ---------- Atomnummerierung ----------
  for (const s of ['C', '[Fe]', 'C1CCCCCCCCCCCCCCCCCCC1', 'C12C3C4C1C5C2C3C45', 'C1CC2CCC1C2', 'CC.CC', '[O-][N+](=O)c1ccccc1', 'C[Si](C)(C)C', 'c1ccc2c(c1)ccc1ccccc12', 'n1c2ncnc2c(N)nc1']) {
    await T('Nummerierung ' + s, async () => {
      fresh()
      await insertStructureText(s)
      const r = autoNumber(doc(), Object.keys(doc().atoms))
      const vals = [...r.nums.values()]
      check('Nummerierung ' + s + ': eindeutig je Molekül', new Set(vals).size === vals.length || s.includes('.'), vals)
      selectAll()
      autoNumberAtoms()
      allExports('Nummerierung ' + s)
    })
  }

  // ---------- Gruppen, Sperren, Größe, Verläufe ----------
  await T('Gruppieren/Sperren/Größe/Verlauf', async () => {
    fresh()
    await insertStructureText('O=C(O)c1ccccc1', { x: 0, y: 0 })
    commit((d) => void (d.texts.t1 = { id: 't1', x: 0, y: 100, text: '<b>1</b>', size: 16 }))
    selectAll()
    groupSelection()
    check('Gruppe angelegt', Object.keys(doc().groups ?? {}).length === 1)
    scaleMolecules(10)
    check('Größe 10', Object.values(doc().atoms).every((a) => a.scale === 10))
    scaleMolecules(0.1)
    check('Größe 0,1', Object.values(doc().atoms).every((a) => Math.abs((a.scale ?? 1) - 0.1) < 1e-9))
    scaleMolecules(Number.NaN)
    check('Größe NaN abgefangen', Object.values(doc().atoms).every((a) => Number.isFinite(a.x) && Number.isFinite(a.scale ?? 1)), Object.values(doc().atoms)[0])
    scaleMolecules(1)
    setGradient('color', { c1: '#ff0000', c2: '#0000ff', grad: 'radial', angle: 0 })
    setGradient('highlight', { c1: '#ffff00', c2: '#00ff00', grad: 'linear', angle: 45 })
    allExports('Verlauf')
    const svg = exportSvgString(doc())?.svg ?? ''
    check('Verlauf im SVG', svg.includes('radialGradient') && svg.includes('linearGradient'))
    // Kopieren/Einfügen in ein neues Dokument nimmt die Verläufe mit
    const clip = extractClip(doc(), completeSel(doc(), getState().sel))
    fresh()
    commit((d) => void pasteClip(d, JSON.parse(JSON.stringify(clip)), 0, 0))
    selectAll()
    check('Verlauf eingefügt', Object.keys(doc().gradients ?? {}).length === 2)
    // Word-Austausch (OM1-Daten im Bild)
    const payload = await encodeClipPayload(clip, doc().style)
    const back = await decodeClipFull(payload)
    check('Verlauf im Word-Austausch', (back?.clip.gradients?.length ?? 0) === 2)
    setGradient('color', null)
    setGradient('highlight', null)
    check('Verläufe entfernt', !doc().gradients)
    lockSelection()
    selectAll()
    check('Gesperrtes nicht auswählbar', getState().sel.atoms.length === 0)
    unlockEverything()
    selectAll()
    ungroupSelection()
    check('Gruppe aufgelöst', !doc().groups)
    undo()
    undo()
    redo()
  })

  // ---------- Struktur aufräumen mit Größe ----------
  await T('Aufräumen behält Größe', async () => {
    fresh()
    await insertStructureText('CCCCCC')
    selectAll()
    scaleMolecules(2)
    cleanStructure()
    const d = doc()
    const b = Object.values(d.bonds)[0]
    const l = Math.hypot(d.atoms[b.a1].x - d.atoms[b.a2].x, d.atoms[b.a1].y - d.atoms[b.a2].y)
    check('Bindungslänge nach Aufräumen ≈ 2 L', Math.abs(l - d.style.bondLength * 2) < d.style.bondLength * 0.2, l)
  })

  // ---------- kaputte Dateien ----------
  await T('kaputte Dateien', () => {
    const junk: unknown[] = [
      {},
      { atoms: null },
      { atoms: { a: { x: 'x', y: 1, element: 5 } } },
      { atoms: { a: { id: 'a', x: 0, y: 0, element: 'C', scale: -3, num: 5 } }, groups: 'x', locked: [1, 2], gradients: { g: { c1: 'javascript:1' } } },
      { tables: { t: { x: 0, y: 0, rows: [{ id: 'r', role: 'solvent', parts: 'viel' }], targetConc: -1, link: { arrow: 5 } } } },
      { style: { aids: { grid: 'x', guidesX: [1, 'a', null, Number.POSITIVE_INFINITY] }, page: { x: NaN } } },
    ]
    for (const [i, j] of junk.entries()) {
      const d = normalizeDoc(j as Partial<Doc>)
      replaceDoc(d, 'Kaputt ' + i)
      allExports('Kaputt ' + i)
    }
  })
  await T('CDXML-Unsinn', () => {
    for (const t of ['', '<CDXML>', '<CDXML><page><fragment><n p="a b"/></fragment></page></CDXML>', '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><CDXML>&a;</CDXML>']) {
      try {
        importCdxml(t)
      } catch {
        // Fehlermeldung ist in Ordnung – nur kein Hängenbleiben
      }
    }
  })

  // ---------- Ansatztabelle: Rechnen mit Grenzwerten ----------
  await T('Ansatztabelle Grenzwerte', () => {
    const d = emptyDoc()
    for (const rows of [
      [{ id: 'a', role: 'reactant', ref: true, mass: 0, driver: 'mass', formula: 'C6H6' }],
      [{ id: 'a', role: 'reactant', ref: true, mass: 1, driver: 'mass' }],
      [{ id: 'a', role: 'reactant', ref: true, moles: 1e-12, driver: 'moles', formula: 'C' }, { id: 's', role: 'solvent', name: 'THF', parts: 0 }],
      [{ id: 's', role: 'solvent', name: 'THF', volume: -1 }],
    ] as const) {
      const t = { id: 't', x: 0, y: 0, lang: 'de' as const, rows: JSON.parse(JSON.stringify(rows)), targetConc: 0.5 }
      const c = computeTable(d, t)
      check('Tabelle ohne NaN/∞ ' + JSON.stringify(rows).slice(0, 60), c.rows.every((r) => [r.n, r.m, r.V, r.eq].every((v) => v === undefined || Number.isFinite(v))), c.rows)
    }
    check('solventMix leer', solventMix('') === null)
    check('Bedingungen leer', parseConditionText('').rows.length === 0)
    check('Bedingungen nur Kommas', parseConditionText(',,;;\n\n').rows.length === 0)
  })

  // ---------- Standard-Dokumentstil ----------
  await T('Standard-Stil kaputt', () => {
    const keep = getSettings().defaultStyle
    setSettings({ defaultStyle: { bondLength: 'riesig', lineWidth: -5, font: 123, pageFormat: 'XYZ', aids: { grid: 1e9 } } as never })
    const d = newDoc()
    check('Standard-Stil geprüft', d.style.bondLength > 0 && d.style.lineWidth > 0 && typeof d.style.font === 'string', d.style)
    saveDefaultStyle(emptyDoc().style)
    resetDefaultStyle()
    setSettings({ defaultStyle: keep })
  })

  // ---------- Analyse ----------
  await T('Analyse Sonderfälle', async () => {
    fresh()
    await insertStructureText('[Fe+3]')
    const a = analyze(doc())
    check('Analyse Fe3+', !!a && Number.isFinite(a.mw))
    check('parseStructure leer wirft', (() => {
      try {
        parseStructure('')
        return false
      } catch {
        return true
      }
    })())
  })

  setState({ sel: emptySelection() })
  return R
}
