import { GhsIcon } from './Ghs'
import { tableGeom } from '../model/stoichLayout'
import { useId, type ReactElement } from 'react'
import { boldStemWidth, isValenceError } from '../model/chem'
import { ELEMENT_COLOR } from '../model/elements'
import { add, dist, len, mid, mul, norm, perp, sub, type Box, type Pt } from '../model/geom'
import { layoutRich, type RichLayout } from '../model/richtext'
import {
  depthT,
  arrowPoints,
  arrowTextBlocks,
  bondEnds,
  clipParallel,
  curvedGeom,
  doubleSide,
  ringPolygonPath,
  textBox,
  textLayoutOf,
  type Scene,
} from '../model/scene'
import type { Arrow, Atom, Bond, Cycle, CurvedArrow, Doc, RingFill, Shape, StoichTable, TextObj } from '../model/types'
import { arcLabelPos, branchGeom, branchLabelPos, cycleSegments, ePoint, linkGeom, linkLabelPos, stationLabelSize } from '../model/cycle'
import { CLOSED_SHAPES, fontCss } from '../model/types'
import { orderItems } from '../model/order'
import { cyclicLoop } from '../model/polymer'

const INK = '#111418'

const P = (p: Pt) => `${r(p.x)},${r(p.y)}`
const r = (n: number) => Math.round(n * 100) / 100

export function atomColor(doc: Doc, a: Atom): string {
  if (a.color) return a.color
  if (doc.style.colorAtoms && !a.label) return ELEMENT_COLOR[a.element] ?? INK
  return INK
}

// ---------- Text ----------

/** Zeichnet Rich-Text-Zeilen; y = Grundlinie der ersten Zeile */
export function RichLines({
  lay,
  x,
  y,
  align = 'left',
  color,
}: {
  lay: RichLayout
  x: number
  y: number
  align?: 'left' | 'center' | 'right'
  color: string
}) {
  return (
    <>
      {lay.lines.map((ln, li) => {
        const x0 = align === 'center' ? x - ln.w / 2 : align === 'right' ? x - ln.w : x
        let prev = 0
        return (
          <text key={li} x={r(x0)} y={r(y + ln.y)} fill={color} style={{ whiteSpace: 'pre' }}>
            {ln.toks.map((t, i) => {
              const dy = t.dy - prev
              prev = t.dy
              return (
                <tspan
                  key={i}
                  dy={dy ? r(dy) : undefined}
                  fontSize={r(t.size)}
                  fontFamily={t.font}
                  fontWeight={t.b ? 'bold' : undefined}
                  fontStyle={t.i ? 'italic' : undefined}
                  textDecoration={t.u ? 'underline' : undefined}
                  fill={t.color}
                >
                  {t.t}
                </tspan>
              )
            })}
          </text>
        )
      })}
    </>
  )
}

function TextBlock({ t, doc }: { t: TextObj; doc: Doc }) {
  const L = textLayoutOf(t, doc)
  const color = t.color ?? INK
  const box = textBox(t, doc)
  return (
    <g opacity={t.opacity}>
      {t.bg && <rect x={r(box.x1)} y={r(box.y1)} width={r(box.x2 - box.x1)} height={r(box.y2 - box.y1)} rx={r(t.size * 0.18)} fill={t.bg} />}
      {t.highlight && (
        <rect
          x={r(box.x1 - t.size * 0.18)}
          y={r(box.y1 - t.size * 0.08)}
          width={r(box.x2 - box.x1 + t.size * 0.36)}
          height={r(box.y2 - box.y1 + t.size * 0.16)}
          rx={r(t.size * 0.3)}
          fill={t.highlight}
          opacity={HIGHLIGHT_OPACITY}
        />
      )}
      <RichLines lay={L} x={t.x} y={t.y + t.size * 0.35} align={t.align} color={color} />
    </g>
  )
}

// ---------- Textmarker ----------

const HIGHLIGHT_OPACITY = 0.8

/** Textmarker eines Moleküls: breiter, runder Farbstreifen hinter markierten Bindungen, Kreis bzw. Box (Beschriftung)
 *  hinter markierten Atomen – liegt über der Ringfüllung und unter den Linien */
function HighlightLayer({ scene, atoms, bonds }: { scene: Scene; atoms: string[]; bonds: string[] }) {
  const doc = scene.doc
  const L = doc.style.bondLength
  const fs = doc.style.fontSize
  const w = L * 0.34
  const els: ReactElement[] = []
  for (const id of bonds) {
    const b = doc.bonds[id]
    const p = b && doc.atoms[b.a1]
    const q = b && doc.atoms[b.a2]
    if (!b?.highlight || !p || !q) continue
    els.push(<line key={'hb' + id} x1={r(p.x)} y1={r(p.y)} x2={r(q.x)} y2={r(q.y)} stroke={b.highlight} strokeWidth={r(w)} strokeLinecap="round" />)
  }
  for (const id of atoms) {
    const a = doc.atoms[id]
    if (!a?.highlight) continue
    const lab = scene.decor.get(id)?.label
    if (lab) {
      const pad = fs * 0.16
      els.push(
        <rect
          key={'ha' + id}
          x={r(a.x + lab.left - pad)}
          y={r(a.y + lab.top - pad)}
          width={r(lab.right - lab.left + pad * 2)}
          height={r(lab.bottom - lab.top + pad * 2)}
          rx={r(fs * 0.3)}
          fill={a.highlight}
        />,
      )
    } else els.push(<circle key={'ha' + id} cx={r(a.x)} cy={r(a.y)} r={r(w / 2)} fill={a.highlight} />)
  }
  if (!els.length) return null
  return <g opacity={HIGHLIGHT_OPACITY}>{els}</g>
}

// ---------- Bindungen ----------

function line(p: Pt, q: Pt, w: number, color: string, extra: Record<string, unknown> = {}, key?: string | number) {
  return (
    <line
      key={key}
      x1={r(p.x)}
      y1={r(p.y)}
      x2={r(q.x)}
      y2={r(q.y)}
      stroke={color}
      strokeWidth={w}
      strokeLinecap="round"
      {...extra}
    />
  )
}

/** Linienstärke einer Bindung; an fetten Atomen mit „Bindungen fett“ so dick wie der fette Buchstabe */
/** Strichstärke für „fett“: so dick wie ein fetter Buchstabe der Dokumentschrift */
export function boldLineWidth(doc: Doc): number {
  return Math.max(doc.style.lineWidth * 1.5, boldStemWidth(fontCss(doc.style.font), doc.style.fontSize))
}

export function bondLineWidth(doc: Doc, b: Bond): number {
  const st = doc.style
  let lw = st.lineWidth * (b.width ?? 1)
  const A1 = doc.atoms[b.a1]
  const A2 = doc.atoms[b.a2]
  if ((A1?.bold && A1.boldBonds) || (A2?.bold && A2.boldBonds)) lw = Math.max(lw, boldStemWidth(fontCss(st.font), st.fontSize))
  return lw
}

function BondShape({ scene, b }: { scene: Scene; b: Bond }) {
  const inner = bondInner(scene, b)
  if (!inner) return null
  return b.opacity !== undefined && b.opacity < 1 ? <g opacity={b.opacity}>{inner}</g> : inner
}

