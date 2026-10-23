// Vor dem Hochladen: Release-Entwurf für die aktuelle Version anlegen, falls es noch keinen gibt. Sonst legt
// electron-builder beim gleichzeitigen Hochladen mehrerer Dateien zwei Entwürfe an (so geschehen bei 1.2.0 und 1.3.0).
// Braucht die GitHub-CLI (gh) mit Anmeldung. Aufruf: node electron/release-draft.mjs
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const { owner, repo } = [pkg.build.publish].flat()[0]
const tag = 'v' + pkg.version
// Entwürfe haben noch keinen Git-Tag – deshalb über die Release-Liste suchen (gh release view findet sie nicht)
const list = JSON.parse(execFileSync('gh', ['api', `repos/${owner}/${repo}/releases?per_page=100`], { encoding: 'utf8' }))
const existing = list.filter((r) => r.tag_name === tag)
if (existing.length) {
  console.log(`Release-Entwurf ${tag} gibt es schon (${existing.map((r) => r.name).join(', ')})`)
} else {
  execFileSync('gh', ['release', 'create', tag, '--repo', `${owner}/${repo}`, '--draft', '--target', 'main', '--title', `OpenMol ${pkg.version}`, '--notes', ''], { stdio: 'inherit' })
  console.log(`Release-Entwurf ${tag} angelegt`)
}
