// Datenmodell des Dokuments. Koordinaten in Dokument-Einheiten (1 = 1px bei 100 % Zoom),
// y-Achse zeigt wie im Bildschirm nach unten.

export type Id = string

export interface Atom {
  id: Id
  x: number
  y: number
  /** Elementsymbol, z. B. "C", "N", "Cl" */
  element: string
  /** Freier Text statt Elementsymbol, z. B. "OMe", "Ph", "CO2H" – darf Rich-Text enthalten (b, i, sup, sub …) */
  label?: string
  charge: number
  /** 0 = keins, 1 = Radikal (Dublett), 2 = Diradikal */
  radical: number
  lonePairs: number
  isotope?: number
  /** δ+ / δ− */
  partial?: '+' | '-'
  color?: string
  /** farbige Hintergrundbox hinter dem Label */
  bg?: string
  /** Textmarker: farbiger, breiter Streifen hinter Atom und Bindungen (Molekülteile „leuchten“) */
  highlight?: string
  opacity?: number
  /** Anknüpfungspunkt (Wellenlinie quer zur Bindung) */
  attach?: boolean
  /** Beschriftung fett/kursiv (ganzes Atom) */
  bold?: boolean
  italic?: boolean
  /** bei fettem Atom: angrenzende Bindungen in der Strichstärke des fetten Buchstabens */
  boldBonds?: boolean
  /** manuell verschobene Ladung / Partialladung (Versatz zum Atom) */
  chargeOff?: { x: number; y: number }
  partialOff?: { x: number; y: number }
  /** manuell verschobene freie Elektronenpaare / Radikalpunkte (je Index, Versatz zum Atom) */
  lpOff?: ({ x: number; y: number } | null)[]
  radOff?: ({ x: number; y: number } | null)[]
  /** Beschriftung vom Nutzer eingetippt → wörtlich anzeigen (nicht spiegeln/umbauen) */
  literal?: boolean
  /** Kohlenstoff ausdrücklich beschriften (sonst sind C-Atome in Ketten/Ringen unsichtbar) */
  showC?: boolean
  /** als Stereozentrum markiert („*“) */
  stereoMark?: boolean
  /** CIP-Deskriptor (R/S) an diesem Atom anzeigen */
  showCip?: boolean
  /** manuell verschobene Stereo-Markierung (Versatz zum Atom) */
  stereoOff?: { x: number; y: number }
  /** Tiefe für 3D-Darstellung (positiv = zum Betrachter) */
  z?: number
  /** ursprüngliche 2D-Lage vor dem ersten 3D-Schritt (für „Zurück zu 2D“) */
  flat2d?: { x: number; y: number }
  /** Ebene des Moleküls (alle Atome eines Moleküls tragen denselben Wert; größer = weiter vorn) */
  order?: number
}

export type BondType =
  | 'single'
  | 'double'
  | 'triple'
  | 'wedge'
  | 'hash'
  | 'wavy'
  | 'bold'
  | 'dashed'
  | 'aromatic' // gestrichelte Zweitlinie (delokalisiert)

export type DoublePos = 'auto' | 'center' | 'left' | 'right'

export interface Bond {
  id: Id
  a1: Id
  a2: Id
  type: BondType
  doublePos: DoublePos
  color?: string
  /** Textmarker: farbiger, breiter Streifen hinter der Bindung */
  highlight?: string
  opacity?: number
  /** Faktor für die Linienstärke */
  width?: number
  /** nur Doppelbindung: Konfiguration (E/Z) unbestimmt – als gekreuzte Doppelbindung gezeichnet (wie ChemDraw) */
  crossed?: boolean
}

export type ArrowKind =
  | 'reaction'
  | 'equilibrium'
  | 'resonance'
  | 'retro'
  | 'dashed'
  | 'failed'

const ARROW_KINDS: ArrowKind[] = ['reaction', 'equilibrium', 'resonance', 'retro', 'dashed', 'failed']

