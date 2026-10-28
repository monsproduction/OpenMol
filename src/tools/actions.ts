// Befehle, die von Menüs, Tastenkürzeln und der Zeichenfläche gemeinsam genutzt werden.
import { GRAD_PREFIX, gradId, isGrad } from '../model/gradients'
import { atomScale, setMolScale } from '../model/molscale'
import { autoNumber } from '../model/numbering'
import { countObjects, hasLocked, inGroup, lockItems, makeGroup, removeGroups, unlockAll, withoutLocked } from '../model/groups'
import { linkTable } from '../model/reactionLink'
import { isotopePattern } from '../model/isotopePattern'
import { buildGraph, fragments } from '../model/chem'
import { boxFromPts, mid, type Box } from '../model/geom'
import * as OCL from 'openchemlib'
import { analyze, cleanCoordinates, docToOCL, findContractibleGroups, oclToFragment, parseStructure, pubchemLookup, smilesToName, toSmiles, wikipediaLookup } from '../model/ocl'
import { ABBREVIATIONS, canonicalAbbrev } from '../model/abbrev'
import { chemLabel } from '../model/richtext'
import { center3, hoopLayout, orientForDrawing, rotate3, type V3 } from '../model/three'
import { perceiveRings } from '../model/rings'
import { eAngle, eRadiusAt, newLink } from '../model/cycle'
import {
  deleteItems,
  extractClip,
  flipSelection,
  insertFragment,
  pasteClip,
  rotateSelection,
  selectionAtomIds,
  transformSelection,
  translateSelection,
  remember2D,
  restore2D,
} from '../model/ops'
import { getScene, sceneBBox, textBox } from '../model/scene'
import { PAGE_FORMATS, addPageAt, fitLayout, sheetBox, trimLayout } from '../model/pages'
import type { ClipData } from '../model/ops'
import { applyOrder, reorderKeys, type OrderMode } from '../model/order'
import type { Fragment } from '../model/ocl'
import type { Doc, Id, Selection, StoichRow } from '../model/types'
import { formulaHtml, newRow, parseConditionText } from '../model/stoich'
import { emptySelection, selectionSize, uid, type Gradient } from '../model/types'
import { richPlain } from '../model/richtext'
import { clipboard, commit, getState, pruneSel, setState, toast } from '../store'
import { fmtDec, getSettings } from '../settings'
import { copyImageToClipboard } from './io'

export function selectAll() {
  const d = getState().doc
  setState({
    // gesperrte Objekte bleiben außen vor
    sel: withoutLocked(d, {
      atoms: Object.keys(d.atoms),
      bonds: Object.keys(d.bonds),
      arrows: Object.keys(d.arrows),
      curved: Object.keys(d.curved),
      texts: Object.keys(d.texts),
      shapes: Object.keys(d.shapes),
      fills: Object.keys(d.fills),
      cycles: Object.keys(d.cycles ?? {}),
      tables: Object.keys(d.tables ?? {}),
    }),
  })
}

// ---------- Größe von Molekülen ----------

/** markierte Moleküle auf s (1 = 100 %) bringen – proportional: Bindungen, Linien und Schrift */
export function scaleMolecules(s: number) {
  const { doc, sel } = getState()
  const ids = [...selectionAtomIds(doc, completeSel(doc, sel))]
  if (!ids.length) return toast('Erst ein Molekül auswählen')
  if (!Number.isFinite(s) || s <= 0) return
  const k = Math.min(10, Math.max(0.1, s))
  commit((d) => setMolScale(d, ids, k))
}

// ---------- Atomnummerierung (NMR-Zuordnung) ----------

/** Moleküle der Auswahl (sonst alle) nach vereinfachten IUPAC-Regeln nummerieren; vorhandene Nummern dort ersetzen */
export function autoNumberAtoms() {
  const { doc, sel } = getState()
  const ids = selectionSize(sel) ? [...selectionAtomIds(doc, completeSel(doc, sel))] : Object.keys(doc.atoms)
  if (!ids.length) return toast('Erst eine Struktur zeichnen oder markieren')
  const { nums, fallback } = autoNumber(doc, ids)
  const frag = new Set(fragments(doc, getScene(doc).g, ids).flat())
  commit((d) => {
    for (const id of frag) {
      const a = d.atoms[id]
      if (!a) continue
      a.num = nums.get(id)
      delete a.numOff
    }
  })
  toast(
    fallback
      ? 'Nummeriert – für ein Ringsystem gab es keine Regel (fortlaufend nummeriert): bitte mit dem Werkzeug „Nummerieren“ korrigieren'
      : 'Nach vereinfachten IUPAC-Regeln nummeriert – bitte prüfen; korrigieren mit dem Werkzeug „Nummerieren“',
  )
}

/** Nummern der Auswahl (sonst aller Atome) entfernen */
export function clearAtomNumbers() {
  const { doc, sel } = getState()
  const ids = selectionSize(sel) ? [...selectionAtomIds(doc, sel)] : Object.keys(doc.atoms)
  if (!ids.some((id) => doc.atoms[id]?.num)) return toast('Keine Atomnummern vorhanden')
  commit((d) => {
    for (const id of ids)
      if (d.atoms[id]) {
        delete d.atoms[id].num
        delete d.atoms[id].numOff
      }
  })
}

// ---------- Gruppieren und Sperren ----------

/** ⌘G: Auswahl gruppieren (mindestens zwei Objekte; ein Molekül zählt als eines) */
export function groupSelection() {
  const { doc, sel } = getState()
  const s = completeSel(doc, sel)
  if (countObjects(doc, s) < 2) return toast('Zum Gruppieren mindestens zwei Objekte auswählen (z. B. Molekül und Text)')
  commit((d) => makeGroup(d, s, uid('g')))
  toast('Gruppiert – wird jetzt als Ganzes ausgewählt (⇧⌘G löst die Gruppe)')
}

/** ⇧⌘G: Gruppen der Auswahl auflösen */
export function ungroupSelection() {
  const { doc, sel } = getState()
  if (!inGroup(doc, sel)) return toast('Die Auswahl gehört zu keiner Gruppe')
  commit((d) => void removeGroups(d, sel))
}

/** ⌘L: Auswahl sperren – danach nicht mehr anklickbar oder verschiebbar */
export function lockSelection() {
  const { doc, sel } = getState()
  if (!selectionSize(sel)) return toast('Erst Objekte auswählen')
  const s = completeSel(doc, sel)
  commit((d) => lockItems(d, s), { keepSel: false })
  toast('Gesperrt – zum Bearbeiten: Rechtsklick ▸ „Alle entsperren“ (⇧⌘L)')
}

/** ⇧⌘L: alle Sperren aufheben */
export function unlockEverything() {
  if (!hasLocked(getState().doc)) return toast('Es ist nichts gesperrt')
  commit((d) => unlockAll(d))
  toast('Alle Objekte entsperrt')
}

export function deleteSelection() {
  const { sel } = getState()
  if (!selectionSize(sel)) return
  commit((d) => deleteItems(d, sel), { keepSel: false })
}

/** Auswahl um Bindungen zwischen ausgewählten Atomen ergänzen */
export function completeSel(d: Doc, s: Selection): Selection {
  const atoms = selectionAtomIds(d, s)
  const bonds = new Set(s.bonds)
  for (const id in d.bonds) {
    const b = d.bonds[id]
    if (atoms.has(b.a1) && atoms.has(b.a2)) bonds.add(id)
  }
  return { ...s, atoms: [...atoms], bonds: [...bonds] }
}

export function selectionCenter(): { x: number; y: number } | null {
  const { doc, sel } = getState()
  const scene = getScene(doc)
  const atomIds = selectionAtomIds(doc, sel)
  const only = {
    atoms: atomIds,
    bonds: new Set(sel.bonds),
    arrows: new Set(sel.arrows),
    curved: new Set(sel.curved),
    texts: new Set(sel.texts),
    shapes: new Set(sel.shapes), cycles: new Set(sel.cycles ?? []), tables: new Set(sel.tables ?? []),
  }
  const box = sceneBBox(scene, only)
  if (!box) return null
  return mid({ x: box.x1, y: box.y1 }, { x: box.x2, y: box.y2 })
}

function targetSel(): Selection | null {
  const { doc, sel } = getState()
  if (selectionSize(sel)) return completeSel(doc, sel)
  const has = (o?: object) => !!o && Object.keys(o).length > 0
  if (!has(doc.atoms) && !has(doc.arrows) && !has(doc.texts) && !has(doc.shapes) && !has(doc.cycles) && !has(doc.curved) && !has(doc.tables)) return null
  selectAll()
  return getState().sel
}

export function rotate(deg: number) {
  const s = targetSel()
  const c = selectionCenter()
  if (!s || !c) return
  commit((d) => rotateSelection(d, s, c, (deg * Math.PI) / 180))
}

export function flip(axis: 'h' | 'v') {
  const s = targetSel()
  const c = selectionCenter()
  if (!s || !c) return
  commit((d) => flipSelection(d, s, c, axis))
}

