// Prüfreihe für die Add-in-Seite in Word (electron/addin/taskpane.*) mit nachgebautem Word und nachgebauter
// OpenMol-Schnittstelle (src/dev/wordMock.js) – nur für die Entwicklung. Im Browser:
//   (await import('/src/dev/wordAddinTests.ts')).run() → Liste der Fehler (leer = alles gut)
// Überschreibt das offene Dokument (für die Testbilder).
import html from '../../electron/addin/taskpane.html?raw'
import js from '../../electron/addin/taskpane.js?raw'
import mock from './wordMock.js?raw'
import { emptyDoc } from '../model/types'
import { replaceDoc } from '../store'
import { insertStructureText } from '../tools/actions'
import { imageWithClipData, renderPng } from '../tools/io'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Pane = { win: any; W: any; $: (id: string) => HTMLElement; frame: HTMLIFrameElement }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean, ms = 6000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (cond()) return true
    await sleep(50)
  }
  return cond()
}

const b64 = (u8: Uint8Array) => {
  let s = ''
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i])
  return btoa(s)
}

/** PNG ohne Zusatzblöcke (so codiert Word eingesetzte Bilder offenbar neu): über eine Canvas */
async function reencode(png64: string): Promise<string> {
  // createImageBitmap statt img.decode(): Letzteres wartet bei ausgeblendetem Fenster auf die Darstellung
  const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + png64)).blob())
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  c.getContext('2d')!.drawImage(bmp, 0, 0)
  return b64(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()))
}

/** Add-in-Seite in einem iframe mit nachgebautem Office laden; setup läuft vor Office.onReady */
async function pane(setup: (W: any) => void = () => {}): Promise<Pane> {
  const page = html
    .replace(/<script src="https:\/\/appsforoffice[^"]*"><\/script>/, '<script>' + mock + '</script>')
    .replace('<script src="taskpane.js"></script>', '<script>' + js + '</script>')
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:320px;height:420px;z-index:99999;background:#fff'
  document.body.appendChild(frame)
  await new Promise<void>((res) => {
    frame.onload = () => res()
    frame.srcdoc = page
  })
  const win = frame.contentWindow as any
  const W = win.__W
  setup(W)
  await W.ready({ host: W.host })
  return { win, W, $: (id) => win.document.getElementById(id), frame }
}

