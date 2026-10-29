// KI-Steuerung über MCP (Claude, Cursor, VS Code, LM Studio …): Die App holt Befehle beim lokalen MCP-Server (mcp/server.mjs, Brücke auf
// 127.0.0.1:5181) ab, führt sie mit ihren normalen Funktionen aus (alles mit ⌘Z rückgängig) und schickt das
// Ergebnis zurück. Nur aktiv, wenn in den Einstellungen erlaubt.
import { useSyncExternalStore } from 'react'
import { buildGraph, fragments } from '../model/chem'
import { analyze, casValid, nameToStructure, parseStructure, toMolfile, toSmiles } from '../model/ocl'
import { deleteItems, translateSelection } from '../model/ops'
import { getScene, sceneBBox } from '../model/scene'
import { computeTable, lookupRowCas, parseQty, rowFromName, rowMW } from '../model/stoich'
import { richPlain } from '../model/richtext'
import type { Arrow, ArrowKind, Doc, Id, Selection, StoichRole, StoichRow, StoichTable } from '../model/types'
import { STYLE_PRESETS, emptySelection, uid } from '../model/types'
import { bypassLocks, commit, getState, openTab, redo, setState, undo } from '../store'
import { cleanStructure, completeSel, contractGroups, createStoichTable, fitView, insertStructureText, selectAll } from './actions'
import { cleanReaction } from './cleanup'
import { buildCdxml } from './cdxml'
import { exportSvgString, renderPng } from './io'
import { runFullTool } from './aiToolsFull'
import { fillSafety } from './safety'

const BASE = 'http://127.0.0.1:5181'

// ---------- Verbindungsstatus ----------

export type AiStatus = 'off' | 'searching' | 'connected'
let status: AiStatus = 'off'
const listeners = new Set<() => void>()
function setStatus(s: AiStatus) {
  if (s === status) return
  status = s
  for (const l of listeners) l()
}
export function useAiStatus(): AiStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => status,
  )
}

let running = false
let loopToken = 0
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function startAiBridge() {
  if (running) return
  running = true
  setStatus('searching')
  const token = ++loopToken
  void (async () => {
    // erreichbar? → gleich als verbunden anzeigen (die erste Long-Poll-Anfrage kommt erst mit einem Befehl zurück)
    const check = async () => {
      try {
        const r = await fetch(BASE + '/status', { cache: 'no-store' })
        if (r.ok && token === loopToken) setStatus('connected')
      } catch {
        // Server (noch) nicht gestartet
      }
    }
    await check()
    while (running && token === loopToken) {
      const t0 = Date.now()
      try {
        const r = await fetch(BASE + '/poll', { cache: 'no-store' })
        // abgelehnt (z. B. 403) oder anderer Fehler: nicht verbunden – kurz warten statt im Takt nachzufragen
        if (r.status !== 200 && r.status !== 204) {
          setStatus('searching')
          await sleep(2000)
          continue
        }
        setStatus('connected')
        if (r.status !== 200) {
          // Long-Poll ohne Befehl: sofort wieder anfragen – aber nie schneller als nötig (Schutz vor Endlosschleife)
          if (Date.now() - t0 < 200) await sleep(500)
          continue
        }
        const cmd = (await r.json()) as { id: number; tool: string; args: Record<string, unknown> }
        let msg: { id: number; ok: boolean; result?: unknown; error?: string }
        try {
          msg = { id: cmd.id, ok: true, result: await bypassLocks(() => runTool(cmd.tool, cmd.args ?? {})) }
        } catch (e) {
          msg = { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) }
        }
        await fetch(BASE + '/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) })
      } catch {
        // Server (noch) nicht gestartet: ruhig weiter versuchen
        setStatus('searching')
        await sleep(4000)
        await check()
      }
    }
  })()
}

export function stopAiBridge() {
  running = false
  loopToken++
  setStatus('off')
}

// ---------- Hilfsfunktionen ----------

type Args = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
// Zahlen nur in vernünftiger Größe (eine KI kann z. B. 1e308 schicken – damit rechnet nichts mehr richtig)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e7 ? v : undefined)
const doc = () => getState().doc

function molecules(d: Doc) {
  return fragments(d, buildGraph(d)).filter((f) => f.length)
}

export function molBox(d: Doc, ids: Id[]) {
  const set = new Set(ids)
  return sceneBBox(getScene(d), { atoms: set, bonds: new Set(Object.values(d.bonds).filter((b) => set.has(b.a1)).map((b) => b.id)) })
}