export function copySelection(cut = false) {
  const { doc, sel } = getState()
  if (!selectionSize(sel)) return
  clipboard.data = JSON.parse(JSON.stringify(extractClip(doc, completeSel(doc, sel))))
  clipboard.pasteCount = 0
  const atomIds = [...selectionAtomIds(doc, sel)]
  try {
    clipboard.smiles = atomIds.length ? toSmiles(doc, atomIds) : ''
  } catch {
    clipboard.smiles = ''
  }
  // System-Zwischenablage: PNG-Bild (für Word, PowerPoint …). Innerhalb der App wird die
  // vollständige Zeichnung aus der internen Zwischenablage eingefügt.
  void copyImageToClipboard(true).then((ok) => {
    toast(
      ok
        ? (cut ? 'Ausgeschnitten' : 'Kopiert') + ' – als Bild in Word/PowerPoint einfügbar'
        : (cut ? 'Ausgeschnitten' : 'Kopiert') + ' (nur innerhalb der App – der Browser blockiert Bilder in der Zwischenablage; Export → PNG nutzen)',
    )
  })
  if (cut) deleteSelection()
}

export function pasteInternal(at?: { x: number; y: number }) {
  const c = clipboard.data
  if (!c) return false
  clipboard.pasteCount++
  let dx = 20 * clipboard.pasteCount
  let dy = 20 * clipboard.pasteCount
  if (at) {
    const xs = [...c.atoms.map((a) => a.x), ...c.texts.map((t) => t.x), ...c.arrows.flatMap((a) => [a.x1, a.x2])]
    const ys = [...c.atoms.map((a) => a.y), ...c.texts.map((t) => t.y), ...c.arrows.flatMap((a) => [a.y1, a.y2])]
    if (xs.length) {
      dx = at.x - (Math.min(...xs) + Math.max(...xs)) / 2
      dy = at.y - (Math.min(...ys) + Math.max(...ys)) / 2
    }
  }
  commit((d) => pasteClip(d, c, dx, dy))
  return true
}

export function duplicateSelection() {
  const { doc, sel } = getState()
  if (!selectionSize(sel)) return
  const c = JSON.parse(JSON.stringify(extractClip(doc, completeSel(doc, sel))))
  commit((d) => pasteClip(d, c, 24, 24))
}

/** Fügt eine Struktur (SMILES/Molfile) an einer Position ein */
export function insertStructureText(text: string, at?: { x: number; y: number }): boolean {
  try {
    const mol = parseStructure(text)
    const st = getState()
    let pos = at ?? viewCenter()
    const frag = oclToFragment(mol, st.doc.style.bondLength, { x: 0, y: 0 })
    if (!at) {
      // nicht über vorhandene Zeichnung legen: rechts daneben einfügen
      const box = sceneBBox(getScene(st.doc))
      if (box && frag.atoms.length) {
        const minX = Math.min(...frag.atoms.map((a) => a.x))
        const maxX = Math.max(...frag.atoms.map((a) => a.x))
        const fx1 = pos.x + minX
        const fx2 = pos.x + maxX
        if (fx2 > box.x1 - 20 && fx1 < box.x2 + 20) pos = { x: box.x2 + 50 - minX, y: (box.y1 + box.y2) / 2 }
      }
    }
    for (const a of frag.atoms) {
      a.x += pos.x
      a.y += pos.y
    }
    commit((d) => insertFragment(d, frag))
    if (!at) {
      const el = document.querySelector('.canvas-wrap') as HTMLElement | null
      const v = getState().view
      const right = (Math.max(...frag.atoms.map((a) => a.x)) + 30) * v.zoom + v.panX
      if (el && right > el.clientWidth) fitView(v.zoom)
    }
    return true
  } catch (e) {
    toast('Struktur nicht lesbar: ' + (e instanceof Error ? e.message : String(e)), 'error')
    return false
  }
}