export interface Arrow {
  id: Id
  kind: ArrowKind
  x1: number
  y1: number
  x2: number
  y2: number
  /** Bedingungen über/unter dem Pfeil (Rich-Text, HTML-Teilmenge) */
  above: string
  below: string
  color?: string
  route?: ArrowRoute
  heads?: 'end' | 'both' | 'none' | 'start'
  /** Lage des Mittelsegments bei Stufenpfeilen (0–1) */
  stepPos?: number
  /** Klammerpfeil: wie weit das Mittelstück seitlich herausragt (Dokument-Einheiten; negativ = links bzw. oben) */
  reach?: number
  /** Lage der Beschriftung entlang des Pfeils (0–1, Standard Mitte) */
  labelPos?: number
  /** Ausbeute, z. B. „86“ oder „86 %“ – fett unter den Bedingungen (senkrecht: rechts darunter) */
  yieldText?: string
  /** Winkelpfeil: Bedingungen am waagerechten (Standard) oder senkrechten Teilstück */
  labelSeg?: 'h' | 'v'
  /** fett: Linien in der Strichstärke eines fetten Buchstabens, Texte fett */
  bold?: boolean
  opacity?: number
  width?: number
  /** Ebene (Reihenfolge beim Zeichnen; größer = weiter vorn). Fehlt sie, gilt die Standardreihenfolge der Objektart */
  order?: number
}

/** Pfeilverlauf: gerade, Winkel (erst horizontal / erst vertikal), Stufe */
export type ArrowRoute = 'straight' | 'elbow-h' | 'elbow-v' | 'step-h' | 'step-v' | 'bracket-h' | 'bracket-v'

export type Anchor =
  | { type: 'atom'; id: Id }
  | { type: 'bond'; id: Id }
  | { type: 'lp'; id: Id; index: number }
  | { type: 'point'; x: number; y: number }

export interface CurvedArrow {
  id: Id
  head: 'full' | 'half'
  from: Anchor
  to: Anchor
  /** Krümmung relativ zur Pfeillänge; Vorzeichen = Seite */
  bend: number
  color?: string
  /** fett: Linien in der Strichstärke eines fetten Buchstabens, Texte fett */
  bold?: boolean
  opacity?: number
  /** Ebene (Reihenfolge beim Zeichnen; größer = weiter vorn). Fehlt sie, gilt die Standardreihenfolge der Objektart */
  order?: number
}

export interface TextObj {
  id: Id
  x: number
  y: number
  /** Rich-Text als HTML-Teilmenge (b, i, u, sup, sub, font/span mit Farbe/Schrift), Zeilenumbruch = \n */
  text: string
  size: number
  bold?: boolean
  italic?: boolean
  color?: string
  font?: string
  /** Hintergrundfarbe (Box) */
  bg?: string
  /** Textmarker hinter dem Text */
  highlight?: string
  align?: 'left' | 'center' | 'right'
  /** ganzer Text als Summenformel (H2O → H₂O); Standard: aus – einzelne Teile über „Summenformel“ */
  chem?: boolean
  opacity?: number
  /** Ebene (Reihenfolge beim Zeichnen; größer = weiter vorn). Fehlt sie, gilt die Standardreihenfolge der Objektart */
  order?: number
}

export type ShapeKind = 'rect' | 'roundrect' | 'ellipse' | 'sphere' | 'brackets' | 'parens' | 'braces'

/** Geschlossene Formen (Füllung, Schatten, Rahmen) – im Gegensatz zu Klammern */
export const CLOSED_SHAPES: ReadonlySet<ShapeKind> = new Set<ShapeKind>(['rect', 'roundrect', 'ellipse', 'sphere'])