function bondInner(scene: Scene, b: Bond) {
  const doc = scene.doc
  const st = doc.style
  const A1 = doc.atoms[b.a1]
  const A2 = doc.atoms[b.a2]
  const lw = bondLineWidth(doc, b)
  const L = st.bondLength
  const color = b.color ?? depthColor(scene, (A1.z ?? 0) / 2 + (A2.z ?? 0) / 2)
  const { p1, p2, c1, c2 } = bondEnds(scene, b)
  const v = sub(p2, p1)
  const l = len(v)
  if (l < 0.5) return null
  const d = norm(v)
  const n = perp(d)
  const gap = L * 0.18

  switch (b.type) {
    case 'single':
      return line(p1, p2, lw, color)
    case 'bold':
      // runde Enden an unbeschrifteten Atomen → saubere Ecken bei 3D-Ringen
      return line(p1, p2, lw * 3.4, color, { strokeLinecap: c1 === 0 && c2 === 0 ? 'round' : 'butt' })
    case 'dashed':
      return line(p1, p2, lw, color, { strokeDasharray: `${r(lw * 2.2)} ${r(lw * 2.2)}`, strokeLinecap: 'butt' })
    case 'wedge': {
      const w = L * 0.11
      return (
        <polygon
          points={`${P(p1)} ${P(add(p2, mul(n, w)))} ${P(sub(p2, mul(n, w)))}`}
          fill={color}
          stroke={color}
          strokeWidth={lw * 0.5}
          strokeLinejoin="round"
        />
      )
    }
    case 'hash': {
      const w = L * 0.11
      const count = Math.max(3, Math.round(l / (lw * 2.7)))
      const els: ReactElement[] = []
      for (let i = 0; i <= count; i++) {
        const t = i / count
        const c = add(p1, mul(v, t))
        const hw = Math.max(lw * 0.5, w * t)
        els.push(line(add(c, mul(n, hw)), sub(c, mul(n, hw)), lw * 0.9, color, { strokeLinecap: 'butt' }, i))
      }
      return <g>{els}</g>
    }
    case 'wavy': {
      const waves = Math.max(2, Math.round(l / (lw * 4)))
      const step = l / waves
      let dstr = `M${P(p1)}`
      for (let i = 0; i < waves; i++) {
        const a = add(p1, mul(d, step * i))
        const b2 = add(p1, mul(d, step * (i + 1)))
        const side = i % 2 === 0 ? 1 : -1
        const c = add(mid(a, b2), mul(n, side * step * 0.9))
        dstr += ` Q${P(c)} ${P(b2)}`
      }
      return <path d={dstr} fill="none" stroke={color} strokeWidth={lw} strokeLinecap="round" />
    }
    case 'triple': {
      const g = gap * 0.85
      const [u1, u2] = clipParallel(scene, b, add(A1, mul(n, g)), add(A2, mul(n, g)))
      const [w1, w2] = clipParallel(scene, b, sub(A1, mul(n, g)), sub(A2, mul(n, g)))
      return (
        <g>
          {line(p1, p2, lw, color)}
          {line(u1, u2, lw, color)}
          {line(w1, w2, lw, color)}
        </g>
      )
    }
    case 'double':
    case 'aromatic': {
      if (b.type === 'double' && b.crossed) {
        // unbestimmte E/Z-Konfiguration: zwei sich kreuzende Linien (mittig)
        const g = gap / 2
        const [u1, u2] = clipParallel(scene, b, add(A1, mul(n, g)), add(A2, mul(n, g)))
        const [w1, w2] = clipParallel(scene, b, sub(A1, mul(n, g)), sub(A2, mul(n, g)))
        return (
          <g>
            {line(u1, w2, lw, color)}
            {line(w1, u2, lw, color)}
          </g>
        )
      }
      const side = doubleSide(scene, b)
      const dash = b.type === 'aromatic' ? { strokeDasharray: `${r(lw * 2)} ${r(lw * 2)}`, strokeLinecap: 'butt' } : {}
      if (side === 0) {
        const g = gap / 2
        const [u1, u2] = clipParallel(scene, b, add(A1, mul(n, g)), add(A2, mul(n, g)))
        const [w1, w2] = clipParallel(scene, b, sub(A1, mul(n, g)), sub(A2, mul(n, g)))
        return (
          <g>
            {line(u1, u2, lw, color)}
            {line(w1, w2, lw, color, dash)}
          </g>
        )
      }
      // Zweitlinie innen, an unbeschrifteten Enden gekürzt
      const off = mul(n, gap * side)
      const short = L * 0.12
      let [q1, q2] = clipParallel(scene, b, add(A1, off), add(A2, off))
      if (c1 === 0) q1 = add(q1, mul(d, Math.min(short, l * 0.25)))
      if (c2 === 0) q2 = sub(q2, mul(d, Math.min(short, l * 0.25)))
      return (
        <g>
          {line(p1, p2, lw, color)}
          {line(q1, q2, lw, color, dash)}
        </g>
      )
    }
  }
}

// ---------- Atome ----------