export function insertFragmentAt(frag: Fragment, at: { x: number; y: number }) {
  // Fragment um at zentrieren
  const xs = frag.atoms.map((a) => a.x)
  const ys = frag.atoms.map((a) => a.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const moved: Fragment = {
    atoms: frag.atoms.map((a) => ({ ...a, x: a.x - cx + at.x, y: a.y - cy + at.y })),
    bonds: frag.bonds,
    circles: frag.circles,
  }
  commit((d) => insertFragment(d, moved))
}

export function viewCenter(): { x: number; y: number } {
  const { view } = getState()
  const el = document.querySelector('.canvas-wrap') as HTMLElement | null
  const w = el?.clientWidth ?? 800
  const h = el?.clientHeight ?? 600
  return { x: (w / 2 - view.panX) / view.zoom, y: (h / 2 - view.panY) / view.zoom }
}

/** Layoutfehler eines Moleküls: sich kreuzende Bindungen (schwer) und fast aufeinanderliegende, nicht verbundene Atome */
function layoutFaults(doc: Doc, atomIds: Id[], at: (id: Id) => { x: number; y: number }): number {
  const L = doc.style.bondLength
  const set = new Set(atomIds)
  const bonds = Object.values(doc.bonds).filter((b) => set.has(b.a1) && set.has(b.a2))
  const bonded = new Set(bonds.flatMap((b) => [b.a1 + '|' + b.a2, b.a2 + '|' + b.a1]))
  let f = 0
  for (let i = 0; i < atomIds.length; i++)
    for (let j = i + 1; j < atomIds.length; j++) {
      if (bonded.has(atomIds[i] + '|' + atomIds[j])) continue
      const p = at(atomIds[i])
      const q = at(atomIds[j])
      if (Math.hypot(p.x - q.x, p.y - q.y) < L * 0.5) f += 1
    }
  const o = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  for (let i = 0; i < bonds.length; i++)
    for (let j = i + 1; j < bonds.length; j++) {
      const a = bonds[i]
      const b = bonds[j]
      if (a.a1 === b.a1 || a.a1 === b.a2 || a.a2 === b.a1 || a.a2 === b.a2) continue
      const [p1, p2, q1, q2] = [at(a.a1), at(a.a2), at(b.a1), at(b.a2)]
      if (o(p1, p2, q1) * o(p1, p2, q2) < 0 && o(q1, q2, p1) * o(q1, q2, p2) < 0) f += 3
    }
  return f
}

export function cleanStructure() {
  const { doc, sel } = getState()
  const g = buildGraph(doc)
  let ids: Id[] = [...selectionAtomIds(doc, sel)]
  if (!ids.length) ids = Object.keys(doc.atoms)
  if (!ids.length) return
  // pro Fragment bereinigen, damit getrennte Moleküle an ihrem Platz bleiben. Ist nur ein Teil eines Moleküls
  // markiert, wird das ganze Molekül bereinigt (ein Teilstück für sich neu anzuordnen würde das Molekül zerreißen)
  const touched = new Set(ids)
  const frs = fragments(doc, g, Object.keys(doc.atoms)).filter((f) => f.some((id) => touched.has(id)))
  try {
    const all = new Map<Id, { x: number; y: number }>()
    let kept = 0
    for (const f of frs) {
      if (f.length < 2) continue
      const res = cleanCoordinates(doc, f)
      // skaliertes Molekül (molscale): bereinigte Lage auf seine Größe strecken (um die Mitte)
      const k = atomScale(doc.atoms[f[0]])
      if (k !== 1 && res.size) {
        let cx = 0
        let cy = 0
        for (const p of res.values()) {
          cx += p.x / res.size
          cy += p.y / res.size
        }
        for (const [id, p] of res) res.set(id, { x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k })
      }
      // Sicherheitsnetz: nie ein Ergebnis übernehmen, das sich stärker überlappt als die bisherige Zeichnung
      const before = layoutFaults(doc, f, (id) => doc.atoms[id])
      const after = layoutFaults(doc, f, (id) => res.get(id) ?? doc.atoms[id])
      if (after > before) {
        kept++
        continue
      }
      for (const [id, p] of res) all.set(id, p)
    }
    // Moleküle, die sich gegenseitig überdecken (z. B. Salze/Komplexe, die PubChem in Teilen liefert), auseinanderrücken:
    // das größte bleibt stehen, die übrigen wandern rechts daneben. Getrennt liegende Moleküle bleiben, wo sie sind.
    const L = doc.style.bondLength
    const posOf = (id: Id) => all.get(id) ?? doc.atoms[id]
    const boxOf = (f: Id[]): Box => {
      const ps = f.map(posOf)
      return { x1: Math.min(...ps.map((q) => q.x)), y1: Math.min(...ps.map((q) => q.y)), x2: Math.max(...ps.map((q) => q.x)), y2: Math.max(...ps.map((q) => q.y)) }
    }
    const overlap = (a: Box, b: Box) => a.x1 < b.x2 + L * 0.3 && b.x1 < a.x2 + L * 0.3 && a.y1 < b.y2 + L * 0.3 && b.y1 < a.y2 + L * 0.3
    const order = [...frs].sort((p, q) => q.length - p.length)
    const placed: Box[] = []
    for (const f of order) {
      let b = boxOf(f)
      if (placed.some((pb) => overlap(pb, b))) {
        const right = Math.max(...placed.filter((pb) => pb.y1 < b.y2 && b.y1 < pb.y2).map((pb) => pb.x2), ...placed.map((pb) => pb.x2))
        const dx = right + L * 1.2 - b.x1
        for (const id of f) {
          const q = posOf(id)
          all.set(id, { x: q.x + dx, y: q.y })
        }
        b = boxOf(f)
      }
      placed.push(b)
    }
    if (!all.size) {
      toast(kept ? 'Bereinigen hätte die Struktur verschlechtert – Zeichnung unverändert gelassen' : 'Nichts zu bereinigen')
      return
    }
    commit((d) => {
      for (const [id, p] of all) {
        d.atoms[id].x = p.x
        d.atoms[id].y = p.y
        delete d.atoms[id].z
      }
    })
    toast('Struktur bereinigt')
  } catch (e) {
    toast('Bereinigen fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e)), 'error')
  }
}

export function zoomTo(z: number, around?: { sx: number; sy: number }) {
  const { view } = getState()
  const el = document.querySelector('.canvas-wrap') as HTMLElement | null
  const sx = around?.sx ?? (el?.clientWidth ?? 800) / 2
  const sy = around?.sy ?? (el?.clientHeight ?? 600) / 2
  if (Number.isNaN(z)) return
  const nz = Math.min(8, Math.max(0.04, z))
  const docX = (sx - view.panX) / view.zoom
  const docY = (sy - view.panY) / view.zoom
  setState({ view: { zoom: nz, panX: sx - docX * nz, panY: sy - docY * nz } })
}

/** Ansicht einpassen; maxZoom begrenzt das Vergrößern (beim Öffnen kleiner Strukturen nicht riesig zeigen) */
export function fitView(maxZoom = 3) {
  const { doc } = getState()
  const box = sceneBBox(getScene(doc))
  const el = document.querySelector('.canvas-wrap') as HTMLElement | null
  if (!el) return
  if (!box) {
    setState({ view: { zoom: 1, panX: el.clientWidth / 2, panY: el.clientHeight / 2 } })
    return
  }
  const w = el.clientWidth
  const h = el.clientHeight
  const bw = box.x2 - box.x1 + 80
  const bh = box.y2 - box.y1 + 80
  const z = Math.min(maxZoom, Math.max(0.2, Math.min(w / bw, h / bh)))
  const c = mid({ x: box.x1, y: box.y1 }, { x: box.x2, y: box.y2 })
  setState({ view: { zoom: z, panX: w / 2 - c.x * z, panY: h / 2 - c.y * z } })
}

/** Ansicht nur dann anpassen, wenn die Zeichnung (nach Aufräumen o. Ä.) über den sichtbaren Bereich hinausragt;
 *  dabei nie stärker vergrößern als bisher */
export function ensureVisible() {
  const { doc, view } = getState()
  const box = sceneBBox(getScene(doc))
  const el = document.querySelector('.canvas-wrap') as HTMLElement | null
  if (!box || !el) return
  const x1 = box.x1 * view.zoom + view.panX
  const x2 = box.x2 * view.zoom + view.panX
  const y1 = box.y1 * view.zoom + view.panY
  const y2 = box.y2 * view.zoom + view.panY
  if (x1 >= 0 && y1 >= 0 && x2 <= el.clientWidth && y2 <= el.clientHeight) return
  fitView(view.zoom)
}

/** Ausrichten mehrerer Objekte (Fragmente, Pfeile, Texte) */
export function alignSelection(mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') {
  const { doc, sel } = getState()
  const s = completeSel(doc, sel)
  const scene = getScene(doc)
  const g = scene.g
  type Item = { sel: Selection; box: ReturnType<typeof boxFromPts> }
  const items: Item[] = []
  const frs = fragments(doc, g, s.atoms)
  for (const f of frs) {
    const fs = completeSel(doc, { ...emptySelection(), atoms: f })
    const b = sceneBBox(scene, { atoms: new Set(f), bonds: new Set(fs.bonds) })
    if (b) items.push({ sel: fs, box: b })
  }
  for (const k of ['arrows', 'texts', 'shapes'] as const) {
    for (const id of s[k]) {
      const one = { ...emptySelection(), [k]: [id] }
      const b = sceneBBox(scene, { [k]: new Set([id]) })
      if (b) items.push({ sel: one, box: b })
    }
  }
  if (items.length < 2) {
    toast('Zum Ausrichten mindestens zwei Objekte auswählen')
    return
  }
  const ref = {
    left: Math.min(...items.map((i) => i.box.x1)),
    right: Math.max(...items.map((i) => i.box.x2)),
    top: Math.min(...items.map((i) => i.box.y1)),
    bottom: Math.max(...items.map((i) => i.box.y2)),
  }
  const hc = (ref.left + ref.right) / 2
  const vc = (ref.top + ref.bottom) / 2
  commit((d) => {
    for (const it of items) {
      let dx = 0
      let dy = 0
      const b = it.box
      if (mode === 'left') dx = ref.left - b.x1
      if (mode === 'right') dx = ref.right - b.x2
      if (mode === 'hcenter') dx = hc - (b.x1 + b.x2) / 2
      if (mode === 'top') dy = ref.top - b.y1
      if (mode === 'bottom') dy = ref.bottom - b.y2
      if (mode === 'vcenter') dy = vc - (b.y1 + b.y2) / 2
      translateSelection(d, it.sel, dx, dy)
    }
  })
}


/** 3D-Kippen (echte Drehung im Raum, Tiefe bleibt erhalten) */
export function tilt(axis: 'x' | 'y', deg: number) {
  rotate3D(axis === 'x' ? 'x' : 'y', deg)
}

/** Scherung (Neigen) für perspektivische Darstellungen */
export function skew(deg: number) {
  const s = targetSel()
  const c = selectionCenter()
  if (!s || !c) return
  const t = Math.tan((deg * Math.PI) / 180)
  commit((d) => transformSelection(d, s, (p) => ({ x: p.x + (p.y - c.y) * t, y: p.y })))
}

/** Fette Verbindungsnummern (1, 2, 3 …) zentriert unter die Moleküle setzen */
export function numberCompounds() {
  const { doc, sel } = getState()
  const scene = getScene(doc)
  const atomIds = selectionSize(sel) ? [...selectionAtomIds(doc, sel)] : Object.keys(doc.atoms)
  const frs = fragments(doc, scene.g, atomIds)
  if (!frs.length) return toast('Keine Moleküle ausgewählt')
  let next = 1
  for (const t of Object.values(doc.texts)) {
    const n = parseInt(richPlain(t.text).trim(), 10)
    if (/^\d+$/.test(richPlain(t.text).trim()) && n >= next) next = n + 1
  }
  const boxes = frs
    .map((f) => sceneBBox(scene, { atoms: new Set(f), bonds: new Set(completeSel(doc, { ...emptySelection(), atoms: f }).bonds) }))
    .filter((b): b is NonNullable<typeof b> => !!b)
    .sort((a, b) => (Math.abs(a.y1 - b.y1) > 60 ? a.y1 - b.y1 : a.x1 - b.x1))
  const size = Math.round(doc.style.fontSize * 0.85)
  commit((d) => {
    for (const b of boxes) {
      const id = uid('t')
      d.texts[id] = { id, x: (b.x1 + b.x2) / 2, y: b.y2 + size * 1.1, text: String(next++), size, bold: true, align: 'center' }
    }
  })
}

// ---------- 3D ----------

export const NEED_3D_SELECTION = 'Für 3D bitte zuerst ein Molekül oder einen Molekülteil markieren'

/** Zielatome für 3D-Befehle: nur die markierten Atome – nie stillschweigend das ganze Dokument */
function atoms3dTarget(): Id[] {
  const { doc, sel } = getState()
  const ids = [...selectionAtomIds(doc, sel)]
  if (!ids.length) toast(NEED_3D_SELECTION)
  return ids
}

/** Echte 3D-Drehung um die waagerechte (x) bzw. senkrechte (y) Bildschirmachse */
export function rotate3D(axis: 'x' | 'y', deg: number) {
  const ids = atoms3dTarget()
  if (!ids.length) return
  const { doc } = getState()
  const c = center3(doc, ids)
  const a = (deg * Math.PI) / 180
  commit((d) => {
    remember2D(d, ids)
    for (const id of ids) {
      const at = d.atoms[id]
      const [x, y, z] = rotate3([at.x, at.y, at.z ?? 0], c, axis === 'x' ? a : 0, axis === 'y' ? a : 0)
      at.x = x
      at.y = y
      at.z = z
    }
  })
}

/** Zurück zu 2D: ursprüngliche Zeichnung vor dem ersten 3D-Schritt wiederherstellen (sonst nur Tiefe entfernen) */
export function flatten3D() {
  const { doc, sel } = getState()
  // Zurück zu 2D darf ohne Markierung für alles gelten (stellt nur wieder her, verändert nichts Flaches)
  const marked = [...selectionAtomIds(doc, sel)]
  const ids = marked.length ? marked : Object.keys(doc.atoms)
  if (!ids.some((id) => doc.atoms[id]?.z !== undefined || doc.atoms[id]?.flat2d)) return toast('Die Struktur ist bereits flach (2D)')
  let restored = 0
  commit((d) => {
    restored = restore2D(d, ids)
  })
  if (!restored) toast('Keine ursprüngliche 2D-Zeichnung gespeichert – nur die Tiefe wurde entfernt')
}

/** ⇧⌘D: markierte Struktur in 3D – ist sie schon räumlich, zurück zur 2D-Zeichnung */
export function toggle3D() {
  const { doc, sel } = getState()
  const ids = [...selectionAtomIds(doc, sel)]
  if (!ids.length) return toast(NEED_3D_SELECTION)
  if (ids.some((id) => doc.atoms[id]?.z !== undefined || doc.atoms[id]?.flat2d)) flatten3D()
  else void clean3D()
}

let resourcesReady: Promise<void> | null = null
function oclResources(): Promise<void> {
  if (!resourcesReady) {
    resourcesReady = OCL.Resources.registerFromUrl(import.meta.env.BASE_URL + 'ocl-resources.json').catch((e) => {
      resourcesReady = null
      throw e
    })
  }
  return resourcesReady
}

/**
 * 3D bereinigen: berechnet mit dem Konformer-Generator von OpenChemLib (Kraftfeld MMFF94) eine
 * räumliche Struktur mit normalen Bindungslängen – auch aus Zeichnungen mit langen Bindungen,
 * z. B. eine Phenylenkette mit Ringschluss → Cycloparaphenylen.
 */
export async function clean3D() {
  const ids = atoms3dTarget()
  if (!ids.length) return
  const { doc } = getState()
  const g = buildGraph(doc)
  const frs = fragments(doc, g, ids).filter((f) => f.length >= 2)
  if (!frs.length) return toast('Keine Struktur zum Bereinigen')
  toast('3D-Struktur wird berechnet …')
  const L = doc.style.bondLength
  const results = new Map<Id, { x: number; y: number; z: number }>()
  for (const f of frs) {
    // Makrozyklen aus Ringeinheiten (Cycloparaphenylene usw.): idealisierte, symmetrische Reifendarstellung
    const hoop = hoopLayout(doc, g, f)
    if (hoop) {
      for (const [id, p] of hoop) results.set(id, { x: p[0], y: p[1], z: p[2] })
      continue
    }
    try {
      await oclResources()
    } catch {
      toast('3D-Daten konnten nicht geladen werden', 'error')
      continue
    }
    const { mol, map } = docToOCL(doc, f)
    let ok: unknown = null
    try {
      ok = new OCL.ConformerGenerator(12345).getOneConformerAsMolecule(mol)
    } catch {
      ok = null
    }
    if (!ok) {
      toast('Für eine Struktur konnte keine 3D-Geometrie berechnet werden', 'error')
      continue
    }
    const idx = f.map((id) => map.get(id)!)
    const pts: V3[] = idx.map((k) => [mol.getAtomX(k), mol.getAtomY(k), mol.getAtomZ(k)])
    // Bindungslänge auf das Dokument skalieren
    let sum = 0
    let cnt = 0
    const local = new Map(f.map((id, i) => [id, i]))
    for (const b of Object.values(doc.bonds)) {
      const i = local.get(b.a1)
      const j = local.get(b.a2)
      if (i === undefined || j === undefined) continue
      sum += Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2])
      cnt++
    }
    const s = cnt ? L / (sum / cnt) : L / 1.4
    const rings = perceiveRings(doc, g)
      .filter((r) => r.every((a) => local.has(a)))
      .map((r) => r.map((a) => local.get(a)!))
    const { out } = orientForDrawing(pts, rings)
    // am alten Schwerpunkt platzieren
    let cx = 0
    let cy = 0
    for (const id of f) {
      cx += doc.atoms[id].x / f.length
      cy += doc.atoms[id].y / f.length
    }
    f.forEach((id, i) => results.set(id, { x: cx + out[i][0] * s, y: cy + out[i][1] * s, z: out[i][2] * s }))
  }
  if (!results.size) return
  commit((d) => {
    remember2D(d, results.keys())
    for (const [id, p] of results) {
      const a = d.atoms[id]
      a.x = p.x
      a.y = p.y
      a.z = p.z
    }
  })
  toast('3D-Struktur berechnet – mit dem 3D-Werkzeug frei drehbar')
}

