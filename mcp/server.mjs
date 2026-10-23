#!/usr/bin/env node
// MCP-Server für OpenMol: Jede MCP-fähige KI-Anwendung (Claude, Cursor, VS Code, LM Studio …) steuert die im
// Browser geöffnete App.
//
// Ablauf: Die KI-Anwendung startet diesen Server (stdio, Standard) oder verbindet sich per HTTP mit ihm
// (`node server.mjs --http`, Endpunkt http://127.0.0.1:5182/mcp). Der Server öffnet zusätzlich eine kleine
// HTTP-Brücke auf 127.0.0.1 (Standard-Port 5181). Die App im Browser fragt dort regelmäßig nach Befehlen
// („Long-Polling“), führt sie mit ihren normalen Funktionen aus (alles rückgängig machbar) und schickt das Ergebnis
// zurück. Nur Anfragen von localhost werden angenommen. Ausgaben nur auf stderr (stdout gehört dem MCP-Protokoll).
//
// Optionen (Kommandozeile oder Umgebungsvariable):
//   --http              MCP über HTTP statt stdio            (OPENMOL_TRANSPORT=http)
//   --port=5182         Port des HTTP-Endpunkts              (OPENMOL_MCP_PORT)
//   --tools=basic       nur die 20 Grundwerkzeuge statt 39   (OPENMOL_TOOLS=basic)
//   OPENMOL_PORT=5181   Port der Brücke zur App
import http from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

const argv = process.argv.slice(2)
const opt = (name) => {
  const a = argv.find((x) => x === `--${name}` || x.startsWith(`--${name}=`))
  return a === undefined ? undefined : a.includes('=') ? a.slice(a.indexOf('=') + 1) : true
}
const PORT = Number(process.env.OPENMOL_PORT || 5181)
const HTTP = opt('http') !== undefined || process.env.OPENMOL_TRANSPORT === 'http'
const HTTP_PORT = Number(opt('port') || process.env.OPENMOL_MCP_PORT || 5182)
const PROFILE = (opt('tools') || process.env.OPENMOL_TOOLS) === 'basic' ? 'basic' : 'full'
const log = (...a) => console.error('[openmol-mcp]', ...a)

// ---------- Brücke zur App ----------

const queue = [] // wartende Befehle
const waiting = [] // offene Long-Poll-Anfragen der App
const pending = new Map() // id → { resolve, reject, timer }
let lastSeen = 0
let nextId = 1

// erlaubt: keine Herkunft (KI-Anwendung), lokale Seiten (App im Browser) und die Desktop-App (app://openmol –
// diese Herkunft kann keine Webseite annehmen)
const allowedOrigin = (o) => !o || o === 'app://openmol' || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o)

function cors(req, res) {
  const o = req.headers.origin
  if (o && allowedOrigin(o)) {
    res.setHeader('Access-Control-Allow-Origin', o)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Allow-Private-Network', 'true')
  }
}

function deliver() {
  while (queue.length && waiting.length) {
    const res = waiting.shift()
    const cmd = queue.shift()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(cmd))
  }
}

const bridge = http.createServer((req, res) => {
  cors(req, res)
  if (!allowedOrigin(req.headers.origin)) {
    res.writeHead(403).end()
    return
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (req.method === 'GET' && url.pathname === '/status') {
    lastSeen = Date.now()
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, server: 'openmol-mcp' }))
    return
  }
  if (req.method === 'GET' && url.pathname === '/poll') {
    lastSeen = Date.now()
    waiting.push(res)
    const t = setTimeout(() => {
      const i = waiting.indexOf(res)
      if (i >= 0) {
        waiting.splice(i, 1)
        res.writeHead(204).end()
      }
    }, 20000)
    res.on('close', () => {
      clearTimeout(t)
      const i = waiting.indexOf(res)
      if (i >= 0) waiting.splice(i, 1)
    })
    deliver()
    return
  }
  if (req.method === 'POST' && url.pathname === '/call') {
    // Befehl eines zweiten OpenMol-MCP-Servers (z. B. Chat und Code gleichzeitig offen) – nur ohne Browser-Origin
    if (req.headers.origin) {
      res.writeHead(403).end()
      return
    }
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 10e6) req.destroy()
    })
    req.on('end', async () => {
      let msg
      try {
        msg = JSON.parse(body)
      } catch {
        res.writeHead(400).end()
        return
      }
      try {
        const result = await callApp(msg.tool, msg.args ?? {}, msg.timeout)
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, result }))
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }))
      }
    })
    return
  }
  if (req.method === 'POST' && url.pathname === '/result') {
    lastSeen = Date.now()
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 40e6) req.destroy()
    })
    req.on('end', () => {
      try {
        const msg = JSON.parse(body)
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          clearTimeout(p.timer)
          if (msg.ok) p.resolve(msg.result)
          else p.reject(new Error(msg.error || 'Fehler in der App'))
        }
        res.writeHead(204).end()
      } catch {
        res.writeHead(400).end()
      }
    })
    return
  }
  res.writeHead(404).end()
})

