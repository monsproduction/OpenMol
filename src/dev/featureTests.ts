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
  duplicateSelection,
  flip,
  rotate,
  toggle3D,
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
import { attachCycle, ePoint, newCycle } from '../model/cycle'
import { loadRecent, recentDocs, rememberDoc } from '../recent'
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

/**
 * Zweite Welle: Kombinationen und Grenzfälle der neuen Funktionen (Größe, Verläufe, Gruppen/Sperren, Standard-Stil,
 * zuletzt verwendet, Pfeile/Bindungen, Zyklen). Im Browser: (await import('/src/dev/featureTests.ts')).run2()
 */
export async function run2(): Promise<string[]> {
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
  const sel = (atoms: string[]) => setState({ sel: completeSel(doc(), { ...emptySelection(), atoms }) })
  const svgOk = (name: string) => {
    const s = exportSvgString(doc())?.svg ?? ''
    check(name + ': SVG ohne NaN', !s.includes('NaN') && !s.includes('="undefined"'), s.slice(0, 160))
    return s
  }
  const len = (a: string, b: string) => Math.hypot(doc().atoms[a].x - doc().atoms[b].x, doc().atoms[a].y - doc().atoms[b].y)

  // ---------- Größe in Kombination ----------
  await T('zwei verschieden große Moleküle verbinden', async () => {
    fresh()
    await insertStructureText('CCCC', { x: 0, y: 0 })
    const left = Object.keys(doc().atoms)
    await insertStructureText('OCCO', { x: 400, y: 0 })
    const right = Object.keys(doc().atoms).filter((id) => !left.includes(id))
    sel(left)
    scaleMolecules(2)
    const before = right.map((id) => ({ ...doc().atoms[id] }))
    // Bindung zwischen bestehenden Atomen (wie Ziehen mit dem Bindungswerkzeug von Atom zu Atom)
    commit((d) => void (d.bonds.join = { id: 'join', a1: left[3], a2: right[0], type: 'single', doublePos: 'auto' }))
    const moved = right.some((id, i) => Math.hypot(doc().atoms[id].x - before[i].x, doc().atoms[id].y - before[i].y) > 1)
    check('bestehendes Molekül springt beim Verbinden nicht', !moved)
    svgOk('verbunden')
  })
  await T('Größe: Gruppe, Sperre, Kopie, Word-Austausch, Rückgängig', async () => {
    fresh()
    await insertStructureText('c1ccccc1N', { x: 0, y: 0 })
    selectAll()
    scaleMolecules(1.5)
    groupSelection()
    lockSelection()
    selectAll()
    scaleMolecules(3)
    check('gesperrtes Molekül bleibt bei 150 %', Object.values(doc().atoms).every((a) => a.scale === 1.5))
    unlockEverything()
    selectAll()
    const clip = extractClip(doc(), completeSel(doc(), getState().sel))
    const p = await encodeClipPayload(clip, doc().style)
    const back = await decodeClipFull(p)
    check('Größe im Word-Austausch', !!back && back.clip.atoms.every((a) => a.scale === 1.5))
    commit((d) => void pasteClip(d, back!.clip, 300, 0))
    check('eingefügte Kopie 150 %', Object.values(doc().atoms).filter((a) => a.x > 200).every((a) => a.scale === 1.5))
    const n = Object.keys(doc().atoms).length
    undo()
    check('Rückgängig Einfügen', Object.keys(doc().atoms).length === n / 2)
    redo()
    svgOk('Größe kombiniert')
  })
  await T('Größe: Drehen, Spiegeln, 3D, Nummern', async () => {
    fresh()
    await insertStructureText('CC(=O)Oc1ccccc1C(=O)O')
    selectAll()
    scaleMolecules(0.5)
    rotate(37)
    flip('h')
    autoNumberAtoms()
    const b = Object.values(doc().bonds)[0]
    check('Bindungslänge nach Drehen ≈ 0,5 L', Math.abs(len(b.a1, b.a2) - doc().style.bondLength * 0.5) < 2, len(b.a1, b.a2))
    toggle3D()
    toggle3D()
    svgOk('Größe gedreht')
    allValid('Größe gedreht')
  })
  await T('Duplizieren eines skalierten Moleküls', async () => {
    fresh()
    await insertStructureText('CCO')
    selectAll()
    scaleMolecules(2.5)
    duplicateSelection()
    check('Duplikat 250 %', Object.values(doc().atoms).every((a) => a.scale === 2.5) && Object.keys(doc().atoms).length === 6)
  })

  // ---------- Verläufe in Kombination ----------
  await T('Verlauf auf waagerechter Einzelbindung', async () => {
    fresh()
    commit((d) => {
      d.atoms.p = { id: 'p', x: 0, y: 0, element: 'C', charge: 0, radical: 0, lonePairs: 0 }
      d.atoms.q = { id: 'q', x: 40, y: 0, element: 'C', charge: 0, radical: 0, lonePairs: 0 }
      d.bonds.pq = { id: 'pq', a1: 'p', a2: 'q', type: 'single', doublePos: 'auto' }
    })
    selectAll()
    for (const angle of [0, 90, 180, 270, 45]) {
      setGradient('color', { c1: '#000000', c2: '#ff0000', grad: 'linear', angle })
      svgOk('waagerechte Bindung ' + angle + '°')
    }
    setGradient('color', { c1: '#000000', c2: '#ff0000', grad: 'radial', angle: 0 })
    svgOk('waagerechte Bindung radial')
  })
  await T('Verlauf auf allen Objektarten', async () => {
    fresh()
    await insertStructureText('CCO')
    commit((d) => {
      d.texts.t = { id: 't', x: 0, y: 120, text: 'Ausbeute <b>90 %</b>', size: 14 }
      d.arrows.a = { id: 'a', kind: 'equilibrium', x1: 100, y1: 0, x2: 200, y2: 0, above: 'H<sub>2</sub>O', below: '' }
      d.shapes.s = { id: 's', kind: 'brackets', x1: -60, y1: -60, x2: 60, y2: 60 } as never
      d.cycles.y = newCycle(0, 300, 80, 3, 'cw')
      d.cycles.y.id = 'y'
    })
    selectAll()
    setGradient('color', { c1: '#123456', c2: '#abcdef', grad: 'linear', angle: 30 })
    const s = svgOk('alle Objektarten')
    check('Verlauf auf allen Objekten', (s.match(/url\(#og-/g) ?? []).length >= 5, (s.match(/url\(#og-/g) ?? []).length)
    const cdx = buildCdxml(doc())
    check('CDXML ohne grad:', !cdx.includes('grad:'))
    // Objekte löschen → Verlauf verschwindet; Rückgängig → beides wieder da
    commit((d) => {
      for (const k of ['atoms', 'bonds', 'texts', 'arrows', 'shapes', 'cycles'] as const) for (const id in d[k]) delete d[k][id]
    })
    check('Verlauf mit Objekten gelöscht', !doc().gradients)
    undo()
    check('Rückgängig: Verlauf wieder da', Object.keys(doc().gradients ?? {}).length === 1)
    // einfache Farbe überschreibt den Verlauf
    selectAll()
    commit((d) => {
      for (const a of Object.values(d.atoms)) a.color = '#ff0000'
      for (const b of Object.values(d.bonds)) b.color = '#ff0000'
    })
    check('Verlauf bleibt für den Rest', Object.keys(doc().gradients ?? {}).length === 1)
  })
  await T('zwei Verläufe nebeneinander, einer geändert', async () => {
    fresh()
    await insertStructureText('CC', { x: 0, y: 0 })
    const a = Object.keys(doc().atoms)
    await insertStructureText('OO', { x: 200, y: 0 })
    const b = Object.keys(doc().atoms).filter((id) => !a.includes(id))
    sel(a)
    setGradient('color', { c1: '#000000', c2: '#ff0000', grad: 'linear', angle: 0 })
    sel(b)
    setGradient('color', { c1: '#000000', c2: '#00ff00', grad: 'linear', angle: 0 })
    check('zwei Verläufe', Object.keys(doc().gradients ?? {}).length === 2)
    sel([...a, ...b])
    setGradient('color', { c1: '#0000ff', c2: '#ffff00', grad: 'radial', angle: 0 })
    check('gemeinsamer Verlauf ersetzt beide', Object.keys(doc().gradients ?? {}).length === 1)
  })

  // ---------- Standard-Stil ----------
  await T('Standard-Stil mit Seite und Hilfslinien', () => {
    const keep = getSettings().defaultStyle
    const st = { ...emptyDoc().style, lineWidth: 3, page: { format: 'A4', x: 999, y: 999, cols: 3, rows: 2 }, aids: { rulers: true, guidesX: [1, 2], guidesY: [3] } }
    saveDefaultStyle(st as never)
    const d = newDoc()
    check('Standard-Stil: eine Seite, ohne Hilfslinien', d.style.page?.cols === 1 && d.style.page?.rows === 1 && !d.style.aids?.guidesX && d.style.aids?.rulers === true, d.style)
    setSettings({ defaultStyle: keep })
  })

  // ---------- Pfeile und Bindungen (Darstellung) ----------
  await T('Gleichgewichtspfeil Grenzfälle', () => {
    fresh()
    commit((d) => {
      d.arrows.z = { id: 'z', kind: 'equilibrium', x1: 0, y1: 0, x2: 0, y2: 0, above: '', below: '' }
      d.arrows.k = { id: 'k', kind: 'equilibrium', x1: 0, y1: 50, x2: 3, y2: 50, above: '', below: '' }
      d.arrows.f = { id: 'f', kind: 'equilibrium', x1: 0, y1: 100, x2: 200, y2: 160, above: 'x', below: 'y', bold: true, width: 3 }
      d.arrows.r = { id: 'r', kind: 'equilibrium', x1: 0, y1: 200, x2: 200, y2: 200, above: '', below: '', route: 'elbow' } as never
    })
    svgOk('Gleichgewichtspfeile')
  })
  await T('Mehrfachbindungen zwischen Beschriftungen', async () => {
    for (const s of ['N#N', 'O=O', 'N#[C-]', '[O-][N+]#N', 'S=C=S', 'O=[N+]([O-])c1ccccc1', 'OC#N']) {
      fresh()
      await insertStructureText(s)
      selectAll()
      for (const deg of [0, 17, 45, 90, 133]) {
        rotate(deg)
        svgOk(s + ' gedreht ' + deg)
      }
    }
  })

  // ---------- Zyklen ----------
  await T('2. Zyklus: mehrfach, an Ellipsen, an angedockten', () => {
    fresh()
    const c = newCycle(0, 0, 120, 4, 'cw')
    c.rx = 200
    c.ry = 60
    const n1 = attachCycle(c, 0)
    const n2 = attachCycle(c, 180)
    const n3 = attachCycle(n1, 90)
    for (const [ang, cc] of [[0, n1], [180, n2]] as const) {
      // Berührpunkt: Abstand vom neuen Mittelpunkt zum Punkt auf dem ersten Zyklus = Radius
      const p = ePoint(c, ang)
      check('2. Zyklus berührt bei ' + ang + '°', Math.abs(Math.hypot(p.x - cc.cx, p.y - cc.cy) - cc.rx) < 0.5, [p, cc.cx, cc.cy, cc.rx])
    }
    commit((d) => {
      for (const y of [c, n1, n2, n3]) d.cycles[y.id] = y
    })
    svgOk('Zyklen')
  })

  // ---------- zuletzt verwendet (Browser) ----------
  await T('zuletzt verwendet: große und seltsame Dokumente', async () => {
    const big = emptyDoc()
    for (let i = 0; i < 4000; i++) big.atoms['a' + i] = { id: 'a' + i, x: i, y: i, element: 'C', charge: 0, radical: 0, lonePairs: 0 }
    rememberDoc('Riesig', big)
    rememberDoc('Name mit "Anführung" & <Tag>', emptyDoc())
    for (let i = 0; i < 10; i++) rememberDoc('Doc ' + i, emptyDoc())
    const list = await recentDocs()
    check('höchstens 6, ohne das riesige', list.length <= 6 && !list.some((r) => r.name === 'Riesig'), list.map((r) => r.name))
    const r = list[0]
    const f = r ? await loadRecent(r) : null
    check('öffnen liefert Text', !!f && f.text.includes('openmol'))
  })

  setState({ sel: emptySelection() })
  return R

  function allValid(name: string) {
    const back = normalizeDoc(JSON.parse(JSON.stringify(doc())))
    check(name + ': Datei-Rundreise', Object.keys(back.atoms).length === Object.keys(doc().atoms).length)
  }
}