// ---------- Katalysezyklen ----------

/**
 * Lücken an Moleküle/Texte anpassen, die auf der Zykluslinie liegen: Station mittig unter das Objekt,
 * Lücke so breit wie das Objekt plus Abstand. Fehlt dort eine Station, wird eine angelegt.
 */
export function fitCycleGaps(cycleId: Id) {
  const { doc } = getState()
  const c = doc.cycles[cycleId]
  if (!c) return
  const scene = getScene(doc)
  const g = scene.g
  const boxes: Box[] = []
  for (const f of fragments(doc, g, Object.keys(doc.atoms))) {
    const set = new Set(f)
    const b = sceneBBox(scene, { atoms: set, bonds: new Set(Object.values(doc.bonds).filter((x) => set.has(x.a1)).map((x) => x.id)) })
    if (b) boxes.push(b)
  }
  for (const t of Object.values(doc.texts)) boxes.push(textBox(t, doc))
  const r = (c.rx + c.ry) / 2
  const padDeg = ((doc.style.bondLength * 0.45) / r) * (180 / Math.PI)
  const hits: { mid: number; span: number }[] = []
  for (const b of boxes) {
    const angles: number[] = []
    for (let a = 0; a < 360; a += 0.5) {
      const p = { x: c.cx + c.rx * Math.cos((a * Math.PI) / 180), y: c.cy + c.ry * Math.sin((a * Math.PI) / 180) }
      if (p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2) angles.push(a)
    }
    if (!angles.length || angles.length > 300) continue
    // zusammenhängenden Winkelbereich bestimmen (auch über 0°/360° hinweg)
    let start = angles[0]
    let maxGap = 0
    for (let i = 0; i < angles.length; i++) {
      const next = i === angles.length - 1 ? angles[0] + 360 : angles[i + 1]
      if (next - angles[i] > maxGap) {
        maxGap = next - angles[i]
        start = next % 360
      }
    }
    const span = 360 - maxGap + 0.5
    hits.push({ mid: (start + span / 2) % 360, span })
  }
  if (!hits.length) return toast('Kein Molekül oder Text liegt auf der Zykluslinie – Objekt auf den Kreis schieben')
  commit((d) => {
    const cc = d.cycles[cycleId]
    const used = new Set<number>()
    for (const h of hits) {
      let best = -1
      // vorhandene Station in der Nähe übernehmen (statt eine zweite Lücke anzulegen)
      let bd = h.span / 2 + Math.max(cc.gap, 25)
      cc.stations.forEach((st, i) => {
        if (used.has(i)) return
        const dd = Math.abs(((st.angle - h.mid + 540) % 360) - 180)
        if (dd < bd) {
          bd = dd
          best = i
        }
      })
      const gap = Math.min(170, Math.round(h.span + padDeg * 2))
      if (best >= 0) {
        cc.stations[best].angle = Math.round(h.mid)
        cc.stations[best].gap = gap
        cc.stations[best].gapLo = cc.stations[best].gapHi = undefined
        used.add(best)
      } else {
        cc.stations.push({ angle: Math.round(h.mid), gap })
        used.add(cc.stations.length - 1)
      }
    }
  })
  toast(`${hits.length} Lücke(n) an Moleküle/Texte angepasst`)
}

/** Verbindungspfeil von Zyklus `fromId` zu Zyklus `toId` anlegen (Start/Ende an den einander zugewandten Stellen) */
export function linkCycles(fromId: Id, toId: Id) {
  const { doc } = getState()
  const a = doc.cycles[fromId]
  const b = doc.cycles[toId]
  if (!a || !b || fromId === toId) return
  // zugewandte Punkte, leicht in Flussrichtung versetzt, damit der Pfeil nicht auf der Verbindungslinie der Mitten klebt
  const fa = eAngle(a, { x: b.cx, y: b.cy })
  const fb = eAngle(b, { x: a.cx, y: a.cy })
  const sa = a.dir === 'cw' ? 1 : -1
  const sb = b.dir === 'cw' ? 1 : -1
  commit((d) => {
    ;(d.cycles[fromId].links ??= []).push(newLink(fa - 25 * sa, toId, fb + 25 * sb))
  })
  setState({ sel: { ...emptySelection(), cycles: [fromId] } })
}

/**
 * Zyklus `id` an Zyklus `toId` andocken: so verschieben, dass sich beide Linien berühren,
 * an der Berührstelle je eine (gemeinsame) Station anlegen und die Laufrichtung gegenläufig setzen
 * (dann zeigen beide Pfeile an der Berührstelle in dieselbe Richtung).
 */