export const molSel = (d: Doc, ids: Id[]): Selection => completeSel(d, { ...emptySelection(), atoms: ids })

/** SMILES oder „name:…“ (PubChem) → SMILES bzw. Molfile mit PubChems 2D-Darstellung; ein unlesbares SMILES wird als Name versucht */
export async function resolveStructure(s: string): Promise<string> {
  const t = s.trim()
  const byName = async (nm: string) => {
    const r = await nameToStructure(nm)
    return r.molfile ?? r.smiles
  }
  if (/^name:/i.test(t)) return byName(t.replace(/^name:\s*/i, ''))
  try {
    parseStructure(t)
    return t
  } catch {
    return byName(t)
  }
}

/** Struktur einfügen, Atom-IDs des neuen Moleküls zurückgeben (linke Kante bei x, Mitte bei y) */
export function insertAt(smiles: string, x: number, y: number): Id[] {
  const before = new Set(Object.keys(doc().atoms))
  if (!insertStructureText(smiles, { x, y })) throw new Error('Struktur nicht lesbar: ' + smiles)
  const ids = Object.keys(doc().atoms).filter((id) => !before.has(id))
  const b = molBox(doc(), ids)
  if (b) commit((d) => translateSelection(d, molSel(d, ids), x - b.x1, y - (b.y1 + b.y2) / 2))
  return ids
}

function addPlus(x: number, y: number): Id {
  const id = uid('t')
  commit((d) => {
    const size = Math.round(d.style.fontSize * 1.3)
    d.texts[id] = { id, x, y, text: '+', size }
  })
  return id
}

function tableOf(args: Args): StoichTable {
  const tables = doc().tables ?? {}
  const id = str(args.table_id) ?? Object.keys(tables)[0]
  const t = id ? tables[id] : undefined
  if (!t) throw new Error('Keine Ansatztabelle vorhanden – zuerst create_stoich_table aufrufen.')
  return t
}

function rowIndex(t: StoichTable, row: unknown): number {
  // Index auch als Text („0“) – manche KI-Schnittstellen erlauben im Schema keinen Zahl-oder-Text-Typ
  if (typeof row === 'string' && /^\s*\d+\s*$/.test(row)) row = Number(row)
  if (typeof row === 'number') {
    if (row < 0 || row >= t.rows.length) throw new Error(`Zeile ${row} gibt es nicht (0–${t.rows.length - 1}).`)
    return row
  }
  const q = String(row).trim().toLowerCase()
  const i = t.rows.findIndex((r) => {
    const info = rowMW(doc(), r)
    return (r.name ?? '').toLowerCase() === q || (info.formula ?? '').toLowerCase() === q
  })
  if (i < 0) {
    const j = t.rows.findIndex((r) => (r.name ?? '').toLowerCase().includes(q))
    if (j >= 0) return j
    throw new Error(`Keine Zeile „${row}“ in der Ansatztabelle.`)
  }
  return i
}

function updateTable(id: Id, f: (t: StoichTable) => void) {
  commit((d) => {
    const t = d.tables[id]
    if (t) f(t)
  })
}

/** Ansatztabelle als gut lesbare Zusammenfassung (Mengen in mg, mmol, mL) */
function tableSummary(d: Doc, t: StoichTable) {
  const c = computeTable(d, t)
  const r3 = (v?: number) => (v === undefined || !Number.isFinite(v) ? undefined : Math.round(v * 1000) / 1000)
  return {
    id: t.id,
    language: t.lang,
    rows: t.rows.map((r, i) => {
      const k = c.rows[i]
      const info = rowMW(d, r)
      return {
        index: i,
        role: r.role,
        reference: i === c.refIndex || undefined,
        name: r.name ?? info.formula,
        cas: r.cas,
        ghs: r.ghs?.length ? `${r.ghs.join(', ')} (${r.ghsSource ?? 'PubChem'})` : undefined,
        formula: info.formula,
        molar_mass: r3(k.mw),
        equivalents: r3(k.eq),
        mmol: r3((r.role === 'product' ? k.theoN : k.n) !== undefined ? (r.role === 'product' ? k.theoN! : k.n!) * 1000 : undefined),
        mg: r3((r.role === 'product' ? k.theoM : k.m) !== undefined ? (r.role === 'product' ? k.theoM! : k.m!) * 1000 : undefined),
        mL: r3(k.V !== undefined ? k.V * 1000 : undefined),
        solution: r.conc ? `${r.conc} M${r.solvent ? ' in ' + r.solvent : ''}` : undefined,
        density: r.density,
        obtained_mg: r3(r.obtained !== undefined ? r.obtained * 1000 : undefined),
        yield_percent: r3(k.yieldPct),
      }
    }),
    temperature: t.temperature,
    time: t.time,
    atmosphere: t.atmosphere,
    notes: t.notes,
    concentration_of_reference_M: r3(c.cRef),
  }
}

