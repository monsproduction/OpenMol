// "Reaktion aufräumen": ordnet Reaktionsschemata sauber an – Edukte, Plus-Zeichen, Pfeile und Produkte
// zeilenweise auf einer gemeinsamen Mittellinie, einheitliche Abstände und Pfeillängen, Verbindungsnamen
// unter den Molekülen.
//
// Unterstützt:
// - Kaskaden in einer Zeile (A + B → C → D), auch von rechts nach links (←)
// - mehrzeilige Schemata: Die Zeilenumbrüche kommen aus der groben Anordnung des Nutzers. Zeilen werden
//   über senkrechte Pfeile (auch grob schräg gezeichnete zwischen zwei Zeilen) oder Winkelpfeile verbunden;
//   die verbundenen Moleküle werden dabei exakt untereinander ausgerichtet (Schlangenlinie wie in S9).
// - senkrechte Reaktionen (Edukte oben, Produkt unten): Pfeil senkrecht mittig zwischen den Zeilen,
//   Bedingungen daneben
// - Reagenz-Moleküle über/unter bzw. neben einem Pfeil, freie Texte an Pfeilen und Fußnoten wandern mit
// - Verzweigungen (Winkelpfeile, die von einem Hauptpfeil abgehen) wie bisher
import { fragments } from '../model/chem'
import type { Box, Pt } from '../model/geom'
import { translateSelection, selectionAtomIds } from '../model/ops'
import { richPlain } from '../model/richtext'
import { arrowLabelSegment, arrowPoints, arrowTextBlock, arrowTextBlocks, arrowTextOpts, getScene, sceneBBox, textBox } from '../model/scene'
import type { Doc, Id, Selection } from '../model/types'
import { emptySelection, selectionSize, uid } from '../model/types'
import { commit, getState, toast } from '../store'
import { completeSel, ensureVisible } from './actions'

interface MolItem {
  kind: 'mol'
  idx: number
  sel: Selection
  box: Box
  captions: Id[]
  /** als Reagenz einem Pfeil zugeordnet */
  reagentOf?: Id
}
interface PlusItem {
  kind: 'plus'
  id: Id
  box: Box
}
interface ArrowItem {
  kind: 'arrow'
  id: Id
  box: Box
  textW: number
}
type RowItem = MolItem | PlusItem | ArrowItem

interface Row {
  items: RowItem[]
  /** ursprüngliche Ausdehnung */
  y1: number
  y2: number
  x1: number
}

/** Senkrechter (oder schräg gezeichneter) Pfeil zwischen zwei Zeilen bzw. Winkelpfeil zwischen Zeilen */
interface Connector {
  id: Id
  type: 'vertical' | 'elbow'
  from: number // Zeile
  to: number
  /** einzelnes Quell-/Zielmolekül oder null = ganze Zeile */
  srcMol: MolItem | null
  dstMol: MolItem | null
  down: boolean
  /** Winkelpfeil: Seite, an der er das Quellmolekül verlässt (+1 rechts, −1 links) und ursprünglicher Abstand */
  side: number
  offset: number
}

const cyB = (b: Box) => (b.y1 + b.y2) / 2
const cxB = (b: Box) => (b.x1 + b.x2) / 2
const boxDist = (b: Box, p: Pt) => Math.hypot(Math.max(b.x1 - p.x, 0, p.x - b.x2), Math.max(b.y1 - p.y, 0, p.y - b.y2))
const union = (a: Box | null, b: Box | null): Box | null =>
  !a ? b : !b ? a : { x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) }

