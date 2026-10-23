// Entwicklung: Vite-Server starten und die Desktop-App darauf zeigen lassen (Änderungen erscheinen sofort).
// Aufruf: npm run app
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'vite'

const server = await createServer({ server: { port: 5175, strictPort: false } })
await server.listen()
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5175/'
console.log('OpenMol (Entwicklung):', url)

const electron = createRequire(import.meta.url)('electron') // Pfad zur Electron-Programmdatei
const args = ['.']
// für automatische Tests: Fernsteuerung der Oberfläche über einen lokalen Port
if (process.env.OPENMOL_DEBUG_PORT) args.push('--remote-debugging-port=' + process.env.OPENMOL_DEBUG_PORT)
const child = spawn(electron, args, { stdio: 'inherit', env: { ...process.env, OPENMOL_DEV_URL: url.replace(/\/$/, '') } })
child.on('exit', async (code) => {
  await server.close()
  process.exit(code ?? 0)
})