/** Kurze Textbeschreibung des Bildinhalts – für KIs ohne Bildverständnis (Reihenfolge: oben → unten, links → rechts) */
function imageDescription(d: Doc, onlySel: boolean): string {
  const sel = getState().sel
  const selAtoms = new Set(onlySel ? sel.atoms : [])
  const pick = <T,>(ids: Id[], all: T[], key: (x: T) => Id) => (onlySel ? all.filter((x) => ids.includes(key(x))) : all)
  const r0 = (v: number) => Math.round(v)
  const items: { y: number; x: number; t: string }[] = []
  for (const f of molecules(d)) {
    if (onlySel && !f.some((id) => selAtoms.has(id))) continue
    const b = molBox(d, f)
    if (!b) continue
    const an = analyze(d, f)
    let smiles = ''
    try {
      smiles = toSmiles(d, f)
    } catch {
      smiles = '?'
    }
    items.push({ y: b.y1, x: b.x1, t: `molecule ${f[0]}: ${an?.formula ?? '?'} (SMILES ${smiles}), box x ${r0(b.x1)}…${r0(b.x2)}, y ${r0(b.y1)}…${r0(b.y2)}` })
  }
  for (const ar of pick(sel.arrows, Object.values(d.arrows), (x) => x.id)) {
    const txt = [ar.above && `above "${richPlain(ar.above)}"`, ar.below && `below "${richPlain(ar.below)}"`].filter(Boolean).join(', ')
    items.push({ y: Math.min(ar.y1, ar.y2), x: Math.min(ar.x1, ar.x2), t: `${ar.kind} arrow ${ar.id} from (${r0(ar.x1)}, ${r0(ar.y1)}) to (${r0(ar.x2)}, ${r0(ar.y2)})${txt ? ', ' + txt : ''}` })
  }
  for (const t of pick(sel.texts, Object.values(d.texts), (x) => x.id)) items.push({ y: t.y, x: t.x, t: `text ${t.id} "${richPlain(t.text).slice(0, 80)}" at (${r0(t.x)}, ${r0(t.y)})` })
  for (const t of pick(sel.tables ?? [], Object.values(d.tables ?? {}), (x) => x.id)) items.push({ y: t.y, x: t.x, t: `stoichiometry table ${t.id} with ${t.rows.length} rows at (${r0(t.x)}, ${r0(t.y)})` })
  for (const sh of pick(sel.shapes, Object.values(d.shapes), (x) => x.id)) items.push({ y: Math.min(sh.y1, sh.y2), x: Math.min(sh.x1, sh.x2), t: `${sh.kind} ${sh.id} (${r0(sh.x1)}, ${r0(sh.y1)})–(${r0(sh.x2)}, ${r0(sh.y2)})` })
  for (const c of pick(sel.cycles ?? [], Object.values(d.cycles), (x) => x.id)) items.push({ y: c.cy - c.ry, x: c.cx - c.rx, t: `catalytic cycle ${c.id} with ${c.stations.length} stations, centre (${r0(c.cx)}, ${r0(c.cy)})` })
  items.sort((p, q) => (Math.abs(p.y - q.y) > 60 ? p.y - q.y : p.x - q.x))
  const extra = [
    Object.keys(d.curved).length && !onlySel ? `${Object.keys(d.curved).length} mechanism arrow(s)` : '',
    Object.keys(d.fills).length && !onlySel ? `${Object.keys(d.fills).length} ring fill(s)` : '',
  ].filter(Boolean)
  const shown = items.slice(0, 40)
  return [
    `PNG image of ${onlySel ? 'the selection' : 'the whole drawing'} follows. Contents (top to bottom, left to right; x right, y down, bond ≈ ${d.style.bondLength}):`,
    ...shown.map((i) => '- ' + i.t),
    items.length > shown.length ? `- … and ${items.length - shown.length} more objects` : '',
    extra.length ? 'Also: ' + extra.join(', ') + '.' : '',
  ]
    .filter(Boolean)
    .join('\n')
}

