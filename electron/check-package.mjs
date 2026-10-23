// Prüft eine gebaute App, bevor sie veröffentlicht wird: Sind alle Dateien, die der Hauptprozess lädt, im
// Archiv (app.asar)? Liegen Oberfläche und KI-Server dabei? Bricht mit Fehlercode ab, wenn etwas fehlt.
// Aufruf: node electron/check-package.mjs release/mac-arm64/OpenMol.app   bzw.   release/win-unpacked
import asar from '@electron/asar'
import fs from 'node:fs'
import path from 'node:path'

const target = process.argv[2]
if (!target) {
  console.error('Aufruf: node electron/check-package.mjs <OpenMol.app | win-unpacked>')
  process.exit(2)
}
const resources = fs.existsSync(path.join(target, 'Contents', 'Resources')) ? path.join(target, 'Contents', 'Resources') : path.join(target, 'resources')
const archive = path.join(resources, 'app.asar')
const problems = []
if (!fs.existsSync(archive)) {
  console.error('Kein app.asar gefunden in', resources)
  process.exit(1)
}
const files = new Set(asar.listPackage(archive).map((p) => p.replace(/\\/g, '/').replace(/^\//, '')))
const read = (f) => asar.extractFile(archive, f).toString('utf8')

// Einstieg aus package.json und alle lokalen Importe (import … from './x', import('./x'), require('./x')) verfolgen
const pkg = JSON.parse(read('package.json'))
const start = [pkg.main, 'electron/preload.cjs']
const seen = new Set()
const todo = [...start]
while (todo.length) {
  const f = todo.pop()
  if (seen.has(f)) continue
  seen.add(f)
  if (!files.has(f)) {
    problems.push(`fehlt: ${f}`)
    continue
  }
  const src = read(f)
  const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g
  for (const m of src.matchAll(re)) todo.push(path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1])))
}
// Laufzeit-Pakete, die der Hauptprozess lädt (außer electron und node:…)
for (const f of seen) {
  if (!files.has(f)) continue
  for (const m of read(f).matchAll(/(?:from\s+|require\s*\(\s*|createRequire\([^)]*\)\s*\(\s*)['"]([a-z@][^'"]*)['"]/g)) {
    const name = m[1].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0]
    if (name === 'electron' || m[1].startsWith('node:')) continue
    if (!files.has(`node_modules/${name}/package.json`)) problems.push(`Paket fehlt: ${name} (gebraucht von ${f})`)
  }
}
if (!files.has('dist/index.html')) problems.push('fehlt: dist/index.html (Oberfläche)')
if (!fs.existsSync(path.join(resources, 'mcp', 'server.mjs'))) problems.push('fehlt: mcp/server.mjs (KI-Server)')
if (!fs.existsSync(path.join(resources, 'app-update.yml'))) problems.push('fehlt: app-update.yml (Updates)')

if (problems.length) {
  console.error('Paketprüfung FEHLGESCHLAGEN für', target)
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log(`Paketprüfung bestanden: ${target} (${seen.size} Hauptprozess-Dateien, Oberfläche, KI-Server, Update-Info)`)