function AtomShape({ scene, a }: { scene: Scene; a: Atom }) {
  const doc = scene.doc
  const st = doc.style
  const fs = st.fontSize
  const d = scene.decor.get(a.id)
  if (!d) return null
  const color = a.color || doc.style.colorAtoms ? atomColor(doc, a) : depthColor(scene, a.z)
  const font = fontCss(st.font)
  const els: ReactElement[] = []
  const base = a.y + fs * 0.358
  if (a.attach) {
    // Anknüpfungspunkt: kurze Verlängerung + Wellenlinie quer zur Bindung
    const nb = scene.g.adj.get(a.id)?.[0]
    if (nb) {
      const dir = norm(sub(a, nb.other))
      const nn = perp(dir)
      const L = st.bondLength
      els.push(line(a, add(a, mul(dir, L * 0.32)), st.lineWidth, color, {}, 'ext'))
      const half = L * 0.42
      const waves = 4
      let dstr = `M${P(add(a, mul(nn, -half)))}`
      for (let i = 0; i < waves; i++) {
        const p0 = add(a, mul(nn, -half + (2 * half * i) / waves))
        const p1 = add(a, mul(nn, -half + (2 * half * (i + 1)) / waves))
        const c = add(mid(p0, p1), mul(dir, (i % 2 ? -1 : 1) * L * 0.14))
        dstr += ` Q${P(c)} ${P(p1)}`
      }
      els.push(<path key="wv" d={dstr} fill="none" stroke={color} strokeWidth={st.lineWidth} strokeLinecap="round" />)
    }
    return <g opacity={a.opacity}>{els}</g>
  }
  if (d.label) {
    if (a.bg) {
      const l = d.label
      const pad = fs * 0.12
      els.push(
        <rect
          key="bg"
          x={r(a.x + l.left - pad)}
          y={r(a.y + l.top - pad * 0.6)}
          width={r(l.right - l.left + pad * 2)}
          height={r(l.bottom - l.top + pad * 1.2)}
          rx={r(fs * 0.12)}
          fill={a.bg}
        />,
      )
    }
    d.label.tokens.forEach((t, i) => {
      els.push(
        <text
          key={'t' + i}
          x={r(a.x + t.x)}
          y={r(base + t.dy * fs * (t.s ?? 1))}
          fontFamily={font}
          fontSize={r((t.kind === 'n' ? fs : fs * 0.7) * (t.s ?? 1))}
          fontWeight={t.b ? 'bold' : undefined}
          fontStyle={t.i ? 'italic' : undefined}
          textDecoration={t.u ? 'underline' : undefined}
          fill={t.color ?? color}
          style={{ whiteSpace: 'pre' }}
        >
          {t.t}
        </text>,
      )
    })
  }
  if (a.charge && d.charge) {
    const abs = Math.abs(a.charge)
    const sign = a.charge > 0 ? '+' : '−'
    if (st.chargeCircle && abs === 1) {
      // fett: Strich so kräftig wie fette Bindungen, Kreis etwas größer, damit das ⊕ nicht zuläuft
      const rr = fs * (a.bold ? 0.27 : 0.24)
      const c = d.charge
      const arm = rr * 0.55
      const cw = a.bold ? Math.max(boldLineWidth(doc) * 0.85, a.boldBonds ? boldStemWidth(fontCss(st.font), fs) * 0.9 : 0) : st.lineWidth * 0.6
      els.push(<circle key="cc" cx={r(c.x)} cy={r(c.y)} r={r(rr)} fill="none" stroke={color} strokeWidth={r(cw)} />)
      els.push(line({ x: c.x - arm, y: c.y }, { x: c.x + arm, y: c.y }, cw, color, {}, 'h'))
      if (a.charge > 0) els.push(line({ x: c.x, y: c.y - arm }, { x: c.x, y: c.y + arm }, cw, color, {}, 'v'))
    } else {
      const t = (abs > 1 ? String(abs) : '') + sign
      els.push(
        <text key="ch" x={r(d.charge.x)} y={r(d.charge.y + fs * 0.25)} fontFamily={font} fontSize={r(fs * (a.bold ? 0.78 : 0.7))} fontWeight={a.bold ? 'bold' : undefined} fill={color} textAnchor="middle">
          {t}
        </text>,
      )
    }
  }
  const dotR = Math.max(1.4, fs * 0.075) * (a.bold ? 1.35 : 1)
  d.lonePairs.forEach((lp, i) => {
    const t = perp({ x: Math.cos(lp.angle), y: Math.sin(lp.angle) })
    const s = fs * 0.14
    els.push(<circle key={'lp' + i + 'a'} cx={r(lp.c.x + t.x * s)} cy={r(lp.c.y + t.y * s)} r={r(dotR)} fill={color} />)
    els.push(<circle key={'lp' + i + 'b'} cx={r(lp.c.x - t.x * s)} cy={r(lp.c.y - t.y * s)} r={r(dotR)} fill={color} />)
  })
  d.radicals.forEach((rd, i) => {
    els.push(<circle key={'rd' + i} cx={r(rd.c.x)} cy={r(rd.c.y)} r={r(dotR * 1.1)} fill={color} />)
  })
  if (a.partial && d.partial) {
    els.push(
      <text key="pd" x={r(d.partial.x)} y={r(d.partial.y + fs * 0.25)} fontFamily={font} fontSize={r(fs * 0.68)} fontStyle="italic" fontWeight={a.bold ? 'bold' : undefined} fill={color} textAnchor="middle">
        {'δ' + (a.partial === '+' ? '+' : '−')}
      </text>,
    )
  }
  if (d.stereo) {
    // Stereozentrum: „*“ und/oder „(R)“/„(S)“ (Deskriptor kursiv)
    const s = d.stereo
    els.push(
      <text key="st" x={r(s.c.x)} y={r(s.c.y + fs * 0.25)} fontFamily={font} fontSize={r(fs * 0.7)} fontWeight={a.bold ? 'bold' : undefined} fill={color} textAnchor="middle">
        {s.star && <tspan>*</tspan>}
        {s.cip && (
          <>
            <tspan>(</tspan>
            <tspan fontStyle="italic">{s.cip}</tspan>
            <tspan>)</tspan>
          </>
        )}
      </text>,
    )
  }
  return <g opacity={a.opacity}>{els}</g>
}

function WarningMarks({ scene }: { scene: Scene }) {
  const doc = scene.doc
  if (!doc.style.showWarnings) return null
  const fs = doc.style.fontSize
  const els: ReactElement[] = []
  for (const id in doc.atoms) {
    const a = doc.atoms[id]
    if (!isValenceError(scene.g, a)) continue
    const d = scene.decor.get(id)
    const l = d?.label
    els.push(
      <rect
        key={id}
        x={r(a.x + (l ? l.left : -fs * 0.35) - 2)}
        y={r(a.y + (l ? l.top : -fs * 0.35) - 2)}
        width={r((l ? l.right - l.left : fs * 0.7) + 4)}
        height={r((l ? l.bottom - l.top : fs * 0.7) + 4)}
        fill="none"
        stroke="#e5484d"
        strokeWidth={1}
        strokeDasharray="3 2"
        rx={2}
        data-export="skip"
      />,
    )
  }
  return <g className="warnings">{els}</g>
}

// ---------- Pfeile ----------

export function headPath(tip: Pt, dir: Pt, size: number, mode: 'full' | 'left' | 'right'): string {
  const n = perp(dir)
  const back = sub(tip, mul(dir, size))
  const notch = sub(tip, mul(dir, size * 0.72))
  const w = size * 0.38
  const lft = add(back, mul(n, w))
  const rgt = sub(back, mul(n, w))
  if (mode === 'full') return `M${P(tip)} L${P(lft)} L${P(notch)} L${P(rgt)} Z`
  if (mode === 'left') return `M${P(tip)} L${P(lft)} L${P(notch)} Z`
  return `M${P(tip)} L${P(rgt)} L${P(notch)} Z`
}

