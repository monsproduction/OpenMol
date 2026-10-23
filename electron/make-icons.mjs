// App-Icon aus build/icon.svg erzeugen: build/icon.png (1024 px), build/icon.icns (macOS) und build/icon.ico (Windows).
// Aufruf: npm run icons   (zeichnet die SVG mit Electron selbst – kein zusätzliches Programm nötig)
import { app, BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const BUILD = path.join(here, '..', 'build')
const svg = fs.readFileSync(path.join(BUILD, 'icon.svg'), 'utf8')

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1024, height: 1024, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } })
  win.webContents.setFrameRate(1)
  const html = `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 400))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  const png1024 = path.join(BUILD, 'icon.png')
  fs.writeFileSync(png1024, img.resize({ width: 1024, height: 1024, quality: 'best' }).toPNG())

  // Windows: .ico mit eingebetteten PNG-Bildern (16 … 256 px; von Windows 10/11 unterstützt)
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const pngs = sizes.map((s) => img.resize({ width: s, height: s, quality: 'best' }).toPNG())
  const head = Buffer.alloc(6 + 16 * sizes.length)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2) // Typ: Icon
  head.writeUInt16LE(sizes.length, 4)
  let offset = head.length
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i
    head.writeUInt8(s >= 256 ? 0 : s, e) // 0 = 256 px
    head.writeUInt8(s >= 256 ? 0 : s, e + 1)
    head.writeUInt8(0, e + 2) // keine Palette
    head.writeUInt8(0, e + 3)
    head.writeUInt16LE(1, e + 4) // Farbebenen
    head.writeUInt16LE(32, e + 6) // Bit pro Pixel
    head.writeUInt32LE(pngs[i].length, e + 8)
    head.writeUInt32LE(offset, e + 12)
    offset += pngs[i].length
  })
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), Buffer.concat([head, ...pngs]))
  // Dokument-Symbol für .openmol-Dateien (electron-builder sucht <Endung>.ico / .icns)
  fs.copyFileSync(path.join(BUILD, 'icon.ico'), path.join(BUILD, 'openmol.ico'))

  // macOS-Iconset: 16 … 512 jeweils einfach und @2x
  if (process.platform === 'darwin') {
    const set = path.join(BUILD, 'icon.iconset')
    fs.rmSync(set, { recursive: true, force: true })
    fs.mkdirSync(set)
    for (const s of [16, 32, 128, 256, 512]) {
      for (const [scale, suffix] of [
        [1, ''],
        [2, '@2x'],
      ]) {
        const out = path.join(set, `icon_${s}x${s}${suffix}.png`)
        execFileSync('sips', ['-z', String(s * scale), String(s * scale), png1024, '--out', out], { stdio: 'ignore' })
      }
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(BUILD, 'icon.icns')])
    fs.rmSync(set, { recursive: true, force: true })
    fs.copyFileSync(path.join(BUILD, 'icon.icns'), path.join(BUILD, 'openmol.icns'))
  }
  console.log('Icons erzeugt in', BUILD)
  app.quit()
})
