// Liste der in OpenMol mitgelieferten fremden Bausteine samt Lizenztext erzeugen → src/legal/thirdParty.json
// (angezeigt unter „Über OpenMol“ ▸ Lizenzen). Nach dem Aktualisieren von Paketen erneut ausführen:
//   npm run licenses
// Erfasst werden nur Pakete, die tatsächlich in Oberfläche, Desktop-App oder KI-Server landen – keine Bauwerkzeuge.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Wurzelpakete je Teil der App; ihre Abhängigkeiten werden mit erfasst */
const PARTS = [
  { part: 'app', roots: ['react', 'react-dom', 'immer', 'openchemlib'], base: ['.'] },
  { part: 'desktop', roots: ['electron', 'electron-updater'], base: ['.'], noDeps: ['electron'] },
  { part: 'mcp', roots: ['@modelcontextprotocol/sdk', 'zod'], base: ['mcp', '.'] },
]

/** Daten, die als Datei übernommen wurden (kein npm-Paket in node_modules) */
const EXTRA = [
  {
    name: 'chemical-elements (Isotopendaten in src/model/isotopes.ts)',
    version: '2.3.3',
    license: 'MIT',
    parts: ['app'],
    text: `MIT License

Copyright (c) 2017 cheminfo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  },
]

const LICENSE_FILES = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i

function findPkg(name, base) {
  for (const b of base) {
    const dir = path.join(ROOT, b, 'node_modules', name)
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
  }
  return null
}

function licenseText(dir) {
  const files = fs.readdirSync(dir).filter((f) => LICENSE_FILES.test(f))
  return files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim()).join('\n\n') || null
}

const out = new Map()
for (const { part, roots, base, noDeps = [] } of PARTS) {
  const stack = [...roots]
  const seen = new Set()
  while (stack.length) {
    const name = stack.pop()
    if (seen.has(name)) continue
    seen.add(name)
    const dir = findPkg(name, base)
    if (!dir) throw new Error(`Paket nicht gefunden: ${name} (npm install bzw. npm run mcp:install ausführen)`)
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    const key = `${pkg.name}@${pkg.version}`
    const license = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? JSON.stringify(pkg.licenses ?? 'unbekannt'))
    const entry = out.get(key) ?? { name: pkg.name, version: pkg.version, license, parts: [], text: licenseText(dir) }
    if (!entry.parts.includes(part)) entry.parts.push(part)
    out.set(key, entry)
    if (!noDeps.includes(name)) for (const d of Object.keys(pkg.dependencies ?? {})) stack.push(d)
  }
}
// zuerst die Bausteine der Oberfläche, dann Desktop, dann KI-Server; darin alphabetisch
const rank = (e) => Math.min(...e.parts.map((p) => PARTS.findIndex((x) => x.part === p)))
const list = [...EXTRA, ...[...out.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))]
const missing = list.filter((e) => !e.text).map((e) => e.name)
fs.mkdirSync(path.join(ROOT, 'src', 'legal'), { recursive: true })
fs.writeFileSync(path.join(ROOT, 'src', 'legal', 'thirdParty.json'), JSON.stringify(list, null, 1) + '\n')
console.log(`${list.length} Bausteine geschrieben (src/legal/thirdParty.json)` + (missing.length ? `; ohne Lizenztext im Paket: ${missing.join(', ')}` : ''))
