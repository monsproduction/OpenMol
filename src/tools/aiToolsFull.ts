// Vollständige Steuerung für Claude (MCP): Datenmodell lesen, beliebige Objekte anlegen/ändern/löschen, Auswahl,
// alle App-Aktionen sowie Spezialwerkzeuge (Katalysezyklus, Ringfüllung, Atome/Bindungen, Mechanismuspfeile,
// Formen, Vorlagen, Stil). Wird von aiBridge.ts für alle Werkzeuge aufgerufen, die dort nicht direkt behandelt werden.
import { dropDanglingGradients } from '../model/gradients'
import { cleanAtomExtras } from '../model/types'
import typesSource from '../model/types.ts?raw'
import { buildGraph, fragments } from '../model/chem'
import { newArcLabel, newBranch, newCycle } from '../model/cycle'
import { oclToFragment, parseStructure } from '../model/ocl'
import { applyRingFill, perceiveRings, ringSystem } from '../model/rings'
import { curvedGeom, getScene, sceneBBox } from '../model/scene'
import { TEMPLATE_GROUPS } from '../model/templates'
import type { Anchor, Atom, BondType, Cycle, Doc, Id, RingFill, Selection, Shape, ShapeKind } from '../model/types'
import { CLOSED_SHAPES, FONTS, emptySelection, safeColor, uid } from '../model/types'
import { findUserTemplate, getUserLib } from '../model/userlib'
import { commit, getState, setState } from '../store'
import type { OrderMode } from '../model/order'
import {
  alignSelection,
  arrange,
  bracketSelection,
  clean3D,
  cleanStructure,
  completeSel,
  contractGroups,
  createStoichTable,
  deleteSelection,
  dockCycle,
  duplicateSelection,
  fitCycleGaps,
  fitView,
  flatten3D,
  flip,
  insertFragmentAt,
  insertUserTemplateAt,
  linkCycles,
  numberCompounds,
  rotate,
  rotate3D,
  selectAll,
  skew,
  toggleBold,
} from './actions'
import { cleanReaction } from './cleanup'
import { insertAt, molBox, molSel, resolveStructure } from './aiBridge'
import { translateSelection } from '../model/ops'

type Args = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
// Zahlen nur in vernünftiger Größe (eine KI kann z. B. 1e308 schicken – damit rechnet nichts mehr richtig)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e7 ? v : undefined)
const doc = () => getState().doc
const json = (v: unknown) => ({ text: JSON.stringify(v, null, 1) })

const KINDS = ['atoms', 'bonds', 'arrows', 'curved', 'texts', 'shapes', 'fills', 'cycles', 'tables'] as const
type Kind = (typeof KINDS)[number]

// ---------- IDs → Auswahl ----------

/** Objekt-IDs in eine Auswahl umsetzen. Eine Atom-ID steht für das ganze Molekül, außer atomsOnly. */
export function idsToSelection(d: Doc, ids: string[], atomsOnly = false): Selection {
  const sel = emptySelection()
  const frs = atomsOnly ? [] : fragments(d, buildGraph(d))
  for (const id of ids) {
    if (d.atoms[id]) {
      if (atomsOnly) sel.atoms.push(id)
      else sel.atoms.push(...(frs.find((f) => f.includes(id)) ?? [id]))
    } else if (d.bonds[id]) sel.bonds.push(id)
    else {
      let found = false
      for (const k of ['arrows', 'curved', 'texts', 'shapes', 'fills', 'cycles', 'tables'] as const) {
        if ((d[k] as Record<string, unknown>)?.[id]) {
          ;(sel[k] as string[]).push(id)
          found = true
          break
        }
      }
      if (!found) throw new Error(`Kein Objekt mit der ID „${id}“ (siehe get_document / get_document_json).`)
    }
  }
  return completeSel(d, sel)
}

// ---------- Dokument reparieren (nach freien Änderungen) ----------