function ArrowShape({ doc, ar }: { doc: Doc; ar: Arrow }) {
  const st = doc.style
  const lw = ar.bold ? Math.max(boldLineWidth(doc), st.lineWidth * (ar.width ?? 1)) : st.lineWidth * (ar.width ?? 1)
  const color = ar.color ?? INK
  const pts = arrowPoints(ar)
  const s = pts[0]
  const e = pts[pts.length - 1]
  if (dist(s, e) < 2 && pts.length === 2) return null
  const hs = 4.5 * lw + 5
  const els: ReactElement[] = []
  const shaft = (a: Pt, b: Pt, k: string, extra = {}) => els.push(line(a, b, lw, color, { strokeLinecap: 'butt', ...extra }, k))
  const heads = ar.heads ?? (ar.kind === 'resonance' ? 'both' : 'end')
  const dashArr = ar.kind === 'dashed' ? { strokeDasharray: `${lw * 3} ${lw * 2.4}` } : {}
  const straight = pts.length === 2
  if (!straight || ar.kind === 'reaction' || ar.kind === 'dashed' || ar.kind === 'failed' || ar.kind === 'resonance') {
    // Polylinie mit Spitzen an Anfang und/oder Ende
    const dEnd = norm(sub(e, pts[pts.length - 2]))
    const dStart = norm(sub(s, pts[1]))
    const q = pts.map((p) => ({ ...p }))
    if (heads === 'end' || heads === 'both') q[q.length - 1] = sub(e, mul(dEnd, hs * 0.7))
    if (heads === 'start' || heads === 'both') q[0] = sub(s, mul(dStart, hs * 0.7))
    els.push(
      <polyline
        key="sh"
        points={q.map(P).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={lw}
        strokeLinejoin="miter"
        strokeLinecap="butt"
        {...dashArr}
      />,
    )
    if (heads === 'end' || heads === 'both') els.push(<path key="h1" d={headPath(e, dEnd, hs, 'full')} fill={color} />)
    if (heads === 'start' || heads === 'both') els.push(<path key="h2" d={headPath(s, dStart, hs, 'full')} fill={color} />)
    if (ar.kind === 'failed') {
      const [a1, a2] = [pts[Math.floor((pts.length - 1) / 2)], pts[Math.floor((pts.length - 1) / 2) + 1]]
      const m = mid(a1, a2)
      const d = norm(sub(a2, a1))
      const n = perp(d)
      const k = hs * 0.6
      els.push(line(add(m, mul(add(d, n), k)), sub(m, mul(add(d, n), k)), lw, color, {}, 'x1'))
      els.push(line(add(m, mul(sub(d, n), k)), sub(m, mul(sub(d, n), k)), lw, color, {}, 'x2'))
    }
  } else {
    const d = norm(sub(e, s))
    const n = perp(d)
    if (ar.kind === 'equilibrium') {
      const g = lw * 2.2
      const s1 = add(s, mul(n, g))
      const e1 = add(e, mul(n, g))
      const s2 = sub(s, mul(n, g))
      const e2 = sub(e, mul(n, g))
      shaft(s1, sub(e1, mul(d, hs * 0.5)), 'a')
      shaft(add(s2, mul(d, hs * 0.5)), e2, 'b')
      els.push(<path key="h1" d={headPath(e1, d, hs, 'left')} fill={color} />)
      els.push(<path key="h2" d={headPath(s2, mul(d, -1), hs, 'left')} fill={color} />)
    } else if (ar.kind === 'retro') {
      const g = lw * 2.6
      const tipBack = sub(e, mul(d, g * 1.6))
      shaft(add(s, mul(n, g)), add(tipBack, mul(n, g)), 'a')
      shaft(sub(s, mul(n, g)), sub(tipBack, mul(n, g)), 'b')
      const w = g * 2.6
      const back = sub(e, mul(d, w))
      els.push(
        <polyline
          key="h"
          points={`${P(add(back, mul(n, w)))} ${P(e)} ${P(sub(back, mul(n, w)))}`}
          fill="none"
          stroke={color}
          strokeWidth={lw}
          strokeLinejoin="miter"
          strokeLinecap="round"
        />,
      )
    }
  }
  // Reaktionsbedingungen
  for (const [i, tb] of arrowTextBlocks(doc, ar).entries()) {
    els.push(<RichLines key={'tx' + i} lay={tb.lay} x={tb.x} y={tb.y} align={tb.align} color={color} />)
  }
  return <g opacity={ar.opacity}>{els}</g>
}

function CurvedShape({ scene, ca }: { scene: Scene; ca: CurvedArrow }) {
  const cg = curvedGeom(scene, ca)
  if (!cg) return null
  const st = scene.doc.style
  const lw = ca.bold ? boldLineWidth(scene.doc) : st.lineWidth * 0.9
  const color = ca.color ?? INK
  const hs = 4 * lw + 5
  const end = sub(cg.p1, mul(cg.dirEnd, hs * 0.6))
  // Pfeilspitze: Halbpfeil auf der Außenseite der Krümmung
  const n = perp(cg.dirEnd)
  const outward = sub(cg.p1, cg.c)
  const sideOut = n.x * -outward.y + n.y * outward.x
  const mode = ca.head === 'full' ? 'full' : sideOut >= 0 ? 'left' : 'right'
  return (
    <g opacity={ca.opacity}>
      <path d={`M${P(cg.p0)} Q${P(cg.c)} ${P(end)}`} fill="none" stroke={color} strokeWidth={lw} strokeLinecap="round" />
      <path d={headPath(cg.tip, cg.dirEnd, hs, mode)} fill={color} />
    </g>
  )
}

/** Füllung einer Form: Farbe oder Verlauf (Farbe 1 → Farbe 2) */
function shapePaint(s: Shape, gid: string, x1: number, y1: number, w: number, h: number): { paint: string; def: ReactElement | null } {
  const c1 = s.fill ?? (s.kind === 'sphere' ? '#d4d7dc' : 'none')
  if (c1 === 'none' || !s.fillGrad || s.fillGrad === 'none') return { paint: c1, def: null }
  const c2 = s.fill2 ?? '#ffffff'
  const cx = x1 + w / 2
  const cy = y1 + h / 2
  if (s.fillGrad === 'linear') {
    const a = ((s.fillAngle ?? 90) * Math.PI) / 180
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const hh = (Math.abs(dx) * w + Math.abs(dy) * h) / 2
    return {
      paint: `url(#${gid})`,
      def: (
        <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={r(cx - dx * hh)} y1={r(cy - dy * hh)} x2={r(cx + dx * hh)} y2={r(cy + dy * hh)}>
          <stop offset="0" stopColor={c1} />
          <stop offset="1" stopColor={c2} />
        </linearGradient>
      ),
    }
  }
  return {
    paint: `url(#${gid})`,
    def: (
      <radialGradient id={gid} gradientUnits="userSpaceOnUse" cx={r(cx)} cy={r(cy)} r={r(Math.max(w, h) / 2)}>
        <stop offset="0" stopColor={c1} />
        <stop offset="1" stopColor={c2} />
      </radialGradient>
    ),
  }
}

function ShapeEl({ s, doc }: { s: Shape; doc: Doc }) {
  const lw = s.bold ? boldLineWidth(doc) : doc.style.lineWidth
  const color = s.color ?? INK
  const x1 = Math.min(s.x1, s.x2)
  const x2 = Math.max(s.x1, s.x2)
  const y1 = Math.min(s.y1, s.y2)
  const y2 = Math.max(s.y1, s.y2)
  const w = x2 - x1
  const h = y2 - y1
  const dash = s.dashed ? `${lw * 3} ${lw * 2.4}` : undefined
  const common = { fill: 'none', stroke: color, strokeWidth: lw, strokeDasharray: dash }
  const fs = doc.style.fontSize
  const els: ReactElement[] = []
  const defs: ReactElement[] = []
  if (CLOSED_SHAPES.has(s.kind)) {
    const gid = 'sh-' + s.id
    let { paint, def } = shapePaint(s, gid, x1, y1, w, h)
    if (def) defs.push(<g key="pd">{def}</g>)
    // mit Schatten ohne Füllung: weiß füllen, sonst scheint der Schatten durch
    if (s.shadow && paint === 'none') paint = '#ffffff'
    const stroke = s.noStroke ? 'none' : color
    const sw = s.kind === 'sphere' ? lw * 0.7 : lw
    const rx = s.kind === 'roundrect' ? Math.min(w / 2, h / 2, s.radius ?? Math.max(4, Math.min(w, h) * 0.08)) : s.kind === 'rect' ? 3 : 0
    const geo = (dx: number, dy: number, props: Record<string, unknown>, key: string) =>
      s.kind === 'ellipse' || s.kind === 'sphere' ? (
        <ellipse key={key} cx={r(x1 + w / 2 + dx)} cy={r(y1 + h / 2 + dy)} rx={r(w / 2)} ry={r(h / 2)} {...props} />
      ) : (
        <rect key={key} x={r(x1 + dx)} y={r(y1 + dy)} width={r(w)} height={r(h)} rx={r(rx)} {...props} />
      )
    if (s.shadow) {
      const o = Math.max(3, Math.min(w, h) * 0.035)
      els.push(geo(o, o, { fill: '#c4c7cc', stroke: 'none' }, 'sd'))
    }
    els.push(geo(0, 0, { fill: paint, fillOpacity: s.fillOpacity, stroke: 'none' }, 'f'))
    if (s.kind === 'sphere') {
      // 3D-Kugel: Glanzlicht links oben, dunkler Rand – über der gewählten Farbe bzw. dem Verlauf
      defs.push(
        <radialGradient key="hl" id={gid + '-hl'} cx="0.36" cy="0.32" r="0.62">
          <stop offset="0" stopColor="#ffffff" stopOpacity={0.95} />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity={0.25} />
          <stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </radialGradient>,
        <radialGradient key="sh" id={gid + '-sh'} cx="0.42" cy="0.4" r="0.66">
          <stop offset="0.4" stopColor="#000000" stopOpacity={0} />
          <stop offset="0.8" stopColor="#000000" stopOpacity={0.5} />
          <stop offset="1" stopColor="#000000" stopOpacity={0.92} />
        </radialGradient>,
      )
      els.push(geo(0, 0, { fill: `url(#${gid}-sh)`, stroke: 'none' }, 'sh'))
      els.push(geo(0, 0, { fill: `url(#${gid}-hl)`, stroke: 'none' }, 'hl'))
    }
    els.push(geo(0, 0, { fill: 'none', stroke, strokeWidth: sw, strokeDasharray: dash }, 'o'))
  } else {
    const t = Math.min(w * 0.2, Math.max(6, h * 0.06))
    let l: string
    let rr: string
    if (s.kind === 'brackets') {
      l = `M${x1 + t},${y1} H${x1} V${y2} H${x1 + t}`
      rr = `M${x2 - t},${y1} H${x2} V${y2} H${x2 - t}`
    } else if (s.kind === 'parens') {
      l = `M${x1 + t},${y1} Q${x1 - t * 0.6},${y1 + h / 2} ${x1 + t},${y2}`
      rr = `M${x2 - t},${y1} Q${x2 + t * 0.6},${y1 + h / 2} ${x2 - t},${y2}`
    } else {
      const m = y1 + h / 2
      l = `M${x1 + t},${y1} Q${x1},${y1} ${x1},${y1 + t} V${m - t} Q${x1},${m} ${x1 - t * 0.7},${m} Q${x1},${m} ${x1},${m + t} V${y2 - t} Q${x1},${y2} ${x1 + t},${y2}`
      rr = `M${x2 - t},${y1} Q${x2},${y1} ${x2},${y1 + t} V${m - t} Q${x2},${m} ${x2 + t * 0.7},${m} Q${x2},${m} ${x2},${m + t} V${y2 - t} Q${x2},${y2} ${x2 - t},${y2}`
    }
    els.push(<path key="l" d={l} {...common} strokeLinejoin="miter" />)
    els.push(<path key="r" d={rr} {...common} strokeLinejoin="miter" />)
    // zyklische Wiederholungseinheit: Ring von Stummel zu Stummel außen über die Klammern
    const loop = cyclicLoop(doc, s)
    if (loop) els.push(<path key="loop" d={`M${P(loop.p1)} A${r(loop.rx)},${r(loop.ry)} 0 1 1 ${P(loop.p2)}`} {...common} />)
  }
  if (s.corner) {
    const lay = layoutRich(s.corner, { size: fs * 0.75, font: doc.style.font, bold: s.bold || undefined })
    els.push(<RichLines key="c" lay={lay} x={x2 + 3} y={y1 + fs * 0.45} color={color} />)
  }
  if (s.sub) {
    // Index rechts unten (Polymer „n“)
    const lay = layoutRich(s.sub, { size: fs * 0.75, font: doc.style.font, bold: s.bold || undefined })
    els.push(<RichLines key="sb" lay={lay} x={x2 + 3} y={y2 + fs * 0.28 - lay.lastY} color={color} />)
  }
  return (
    <g opacity={s.opacity}>
      {defs.length > 0 && <defs>{defs}</defs>}
      {els}
    </g>
  )
}

// ---------- Ringfüllungen ----------

function smoothClosed(q: Pt[]): string {
  const n = q.length
  let d = `M${P(q[0])}`
  for (let i = 0; i < n; i++) {
    const p0 = q[(i - 1 + n) % n]
    const p1 = q[i]
    const p2 = q[(i + 1) % n]
    const p3 = q[(i + 2) % n]
    const c1 = add(p1, mul(sub(p2, p0), 1 / 6))
    const c2 = sub(p2, mul(sub(p3, p1), 1 / 6))
    d += ` C${P(c1)} ${P(c2)} ${P(p2)}`
  }
  return d + ' Z'
}

function RingFillShape({ scene, f }: { scene: Scene; f: RingFill }) {
  const doc = scene.doc
  const polys = f.rings.map((ring) => ring.map((id) => doc.atoms[id])).filter((p) => p.length >= 3 && p.every(Boolean)) as Pt[][]
  if (!polys.length) return null
  if (f.mode === 'circle') {
    return (
      <g opacity={f.opacity}>
        {polys.map((poly, i) => {
          const c = poly.reduce((acc, p) => add(acc, mul(p, 1 / poly.length)), { x: 0, y: 0 })
          const q = poly.map((p) => add(c, mul(sub(p, c), 0.6)))
          return <path key={i} d={smoothClosed(q)} fill="none" stroke={f.c1} strokeWidth={doc.style.lineWidth} />
        })}
      </g>
    )
  }
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const poly of polys)
    for (const p of poly) {
      x1 = Math.min(x1, p.x)
      y1 = Math.min(y1, p.y)
      x2 = Math.max(x2, p.x)
      y2 = Math.max(y2, p.y)
    }
  const gid = 'rf-' + f.id
  const cx = (x1 + x2) / 2
  const cy = (y1 + y2) / 2
  let fill = f.c1
  let def: ReactElement | null = null
  if (f.grad === 'linear') {
    const a = (f.angle * Math.PI) / 180
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const h = (Math.abs(dx) * (x2 - x1) + Math.abs(dy) * (y2 - y1)) / 2
    def = (
      <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={r(cx - dx * h)} y1={r(cy - dy * h)} x2={r(cx + dx * h)} y2={r(cy + dy * h)}>
        <stop offset="0" stopColor={f.c1} />
        <stop offset="1" stopColor={f.c2} />
      </linearGradient>
    )
    fill = `url(#${gid})`
  } else if (f.grad === 'radial') {
    let rr = 1
    for (const poly of polys) for (const p of poly) rr = Math.max(rr, Math.hypot(p.x - cx, p.y - cy))
    def = (
      <radialGradient id={gid} gradientUnits="userSpaceOnUse" cx={r(cx)} cy={r(cy)} r={r(rr)}>
        <stop offset="0" stopColor={f.c1} />
        <stop offset="1" stopColor={f.c2} />
      </radialGradient>
    )
    fill = `url(#${gid})`
  }
  return (
    <g opacity={f.opacity}>
      {def && <defs>{def}</defs>}
      <path d={ringPolygonPath(polys)} fill={fill} fillRule="nonzero" stroke="none" />
    </g>
  )
}

