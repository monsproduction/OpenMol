import type { ReactElement } from 'react'

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

function poly(n: number, r = 7.2, cx = 10, cy = 10.5): string {
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`
  }).join(' ')
}

const ICONS: Record<string, ReactElement> = {
  select: <path {...S} d="M5 3l10 6.5-4.5 1L13 16l-2 1-2.6-5.5L5 14.5z" />,
  lasso: (
    <g {...S}>
      <ellipse cx="10.5" cy="8" rx="6.5" ry="4.5" strokeDasharray="2.2 2" />
      <path d="M6.5 11.5c-1.5 2 0 4 2 3.5" />
    </g>
  ),
  eraser: (
    <g {...S}>
      <path d="M7.5 16.5h9M3.8 12.4l7.3-7.3a1.6 1.6 0 0 1 2.3 0l2.6 2.6a1.6 1.6 0 0 1 0 2.3L10 16.5H7.5L3.8 12.8a.3.3 0 0 1 0-.4z" />
      <path d="M7.4 8.6l4.9 4.9" />
    </g>
  ),
  pan: <path {...S} d="M7 10V5.5a1.3 1.3 0 0 1 2.6 0V9m0-4.5V4a1.3 1.3 0 0 1 2.6 0v5m0-3.5a1.3 1.3 0 0 1 2.6 0V11c0 3.5-2 6-5.2 6-2.4 0-3.6-1.3-4.8-3.4L3.6 10.8a1.3 1.3 0 0 1 2.2-1.3L7 11" />,
  single: <path {...S} d="M4 15L16 5" />,
  double: <path {...S} d="M3.5 13.5L14.5 4M6 16L17 6.5" />,
  triple: <path {...S} d="M3 12.5L13 3.8M4.8 14.8l10-8.6M6.6 17l10-8.7" />,
  wedge: <path d="M4 15.5L16.5 4.5l1 1.6z" fill="currentColor" stroke="currentColor" strokeWidth={1} strokeLinejoin="round" />,
  hash: (
    <g {...S} strokeWidth={1.3}>
      <path d="M4.6 15.1l.4.5M6.8 12.9l1 1.2M9 10.7l1.6 1.9M11.2 8.5l2.2 2.6M13.4 6.3l2.8 3.3M15.6 4.1l3.3 4" />
    </g>
  ),
  wavy: <path {...S} d="M2.5 10q1.9-3.6 3.75 0t3.75 0 3.75 0 3.75 0" transform="rotate(-40 10 10)" />,
  bold: <path d="M4 15L16 5" fill="none" stroke="currentColor" strokeWidth={4.2} strokeLinecap="butt" />,
  dashed: <path {...S} d="M4 15L16 5" strokeDasharray="2.2 2.2" strokeLinecap="butt" />,
  aromatic: (
    <g {...S}>
      <path d="M3.5 13.5L14.5 4" />
      <path d="M6 16L17 6.5" strokeDasharray="2 2" strokeLinecap="butt" />
    </g>
  ),
  chain: <path {...S} d="M2.5 13l4-5 4 5 4-5 3.5 4.5" />,
  ring3: <polygon {...S} points={poly(3, 7.5, 10, 11.5)} />,
  ring4: <polygon {...S} points={poly(4, 7.2)} transform="rotate(45 10 10.5)" />,
  ring5: <polygon {...S} points={poly(5)} />,
  ring6: <polygon {...S} points={poly(6)} />,
  ring7: (
    <g>
      <polygon {...S} points={poly(7)} />
      <text x="10" y="13.6" textAnchor="middle" fontSize="8.5" fontWeight="600" fill="currentColor" fontFamily="Arial, sans-serif">
        7
      </text>
    </g>
  ),
  ring8: (
    <g>
      <polygon {...S} points={poly(8)} />
      <text x="10" y="13.6" textAnchor="middle" fontSize="8.5" fontWeight="600" fill="currentColor" fontFamily="Arial, sans-serif">
        8
      </text>
    </g>
  ),
  chair1: <polygon {...S} points="1.7,6.8 7.6,9.3 13.8,6.8 18.2,14.2 12.7,11.8 6.1,14.1" />,
  chair2: <polygon {...S} points="18.3,6.8 12.4,9.3 6.2,6.8 1.8,14.2 7.3,11.8 13.9,14.1" />,
  cyclopentadiene: (
    <g {...S}>
      <polygon points="10.0,3.5 16.7,8.3 14.1,16.2 5.9,16.2 3.3,8.3" />
      <path d="M14.5,9.8 L13.2,13.7 M6.8,13.7 L5.5,9.8" />
    </g>
  ),
  benzene: (
    <g {...S}>
      <polygon points={poly(6)} />
      <path d={`M${10 + 4.6 * Math.cos(-Math.PI / 6)},${10.5 + 4.6 * Math.sin(-Math.PI / 6)} L${10 + 4.6 * Math.cos(Math.PI / 6)},${10.5 + 4.6 * Math.sin(Math.PI / 6)}`} />
      <path d={`M${10 + 4.6 * Math.cos(Math.PI / 2)},${10.5 + 4.6 * Math.sin(Math.PI / 2)} L${10 + 4.6 * Math.cos((5 * Math.PI) / 6)},${10.5 + 4.6 * Math.sin((5 * Math.PI) / 6)}`} />
      <path d={`M${10 + 4.6 * Math.cos((7 * Math.PI) / 6)},${10.5 + 4.6 * Math.sin((7 * Math.PI) / 6)} L${10 + 4.6 * Math.cos((3 * Math.PI) / 2)},${10.5 + 4.6 * Math.sin((3 * Math.PI) / 2)}`} />
    </g>
  ),
  ringfill: (
    <g>
      <defs>
        <radialGradient id="rfIcon">
          <stop offset="0" stopColor="#1d2bd8" />
          <stop offset="1" stopColor="#9aa6ff" />
        </radialGradient>
      </defs>
      <polygon points={poly(6)} fill="url(#rfIcon)" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
    </g>
  ),
  elbow: (
    <g>
      <path {...S} d="M3 4.5h9.5v8" />
      <path d="M12.5 17l-3.2-5h6.4z" fill="currentColor" />
    </g>
  ),
  'elbow-v': (
    <g>
      <path {...S} d="M3.5 3v9.5H12" />
      <path d="M17 12.5l-5-3.2v6.4z" fill="currentColor" />
    </g>
  ),
  'step-h': (
    <g>
      <path {...S} d="M2.5 5H10v10h3.5" />
      <path d="M18 15l-5-3.2v6.4z" fill="currentColor" />
    </g>
  ),
  'bracket-h': (
    <g>
      <path {...S} d="M16 4H5v12h7" />
      <path d="M17.5 16l-5-3.2v6.4z" fill="currentColor" />
    </g>
  ),
  'bracket-v': (
    <g>
      <path {...S} d="M4 16V5h12v7" />
      <path d="M16 17.5l-3.2-5h6.4z" fill="currentColor" />
    </g>
  ),
  'step-v': (
    <g>
      <path {...S} d="M4 2.5V9h12v4" />
      <path d="M16 18l-3.2-5h6.4z" fill="currentColor" />
    </g>
  ),
  'heads-both': (
    <g>
      <path {...S} d="M5 10h10" />
      <path d="M18 10l-5-3.2v6.4zM2 10l5-3.2v6.4z" fill="currentColor" />
    </g>
  ),
  'heads-none': <path {...S} d="M3 10h14" />,
  'heads-start': (
    <g>
      <path {...S} d="M5 10h12.5" />
      <path d="M2 10l5-3.2v6.4z" fill="currentColor" />
    </g>
  ),
  tiltX: (
    <g {...S}>
      <ellipse cx="10" cy="10" rx="7" ry="3.2" />
      <path d="M10 2.5v15" strokeDasharray="1.6 1.6" />
    </g>
  ),
  tiltY: (
    <g {...S}>
      <ellipse cx="10" cy="10" rx="3.2" ry="7" />
      <path d="M2.5 10h15" strokeDasharray="1.6 1.6" />
    </g>
  ),
  skew: <path {...S} d="M6 4h11l-3 12H3z" />,
  number: (
    <text x="10" y="15" textAnchor="middle" fontSize="12.5" fontWeight="700" fill="currentColor" fontFamily="Arial, sans-serif">
      1
    </text>
  ),
  arrange: <path {...S} d="M2.5 10h3M7.5 10h2.5M13 10h4.5M15 7.5l2.5 2.5-2.5 2.5M4 6.5v7M11.5 6.5v7" />,
  cycle: (
    <g>
      <path {...S} d="M10 3.2a6.8 6.8 0 0 1 6.6 5.2M16.4 12.6A6.8 6.8 0 0 1 7.2 16.2M3.8 13A6.8 6.8 0 0 1 5.6 5" />
      <path d="M17 10.6l-2.6-2.3 3.3-.5zM5.2 17.4l1.9-2.8 1.4 3zM4.3 3.6l2.9 1.6-2.7 1.9z" fill="currentColor" />
    </g>
  ),
  'cyc-station': (
    <g>
      <path {...S} d="M10 3.2a6.8 6.8 0 0 1 6.8 6.8M16.8 10a6.8 6.8 0 1 1-10-6" strokeDasharray="0" />
      <rect x="7.5" y="1.6" width="5" height="3.4" rx="1" fill="currentColor" />
    </g>
  ),
  'cyc-in': (
    <g>
      <path {...S} d="M16.5 15.5A7 7 0 0 0 9.5 4" />
      <path {...S} d="M3 12.5c1.5-3.2 4-4.7 7.6-4.6" />
      <path d="M12.2 7.9l-2.6-1.9.4 3.2z" fill="currentColor" />
    </g>
  ),
  'cyc-out': (
    <g>
      <path {...S} d="M16.5 15.5A7 7 0 0 0 9.5 4" />
      <path {...S} d="M12.4 7.1c-3 .4-5.5 2-6.8 4.8" />
      <path d="M4.6 14.1l3.2-.8-2.4-2.3z" fill="currentColor" />
    </g>
  ),
  cw: <path {...S} d="M15.5 6.5A6.5 6.5 0 1 0 16.5 11M15.8 3.2v3.6h-3.6" />,
  ccw: <path {...S} d="M4.5 6.5A6.5 6.5 0 1 1 3.5 11M4.2 3.2v3.6h3.6" />,
  cube: (
    <g {...S}>
      <path d="M10 2.8l6.2 3.5v7.4L10 17.2l-6.2-3.5V6.3z" />
      <path d="M3.8 6.3L10 9.8l6.2-3.5M10 9.8v7.4" />
    </g>
  ),
  rot3d: (
    <g {...S}>
      <ellipse cx="10" cy="10" rx="7.5" ry="3" />
      <path d="M10 2.5v15M15.5 7.4l1.6-.7.2 1.8" />
    </g>
  ),
  flat: <path {...S} d="M3 13.5h14M5 9.5l5-3 5 3" strokeDasharray="0" />,
  magnet: <path {...S} d="M5 3.5v6.5a5 5 0 0 0 10 0V3.5h-3.2V10a1.8 1.8 0 0 1-3.6 0V3.5zM5 7h3.2M11.8 7H15" />,
  attach: <path {...S} d="M3 10h14M10 4c1.6 1 1.6 2 0 3s-1.6 2 0 3 1.6 2 0 3-1.6 2 0 3" />,
  atom: (
    <text x="10" y="14.8" textAnchor="middle" fontSize="13" fontWeight="600" fill="currentColor" fontFamily="Arial, sans-serif">
      N
    </text>
  ),
  'charge+': (
    <g {...S}>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 6.8v6.4M6.8 10h6.4" />
    </g>
  ),
  'charge-': (
    <g {...S}>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M6.8 10h6.4" />
    </g>
  ),
  radical: (
    <g>
      <text x="8" y="15" textAnchor="middle" fontSize="12" fill="currentColor" fontFamily="Arial, sans-serif">
        C
      </text>
      <circle cx="15.5" cy="5.5" r="1.8" fill="currentColor" />
    </g>
  ),
  lonepair: (
    <g>
      <text x="10" y="16" textAnchor="middle" fontSize="12" fill="currentColor" fontFamily="Arial, sans-serif">
        O
      </text>
      <circle cx="7.6" cy="3.8" r="1.4" fill="currentColor" />
      <circle cx="12.4" cy="3.8" r="1.4" fill="currentColor" />
    </g>
  ),
  'partial+': (
    <text x="10" y="14.5" textAnchor="middle" fontSize="12" fontStyle="italic" fill="currentColor" fontFamily="Georgia, serif">
      δ+
    </text>
  ),
  'partial-': (
    <text x="10" y="14.5" textAnchor="middle" fontSize="12" fontStyle="italic" fill="currentColor" fontFamily="Georgia, serif">
      δ−
    </text>
  ),
  reaction: (
    <g>
      <path {...S} d="M2.5 10h12" />
      <path d="M17.5 10l-5-3.2.9 3.2-.9 3.2z" fill="currentColor" />
    </g>
  ),
  equilibrium: (
    <g>
      <path {...S} d="M2.5 8h12M5.5 12h12" />
      <path d="M17.5 8l-5-3.2.9 3.2z M2.5 12l5 3.2-.9-3.2z" fill="currentColor" />
    </g>
  ),
  resonance: (
    <g>
      <path {...S} d="M5 10h10" />
      <path d="M18 10l-5-3.2.9 3.2-.9 3.2zM2 10l5-3.2-.9 3.2.9 3.2z" fill="currentColor" />
    </g>
  ),
  retro: <path {...S} d="M2.5 7.8h12M2.5 12.2h12M12.5 4.5L17.5 10l-5 5.5" />,
  'dashed-arrow': (
    <g>
      <path {...S} d="M2.5 10h11" strokeDasharray="2.2 1.8" strokeLinecap="butt" />
      <path d="M17.5 10l-5-3.2.9 3.2-.9 3.2z" fill="currentColor" />
    </g>
  ),
  failed: (
    <g>
      <path {...S} d="M2.5 10h12M7 7l4 6M11 7l-4 6" />
      <path d="M17.5 10l-5-3.2.9 3.2-.9 3.2z" fill="currentColor" />
    </g>
  ),
  'curved-full': (
    <g>
      <path {...S} d="M3.5 15.5C4 6 12 3.5 15.5 9" />
      <path d="M16.8 12.6l-4.4-2.4 2.7-.8.9-2.6z" fill="currentColor" />
    </g>
  ),
  'curved-half': (
    <g>
      <path {...S} d="M3.5 15.5C4 6 12 3.5 15.5 9" />
      <path d="M16.8 12.6l-4.4-2.4 2.7-.8z" fill="currentColor" />
    </g>
  ),
  text: <path {...S} d="M4.5 5V3.8h11V5M10 3.8v12.4M7.8 16.2h4.4" />,
  plus: <path {...S} strokeWidth={2} d="M10 4.5v11M4.5 10h11" />,
  rect: <rect {...S} x="3.5" y="5" width="13" height="10" rx="1.5" />,
  ellipse: <ellipse {...S} cx="10" cy="10" rx="7" ry="5" />,
  roundrect: (
    <g>
      <rect x="5" y="6" width="12.5" height="10.5" rx="3" fill="currentColor" opacity="0.3" />
      <rect {...S} x="3" y="4" width="12.5" height="10.5" rx="3" />
    </g>
  ),
  sphere: (
    <g>
      <circle {...S} cx="10" cy="10" r="6.8" />
      <circle cx="7.6" cy="7.4" r="2.2" fill="currentColor" opacity="0.35" />
      <path {...S} strokeWidth={1.2} opacity="0.55" d="M14.6 12.4a5.4 5.4 0 0 1-6.2 3.5" />
    </g>
  ),
  brackets: <path {...S} d="M6.5 3.5H4v13h2.5M13.5 3.5H16v13h-2.5" />,
  parens: <path {...S} d="M6.8 3.5c-3 3.5-3 9.5 0 13M13.2 3.5c3 3.5 3 9.5 0 13" />,
  braces: <path {...S} d="M7 3.5c-1.6 0-2 .8-2 2v2.6c0 1-.6 1.9-1.8 1.9 1.2 0 1.8.9 1.8 1.9v2.6c0 1.2.4 2 2 2M13 3.5c1.6 0 2 .8 2 2v2.6c0 1 .6 1.9 1.8 1.9-1.2 0-1.8.9-1.8 1.9v2.6c0 1.2-.4 2-2 2" />,
  template: (
    <g {...S}>
      <rect x="3" y="3" width="6" height="6" rx="1.2" />
      <rect x="11" y="3" width="6" height="6" rx="1.2" />
      <rect x="3" y="11" width="6" height="6" rx="1.2" />
      <rect x="11" y="11" width="6" height="6" rx="1.2" />
    </g>
  ),
  new: <path {...S} d="M11.5 2.8H5.6a1.4 1.4 0 0 0-1.4 1.4v11.6a1.4 1.4 0 0 0 1.4 1.4h8.8a1.4 1.4 0 0 0 1.4-1.4V7.1zM11.5 2.8v4.3h4.3M10 10v4.5M7.8 12.2h4.4" />,
  open: <path {...S} d="M2.8 15.5V5.2a1.4 1.4 0 0 1 1.4-1.4h3.5l1.6 1.8h5.3a1.4 1.4 0 0 1 1.4 1.4v1.2M2.8 15.5l2.3-6.3a1.4 1.4 0 0 1 1.3-.9h10.5a.8.8 0 0 1 .7 1.1l-2.2 6.1H2.8z" />,
  save: <path {...S} d="M4.2 3h9.3L17 6.5v9.3a1.2 1.2 0 0 1-1.2 1.2H4.2A1.2 1.2 0 0 1 3 15.8V4.2A1.2 1.2 0 0 1 4.2 3zM6.5 3v4h6V3M6 17v-5.5h8V17" />,
  undo: <path {...S} d="M7.5 5L4 8.5 7.5 12M4 8.5h8a4 4 0 0 1 0 8H9" />,
  redo: <path {...S} d="M12.5 5L16 8.5 12.5 12M16 8.5H8a4 4 0 0 0 0 8h3" />,
  zoomIn: <path {...S} d="M8.8 15.6a6.8 6.8 0 1 0 0-13.6 6.8 6.8 0 0 0 0 13.6zM17.5 17.5l-3.9-3.9M8.8 6v5.6M6 8.8h5.6" />,
  zoomOut: <path {...S} d="M8.8 15.6a6.8 6.8 0 1 0 0-13.6 6.8 6.8 0 0 0 0 13.6zM17.5 17.5l-3.9-3.9M6 8.8h5.6" />,
  fit: <path {...S} d="M3 7V4a1 1 0 0 1 1-1h3M13 3h3a1 1 0 0 1 1 1v3M17 13v3a1 1 0 0 1-1 1h-3M7 17H4a1 1 0 0 1-1-1v-3M7 8h6v4H7z" />,
  export: <path {...S} d="M10 12.5V3M6.5 6.5L10 3l3.5 3.5M4 11v4.8A1.2 1.2 0 0 0 5.2 17h9.6a1.2 1.2 0 0 0 1.2-1.2V11" />,
  import: <path {...S} d="M10 3v9.5M6.5 9L10 12.5 13.5 9M4 11v4.8A1.2 1.2 0 0 0 5.2 17h9.6a1.2 1.2 0 0 0 1.2-1.2V11" />,
  rotateL: <path {...S} d="M4.5 4.5v4h4M4.8 8.3A6 6 0 1 1 6 13.8" />,
  rotateR: <path {...S} d="M15.5 4.5v4h-4M15.2 8.3A6 6 0 1 0 14 13.8" />,
  flipH: <path {...S} d="M10 2.5v15M7.5 5.5L3 14.5h4.5zM12.5 5.5l4.5 9h-4.5z" />,
  flipV: <path {...S} d="M2.5 10h15M5.5 7.5L14.5 3v4.5zM5.5 12.5l9 4.5v-4.5z" />,
  clean: <path {...S} d="M10 2.8l1.6 3.6 3.6 1.6-3.6 1.6L10 13.2 8.4 9.6 4.8 8l3.6-1.6zM15.3 12.8l.8 1.8 1.8.8-1.8.8-.8 1.8-.8-1.8-1.8-.8 1.8-.8zM4.5 13.5l.6 1.3 1.3.6-1.3.6-.6 1.3-.6-1.3-1.3-.6 1.3-.6z" />,
  // Zahnrad (deutlich anders als die Sonne des Design-Schalters)
  settings: (
    <g>
      <circle {...S} cx="10" cy="10" r="2.4" />
      <path
        {...S}
        d="M8.6 2.6h2.8l.4 2a5.6 5.6 0 0 1 1.5.9l1.9-.7 1.4 2.4-1.5 1.3a5.6 5.6 0 0 1 0 1.8l1.5 1.3-1.4 2.4-1.9-.7a5.6 5.6 0 0 1-1.5.9l-.4 2H8.6l-.4-2a5.6 5.6 0 0 1-1.5-.9l-1.9.7-1.4-2.4 1.5-1.3a5.6 5.6 0 0 1 0-1.8L3.4 7.2l1.4-2.4 1.9.7a5.6 5.6 0 0 1 1.5-.9z"
      />
    </g>
  ),
  sidebar: (
    <g>
      <rect {...S} x="2.5" y="3.5" width="15" height="13" rx="2" />
      <path {...S} d="M12.5 3.5v13" />
    </g>
  ),
  help: <path {...S} d="M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM7.7 7.6a2.4 2.4 0 0 1 4.6.8c0 1.6-2.3 2.2-2.3 2.2M10 13.8h.01" />,
  copy: <path {...S} d="M7 7V4.2A1.2 1.2 0 0 1 8.2 3h7.6A1.2 1.2 0 0 1 17 4.2v7.6a1.2 1.2 0 0 1-1.2 1.2H13M4.2 7h7.6A1.2 1.2 0 0 1 13 8.2v7.6a1.2 1.2 0 0 1-1.2 1.2H4.2A1.2 1.2 0 0 1 3 15.8V8.2A1.2 1.2 0 0 1 4.2 7z" />,
  // Anordnung: gefülltes Quadrat = ausgewähltes Objekt
  'order-front': (
    <g>
      <rect {...S} x="3" y="3" width="9" height="9" rx="1.5" />
      <rect {...S} x="8" y="8" width="9" height="9" rx="1.5" fill="currentColor" />
    </g>
  ),
  'order-back': (
    <g>
      <rect x="3" y="3" width="9" height="9" rx="1.5" fill="currentColor" stroke="currentColor" strokeWidth={1.6} />
      <rect {...S} x="8" y="8" width="9" height="9" rx="1.5" fill="var(--panel, #fff)" />
    </g>
  ),
  'order-forward': (
    <g>
      <rect {...S} x="3" y="7" width="8" height="8" rx="1.5" />
      <rect {...S} x="9" y="5" width="8" height="8" rx="1.5" fill="currentColor" />
      <path {...S} d="M13 3.5V1.8M11.6 3l1.4-1.4L14.4 3" />
    </g>
  ),
  'order-backward': (
    <g>
      <rect x="3" y="5" width="8" height="8" rx="1.5" fill="currentColor" stroke="currentColor" strokeWidth={1.6} />
      <rect {...S} x="9" y="7" width="8" height="8" rx="1.5" fill="var(--panel, #fff)" />
      <path {...S} d="M7 16.5v1.7M5.6 17l1.4 1.4L8.4 17" />
    </g>
  ),
  'cyc-pair': (
    <g>
      <path {...S} d="M3 15.5c3-1 4.5-3.5 5-6.5" />
      <path {...S} d="M8 9c.6 3 2.5 5 5.5 6.2" />
      <path {...S} strokeDasharray="2 2" d="M2.5 5.5c3.5-2.5 11.5-2.5 15 0" />
      <path d="M16.6 16.8l-3.4-.2 1.6-2.4z" fill="currentColor" />
    </g>
  ),
  'cyc-second': (
    <g>
      <circle {...S} cx="8" cy="11" r="5.6" />
      <circle {...S} cx="14" cy="6.5" r="3.6" />
    </g>
  ),
  edit: <path {...S} d="M12.8 4.2l3 3L7.5 15.5H4.5v-3zM11.2 5.8l3 3" />,
  trash: <path {...S} d="M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M5.2 5.5l.7 10.4a1.2 1.2 0 0 0 1.2 1.1h5.8a1.2 1.2 0 0 0 1.2-1.1l.7-10.4" />,
  alignL: <path {...S} d="M3.5 3v14M6.5 6h9M6.5 10h5M6.5 14h7.5" />,
  alignC: <path {...S} d="M10 3v14M4.5 6h11M6.5 10h7M5.5 14h9" />,
  alignR: <path {...S} d="M16.5 3v14M4.5 6h9M8.5 10h5M6 14h7.5" />,
  alignT: <path {...S} d="M3 3.5h14M6 6.5v9M10 6.5v5M14 6.5v7.5" />,
  alignM: <path {...S} d="M3 10h14M6 4.5v11M10 6.5v7M14 5.5v9" />,
  alignB: <path {...S} d="M3 16.5h14M6 4.5v9M10 8.5v5M14 6v7.5" />,
  search: <path {...S} d="M8.8 15.6a6.8 6.8 0 1 0 0-13.6 6.8 6.8 0 0 0 0 13.6zM17.5 17.5l-3.9-3.9" />,
  table: (
    <g {...S}>
      <rect x="2.5" y="4" width="15" height="12" rx="1.5" />
      <path d="M2.5 8h15M7.5 4v12M12.5 4v12" />
    </g>
  ),
  sun: <path {...S} d="M10 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM10 2v1.5M10 16.5V18M2 10h1.5M16.5 10H18M4.3 4.3l1.1 1.1M14.6 14.6l1.1 1.1M4.3 15.7l1.1-1.1M14.6 5.4l1.1-1.1" />,
  moon: <path {...S} d="M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7z" />,
  chevron: <path {...S} d="M7 8l3 3 3-3" />,
  close: <path {...S} d="M5 5l10 10M15 5L5 15" />,
  image: (
    <g {...S}>
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.6" />
      <circle cx="7" cy="8" r="1.5" />
      <path d="M17.5 13l-4-4-8.5 7.5" />
    </g>
  ),
}

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="icon">
      {ICONS[name] ?? <circle cx="10" cy="10" r="3" fill="currentColor" />}
    </svg>
  )
}