export function dockCycle(id: Id, toId: Id) {
  const { doc } = getState()
  const c = doc.cycles[id]
  const o = doc.cycles[toId]
  if (!c || !o || id === toId) return
  let ux = c.cx - o.cx
  let uy = c.cy - o.cy
  const l = Math.hypot(ux, uy)
  if (l < 1e-6) {
    ux = 1
    uy = 0
  } else {
    ux /= l
    uy /= l
  }
  const th = Math.atan2(uy, ux)
  const ro = eRadiusAt(o, th)
  const rc = eRadiusAt(c, th + Math.PI)
  const contact = { x: o.cx + ux * ro, y: o.cy + uy * ro }
  const ncx = o.cx + ux * (ro + rc)
  const ncy = o.cy + uy * (ro + rc)
  const addStation = (cc: Doc['cycles'][string], ang: number) => {
    const near = cc.stations.findIndex((s) => Math.abs(((s.angle - ang + 540) % 360) - 180) < 12)
    if (near >= 0) cc.stations[near].angle = Math.round(ang)
    else cc.stations.push({ angle: Math.round(ang) })
  }
  const flipped = c.dir === o.dir
  commit((d) => {
    const cc = d.cycles[id]
    const oo = d.cycles[toId]
    cc.cx = ncx
    cc.cy = ncy
    if (flipped) cc.dir = oo.dir === 'cw' ? 'ccw' : 'cw'
    addStation(oo, eAngle(oo, contact))
    addStation(cc, eAngle(cc, contact))
  })
  setState({ sel: { ...emptySelection(), cycles: [id, toId] } })
  toast(flipped ? 'Zyklus angedockt – Laufrichtung gegenläufig gesetzt' : 'Zyklus angedockt')
}

/**
 * Polymerklammern [ ]ₙ um die ausgewählten Atome. Sind die äußersten Atome unbeschriftete C-Enden
 * (Bindungsstummel wie in Polymerformeln), schneiden die Klammern deren Bindungen in der Mitte.
 */
export function bracketSelection(cyclic = false) {
  const { doc, sel } = getState()
  const ids = [...selectionAtomIds(doc, completeSel(doc, sel))]
  if (!ids.length) return toast('Zuerst die Wiederholungseinheit markieren')
  const L = doc.style.bondLength
  const g = buildGraph(doc)
  const set = new Set(ids)
  const nbOf = (id: Id) => g.adj.get(id) ?? []
  // Stummel = unbeschriftete C-Enden, die an einem C der Einheit hängen (OMe-Methyle hängen an O → keine Stummel)
  const isStub = (id: Id) => {
    const a = doc.atoms[id]
    const nb = nbOf(id)
    return nb.length === 1 && a.element === 'C' && !a.label && !a.charge && set.has(nb[0].other.id) && nb[0].other.element === 'C' && !nb[0].other.label
  }
  // Arbeitskoordinaten (ggf. gedreht, damit die Hauptkette waagerecht liegt)
  const P = new Map<Id, { x: number; y: number }>(ids.map((id) => [id, { x: doc.atoms[id].x, y: doc.atoms[id].y }]))
  const cands = ids.filter(isStub)
  let lStub: Id[] = []
  let rStub: Id[] = []
  let rot = 0
  if (cands.length >= 2) {
    // die beiden am weitesten auseinanderliegenden Stummel = Enden der Wiederholungseinheit
    let best: [Id, Id] = [cands[0], cands[1]]
    let bd = -1
    for (let i = 0; i < cands.length; i++)
      for (let j = i + 1; j < cands.length; j++) {
        const d = Math.hypot(P.get(cands[i])!.x - P.get(cands[j])!.x, P.get(cands[i])!.y - P.get(cands[j])!.y)
        if (d > bd) {
          bd = d
          best = [cands[i], cands[j]]
        }
      }
    let [A, B] = best
    if (P.get(A)!.x > P.get(B)!.x) [A, B] = [B, A]
    const v = { x: P.get(B)!.x - P.get(A)!.x, y: P.get(B)!.y - P.get(A)!.y }
    const ang = Math.atan2(v.y, v.x)
    if (Math.abs(Math.sin(ang)) > 0.15) {
      // schräg → Einheit waagerecht drehen
      rot = -ang
      const c = { x: [...P.values()].reduce((s2, p) => s2 + p.x, 0) / P.size, y: [...P.values()].reduce((s2, p) => s2 + p.y, 0) / P.size }
      const co = Math.cos(rot)
      const si = Math.sin(rot)
      for (const [id, p] of P) P.set(id, { x: c.x + (p.x - c.x) * co - (p.y - c.y) * si, y: c.y + (p.x - c.x) * si + (p.y - c.y) * co })
      if (P.get(A)!.x > P.get(B)!.x) [A, B] = [B, A]
    }
    lStub = [A]
    rStub = [B]
  } else {
    const xs = ids.map((id) => P.get(id)!.x)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    lStub = ids.filter((id) => isStub(id) && P.get(id)!.x < minX + L * 0.3)
    rStub = ids.filter((id) => isStub(id) && P.get(id)!.x > maxX - L * 0.3)
  }
  const nbP = (id: Id) => P.get(nbOf(id)[0].other.id)!
  const core = ids.filter((id) => !lStub.includes(id) && !rStub.includes(id))
  const cx = core.map((id) => P.get(id)!.x)
  const cy = core.map((id) => P.get(id)!.y)
  const pad = L * 0.35
  const box = { x1: Math.min(...cx) - pad, y1: Math.min(...cy) - pad, x2: Math.max(...cx) + pad, y2: Math.max(...cy) + pad }
  const midX = (list: Id[]) => list.reduce((s2, id) => s2 + (P.get(id)!.x + nbP(id).x) / 2, 0) / list.length
  // Klammer schneidet nur die Stummel-Bindung: möglichst außerhalb aller übrigen Atome der Einheit,
  // aber noch zwischen Stummel und seinem Nachbarn
  const coreMinX = Math.min(...cx)
  const coreMaxX = Math.max(...cx)
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)))
  const x1 = lStub.length
    ? clamp(Math.min(midX(lStub), coreMinX - L * 0.25), Math.max(...lStub.map((id) => P.get(id)!.x)) + L * 0.1, Math.min(...lStub.map((id) => nbP(id).x)) - L * 0.1)
    : box.x1 - L * 0.3
  const x2 = rStub.length
    ? clamp(Math.max(midX(rStub), coreMaxX + L * 0.25), Math.max(...rStub.map((id) => nbP(id).x)) + L * 0.1, Math.min(...rStub.map((id) => P.get(id)!.x)) - L * 0.1)
    : box.x2 + L * 0.3
  // die Klammern müssen die Stummel-Bindungen auch senkrecht überdecken
  const mids = [...lStub, ...rStub].map((id) => (P.get(id)!.y + nbP(id).y) / 2)
  let y1 = Math.min(box.y1, ...mids) - L * 0.2
  let y2 = Math.max(box.y2, ...mids) + L * 0.2
  // Würde eine Klammer über die volle Höhe eine andere Bindung der Einheit schneiden (Seitengruppe ragt hinaus),
  // nur die Hauptkette einklammern (kurze Klammern wie bei Polymerformeln üblich)
  const stubBonds = new Set([...lStub, ...rStub].map((sid) => nbOf(sid)[0].bond.id))
  const crosses = (x: number, ya: number, yb: number) =>
    Object.values(doc.bonds).some((bd) => {
      if (stubBonds.has(bd.id) || !set.has(bd.a1) || !set.has(bd.a2)) return false
      const p1 = P.get(bd.a1)!
      const p2 = P.get(bd.a2)!
      if ((p1.x - x) * (p2.x - x) > 0 || Math.abs(p1.x - p2.x) < 1e-9) return false
      const yy = p1.y + ((p2.y - p1.y) * (x - p1.x)) / (p2.x - p1.x)
      return yy >= ya && yy <= yb
    })
  if (mids.length && (crosses(x1, y1, y2) || crosses(x2, y1, y2))) {
    y1 = Math.min(...mids) - L * 0.75
    y2 = Math.max(...mids) + L * 0.75
  }
  const id = uid('s')
  commit((d) => {
    if (rot) for (const [aid, p] of P) Object.assign(d.atoms[aid], p)
    d.shapes[id] = { id, kind: 'brackets', x1, y1, x2, y2, sub: 'n', cyclic: cyclic || undefined }
  })
  setState({ sel: { ...emptySelection(), shapes: [id] } })
  if (rot) toast('Wiederholungseinheit waagerecht ausgerichtet')
}