// ---------- Katalysezyklen ----------

function CycleShape({ doc, c }: { doc: Doc; c: Cycle }) {
  const lw = c.bold ? Math.max(boldLineWidth(doc), doc.style.lineWidth * (c.width ?? 1)) : doc.style.lineWidth * (c.width ?? 1)
  const color = c.color ?? INK
  const hs = 4.5 * lw + 5
  const dash = c.dashed ? `${lw * 3} ${lw * 2.4}` : undefined
  const els: ReactElement[] = []
  cycleSegments(doc, c, hs).forEach((sg, i) => {
    els.push(<path key={'s' + i} d={sg.path} fill="none" stroke={color} strokeWidth={lw} strokeLinecap="butt" strokeDasharray={dash} />)
    if (c.heads) els.push(<path key={'h' + i} d={headPath(sg.tip, sg.dir, hs, 'full')} fill={color} />)
  })
  const lo = { ...stationLabelSize(doc), bold: c.bold || undefined }
  for (const b of c.branches) {
    const g = branchGeom(c, b)
    const end = b.head ? { x: g.to.x - g.tipDir.x * hs * 0.7, y: g.to.y - g.tipDir.y * hs * 0.7 } : g.to
    els.push(
      <path
        key={'b' + b.id}
        d={`M${P(g.from)} Q${P(g.q)} ${P(end)}`}
        fill="none"
        stroke={color}
        strokeWidth={lw}
        strokeLinecap="round"
        strokeDasharray={dash}
      />,
    )
    if (b.head) els.push(<path key={'bh' + b.id} d={headPath(g.to, g.tipDir, hs, 'full')} fill={color} />)
    if (b.label) {
      const lp = branchLabelPos(doc, c, b)
      els.push(<RichLines key={'bl' + b.id} lay={layoutRich(b.label, lo)} x={lp.x} y={lp.y} align={lp.align} color={color} />)
    }
  }
  for (const l of c.links ?? []) {
    const g = linkGeom(doc, c, l)
    if (!g) continue
    const head = l.head !== false
    const end = head ? { x: g.p3.x - g.tipDir.x * hs * 0.7, y: g.p3.y - g.tipDir.y * hs * 0.7 } : g.p3
    els.push(
      <path key={'k' + l.id} d={`M${P(g.p0)} C${P(g.c1)} ${P(g.c2)} ${P(end)}`} fill="none" stroke={color} strokeWidth={lw} strokeLinecap="round" strokeDasharray={dash} />,
    )
    if (head) els.push(<path key={'kh' + l.id} d={headPath(g.p3, g.tipDir, hs, 'full')} fill={color} />)
    if (l.label) {
      const lp = linkLabelPos(doc, c, l)
      if (lp) els.push(<RichLines key={'kl' + l.id} lay={layoutRich(l.label, lo)} x={lp.x} y={lp.y} align={lp.align} color={color} />)
    }
  }
  for (const al of c.arcLabels ?? []) {
    if (!al.label) continue
    const lp = arcLabelPos(doc, c, al)
    els.push(<RichLines key={'al' + al.id} lay={layoutRich(al.label, lo)} x={lp.x} y={lp.y} align={lp.align} color={color} />)
  }
  c.stations.forEach((st, i) => {
    if (!st.label) return
    const p = ePoint(c, st.angle)
    const lay = layoutRich(st.label, lo)
    els.push(<RichLines key={'l' + i} lay={lay} x={p.x} y={p.y + lo.size * 0.35 - lay.lastY / 2} align="center" color={color} />)
  })
  return <g opacity={c.opacity}>{els}</g>
}