export async function run(): Promise<string[]> {
  const R: string[] = []
  const check = (name: string, ok: boolean, info?: unknown) => {
    if (!ok) R.push(name + (info !== undefined ? ': ' + JSON.stringify(info) : ''))
  }
  const T = async (name: string, f: () => Promise<void>) => {
    try {
      await f()
    } catch (e) {
      R.push(name + ' – Absturz: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  // Testbilder: zwei OpenMol-Bilder (verschieden groß) und ein Bild ohne Daten
  replaceDoc(emptyDoc(), 'Word-Test')
  await insertStructureText('c1ccccc1O')
  const r1 = (await imageWithClipData(true))!
  replaceDoc(emptyDoc(), 'Word-Test')
  await insertStructureText('CCCCCCCCN')
  const r2 = (await imageWithClipData(true))!
  const plain = b64(new Uint8Array(await (await renderPng(false, 2, true))!.arrayBuffer()))
  const png1 = b64(r1.png)
  const png2 = b64(r2.png)
  const frames: HTMLIFrameElement[] = []
  const open = async (setup?: (W: any) => void) => {
    const p = await pane(setup)
    frames.push(p.frame)
    return p
  }

  await T('nicht in Word', async () => {
    const p = await open((W) => (W.host = 'Excel'))
    check('Excel: Hinweis', p.$('status').textContent === 'Dieses Add-in ist für Word gedacht.', p.$('status').textContent)
    check('Excel: Knopf gesperrt', (p.$('edit') as HTMLButtonElement).disabled)
  })

  await T('Sprache', async () => {
    const p = await open((W) => {
      W.lang = 'de-DE'
      W.apiLang = 'en'
    })
    await until(() => p.$('edit').textContent === 'Edit in OpenMol')
    check('Sprache aus OpenMol (en)', p.$('edit').textContent === 'Edit in OpenMol' && p.$('conn').textContent === 'Connected to OpenMol 1.4.0', [p.$('edit').textContent, p.$('conn').textContent])
    check('Sprache: Bereit-Text englisch', p.$('status').textContent === 'Click an image, then “Edit in OpenMol”.', p.$('status').textContent)
    const q = await open((W) => {
      W.lang = 'en-US'
      W.pingFail = true
    })
    check('OpenMol aus: Hinweis in Word-Sprache', q.$('conn').textContent === 'OpenMol is not responding – is the app running?', q.$('conn').textContent)
  })

  await T('falsche Auswahl', async () => {
    const p = await open()
    p.$('edit').click()
    await until(() => !!p.$('status').className)
    check('nichts markiert', /zuerst ein Bild/.test(p.$('status').textContent ?? ''), p.$('status').textContent)
    p.W.sel = [p.W.mkPic({ b64: plain, width: 100 })]
    p.$('edit').click()
    await until(() => /keine OpenMol-Daten/.test(p.$('status').textContent ?? ''))
    check('Bild ohne Daten', /keine OpenMol-Daten/.test(p.$('status').textContent ?? ''), p.$('status').textContent)
    check('ohne Daten: keine Hülle zurückgelassen', p.W.ccs.length === 0, p.W.ccs.length)
    check('ohne Daten: Knopf wieder frei', !(p.$('edit') as HTMLButtonElement).disabled)
  })

  await T('Hin und zurück', async () => {
    const p = await open()
    const nat1 = p.win.pngWidthPt(atob(png1))
    const nat2 = p.win.pngWidthPt(atob(png2))
    check('Breiten aus dem Bild', nat1 > 10 && nat2 > nat1, [nat1, nat2])
    const pic = p.W.mkPic({ b64: png1, width: nat1 * 0.5, altTextDescription: 'Phenol' })
    p.W.doc = [pic]
    p.W.sel = [pic]
    p.$('edit').click()
    await until(() => p.W.edits.length === 1)
    check('Daten an OpenMol', p.W.edits[0] === r1.payload)
    check('Hülle gesetzt', p.W.ccs.length === 1 && p.W.ccs[0].appearance === 'Hidden')
    check('Titel trägt Daten und Breite', pic.altTextTitle.startsWith(r1.payload) && / w=\d/.test(pic.altTextTitle), pic.altTextTitle.slice(-20))
    // während OpenMol bearbeitet: ein anderes Bild bearbeiten können
    await until(() => /In OpenMol geöffnet/.test(p.$('status').textContent ?? ''))
    check('Knopf während der Bearbeitung frei', !(p.$('edit') as HTMLButtonElement).disabled)
    p.W.results.s1.png = png2
    await until(() => !!p.W.replaced)
    const n = p.W.replaced
    check('Bild ersetzt', !!n && p.W.doc[0] === n && p.W.insertLoc === 'Replace')
    check('neue Breite im selben Maßstab', !!n && Math.abs(n.width - nat2 * 0.5) < 0.01, [n?.width, nat2 * 0.5])
    check('Seitenverhältnis fest', !!n?.lockAspectRatio)
    check('Beschreibung bleibt', n?.altTextDescription === 'Phenol', n?.altTextDescription)
    check('neuer Titel', !!n && n.altTextTitle.startsWith(r2.payload) && n.altTextTitle.endsWith(' w=' + nat2.toFixed(2)), n?.altTextTitle.slice(-20))
    check('Hülle entfernt, Bild behalten', p.W.ccs.length === 0 && p.W.ccDeleteKeep === true)
    await until(() => p.$('status').textContent === 'Bild aktualisiert.')
    check('Meldung „aktualisiert“', p.$('status').textContent === 'Bild aktualisiert.', p.$('status').textContent)

    // zweites Mal: Word hat das Bild neu codiert (ohne Datenblock und Auflösung) → Daten und Breite aus dem Titel
    n.b64 = await reencode(png2)
    check('neu codiert ohne Daten', !/OM1:/.test(atob(n.b64)))
    n.width = nat2 * 0.8
    p.W.sel = [n]
    p.$('edit').click()
    await until(() => p.W.edits.length === 2)
    check('Daten aus dem Titel', p.W.edits[1] === r2.payload)
    p.W.results.s2.png = png1
    p.W.replaced = null
    await until(() => !!p.W.replaced)
    check('Maßstab aus dem Titel', !!p.W.replaced && Math.abs(p.W.replaced.width - nat1 * 0.8) < 0.01, [p.W.replaced?.width, nat1 * 0.8])
  })

  await T('Störungen', async () => {
    const p = await open()
    const nat1 = p.win.pngWidthPt(atob(png1))
    // Bild in der Zwischenzeit gelöscht
    p.W.sel = [p.W.mkPic({ b64: png1, width: nat1 })]
    p.$('edit').click()
    await until(() => p.W.edits.length === 1)
    p.W.ccs = []
    p.W.results.s1.png = png2
    await until(() => /gelöscht oder verschoben/.test(p.$('status').textContent ?? ''))
    check('Bild gelöscht: Meldung', /gelöscht oder verschoben/.test(p.$('status').textContent ?? ''), p.$('status').textContent)
    // Verbindung bricht ab
    p.W.sel = [p.W.mkPic({ b64: png1, width: nat1 })]
    p.$('edit').click()
    await until(() => p.W.edits.length === 2)
    p.W.resultFail = true
    await until(() => /Verbindung zu OpenMol verloren/.test(p.$('status').textContent ?? ''))
    check('Verbindung weg: Meldung', /Verbindung zu OpenMol verloren/.test(p.$('status').textContent ?? ''), p.$('status').textContent)
    check('Verbindung weg: Knopf frei', !(p.$('edit') as HTMLButtonElement).disabled)
    p.W.resultFail = false
    // Word lehnt das Einsetzen ab
    p.W.sel = [p.W.mkPic({ b64: png1, width: nat1 })]
    p.W.insertErr = 'GeneralException'
    p.$('edit').click()
    await until(() => p.W.edits.length === 3)
    p.W.results.s3.png = png2
    await until(() => /GeneralException/.test(p.$('status').textContent ?? ''))
    check('Einsetzen abgelehnt: Meldung', /GeneralException/.test(p.$('status').textContent ?? ''), p.$('status').textContent)
    p.W.insertErr = null
  })

  await T('ungewöhnliche Bilder', async () => {
    const p = await open()
    // Breite 0 (z. B. von Word nicht geliefert) → kein NaN/0 als neue Breite
    for (const width of [0, undefined, NaN]) {
      p.W.replaced = null
      const k = p.W.edits.length + 1
      p.W.sel = [p.W.mkPic({ b64: png1, width })]
      p.$('edit').click()
      await until(() => p.W.edits.length === k)
      p.W.results['s' + k].png = png2
      await until(() => !!p.W.replaced)
      const w = p.W.replaced?.width
      check('Breite ' + width + ' → sinnvolle neue Breite', typeof w === 'number' && Number.isFinite(w) && w > 0, w)
    }
    // kein PNG (z. B. von Word komprimiert als JPEG), Daten nur in der Beschreibung, keine Breite im Titel
    const jpeg = btoa('\xff\xd8\xff\xe0\0\x10JFIF\0' + 'x'.repeat(200))
    p.W.replaced = null
    const k = p.W.edits.length + 1
    p.W.sel = [p.W.mkPic({ b64: jpeg, width: 120, altTextDescription: 'Bild ' + r1.payload })]
    p.$('edit').click()
    await until(() => p.W.edits.length === k)
    check('JPEG: Daten aus der Beschreibung', p.W.edits[k - 1] === r1.payload)
    p.W.results['s' + k].png = png2
    await until(() => !!p.W.replaced)
    const w = p.W.replaced?.width
    check('JPEG: sinnvolle neue Breite', typeof w === 'number' && Number.isFinite(w) && w > 10 && w < 5000, w)
  })

  for (const f of frames) f.remove()
  return R
}