export interface Shape {
  id: Id
  kind: ShapeKind
  x1: number
  y1: number
  x2: number
  y2: number
  dashed?: boolean
  /** Hochgestellter Text rechts oben an Klammern, z. B. "‡" oder "n" */
  corner?: string
  color?: string
  /** Füllfarbe (Rechteck/Ellipse/Kugel; bei Verlauf: Farbe 1) */
  fill?: string
  /** Farbverlauf der Füllung */
  fillGrad?: 'none' | 'linear' | 'radial'
  fill2?: string
  fillAngle?: number
  fillOpacity?: number
  /** Eckradius (abgerundetes Rechteck) */
  radius?: number
  /** Schlagschatten rechts unten */
  shadow?: boolean
  /** ohne Umrandung */
  noStroke?: boolean
  /** fett: Linien in der Strichstärke eines fetten Buchstabens, Texte fett */
  bold?: boolean
  /** Index rechts unten an Klammern, z. B. „n“ für Polymere */
  sub?: string
  /** zyklische Wiederholungseinheit: die beiden aus den Klammern führenden Bindungen sind über einen Ring
   *  (Ellipse) verbunden – Kurzschreibweise für Makrozyklen wie Pillar[5]aren */
  cyclic?: boolean
  /** Polymer: Kettenlänge n bzw. mittlere Molmasse Mn (für die Gesamtmasse, wenn der Index keine Zahl ist) */
  polyN?: number
  polyMn?: number
  opacity?: number
  /** Ebene (Reihenfolge beim Zeichnen; größer = weiter vorn). Fehlt sie, gilt die Standardreihenfolge der Objektart */
  order?: number
}

/** Station (Unterbrechung) eines Katalysezyklus, z. B. für eine Zwischenstufe */
export interface CycleStation {
  /** Winkel in Grad (0 = rechts, im Uhrzeigersinn) */
  angle: number
  /** Lücke in Grad; ohne Angabe automatisch aus der Beschriftung bzw. Standardlücke */
  gap?: number
  /** einseitig verstellte Lücke: halbe Breite zur Seite kleinerer bzw. größerer Winkel (überschreibt gap je Seite) */
  gapLo?: number
  gapHi?: number
  /** Beschriftung in der Lücke (Rich-Text) */
  label?: string
}

/** Zu- oder Abfluss: gebogener Seitenpfeil, der tangential in den Zyklus mündet bzw. ihn verlässt */
export interface CycleBranch {
  id: Id
  angle: number
  type: 'in' | 'out'
  /** außen oder innen */
  side: 'out' | 'in'
  /** Bogenlänge entlang des Zyklus in Grad */
  span: number
  /** Abstand des freien Endes vom Zyklus */
  reach: number
  head?: boolean
  label?: string
}

/** Verbindungspfeil von diesem Zyklus zu einem anderen: verlässt den Zyklus tangential und mündet tangential in den Zielzyklus */
export interface CycleLink {
  id: Id
  /** Startwinkel auf diesem Zyklus */
  angle: number
  /** Zielzyklus */
  target: Id
  /** Endwinkel auf dem Zielzyklus */
  tAngle: number
  /** Krümmung (Faktor für die Tangentenlänge, Standard 1) */
  bend?: number
  head?: boolean
  label?: string
}

/** Schrittbezeichnung an einem Bogen, z. B. „oxidative Addition“ (bewegt sich mit dem Zyklus) */
export interface CycleArcLabel {
  id: Id
  /** Winkel auf dem Zyklus in Grad */
  angle: number
  /** innen oder außen */
  side: 'in' | 'out'
  /** zusätzlicher Abstand von der Linie */
  off?: number
  label: string
}

export interface Cycle {
  id: Id
  cx: number
  cy: number
  rx: number
  ry: number
  dir: 'cw' | 'ccw'
  stations: CycleStation[]
  branches: CycleBranch[]
  /** Verbindungspfeile zu anderen Zyklen (ältere Dokumente) */
  links?: CycleLink[]
  /** Schrittbezeichnungen an den Bögen */
  arcLabels?: CycleArcLabel[]
  /** Standardlücke in Grad */
  gap: number
  heads: boolean
  color?: string
  /** fett: Linien in der Strichstärke eines fetten Buchstabens, Texte fett */
  bold?: boolean
  width?: number
  dashed?: boolean
  opacity?: number
  /** Ebene (Reihenfolge beim Zeichnen; größer = weiter vorn). Fehlt sie, gilt die Standardreihenfolge der Objektart */
  order?: number
}

