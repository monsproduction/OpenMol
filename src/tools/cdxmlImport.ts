// Import von ChemDraw-Dokumenten (CDXML) – Gegenstück zum Export in cdxml.ts, dieselben Element- und Attributnamen.
// Liest mit dem eingebauten XML-Parser des Browsers (lädt keine externen Inhalte). Übernommen werden Moleküle
// (Atome, Bindungen, Kürzel), Texte, Reaktionspfeile, Plus-Zeichen, gebogene Elektronenpfeile, Klammern,
// Rechtecke und Ovale; alles andere (Orbitale, Bilder, Spektren …) wird übersprungen und gemeldet.
// Koordinaten: CDXML in Punkt, y nach unten; skaliert auf die Bindungslänge von OpenMol.
import { canonicalAbbrev } from '../model/abbrev'
import { SYMBOLS } from '../model/elements'
import type { Arrow, ArrowKind, Atom, Bond, BondType, CurvedArrow, Doc, DoublePos, Shape, TextObj } from '../model/types'
import { emptyDoc, FONTS, normalizeDoc, uid } from '../model/types'

type P = { x: number; y: number }

const num = (v: string | null | undefined, d = 0) => {
  const n = v === null || v === undefined ? NaN : parseFloat(v)
  return Number.isFinite(n) ? n : d
}
const nums = (v: string | null | undefined) => (v ?? '').trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n))
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Ergebnis: Dokument und Liste nicht übernommener Objektarten (z. B. „2× Orbital“) */
export function importCdxml(text: string): { doc: Doc; skipped: string[] } {
  const xml = new DOMParser().parseFromString(text, 'application/xml')
  if (xml.getElementsByTagName('parsererror').length) throw new Error('Die Datei ist kein gültiges XML (beschädigt oder unvollständig).')
  const root = xml.documentElement
  if (!root || root.tagName !== 'CDXML') throw new Error('Keine ChemDraw-Datei (CDXML).')

  const doc = emptyDoc()
  const L = doc.style.bondLength
  const skipped = new Map<string, number>()
  const skip = (what: string) => skipped.set(what, (skipped.get(what) ?? 0) + 1)

  // ---------- Farben und Schriften ----------
  // Farbindex: 0 = Schwarz, 1 = Weiß (fest), ab 2 = Einträge der Farbtabelle
  const colors: string[] = []
  const ct = root.getElementsByTagName('colortable')[0]
  if (ct)
    for (const c of Array.from(ct.getElementsByTagName('color'))) {
      const h = (v: string | null) => Math.round(Math.min(1, Math.max(0, num(v))) * 255).toString(16).padStart(2, '0')
      colors.push('#' + h(c.getAttribute('r')) + h(c.getAttribute('g')) + h(c.getAttribute('b')))
    }
  const colorOf = (el: Element): string | undefined => {
    const v = el.getAttribute('color')
    if (v === null) return undefined
    const i = Math.round(num(v, 0))
    if (i <= 1) return undefined
    const c = colors[i - 2]
    // Schwarz ist die Standardfarbe
    return c && c !== '#000000' ? c : undefined
  }
  const fonts = new Map<string, string>()
  for (const f of Array.from(root.getElementsByTagName('font'))) {
    const id = f.getAttribute('id')
    const name = f.getAttribute('name')
    if (id && name) fonts.set(id, name)
  }
  const knownFont = (id: string | null) => {
    const n = id ? fonts.get(id) : undefined
    return n && FONTS.some((f) => f.name === n) ? n : undefined
  }

  // ---------- Maßstab: mittlere Bindungslänge der Datei → OpenMol-Bindungslänge ----------
  const pageEls = Array.from(root.getElementsByTagName('page'))
  const containers = pageEls.length ? pageEls : [root]
  /** Kinder einer Seite/Gruppe (ohne Atom-Beschriftungen und Inhalte von Kürzeln) */
  const topLevel: Element[] = []
  const collect = (el: Element) => {
    for (const c of Array.from(el.children)) {
      if (c.tagName === 'group' || c.tagName === 'altgroup') collect(c)
      else topLevel.push(c)
    }
  }
  containers.forEach(collect)

  const frags = topLevel.filter((e) => e.tagName === 'fragment')
  const nodePos = new Map<string, P>()
  const lens: number[] = []
  for (const f of frags) {
    for (const n of Array.from(f.children).filter((c) => c.tagName === 'n')) {
      const p = nums(n.getAttribute('p'))
      if (p.length >= 2 && n.getAttribute('id')) nodePos.set(n.getAttribute('id')!, { x: p[0], y: p[1] })
    }
    for (const b of Array.from(f.children).filter((c) => c.tagName === 'b')) {
      const a = nodePos.get(b.getAttribute('B') ?? '')
      const e = nodePos.get(b.getAttribute('E') ?? '')
      if (a && e) lens.push(Math.hypot(a.x - e.x, a.y - e.y))
    }
  }
  lens.sort((a, b) => a - b)
  const fileBond = lens.length ? lens[Math.floor(lens.length / 2)] : num(root.getAttribute('BondLength'), 14.4)
  const k = L / (fileBond > 0.5 ? fileBond : 14.4)
  const T = (p: P): P => ({ x: p.x * k, y: p.y * k })

  // ---------- Texte (Rich-Text aus <s>-Abschnitten) ----------
  const runsHtml = (t: Element): { html: string; size: number; bold: boolean; font?: string; color?: string } => {
    let size = 0
    let font: string | undefined
    let html = ''
    const ss = Array.from(t.getElementsByTagName('s'))
    for (const s of ss) {
      let txt = esc((s.textContent ?? '').replace(/\r\n?/g, '\n'))
      const face = Math.round(num(s.getAttribute('face'), 0))
      const sz = num(s.getAttribute('size'), 10)
      // hoch-/tiefgestellte Abschnitte tragen in CDXML die volle Schriftgröße
      size = Math.max(size, sz)
      font ??= knownFont(s.getAttribute('font'))
      // Face-Bits: 1 fett, 2 kursiv, 4 unterstrichen, 32 tief, 64 hoch, 96 = Summenformel (Ziffern tief)
      if ((face & 96) === 96) txt = `<span class="formula">${txt}</span>`
      else if (face & 32) txt = `<sub>${txt}</sub>`
      else if (face & 64) txt = `<sup>${txt}</sup>`
      if (face & 4) txt = `<u>${txt}</u>`
      if (face & 2) txt = `<i>${txt}</i>`
      if (face & 1) txt = `<b>${txt}</b>`
      const c = colorOf(s)
      if (c) txt = `<font color="${c}">${txt}</font>`
      html += txt
    }
    if (!ss.length) html = esc(t.textContent ?? '')
    const allBold = ss.length > 0 && ss.every((s) => Math.round(num(s.getAttribute('face'), 0)) & 1)
    return { html, size: size || 10, bold: allBold, font, color: colorOf(t) }
  }
  const plainOf = (t: Element) => Array.from(t.getElementsByTagName('s')).map((s) => s.textContent ?? '').join('') || (t.textContent ?? '')

  // ---------- Moleküle ----------
  const atomOf = new Map<string, string>() // CDXML-Knoten-Id → OpenMol-Atom-Id
  const ringLabels: Element[] = []
  for (const f of frags) {
    // einzelnes Atom ohne Bindung, ausdrücklich ohne H und nur mit seinem Symbol beschriftet (z. B. Ringbuchstaben
    // „B“, „C“ in Naturstoffen): in ChemDraw ein Text – als Atom würde OpenMol BH3/CH4 daraus machen
    const nodes = Array.from(f.children).filter((c) => c.tagName === 'n')
    if (nodes.length === 1 && !Array.from(f.children).some((c) => c.tagName === 'b')) {
      const n = nodes[0]
      const lt = Array.from(n.children).find((x) => x.tagName === 't')
      const z = Math.round(num(n.getAttribute('Element'), 6))
      if (lt && n.getAttribute('NumHydrogens') === '0' && !n.getAttribute('NodeType') && !n.getAttribute('Charge') && plainOf(lt).trim() === SYMBOLS[z - 1] && (z === 5 || z === 6 || z === 7 || z === 8 || z === 15 || z === 16)) {
        ringLabels.push(lt)
        continue
      }
    }
    for (const n of Array.from(f.children).filter((c) => c.tagName === 'n')) {
      const nid = n.getAttribute('id')
      const p0 = nid ? nodePos.get(nid) : undefined
      if (!nid || !p0) continue
      const p = T(p0)
      const type = n.getAttribute('NodeType') ?? 'Element'
      const z = Math.round(num(n.getAttribute('Element'), 6))
      const a: Atom = { id: uid('a'), x: p.x, y: p.y, element: SYMBOLS[z - 1] ?? 'C', charge: Math.round(num(n.getAttribute('Charge'), 0)), radical: 0, lonePairs: 0 }
      const iso = Math.round(num(n.getAttribute('Isotope'), 0))
      if (iso) a.isotope = iso
      const rad = n.getAttribute('Radical')
      if (rad === 'Doublet') a.radical = 1
      else if (rad === 'Triplet' || rad === 'Singlet') a.radical = 2
      const c = colorOf(n)
      if (c) a.color = c
      // Beschriftung des Knotens (direktes <t>-Kind, nicht die Inhalte eines Kürzels)
      const lt = Array.from(n.children).find((x) => x.tagName === 't')
      const ltext = lt ? plainOf(lt).trim() : ''
      if (type === 'ExternalConnectionPoint') {
        a.attach = true
      } else if (type === 'Nickname' || type === 'Fragment' || type === 'GenericNickname' || type === 'ElementList' || type === 'Unspecified' || type === 'Variable' || type === 'AnonymousAlternativeGroup' || type === 'MultiAttachment') {
        const raw = ltext || n.getAttribute('GenericNickname') || (type === 'ElementList' ? 'X' : 'R')
        // bekannte Kürzel einheitlich schreiben (MeO → OMe), damit „Kürzel auflösen“ sie kennt
        a.label = canonicalAbbrev(raw) ?? raw
        a.element = 'C'
        a.charge = 0
      } else if (a.element === 'C' && ltext) {
        // ausdrücklich beschrifteter Kohlenstoff (CH3, CH2 …)
        a.showC = true
      }
      doc.atoms[a.id] = a
      atomOf.set(nid, a.id)
    }
    for (const b of Array.from(f.children).filter((c) => c.tagName === 'b')) {
      let a1 = atomOf.get(b.getAttribute('B') ?? '')
      let a2 = atomOf.get(b.getAttribute('E') ?? '')
      if (!a1 || !a2 || a1 === a2) continue
      const order = b.getAttribute('Order') ?? '1'
      const disp = b.getAttribute('Display') ?? ''
      let type: BondType = 'single'
      if (order === '2') type = b.getAttribute('Display2') === 'Dash' || disp === 'Dash' ? 'aromatic' : 'double'
      else if (order === '3') type = 'triple'
      else if (order === '1.5') type = 'aromatic'
      else if (/^Wedge(Begin|End)$/.test(disp)) type = 'wedge'
      else if (/^WedgedHash(Begin|End)$|^Hash$/.test(disp)) type = 'hash'
      else if (disp === 'Wavy') type = 'wavy'
      else if (disp === 'Bold') type = 'bold'
      else if (disp === 'Dash') type = 'dashed'
      // Keil „End“: spitzes Ende am zweiten Atom → umdrehen
      if (/End$/.test(disp)) [a1, a2] = [a2, a1]
      const dp = b.getAttribute('DoublePosition')
      const doublePos: DoublePos = dp === 'Center' ? 'center' : dp === 'Left' ? 'left' : dp === 'Right' ? 'right' : 'auto'
      const bond: Bond = { id: uid('b'), a1, a2, type, doublePos }
      const c = colorOf(b)
      if (c) bond.color = c
      doc.bonds[bond.id] = bond
    }
  }

  // ---------- übrige Objekte ----------
  const box = (el: Element): { x1: number; y1: number; x2: number; y2: number } | null => {
    const v = nums(el.getAttribute('BoundingBox'))
    if (v.length < 4) return null
    const a = T({ x: v[0], y: v[1] })
    const b = T({ x: v[2], y: v[3] })
    return { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) }
  }
  const pt3 = (v: string | null) => {
    const a = nums(v)
    return a.length >= 2 ? T({ x: a[0], y: a[1] }) : null
  }
  const addArrow = (tail: P, head: P, kind: ArrowKind, heads: Arrow['heads'], color?: string) => {
    const ar: Arrow = { id: uid('ar'), kind, x1: tail.x, y1: tail.y, x2: head.x, y2: head.y, above: '', below: '' }
    if (heads && heads !== 'end') ar.heads = heads
    if (color) ar.color = color
    doc.arrows[ar.id] = ar
  }
  const lonePairAt = (p: P, kind: 'lp' | 'rad') => {
    let best: Atom | null = null
    let bd = L * 0.8
    for (const a of Object.values(doc.atoms)) {
      const d = Math.hypot(a.x - p.x, a.y - p.y)
      if (d < bd) {
        bd = d
        best = a
      }
    }
    if (!best) return skip(kind === 'lp' ? 'Elektronenpaar' : 'Radikalpunkt')
    if (kind === 'lp') best.lonePairs++
    else best.radical = Math.min(2, best.radical + 1)
  }

  for (const el of [...ringLabels, ...topLevel]) {
    const tag = el.tagName
    if (tag === 'fragment') continue
    if (tag === 't') {
      const pv = nums(el.getAttribute('p'))
      const bb = box(el)
      if (pv.length < 2 && !bb) continue
      const r = runsHtml(el)
      if (!plainOf(el).trim()) continue
      const just = el.getAttribute('Justification') ?? el.getAttribute('CaptionJustification') ?? 'Left'
      const align: TextObj['align'] = just === 'Center' ? 'center' : just === 'Right' ? 'right' : 'left'
      const size = Math.max(4, r.size * k)
      const p = pv.length >= 2 ? T({ x: pv[0], y: pv[1] }) : { x: bb!.x1, y: bb!.y2 }
      const t: TextObj = { id: uid('t'), x: p.x, y: p.y - size * 0.35, text: r.html, size: Math.round(size * 10) / 10, align }
      if (r.bold) {
        t.bold = true
        t.text = t.text.replace(/<\/?b>/g, '')
      }
      if (r.font) t.font = r.font
      if (r.color) t.color = r.color
      doc.texts[t.id] = t
      continue
    }
    if (tag === 'arrow') {
      if (el.getAttribute('SupersededBy')) continue
      const head = pt3(el.getAttribute('Head3D'))
      const tail = pt3(el.getAttribute('Tail3D'))
      const bb = box(el)
      const h = head ?? (bb ? { x: bb.x2, y: (bb.y1 + bb.y2) / 2 } : null)
      const t = tail ?? (bb ? { x: bb.x1, y: (bb.y1 + bb.y2) / 2 } : null)
      if (!h || !t) continue
      const hh = el.getAttribute('ArrowheadHead')
      const ht = el.getAttribute('ArrowheadTail')
      const half = (v: string | null) => !!v && /^Half/.test(v)
      let kind: ArrowKind = 'reaction'
      if (half(hh) && half(ht)) kind = 'equilibrium'
      else if (el.getAttribute('ArrowheadType') === 'Angle' && el.getAttribute('ArrowShaftSpacing')) kind = 'retro'
      else if (el.getAttribute('NoGo')) kind = 'failed'
      else if (el.getAttribute('LineType') === 'Dashed') kind = 'dashed'
      const angular = num(el.getAttribute('AngularSize'), 0)
      if (Math.abs(angular) > 1) {
        // gebogener Pfeil (Kreisbogen) → Elektronenpfeil-Form mit passender Krümmung
        const ca: CurvedArrow = { id: uid('c'), head: half(hh) ? 'half' : 'full', from: { type: 'point', ...t }, to: { type: 'point', ...h }, bend: Math.sign(angular) * Math.tan((Math.abs(angular) * Math.PI) / 720) }
        doc.curved[ca.id] = ca
        continue
      }
      const heads: Arrow['heads'] = kind === 'equilibrium' || kind === 'retro' ? 'end' : hh && ht ? 'both' : hh ? 'end' : ht ? 'start' : 'none'
      addArrow(t, h, kind, heads, colorOf(el))
      continue
    }
    if (tag === 'graphic') {
      if (el.getAttribute('SupersededBy')) continue
      const gt = el.getAttribute('GraphicType')
      const bb = box(el)
      if (!bb) continue
      if (gt === 'Line') {
        // ältere Pfeile: Linie mit Pfeiltyp; BoundingBox = Spitze → Ende
        const v = nums(el.getAttribute('BoundingBox'))
        const head = T({ x: v[0], y: v[1] })
        const tail = T({ x: v[2], y: v[3] })
        const at = el.getAttribute('ArrowType') ?? ''
        const kind: ArrowKind = /Equilibrium/.test(at) ? 'equilibrium' : /RetroSynthetic/.test(at) ? 'retro' : /Resonance/.test(at) ? 'resonance' : 'reaction'
        const heads: Arrow['heads'] = !at || at === 'NoHead' ? 'none' : /Resonance/.test(at) ? 'both' : 'end'
        addArrow(tail, head, kind, kind === 'resonance' ? undefined : heads, colorOf(el))
        if (el.getAttribute('LineType') === 'Dashed' && heads !== 'none') {
          const last = Object.values(doc.arrows).pop()!
          last.kind = 'dashed'
        }
        continue
      }
      if (gt === 'Rectangle' || gt === 'Oval') {
        const rt = (el.getAttribute('RectangleType') ?? el.getAttribute('OvalType') ?? '').split(/\s+/)
        let b = bb
        if (gt === 'Oval') {
          // Ovale: Mittelpunkt und Achsen (BoundingBox fehlt bei manchen Dateien oder ist zu groß)
          const c = pt3(el.getAttribute('Center3D'))
          const ma = pt3(el.getAttribute('MajorAxisEnd3D'))
          const mi = pt3(el.getAttribute('MinorAxisEnd3D'))
          if (c && ma && mi) {
            const rx = Math.hypot(ma.x - c.x, ma.y - c.y)
            const ry = Math.hypot(mi.x - c.x, mi.y - c.y)
            b = { x1: c.x - rx, y1: c.y - ry, x2: c.x + rx, y2: c.y + ry }
          }
        }
        const s: Shape = { id: uid('s'), kind: gt === 'Oval' ? (rt.includes('Shaded') ? 'sphere' : 'ellipse') : rt.includes('RoundEdge') ? 'roundrect' : 'rect', ...b }
        if (rt.includes('Dashed')) s.dashed = true
        if (rt.includes('Shadow')) s.shadow = true
        const c = colorOf(el)
        if (c) s.color = c
        if (rt.includes('Filled')) s.fill = c ?? '#000000'
        doc.shapes[s.id] = s
        continue
      }
      if (gt === 'Bracket') {
        const bt = el.getAttribute('BracketType') ?? ''
        const kind = /^Square/.test(bt) ? 'brackets' : /^Round/.test(bt) ? 'parens' : /^Curly/.test(bt) ? 'braces' : null
        // OpenMol kennt nur Klammerpaare; einzelne Klammern (…Bracket ohne „Pair“) werden nicht übernommen
        if (!kind || !/Pair$/.test(bt)) {
          skip('einzelne Klammer')
          continue
        }
        const s: Shape = { id: uid('s'), kind, ...bb }
        const c = colorOf(el)
        if (c) s.color = c
        doc.shapes[s.id] = s
        continue
      }
      if (gt === 'Symbol') {
        const st = el.getAttribute('SymbolType') ?? ''
        // Ladungssymbole gehören zu Atomen mit Charge-Angabe (schon übernommen)
        if (st === 'LonePair') lonePairAt({ x: (bb.x1 + bb.x2) / 2, y: (bb.y1 + bb.y2) / 2 }, 'lp')
        else if (st === 'Electron') lonePairAt({ x: (bb.x1 + bb.x2) / 2, y: (bb.y1 + bb.y2) / 2 }, 'rad')
        else if (!/Plus|Minus/.test(st)) skip('Symbol')
        continue
      }
      skip(gt === 'Orbital' ? 'Orbital' : gt === 'Arc' ? 'Bogen' : 'Grafik')
      continue
    }
    if (tag === 'curve') {
      const v = nums(el.getAttribute('CurvePoints'))
      const pts: P[] = []
      for (let i = 0; i + 1 < v.length; i += 2) pts.push(T({ x: v[i], y: v[i + 1] }))
      const hh = el.getAttribute('ArrowheadHead')
      const ht = el.getAttribute('ArrowheadTail')
      if (pts.length < 4 || (!hh && !ht)) {
        skip('Kurve ohne Pfeilspitze')
        continue
      }
      // Punkte als Dreiergruppen (Kontrollpunkt, Ankerpunkt, Kontrollpunkt); die Enden sind die Ankerpunkte
      const tri = pts.length % 3 === 0
      let s = tri ? pts[1] : pts[0]
      let e = tri ? pts[pts.length - 2] : pts[pts.length - 1]
      // Krümmung: weitester Abstand der Kurve von der Sehne (Bezier-Segmente abgetastet)
      const seq = tri ? pts.slice(1, -1) : pts
      let far = 0
      const d = Math.max(1, Math.hypot(e.x - s.x, e.y - s.y))
      const nx = (e.y - s.y) / d
      const ny = -(e.x - s.x) / d
      for (let i = 0; i + 3 < seq.length; i += 3) {
        for (const u of [0.25, 0.5, 0.75]) {
          const w = [(1 - u) ** 3, 3 * u * (1 - u) ** 2, 3 * u * u * (1 - u), u ** 3]
          const q = { x: w[0] * seq[i].x + w[1] * seq[i + 1].x + w[2] * seq[i + 2].x + w[3] * seq[i + 3].x, y: w[0] * seq[i].y + w[1] * seq[i + 1].y + w[2] * seq[i + 2].y + w[3] * seq[i + 3].y }
          const off = (q.x - s.x) * nx + (q.y - s.y) * ny
          if (Math.abs(off) > Math.abs(far)) far = off
        }
      }
      // Spitze nur am Anfang: Richtung umdrehen
      let bend = (2 * far) / d
      if (!hh && ht) {
        ;[s, e] = [e, s]
        bend = -bend
      }
      const head = (hh ?? ht ?? '').startsWith('Half') ? 'half' : 'full'
      const ca: CurvedArrow = { id: uid('c'), head, from: { type: 'point', ...s }, to: { type: 'point', ...e }, bend: Math.abs(bend) < 0.05 ? 0.05 * (Math.sign(bend) || 1) : bend }
      const c = colorOf(el)
      if (c) ca.color = c
      doc.curved[ca.id] = ca
      if (hh && ht) skip('Doppelspitze an gebogenem Pfeil (nur eine übernommen)')
      continue
    }
    // Hilfsdaten ohne eigene Darstellung
    if (['scheme', 'step', 'annotation', 'objecttag', 'chemicalproperty', 'represent', 'bracketedgroup', 'bracketattachment', 'crossingbond', 'border', 'stoichiometrygrid', 'regnum'].includes(tag)) continue
    const names: Record<string, string> = { embeddedobject: 'Bild', spectrum: 'Spektrum', tlcplate: 'DC-Platte', table: 'Tabelle', geometry: 'Geometrie', constraint: 'Bemaßung', splitter: 'Trennlinie', chemicalstructure: 'Struktur (Sonderform)' }
    skip(names[tag] ?? tag)
  }

  attachArrowTexts(doc)
  moveToOrigin(doc)
  const list = [...skipped].map(([w, n]) => (n > 1 ? `${n}× ${w}` : w))
  return { doc: normalizeDoc(doc), skipped: list }
}