/** Markierte Objekte als Vorlage (um den Ursprung zentriert) */
export function selectionAsTemplateClip(): ClipData | null {
  const { doc, sel } = getState()
  const full = completeSel(doc, sel)
  if (!selectionSize(full)) return null
  const scene = getScene(doc)
  const box = sceneBBox(scene, {
    atoms: selectionAtomIds(doc, full),
    bonds: new Set(full.bonds),
    arrows: new Set(full.arrows),
    curved: new Set(full.curved),
    texts: new Set(full.texts),
    shapes: new Set(full.shapes),
    cycles: new Set(full.cycles ?? []),
  })
  if (!box) return null
  const c = mid({ x: box.x1, y: box.y1 }, { x: box.x2, y: box.y2 })
  const tmp: Doc = { ...emptyDocLike(doc) }
  const s2 = pasteClip(tmp, extractClip(doc, full), -c.x, -c.y)
  return extractClip(tmp, s2)
}

function emptyDocLike(doc: Doc): Doc {
  return { atoms: {}, bonds: {}, arrows: {}, curved: {}, texts: {}, shapes: {}, fills: {}, cycles: {}, tables: {}, style: { ...doc.style } }
}

/** Eigene Vorlage an Punkt p einfügen */
export function insertUserTemplateAt(clip: ClipData, p: { x: number; y: number }) {
  let s: Selection = emptySelection()
  commit((d) => {
    s = pasteClip(d, clip, p.x, p.y)
  })
  setState({ sel: s })
}

/**
 * Markierte Struktur in PubChem bzw. der englischen Wikipedia öffnen. Das Fenster wird sofort (im Klick)
 * geöffnet, damit kein Popup-Blocker greift, und nach der Suche umgeleitet bzw. wieder geschlossen.
 */
export async function lookupSelection(where: 'pubchem' | 'wikipedia') {
  const { doc, sel } = getState()
  const ids = [...selectionAtomIds(doc, completeSel(doc, sel))]
  if (!ids.length) return toast('Zuerst eine Struktur markieren')
  if (fragments(doc, buildGraph(doc), ids).length > 1) return toast('Bitte nur ein Molekül markieren (Doppelklick markiert ein ganzes Molekül)')
  const { generic } = docToOCL(doc, ids)
  if (generic > 0) return toast('Struktur enthält Platzhalter (R, X …) – nicht nachschlagbar')
  const smiles = toSmiles(doc, ids)
  const w = window.open('about:blank', '_blank')
  const name = where === 'pubchem' ? 'PubChem' : 'Wikipedia'
  toast(`Suche in ${name} …`)
  try {
    let url: string | null = null
    if (where === 'pubchem') {
      const pc = await pubchemLookup(smiles)
      url = pc ? `https://pubchem.ncbi.nlm.nih.gov/compound/${pc.cid}` : null
    } else url = (await wikipediaLookup(smiles))?.url ?? null
    if (!url) {
      w?.close()
      toast(where === 'pubchem' ? 'Kein PubChem-Eintrag zu dieser Struktur gefunden' : 'Kein englischer Wikipedia-Artikel zu dieser Struktur gefunden', 'error')
      return
    }
    if (w) w.location.href = url
    else window.open(url, '_blank', 'noopener')
  } catch (e) {
    w?.close()
    toast(e instanceof Error ? e.message : `${name} nicht erreichbar`, 'error')
  }
}

/** Auswahl in den Vordergrund/Hintergrund bzw. eine Ebene nach vorn/hinten */
export function arrange(mode: OrderMode) {
  const { doc, sel } = getState()
  const scene = getScene(doc)
  const keys = reorderKeys(scene, completeSel(doc, sel), mode)
  if (!keys) {
    if (selectionSize(sel) === 0) toast('Erst Objekte auswählen, die nach vorn oder hinten sollen')
    else toast(mode === 'front' || mode === 'forward' ? 'Liegt bereits ganz vorn' : 'Liegt bereits ganz hinten')
    return
  }
  commit((d) => applyOrder(d, scene, keys))
}

/** Ausgewählte Objekte fett bzw. wieder normal (alle Objektarten; Atome inkl. Ladungen, Elektronenpaaren …) */
export function toggleBold(): boolean {
  const { doc, sel } = getState()
  const items: ({ bold?: boolean } | undefined)[] = [
    ...sel.atoms.map((id) => doc.atoms[id]),
    ...sel.texts.map((id) => doc.texts[id]),
    ...sel.arrows.map((id) => doc.arrows[id]),
    ...sel.curved.map((id) => doc.curved[id]),
    ...sel.shapes.map((id) => doc.shapes[id]),
    ...(sel.cycles ?? []).map((id) => doc.cycles[id]),
  ]
  const list = items.filter(Boolean) as { bold?: boolean }[]
  if (!list.length) return false
  const on = !list.every((x) => x.bold)
  commit((d) => {
    const set = (o: { bold?: boolean } | undefined) => {
      if (o) o.bold = on || undefined
    }
    // ganzes Molekül (Atome samt Bindungen ausgewählt): Bindungen gleich mit fett, wie ein fetter Buchstabe
    const withBonds = sel.bonds.length > 0
    for (const id of sel.atoms) {
      set(d.atoms[id])
      if (d.atoms[id]) d.atoms[id].boldBonds = on && withBonds ? true : undefined
    }
    for (const id of sel.texts) set(d.texts[id])
    for (const id of sel.arrows) set(d.arrows[id])
    for (const id of sel.curved) set(d.curved[id])
    for (const id of sel.shapes) set(d.shapes[id])
    for (const id of sel.cycles ?? []) set(d.cycles[id])
  })
  return true
}

/** Sind alle ausgewählten Objekte fett? */
export function selectionBold(): boolean {
  const { doc, sel } = getState()
  const items = [
    ...sel.atoms.map((id) => doc.atoms[id]),
    ...sel.texts.map((id) => doc.texts[id]),
    ...sel.arrows.map((id) => doc.arrows[id]),
    ...sel.curved.map((id) => doc.curved[id]),
    ...sel.shapes.map((id) => doc.shapes[id]),
    ...(sel.cycles ?? []).map((id) => doc.cycles[id]),
  ].filter(Boolean) as { bold?: boolean }[]
  return items.length > 0 && items.every((x) => x.bold)
}

/** Kürzel bilden: OMe, OTf, Bpin, CO2Me … aus ausgeschriebenen Atomen zu Beschriftungen zusammenfassen (Auswahl oder alles) */
export function contractGroups() {
  const { doc, sel } = getState()
  const ids = selectionSize(sel) ? [...selectionAtomIds(doc, completeSel(doc, sel))] : Object.keys(doc.atoms)
  const groups = findContractibleGroups(doc, ids)
  if (!groups.length) return toast('Keine Gruppen gefunden, die sich als Kürzel schreiben lassen (z. B. OMe, OTf, Bpin)')
  commit((d) => {
    deleteItems(d, { ...emptySelection(), atoms: groups.flatMap((g) => g.remove) })
    for (const g of groups) {
      const a = d.atoms[g.anchor]
      if (!a) continue
      a.element = 'C'
      a.label = g.key
      a.literal = undefined
      a.showC = undefined
      a.charge = 0
      a.radical = 0
      a.lonePairs = 0
    }
  })
  setState({ sel: pruneSel(getState().sel, getState().doc) })
  const count = new Map<string, number>()
  for (const g of groups) count.set(g.key, (count.get(g.key) ?? 0) + 1)
  toast('Kürzel gebildet: ' + [...count].map(([k, n]) => (n > 1 ? n + '× ' : '') + k).join(', '))
}

// ---------- Kürzel auflösen (Gegenstück zu „Kürzel bilden“) ----------

/**
 * Kürzel (OMe, CF3, tBu, CO2Me, Bpin …) an ausgewählten Atomen – ohne Auswahl im ganzen Dokument – wieder als
 * gezeichnete Atome ausschreiben. Die Gruppe zeigt von ihrem Nachbarn weg; von zwei Spiegellagen wird die gewählt,
 * die dem übrigen Molekül weniger nahe kommt. Platzhalter (R, X, Ar …) bleiben stehen.
 */