/** Ringfüllung oder aromatischer Kreis; mehrere anellierte Ringe teilen sich einen Farbverlauf */
export interface RingFill {
  id: Id
  /** Ringe als geordnete Atom-ID-Zyklen */
  rings: Id[][]
  mode: 'fill' | 'circle'
  grad: 'none' | 'linear' | 'radial'
  c1: string
  c2: string
  /** Winkel für linearen Verlauf in Grad */
  angle: number
  opacity: number
}

export interface DocStyle {
  bondLength: number
  lineWidth: number
  fontSize: number
  chargeCircle: boolean
  showWarnings: boolean
  showCarbons: boolean
  colorAtoms: boolean
  /** Schriftart für Atom-Labels und Standardtext */
  font: string
  /** 3D-Tiefe darstellen (hinten grau, vorne darüber) */
  depth3d?: boolean
  /** R/S an allen Stereozentren anzeigen */
  showCip?: boolean
  /** Hintergrundfarbe des Dokuments (Zeichenfläche und Export); fehlt sie, ist der Hintergrund weiß */
  background?: string
  /** Seitenlayout (A4, PowerPoint …); fehlt es, ist die Zeichenfläche unbegrenzt */
  page?: PageLayout
}

/** Raster gleich großer Seiten: linke obere Ecke x/y (Dokument-Einheiten), Spalten × Zeilen (siehe model/pages.ts) */
export interface PageLayout {
  format: string
  landscape?: boolean
  x: number
  y: number
  cols: number
  rows: number
}

// ---------- Ansatztabelle (Stöchiometrie) ----------

export type StoichRole = 'reactant' | 'reagent' | 'catalyst' | 'solvent' | 'product'
/** Größe, die der Nutzer zuletzt eingegeben hat (daraus wird der Rest berechnet) */
export type StoichDriver = 'eq' | 'mass' | 'volume' | 'moles'
/** Anzeige-Einheiten je Größe; fehlt eine, wird automatisch gewählt */
export type StoichUnitKey = 'm' | 'n' | 'V' | 'obt'

export interface StoichRow {
  id: Id
  role: StoichRole
  /** verknüpfte Struktur: ein Atom des Moleküls (Formel und Molmasse kommen live aus der Zeichnung) */
  atom?: Id
  /** Anzeigename (sonst Summenformel) */
  name?: string
  /** CAS-Registriernummer (z. B. „109-99-9“) */
  cas?: string
  /** GHS-Piktogramme (GHS01 … GHS09) und ihre Quelle (z. B. EU-Einstufung laut PubChem) */
  ghs?: string[]
  ghsSource?: string
  /** CAS/GHS wurden bereits in PubChem gesucht (nicht bei jedem Öffnen erneut) */
  safetyChecked?: boolean
  /** als SMILES eingegebener Stoff ohne verknüpfte Struktur (für die CAS-Suche) */
  smiles?: string
  /** ohne Struktur: Summenformel bzw. Molmasse von Hand */
  formula?: string
  mw?: number
  /** limitierendes Edukt (Bezug der Äquivalente) */
  ref?: boolean
  driver?: StoichDriver
  eq?: number
  /** Masse in g, Volumen in L, Stoffmenge in mol */
  mass?: number
  volume?: number
  moles?: number
  /** Dichte in g/mL, Konzentration (Lösung) in mol/L – zwei getrennte Spalten der Ansatztabelle */
  density?: number
  conc?: number
  /** Lösungsmittel einer eingesetzten Lösung (z. B. „n-Hexan“ bei NaHMDS 2,0 M in n-Hexan) */
  solvent?: string
  /** Produkt: erhaltene Masse in g */
  obtained?: number
  /** Lösungsmittel: Anteil im Gemisch (Volumenteile, z. B. 5 und 1 für 5:1 v/v) – mit Zielkonzentration der Tabelle */
  parts?: number
  units?: Partial<Record<StoichUnitKey, string>>
}