/**
 * Texte direkt über bzw. unter einem waagerechten Reaktionspfeil werden zu dessen Bedingungen (wie in OpenMol
 * gezeichnet) – so wandern sie bei „Reaktion aufräumen“ und beim Verschieben mit.
 */
function attachArrowTexts(doc: Doc) {
  const L = doc.style.bondLength
  for (const ar of Object.values(doc.arrows)) {
    if (Math.abs(ar.y2 - ar.y1) > Math.abs(ar.x2 - ar.x1) * 0.2) continue
    const x1 = Math.min(ar.x1, ar.x2) - L * 0.4
    const x2 = Math.max(ar.x1, ar.x2) + L * 0.4
    const y = (ar.y1 + ar.y2) / 2
    const above: TextObj[] = []
    const below: TextObj[] = []
    for (const t of Object.values(doc.texts)) {
      if (t.text.trim() === '+') continue
      const lines = t.text.split('\n').length
      const w = t.text.replace(/<[^>]+>/g, '').length * t.size * 0.5
      const cx = t.align === 'center' ? t.x : t.align === 'right' ? t.x - w / 2 : t.x + w / 2
      if (cx < x1 || cx > x2) continue
      const top = t.y - t.size * 0.6
      const bottom = t.y + t.size * (0.4 + 1.2 * (lines - 1))
      if (bottom < y && y - bottom < L * 1.6) above.push(t)
      else if (top > y && top - y < L * 1.6) below.push(t)
    }
    const join = (ts: TextObj[]) =>
      ts
        .sort((a, b) => a.y - b.y)
        .map((t) => (t.bold ? `<b>${t.text}</b>` : t.text))
        .join('\n')
    // fette Prozentangabe als letzte Zeile unter dem Pfeil = Ausbeute
    below.sort((a, b) => a.y - b.y)
    const last = below[below.length - 1]
    const yieldM = last ? /^\s*(?:<b>)?\s*(\d+(?:[.,]\d+)?)\s*%\s*(?:<\/b>)?\s*$/.exec(last.text) : null
    if (last && yieldM && (last.bold || /<b>/.test(last.text))) {
      ar.yieldText = yieldM[1]
      delete doc.texts[last.id]
      below.pop()
    }
    if (above.length) ar.above = join(above)
    if (below.length) ar.below = join(below)
    for (const t of [...above, ...below]) delete doc.texts[t.id]
  }
}