export function expandGroups() {
  const { doc, sel } = getState()
  const ids = selectionSize(sel) ? [...selectionAtomIds(doc, completeSel(doc, sel))] : Object.keys(doc.atoms)
  const g = buildGraph(doc)
  const L = doc.style.bondLength
  type Plan = { anchor: Id; frag: Fragment; map: Map<number, Id | null> }
  const plans: Plan[] = []
  for (const id of ids) {
    const a = doc.atoms[id]
    if (!a?.label) continue
    const key = canonicalAbbrev(chemLabel(a.label))
    const ab = key ? ABBREVIATIONS[key] : null
    if (!ab || ab.generic) continue
    const nbs = (g.adj.get(id) ?? []).map((n) => n.other)
    if (nbs.length > 1) continue
    let mol: OCL.Molecule
    try {
      mol = OCL.Molecule.fromSmiles(ab.smiles)
    } catch {
      continue
    }
    // Platzhalter am ersten Atom = Anknüpfung (der Nachbar im Dokument)
    const dummy = mol.addAtom(0)
    mol.addBond(dummy, 0)
    mol.inventCoordinates()
    const frag = oclToFragment(mol, L)
    const d0 = frag.atoms[dummy]
    const a0 = frag.atoms[0]
    // Ausrichtung: Platzhalter → erstes Atom soll auf Nachbar → Kürzel-Atom liegen
    const from = nbs.length ? { x: nbs[0].x, y: nbs[0].y } : { x: a.x - L, y: a.y }
    const want = Math.atan2(a.y - from.y, a.x - from.x)
    const have = Math.atan2(a0.y - d0.y, a0.x - d0.x)
    const best = [1, -1]
      .map((mirror) => {
        const t = want - have * mirror
        const pts = frag.atoms.map((fa) => {
          const dx = fa.x - a0.x
          const dy = (fa.y - a0.y) * mirror
          return { x: a.x + dx * Math.cos(t) - dy * Math.sin(t), y: a.y + dx * Math.sin(t) + dy * Math.cos(t) }
        })
        // Nähe zum übrigen Dokument (kleiner = besser)
        let crowd = 0
        for (let i = 1; i < pts.length; i++) {
          if (i === dummy) continue
          for (const o of Object.values(doc.atoms)) {
            if (o.id === id) continue
            const dd = Math.hypot(o.x - pts[i].x, o.y - pts[i].y)
            if (dd < L * 1.2) crowd += L * 1.2 - dd
          }
        }
        return { pts, crowd, mirror }
      })
      .sort((p, q) => p.crowd - q.crowd)[0]
    frag.atoms.forEach((fa, i) => {
      fa.x = best.pts[i].x
      fa.y = best.pts[i].y
    })
    const map = new Map<number, Id | null>()
    map.set(0, id)
    map.set(dummy, null)
    plans.push({ anchor: id, frag, map })
  }
  if (!plans.length) return toast('Keine Kürzel zum Auflösen gefunden (z. B. OMe, CF3, tBu, CO2Me, Bpin)')
  commit((d) => {
    for (const pl of plans) {
      const a = d.atoms[pl.anchor]
      if (!a) continue
      const f0 = pl.frag.atoms[0]
      a.label = undefined
      a.literal = undefined
      a.element = f0.element
      a.charge = f0.charge
      // übrige Atome anlegen
      const idOf = (i: number) => pl.map.get(i)
      pl.frag.atoms.forEach((fa, i) => {
        if (pl.map.has(i)) return
        const nid = uid('a')
        d.atoms[nid] = { ...fa, id: nid }
        pl.map.set(i, nid)
      })
      const index = new Map(pl.frag.atoms.map((fa, i) => [fa.id, i]))
      for (const fb of pl.frag.bonds) {
        const i1 = index.get(fb.a1)!
        const i2 = index.get(fb.a2)!
        const id1 = idOf(i1)
        const id2 = idOf(i2)
        if (!id1 || !id2) continue // Bindung zum Platzhalter = vorhandene Bindung
        const bid = uid('b')
        d.bonds[bid] = { ...fb, id: bid, a1: id1, a2: id2 }
      }
    }
  })
  toast(`${plans.length} Kürzel aufgelöst`)
}

// ---------- Analyse als Text unter das Molekül ----------

export type AnalysisKind = 'name' | 'formula' | 'exact' | 'mw' | 'isotopes'

/** Ausgewählte Moleküle (Atom-IDs je Molekül) */
/** Auswahl auf die ganzen Moleküle erweitern, zu denen markierte Atome/Bindungen gehören (übrige Objekte bleiben) */
export function selectWholeMolecules() {
  const { doc, sel } = getState()
  const touched = new Set(selectionAtomIds(doc, completeSel(doc, sel)))
  if (!touched.size) return
  const atoms = fragments(doc, buildGraph(doc), Object.keys(doc.atoms))
    .filter((f) => f.some((id) => touched.has(id)))
    .flat()
  setState({ sel: completeSel(doc, { ...sel, atoms: [...new Set([...sel.atoms, ...atoms])] }) })
}

function selectedMolecules(): Id[][] {
  const { doc, sel } = getState()
  const ids = [...selectionAtomIds(doc, completeSel(doc, sel))]
  return fragments(doc, buildGraph(doc), ids).filter((f) => f.length > 0)
}

/** Text zentriert unter ein Molekül setzen – unter bereits dort stehende Texte (mehrere Analysewerte stapeln sich) */
function placeUnder(d: Doc, atomIds: Id[], html: string) {
  const scene = getScene(d)
  const b = sceneBBox(scene, { atoms: new Set(atomIds) })
  if (!b) return
  const size = Math.round(d.style.fontSize * 0.8)
  const cx = (b.x1 + b.x2) / 2
  let y = b.y2 + size * 1.1
  for (const t of Object.values(d.texts)) {
    const tb = textBox(t, d)
    if (tb.x2 < b.x1 || tb.x1 > b.x2 || tb.y1 > y + size || tb.y2 < b.y2) continue
    y = Math.max(y, tb.y2 + size * 0.75)
  }
  const id = uid('t')
  d.texts[id] = { id, x: cx, y, text: html, size, align: 'center' }
}

/** Name, Summenformel, exakte Masse bzw. Molekulargewicht der ausgewählten Moleküle als Text darunter */
export async function insertAnalysis(kinds: AnalysisKind[]) {
  const mols = selectedMolecules()
  if (!mols.length) return toast('Erst ein Molekül auswählen')
  const { doc } = getState()
  // Beschriftung in der Sprache der Oberfläche (der Text gehört danach zur Zeichnung)
  const en = getSettings().uiLang === 'en'
  const lab = { formula: en ? 'Formula: ' : 'Summenformel: ', exact: en ? 'Exact mass: ' : 'Exakte Masse: ', mw: en ? 'Molecular weight: ' : 'Molekulargewicht: ', iso: en ? 'Isotope pattern: ' : 'Isotopenmuster: ' }
  const lines: { atoms: Id[]; html: string }[] = []
  for (const f of mols) {
    const an = analyze(doc, f)
    if (!an) continue
    for (const k of kinds) {
      if (k === 'formula') lines.push({ atoms: f, html: lab.formula + formulaHtml(an.formula) + (an.charge ? `<sup>${Math.abs(an.charge) > 1 ? Math.abs(an.charge) : ''}${an.charge > 0 ? '+' : '−'}</sup>` : '') })
      else if (k === 'exact') lines.push({ atoms: f, html: lab.exact + (an.generic ? '–' : fmtDec(an.exact, 4)) })
      else if (k === 'mw') lines.push({ atoms: f, html: lab.mw + (an.generic ? '–' : fmtDec(an.mw, 2) + ' g/mol') })
      else if (k === 'isotopes') {
        // Peaks ab 1 % des stärksten, Masse auf 4 Stellen
        const peaks = an.generic ? null : isotopePattern(an.natural, an.labeled, 1)
        lines.push({ atoms: f, html: lab.iso + (peaks ? peaks.map((p) => `${fmtDec(p.mass, 4)} (${fmtDec(p.rel, p.rel >= 99.95 ? 0 : 1)} %)`).join(', ') : '–') })
      }
      else if (k === 'name') {
        if (an.generic) {
          toast('Strukturen mit Platzhaltern (R, X …) haben keinen eindeutigen Namen', 'error')
          continue
        }
        toast('Name wird in PubChem gesucht …')
        try {
          const r = await smilesToName(toSmiles(doc, f))
          const name = r.iupac || r.title
          if (name) lines.push({ atoms: f, html: name.replace(/&/g, '&amp;').replace(/</g, '&lt;') })
        } catch (e) {
          toast((e instanceof Error ? e.message : String(e)) + ' (Name nur für bekannte Verbindungen)', 'error')
        }
      }
    }
  }
  if (!lines.length) return
  commit((d) => {
    for (const l of lines) placeUnder(d, l.atoms, l.html)
  })
}

// ---------- Textmarker ----------

/** Textmarker-Farbe für die Auswahl setzen (Atome, Bindungen dazwischen, Texte); undefined entfernt sie */
export function setHighlight(color: string | undefined) {
  const { doc, sel } = getState()
  if (!selectionSize(sel)) return toast('Erst Atome, Bindungen oder Texte auswählen')
  const s = completeSel(doc, sel)
  commit((d) => {
    for (const id of s.atoms) if (d.atoms[id]) d.atoms[id].highlight = color
    for (const id of s.bonds) if (d.bonds[id]) d.bonds[id].highlight = color
    for (const id of s.texts) if (d.texts[id]) d.texts[id].highlight = color
  })
}

/**
 * Farbverlauf für die Auswahl (Linien/Beschriftungen bzw. Textmarker): verwenden alle markierten Objekte schon
 * denselben Verlauf, wird er geändert, sonst entsteht ein neuer, der sich über die ganze Auswahl spannt.
 * g = null: Verlauf entfernen (zurück zur ersten Farbe).
 */