function repair(d: Doc) {
  for (const id in d.atoms) {
    const a = d.atoms[id]
    a.id = id
    if (typeof a.element !== 'string' || !a.element) a.element = 'C'
    if (typeof a.charge !== 'number') a.charge = 0
    if (typeof a.radical !== 'number') a.radical = 0
    if (typeof a.lonePairs !== 'number') a.lonePairs = 0
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) delete d.atoms[id]
    else cleanAtomExtras(a)
  }
  for (const id in d.bonds) {
    const b = d.bonds[id]
    b.id = id
    if (!d.atoms[b.a1] || !d.atoms[b.a2] || b.a1 === b.a2) delete d.bonds[id]
    else {
      if (!b.type) b.type = 'single'
      if (!b.doublePos) b.doublePos = 'auto'
    }
  }
  for (const id in d.fills) {
    const f = d.fills[id]
    f.id = id
    if (!Array.isArray(f.rings) || !f.rings.length || f.rings.some((r) => !Array.isArray(r) || r.some((x) => !d.atoms[x]))) delete d.fills[id]
  }
  for (const id in d.curved) {
    const c = d.curved[id]
    const ok = (an: Anchor) => (an?.type === 'point' ? Number.isFinite(an.x) && Number.isFinite(an.y) : an?.type === 'bond' ? !!d.bonds[an.id] : !!an && !!d.atoms[an.id])
    if (!ok(c.from) || !ok(c.to)) delete d.curved[id]
    else c.id = id
  }
  for (const k of ['arrows', 'texts', 'shapes', 'cycles', 'tables'] as const) for (const id in d[k]) (d[k][id] as { id: string }).id = id
  for (const t of Object.values(d.tables ?? {})) for (const r of t.rows) if (!r.id) r.id = uid('sr')
  dropDanglingGradients(d)
}

/** Standardwerte beim Anlegen */
function defaults(kind: Kind, d: Doc, data: Record<string, unknown>): Record<string, unknown> {
  switch (kind) {
    case 'atoms':
      return { element: 'C', charge: 0, radical: 0, lonePairs: 0, x: 0, y: 0, ...data }
    case 'bonds':
      return { type: 'single', doublePos: 'auto', ...data }
    case 'arrows':
      return { kind: 'reaction', above: '', below: '', x1: 0, y1: 0, x2: 160, y2: 0, ...data }
    case 'curved':
      return { head: 'full', bend: 0.45, ...data }
    case 'texts':
      return { text: '', size: d.style.fontSize, x: 0, y: 0, ...data }
    case 'shapes':
      return { kind: 'rect', x1: 0, y1: 0, x2: 100, y2: 60, ...data }
    case 'fills':
      return { mode: 'fill', grad: 'none', c1: '#cfe0ff', c2: '#7aa2ff', angle: 0, opacity: 1, rings: [], ...data }
    case 'cycles': {
      const c = newCycle(num(data.cx) ?? 0, num(data.cy) ?? 0, num(data.rx) ?? 120, 0, data.dir === 'ccw' ? 'ccw' : 'cw')
      return { ...c, ...data }
    }
    case 'tables':
      return { x: 0, y: 0, lang: 'de', rows: [], ...data }
  }
}

// ---------- Mechanismuspfeile: Krümmung automatisch so, dass der Bogen möglichst frei verläuft ----------

function anchorAtomIds(d: Doc, an: Anchor): string[] {
  if (an.type === 'point') return []
  if (an.type === 'bond') return d.bonds[an.id] ? [d.bonds[an.id].a1, d.bonds[an.id].a2] : []
  return [an.id]
}

