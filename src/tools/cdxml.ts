// Export als ChemDraw-Dokument (CDXML).
// Quellen für Element- und Attributnamen: ChemDraw-CDX-Bibliothek (github.com/Glysade/chemdraw,
// CDXObject.cpp/CDXGraphic.cpp/CDXBond.cpp/CDXArrow.cpp), echte ChemDraw-23-Dateien aus den RDKit-
// Testdaten sowie der CDXML-Writer von EPAM Indigo (molecule_cdxml_saver.cpp).
// Koordinaten in Punkt, y nach unten. Bindungslänge 14,4 pt (ACS-Stil).
import { bondValue, fragments, hCount } from '../model/chem'
import { ABBREVIATIONS, canonicalAbbrev } from '../model/abbrev'
import type { AtomDecor } from '../model/annot'
import { tableGeom } from '../model/stoichLayout'
import { arcLabelPos, branchGeom, branchLabelPos, cycleSegments, ePoint, linkGeom, linkLabelPos, stationLabelSize } from '../model/cycle'
import { atomicNumber, implicitHCount } from '../model/elements'
import { arrowPoints, arrowTextBlocks, curvedGeom, getScene, sceneBBox, textLayoutOf } from '../model/scene'
import { chemLabel, layoutRich, type RichLayout } from '../model/richtext'
import type { Doc } from '../model/types'
import { getState, toast } from '../store'
import { saveBlob } from './io'

/** Label-Text in Leserichtung (Token sind nach Platzierung sortiert, nicht nach x) */
function labelOf(d: AtomDecor | undefined): string {
  if (!d?.label) return ''
  return [...d.label.tokens]
    .filter((t) => Math.abs(t.dy) < 0.6)
    .sort((a, b) => a.x - b.x)
    .map((t) => t.t)
    .join('')
}

/** Label, das genau einem schweren Atom entspricht (CH3, H3C, NH2, OH, SH …) */
function singleAtomLabel(label: string): string | null {
  const key = canonicalAbbrev(label)
  const smi = key ? ABBREVIATIONS[key].smiles : null
  if (smi && /^[A-Z][a-z]?$/.test(smi)) return smi
  return null
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const f2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2)