async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(s)
}

const json = (v: unknown) => ({ text: JSON.stringify(v, null, 1) })

// ---------- Werkzeuge ----------

async function runTool(name: string, a: Args): Promise<unknown> {
  switch (name) {
    case 'get_document': {
      const d = doc()
      const mols = molecules(d).map((f) => {
        const r = analyze(d, f)
        const b = molBox(d, f)
        let smiles = ''
        try {
          smiles = toSmiles(d, f)
        } catch {
          smiles = ''
        }
        return {
          id: f[0],
          smiles,
          formula: r?.formula,
          molar_mass: r && !r.generic ? Math.round(r.mw * 100) / 100 : undefined,
          box: b && { x: Math.round(b.x1), y: Math.round(b.y1), w: Math.round(b.x2 - b.x1), h: Math.round(b.y2 - b.y1) },
        }
      })
      const all = sceneBBox(getScene(d))
      return json({
        name: getState().fileName,
        bond_length: d.style.bondLength,
        molecules: mols,
        arrows: Object.values(d.arrows).map((x) => ({ id: x.id, kind: x.kind, x1: Math.round(x.x1), y1: Math.round(x.y1), x2: Math.round(x.x2), y2: Math.round(x.y2), above: richPlain(x.above), below: richPlain(x.below) })),
        texts: Object.values(d.texts).map((t) => ({ id: t.id, text: richPlain(t.text), x: Math.round(t.x), y: Math.round(t.y) })),
        tables: Object.values(d.tables ?? {}).map((t) => tableSummary(d, t)),
        shapes: Object.values(d.shapes).map((x) => ({ id: x.id, kind: x.kind, x1: Math.round(x.x1), y1: Math.round(x.y1), x2: Math.round(x.x2), y2: Math.round(x.y2) })),
        curved_arrows: Object.values(d.curved).map((x) => ({ id: x.id, from: x.from, to: x.to, head: x.head })),
        ring_fills: Object.values(d.fills).map((x) => ({ id: x.id, molecule: molecules(d).find((f) => f.includes(x.rings[0]?.[0]))?.[0], rings: x.rings.length, color: x.c1 })),
        cycles: Object.values(d.cycles).map((c) => ({
          id: c.id,
          cx: Math.round(c.cx),
          cy: Math.round(c.cy),
          rx: Math.round(c.rx),
          ry: Math.round(c.ry),
          dir: c.dir,
          stations: c.stations.map((st) => ({ angle: st.angle, label: st.label ? richPlain(st.label) : undefined })),
          branches: c.branches.map((b) => ({ id: b.id, angle: b.angle, type: b.type, label: b.label ? richPlain(b.label) : undefined })),
          arc_labels: (c.arcLabels ?? []).map((l) => ({ id: l.id, angle: l.angle, label: richPlain(l.label) })),
        })),
        bounding_box: all && { x: Math.round(all.x1), y: Math.round(all.y1), w: Math.round(all.x2 - all.x1), h: Math.round(all.y2 - all.y1) },
      })
    }
    case 'get_image': {
      const blob = await renderPng(!!a.only_selection, 2, false)
      if (!blob) return { text: 'The drawing is empty.' }
      return { image: await blobToBase64(blob), mimeType: 'image/png', text: imageDescription(doc(), !!a.only_selection) }
    }
    case 'new_document': {
      // in einem neuen Tab – das bisherige Dokument bleibt im alten Tab offen
      openTab({ fileName: str(a.name) ?? 'Unbenannt' })
      return { text: 'Neues, leeres Dokument in einem neuen Tab angelegt (das bisherige Dokument bleibt im anderen Tab offen).' }
    }
    case 'insert_structure': {
      if (typeof a.structure !== 'string' || !a.structure.trim()) throw new Error('Bitte eine Struktur angeben (SMILES oder name:<Name>).')
      const smiles = await resolveStructure(a.structure)
      const d = doc()
      const all = sceneBBox(getScene(d))
      const x = num(a.x) ?? (all ? all.x2 + 80 : 0)
      const y = num(a.y) ?? (all ? (all.y1 + all.y2) / 2 : 0)
      const ids = insertAt(smiles, x, y)
      const caption = str(a.caption)
      if (caption) {
        const b = molBox(doc(), ids)!
        const tid = uid('t')
        commit((dd) => {
          dd.texts[tid] = { id: tid, x: (b.x1 + b.x2) / 2, y: b.y2 + dd.style.fontSize * 1.2, text: `<b>${caption.replace(/</g, '&lt;')}</b>`, size: dd.style.fontSize, align: 'center' }
        })
      }
      setState({ sel: emptySelection() })
      fitView(1.5)
      const r = analyze(doc(), ids)
      return json({ id: ids[0], smiles: toSmiles(doc(), ids), formula: r?.formula, box: molBox(doc(), ids) })
    }
    case 'draw_reaction': {
      // Listen von Strukturen; ein einzelner Text gilt als Liste mit einem Eintrag
      const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : typeof v === 'string' && v.trim() ? [v] : [])
      const reactants = list(a.reactants)
      const products = list(a.products)
      const reagents = list(a.reagents_above)
      if (!reactants.length && !products.length) throw new Error('Bitte mindestens ein Edukt (reactants) oder Produkt (products) angeben.')
      // alle Strukturen zuerst auflösen (Namen über PubChem), damit nichts halb gezeichnet wird
      const rs = await Promise.all(reactants.map(resolveStructure))
      const ps = await Promise.all(products.map(resolveStructure))
      const gs = await Promise.all(reagents.map(resolveStructure))
      const d0 = doc()
      const L = d0.style.bondLength
      const all = sceneBBox(getScene(d0))
      const y = all ? all.y2 + L * 5 : 0
      let x = all ? all.x1 : 0
      const sel = emptySelection()
      const place = (list: string[]) => {
        list.forEach((s, i) => {
          if (i > 0) {
            sel.texts.push(addPlus(x + L * 0.6, y))
            x += L * 2
          }
          const ids = insertAt(s, x, y)
          sel.atoms.push(...ids)
          x = molBox(doc(), ids)!.x2 + L * 1.2
        })
      }
      place(rs)
      const aid = uid('ar')
      const x1 = x
      x += L * 5
      commit((d) => {
        const ar: Arrow = { id: aid, kind: (str(a.arrow) as ArrowKind) ?? 'reaction', x1, y1: y, x2: x, y2: y, above: str(a.above) ?? '', below: str(a.below) ?? '' }
        if (str(a.yield)) ar.yieldText = str(a.yield)
        d.arrows[aid] = ar
      })
      sel.arrows.push(aid)
      // Reagenz-Strukturen dicht über den Pfeil (übereinander), damit „Reaktion aufräumen“ sie als Reagenzien erkennt
      let top = y - L * 0.8
      for (const s of gs) {
        const ids = insertAt(s, x1 + L, top - L)
        const b = molBox(doc(), ids)!
        commit((d) => translateSelection(d, molSel(d, ids), 0, top - b.y2))
        top -= b.y2 - b.y1 + L * 0.6
        sel.atoms.push(...ids)
      }
      x += L * 1.2
      place(ps)
      setState({ sel: completeSel(doc(), sel) })
      cleanReaction()
      setState({ sel: emptySelection() })
      fitView(1.5)
      return { text: `Reaktion gezeichnet: ${rs.length} Edukt(e), ${gs.length} Reagenz-Struktur(en), ${ps.length} Produkt(e). Pfeil-ID ${aid}.` }
    }
    case 'add_text': {
      const id = uid('t')
      commit((d) => {
        d.texts[id] = {
          id,
          x: num(a.x) ?? 0,
          y: num(a.y) ?? 0,
          text: String(a.text ?? ''),
          size: num(a.size) ?? d.style.fontSize,
          bold: a.bold === true || undefined,
          align: (str(a.align) as 'left' | 'center' | 'right') ?? 'left',
        }
      })
      return { text: 'Text angelegt: ' + id }
    }
    case 'add_arrow': {
      const id = uid('ar')
      commit((d) => {
        d.arrows[id] = { id, kind: (str(a.kind) as ArrowKind) ?? 'reaction', x1: num(a.x1) ?? 0, y1: num(a.y1) ?? 0, x2: num(a.x2) ?? 100, y2: num(a.y2) ?? 0, above: str(a.above) ?? '', below: str(a.below) ?? '' }
      })
      return { text: 'Pfeil angelegt: ' + id }
    }
    case 'move_object':
    case 'delete_objects': {
      const d = doc()
      const ids = name === 'move_object' ? [String(a.id)] : ((a.ids as string[]) ?? [])
      const sel = emptySelection()
      const frs = molecules(d)
      for (const id of ids) {
        if (d.arrows[id]) sel.arrows.push(id)
        else if (d.texts[id]) sel.texts.push(id)
        else if (d.tables?.[id]) sel.tables.push(id)
        else if (d.shapes[id]) sel.shapes.push(id)
        else if (d.curved[id]) sel.curved.push(id)
        else {
          const f = frs.find((x) => x.includes(id))
          if (!f) throw new Error(`Kein Objekt mit der ID „${id}“ (siehe get_document).`)
          sel.atoms.push(...f)
        }
      }
      const full = completeSel(d, sel)
      if (name === 'move_object') {
        commit((dd) => translateSelection(dd, full, num(a.dx) ?? 0, num(a.dy) ?? 0))
        return { text: 'Verschoben.' }
      }
      commit((dd) => deleteItems(dd, full))
      setState({ sel: emptySelection() })
      return { text: `${ids.length} Objekt(e) gelöscht.` }
    }
    case 'clean_reaction': {
      setState({ sel: emptySelection() })
      cleanReaction()
      fitView(1.5)
      return { text: getState().toast?.msg ?? 'Reaktion aufgeräumt.' }
    }
    case 'clean_structures': {
      if (!a.only_selection) selectAll()
      cleanStructure()
      if (!a.only_selection) setState({ sel: emptySelection() })
      return { text: 'Strukturen aufgeräumt.' }
    }
    case 'contract_groups': {
      setState({ sel: emptySelection() })
      contractGroups()
      return { text: getState().toast?.msg ?? 'Fertig.' }
    }
    case 'create_stoich_table': {
      setState({ sel: emptySelection() })
      createStoichTable()
      const ts = Object.values(doc().tables ?? {})
      const t = ts[ts.length - 1]
      if (!t) throw new Error(getState().toast?.msg ?? 'Keine Tabelle angelegt.')
      return json(tableSummary(doc(), t))
    }
    case 'set_stoich_row': {
      const t = tableOf(a)
      const i = rowIndex(t, a.row)
      const calc = computeTable(doc(), t)
      const err: string[] = []
      // CAS: „auto“ = in PubChem suchen, "" = entfernen, sonst Nummer (Prüfziffer wird kontrolliert)
      let cas: string | null | undefined
      if (typeof a.cas === 'string') {
        const v = a.cas.trim()
        if (v.toLowerCase() === 'auto') {
          cas = await lookupRowCas(doc(), t.rows[i])
          if (!cas) err.push('CAS-Nummer in PubChem nicht gefunden.')
        } else if (!v) cas = null
        else if (casValid(v)) cas = v
        else err.push(`„${v}“ ist keine gültige CAS-Nummer (Format oder Prüfziffer).`)
      }
      updateTable(t.id, (tt) => {
        const r = tt.rows[i]
        if (str(a.role)) r.role = str(a.role) as StoichRole
        if (str(a.name)) r.name = str(a.name)
        // Dichte und Konzentration sind getrennte Spalten (0 entfernt den Wert, negativ ist unsinnig)
        if (num(a.conc_M) !== undefined) {
          if (num(a.conc_M)! < 0) err.push('Die Konzentration muss positiv sein (0 entfernt sie).')
          else r.conc = num(a.conc_M) || undefined
        }
        if (str(a.solvent)) r.solvent = str(a.solvent)
        if (num(a.density) !== undefined) {
          if (num(a.density)! < 0) err.push('Die Dichte muss positiv sein (0 entfernt sie).')
          else r.density = num(a.density) || undefined
        }
        if (a.reference === true) {
          // Bezug wechseln: Mengen bleiben, Äquivalente werden umgerechnet
          const nNew = calc.rows[i].n
          tt.rows.forEach((x, k) => {
            const c = calc.rows[k]
            const was = x.ref
            x.ref = k === i || undefined
            if (k === i) {
              if (c.m !== undefined) {
                x.mass = c.m
                x.driver = 'mass'
              }
            } else if ((x.role === 'reactant' || x.role === 'reagent' || x.role === 'catalyst') && c.n !== undefined && nNew) {
              x.eq = c.n / nNew
              if (was || !x.driver || x.driver === 'eq') x.driver = 'eq'
            }
          })
        }
        if (num(a.equivalents) !== undefined) {
          if (num(a.equivalents)! <= 0) err.push('Äquivalente müssen größer als 0 sein.')
          else {
            r.eq = num(a.equivalents)
            if (r.role !== 'product') r.driver = 'eq'
          }
        }
        const amt = str(a.amount)
        if (amt) {
          const p = parseQty(amt, 'm', 'mg')
          if (!p) err.push(`Menge „${amt}“ nicht verstanden (Beispiel: "105 mg", "0.2 mL", "1.5 mmol").`)
          else if (r.role === 'product' && p.kind === 'm') r.obtained = p.value
          else if (p.kind === 'm') {
            r.mass = p.value
            r.driver = 'mass'
          } else if (p.kind === 'V') {
            r.volume = p.value
            r.driver = 'volume'
          } else {
            r.moles = p.value
            r.driver = 'moles'
          }
        }
        const obt = str(a.obtained)
        if (obt) {
          const p = parseQty(obt, 'm', 'mg')
          if (p && p.kind === 'm') r.obtained = p.value
          else err.push(`Erhaltene Masse „${obt}“ nicht verstanden.`)
        }
        if (cas !== undefined) r.cas = cas ?? undefined
      })
      if (err.length) throw new Error(err.join(' '))
      return json(tableSummary(doc(), doc().tables[t.id]))
    }
    case 'add_stoich_row': {
      const t = tableOf(a)
      const row: StoichRow = rowFromName(String(a.text ?? ''), str(a.role) as StoichRole | undefined)
      if (num(a.equivalents) !== undefined && num(a.equivalents)! > 0) row.eq = num(a.equivalents)
      const amt = str(a.amount)
      if (amt) {
        const p = parseQty(amt, row.role === 'solvent' ? 'V' : 'm', row.role === 'solvent' ? 'mL' : 'mg')
        if (p?.kind === 'V') {
          row.volume = p.value
          if (row.role !== 'solvent') row.driver = 'volume'
        } else if (p?.kind === 'm') {
          row.mass = p.value
          row.driver = 'mass'
        } else if (p?.kind === 'n') {
          row.moles = p.value
          row.driver = 'moles'
        }
      }
      updateTable(t.id, (tt) => {
        const prod = tt.rows.findIndex((r) => r.role === 'product')
        if (row.role !== 'product' && prod >= 0) tt.rows.splice(prod, 0, row)
        else tt.rows.push(row)
      })
      void fillSafety(t.id, { quiet: true, auto: true })
      return json(tableSummary(doc(), doc().tables[t.id]))
    }
    case 'set_reaction_conditions': {
      const t = tableOf(a)
      updateTable(t.id, (tt) => {
        for (const k of ['temperature', 'time', 'atmosphere', 'notes'] as const) if (str(a[k]) !== undefined) tt[k] = str(a[k])!.trim() || undefined
        if (a.language === 'de' || a.language === 'en') tt.lang = a.language
      })
      return json(tableSummary(doc(), doc().tables[t.id]))
    }
    case 'export': {
      const d = doc()
      switch (a.format) {
        case 'svg': {
          const r = exportSvgString(d)
          return { text: r ? r.svg : '' }
        }
        case 'cdxml':
          return { text: buildCdxml(d) }
        case 'molfile':
          return { text: toMolfile(d) }
        case 'smiles':
          return { text: toSmiles(d) }
      }
      throw new Error('Unbekanntes Format')
    }
    case 'set_style': {
      const p = STYLE_PRESETS[String(a.preset)]
      if (!p) throw new Error('Unbekannte Vorlage')
      commit((d) => {
        d.style = { ...d.style, ...p.style }
      })
      return { text: 'Stil gesetzt: ' + p.name }
    }
    case 'undo': {
      const n = num(a.steps) ?? 1
      for (let k = 0; k < n; k++) undo()
      return { text: `${n} Schritt(e) rückgängig gemacht.` }
    }
    case 'redo': {
      redo()
      return { text: 'Wiederholt.' }
    }
  }
  const r = await runFullTool(name, a)
  if (r !== undefined) return r
  throw new Error('Unbekanntes Werkzeug: ' + name)
}

// für Tests im Entwicklungsmodus
export const __runTool = (name: string, a: Args) => bypassLocks(() => runTool(name, a))