export function cleanReaction() {
  const { doc, sel } = getState()
  const scene = getScene(doc)
  const L = doc.style.bondLength
  const fs = doc.style.fontSize
  const scoped = selectionSize(sel) > 0
  const s = scoped ? completeSel(doc, sel) : null
  const atomIds = s ? [...selectionAtomIds(doc, s)] : Object.keys(doc.atoms)
  const textIds = s ? s.texts : Object.keys(doc.texts)
  const arrowIds = s ? s.arrows : Object.keys(doc.arrows)
  const gapMol = L * 0.9
  const gapPlus = L * 0.55
  const gapV = L * 0.55
  const minArrow = L * 3
  const minVArrow = L * 2.2

  // ---------- Moleküle (mit Mechanismuspfeilen und umschließenden Klammern) ----------
  const mols: MolItem[] = []
  for (const f of fragments(doc, scene.g, atomIds)) {
    const fsel = completeSel(doc, { ...emptySelection(), atoms: f })
    const set = new Set(f)
    for (const id in doc.curved) {
      const c = doc.curved[id]
      const ok = (a: typeof c.from) => a.type === 'point' || (a.type === 'bond' ? set.has(doc.bonds[a.id]?.a1) : set.has(a.id))
      if (ok(c.from) && ok(c.to) && (c.from.type !== 'point' || c.to.type !== 'point')) fsel.curved.push(id)
    }
    const box = sceneBBox(scene, { atoms: set, bonds: new Set(fsel.bonds) })
    if (!box) continue
    for (const id in doc.shapes) {
      const sh = doc.shapes[id]
      const sb = { x1: Math.min(sh.x1, sh.x2), y1: Math.min(sh.y1, sh.y2), x2: Math.max(sh.x1, sh.x2), y2: Math.max(sh.y1, sh.y2) }
      const ix = Math.max(0, Math.min(sb.x2, box.x2) - Math.max(sb.x1, box.x1))
      const iy = Math.max(0, Math.min(sb.y2, box.y2) - Math.max(sb.y1, box.y1))
      if (ix * iy > 0.25 * (box.x2 - box.x1) * (box.y2 - box.y1)) fsel.shapes.push(id)
    }
    // Box inkl. Klammern (Polymer-Index usw.)
    const full = fsel.shapes.length ? union(box, sceneBBox(scene, { shapes: new Set(fsel.shapes) })) ?? box : box
    mols.push({ kind: 'mol', idx: mols.length, sel: fsel, box: full, captions: [] })
  }

  // ---------- Texte: Plus-Zeichen, Bildunterschriften, freie Texte ----------
  const pluses: PlusItem[] = []
  const freeTexts: Id[] = []
  for (const id of textIds) {
    const t = doc.texts[id]
    const plain = richPlain(t.text).trim()
    const b = textBox(t, doc)
    if (plain === '+') {
      pluses.push({ kind: 'plus', id, box: b })
      continue
    }
    const cx = cxB(b)
    let best: MolItem | null = null
    let bd = Infinity
    // Verbindungsnamen sind kurz (z. B. „2FDPPZ“, „3a“); längere/mehrzeilige Texte sind Fußnoten o. ä.
    const lines = plain.split('\n')
    const captionLike = lines.length <= 2 && lines.every((l) => l.length <= 30)
    for (const m of captionLike ? mols : []) {
      const gap = b.y1 - m.box.y2
      const overlaps = cx > m.box.x1 - L && cx < m.box.x2 + L
      if (overlaps && gap > -fs * 0.5 && gap < L * 2.2 && gap < bd) {
        bd = gap
        best = m
      }
    }
    if (best) best.captions.push(id)
    else freeTexts.push(id)
  }

  const arrows = arrowIds.map((id) => doc.arrows[id]).filter(Boolean)
  if (mols.length + pluses.length + arrows.length < 2) {
    toast('Zum Aufräumen werden mindestens zwei Objekte (z. B. Molekül und Pfeil) benötigt')
    return
  }

  // ---------- Reagenz-Moleküle an Pfeilen (über/unter einem waagerechten bzw. neben einem senkrechten Teilstück) ----------
  const reagentSide = new Map<Id, number>() // Molekül-Index → −1 über/links, +1 unter/rechts
  const reagentsOf = new Map<Id, MolItem[]>()
  for (const a of arrows) {
    const pts = arrowPoints(a)
    for (const m of mols) {
      if (m.reagentOf) continue
      const b = m.box
      // Moleküle an Anfang oder Spitze des Pfeils sind Edukt/Produkt, kein Reagenz – aber nur, wenn sie auf Höhe des
      // Pfeils stehen (in Verlängerung des Pfeilstücks). Ein Reagenz direkt über einem kurzen Pfeil ist oft breiter als
      // der Pfeil, seine Ecken liegen dann dicht an Anfang und Spitze (TMP über dem Pfeil).
      // Zusätzlich muss ein Edukt VOR dem Anfang liegen (Mitte entgegen der Pfeilrichtung) und ein Produkt HINTER der
      // Spitze – ein Reagenz dicht über dem Pfeil hat seine Mitte über dem Pfeil und zählt so nie als Edukt/Produkt.
      const inLine = (pt: { x: number; y: number }, nb: { x: number; y: number }) => {
        const horiz = Math.abs(nb.x - pt.x) >= Math.abs(nb.y - pt.y)
        const beyond = (cxB(b) - pt.x) * (pt.x - nb.x) + (cyB(b) - pt.y) * (pt.y - nb.y) > 0
        return beyond && (horiz ? b.y1 - L * 0.3 <= pt.y && pt.y <= b.y2 + L * 0.3 : b.x1 - L * 0.3 <= pt.x && pt.x <= b.x2 + L * 0.3)
      }
      const atStart = boxDist(b, pts[0]) < L * 1.2 && inLine(pts[0], pts[1])
      const atEnd = boxDist(b, pts[pts.length - 1]) < L * 1.2 && inLine(pts[pts.length - 1], pts[pts.length - 2])
      if (atStart || atEnd) continue
      // ebenso Moleküle neben einem Plus-Zeichen (A + B)
      if (pluses.some((pl) => Math.abs(cyB(pl.box) - cyB(b)) < L * 5 && (Math.abs(pl.box.x1 - b.x2) < L * 3 || Math.abs(b.x1 - pl.box.x2) < L * 3))) continue
      for (let i = 1; i < pts.length && !m.reagentOf; i++) {
        const p = pts[i - 1]
        const q = pts[i]
        const horiz = Math.abs(q.x - p.x) >= Math.abs(q.y - p.y)
        const sx1 = Math.min(p.x, q.x)
        const sx2 = Math.max(p.x, q.x)
        const sy1 = Math.min(p.y, q.y)
        const sy2 = Math.max(p.y, q.y)
        if (horiz) {
          if (sx2 - sx1 < L) continue
          const mid = (p.y + q.y) / 2
          if (cxB(b) < sx1 - L * 0.3 || cxB(b) > sx2 + L * 0.3 || b.x2 - b.x1 > sx2 - sx1 + L * 3) continue
          // über bzw. unter dem Pfeil; etwas zu tief/hoch gezeichnet (leicht über die Pfeillinie) zählt auch
          if (b.y2 < mid + L * 0.4 && cyB(b) < mid && mid - b.y2 < L * 2.5) {
            m.reagentOf = a.id
            reagentSide.set(String(m.idx), -1)
          } else if (b.y1 > mid - L * 0.4 && cyB(b) > mid && b.y1 - mid < L * 2.5) {
            m.reagentOf = a.id
            reagentSide.set(String(m.idx), 1)
          }
        } else {
          if (sy2 - sy1 < L) continue
          const mid = (p.x + q.x) / 2
          // neben dem senkrechten Stück; bei Winkelpfeilen auch etwas darüber (Reagenz über den Bedingungen wie in S9),
          // bei geraden Pfeilen nur auf Höhe des Pfeils (darüber stehen die Edukte)
          const above = i === 1 ? L * 0.3 : L * 3
          if (b.y2 < sy1 - above || b.y1 > sy2 + L * 0.3 || (i === 1 && cyB(b) < sy1)) continue
          // rechts bzw. links des senkrechten Stücks (leichte Überlappung zulassen – grob gezeichnet)
          if (cxB(b) > mid && b.x1 > mid - L && b.x1 - mid < L * 2.5) {
            m.reagentOf = a.id
            reagentSide.set(String(m.idx), 1)
          } else if (cxB(b) < mid && b.x2 < mid + L && mid - b.x2 < L * 2.5) {
            m.reagentOf = a.id
            reagentSide.set(String(m.idx), -1)
          }
        }
      }
      if (m.reagentOf === a.id) reagentsOf.set(a.id, [...(reagentsOf.get(a.id) ?? []), m])
    }
  }
  // Ein „Reagenz“, das selbst Edukt/Produkt eines anderen Pfeils ist (Pfeil endet daran), bleibt ein Hauptmolekül
  for (const m of mols) {
    if (!m.reagentOf) continue
    const touched = arrows.some((a) => {
      if (a.id === m.reagentOf) return false
      const pts = arrowPoints(a)
      return boxDist(m.box, pts[0]) < L * 1.2 || boxDist(m.box, pts[pts.length - 1]) < L * 1.2
    })
    if (touched) {
      const list = reagentsOf.get(m.reagentOf)!.filter((x) => x !== m)
      reagentsOf.set(m.reagentOf, list)
      m.reagentOf = undefined
      reagentSide.delete(String(m.idx))
    }
  }
  const mainMols = mols.filter((m) => !m.reagentOf)

  // ---------- Zeilen aus Molekülen und Plus-Zeichen (grobe Anordnung des Nutzers) ----------
  const rowSeeds: RowItem[] = [...mainMols, ...pluses].sort((a, b) => cyB(a.box) - cyB(b.box))
  const rows: Row[] = []
  for (const it of rowSeeds) {
    const row = rows.find((r) => cyB(it.box) > r.y1 - L * 0.4 && cyB(it.box) < r.y2 + L * 0.4)
    if (row) {
      row.items.push(it)
      row.y1 = Math.min(row.y1, it.box.y1)
      row.y2 = Math.max(row.y2, it.box.y2)
      row.x1 = Math.min(row.x1, it.box.x1)
    } else rows.push({ items: [it], y1: it.box.y1, y2: it.box.y2, x1: it.box.x1 })
  }
  // Ein Plus-Zeichen verbindet die Moleküle links und rechts davon zu einer Zeile – auch wenn eines davon grob
  // höher/tiefer gezeichnet wurde (sonst landet es in einer eigenen Zeile und die Edukte stehen untereinander)
  const findRow = (it: RowItem) => rows.findIndex((r) => r.items.includes(it))
  for (const p of pluses) {
    for (const side of [-1, 1]) {
      let best: MolItem | null = null
      let bd = Infinity
      const gapOf = (m: MolItem) => (side < 0 ? p.box.x1 - m.box.x2 : m.box.x1 - p.box.x2)
      // hat das Plus in seiner Zeile auf dieser Seite noch keinen Partner, großzügiger suchen
      const own = rows[findRow(p)]?.items.some((x) => x.kind === 'mol' && gapOf(x) > -L * 0.5 && gapOf(x) < L * 3)
      const maxDy = own ? L * 3 : L * 5
      for (const m of mainMols) {
        const gap = gapOf(m)
        if (gap < -L * 0.5 || gap > L * 3) continue
        const dy = Math.abs(cyB(m.box) - cyB(p.box))
        if (dy > maxDy) continue
        if (gap + dy < bd) {
          bd = gap + dy
          best = m
        }
      }
      const ri = findRow(p)
      const rj = best ? findRow(best) : -1
      if (!best || rj < 0 || rj === ri) continue
      rows[rj].items = rows[rj].items.filter((x) => x !== best)
      const r = rows[ri]
      r.items.push(best)
      r.y1 = Math.min(r.y1, best.box.y1)
      r.y2 = Math.max(r.y2, best.box.y2)
      r.x1 = Math.min(r.x1, best.box.x1)
    }
  }
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (!r.items.length) rows.splice(i, 1)
    else {
      r.y1 = Math.min(...r.items.map((x) => x.box.y1))
      r.y2 = Math.max(...r.items.map((x) => x.box.y2))
      r.x1 = Math.min(...r.items.map((x) => x.box.x1))
    }
  }
  rows.sort((a, b) => a.y1 + a.y2 - (b.y1 + b.y2))
  const rowOfItem = (it: RowItem) => rows.findIndex((r) => r.items.includes(it))
  const bandOf = (y: number) => rows.findIndex((r) => y > r.y1 - L * 0.4 && y < r.y2 + L * 0.4)
  const molRow = (m: MolItem) => rowOfItem(m)

  const nearestMol = (p: Pt, maxD = L * 2.5): MolItem | null => {
    let best: MolItem | null = null
    let bd = maxD
    for (const m of mainMols) {
      const dd = boxDist(m.box, p)
      if (dd < bd) {
        bd = dd
        best = m
      }
    }
    return best
  }

  // ---------- Pfeile einordnen ----------
  const connectors: Connector[] = []
  const routed: Id[] = [] // Verzweigungen/Winkelpfeile innerhalb des Schemas (bisherige Logik)
  for (const a of arrows) {
    const pts = arrowPoints(a)
    const tail = pts[0]
    const head = pts[pts.length - 1]
    const straight = (a.route ?? 'straight') === 'straight'
    if (straight) {
      const my = (a.y1 + a.y2) / 2
      const band = bandOf(my)
      const steep = Math.abs(a.y2 - a.y1) > Math.abs(a.x2 - a.x1) * 0.35
      if (band >= 0 && !steep) {
        rows[band].items.push({ kind: 'arrow', id: a.id, textW: 0, box: { x1: Math.min(a.x1, a.x2), y1: my - 2, x2: Math.max(a.x1, a.x2), y2: my + 2 } })
        rows[band].x1 = Math.min(rows[band].x1, a.x1, a.x2)
        continue
      }
      // zwischen zwei Zeilen → senkrechter Verbindungspfeil (auch wenn grob schräg gezeichnet)
      const down = a.y2 >= a.y1
      const yTop = Math.min(a.y1, a.y2)
      const yBot = Math.max(a.y1, a.y2)
      let above = -1
      let below = -1
      rows.forEach((r, i) => {
        if (cyB({ x1: 0, x2: 0, y1: r.y1, y2: r.y2 }) < (yTop + yBot) / 2 && r.y2 < yBot + L * 0.4) above = i
      })
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].y1 > yTop - L * 0.4 && cyB({ x1: 0, x2: 0, y1: rows[i].y1, y2: rows[i].y2 }) > (yTop + yBot) / 2) below = i
      if (above >= 0 && below >= 0 && above !== below && band < 0) {
        const from = down ? above : below
        const to = down ? below : above
        const hasArrows = (ri: number) => arrows.some((x) => x.id !== a.id && (x.route ?? 'straight') === 'straight' && bandOf((x.y1 + x.y2) / 2) === ri)
        const pick = (ri: number, p: Pt) => (hasArrows(ri) ? (nearestMol(p, L * 4) ?? null) : null)
        const src = pick(from, tail)
        const dst = pick(to, head)
        connectors.push({ id: a.id, type: 'vertical', from, to, srcMol: src && molRow(src) === from ? src : null, dstMol: dst && molRow(dst) === to ? dst : null, down, side: 0, offset: 0 })
        continue
      }
      routed.push(a.id)
      continue
    }
    // Winkel-/Stufenpfeil: verbindet er zwei verschiedene Zeilen?
    const src = nearestMol(tail)
    const dst = nearestMol(head)
    const rs = src ? molRow(src) : -1
    const rd = dst ? molRow(dst) : -1
    if (src && dst && rs >= 0 && rd >= 0 && rs !== rd && a.route === 'elbow-h') {
      const side = Math.sign(head.x - cxB(src.box)) || 1
      const edge = side > 0 ? src.box.x2 : src.box.x1
      connectors.push({ id: a.id, type: 'elbow', from: rs, to: rd, srcMol: src, dstMol: dst, down: rd > rs, side, offset: Math.max(L * 1.5, (cxB(dst.box) - edge) * side) })
      continue
    }
    routed.push(a.id)
  }

  // Freie Texte: an einem Pfeil (Bedingungen als eigener Text) oder Fußnote/sonstiger Text
  const textAtArrow = new Map<Id, { arrow: Id; dx: number; dy: number }>()
  for (const tid of freeTexts) {
    const b = textBox(doc.texts[tid], doc)
    const c = { x: cxB(b), y: cyB(b) }
    for (const a of arrows) {
      const pts = arrowPoints(a)
      let dmin = Infinity
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1]
        const q = pts[i]
        const vx = q.x - p.x
        const vy = q.y - p.y
        const l2 = vx * vx + vy * vy || 1
        const t = Math.max(0, Math.min(1, ((c.x - p.x) * vx + (c.y - p.y) * vy) / l2))
        dmin = Math.min(dmin, Math.hypot(c.x - p.x - vx * t, c.y - p.y - vy * t))
      }
      if (dmin < L * 1.3) {
        const m = { x: (a.x1 + a.x2) / 2, y: (a.y1 + a.y2) / 2 }
        textAtArrow.set(tid, { arrow: a.id, dx: doc.texts[tid].x - m.x, dy: doc.texts[tid].y - m.y })
        break
      }
    }
  }

  // ---------- Verzweigungen eines Hauptpfeils (Winkelpfeile zu eigenen Zielmolekülen) ----------
  const ao = arrowTextOpts(doc)
  const textH = (id: Id, which: 'above' | 'below') => (doc.arrows[id][which] ? arrowTextBlock(doc, doc.arrows[id], which).lay.height : 0)
  const yieldH = (id: Id) => (doc.arrows[id].yieldText ? ao.size * 1.3 : 0)
  const routedRel = routedRelations(doc, routed, rows, mainMols, L)
  interface Branch {
    rel: RoutedRel
    target: MolItem
    len: number
  }
  const branches: Branch[] = []
  {
    const usedRows = new Set(connectors.flatMap((c) => [c.from, c.to]))
    for (const rel of routedRel) {
      if (!rel.host || !rel.target || rel.dirX === 0 || rel.relY === 0) continue
      const ri = rowOfItem(rel.target)
      // nur Zielmoleküle, die allein stehen (sonst gehört das Ziel zu einer eigenen Kaskade)
      if (ri < 0 || rows[ri].items.length !== 1 || usedRows.has(ri) || branches.some((b) => b.target === rel.target)) continue
      branches.push({ rel, target: rel.target, len: 0 })
    }
    // Zielmoleküle der Verzweigungen aus den Zeilen nehmen; Zeilenindizes der Verbindungspfeile anpassen
    const drop = new Set(branches.map((b) => rowOfItem(b.target)))
    if (drop.size) {
      const map: number[] = []
      let k = 0
      rows.forEach((_r, i) => (map[i] = drop.has(i) ? -1 : k++))
      for (const c of connectors) {
        c.from = map[c.from]
        c.to = map[c.to]
      }
      for (let i = rows.length - 1; i >= 0; i--) if (drop.has(i)) rows.splice(i, 1)
    }
  }
  const branchesOf = (hostId: Id) => branches.filter((b) => b.rel.host!.id === hostId)
  const BRANCH_OFFSET = L * 1.2
  const arrowLen = new Map<Id, number>()

  // ---------- Horizontales Layout jeder Zeile (relativ: x ab 0, y relativ zur Mittellinie) ----------
  const arrowLabelW = (id: Id) => Math.max(0, ...arrowTextBlocks(doc, doc.arrows[id]).map((tb) => tb.lay.width))
  const reagentW = (id: Id) => Math.max(0, ...(reagentsOf.get(id) ?? []).map((m) => m.box.x2 - m.box.x1))
  interface RowPlan {
    /** x relativ zum Zeilenanfang */
    pos: Map<RowItem, number>
    width: number
    up: number
    down: number
  }
  const captionTop = (row: Row) => {
    const ms = row.items.filter((i): i is MolItem => i.kind === 'mol')
    return ms.length ? Math.max(...ms.map((m) => m.box.y2 - cyB(m.box))) + fs * 0.9 : 0
  }
  // Fehlende Pluszeichen: In einer Reaktionszeile (mit Pfeil) stehen zwischen zwei Molekülen ohne Pfeil dazwischen
  // immer ein „+“ (Edukte bzw. Produkte) – fehlt es, wird es ergänzt
  const plusSize = Math.round(fs * 1.3)
  const newPluses = new Set<Id>()
  // Mechanismuspfeil direkt zwischen zwei Molekülen (z. B. Nukleophil → Substrat): dort kein „+“ dazwischen
  const anchorAtoms = (an: { type: string; id?: Id }) =>
    an.type === 'bond' && an.id ? [doc.bonds[an.id]?.a1, doc.bonds[an.id]?.a2] : an.type === 'atom' || an.type === 'lp' ? [an.id] : []
  const linkedByCurved = (m1: MolItem, m2: MolItem) => {
    const s1 = new Set(m1.sel.atoms)
    const s2 = new Set(m2.sel.atoms)
    return Object.values(doc.curved).some((c) => {
      const f = anchorAtoms(c.from)
      const t = anchorAtoms(c.to)
      const inA = (xs: (Id | undefined)[], s: Set<Id>) => xs.some((x) => x && s.has(x))
      return (inA(f, s1) && inA(t, s2)) || (inA(f, s2) && inA(t, s1))
    })
  }
  // Reaktionszeilen: mit eigenem Pfeil – oder ganze Zeile als Edukt-/Produktseite eines senkrechten bzw.
  // Winkelpfeils (senkrechte Reaktion wie S10: A + B oben, Produkt unten)
  const wholeRowEnd = (ri: number) => connectors.some((c) => (c.from === ri && !c.srcMol) || (c.to === ri && !c.dstMol))
  for (const [ri, row] of rows.entries()) {
    row.items.sort((a, b) => a.box.x1 - b.box.x1)
    if (!row.items.some((it) => it.kind === 'arrow') && !wholeRowEnd(ri)) continue
    for (let i = row.items.length - 2; i >= 0; i--) {
      if (row.items[i].kind !== 'mol' || row.items[i + 1].kind !== 'mol') continue
      if (linkedByCurved(row.items[i] as MolItem, row.items[i + 1] as MolItem)) continue
      const a = row.items[i].box
      const b = row.items[i + 1].box
      const id = uid('t')
      const w = plusSize * 0.58
      const cx = (a.x2 + b.x1) / 2
      const cy = (cyB(a) + cyB(b)) / 2
      newPluses.add(id)
      row.items.splice(i + 1, 0, { kind: 'plus', id, box: { x1: cx - w / 2, y1: cy - plusSize * 0.35, x2: cx + w / 2, y2: cy + plusSize * 0.35 } })
    }
  }
  const plans: RowPlan[] = rows.map((row) => {
    row.items.sort((a, b) => a.box.x1 - b.box.x1)
    const pos = new Map<RowItem, number>()
    let x = 0
    let prev: RowItem['kind'] | null = null
    let up = 0
    let down = 0
    const capTop = captionTop(row)
    for (const it of row.items) {
      x += prev === null ? 0 : prev === 'plus' || it.kind === 'plus' ? gapPlus : gapMol
      pos.set(it, x)
      if (it.kind === 'mol') {
        up = Math.max(up, cyB(it.box) - it.box.y1)
        down = Math.max(down, it.box.y2 - cyB(it.box))
        for (const tid of it.captions) down = Math.max(down, capTop + textBox(doc.texts[tid], doc).y2 - textBox(doc.texts[tid], doc).y1)
        x += it.box.x2 - it.box.x1
      } else if (it.kind === 'plus') {
        x += it.box.x2 - it.box.x1
      } else {
        it.textW = Math.max(arrowLabelW(it.id), reagentW(it.id))
        const brs = branchesOf(it.id)
        // mit Verzweigungen: Abzweig kurz hinter dem Anfang, die Bedingungen stehen rechts davon
        const len = Math.max(minArrow, it.textW + L * 1.2 + (brs.length ? BRANCH_OFFSET : 0))
        arrowLen.set(it.id, len)
        if (brs.length) {
          // Länge der Seitenpfeile passend zu ihrer Beschriftung (alle gleich lang)
          const bl = Math.max(minArrow * 0.8, ...brs.map((b) => arrowLabelW(b.rel.id) + L * 1.2))
          for (const b of brs) b.len = bl
          // senkrechter Abstand: Bedingungen von Haupt- und Seitenpfeil dürfen sich nicht berühren
          const prodX = len + gapMol
          let mUp = 0
          let mDown = 0
          for (const b of brs) {
            const tH = b.target.box.y2 - b.target.box.y1
            const tW = b.target.box.x2 - b.target.box.x1
            const overlapsProduct = BRANCH_OFFSET + bl + gapMol + tW > prodX
            if (b.rel.relY < 0) {
              let need = textH(it.id, 'above') + ao.size * 1.0 + textH(b.rel.id, 'below') + yieldH(b.rel.id) + ao.size * 1.3
              need = Math.max(need, L * 2, tH / 2 + L * 0.5)
              if (overlapsProduct) need = Math.max(need, tH / 2 + up + gapV)
              mUp = Math.max(mUp, need)
            } else {
              let need = textH(it.id, 'below') + yieldH(it.id) + ao.size * 1.4 + textH(b.rel.id, 'above') + ao.size * 0.9
              need = Math.max(need, L * 2, tH / 2 + L * 0.5)
              if (overlapsProduct) need = Math.max(need, tH / 2 + down + gapV)
              mDown = Math.max(mDown, need)
            }
          }
          // nach oben und unten symmetrisch
          if (mUp && mDown) mUp = mDown = Math.max(mUp, mDown)
          for (const b of brs) {
            b.rel.relY = b.rel.relY < 0 ? -mUp : mDown
            const tH = b.target.box.y2 - b.target.box.y1
            if (b.rel.relY < 0) up = Math.max(up, mUp + Math.max(tH / 2, textH(b.rel.id, 'above') + ao.size))
            else down = Math.max(down, mDown + Math.max(tH / 2, textH(b.rel.id, 'below') + yieldH(b.rel.id) + ao.size * 1.2))
          }
        }
        // Platz für Bedingungen und Reagenz-Moleküle über/unter dem Pfeil
        const rs = reagentsOf.get(it.id) ?? []
        const rUp = rs.filter((m) => reagentSide.get(String(m.idx)) === -1).reduce((h, m) => h + m.box.y2 - m.box.y1 + gapV * 0.5, 0)
        const rDown = rs.filter((m) => reagentSide.get(String(m.idx)) === 1).reduce((h, m) => h + m.box.y2 - m.box.y1 + gapV * 0.5, 0)
        up = Math.max(up, textH(it.id, 'above') + ao.size + rUp)
        down = Math.max(down, textH(it.id, 'below') + ao.size * 1.2 + rDown + (doc.arrows[it.id].yieldText ? ao.size * 1.3 : 0))
        x += len
      }
      prev = it.kind
    }
    return { pos, width: x, up, down }
  })

  // ---------- Zeilen anordnen: senkrecht stapeln, über Verbindungspfeile horizontal ausrichten ----------
  // Mittellinie einer Zeile wie bisher: Mittel der Molekülmitten (sonst aller Objekte)
  const origBaseOf = (row: Row) => {
    const ms = row.items.filter((it) => it.kind === 'mol')
    const list = ms.length ? ms : row.items
    return list.reduce((sum, it) => sum + cyB(it.box), 0) / Math.max(1, list.length)
  }
  const rowX = new Array<number>(rows.length).fill(0)
  const rowBase = new Array<number>(rows.length).fill(0)
  const placed = new Array<boolean>(rows.length).fill(false)
  const molCenterX = (m: MolItem, ri: number) => rowX[ri] + plans[ri].pos.get(m)! + (m.box.x2 - m.box.x1) / 2
  const rowCenterX = (ri: number) => rowX[ri] + plans[ri].width / 2
  const vLabelH = (id: Id) => Math.max(0, ...arrowTextBlocks(doc, doc.arrows[id]).map((tb) => tb.lay.height))
  rows.forEach((row, i) => {
    const plan = plans[i]
    const inbound = connectors.find((c) => c.to === i && placed[c.from]) ?? connectors.find((c) => c.from === i && placed[c.to])
    if (!inbound || i === 0) {
      // ohne Verbindung: Anfang und Höhe aus der groben Anordnung (aber ohne Überlappung mit der Zeile darüber)
      rowX[i] = row.x1
      const origBase = origBaseOf(row)
      if (i === 0) rowBase[i] = origBase
      else {
        // ursprünglichen Abstand zur Zeile darüber beibehalten, aber ohne Überlappung
        const prevOrig = origBaseOf(rows[i - 1])
        rowBase[i] = Math.max(rowBase[i - 1] + (origBase - prevOrig), rowBase[i - 1] + plans[i - 1].down + L + plan.up)
      }
    } else {
      const c = inbound
      const other = c.to === i ? c.from : c.to
      const myMol = c.to === i ? c.dstMol : c.srcMol
      const otherMol = c.to === i ? c.srcMol : c.dstMol
      // horizontale Ausrichtung
      let alignX: number
      if (c.type === 'elbow') {
        const sm = c.srcMol!
        const edge = c.side > 0 ? rowX[c.from] + plans[c.from].pos.get(sm)! + (sm.box.x2 - sm.box.x1) : rowX[c.from] + plans[c.from].pos.get(sm)!
        alignX = edge + c.side * c.offset
      } else alignX = otherMol ? molCenterX(otherMol, other) : rowCenterX(other)
      const myCenterRel = myMol ? plan.pos.get(myMol)! + (myMol.box.x2 - myMol.box.x1) / 2 : plan.width / 2
      rowX[i] = alignX - myCenterRel
      // senkrechter Abstand: Pfeillänge passend zur Beschriftung
      const above = Math.min(c.from, c.to) === other
      const lab = vLabelH(c.id)
      if (c.type === 'vertical') {
        const rH = (reagentsOf.get(c.id) ?? []).reduce((h, m) => h + m.box.y2 - m.box.y1 + gapV * 0.4, 0)
        const len = Math.max(minVArrow, lab + rH + L * 0.6)
        rowBase[i] = above ? rowBase[other] + plans[other].down + gapV * 2 + len + plan.up : rowBase[other] - plans[other].up - gapV * 2 - len - plan.down
      } else {
        // Bedingungen (und Reagenzien) stehen neben dem senkrechten Teilstück → genug Höhe dafür
        const rH = (reagentsOf.get(c.id) ?? []).reduce((h, m) => h + m.box.y2 - m.box.y1 + gapV * 0.4, 0)
        const drop = Math.max(plans[other].down + gapV + plan.up, plan.up + gapV + lab + rH + L * 0.8, L * 2.4)
        rowBase[i] = above ? rowBase[other] + drop : rowBase[other] - drop
      }
      if (i > 0 && above) rowBase[i] = Math.max(rowBase[i], rowBase[i - 1] + plans[i - 1].down + L * 0.8 + plan.up)
    }
    placed[i] = true
  })

  // ---------- Übernehmen ----------
  const molMove = new Map<MolItem, { dx: number; dy: number }>()
  const origBottom = Math.max(...rows.map((r) => r.y2), -Infinity)
  const origLeft = Math.min(...rows.map((r) => r.x1), Infinity)

  commit((d) => {
    rows.forEach((row, ri) => {
      const plan = plans[ri]
      const base = rowBase[ri]
      const capY = base + captionTop(row)
      for (const it of row.items) {
        const x = rowX[ri] + plan.pos.get(it)!
        if (it.kind === 'mol') {
          const dx = x - it.box.x1
          const dy = base - cyB(it.box)
          translateSelection(d, it.sel, dx, dy)
          molMove.set(it, { dx, dy })
          const mcx = cxB(it.box) + dx
          for (const tid of it.captions) {
            const t = d.texts[tid]
            t.align = 'center'
            t.x = mcx
            t.y = capY + t.size * 0.5
          }
        } else if (it.kind === 'plus') {
          if (newPluses.has(it.id)) d.texts[it.id] = { id: it.id, x, y: base, text: '+', size: plusSize, align: 'left' }
          const t = d.texts[it.id]
          t.align = 'left'
          t.x = x
          t.y = base
        } else {
          const a = d.arrows[it.id]
          const len = arrowLen.get(it.id) ?? Math.max(minArrow, it.textW + L * 1.2)
          const ltr = a.x2 >= a.x1
          a.x1 = ltr ? x : x + len
          a.x2 = ltr ? x + len : x
          a.y1 = a.y2 = base
        }
      }
    })

    // Verbindungspfeile zwischen Zeilen
    for (const c of connectors) {
      const a = d.arrows[c.id]
      const top = Math.min(c.from, c.to)
      const bot = Math.max(c.from, c.to)
      if (c.type === 'vertical') {
        const x = c.srcMol ? molCenterX(c.srcMol, c.from) : c.dstMol ? molCenterX(c.dstMol, c.to) : rowCenterX(c.from)
        const yA = rowBase[top] + plans[top].down + gapV
        const yB = rowBase[bot] - plans[bot].up - gapV
        a.x1 = a.x2 = x
        a.y1 = c.down ? yA : yB
        a.y2 = c.down ? yB : yA
        a.route = undefined
        a.labelPos = undefined
      } else {
        const sm = c.srcMol!
        const mv = { dx: rowX[c.from] + plans[c.from].pos.get(sm)! - sm.box.x1, dy: rowBase[c.from] - cyB(sm.box) }
        const edge = c.side > 0 ? sm.box.x2 + mv.dx : sm.box.x1 + mv.dx
        const tx = molCenterX(c.dstMol!, c.to)
        a.labelSeg = 'v'
        a.x1 = edge + c.side * gapMol * 0.5
        a.y1 = rowBase[c.from]
        a.x2 = tx
        a.y2 = c.down ? rowBase[c.to] - (cyB(c.dstMol!.box) - c.dstMol!.box.y1) - gapV : rowBase[c.to] + (c.dstMol!.box.y2 - cyB(c.dstMol!.box)) + gapV
      }
    }

    // Reagenz-Moleküle: über/unter einem waagerechten Pfeil (über bzw. unter den Bedingungen) bzw. neben einem
    // senkrechten Teilstück über den Bedingungen (wie in S9)
    for (const [aid, list] of reagentsOf) {
      const a = d.arrows[aid]
      if (!a || !list.length) continue
      const [p, q] = arrowLabelSegment(a)
      const vertical = Math.abs(q.y - p.y) > Math.abs(q.x - p.x)
      const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
      const blocks = arrowTextBlocks(d, a)
      const top = (side: number) => {
        // oberste Kante der Bedingungen auf dieser Seite
        const bs = blocks.filter((tb) => (side > 0 ? tb.x >= m.x : tb.x < m.x))
        return bs.length ? Math.min(...bs.map((tb) => tb.y - ao.size * 0.95)) : m.y - ao.size * 0.5
      }
      let upY = m.y - (a.above ? arrowTextBlock(d, a, 'above').lay.height : 0) - ao.size * 0.9
      let downY = m.y + (a.below ? arrowTextBlock(d, a, 'below').lay.height : 0) + ao.size * 1.2 + (a.yieldText ? ao.size * 1.3 : 0)
      let rightTop = top(1)
      let leftTop = top(-1)
      const gapX = ao.size * 0.6 + doc.style.lineWidth * 2
      for (const r of list) {
        const side = reagentSide.get(String(r.idx)) ?? -1
        const w = r.box.x2 - r.box.x1
        const h = r.box.y2 - r.box.y1
        let tx: number
        let ty: number
        if (!vertical) {
          tx = m.x - w / 2
          ty = side < 0 ? upY - h : downY
          if (side < 0) upY -= h + gapV * 0.5
          else downY += h + gapV * 0.5
        } else if (side > 0) {
          tx = m.x + gapX
          ty = rightTop - gapV * 0.4 - h
          rightTop = ty
        } else {
          tx = m.x - gapX - w
          ty = leftTop - gapV * 0.4 - h
          leftTop = ty
        }
        const dx = tx - r.box.x1
        const dy = ty - r.box.y1
        translateSelection(d, r.sel, dx, dy)
        molMove.set(r, { dx, dy })
        for (const tid of r.captions) {
          d.texts[tid].x += dx
          d.texts[tid].y += dy
        }
      }
    }

    // Verzweigungen: Abzweig hinter dem Pfeilanfang, Seitenpfeil passend lang, Zielmolekül direkt dahinter
    for (const b of branches) {
      const h = d.arrows[b.rel.host!.id]
      const a = d.arrows[b.rel.id]
      const hl = Math.abs(h.x2 - h.x1) || 1
      const sgn = Math.sign(h.x2 - h.x1) || 1
      a.x1 = h.x1 + sgn * BRANCH_OFFSET
      a.y1 = h.y1
      a.y2 = h.y1 + b.rel.relY
      a.x2 = a.x1 + b.rel.dirX * b.len
      a.route = 'elbow-v'
      h.labelPos = (BRANCH_OFFSET + (hl - BRANCH_OFFSET) / 2) / hl
      const t = b.target
      const tx = b.rel.dirX > 0 ? a.x2 + gapMol : a.x2 - gapMol - (t.box.x2 - t.box.x1)
      const dx = tx - t.box.x1
      const dy = a.y2 - cyB(t.box)
      translateSelection(d, t.sel, dx, dy)
      molMove.set(t, { dx, dy })
      for (const tid of t.captions) {
        const tt = d.texts[tid]
        tt.align = 'center'
        tt.x = cxB(t.box) + dx
        tt.y = t.box.y2 + dy + fs * 0.9 + tt.size * 0.5
      }
    }
    const managed = new Set(branches.map((b) => b.rel.id))
    applyRouted(d, routedRel.filter((r) => !managed.has(r.id)), molMove, mainMols, L, gapMol, rows)

    // freie Texte an Pfeilen mitführen
    for (const [tid, rel] of textAtArrow) {
      const a = d.arrows[rel.arrow]
      if (!a) continue
      d.texts[tid].x = (a.x1 + a.x2) / 2 + rel.dx
      d.texts[tid].y = (a.y1 + a.y2) / 2 + rel.dy
    }
    // Fußnoten (unterhalb des Schemas): gleicher Abstand zum neuen unteren Rand, linksbündig mit dem Schema
    const newBox = rows.reduce<Box | null>((acc, _r, ri) => union(acc, { x1: rowX[ri], x2: rowX[ri] + plans[ri].width, y1: rowBase[ri] - plans[ri].up, y2: rowBase[ri] + plans[ri].down }), null)
    for (const tid of freeTexts) {
      if (textAtArrow.has(tid) || !newBox) continue
      const t = doc.texts[tid]
      const b = textBox(t, doc)
      if (b.y1 < origBottom) continue
      d.texts[tid].y = newBox.y2 + Math.max(L * 0.5, b.y1 - origBottom) + (t.y - b.y1)
      d.texts[tid].x = newBox.x1 + (t.x - origLeft)
    }
  })
  const added = newPluses.size ? ` · ${newPluses.size} Pluszeichen ergänzt` : ''
  ensureVisible()
  toast((rows.length > 1 ? `Reaktion aufgeräumt (${rows.length} Zeilen)` : 'Reaktion aufgeräumt') + added)
}