// ---------- 3D-Tiefe ----------

const BACK = [163, 167, 174]
const FRONT = [17, 20, 24]

function depthColor(scene: Scene, z: number | undefined): string {
  if (!scene.depth) return INK
  // weicher Übergang um die Mitte: vordere Hälfte schwarz, hintere grau
  const t = depthT(scene, z)
  const k = Math.min(1, Math.max(0, (t - 0.38) / 0.24))
  const c = FRONT.map((f, i) => Math.round(f + (BACK[i] - f) * k))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

interface Halo {
  p: Pt
  q: Pt
  w: number
}

/** Freistellungsbereich einer Bindung (Überkreuzungslücke für dahinterliegende Linien) */
function haloGeom(doc: Doc, b: Bond): Halo {
  const a1 = doc.atoms[b.a1]
  const a2 = doc.atoms[b.a2]
  const v = sub(a2, a1)
  // nur das Mittelstück freistellen, damit an gemeinsamen Atomen keine Lücken entstehen
  const p = add(a1, mul(v, 0.22))
  const q = add(a1, mul(v, 0.78))
  const w = bondLineWidth(doc, b) * 2.2 + (b.type === 'double' || b.type === 'aromatic' ? doc.style.bondLength * 0.18 : b.type === 'triple' ? doc.style.bondLength * 0.3 : 0) + 3
  return { p, q, w }
}

// ---------- 3D: Ringfüllungen tiefensortiert und schattiert ----------

type V3n = { x: number; y: number; z: number }

function parseHex(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map((x) => x + x).join('')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

const toHex = (c: number[]) => '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')

/**
 * Farbe für einen Ring im Raum: `light` 0…1 (Ausrichtung zum Licht), `back` 0…1 (Tiefe, 1 = hinten).
 * Zum Licht geneigte Flächen werden heller, abgewandte dunkler; hintere Ringe verblassen (wie die grauen Bindungen).
 */
function shade3d(color: string, light: number, back: number): string {
  const rgb = parseHex(color)
  if (!rgb) return color
  let c = rgb.map((v) => v)
  // Beleuchtung: 0.5 = unverändert
  const l = light - 0.5
  c = l >= 0 ? c.map((v) => v + (255 - v) * l * 0.55) : c.map((v) => v * (1 + l * 0.7))
  // Tiefe: etwas entsättigen und Richtung Hintergrund aufhellen
  const grey = (c[0] + c[1] + c[2]) / 3
  c = c.map((v) => v + (grey - v) * back * 0.35)
  c = c.map((v) => v + (255 - v) * back * 0.45)
  return toHex(c)
}

/** Normale eines (nicht ebenen) Rings nach Newell, z zum Betrachter */
function ringNormal(pts: V3n[]): V3n {
  let nx = 0
  let ny = 0
  let nz = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    nx += (a.y - b.y) * (a.z + b.z)
    ny += (a.z - b.z) * (a.x + b.x)
    nz += (a.x - b.x) * (a.y + b.y)
  }
  const l = Math.hypot(nx, ny, nz) || 1
  return { x: nx / l, y: ny / l, z: nz / l }
}