/** Inhalt in die Nähe des Ursprungs verschieben (ChemDraw-Seiten beginnen oft weit rechts/unten) */
function moveToOrigin(doc: Doc) {
  const pts: P[] = []
  for (const a of Object.values(doc.atoms)) pts.push(a)
  for (const t of Object.values(doc.texts)) pts.push(t)
  for (const a of Object.values(doc.arrows)) pts.push({ x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 })
  for (const s of Object.values(doc.shapes)) pts.push({ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 })
  for (const c of Object.values(doc.curved)) for (const a of [c.from, c.to]) if (a.type === 'point') pts.push(a)
  if (!pts.length) return
  const dx = -Math.min(...pts.map((p) => p.x))
  const dy = -Math.min(...pts.map((p) => p.y))
  const move = (o: P) => {
    o.x += dx
    o.y += dy
  }
  for (const a of Object.values(doc.atoms)) move(a)
  for (const t of Object.values(doc.texts)) move(t)
  for (const a of Object.values(doc.arrows)) {
    a.x1 += dx
    a.x2 += dx
    a.y1 += dy
    a.y2 += dy
  }
  for (const s of Object.values(doc.shapes)) {
    s.x1 += dx
    s.x2 += dx
    s.y1 += dy
    s.y2 += dy
  }
  for (const c of Object.values(doc.curved)) for (const a of [c.from, c.to]) if (a.type === 'point') move(a)
}