export function buildCdxml(doc: Doc, title = 'OpenMol'): string {
  const scene = getScene(doc)
  const box = sceneBBox(scene)
  const k = 14.4 / doc.style.bondLength
  const ox = box ? 36 - box.x1 * k : 36
  const oy = box ? 36 - box.y1 * k : 36
  const X = (x: number) => f2(x * k + ox)
  const Y = (y: number) => f2(y * k + oy)
  let nextId = 100
  const nid = () => nextId++

  // Farben: Einträge 0/1 (schwarz/weiß) sind implizit; geschriebene Einträge beginnen bei Index 2
  const colors: string[] = ['#ffffff', '#000000']
  const colorIdx = (c?: string): number | null => {
    if (!c) return null
    const hex = c.toLowerCase()
    if (hex === '#111418' || hex === '#000000') return null
    let i = colors.indexOf(hex)
    if (i < 0) {
      colors.push(hex)
      i = colors.length - 1
    }
    return i + 2
  }
  const fonts: string[] = []
  const fontId = (name: string) => {
    let i = fonts.indexOf(name)
    if (i < 0) {
      fonts.push(name)
      i = fonts.length - 1
    }
    return i + 3
  }
  const colorAttr = (c?: string) => {
    const i = colorIdx(c)
    return i === null ? '' : ` color="${i}"`
  }

  const body: string[] = []
  const docFont = doc.style.font || 'Arial'
  const labelSize = doc.style.fontSize * k

  // ---------- Text (eine <t> pro Zeile, linksbündig an exakter Position) ----------
  const textLines = (lay: RichLayout, x: number, yBase: number, align: 'left' | 'center' | 'right', color?: string, fallbackFont = docFont) => {
    lay.lines.forEach((ln) => {
      if (!ln.toks.length) return
      const x0 = align === 'center' ? x - ln.w / 2 : align === 'right' ? x - ln.w : x
      const y = yBase + ln.y
      const em = Math.max(lay.lineH / 1.25, ...ln.toks.map((t) => (t.dy !== 0 ? t.size / 0.7 : t.size)))
      const runs = ln.toks
        .map((t) => {
          let face = 0
          if (t.b) face |= 1
          if (t.i) face |= 2
          if (t.u) face |= 4
          if (t.dy > 0.01) face |= 32
          if (t.dy < -0.01) face |= 64
          const fname = t.font.split(',')[0].replace(/["']/g, '').trim() || fallbackFont
          const size = (t.dy !== 0 ? t.size / 0.7 : t.size) * k
          return `<s font="${fontId(fname)}" size="${f2(size)}" face="${face}"${colorAttr(t.color ?? color)}>${esc(t.t)}</s>`
        })
        .join('')
      body.push(
        `<t id="${nid()}" p="${X(x0)} ${Y(y)}" BoundingBox="${X(x0)} ${Y(y - em)} ${X(x0 + ln.w)} ${Y(y + em * 0.25)}" Justification="Left" InterpretChemically="no">${runs}</t>`,
      )
    })
  }

  // ---------- Moleküle ----------
  const atomNode = new Map<string, number>()
  // ein <fragment> je Molekül (wie ChemDraw) – sonst gelten alle Moleküle dort als ein Objekt
  const fragOf = new Map<string, number>()
  fragments(doc, scene.g).forEach((f, i) => f.forEach((id) => fragOf.set(id, i)))
  const frags: string[][] = []
  const fragPush = (atomId: string, xml: string) => (frags[fragOf.get(atomId) ?? 0] ??= []).push(xml)
  for (const a of Object.values(doc.atoms)) {
    const id = nid()
    atomNode.set(a.id, id)
    const d = scene.decor.get(a.id)
    const attrs: string[] = [`id="${id}"`, `p="${X(a.x)} ${Y(a.y)}"`]
    let labelText = ''
    if (a.attach) {
      attrs.push('NodeType="ExternalConnectionPoint"')
    } else if (a.label && singleAtomLabel(chemLabel(a.label))) {
      // CH3, NH2, OH … → echtes Atom mit Wasserstoffzahl
      const el = singleAtomLabel(chemLabel(a.label))!
      const z = atomicNumber(el)
      if (z !== 6) attrs.push(`Element="${z}"`)
      attrs.push(`NumHydrogens="${implicitHCount(el, Math.round((scene.g.adj.get(a.id) ?? []).reduce((s, nb) => s + bondValue(nb.bond.type), 0)), a.charge, a.radical)}"`)
      labelText = labelOf(d)
    } else if (a.label) {
      attrs.push('NodeType="GenericNickname"', `GenericNickname="${esc(chemLabel(a.label))}"`)
      labelText = labelOf(d) || chemLabel(a.label)
    } else {
      const z = atomicNumber(a.element)
      if (z !== 6) attrs.push(`Element="${z}"`)
      if (d?.label) {
        const h = hCount(scene.g, a)
        attrs.push(`NumHydrogens="${h}"`)
        labelText = labelOf(d)
      }
      if (a.isotope) attrs.push(`Isotope="${a.isotope}"`)
    }
    if (a.charge) attrs.push(`Charge="${a.charge}"`)
    const ci = colorIdx(a.color)
    if (ci !== null) attrs.push(`color="${ci}"`)
    let inner = ''
    if (labelText && d?.label) {
      const left = Math.min(...d.label.tokens.map((t) => t.x))
      const right = Math.max(...d.label.tokens.map((t) => t.x + t.w))
      const hLeft = d.label.left < -d.label.hw - 1
      const base = a.y + doc.style.fontSize * 0.358
      inner = `<t p="${X(a.x + left)} ${Y(base)}" BoundingBox="${X(a.x + left)} ${Y(a.y + d.label.top)} ${X(a.x + right)} ${Y(a.y + d.label.bottom)}" LabelJustification="${hLeft ? 'Right' : 'Left'}"><s font="${fontId(docFont)}" size="${f2(labelSize)}" face="${96 | (a.bold ? 1 : 0) | (a.italic ? 2 : 0)}"${colorAttr(a.color)}>${esc(labelText)}</s></t>`
    }
    fragPush(a.id, `<n ${attrs.join(' ')}${inner ? `>${inner}</n>` : '/>'}`)
  }
  for (const b of Object.values(doc.bonds)) {
    const attrs = [`id="${nid()}"`, `B="${atomNode.get(b.a1)}"`, `E="${atomNode.get(b.a2)}"`]
    if (b.type === 'double') attrs.push('Order="2"')
    if (b.type === 'triple') attrs.push('Order="3"')
    if (b.type === 'aromatic') attrs.push('Order="1.5"')
    const disp: Record<string, string> = { wedge: 'WedgeBegin', hash: 'WedgedHashBegin', wavy: 'Wavy', bold: 'Bold', dashed: 'Dash' }
    if (disp[b.type]) attrs.push(`Display="${disp[b.type]}"`)
    if (b.type === 'double' && b.doublePos !== 'auto') attrs.push(`DoublePosition="${{ center: 'Center', left: 'Left', right: 'Right' }[b.doublePos]}"`)
    const ci = colorIdx(b.color)
    if (ci !== null) attrs.push(`color="${ci}"`)
    fragPush(b.a1, `<b ${attrs.join(' ')}/>`)
  }
  for (const f of frags) if (f?.length) body.push(`<fragment id="${nid()}">${f.join('')}</fragment>`)

  // Ladungs-, Elektronenpaar- und Radikalsymbole (wie von ChemDraw als Grafiken dargestellt)
  const symbol = (type: string, x: number, y: number, color?: string) => {
    const h = doc.style.fontSize * 0.22
    body.push(`<graphic id="${nid()}" BoundingBox="${X(x)} ${Y(y - h)} ${X(x)} ${Y(y + h)}" GraphicType="Symbol" SymbolType="${type}"${colorAttr(color)}/>`)
  }
  for (const a of Object.values(doc.atoms)) {
    const d = scene.decor.get(a.id)
    if (!d) continue
    if (a.charge && d.charge && Math.abs(a.charge) === 1) {
      const circ = doc.style.chargeCircle
      symbol(a.charge > 0 ? (circ ? 'CirclePlus' : 'Plus') : circ ? 'CircleMinus' : 'Minus', d.charge.x, d.charge.y, a.color)
    }
    for (const lp of d.lonePairs) symbol('LonePair', lp.c.x, lp.c.y, a.color)
    for (const r of d.radicals) symbol('Electron', r.c.x, r.c.y, a.color)
    if (a.partial && d.partial) {
      textLines(layoutRich(a.partial === '+' ? 'δ+' : 'δ−', { size: doc.style.fontSize * 0.68, font: docFont, italic: true, chem: false }), d.partial.x - doc.style.fontSize * 0.3, d.partial.y + doc.style.fontSize * 0.25, 'left', a.color)
    }
  }

  // ---------- Reaktionspfeile ----------
  for (const ar of Object.values(doc.arrows)) {
    const pts = arrowPoints(ar)
    const heads = ar.heads ?? (ar.kind === 'resonance' ? 'both' : 'end')
    // Vorsegmente gewinkelter Pfeile als Linien
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      body.push(`<graphic id="${nid()}" BoundingBox="${X(b.x)} ${Y(b.y)} ${X(a.x)} ${Y(a.y)}" GraphicType="Line"${ar.kind === 'dashed' ? ' LineType="Dashed"' : ''}${colorAttr(ar.color)}/>`)
    }
    const tail = pts[pts.length - 2]
    const head = pts[pts.length - 1]
    const at: string[] = [`id="${nid()}"`, `BoundingBox="${X(head.x)} ${Y(head.y)} ${X(tail.x)} ${Y(tail.y)}"`, 'FillType="None"']
    const straight = pts.length === 2
    if (straight && ar.kind === 'retro') {
      at.push('ArrowheadHead="Full"', 'ArrowheadType="Angle"', 'HeadSize="600"', 'ArrowheadCenterSize="600"', 'ArrowheadWidth="150"', 'ArrowShaftSpacing="600"')
    } else if (straight && ar.kind === 'equilibrium') {
      at.push('ArrowheadHead="HalfLeft"', 'ArrowheadTail="HalfLeft"', 'ArrowheadType="Solid"', 'HeadSize="2250"', 'ArrowheadCenterSize="1125"', 'ArrowheadWidth="563"', 'ArrowShaftSpacing="300"')
    } else {
      at.push('ArrowheadType="Solid"', 'HeadSize="2250"', 'ArrowheadCenterSize="1125"', 'ArrowheadWidth="563"')
      if (heads === 'end' || heads === 'both') at.push('ArrowheadHead="Full"')
      if (heads === 'start' || heads === 'both') at.push('ArrowheadTail="Full"')
      if (ar.kind === 'dashed') at.push('LineType="Dashed"')
      if (ar.kind === 'failed') at.push('NoGo="Cross"')
    }
    at.push(`Head3D="${X(head.x)} ${Y(head.y)} 0"`, `Tail3D="${X(tail.x)} ${Y(tail.y)} 0"`)
    const ci = colorIdx(ar.color)
    if (ci !== null) at.push(`color="${ci}"`)
    if (heads === 'none') body.push(`<graphic id="${nid()}" BoundingBox="${X(head.x)} ${Y(head.y)} ${X(tail.x)} ${Y(tail.y)}" GraphicType="Line"${colorAttr(ar.color)}/>`)
    else body.push(`<arrow ${at.join(' ')}/>`)
    for (const tb of arrowTextBlocks(doc, ar)) textLines(tb.lay, tb.x, tb.y, tb.align, ar.color)
  }

  // ---------- Elektronenfluss-Pfeile (Bézier-Kurven mit Spitze) ----------
  for (const ca of Object.values(doc.curved)) {
    const g = curvedGeom(scene, ca)
    if (!g) continue
    const c1 = { x: g.p0.x + (2 / 3) * (g.c.x - g.p0.x), y: g.p0.y + (2 / 3) * (g.c.y - g.p0.y) }
    const c2 = { x: g.p1.x + (2 / 3) * (g.c.x - g.p1.x), y: g.p1.y + (2 / 3) * (g.c.y - g.p1.y) }
    const P = (p: { x: number; y: number }) => `${X(p.x)} ${Y(p.y)}`
    // Ankerpunkte jeweils mit Kontrollpunkten davor/danach
    const pts = [g.p0, g.p0, c1, c2, g.p1, g.p1].map(P).join(' ')
    const headKind = ca.head === 'full' ? 'Full' : 'HalfLeft'
    body.push(
      `<curve id="${nid()}" CurvePoints="${pts}" ArrowheadHead="${headKind}" ArrowheadType="Solid" HeadSize="2250" ArrowheadCenterSize="1125" ArrowheadWidth="563"${colorAttr(ca.color)}/>`,
    )
  }

  // ---------- Katalysezyklen: Bögen als Bézier-Kurven, Zu-/Abflüsse, Verbindungen und Beschriftungen ----------
  const P = (p: { x: number; y: number }) => `${X(p.x)} ${Y(p.y)}`
  for (const c of Object.values(doc.cycles ?? {})) {
    const lineAttrs = (head: boolean) =>
      (head ? ' ArrowheadHead="Full" ArrowheadType="Solid" HeadSize="2250" ArrowheadCenterSize="1125" ArrowheadWidth="563"' : '') +
      (c.dashed ? ' LineType="Dashed"' : '') +
      colorAttr(c.color)
    // Ellipsenbogen (Parameterwinkel in Grad) in Stücke ≤ 30° zerlegen; je Ankerpunkt: Kontrolle davor, Punkt, Kontrolle danach
    const arcPts = (a0: number, a1: number) => {
      const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 30))
      const d = ((a1 - a0) / n) * (Math.PI / 180)
      const kk = (4 / 3) * Math.tan(d / 4)
      const pt = (t: number) => ({ x: c.cx + c.rx * Math.cos(t), y: c.cy + c.ry * Math.sin(t) })
      const der = (t: number) => ({ x: -c.rx * Math.sin(t), y: c.ry * Math.cos(t) })
      const out: { x: number; y: number }[] = []
      for (let i = 0; i <= n; i++) {
        const t = (a0 * Math.PI) / 180 + i * d
        const p = pt(t)
        const v = der(t)
        out.push(i === 0 ? p : { x: p.x - v.x * kk, y: p.y - v.y * kk }, p, i === n ? p : { x: p.x + v.x * kk, y: p.y + v.y * kk })
      }
      return out
    }
    for (const sg of cycleSegments(doc, c, 0)) {
      body.push(`<curve id="${nid()}" CurvePoints="${arcPts(sg.a0, sg.a1).map(P).join(' ')}"${lineAttrs(c.heads)}/>`)
    }
    const lo = { ...stationLabelSize(doc), bold: c.bold || undefined }
    for (const b of c.branches) {
      const g = branchGeom(c, b)
      const c1 = { x: g.from.x + (2 / 3) * (g.q.x - g.from.x), y: g.from.y + (2 / 3) * (g.q.y - g.from.y) }
      const c2 = { x: g.to.x + (2 / 3) * (g.q.x - g.to.x), y: g.to.y + (2 / 3) * (g.q.y - g.to.y) }
      body.push(`<curve id="${nid()}" CurvePoints="${[g.from, g.from, c1, c2, g.to, g.to].map(P).join(' ')}"${lineAttrs(!!b.head)}/>`)
      if (b.label) {
        const lp = branchLabelPos(doc, c, b)
        textLines(layoutRich(b.label, lo), lp.x, lp.y, lp.align, c.color)
      }
    }
    for (const l of c.links ?? []) {
      const g = linkGeom(doc, c, l)
      if (!g) continue
      body.push(`<curve id="${nid()}" CurvePoints="${[g.p0, g.p0, g.c1, g.c2, g.p3, g.p3].map(P).join(' ')}"${lineAttrs(l.head !== false)}/>`)
      const lp = l.label ? linkLabelPos(doc, c, l) : null
      if (lp) textLines(layoutRich(l.label!, lo), lp.x, lp.y, lp.align, c.color)
    }
    for (const al of c.arcLabels ?? []) {
      if (!al.label) continue
      const lp = arcLabelPos(doc, c, al)
      textLines(layoutRich(al.label, lo), lp.x, lp.y, lp.align, c.color)
    }
    for (const st of c.stations) {
      if (!st.label) continue
      const p = ePoint(c, st.angle)
      const lay = layoutRich(st.label, lo)
      textLines(lay, p.x, p.y + lo.size * 0.35 - lay.lastY / 2, 'center', c.color)
    }
  }

  // ---------- Formen ----------
  for (const s of Object.values(doc.shapes)) {
    const x1 = Math.min(s.x1, s.x2)
    const x2 = Math.max(s.x1, s.x2)
    const y1 = Math.min(s.y1, s.y2)
    const y2 = Math.max(s.y1, s.y2)
    const bb = `BoundingBox="${X(x1)} ${Y(y1)} ${X(x2)} ${Y(y2)}"`
    if (s.kind === 'brackets' || s.kind === 'parens' || s.kind === 'braces') {
      const bt = { brackets: 'SquarePair', parens: 'RoundPair', braces: 'CurlyPair' }[s.kind]
      body.push(`<graphic id="${nid()}" ${bb} GraphicType="Bracket" BracketType="${bt}"${colorAttr(s.color)}/>`)
    } else if (s.kind === 'rect' || s.kind === 'roundrect') {
      // RectangleType-Werte nach CDXML-Spezifikation; Darstellung in ChemDraw nicht getestet
      const rt = [s.kind === 'roundrect' ? 'RoundEdge' : '', s.shadow ? 'Shadow' : '', s.fill ? 'Filled' : '', s.dashed ? 'Dashed' : ''].filter(Boolean).join(' ')
      body.push(`<graphic id="${nid()}" ${bb} GraphicType="Rectangle"${rt ? ` RectangleType="${rt}"` : ''}${colorAttr(s.color)}/>`)
    } else {
      const cx = (x1 + x2) / 2
      const cy = (y1 + y2) / 2
      // Kugel ≈ ChemDraw „Shaded“-Oval (nicht in ChemDraw getestet)
      const ot = [s.kind === 'sphere' ? 'Shaded' : '', s.shadow ? 'Shadow' : '', s.fill && s.kind !== 'sphere' ? 'Filled' : '', s.dashed ? 'Dashed' : ''].filter(Boolean).join(' ')
      body.push(
        `<graphic id="${nid()}" ${bb} GraphicType="Oval"${ot ? ` OvalType="${ot}"` : ''} Center3D="${X(cx)} ${Y(cy)} 0" MajorAxisEnd3D="${X(x2)} ${Y(cy)} 0" MinorAxisEnd3D="${X(cx)} ${Y(y1)} 0"${colorAttr(s.color)}/>`,
      )
    }
    if (s.corner) {
      const lay = layoutRich(s.corner, { size: doc.style.fontSize * 0.75, font: docFont })
      textLines(lay, x2 + 3, y1 + doc.style.fontSize * 0.45, 'left', s.color)
    }
    if (s.sub) {
      const lay = layoutRich(s.sub, { size: doc.style.fontSize * 0.75, font: docFont })
      textLines(lay, x2 + 3, y2 + doc.style.fontSize * 0.28, 'left', s.color)
    }
  }

  // ---------- Ansatztabellen: Linien als Grafik, Zellen als Texte ----------
  for (const t of Object.values(doc.tables ?? {})) {
    const g = tableGeom(doc, t)
    for (const l of g.lines) body.push(`<graphic id="${nid()}" BoundingBox="${X(l.x2)} ${Y(l.y)} ${X(l.x1)} ${Y(l.y)}" GraphicType="Line"/>`)
    for (const c of g.cells) textLines(c.lay, c.x, c.y, c.align)
  }

  // ---------- Freie Texte ----------
  for (const t of Object.values(doc.texts)) {
    const lay = textLayoutOf(t, doc)
    textLines(lay, t.x, t.y + t.size * 0.35, t.align ?? 'left', t.color, t.font ?? docFont)
  }

  const W = Math.max(540, box ? (box.x2 - box.x1) * k + 72 : 540)
  const H = Math.max(720, box ? (box.y2 - box.y1) * k + 72 : 720)
  const colortable = colors
    .map((hex) => {
      const r = parseInt(hex.slice(1, 3), 16) / 255
      const g = parseInt(hex.slice(3, 5), 16) / 255
      const b = parseInt(hex.slice(5, 7), 16) / 255
      return `<color r="${+r.toFixed(4)}" g="${+g.toFixed(4)}" b="${+b.toFixed(4)}"/>`
    })
    .join('\n')
  fontId(docFont)
  const fonttable = fonts.map((n, i) => `<font id="${i + 3}" charset="iso-8859-1" name="${esc(n)}"/>`).join('\n')
  const lfont = fontId(docFont)
  return `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE CDXML SYSTEM "http://www.cambridgesoft.com/xml/cdxml.dtd" >
<CDXML CreationProgram="${esc(title)}" Name="${esc(getState().fileName)}" BoundingBox="0 0 ${f2(W)} ${f2(H)}" LabelFont="${lfont}" LabelSize="${f2(labelSize)}" LabelFace="96" CaptionFont="${lfont}" CaptionSize="${f2(labelSize * 0.8)}" HashSpacing="2.50" MarginWidth="1.60" LineWidth="${f2(doc.style.lineWidth * k)}" BoldWidth="2" BondLength="14.40" BondSpacing="18" ChainAngle="120" LabelJustification="Auto" CaptionJustification="Left" color="0" bgcolor="1">
<colortable>
${colortable}
</colortable><fonttable>
${fonttable}
</fonttable><page id="${nid()}" BoundingBox="0 0 ${f2(W)} ${f2(H)}" HeaderPosition="36" FooterPosition="36" PrintTrimMarks="yes" HeightPages="1" WidthPages="1">
${body.join('\n')}
</page></CDXML>
`
}

export function exportCdxml() {
  const { doc, fileName } = getState()
  if (!Object.keys(doc.atoms).length && !Object.keys(doc.texts).length && !Object.keys(doc.arrows).length && !Object.keys(doc.cycles ?? {}).length && !Object.keys(doc.shapes).length && !Object.keys(doc.tables ?? {}).length) {
    toast('Nichts zu exportieren', 'error')
    return
  }
  const xml = buildCdxml(doc)
  const name = (fileName || 'struktur').replace(/\s+/g, '_') + '.cdxml'
  void saveBlob(name, new Blob([xml], { type: 'chemical/x-cdxml' })).then((ok) => {
    if (ok && Object.keys(doc.fills ?? {}).length) toast('CDXML gespeichert – Ringfüllungen/Farbverläufe werden von CDXML nicht übernommen')
  })
}