// Licht von links oben vorn (y zeigt nach unten)
const LIGHT = (() => {
  const v = { x: -0.45, y: -0.55, z: 1 }
  const l = Math.hypot(v.x, v.y, v.z)
  return { x: v.x / l, y: v.y / l, z: v.z / l }
})()

interface FillPiece {
  key: string
  f: RingFill
  ids: string[]
  poly: Pt[]
  z: number
  /** Ausrichtung zum Licht 0…1 */
  light: number
  /** Projektion der Normalen (für einen leichten Verlauf über den Ring) */
  tilt: Pt
  bonds: Bond[]
}

function fillBounds(doc: Doc, f: RingFill) {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const ring of f.rings)
    for (const id of ring) {
      const p = doc.atoms[id]
      if (!p) continue
      x1 = Math.min(x1, p.x)
      y1 = Math.min(y1, p.y)
      x2 = Math.max(x2, p.x)
      y2 = Math.max(y2, p.y)
    }
  return { x1, y1, x2, y2 }
}

function FillPieceShape({ scene, pc }: { scene: Scene; pc: FillPiece }) {
  const doc = scene.doc
  const f = pc.f
  const back = depthT(scene, pc.z)
  const sh = (c: string, dl = 0) => shade3d(c, Math.min(1, Math.max(0, pc.light + dl)), back)
  const gid = `rf3-${f.id}-${pc.key}`
  if (f.mode === 'circle') {
    const poly = pc.poly
    const c = poly.reduce((acc, p) => add(acc, mul(p, 1 / poly.length)), { x: 0, y: 0 })
    const q = poly.map((p) => add(c, mul(sub(p, c), 0.6)))
    return <path d={smoothClosed(q)} fill="none" stroke={shade3d(f.c1, 0.5, back)} strokeWidth={doc.style.lineWidth} opacity={f.opacity} />
  }
  let paint: string
  let def: ReactElement | null = null
  const b = fillBounds(doc, f)
  const cx = (b.x1 + b.x2) / 2
  const cy = (b.y1 + b.y2) / 2
  if (f.grad === 'linear') {
    // Verlauf über das ganze Ringsystem, jede Ringfläche mit eigener Schattierung
    const a = (f.angle * Math.PI) / 180
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const h = (Math.abs(dx) * (b.x2 - b.x1) + Math.abs(dy) * (b.y2 - b.y1)) / 2
    def = (
      <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={r(cx - dx * h)} y1={r(cy - dy * h)} x2={r(cx + dx * h)} y2={r(cy + dy * h)}>
        <stop offset="0" stopColor={sh(f.c1)} />
        <stop offset="1" stopColor={sh(f.c2)} />
      </linearGradient>
    )
    paint = `url(#${gid})`
  } else if (f.grad === 'radial') {
    let rr = 1
    for (const ring of f.rings) for (const id of ring) if (doc.atoms[id]) rr = Math.max(rr, Math.hypot(doc.atoms[id].x - cx, doc.atoms[id].y - cy))
    def = (
      <radialGradient id={gid} gradientUnits="userSpaceOnUse" cx={r(cx)} cy={r(cy)} r={r(rr)}>
        <stop offset="0" stopColor={sh(f.c1)} />
        <stop offset="1" stopColor={sh(f.c2)} />
      </radialGradient>
    )
    paint = `url(#${gid})`
  } else {
    // einfarbig: leichter Licht-Verlauf quer über den geneigten Ring
    const tl = Math.hypot(pc.tilt.x, pc.tilt.y)
    if (tl > 0.12) {
      const c = pc.poly.reduce((acc, p) => add(acc, mul(p, 1 / pc.poly.length)), { x: 0, y: 0 })
      let rr = 1
      for (const p of pc.poly) rr = Math.max(rr, dist(p, c))
      const u = { x: pc.tilt.x / tl, y: pc.tilt.y / tl }
      def = (
        <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={r(c.x - u.x * rr)} y1={r(c.y - u.y * rr)} x2={r(c.x + u.x * rr)} y2={r(c.y + u.y * rr)}>
          <stop offset="0" stopColor={sh(f.c1, 0.1)} />
          <stop offset="1" stopColor={sh(f.c1, -0.1)} />
        </linearGradient>
      )
      paint = `url(#${gid})`
    } else paint = sh(f.c1)
  }
  return (
    <g opacity={f.opacity}>
      {def && <defs>{def}</defs>}
      <path d={ringPolygonPath([pc.poly])} fill={paint} stroke="none" />
    </g>
  )
}

/**
 * 3D-Darstellung: Ringfüllungen und Bindungen gemeinsam von hinten nach vorn zeichnen.
 * Die Bindungen eines gefüllten Rings werden mit ihm gezeichnet (Rand zuerst, dann Fläche, dann Linien),
 * damit der weiße Überkreuzungsrand die eigene Füllung nicht anschneidet.
 */
