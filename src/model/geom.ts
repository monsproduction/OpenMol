export interface Pt {
  x: number
  y: number
}

export const pt = (x: number, y: number): Pt => ({ x, y })
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })
export const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k })
export const len = (a: Pt): number => Math.hypot(a.x, a.y)
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y)
export const norm = (a: Pt): Pt => {
  const l = len(a) || 1
  return { x: a.x / l, y: a.y / l }
}
/** Senkrechte (90° gegen den Uhrzeigersinn im Bildschirm-Koordinatensystem) */
export const perp = (a: Pt): Pt => ({ x: a.y, y: -a.x })
export const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y
export const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x
export const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
export const mid = (a: Pt, b: Pt): Pt => lerp(a, b, 0.5)
export const angleOf = (v: Pt): number => Math.atan2(v.y, v.x)
export const fromAngle = (a: number, l = 1): Pt => ({ x: Math.cos(a) * l, y: Math.sin(a) * l })

export function rotateAround(p: Pt, c: Pt, a: number): Pt {
  const s = Math.sin(a)
  const co = Math.cos(a)
  const dx = p.x - c.x
  const dy = p.y - c.y
  return { x: c.x + dx * co - dy * s, y: c.y + dx * s + dy * co }
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  if (l2 === 0) return dist(p, a)
  let t = dot(sub(p, a), ab) / l2
  t = Math.max(0, Math.min(1, t))
  return dist(p, add(a, mul(ab, t)))
}

export function normAngle(a: number): number {
  while (a <= -Math.PI) a += 2 * Math.PI
  while (a > Math.PI) a -= 2 * Math.PI
  return a
}

export function angleDiff(a: number, b: number): number {
  return Math.abs(normAngle(a - b))
}

export function snapAngle(a: number, stepDeg = 15): number {
  const step = (stepDeg * Math.PI) / 180
  return Math.round(a / step) * step
}

/** Bisektor der größten Winkellücke zwischen gegebenen Richtungen */
export function largestGapBisector(angles: number[]): number {
  if (angles.length === 0) return -Math.PI / 6
  if (angles.length === 1) return angles[0] + Math.PI
  const s = [...angles].map((a) => (a + 2 * Math.PI) % (2 * Math.PI)).sort((a, b) => a - b)
  let best = 0
  let bestGap = -1
  for (let i = 0; i < s.length; i++) {
    const a = s[i]
    const b = i === s.length - 1 ? s[0] + 2 * Math.PI : s[i + 1]
    const g = b - a
    if (g > bestGap) {
      bestGap = g
      best = a + g / 2
    }
  }
  return normAngle(best)
}

export interface Box {
  x1: number
  y1: number
  x2: number
  y2: number
}

export function boxFromPts(a: Pt, b: Pt): Box {
  return { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) }
}

export function inBox(p: Pt, b: Box): boolean {
  return p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2
}

export function unionBox(a: Box | null, b: Box): Box {
  if (!a) return { ...b }
  return { x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) }
}

export function quadPoint(p0: Pt, c: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y }
}

export function distToQuad(p: Pt, p0: Pt, c: Pt, p1: Pt): number {
  let best = Infinity
  let prev = p0
  for (let i = 1; i <= 24; i++) {
    const q = quadPoint(p0, c, p1, i / 24)
    best = Math.min(best, distToSegment(p, prev, q))
    prev = q
  }
  return best
}

/** Schnittpunkt eines Strahls von der Mitte eines Rechtecks nach außen (Halbbreiten hw, hh) */
export function rectExit(dir: Pt, hw: number, hh: number): number {
  const ax = Math.abs(dir.x)
  const ay = Math.abs(dir.y)
  const tx = ax > 1e-9 ? hw / ax : Infinity
  const ty = ay > 1e-9 ? hh / ay : Infinity
  return Math.min(tx, ty)
}

/** Lasso: Punkt-in-Polygon-Test */
export function inPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