export interface StoichTable {
  id: Id
  /** linke obere Ecke */
  x: number
  y: number
  lang: 'de' | 'en'
  rows: StoichRow[]
  temperature?: string
  time?: string
  atmosphere?: string
  notes?: string
  /** Zielkonzentration (mol/L) des Bezugsedukts in allen Lösungsmitteln: die Lösungsmittel-Volumina werden berechnet */
  targetConc?: number
  /** verknüpfter Reaktionspfeil; Bedingungen und Lösungsmittel werden in beide Richtungen abgeglichen */
  link?: ReactionLink
  /** Schriftgröße relativ zur Dokumentschrift */
  scale?: number
  order?: number
}

/** Verknüpfung Ansatztabelle ↔ Reaktionspfeil samt den zuletzt abgeglichenen Werten (daran erkennt der Abgleich, welche
 *  Seite sich geändert hat) */
export interface ReactionLink {
  arrow: Id
  temperature?: string
  time?: string
  atmosphere?: string
  /** Lösungsmittel als Schlüssel, z. B. „acoh/h2o|5:1“ */
  solvents?: string
}

export interface Doc {
  atoms: Record<Id, Atom>
  bonds: Record<Id, Bond>
  arrows: Record<Id, Arrow>
  curved: Record<Id, CurvedArrow>
  texts: Record<Id, TextObj>
  shapes: Record<Id, Shape>
  fills: Record<Id, RingFill>
  cycles: Record<Id, Cycle>
  tables: Record<Id, StoichTable>
  style: DocStyle
  /** Gruppen (⌘G): werden immer als Ganzes ausgewählt, siehe model/groups.ts */
  groups?: Record<Id, Group>
  /** gesperrte Objekte (nicht anklickbar/verschiebbar) */
  locked?: ObjLists
}

/** Listen von Objekt-Ids je Art (wie eine Auswahl, alle Arten optional) */
export type ObjLists = Partial<Record<ObjKind, Id[]>>

export interface Group {
  id: Id
  items: ObjLists
}

export type ObjKind = 'atoms' | 'bonds' | 'arrows' | 'curved' | 'texts' | 'shapes' | 'fills' | 'cycles' | 'tables'

export interface Selection {
  atoms: Id[]
  bonds: Id[]
  arrows: Id[]
  curved: Id[]
  texts: Id[]
  shapes: Id[]
  fills: Id[]
  cycles: Id[]
  tables: Id[]
}

export const FONTS: { name: string; css: string }[] = [
  { name: 'Arial', css: 'Arial, "Helvetica Neue", Helvetica, sans-serif' },
  { name: 'Helvetica', css: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { name: 'Times New Roman', css: '"Times New Roman", Times, serif' },
  { name: 'Georgia', css: 'Georgia, serif' },
  { name: 'Palatino', css: 'Palatino, "Palatino Linotype", "Book Antiqua", serif' },
  { name: 'Verdana', css: 'Verdana, Geneva, sans-serif' },
  { name: 'Trebuchet MS', css: '"Trebuchet MS", sans-serif' },
  { name: 'Gill Sans', css: '"Gill Sans", "Gill Sans MT", Calibri, sans-serif' },
  { name: 'Avenir', css: 'Avenir, "Avenir Next", Montserrat, sans-serif' },
  { name: 'Futura', css: 'Futura, "Century Gothic", sans-serif' },
  { name: 'Calibri', css: 'Calibri, Carlito, sans-serif' },
  { name: 'Courier New', css: '"Courier New", Courier, monospace' },
]

/** Farbangabe, die gefahrlos in SVG/HTML-Attribute darf (#rgb, #rrggbb(aa), Farbnamen, rgb()/hsl()); sonst undefined */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(?:rgb|hsl)a?\([\d\s.,%]+\))$/i
export function safeColor(c: unknown): string | undefined {
  return typeof c === 'string' && SAFE_COLOR.test(c.trim()) ? c.trim() : undefined
}

/** höchstens so viele Seiten je Richtung (Seitenlayout) */
export const MAX_PAGES = 50