// ---------- Verzweigungen / Winkelpfeile innerhalb des Schemas (bewährte Logik) ----------

interface RoutedRel {
  id: Id
  host: { id: Id; t: number } | null
  relY: number
  source: MolItem | null
  target: MolItem | null
  dirX: number
  dirY: number
}

function routedRelations(doc: Doc, routed: Id[], rows: Row[], mols: MolItem[], L: number): RoutedRel[] {
  const straightIds = rows.flatMap((r) => r.items.filter((i): i is ArrowItem => i.kind === 'arrow').map((i) => i.id))
  const nearest = (p: Pt) => {
    let best: MolItem | null = null
    let bd = L * 2.5
    for (const m of mols) {
      const dd = boxDist(m.box, p)
      if (dd < bd) {
        bd = dd
        best = m
      }
    }
    return best
  }
  const rels = routed.map((id) => {
    const pts = arrowPoints(doc.arrows[id])
    const tail = pts[0]
    const head = pts[pts.length - 1]
    let host: { id: Id; t: number } | null = null
    for (const sid of straightIds) {
      const sa = doc.arrows[sid]
      const x1 = Math.min(sa.x1, sa.x2)
      const x2 = Math.max(sa.x1, sa.x2)
      if (Math.abs(tail.y - sa.y1) < L * 0.5 && tail.x >= x1 - L * 0.3 && tail.x <= x2 + L * 0.3) {
        host = { id: sid, t: (tail.x - sa.x1) / (sa.x2 - sa.x1 || 1) }
        break
      }
    }
    const fin = pts[pts.length - 2] ?? tail
    const relY = host ? head.y - doc.arrows[host.id].y1 : 0
    const dirX = Math.sign(head.x - fin.x)
    let target = nearest(head)
    if (host && !target && dirX !== 0 && relY !== 0) {
      // Seitenpfeil: Ziel ist das nächste Molekül auf seiner Seite des Hauptpfeils (oben/unten) in Pfeilrichtung –
      // auch wenn es grob weiter weg gezeichnet wurde; Moleküle der Hauptzeile zählen nicht
      const hy = doc.arrows[host.id].y1
      const hostRow = rows.find((r) => r.items.some((it) => it.kind === 'arrow' && it.id === host!.id))
      let bd = L * 12
      for (const m of mols) {
        if (hostRow?.items.includes(m)) continue
        if (Math.sign(cyB(m.box) - hy) !== Math.sign(relY)) continue
        if (dirX > 0 ? m.box.x2 < head.x : m.box.x1 > head.x) continue
        const dd = Math.hypot(cxB(m.box) - head.x, cyB(m.box) - head.y)
        if (dd < bd) {
          bd = dd
          target = m
        }
      }
    }
    return { id, host, relY, source: host ? null : nearest(tail), target, dirX, dirY: Math.sign(head.y - fin.y) }
  })
  // Verzweigungen eines Hauptpfeils: gleiche Abstände nach oben und unten
  const byHost = new Map<Id, RoutedRel[]>()
  for (const r of rels) if (r.host) byHost.set(r.host.id, [...(byHost.get(r.host.id) ?? []), r])
  for (const list of byHost.values()) {
    const up = list.filter((r) => r.relY < 0)
    const down = list.filter((r) => r.relY > 0)
    if (up.length === 1 && down.length === 1) {
      const m = (Math.abs(up[0].relY) + Math.abs(down[0].relY)) / 2
      up[0].relY = -m
      down[0].relY = m
    }
  }
  return rels
}