// Ist der Port schon belegt (zweiter OpenMol-Server, z. B. zwei KI-Anwendungen gleichzeitig), werden die
// Befehle an den ersten Server weitergereicht; endet dieser, übernimmt dieser Server den Port.
let relay = false
let retry = null
bridge.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    if (!relay) log(`Port ${PORT} belegt – Befehle werden an den bereits laufenden OpenMol-Server weitergereicht.`)
    relay = true
    retry ??= setTimeout(() => {
      retry = null
      bridge.listen(PORT, '127.0.0.1')
    }, 5000)
  } else log('Brücke konnte nicht starten:', e.message)
})
bridge.on('listening', () => {
  relay = false
  log(`Brücke wartet auf OpenMol unter http://127.0.0.1:${PORT}`)
})
bridge.listen(PORT, '127.0.0.1')

async function relayCall(tool, args, timeoutMs) {
  let r
  try {
    r = await fetch(`http://127.0.0.1:${PORT}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, args, timeout: timeoutMs }),
      signal: AbortSignal.timeout((timeoutMs ?? 90000) + 5000),
    })
  } catch {
    throw new Error('Der andere OpenMol-Server antwortet nicht. Bitte kurz warten und erneut versuchen.')
  }
  if (!r.ok) throw new Error('Weiterleitung an den anderen OpenMol-Server fehlgeschlagen (HTTP ' + r.status + ').')
  const msg = await r.json()
  if (!msg.ok) throw new Error(msg.error || 'Fehler in der App')
  return msg.result
}

/** Befehl an die App schicken und auf das Ergebnis warten */
function callApp(tool, args, timeoutMs = 90000) {
  if (relay) return relayCall(tool, args, timeoutMs)
  if (Date.now() - lastSeen > 30000 && !waiting.length) {
    return Promise.reject(
      new Error(
        'OpenMol is not connected. Ask the user to open the app in the browser (e.g. http://localhost:5173) and switch on “KI-Steuerung (MCP)” under Einstellungen (gear icon, ⌘,). / OpenMol ist nicht verbunden: App im Browser öffnen und unter Einstellungen „KI-Steuerung (MCP)“ erlauben.',
      ),
    )
  }
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Keine Antwort von OpenMol (Zeitüberschreitung).'))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    queue.push({ id, tool, args })
    deliver()
  })
}

/** Ergebnis der App → MCP-Inhalt (Text und/oder Bild; zum Bild immer auch Text für Modelle ohne Bildverständnis) */
function toContent(result) {
  const content = []
  if (result?.text !== undefined) content.push({ type: 'text', text: String(result.text) })
  else if (!result?.image) content.push({ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 1) })
  if (result?.image) content.push({ type: 'image', data: result.image, mimeType: result.mimeType || 'image/png' })
  return { content }
}

// ---------- MCP-Server ----------

// Kurzanleitung, die jede verbundene KI beim Start erhält (auch KIs, die OpenMol nicht kennen)
const INSTRUCTIONS = `OpenMol is a chemical drawing app (similar to ChemDraw) that is open in the user's web browser. These tools edit the open document live, and every change can be undone (undo tool, or Cmd+Z in the app).
- Start with get_document to see what is drawn (ids, SMILES, positions). After larger changes check the result with get_image (it returns a short text description first and then a PNG).
- Coordinates: x to the right, y downwards; one bond is about 40 units long.
- Structures are given as SMILES, or as "name:<English name>" (looked up on PubChem).
- Text fields accept a little HTML: <b>, <i>, <sub>, <sup>. Digits in reaction conditions are not subscripted automatically – write K<sub>2</sub>CO<sub>3</sub>.
- Prefer the high-level tools (draw_reaction, clean_reaction, create_stoich_table, set_stoich_row).${
  PROFILE === 'full' ? ' For anything else read get_data_model once, then use edit_objects.' : ' (This server runs with the basic tool set.)'
}
- If a tool says that OpenMol is not connected, ask the user to open the app (usually http://localhost:5173) and to switch on "KI-Steuerung (MCP)" in the settings.`

const DEFS = [] // alle Werkzeuge; je Verbindung wird daraus ein Server gebaut (HTTP: eine pro Anfrage)
let defProfile = 'basic'

function tool(name, description, inputSchema, opts = {}) {
  DEFS.push({ name, description, inputSchema, opts, profile: defProfile })
}

function createMcpServer() {
  const server = new McpServer({ name: 'openmol', version: '1.1.0' }, { instructions: INSTRUCTIONS })
  for (const d of DEFS) {
    if (PROFILE === 'basic' && d.profile !== 'basic') continue
    server.registerTool(d.name, { title: d.opts.title, description: d.description, inputSchema: d.inputSchema }, async (args) => {
      try {
        return toContent(await callApp(d.name, args ?? {}, d.opts.timeout))
      } catch (e) {
        return { content: [{ type: 'text', text: 'Error: ' + (e instanceof Error ? e.message : String(e)) }], isError: true }
      }
    })
  }
  return server
}

const structure = z
  .string()
  .describe('SMILES (e.g. "c1ccccc1Br"), or a compound name prefixed with "name:" (looked up on PubChem, English names work best, e.g. "name:caffeine")')

tool(
  'get_document',
  'Describe the current drawing in OpenMol: molecules (id, SMILES, formula, molar mass, position/size), reaction arrows (with conditions text), free texts, stoichiometry tables, shapes, mechanism arrows, ring fills, catalytic cycles (stations, branches, step labels) and the overall bounding box. For every property of every object use get_document_json. Coordinates: x to the right, y downwards, a bond is about 40 units long.',
  {},
)
tool('get_image', 'Render the current drawing (or only the selection) as a PNG image so you can look at the result. A short text description of the content comes first, for models that cannot read images.', {
  only_selection: z.boolean().optional().describe('only the currently selected objects'),
})
tool('new_document', 'Start a new, empty document (the previous one can be restored with undo).', {
  name: z.string().optional().describe('file name of the new document'),
})
tool(
  'insert_structure',
  'Insert a molecule. Without x/y it is placed to the right of the existing drawing. Returns the molecule id and formula.',
  {
    structure,
    x: z.number().optional(),
    y: z.number().optional(),
    caption: z.string().optional().describe('optional caption below the molecule, e.g. a compound number "1"'),
  },
  { timeout: 60000 },
)
tool(
  'draw_reaction',
  'Draw a complete reaction scheme in one step: reactants (joined by "+"), an arrow with conditions above/below, optional reagent structures above the arrow, and products. The new scheme is placed below the existing drawing and tidied up automatically.',
  {
    reactants: z.array(structure).min(1),
    products: z.array(structure).default([]),
    reagents_above: z.array(structure).optional().describe('structures drawn above the arrow (count as reagents)'),
    above: z.string().optional().describe('conditions text above the arrow (rich text; digits are NOT subscripted automatically – write formulas as K<sub>2</sub>CO<sub>3</sub>, Pd(PPh<sub>3</sub>)<sub>4</sub>)'),
    below: z.string().optional().describe('conditions text below the arrow, e.g. "toluene, 80 °C, 16 h" (rich text as above)'),
    arrow: z.enum(['reaction', 'equilibrium', 'retro', 'failed', 'dashed']).optional(),
    yield: z.string().optional().describe('yield shown under the arrow, e.g. "86"'),
  },
  { timeout: 90000 },
)
tool('add_text', 'Add a free text. Rich text is allowed (<b>, <i>, <sub>, <sup>).', {
  text: z.string(),
  x: z.number(),
  y: z.number(),
  size: z.number().optional(),
  bold: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
})
tool('add_arrow', 'Add a reaction arrow from (x1,y1) to (x2,y2) with optional conditions text (rich text; write subscripts with <sub>…</sub>).', {
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
  above: z.string().optional(),
  below: z.string().optional(),
  kind: z.enum(['reaction', 'equilibrium', 'resonance', 'retro', 'dashed', 'failed']).optional(),
})
tool('move_object', 'Move an object (molecule id, arrow id, text id or table id from get_document) by dx/dy.', {
  id: z.string(),
  dx: z.number(),
  dy: z.number(),
})
tool('delete_objects', 'Delete objects by id (molecule, arrow, text, table ids from get_document).', {
  ids: z.array(z.string()).min(1),
})
tool('clean_reaction', 'Tidy up the reaction scheme(s): align molecules, arrows, "+" signs (missing "+" are added), reagents and conditions.', {})
tool('clean_structures', 'Tidy up the 2D layout of all molecules (or only selected ones): regular rings, ideal angles, no overlaps.', {
  only_selection: z.boolean().optional(),
})
tool('contract_groups', 'Write drawn-out groups as abbreviations (OMe, OTf, Bpin, CO2Me, OAc, TBS, CF3, tBu …).', {})
tool(
  'create_stoich_table',
  'Create a stoichiometry table from the drawn reaction (reactants before the arrow, reagents at the arrow, products after it; solvents/temperature/time are read from the arrow text). Returns the table with all rows.',
  {},
)
tool(
  'set_stoich_row',
  'Change one row of a stoichiometry table. Amounts are strings with units, e.g. "105 mg", "0.2 mL", "1.5 mmol". Use conc_M for a reagent used as a solution (e.g. 2.0 for NaHMDS 2.0 M) – the required volume is calculated.',
  {
    table_id: z.string().optional().describe('default: the only/first table'),
    row: z.string().describe('row index as text ("0" = first row) or name/formula of the compound, e.g. "THF"'),
    equivalents: z.number().optional(),
    amount: z.string().optional().describe('mass, volume or amount of substance with unit'),
    reference: z.boolean().optional().describe('make this the limiting reagent (reference for equivalents)'),
    conc_M: z.number().optional().describe('concentration of the solution in mol/L (own column; 0 removes it)'),
    solvent: z.string().optional().describe('solvent of the solution, e.g. "THF"'),
    density: z.number().optional().describe('g/mL (own column; 0 removes it)'),
    obtained: z.string().optional().describe('product: isolated mass, e.g. "97 mg"'),
    cas: z.string().optional().describe('CAS number, e.g. "109-99-9" (check digit is verified); "auto" looks it up in PubChem; "" removes it'),
    name: z.string().optional(),
    role: z.enum(['reactant', 'reagent', 'catalyst', 'solvent', 'product']).optional(),
  },
)
tool('add_stoich_row', 'Add a compound to a stoichiometry table: name, formula, SMILES or solution, e.g. "THF", "K2CO3", "NaHMDS 2.0 M in THF".', {
  table_id: z.string().optional(),
  text: z.string(),
  role: z.enum(['reactant', 'reagent', 'catalyst', 'solvent', 'product']).optional(),
  amount: z.string().optional(),
  equivalents: z.number().optional(),
})
tool('set_reaction_conditions', 'Set temperature, time, atmosphere and notes of a stoichiometry table.', {
  table_id: z.string().optional(),
  temperature: z.string().optional(),
  time: z.string().optional(),
  atmosphere: z.string().optional(),
  notes: z.string().optional(),
  language: z.enum(['de', 'en']).optional(),
})
tool(
  'export',
  'Export the drawing and return it as text: "svg", "cdxml" (ChemDraw), "molfile" (all molecules) or "smiles". The user can also save files from the app via Export.',
  { format: z.enum(['svg', 'cdxml', 'molfile', 'smiles']) },
)
tool('set_style', 'Set the drawing style preset.', { preset: z.enum(['standard', 'acs', 'presentation']) })
tool('undo', 'Undo the last change(s) in OpenMol.', { steps: z.number().int().min(1).max(50).optional() })
tool('redo', 'Redo the last undone change in OpenMol.', {})

// ---------- Vollzugriff: alles, was die App kann ----------

defProfile = 'full'

const color = z.string().describe('CSS color, e.g. "#d33" or "red"')
const ids = z.array(z.string()).min(1)

tool(
  'get_data_model',
  'Return the TypeScript definitions (with comments) of the OpenMol document model: atoms, bonds, arrows, curved (mechanism) arrows, texts, shapes, ring fills, catalytic cycles, stoichiometry tables and style. Read this before using edit_objects.',
  {},
)
tool(
  'get_document_json',
  'Return the raw document as JSON (all objects with ids and every property) plus the current selection. Optionally limited to some kinds or ids.',
  {
    kinds: z.array(z.enum(['atoms', 'bonds', 'arrows', 'curved', 'texts', 'shapes', 'fills', 'cycles', 'tables'])).optional(),
    ids: z.array(z.string()).optional(),
  },
)
tool(
  'edit_objects',
  'Low-level editing of ANY object in one undoable step: add, update (merge properties; null removes a property) or delete atoms, bonds, arrows, curved, texts, shapes, fills, cycles, tables. Property names exactly as in get_data_model. Broken references are repaired (e.g. bonds to deleted atoms are removed). Use this for anything the specialised tools do not cover.',
  {
    operations: z
      .array(
        z.object({
          op: z.enum(['add', 'update', 'delete']),
          kind: z.enum(['atoms', 'bonds', 'arrows', 'curved', 'texts', 'shapes', 'fills', 'cycles', 'tables']),
          id: z.string().optional().describe('required for update/delete; optional fixed id for add'),
          data: z.record(z.string(), z.unknown()).optional().describe('properties as in get_data_model, e.g. {"x": 10, "color": "#d33"}'),
        }),
      )
      .min(1),
  },
)
tool('select', 'Select objects (atom id = whole molecule unless atoms_only). Many run_action actions work on the selection.', {
  ids,
  atoms_only: z.boolean().optional(),
  add: z.boolean().optional().describe('add to the current selection'),
})
tool('select_all', 'Select everything.', {})
tool('clear_selection', 'Clear the selection.', {})
tool(
  'run_action',
  'Run an app command on the selection (or on the objects given in ids; without selection most commands act on everything). rotate (value = degrees, clockwise), flip_horizontal/vertical, align_left/hcenter/right/top/vcenter/bottom, rotate_3d_x/y (value = degrees), clean_3d (3D layout like a ball-and-stick view) – these 3D commands only act on selected atoms (select or pass ids first), back_to_2d, skew (value = degrees), number_compounds (bold numbers below the molecules), polymer_brackets, cyclic_brackets, bring_to_front/send_to_back/bring_forward/send_backward, toggle_bold, duplicate, delete, clean_structure, clean_reaction, contract_groups, create_stoich_table, fit_view, fit_cycle_gaps (cycle_id), link_cycles (cycle_id → target_cycle_id), dock_cycle (cycle_id onto target_cycle_id).',
  {
    action: z.enum([
      'rotate', 'flip_horizontal', 'flip_vertical', 'align_left', 'align_hcenter', 'align_right', 'align_top', 'align_vcenter', 'align_bottom',
      'rotate_3d_x', 'rotate_3d_y', 'clean_3d', 'back_to_2d', 'skew', 'number_compounds', 'polymer_brackets', 'cyclic_brackets',
      'bring_to_front', 'send_to_back', 'bring_forward', 'send_backward', 'toggle_bold', 'duplicate', 'delete', 'clean_structure',
      'clean_reaction', 'contract_groups', 'create_stoich_table', 'fit_view', 'fit_cycle_gaps', 'link_cycles', 'dock_cycle',
    ]),
    ids: z.array(z.string()).optional(),
    value: z.number().optional(),
    cycle_id: z.string().optional(),
    target_cycle_id: z.string().optional(),
  },
  { timeout: 60000 },
)
tool('get_molecule', 'Atoms (id, element, label, position, charge …), bonds (id, atoms, type), rings (atom id lists) and ring fills of one molecule.', {
  id: z.string().describe('molecule id or any atom id of the molecule'),
})
tool('set_atoms', 'Change atoms: element, label (abbreviation/free label like "OMe", "R", "Ar"; "" removes), charge, lone pairs, radical, isotope, colour, highlight background, show carbon, bold, stereo mark, CIP label, partial charge δ+/δ−.', {
  ids,
  element: z.string().optional(),
  label: z.string().optional(),
  charge: z.number().int().optional(),
  lone_pairs: z.number().int().min(0).max(4).optional(),
  radical: z.number().int().min(0).max(2).optional(),
  isotope: z.number().int().optional(),
  color: z.string().optional().describe('"" resets'),
  background: z.string().optional().describe('highlight colour behind the atom, "" resets'),
  show_carbon: z.boolean().optional(),
  bold: z.boolean().optional(),
  stereo_mark: z.boolean().optional(),
  show_cip: z.boolean().optional(),
  partial: z.enum(['+', '-', 'none']).optional(),
})
tool('set_bonds', 'Change bonds (by bond id or by atom pairs): type, direction (reverse wedge), colour, width, position of the second line of a double bond, crossed (E/Z undefined).', {
  ids: z.array(z.string()).optional(),
  pairs: z.array(z.array(z.string()).length(2)).optional().describe('[atomId, atomId] pairs'),
  type: z.enum(['single', 'double', 'triple', 'wedge', 'hash', 'wavy', 'bold', 'dashed', 'aromatic']).optional(),
  reverse: z.boolean().optional(),
  color: z.string().optional(),
  width: z.number().optional(),
  double_position: z.enum(['auto', 'left', 'right', 'center']).optional(),
  crossed: z.boolean().optional().describe('double bond with undefined E/Z configuration (drawn crossed); SMILES without / \\ at a stereogenic C=C gives a crossed bond – set false to fix the drawn geometry'),
})
tool(
  'fill_rings',
  'Ring fill colour: fill rings of a molecule (or the rings containing ring_atoms) with a colour or a gradient (color2). By default one fill spans all chosen rings, so a gradient runs across fused rings instead of repeating in every ring.',
  {
    molecule: z.string().optional().describe('molecule id / atom id – fills all its rings'),
    ring_atoms: z.array(z.string()).optional().describe('atoms of one ring (or some atoms of it)'),
    color: color.optional(),
    color2: z.string().optional().describe('second colour → gradient'),
    gradient: z.enum(['none', 'linear', 'radial']).optional(),
    angle: z.number().optional().describe('gradient angle in degrees'),
    opacity: z.number().min(0).max(1).optional(),
    whole_system: z.boolean().optional().describe('fill the whole fused ring system the ring belongs to'),
    separately: z.boolean().optional().describe('true: each ring gets its own fill (gradient repeats per ring)'),
  },
)
tool('remove_ring_fills', 'Remove ring fills (of one molecule or all).', { molecule: z.string().optional() })
tool(
  'add_catalytic_cycle',
  'Draw a catalytic cycle (circular arrow with gaps for the intermediates). Stations are the intermediates (label = rich text, or structure = SMILES/"name:…" placed on the circle; the gaps are fitted around them). Branches are curved side arrows entering ("in", e.g. substrate) or leaving ("out", e.g. product) – give station (index; the branch goes between that station and the next) or angle. arc_labels name the steps ("oxidative addition"). Angles: 0° = right, 90° = bottom, clockwise. Without cx/cy it is placed right of the drawing.',
  {
    stations: z.array(z.object({ label: z.string().optional(), structure: z.string().optional(), angle: z.number().optional() })).default([]),
    branches: z
      .array(
        z.object({
          type: z.enum(['in', 'out']),
          label: z.string().optional(),
          station: z.number().int().optional(),
          angle: z.number().optional(),
          side: z.enum(['in', 'out']).optional().describe('outside (default) or inside the cycle'),
        }),
      )
      .optional(),
    arc_labels: z.array(z.object({ angle: z.number(), label: z.string(), side: z.enum(['in', 'out']).optional() })).optional(),
    direction: z.enum(['cw', 'ccw']).optional(),
    radius: z.number().optional().describe('default 4 bond lengths (160)'),
    ry: z.number().optional().describe('vertical radius for an ellipse'),
    cx: z.number().optional(),
    cy: z.number().optional(),
    color: z.string().optional(),
    heads: z.boolean().optional().describe('arrow heads at the gaps (default true)'),
    fit_gaps: z.boolean().optional(),
  },
  { timeout: 90000 },
)
tool(
  'add_curved_arrow',
  'Mechanism arrow (electron pushing). from/to anchors: {atom: id}, {bond: id}, {lone_pair_atom: id, index}, or a point {x, y}. head "half" = fishhook (one electron).',
  {
    from: z.object({ atom: z.string().optional(), bond: z.string().optional(), lone_pair_atom: z.string().optional(), index: z.number().optional(), x: z.number().optional(), y: z.number().optional() }),
    to: z.object({ atom: z.string().optional(), bond: z.string().optional(), lone_pair_atom: z.string().optional(), index: z.number().optional(), x: z.number().optional(), y: z.number().optional() }),
    head: z.enum(['full', 'half']).optional(),
    bend: z.number().optional().describe('curvature (about ±0.3…0.8; the sign chooses the side). Omit it to let OpenMol pick the side and curvature that keeps the arc clear of atoms and bonds'),
    color: z.string().optional(),
  },
)
tool(
  'add_shape',
  'Add a shape from (x1,y1) to (x2,y2): rect, roundrect, ellipse, sphere (shaded 3D ball), brackets [ ], parens ( ), braces { }. Closed shapes may have fill, fill2 (gradient), radius, shadow, no_border. Brackets may have an index (e.g. "n") and a corner text. New shapes lie on top: a frame around existing text (especially with shadow, which is filled white) must be sent behind it with run_action send_to_back.',
  {
    kind: z.string().describe('rect | roundrect | ellipse | sphere | brackets | parens | braces'),
    x1: z.number(),
    y1: z.number(),
    x2: z.number(),
    y2: z.number(),
    color: z.string().optional(),
    fill: z.string().optional(),
    fill2: z.string().optional(),
    gradient: z.enum(['linear', 'radial']).optional(),
    radius: z.number().optional(),
    shadow: z.boolean().optional(),
    no_border: z.boolean().optional(),
    dashed: z.boolean().optional(),
    index: z.string().optional(),
    corner: z.string().optional(),
  },
)
tool('set_colors', 'Set colour and/or opacity of objects (molecule ids colour the whole molecule; also bonds, arrows, texts, shapes, cycles).', {
  ids,
  color: z.string().optional().describe('"" resets to default'),
  opacity: z.number().min(0).max(1).optional(),
})
tool('list_templates', 'List the built-in templates (rings, amino acids, sugars, 3D objects, glassware …) and the user\'s own templates.', {})
tool('insert_template', 'Insert a template by name (from list_templates; own templates as "user:<id>"). Without x/y it is placed right of the drawing.', {
  name: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
})
tool('set_document_style', 'Set individual document style values (all optional). Returns the full style.', {
  line_width: z.number().optional(),
  font_size: z.number().optional(),
  font: z.string().optional(),
  bond_length: z.number().optional(),
  color_heteroatoms: z.boolean().optional(),
  show_all_carbons: z.boolean().optional(),
  circle_charges: z.boolean().optional(),
  show_cip: z.boolean().optional(),
})

// ---------- Start: stdio (Standard) oder HTTP ----------

const toolCount = DEFS.filter((d) => PROFILE === 'full' || d.profile === 'basic').length
if (HTTP) {
  // Streamable HTTP ohne Sitzungen: jede Anfrage bekommt ihren eigenen Server (Empfehlung des MCP-SDK).
  // Nur lokal erreichbar; Host- und Origin-Prüfung schützen vor DNS-Rebinding aus fremden Webseiten.
  const localHost = (h) => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h ?? '')
  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (!localHost(req.headers.host) || !allowedOrigin(req.headers.origin)) {
      res.writeHead(403).end()
      return
    }
    cors(req, res)
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id')
      res.writeHead(204).end()
      return
    }
    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('OpenMol MCP: endpoint is /mcp')
      return
    }
    if (req.method !== 'POST') {
      // ohne Sitzungen gibt es keinen Ereignis-Stream (GET) und nichts zu beenden (DELETE)
      res.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed – this server is stateless, use POST.' }, id: null }))
      return
    }
    let body = ''
    for await (const c of req) {
      body += c
      if (body.length > 10e6) {
        res.writeHead(413).end()
        return
      }
    }
    let msg
    try {
      msg = JSON.parse(body)
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }))
      return
    }
    const server = createMcpServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, msg)
    } catch (e) {
      log('HTTP-Anfrage fehlgeschlagen:', e instanceof Error ? e.message : e)
      if (!res.headersSent) res.writeHead(500).end()
    }
  })
  httpServer.on('error', (e) => {
    log(e.code === 'EADDRINUSE' ? `Port ${HTTP_PORT} ist belegt – anderen Port mit --port=… wählen.` : 'HTTP-Server konnte nicht starten: ' + e.message)
    process.exit(1)
  })
  httpServer.listen(HTTP_PORT, '127.0.0.1', () => log(`MCP-Server läuft (HTTP, ${toolCount} Werkzeuge): http://127.0.0.1:${HTTP_PORT}/mcp`))
} else {
  await createMcpServer().connect(new StdioServerTransport())
  log(`MCP-Server läuft (stdio, ${toolCount} Werkzeuge).`)
}