export function setGradient(field: 'color' | 'highlight', g: Omit<Gradient, 'id'> | null) {
  const { doc, sel } = getState()
  if (!selectionSize(sel)) return toast('Erst Objekte auswählen')
  const s = completeSel(doc, sel)
  const kinds = field === 'highlight' ? (['atoms', 'bonds', 'texts'] as const) : (['atoms', 'bonds', 'arrows', 'curved', 'texts', 'shapes', 'cycles'] as const)
  const objs = kinds.flatMap((k) => (s[k] ?? []).map((id) => (doc[k] as Record<Id, { color?: string; highlight?: string }>)[id]).filter(Boolean))
  const cur = objs.map((o) => o[field])
  const shared = cur.length && cur.every((c) => c === cur[0]) && isGrad(cur[0]) ? gradId(cur[0]!) : null
  commit((d) => {
    const gid = shared ?? uid('gr')
    if (g) d.gradients = { ...(d.gradients ?? {}), [gid]: { id: gid, ...g } }
    const value = g ? GRAD_PREFIX + gid : shared ? d.gradients?.[shared]?.c1 : undefined
    for (const k of kinds)
      for (const id of s[k] ?? []) {
        const o = (d[k] as Record<Id, { color?: string; highlight?: string }>)[id]
        if (o && (g || isGrad(o[field]))) o[field] = value
      }
  })
}

/** Farben des Textmarkers (wie bei Leuchtstiften) */
export const HIGHLIGHT_COLORS: { name: string; c: string }[] = [
  { name: 'Gelb', c: '#ffe94a' },
  { name: 'Grün', c: '#7be36a' },
  { name: 'Türkis', c: '#4fdcf0' },
  { name: 'Orange', c: '#ffad5c' },
  { name: 'Rot', c: '#ff7a73' },
  { name: 'Pink', c: '#f29bea' },
]

// ---------- Ansatztabelle ----------

/**
 * Ansatztabelle aus der gezeichneten Reaktion (Auswahl oder ganzes Dokument): Moleküle vor dem Pfeil = Edukte,
 * danach = Produkte, neben dem Pfeil = Reagenzien; Pfeiltexte liefern Reagenzien, Lösungsmittel und Bedingungen.
 */
export function createStoichTable() {
  const { doc, sel } = getState()
  const scene = getScene(doc)
  const s = selectionSize(sel) ? completeSel(doc, sel) : null
  const arrowIds = (s ? s.arrows : Object.keys(doc.arrows)).filter((id) => doc.arrows[id] && doc.arrows[id].kind !== 'resonance' && doc.arrows[id].kind !== 'retro')
  let atomIds = s ? [...selectionAtomIds(doc, s)] : Object.keys(doc.atoms)
  // nur ein Pfeil markiert (z. B. per Rechtsklick): die Moleküle dieser Reaktion – auf Höhe des Pfeils – gehören dazu
  if (s && !atomIds.length && arrowIds.length) {
    const ar0 = doc.arrows[arrowIds[0]]
    const len0 = Math.hypot(ar0.x2 - ar0.x1, ar0.y2 - ar0.y1) || 1
    const n0 = { x: -(ar0.y2 - ar0.y1) / len0, y: (ar0.x2 - ar0.x1) / len0 }
    const L0 = doc.style.bondLength
    atomIds = fragments(doc, scene.g, Object.keys(doc.atoms))
      .filter((f) => {
        const c = f.reduce((acc, id) => ({ x: acc.x + doc.atoms[id].x / f.length, y: acc.y + doc.atoms[id].y / f.length }), { x: 0, y: 0 })
        return Math.abs((c.x - ar0.x1) * n0.x + (c.y - ar0.y1) * n0.y) < L0 * 4
      })
      .flat()
  }
  const frs = fragments(doc, scene.g, atomIds).filter((f) => f.length > 0)
  if (!frs.length && !arrowIds.length) return toast('Erst eine Reaktion zeichnen oder markieren (Moleküle und Pfeil)')
  // Pfeil: der längste (bei mehreren Stufen gilt der erste in Leserichtung)
  const ar = arrowIds
    .map((id) => doc.arrows[id])
    .sort((a, b) => Math.min(a.y1, a.y2) - Math.min(b.y1, b.y2) || Math.min(a.x1, a.x2) - Math.min(b.x1, b.x2))[0]
  const items = frs.map((f) => {
    const set = new Set(f)
    const b = sceneBBox(scene, { atoms: set, bonds: new Set(Object.values(doc.bonds).filter((x) => set.has(x.a1)).map((x) => x.id)) })!
    return { atom: f[0], box: b, c: { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 } }
  })
  const rows: StoichRow[] = []
  let temperature: string | undefined
  let time: string | undefined
  let atmosphere: string | undefined
  if (ar) {
    const d = { x: ar.x2 - ar.x1, y: ar.y2 - ar.y1 }
    const len = Math.hypot(d.x, d.y) || 1
    const u = { x: d.x / len, y: d.y / len }
    const classified = items.map((it) => ({ ...it, t: (it.c.x - ar.x1) * u.x + (it.c.y - ar.y1) * u.y }))
    classified.sort((a, b) => a.t - b.t)
    for (const it of classified) {
      const role = it.t < 0 ? 'reactant' : it.t > len ? 'product' : 'reagent'
      rows.push(newRow(role, { atom: it.atom }))
    }
    const cond = parseConditionText([ar.above, ar.below].map((x) => richPlain(x ?? '')).join('\n'))
    temperature = cond.temperature
    time = cond.time
    atmosphere = cond.atmosphere
    // Reagenzien aus dem Pfeiltext hinter die gezeichneten, Lösungsmittel danach
    rows.push(...cond.rows.filter((r) => r.role !== 'solvent'), ...cond.rows.filter((r) => r.role === 'solvent'))
  } else for (const it of items.sort((a, b) => a.c.x - b.c.x)) rows.push(newRow('reactant', { atom: it.atom }))
  // Reihenfolge: Edukte, Reagenzien, Lösungsmittel, Produkte
  const rank = { reactant: 0, reagent: 1, catalyst: 1, solvent: 2, product: 3 }
  rows.sort((a, b) => rank[a.role] - rank[b.role])
  const ref = rows.find((r) => r.role === 'reactant')
  if (ref) {
    ref.ref = true
    ref.driver = 'mass'
  }
  // unter die Reaktion setzen
  const rb = sceneBBox(scene, {
    atoms: new Set(atomIds),
    bonds: new Set(Object.values(doc.bonds).filter((b) => atomIds.includes(b.a1)).map((b) => b.id)),
    arrows: new Set(arrowIds),
  })
  const L = doc.style.bondLength
  const id = uid('st')
  commit((dd) => {
    dd.tables[id] = { id, x: rb ? rb.x1 : 0, y: rb ? rb.y2 + L * 1.2 : 0, lang: getSettings().uiLang, rows, temperature, time, atmosphere }
    // mit dem Pfeil verknüpfen: Bedingungen und Lösungsmittel bleiben in beiden gleich
    if (ar) linkTable(dd, id, ar.id)
  })
  setState({ sel: { ...emptySelection(), tables: [id] }, tableEditor: id })
  toast(ref ? 'Ansatztabelle angelegt – Menge des Bezugsedukts eingeben' : 'Ansatztabelle angelegt')
  // CAS-Nummern und GHS-Symbole gleich im Hintergrund nachschlagen
  void import('./safety').then((m) => m.fillSafety(id, { quiet: true, auto: true }))
}

// ---------- Seitenlayout ----------

/** Seitenformat wählen (null = unbegrenzte Zeichenfläche); die Seiten legen sich um die Zeichnung */
export function setPageFormat(format: string | null, landscape?: boolean) {
  const { doc } = getState()
  if (!format) {
    commit((d) => {
      delete d.style.page
    })
    return
  }
  const f = PAGE_FORMATS.find((x) => x.id === format)
  const lay = fitLayout(doc, format, landscape ?? !!f?.landscape, viewCenter())
  commit((d) => {
    d.style.page = lay
  })
  fitSheet()
}

/** weitere Seite an einem Rand anbauen (große „+“-Knöpfe) */
export function addPage(side: 'top' | 'bottom' | 'left' | 'right') {
  commit((d) => {
    if (d.style.page) d.style.page = addPageAt(d.style.page, side)
  })
}

/** leere Seiten am Rand entfernen */
export function trimPages() {
  const { doc } = getState()
  if (!doc.style.page) return
  const t = trimLayout(doc, doc.style.page)
  commit((d) => {
    d.style.page = t
  })
}

/** Ansicht auf alle Seiten einpassen */
export function fitSheet() {
  const { doc } = getState()
  const el = document.querySelector('.canvas-wrap') as HTMLElement | null
  if (!el || !doc.style.page) return
  const b = sheetBox(doc.style.page)
  const w = el.clientWidth
  const h = el.clientHeight
  const z = Math.min(3, Math.max(0.02, Math.min((w - 160) / (b.x2 - b.x1), (h - 160) / (b.y2 - b.y1))))
  const c = mid({ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 })
  setState({ view: { zoom: z, panX: w / 2 - c.x * z, panY: h / 2 - c.y * z } })
}