function applyRouted(d: Doc, rels: RoutedRel[], molMove: Map<MolItem, { dx: number; dy: number }>, mols: MolItem[], L: number, gapMol: number, rows: Row[]) {
  const straightIds = rows.flatMap((r) => r.items.filter((i): i is ArrowItem => i.kind === 'arrow').map((i) => i.id))
  for (const rel of rels) {
    const a = d.arrows[rel.id]
    if (rel.host) {
      const h = d.arrows[rel.host.id]
      a.x1 = h.x1 + rel.host.t * (h.x2 - h.x1)
      a.y1 = h.y1
      a.y2 = h.y1 + rel.relY
      h.labelPos = Math.min(0.85, (rel.host.t + 1) / 2)
    } else if (rel.source) {
      const mv = molMove.get(rel.source) ?? { dx: 0, dy: 0 }
      a.x1 += mv.dx
      a.y1 += mv.dy
    }
    if (rel.target) {
      const mv = molMove.get(rel.target) ?? { dx: 0, dy: 0 }
      const b = rel.target.box
      const nb = { x1: b.x1 + mv.dx, x2: b.x2 + mv.dx, y1: b.y1 + mv.dy, y2: b.y2 + mv.dy }
      a.x2 += mv.dx
      if (!rel.host) a.y2 += mv.dy
      if (rel.dirX > 0) a.x2 = nb.x1 - gapMol
      else if (rel.dirX < 0) a.x2 = nb.x2 + gapMol
      else if (rel.dirY > 0) a.y2 = nb.y1 - gapMol * 0.6
      else if (rel.dirY < 0) a.y2 = nb.y2 + gapMol * 0.6
    }
  }
  // Spitzen, die auf dasselbe Ziel zeigen, exakt auf eine Fluchtlinie
  const groups = new Map<string, Id[]>()
  for (const rel of rels) if (rel.target) groups.set(mols.indexOf(rel.target) + ':' + rel.dirX, [...(groups.get(mols.indexOf(rel.target) + ':' + rel.dirX) ?? []), rel.id])
  for (const ids of groups.values()) {
    const xs = ids.map((id) => d.arrows[id].x2)
    // ein gerader Pfeil zum selben Ziel gibt die Fluchtlinie vor
    const straightToSame = straightIds.find((sid) => ids.length && Math.abs(d.arrows[sid].x2 - d.arrows[ids[0]].x2) < L * 0.6)
    const common = straightToSame ? d.arrows[straightToSame].x2 : xs.reduce((s2, v) => s2 + v, 0) / xs.length
    for (const id of ids) if (Math.abs(d.arrows[id].x2 - common) < L * 0.6) d.arrows[id].x2 = common
  }
}