function DepthLayer({ scene }: { scene: Scene }) {
  const doc = scene.doc
  const pieces: FillPiece[] = []
  for (const f of Object.values(doc.fills ?? {})) {
    f.rings.forEach((ring, i) => {
      const atoms = ring.map((id) => doc.atoms[id])
      if (atoms.length < 3 || !atoms.every(Boolean)) return
      const p3 = atoms.map((a) => ({ x: a.x, y: a.y, z: a.z ?? 0 }))
      const n = ringNormal(p3)
      const light = Math.abs(n.x * LIGHT.x + n.y * LIGHT.y + n.z * LIGHT.z)
      // Richtung, in die der Ring „kippt“: die zum Licht geneigte Seite wird heller
      const s = n.z * LIGHT.z + n.x * LIGHT.x + n.y * LIGHT.y >= 0 ? 1 : -1
      const tilt = { x: -n.x * s, y: -n.y * s }
      pieces.push({ key: String(i), f, ids: ring, poly: atoms, z: p3.reduce((acc, p) => acc + p.z, 0) / p3.length, light, tilt, bonds: [] })
    })
  }
  pieces.sort((a, b) => a.z - b.z)
  const zOf = (b: Bond) => ((doc.atoms[b.a1].z ?? 0) + (doc.atoms[b.a2].z ?? 0)) / 2
  // Ringkanten → vorderster Ring, der die Kante enthält
  const owner = new Map<string, FillPiece>()
  for (const pc of pieces) {
    if (pc.f.mode !== 'fill') continue
    for (let i = 0; i < pc.ids.length; i++) {
      const a = pc.ids[i]
      const b = pc.ids[(i + 1) % pc.ids.length]
      owner.set(a < b ? a + '|' + b : b + '|' + a, pc)
    }
  }
  const free: Bond[] = []
  for (const b of Object.values(doc.bonds)) {
    const pc = owner.get(b.a1 < b.a2 ? b.a1 + '|' + b.a2 : b.a2 + '|' + b.a1)
    if (pc) pc.bonds.push(b)
    else free.push(b)
  }
  // Jedes Element: Fläche (optional) + Linien. Die Freistellung vorderer Bindungen wirkt als Maske nur auf die
  // Linien weiter hinten liegender Elemente – Füllungen werden dadurch nicht angeschnitten (keine weißen Flecken).
  type Item = { key: string; z: number; bonds: Bond[]; piece: FillPiece | null; box: Box; halos: Halo[] }
  const pad = doc.style.bondLength * 0.25 + doc.style.lineWidth * 3
  const boxOf = (bs: Bond[], extra: Pt[] = []): Box => {
    let bx: Box = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }
    const grow = (q: Pt) => {
      bx = { x1: Math.min(bx.x1, q.x), y1: Math.min(bx.y1, q.y), x2: Math.max(bx.x2, q.x), y2: Math.max(bx.y2, q.y) }
    }
    for (const bd of bs) {
      grow(doc.atoms[bd.a1])
      grow(doc.atoms[bd.a2])
    }
    extra.forEach(grow)
    return { x1: bx.x1 - pad, y1: bx.y1 - pad, x2: bx.x2 + pad, y2: bx.y2 + pad }
  }
  const items: Item[] = []
  for (const bd of free) items.push({ key: bd.id, z: zOf(bd), bonds: [bd], piece: null, box: boxOf([bd]), halos: [haloGeom(doc, bd)] })
  for (const pc of pieces) {
    const bs = [...pc.bonds].sort((x, y) => zOf(x) - zOf(y))
    items.push({ key: 'rf' + pc.f.id + pc.key, z: pc.z, bonds: bs, piece: pc, box: boxOf(bs, pc.poly), halos: bs.map((bd) => haloGeom(doc, bd)) })
  }
  items.sort((x, y) => x.z - y.z)
  const uidp = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const overlaps = (bx: Box, h: Halo) =>
    Math.min(h.p.x, h.q.x) - h.w < bx.x2 && Math.max(h.p.x, h.q.x) + h.w > bx.x1 && Math.min(h.p.y, h.q.y) - h.w < bx.y2 && Math.max(h.p.y, h.q.y) + h.w > bx.y1
  return (
    <>
      {items.map((it, i) => {
        const cut: Halo[] = []
        for (let j = i + 1; j < items.length; j++) for (const h of items[j].halos) if (overlaps(it.box, h)) cut.push(h)
        const mid = `dm${uidp}-${i}`
        const bx = it.box
        return (
          <g key={it.key}>
            {it.piece && <FillPieceShape scene={scene} pc={it.piece} />}
            {cut.length > 0 && (
              <mask id={mid} maskUnits="userSpaceOnUse" x={r(bx.x1)} y={r(bx.y1)} width={r(bx.x2 - bx.x1)} height={r(bx.y2 - bx.y1)}>
                <rect x={r(bx.x1)} y={r(bx.y1)} width={r(bx.x2 - bx.x1)} height={r(bx.y2 - bx.y1)} fill="#fff" />
                {cut.map((h, k) => (
                  <line key={k} x1={r(h.p.x)} y1={r(h.p.y)} x2={r(h.q.x)} y2={r(h.q.y)} stroke="#000" strokeWidth={r(h.w)} strokeLinecap="round" />
                ))}
              </mask>
            )}
            <g mask={cut.length ? `url(#${mid})` : undefined}>
              {it.bonds.map((bd) => (
                <BondShape key={bd.id} scene={scene} b={bd} />
              ))}
            </g>
          </g>
        )
      })}
    </>
  )
}

// ---------- Ansatztabelle ----------

function StoichTableEl({ doc, t }: { doc: Doc; t: StoichTable }) {
  const g = tableGeom(doc, t)
  return (
    <g className="stoich-table">
      {g.lines.map((l, i) => (
        <line key={'l' + i} x1={l.x1} y1={l.y} x2={l.x2} y2={l.y} stroke={INK} strokeWidth={l.w} />
      ))}
      {g.cells.map((c, i) =>
        c.ghs ? (
          <g key={'c' + i}>
            {c.ghs.map((code, k) => (
              <GhsIcon key={code} code={code} x={c.x + k * c.ghsSize! * 1.02} y={c.y - c.ghsSize! * 0.7} size={c.ghsSize!} />
            ))}
          </g>
        ) : (
          <RichLines key={'c' + i} lay={c.lay} x={c.x} y={c.y} align={c.align} color={c.muted ? '#4b5260' : INK} />
        ),
      )}
    </g>
  )
}

// ---------- Gesamtes Dokument ----------

export function DocContent({ scene, exportMode = false }: { scene: Scene; exportMode?: boolean }) {
  const doc = scene.doc
  // gemeinsame Ebenen-Reihenfolge aller Objekte (Standard: Zyklen < Formen < Moleküle < Pfeile < Texte)
  const items = orderItems(scene)
  const lastMol = items.map((it) => it.kind).lastIndexOf('mol')
  const els: ReactElement[] = []
  items.forEach((it, i) => {
    switch (it.kind) {
      case 'cycle': {
        const c = doc.cycles[it.id]
        if (c) els.push(<CycleShape key={'y' + it.id} doc={doc} c={c} />)
        return
      }
      case 'shape':
        els.push(<ShapeEl key={'s' + it.id} s={doc.shapes[it.id]} doc={doc} />)
        return
      case 'arrow':
        els.push(<ArrowShape key={'a' + it.id} doc={doc} ar={doc.arrows[it.id]} />)
        return
      case 'curved':
        els.push(<CurvedShape key={'c' + it.id} scene={scene} ca={doc.curved[it.id]} />)
        return
      case 'text':
        els.push(<TextBlock key={'t' + it.id} t={doc.texts[it.id]} doc={doc} />)
        return
      case 'table': {
        const t = doc.tables[it.id]
        if (t) els.push(<StoichTableEl key={'st' + it.id} doc={doc} t={t} />)
        return
      }
      case 'mol': {
        if (scene.depth) {
          // 3D: alle Moleküle gemeinsam tiefensortiert (Bindungen + Ringfüllungen), an der Stelle des vordersten Moleküls
          if (i !== lastMol) return
          els.push(
            <g key="depth" className="molecules">
              <DepthLayer scene={scene} />
              {Object.values(doc.atoms).map((a) => (
                <AtomShape key={a.id} scene={scene} a={a} />
              ))}
            </g>,
          )
          return
        }
        // ein Molekül: Ringfüllungen, Bindungen, Atome
        const f = scene.frags[it.frag!]
        els.push(
          <g key={'m' + f.atoms[0]} className="molecule">
            {f.fills.map((id) => (
              <RingFillShape key={id} scene={scene} f={doc.fills[id]} />
            ))}
            <HighlightLayer scene={scene} atoms={f.atoms} bonds={f.bonds} />
            {f.bonds.map((id) => (
              <BondShape key={id} scene={scene} b={doc.bonds[id]} />
            ))}
            {f.atoms.map((id) => (
              <AtomShape key={id} scene={scene} a={doc.atoms[id]} />
            ))}
          </g>,
        )
        return
      }
    }
  })
  return (
    <g>
      {els}
      {!exportMode && <WarningMarks scene={scene} />}
    </g>
  )
}