/** Seitenformate in pt (kurze × lange Seite); landscape = Standardausrichtung beim Auswählen (siehe model/pages.ts) */
const mmPt = (v: number) => (v * 72) / 25.4
export const PAGE_FORMATS: { id: string; name: string; short: number; long: number; landscape?: boolean }[] = [
  { id: 'A0', name: 'A0', short: mmPt(841), long: mmPt(1189) },
  { id: 'A1', name: 'A1', short: mmPt(594), long: mmPt(841) },
  { id: 'A2', name: 'A2', short: mmPt(420), long: mmPt(594) },
  { id: 'A3', name: 'A3', short: mmPt(297), long: mmPt(420) },
  { id: 'A4', name: 'A4', short: mmPt(210), long: mmPt(297) },
  { id: 'A5', name: 'A5', short: mmPt(148), long: mmPt(210) },
  { id: 'A6', name: 'A6', short: mmPt(105), long: mmPt(148) },
  { id: 'letter', name: 'US Letter', short: 8.5 * 72, long: 11 * 72 },
  { id: 'legal', name: 'US Legal', short: 8.5 * 72, long: 14 * 72 },
  { id: 'ppt169', name: 'PowerPoint 16:9', short: 7.5 * 72, long: 13.333 * 72, landscape: true },
  { id: 'ppt43', name: 'PowerPoint 4:3', short: 7.5 * 72, long: 10 * 72, landscape: true },
  { id: 'poster2436', name: 'Poster 24 × 36″', short: 24 * 72, long: 36 * 72 },
  { id: 'poster3648', name: 'Poster 36 × 48″', short: 36 * 72, long: 48 * 72 },
]

export function fontCss(name: string | undefined): string {
  return FONTS.find((f) => f.name === name)?.css ?? FONTS[0].css
}

export const STYLE_PRESETS: Record<string, { name: string; style: DocStyle }> = {
  standard: {
    name: 'Standard',
    style: {
      bondLength: 40,
      lineWidth: 1.8,
      fontSize: 20,
      chargeCircle: true,
      showWarnings: true,
      showCarbons: false,
      colorAtoms: false,
      font: 'Arial',
    },
  },
  acs: {
    name: 'ACS 1996',
    style: {
      bondLength: 40,
      lineWidth: 1.67,
      fontSize: 27.8,
      chargeCircle: false,
      showWarnings: true,
      showCarbons: false,
      colorAtoms: false,
      font: 'Arial',
    },
  },
  presentation: {
    name: 'Präsentation',
    style: {
      bondLength: 40,
      lineWidth: 2.6,
      fontSize: 22,
      chargeCircle: true,
      showWarnings: true,
      showCarbons: false,
      colorAtoms: false,
      font: 'Arial',
    },
  },
}

export function emptyDoc(): Doc {
  return {
    atoms: {},
    bonds: {},
    arrows: {},
    curved: {},
    texts: {},
    shapes: {},
    fills: {},
    cycles: {},
    tables: {},
    style: { ...STYLE_PRESETS.standard.style },
  }
}

/**
 * Geladenes Dokument (Datei, Autosave) absichern: fehlende Bereiche ergänzen, Bindungen ohne Atome,
 * Atome ohne gültige Koordinaten und Ringfüllungen mit fehlenden Atomen entfernen, Zyklus-Radien begrenzen.
 */