/** Krümmung (Seite und Stärke) wählen, bei der der Bogen am wenigsten über Atome und Bindungen läuft */
function bestBend(d: Doc, from: Anchor, to: Anchor): number {
  const scene = getScene(d)
  const L = d.style.bondLength
  const skip = new Set([...anchorAtomIds(d, from), ...anchorAtomIds(d, to)])
  const atoms = Object.values(d.atoms).filter((x) => !skip.has(x.id))
  const bonds = Object.values(d.bonds).filter((b) => !skip.has(b.a1) && !skip.has(b.a2))
  const segDist = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
  }
  let best = 0.45
  let bestScore = Infinity
  for (const bend of [0.45, -0.45, 0.75, -0.75]) {
    const g = curvedGeom(scene, { id: '_', head: 'full', from, to, bend })
    if (!g) return 0.45
    let score = Math.abs(bend) * 0.5 // Tie-Breaker: flacher Bogen, bei Gleichstand die Standardseite
    for (let i = 1; i < 12; i++) {
      const t = i / 12
      const p = {
        x: (1 - t) ** 2 * g.p0.x + 2 * (1 - t) * t * g.c.x + t * t * g.p1.x,
        y: (1 - t) ** 2 * g.p0.y + 2 * (1 - t) * t * g.c.y + t * t * g.p1.y,
      }
      for (const at of atoms) {
        const dd = Math.hypot(p.x - at.x, p.y - at.y)
        if (dd < L * 0.6) score += (1 - dd / (L * 0.6)) * 2
      }
      for (const b of bonds) if (segDist(p, d.atoms[b.a1], d.atoms[b.a2]) < L * 0.18) score += 1
    }
    if (score < bestScore - 1e-9) {
      bestScore = score
      best = bend
    }
  }
  return best
}

// ---------- Werkzeuge ----------