export function normalizeDoc(raw: Partial<Doc>): Doc {
  const base = emptyDoc()
  const obj = <T,>(v: T | undefined | null, fb: T): T => (v && typeof v === 'object' && !Array.isArray(v) ? v : fb)
  const d: Doc = {
    ...base,
    ...raw,
    atoms: obj(raw.atoms, {}),
    bonds: obj(raw.bonds, {}),
    arrows: obj(raw.arrows, {}),
    curved: obj(raw.curved, {}),
    texts: obj(raw.texts, {}),
    shapes: obj(raw.shapes, {}),
    fills: obj(raw.fills, {}),
    cycles: obj(raw.cycles, {}),
    tables: obj(raw.tables, {}),
    style: { ...base.style, ...obj(raw.style, base.style) },
  }
  const ok = (n: unknown) => typeof n === 'number' && Number.isFinite(n)
  // Stil aus der Datei prüfen: unsinnige Werte (Text statt Zahl, 0, negativ) machen sonst die ganze Zeichnung kaputt,
  // und die Hintergrundfarbe landet im SVG/PDF-Export – nur echte Farbangaben übernehmen
  const st = d.style
  const def = base.style
  const inRange = (v: unknown, lo: number, hi: number, fb: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : fb)
  st.bondLength = inRange(st.bondLength, 5, 400, def.bondLength)
  st.lineWidth = inRange(st.lineWidth, 0.1, 20, def.lineWidth)
  st.fontSize = inRange(st.fontSize, 2, 200, def.fontSize)
  for (const k of ['chargeCircle', 'showWarnings', 'showCarbons', 'colorAtoms'] as const) if (typeof st[k] !== 'boolean') st[k] = def[k]
  for (const k of ['depth3d', 'showCip'] as const) if (st[k] !== undefined && typeof st[k] !== 'boolean') delete st[k]
  if (typeof st.font !== 'string' || !FONTS.some((f) => f.name === st.font)) st.font = def.font
  if (st.background !== undefined) {
    const c = safeColor(st.background)
    if (c) st.background = c
    else delete st.background
  }
  const pg = st.page
  if (pg && (typeof pg !== 'object' || !ok(pg.x) || !ok(pg.y) || !(pg.cols >= 1) || !(pg.rows >= 1))) delete st.page
  else if (pg)
    st.page = {
      format: PAGE_FORMATS.some((f) => f.id === pg.format) ? pg.format : 'A4',
      ...(pg.landscape === true ? { landscape: true } : {}),
      x: pg.x,
      y: pg.y,
      cols: Math.min(MAX_PAGES, Math.round(pg.cols)),
      rows: Math.min(MAX_PAGES, Math.round(pg.rows)),
    }
  else delete st.page
  for (const id in d.atoms) {
    const a = d.atoms[id]
    if (!a || !ok(a.x) || !ok(a.y)) delete d.atoms[id]
    else {
      a.id = id
      if (typeof a.element !== 'string' || !/^[A-Z][a-z]{0,2}$/.test(a.element)) a.element = 'C'
      if (a.label != null && typeof a.label !== 'string') a.label = String(a.label)
    }
  }
  for (const id in d.bonds) {
    const b = d.bonds[id]
    if (!b || !d.atoms[b.a1] || !d.atoms[b.a2] || b.a1 === b.a2) delete d.bonds[id]
    else b.id = id
  }
  for (const id in d.fills) {
    const f = d.fills[id]
    if (!f || !Array.isArray(f.rings) || !f.rings.length || f.rings.some((r) => !Array.isArray(r) || r.some((a) => !d.atoms[a]))) delete d.fills[id]
  }
  for (const id in d.cycles) {
    const c = d.cycles[id]
    if (!c || !ok(c.cx) || !ok(c.cy)) {
      delete d.cycles[id]
      continue
    }
    c.id = id
    c.rx = ok(c.rx) ? Math.max(10, c.rx) : 120
    c.ry = ok(c.ry) ? Math.max(10, c.ry) : 120
    if (!Array.isArray(c.stations)) c.stations = []
    if (!Array.isArray(c.branches)) c.branches = []
    if (!ok(c.gap)) c.gap = 34
  }
  for (const id in d.tables) {
    const t = d.tables[id]
    if (!t || !ok(t.x) || !ok(t.y) || !Array.isArray(t.rows)) {
      delete d.tables[id]
      continue
    }
    t.id = id
    if (t.lang !== 'en') t.lang = 'de'
    t.rows = t.rows.filter((r) => r && typeof r.id === 'string')
    for (const r of t.rows) {
      if (r.atom && !d.atoms[r.atom]) delete r.atom
      if (r.parts !== undefined && !(ok(r.parts) && r.parts > 0)) delete r.parts
    }
    if (t.targetConc !== undefined && !(ok(t.targetConc) && t.targetConc > 0)) delete t.targetConc
    if (t.link && (typeof t.link !== 'object' || typeof t.link.arrow !== 'string')) delete t.link
  }
  // Gruppen und Sperrliste: nur Listen von Ids (fehlende Objekte räumt pruneGroups beim nächsten Bearbeiten weg)
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined)
  const lists = (v: unknown): ObjLists | undefined => {
    if (!v || typeof v !== 'object') return undefined
    const out: ObjLists = {}
    for (const k of ['atoms', 'bonds', 'arrows', 'curved', 'texts', 'shapes', 'fills', 'cycles', 'tables'] as const) {
      const l = ids((v as Record<string, unknown>)[k])
      if (l?.length) out[k] = l
    }
    return Object.keys(out).length ? out : undefined
  }
  if (d.groups !== undefined) {
    const g: Record<Id, Group> = {}
    if (d.groups && typeof d.groups === 'object')
      for (const [id, x] of Object.entries(d.groups)) {
        const items = lists((x as Group | null)?.items)
        if (items) g[id] = { id, items }
      }
    if (Object.keys(g).length) d.groups = g
    else delete d.groups
  }
  if (d.locked !== undefined) {
    const l = lists(d.locked)
    if (l) d.locked = l
    else delete d.locked
  }
  for (const k of ['arrows', 'texts', 'shapes'] as const) for (const id in d[k]) if (!d[k][id]) delete d[k][id]
  for (const id in d.arrows) if (![d.arrows[id].x1, d.arrows[id].y1, d.arrows[id].x2, d.arrows[id].y2].every(ok)) delete d.arrows[id]
  for (const id in d.shapes) if (![d.shapes[id].x1, d.shapes[id].y1, d.shapes[id].x2, d.shapes[id].y2].every(ok)) delete d.shapes[id]
  for (const id in d.texts) {
    const t = d.texts[id]
    if (!ok(t.x) || !ok(t.y)) delete d.texts[id]
    else {
      t.id = id
      if (typeof t.text !== 'string') t.text = String(t.text ?? '')
      if (!ok(t.size) || t.size <= 0) t.size = d.style.fontSize
    }
  }
  for (const id in d.arrows) {
    const a = d.arrows[id]
    a.id = id
    if (typeof a.above !== 'string') a.above = ''
    if (typeof a.below !== 'string') a.below = ''
    if (!ARROW_KINDS.includes(a.kind)) a.kind = 'reaction'
  }
  for (const id in d.atoms) {
    const a = d.atoms[id]
    if (!ok(a.charge)) a.charge = 0
    if (!ok(a.lonePairs) || a.lonePairs < 0) a.lonePairs = 0
    if (!ok(a.radical) || a.radical < 0) a.radical = 0
    if (a.flat2d && !(ok(a.flat2d.x) && ok(a.flat2d.y))) delete a.flat2d
    const offs = (v?: ({ x: number; y: number } | null)[]) => v?.map((o) => (o && ok(o.x) && ok(o.y) ? o : null))
    if (a.lpOff) a.lpOff = offs(a.lpOff)
    if (a.radOff) a.radOff = offs(a.radOff)
  }
  const anchorOk = (an?: Anchor) =>
    !!an && (an.type === 'point' ? ok(an.x) && ok(an.y) : an.type === 'bond' ? !!d.bonds[an.id] : !!d.atoms[an.id])
  for (const id in d.curved) {
    const c = d.curved[id]
    if (!c || !anchorOk(c.from) || !anchorOk(c.to)) delete d.curved[id]
    else {
      c.id = id
      if (!ok(c.bend)) c.bend = 0.45
      if (c.head !== 'full' && c.head !== 'half') c.head = 'full'
    }
  }
  return d
}

export function emptySelection(): Selection {
  return { atoms: [], bonds: [], arrows: [], curved: [], texts: [], shapes: [], fills: [], cycles: [], tables: [] }
}

export function selectionSize(s: Selection): number {
  const n = (a?: unknown[]) => (Array.isArray(a) ? a.length : 0)
  return n(s.atoms) + n(s.bonds) + n(s.arrows) + n(s.curved) + n(s.texts) + n(s.shapes) + n(s.fills) + n(s.cycles) + n(s.tables)
}

let counter = 0
export function uid(prefix = ''): Id {
  counter++
  return prefix + Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 6)
}