export async function runFullTool(name: string, a: Args): Promise<unknown | undefined> {
  switch (name) {
    case 'get_data_model': {
      // TypeScript-Definitionen des Dokuments (mit Kommentaren) – maßgeblich für edit_objects
      const end = typesSource.indexOf('export const FONTS')
      return { text: (end > 0 ? typesSource.slice(0, end) : typesSource).trim() }
    }
    case 'get_document_json': {
      const d = doc()
      const kinds = (Array.isArray(a.kinds) ? (a.kinds as string[]) : [...KINDS]).filter((k): k is Kind => (KINDS as readonly string[]).includes(k))
      const ids = Array.isArray(a.ids) ? new Set(a.ids as string[]) : null
      const out: Record<string, unknown> = { style: d.style }
      for (const k of kinds) {
        const all = (d[k] ?? {}) as Record<string, unknown>
        out[k] = ids ? Object.fromEntries(Object.entries(all).filter(([id]) => ids.has(id))) : all
      }
      // Farben „grad:<id>“ verweisen auf diese Verläufe
      if (d.gradients) out.gradients = d.gradients
      out.selection = getState().sel
      return json(out)
    }
    case 'edit_objects': {
      const ops = (a.operations as { op: string; kind: string; id?: string; data?: Record<string, unknown> }[]) ?? []
      const created: string[] = []
      const errors: string[] = []
      commit((d) => {
        for (const [i, o] of ops.entries()) {
          if (!(KINDS as readonly string[]).includes(o.kind)) {
            errors.push(`#${i}: unbekannte Art „${o.kind}“`)
            continue
          }
          const k = o.kind as Kind
          const coll = d[k] as unknown as Record<string, Record<string, unknown>>
          if (o.op === 'add') {
            const id = o.id && !coll[o.id] ? o.id : uid(k.slice(0, 2))
            coll[id] = { ...defaults(k, d, o.data ?? {}), id }
            created.push(id)
          } else if (o.op === 'update') {
            if (!o.id || !coll[o.id]) {
              errors.push(`#${i}: ${k} „${o.id}“ nicht gefunden`)
              continue
            }
            for (const [key, v] of Object.entries(o.data ?? {})) {
              if (key === 'id') continue
              if (v === null) delete coll[o.id][key]
              else coll[o.id][key] = v
            }
          } else if (o.op === 'delete') {
            if (!o.id || !coll[o.id]) {
              errors.push(`#${i}: ${k} „${o.id}“ nicht gefunden`)
              continue
            }
            delete coll[o.id]
          } else errors.push(`#${i}: unbekannte Operation „${o.op}“ (add, update, delete)`)
        }
        repair(d)
      })
      return { text: `Ausgeführt: ${ops.length - errors.length} von ${ops.length} Operation(en).` + (created.length ? ` Neue IDs: ${created.join(', ')}.` : '') + (errors.length ? ` Probleme: ${errors.join('; ')}` : '') }
    }
    case 'select': {
      const ids = (a.ids as string[]) ?? []
      const sel = idsToSelection(doc(), ids, a.atoms_only === true)
      if (a.add === true) {
        const cur = getState().sel
        for (const k of Object.keys(sel) as (keyof Selection)[]) sel[k] = [...new Set([...(cur[k] ?? []), ...sel[k]])]
      }
      setState({ sel })
      return { text: `Ausgewählt: ${sel.atoms.length} Atome, ${sel.bonds.length} Bindungen, ${sel.arrows.length} Pfeile, ${sel.texts.length} Texte, ${sel.shapes.length} Formen, ${(sel.cycles ?? []).length} Zyklen, ${(sel.tables ?? []).length} Tabellen.` }
    }
    case 'select_all': {
      selectAll()
      return { text: 'Alles ausgewählt.' }
    }
    case 'clear_selection': {
      setState({ sel: emptySelection() })
      return { text: 'Auswahl aufgehoben.' }
    }
    case 'run_action': {
      // Aktionen der Werkzeugleiste/des Inspektors; wirken auf die aktuelle Auswahl (ohne Auswahl meist auf alles)
      if (Array.isArray(a.ids) && (a.ids as string[]).length) setState({ sel: idsToSelection(doc(), a.ids as string[]) })
      const act = String(a.action)
      const v = num(a.value)
      const toast0 = getState().toast
      switch (act) {
        case 'rotate':
          rotate(v ?? 15)
          break
        case 'flip_horizontal':
          flip('h')
          break
        case 'flip_vertical':
          flip('v')
          break
        case 'align_left':
        case 'align_hcenter':
        case 'align_right':
        case 'align_top':
        case 'align_vcenter':
        case 'align_bottom':
          alignSelection(act.slice(6) as 'left')
          break
        case 'rotate_3d_x':
          rotate3D('x', v ?? 20)
          break
        case 'rotate_3d_y':
          rotate3D('y', v ?? 20)
          break
        case 'clean_3d':
          await clean3D()
          break
        case 'back_to_2d':
          flatten3D()
          break
        case 'skew':
          skew(v ?? 15)
          break
        case 'number_compounds':
          numberCompounds()
          break
        case 'polymer_brackets':
          bracketSelection(false)
          break
        case 'cyclic_brackets':
          bracketSelection(true)
          break
        case 'bring_to_front':
        case 'send_to_back':
        case 'bring_forward':
        case 'send_backward':
          arrange(({ bring_to_front: 'front', send_to_back: 'back', bring_forward: 'forward', send_backward: 'backward' } as Record<string, OrderMode>)[act])
          break
        case 'toggle_bold':
          toggleBold()
          break
        case 'duplicate':
          duplicateSelection()
          break
        case 'delete':
          deleteSelection()
          break
        case 'clean_structure':
          cleanStructure()
          break
        case 'clean_reaction':
          cleanReaction()
          break
        case 'contract_groups':
          contractGroups()
          break
        case 'create_stoich_table':
          createStoichTable()
          break
        case 'fit_view':
          fitView()
          break
        case 'fit_cycle_gaps':
          fitCycleGaps(String(a.cycle_id ?? (getState().sel.cycles ?? [])[0]))
          break
        case 'link_cycles':
          linkCycles(String(a.cycle_id), String(a.target_cycle_id))
          break
        case 'dock_cycle':
          dockCycle(String(a.cycle_id), String(a.target_cycle_id))
          break
        default:
          throw new Error('Unbekannte Aktion: ' + act)
      }
      return { text: `Aktion „${act}“ ausgeführt.` + (getState().toast && getState().toast !== toast0 ? ' Meldung: ' + getState().toast!.msg : '') }
    }
    case 'get_molecule': {
      const d = doc()
      const f = fragments(d, buildGraph(d)).find((x) => x.includes(String(a.id)))
      if (!f) throw new Error('Kein Molekül mit dieser ID.')
      const set = new Set(f)
      const rings = perceiveRings(d, buildGraph(d)).filter((r) => r.every((x) => set.has(x)))
      return json({
        atoms: f.map((id) => {
          const x = d.atoms[id]
          return { id, element: x.element, label: x.label, x: Math.round(x.x), y: Math.round(x.y), z: x.z !== undefined ? Math.round(x.z) : undefined, charge: x.charge || undefined, lonePairs: x.lonePairs || undefined, radical: x.radical || undefined, color: x.color }
        }),
        bonds: Object.values(d.bonds)
          .filter((b) => set.has(b.a1))
          .map((b) => ({ id: b.id, a1: b.a1, a2: b.a2, type: b.type, color: b.color })),
        rings,
        fills: Object.values(d.fills).filter((x) => x.rings.some((r) => r.every((y) => set.has(y)))),
      })
    }
    case 'set_atoms': {
      const ids = (a.ids as string[]) ?? []
      commit((d) => {
        for (const id of ids) {
          const at = d.atoms[id]
          if (!at) continue
          if (str(a.element)) {
            at.element = str(a.element)!
            at.label = undefined
            at.literal = undefined
          }
          if (a.label !== undefined) {
            at.label = str(a.label) || undefined
            at.literal = str(a.label) ? true : undefined
          }
          if (num(a.charge) !== undefined) at.charge = num(a.charge)!
          if (num(a.lone_pairs) !== undefined) at.lonePairs = num(a.lone_pairs)!
          if (num(a.radical) !== undefined) at.radical = num(a.radical)!
          if (num(a.isotope) !== undefined) at.isotope = num(a.isotope) || undefined
          if (a.color !== undefined) at.color = str(a.color) || undefined
          if (a.background !== undefined) at.bg = str(a.background) || undefined
          if (typeof a.show_carbon === 'boolean') at.showC = a.show_carbon || undefined
          if (typeof a.bold === 'boolean') at.bold = a.bold || undefined
          if (typeof a.stereo_mark === 'boolean') at.stereoMark = a.stereo_mark || undefined
          if (typeof a.show_cip === 'boolean') at.showCip = a.show_cip || undefined
          if (a.partial === '+' || a.partial === '-') at.partial = a.partial
          if (a.partial === 'none') at.partial = undefined
        }
      })
      return { text: `${ids.length} Atom(e) geändert.` }
    }
    case 'set_bonds': {
      const d0 = doc()
      const ids = [...((a.ids as string[]) ?? [])]
      for (const p of (a.pairs as [string, string][]) ?? []) {
        const b = Object.values(d0.bonds).find((x) => (x.a1 === p[0] && x.a2 === p[1]) || (x.a1 === p[1] && x.a2 === p[0]))
        if (b) ids.push(b.id)
      }
      commit((d) => {
        for (const id of ids) {
          const b = d.bonds[id]
          if (!b) continue
          if (str(a.type)) b.type = str(a.type) as BondType
          if (a.reverse === true) [b.a1, b.a2] = [b.a2, b.a1]
          if (a.color !== undefined) b.color = str(a.color) || undefined
          if (num(a.width) !== undefined) b.width = num(a.width)
          if (str(a.double_position)) b.doublePos = str(a.double_position) as 'auto'
          if (typeof a.crossed === 'boolean') b.crossed = a.crossed && b.type === 'double' ? true : undefined
        }
      })
      return { text: `${ids.length} Bindung(en) geändert.` }
    }
    case 'fill_rings': {
      const d = doc()
      const g = buildGraph(d)
      const rings = perceiveRings(d, g)
      let target: Id[][] = []
      if (Array.isArray(a.ring_atoms) && (a.ring_atoms as unknown[]).length) {
        const want = new Set(a.ring_atoms as string[])
        target = rings.filter((r) => r.every((x) => want.has(x)) || [...want].every((x) => r.includes(x)))
      } else if (str(a.molecule)) {
        const f = new Set(fragments(d, g).find((x) => x.includes(str(a.molecule)!)) ?? [])
        target = rings.filter((r) => r.every((x) => f.has(x)))
      } else throw new Error('molecule (ID) oder ring_atoms angeben.')
      if (!target.length) throw new Error('Keine passenden Ringe gefunden.')
      if (a.whole_system === true) target = ringSystem(rings, target[0])
      const style = {
        // nur Flächenfüllung (der Kreis im Ring wurde auf Wunsch aus dem Werkzeug entfernt)
        mode: 'fill' as RingFill['mode'],
        grad: (str(a.gradient) as RingFill['grad']) ?? (str(a.color2) ? 'linear' : 'none'),
        c1: str(a.color) ?? '#cfe0ff',
        c2: str(a.color2) ?? str(a.color) ?? '#7aa2ff',
        angle: num(a.angle) ?? 0,
        opacity: num(a.opacity) ?? 1,
      }
      commit((dd) => {
        // Standard: eine Füllung über alle Ringe, damit ein Verlauf durchläuft statt sich je Ring zu wiederholen
        if (a.separately === true) for (const r of target) applyRingFill(dd, [r], style, false)
        else applyRingFill(dd, target, style, false)
      })
      return { text: `${target.length} Ring(e) gefüllt.` }
    }
    case 'remove_ring_fills': {
      const d = doc()
      const f = str(a.molecule) ? new Set(fragments(d, buildGraph(d)).find((x) => x.includes(str(a.molecule)!)) ?? []) : null
      commit((dd) => {
        for (const id in dd.fills) if (!f || dd.fills[id].rings.some((r) => r.some((x) => f.has(x)))) delete dd.fills[id]
      })
      return { text: 'Ringfüllungen entfernt.' }
    }
    case 'add_catalytic_cycle': {
      const d0 = doc()
      const all = sceneBBox(getScene(d0))
      const L = d0.style.bondLength
      const r = num(a.radius) ?? L * 4
      const cx = num(a.cx) ?? (all ? all.x2 + r + L * 2 : 0)
      const cy = num(a.cy) ?? (all ? (all.y1 + all.y2) / 2 : 0)
      // Stationen als Liste; einzelne Texte werden zu Stationen mit diesem Namen
      const st: { label?: string; angle?: number; structure?: string }[] = (Array.isArray(a.stations) ? a.stations : typeof a.stations === 'string' ? [a.stations] : [])
        .map((x) => (typeof x === 'string' ? { label: x } : x && typeof x === 'object' ? x : null))
        .filter((x): x is { label?: string; angle?: number; structure?: string } => !!x)
      const c: Cycle = newCycle(cx, cy, r, st.length, a.direction === 'ccw' ? 'ccw' : 'cw')
      if (num(a.ry)) c.ry = num(a.ry)!
      st.forEach((s, i) => {
        if (num(s.angle) !== undefined) c.stations[i].angle = num(s.angle)!
        if (s.label) c.stations[i].label = s.label
      })
      for (const b of (a.branches as { angle?: number; station?: number; type?: 'in' | 'out'; label?: string; side?: 'in' | 'out' }[]) ?? []) {
        // ohne Winkel: zwischen der angegebenen Station und der nächsten
        let ang = num(b.angle)
        if (ang === undefined && b.station !== undefined && c.stations.length) {
          const s0 = c.stations[b.station % c.stations.length].angle
          const s1 = c.stations[(b.station + 1) % c.stations.length].angle
          const span = (((c.dir === 'cw' ? s1 - s0 : s0 - s1) % 360) + 360) % 360 || 360
          ang = s0 + (c.dir === 'cw' ? 1 : -1) * span / 2
        }
        const nb = newBranch(ang ?? 0, b.type === 'in' ? 'in' : 'out', r)
        if (b.label) nb.label = b.label
        if (b.side) nb.side = b.side
        c.branches.push(nb)
      }
      c.arcLabels = ((a.arc_labels as { angle: number; label: string; side?: 'in' | 'out' }[]) ?? []).map((l) => ({ ...newArcLabel(l.angle, l.side ?? 'in'), label: l.label }))
      if (str(a.color)) c.color = str(a.color)
      if (a.heads === false) c.heads = false
      commit((d) => {
        d.cycles[c.id] = c
      })
      // Strukturen an den Stationen: Molekül mittig auf die Zykluslinie, danach Lücken an die Moleküle anpassen
      const mols: string[] = []
      for (const [i, s] of st.entries()) {
        if (!s.structure) continue
        const ang = (c.stations[i].angle * Math.PI) / 180
        const px = cx + c.rx * Math.cos(ang)
        const py = cy + c.ry * Math.sin(ang)
        const ids = insertAt(await resolveStructure(s.structure), px, py)
        const b = molBox(doc(), ids)
        if (b) commit((d) => translateSelection(d, molSel(d, ids), px - (b.x1 + b.x2) / 2, 0))
        mols.push(ids[0])
      }
      if (mols.length && a.fit_gaps !== false) fitCycleGaps(c.id)
      setState({ sel: emptySelection() })
      if (mols.length) return { text: `Katalysezyklus angelegt: ${c.id} (Mittelpunkt ${Math.round(cx)}, ${Math.round(cy)}; Radius ${Math.round(r)}). Molekül-IDs an den Stationen: ${mols.join(', ')}. Winkel: 0° = rechts, 90° = unten.` }
      return { text: `Katalysezyklus angelegt: ${c.id} (Mittelpunkt ${Math.round(cx)}, ${Math.round(cy)}; Radius ${Math.round(r)}). Winkel: 0° = rechts, 90° = unten (im Uhrzeigersinn).` }
    }
    case 'add_curved_arrow': {
      const toAnchor = (v: unknown): Anchor => {
        const o = (v ?? {}) as Record<string, unknown>
        if (str(o.atom)) return { type: 'atom', id: str(o.atom)! }
        if (str(o.bond)) return { type: 'bond', id: str(o.bond)! }
        if (str(o.lone_pair_atom)) return { type: 'lp', id: str(o.lone_pair_atom)!, index: num(o.index) ?? 0 }
        if (num(o.x) !== undefined && num(o.y) !== undefined) return { type: 'point', x: num(o.x)!, y: num(o.y)! }
        throw new Error('Anker: {atom}, {bond}, {lone_pair_atom, index} oder {x, y} angeben.')
      }
      const id = uid('c')
      const from = toAnchor(a.from)
      const to = toAnchor(a.to)
      const d0 = doc()
      for (const an of [from, to]) if (an.type !== 'point' && !(an.type === 'bond' ? d0.bonds[an.id] : d0.atoms[an.id])) throw new Error(`Anker ungültig: ${an.type} „${an.id}“ nicht gefunden.`)
      const bend = num(a.bend) ?? bestBend(d0, from, to)
      commit((d) => {
        d.curved[id] = { id, head: a.head === 'half' ? 'half' : 'full', from, to, bend, color: str(a.color) }
      })
      return { text: `Mechanismuspfeil angelegt: ${id} (Krümmung ${bend})` }
    }
    case 'add_shape': {
      const id = uid('s')
      const kind = (str(a.kind) ?? 'rect') as ShapeKind
      commit((d) => {
        const s: Shape = { id, kind, x1: num(a.x1) ?? 0, y1: num(a.y1) ?? 0, x2: num(a.x2) ?? 100, y2: num(a.y2) ?? 60 }
        if (str(a.color)) s.color = str(a.color)
        if (CLOSED_SHAPES.has(kind)) {
          if (str(a.fill)) s.fill = str(a.fill)
          if (str(a.fill2)) {
            s.fill2 = str(a.fill2)
            s.fillGrad = (str(a.gradient) as Shape['fillGrad']) ?? 'linear'
          }
          if (num(a.radius) !== undefined) s.radius = num(a.radius)
          if (a.shadow === true) s.shadow = true
          if (a.no_border === true) s.noStroke = true
        }
        if (str(a.index)) s.sub = str(a.index)
        if (str(a.corner)) s.corner = str(a.corner)
        if (a.dashed === true) s.dashed = true
        d.shapes[id] = s
      })
      return { text: 'Form angelegt: ' + id }
    }
    case 'list_templates': {
      const lib = getUserLib()
      return json({
        builtin: TEMPLATE_GROUPS.map((g) => ({ group: g.name, items: g.items.map((t) => t.name) })),
        user: lib.collections.map((c) => ({ collection: c.name, items: c.items.map((t) => ({ name: t.name, id: 'user:' + t.id })) })),
      })
    }
    case 'insert_template': {
      const d0 = doc()
      const all = sceneBBox(getScene(d0))
      const at = { x: num(a.x) ?? (all ? all.x2 + 200 : 0), y: num(a.y) ?? (all ? (all.y1 + all.y2) / 2 : 0) }
      const nm = String(a.name ?? '')
      if (nm.startsWith('user:')) {
        const ut = findUserTemplate(nm.slice(5))
        if (!ut) throw new Error('Eigene Vorlage nicht gefunden.')
        insertUserTemplateAt(ut.clip, at)
      } else {
        const items = TEMPLATE_GROUPS.flatMap((g) => g.items)
        const q = nm.toLowerCase()
        const part = items.filter((t) => t.name.toLowerCase().includes(q))
        const tpl = items.find((t) => t.name.toLowerCase() === q) ?? (part.length === 1 ? part[0] : undefined)
        if (!tpl) throw new Error(part.length ? 'Mehrdeutig: ' + part.map((t) => t.name).join(', ') : 'Vorlage nicht gefunden – siehe list_templates.')
        const frag = tpl.build ? tpl.build(d0.style.bondLength) : oclToFragment(parseStructure(tpl.smiles!), d0.style.bondLength)
        insertFragmentAt(frag, at)
      }
      setState({ sel: emptySelection() })
      return { text: `Vorlage eingefügt bei ${Math.round(at.x)}, ${Math.round(at.y)}.` }
    }
    case 'set_document_style': {
      commit((d) => {
        const s = d.style
        // nur sinnvolle Werte übernehmen (gleiche Grenzen wie beim Öffnen einer Datei)
        const lw = num(a.line_width)
        const fs = num(a.font_size)
        const bl = num(a.bond_length)
        if (lw !== undefined && lw >= 0.1 && lw <= 20) s.lineWidth = lw
        if (fs !== undefined && fs >= 2 && fs <= 200) s.fontSize = fs
        if (bl !== undefined && bl >= 5 && bl <= 400) s.bondLength = bl
        if (str(a.font) && FONTS.some((f) => f.name === str(a.font))) s.font = str(a.font)!
        if (typeof a.color_heteroatoms === 'boolean') s.colorAtoms = a.color_heteroatoms
        if (typeof a.show_all_carbons === 'boolean') s.showCarbons = a.show_all_carbons
        if (typeof a.circle_charges === 'boolean') s.chargeCircle = a.circle_charges
        if (typeof a.show_cip === 'boolean') s.showCip = a.show_cip
        if (typeof a.background === 'string') {
          const c = safeColor(a.background)
          if (!a.background.trim() || c === '#ffffff') s.background = undefined
          else if (c) s.background = c
        }
      })
      return json(doc().style)
    }
    case 'set_colors': {
      // Farbe (und optional Deckkraft) für beliebige Objekte; Molekül-IDs färben das ganze Molekül
      const sel = idsToSelection(doc(), (a.ids as string[]) ?? [])
      const color = str(a.color) || undefined
      const op = num(a.opacity)
      commit((d) => {
        for (const k of ['atoms', 'bonds', 'arrows', 'curved', 'texts', 'shapes', 'cycles'] as const)
          for (const id of (sel[k] as string[]) ?? []) {
            const o = (d[k] as Record<string, { color?: string; opacity?: number }>)[id]
            if (!o) continue
            if (a.color !== undefined) o.color = color
            if (op !== undefined) o.opacity = op >= 0.999 ? undefined : op
          }
      })
      return { text: 'Farbe gesetzt.' }
    }
  }
  return undefined
}

// Atom-Typ für Prüfungen in Tests
export type { Atom }
