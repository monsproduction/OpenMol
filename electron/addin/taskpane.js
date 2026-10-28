// Add-in-Seite in Word: markiertes OpenMol-Bild → OpenMol (zum Bearbeiten) → neues Bild an derselben Stelle.
// Die Zeichnung steckt im PNG selbst (Textblock „openmol“ = „OM1:…“); OpenMol läuft unter https://localhost:5185.
/* global Office, Word */
'use strict'

const $ = (id) => document.getElementById(id)
const OM_RE = /OM1:[A-Za-z0-9_-]{16,}/

// Texte in der Sprache der OpenMol-Oberfläche (kommt mit /api/ping; bis dahin die Sprache von Word)
const TEXT = {
  de: {
    edit: 'In OpenMol bearbeiten',
    step1: 'Ein aus OpenMol kopiertes Bild in Word anklicken.',
    step2: '„In OpenMol bearbeiten“ – OpenMol öffnet die Zeichnung.',
    step3: 'In OpenMol ändern und oben „Zurück nach Word“ klicken – das Bild hier wird ersetzt.',
    connected: 'Verbunden mit OpenMol {0}',
    noAnswer: 'OpenMol antwortet nicht – läuft die App?',
    lost: 'Verbindung zu OpenMol verloren: ',
    gone: 'Das ursprüngliche Bild wurde inzwischen gelöscht oder verschoben.',
    updated: 'Bild aktualisiert.',
    timeout: 'Zeitüberschreitung – bitte erneut „In OpenMol bearbeiten“.',
    pick: 'Bitte zuerst ein Bild in Word anklicken (ein Bild im Text, nicht frei schwebend).',
    noData: 'Dieses Bild enthält keine OpenMol-Daten. Nur Bilder, die mit OpenMol (ab 1.3.2) kopiert wurden, lassen sich bearbeiten.',
    opened: 'In OpenMol geöffnet. Dort ändern und oben „Zurück nach Word“ klicken …',
    wordOnly: 'Dieses Add-in ist für Word gedacht.',
    ready: 'Bild anklicken, dann „In OpenMol bearbeiten“.',
    alt: 'OpenMol-Struktur',
  },
  en: {
    edit: 'Edit in OpenMol',
    step1: 'Click an image in Word that was copied from OpenMol.',
    step2: '“Edit in OpenMol” – OpenMol opens the drawing.',
    step3: 'Change it in OpenMol and click “Back to Word” at the top – the image here is replaced.',
    connected: 'Connected to OpenMol {0}',
    noAnswer: 'OpenMol is not responding – is the app running?',
    lost: 'Lost the connection to OpenMol: ',
    gone: 'The original image has been deleted or moved in the meantime.',
    updated: 'Image updated.',
    timeout: 'Timed out – please click “Edit in OpenMol” again.',
    pick: 'Please click an image in Word first (an image in line with text, not floating).',
    noData: 'This image contains no OpenMol data. Only images copied with OpenMol (1.3.2 or later) can be edited.',
    opened: 'Opened in OpenMol. Change it there and click “Back to Word” at the top …',
    wordOnly: 'This add-in is meant for Word.',
    ready: 'Click an image, then “Edit in OpenMol”.',
    alt: 'OpenMol structure',
  },
}
let lang = 'de'
const t = (k, ...a) => TEXT[lang][k].replace(/\{(\d)\}/g, (_m, i) => a[Number(i)] ?? '')

function applyTexts() {
  document.documentElement.lang = lang
  $('edit').textContent = t('edit')
  for (const k of ['step1', 'step2', 'step3']) $(k).textContent = t(k)
}

function status(text, error) {
  $('status').textContent = text
  $('status').className = error ? 'error' : ''
}

/** base64 → Bytes als Latin-1-Text (so lassen sich die PNG-Blöcke und „OM1:…“ direkt durchsuchen) */
function latin1(b64) {
  return atob(b64)
}

/** natürliche Breite eines PNG in pt: Pixel und Auflösung (pHYs); ohne Angabe 96 dpi */
function pngWidthPt(bin) {
  const px = ((bin.charCodeAt(16) << 24) | (bin.charCodeAt(17) << 16) | (bin.charCodeAt(18) << 8) | bin.charCodeAt(19)) >>> 0
  const i = bin.indexOf('pHYs')
  let dpi = 96
  if (i > 0 && bin.charCodeAt(i + 12) === 1) {
    const ppm = ((bin.charCodeAt(i + 4) << 24) | (bin.charCodeAt(i + 5) << 16) | (bin.charCodeAt(i + 6) << 8) | bin.charCodeAt(i + 7)) >>> 0
    if (ppm > 0) dpi = ppm * 0.0254
  }
  return (px / dpi) * 72
}

async function api(path, init) {
  const r = await fetch(path, init)
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'HTTP ' + r.status)
  return r.json()
}

async function checkConnection() {
  try {
    const j = await api('/api/ping')
    if (j.lang === 'en' || j.lang === 'de') {
      lang = j.lang
      applyTexts()
    }
    $('conn').textContent = t('connected', j.version)
    return true
  } catch {
    $('conn').textContent = t('noAnswer')
    return false
  }
}

/**
 * Titel des Alternativtexts: „OM1:…. w=123.45“ – die Daten und die natürliche Breite (pt) des Original-Bildes.
 * Word codiert über die Schnittstelle eingesetzte Bilder offenbar neu: dann fehlen im PNG Datenblock und Auflösung,
 * der Titel bleibt erhalten.
 */
function titleFor(payload, widthPt) {
  return `${payload} w=${widthPt.toFixed(2)}`
}
function widthFromTitle(title) {
  const m = / w=([\d.]+)/.exec(title ?? '')
  return m ? Number(m[1]) : null
}

/** auf das Ergebnis aus OpenMol warten (bis zu 2 Stunden) und das Bild ersetzen */
async function waitAndReplace(session, tag, scale, description) {
  const until = Date.now() + 2 * 3600 * 1000
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1000))
    let j
    try {
      j = await api('/api/result?s=' + session)
    } catch (e) {
      status(t('lost') + e.message, true)
      return
    }
    if (!j.ready) continue
    const natural = pngWidthPt(latin1(j.png))
    const newWidth = natural * scale
    await Word.run(async (ctx) => {
      const ccs = ctx.document.contentControls.getByTag(tag)
      ccs.load('items')
      await ctx.sync()
      if (!ccs.items.length) throw new Error(t('gone'))
      const cc = ccs.items[0]
      const old = cc.inlinePictures.getFirst()
      const pic = old.insertInlinePictureFromBase64(j.png, 'Replace')
      pic.lockAspectRatio = true
      pic.width = newWidth
      // eine vorhandene Bildbeschreibung bleibt, sonst eine kurze eigene
      pic.altTextDescription = description || t('alt')
      const p = OM_RE.exec(latin1(j.png))?.[0]
      if (p) pic.altTextTitle = titleFor(p, natural)
      // Hülle wieder entfernen, das Bild bleibt
      cc.delete(true)
      await ctx.sync()
    })
    status(t('updated'))
    return
  }
  status(t('timeout'), true)
}

async function editSelected() {
  $('edit').disabled = true
  try {
    let payload = null
    let scale = 1
    let description = ''
    const tag = 'openmol-' + Math.random().toString(36).slice(2, 10)
    await Word.run(async (ctx) => {
      const pics = ctx.document.getSelection().inlinePictures
      pics.load('items/width,items/altTextTitle,items/altTextDescription')
      await ctx.sync()
      if (!pics.items.length) throw new Error(t('pick'))
      const pic = pics.items[0]
      const b64 = pic.getBase64ImageSrc()
      await ctx.sync()
      const bin = latin1(b64.value)
      // Daten im Bild (Original aus OpenMol) oder im Titel des Alternativtexts (schon einmal hier ersetzt)
      const inImage = OM_RE.exec(bin)?.[0] ?? null
      payload = inImage ?? OM_RE.exec(pic.altTextTitle ?? '')?.[0] ?? OM_RE.exec(pic.altTextDescription ?? '')?.[0] ?? null
      if (!payload) throw new Error(t('noData'))
      // natürliche Breite: aus dem Original-PNG (Auflösung im Bild), sonst aus dem Titel
      const natural = inImage ? pngWidthPt(bin) : (widthFromTitle(pic.altTextTitle) ?? pngWidthPt(bin))
      // Maßstab merken, damit das neue Bild genauso groß gezeichnet erscheint
      scale = pic.width / natural
      description = pic.altTextDescription ?? ''
      // Daten gleich doppelt ablegen: übersteht so auch spätere Bildbearbeitung in Word (Zuschneiden, Komprimieren)
      if (!OM_RE.test(pic.altTextTitle ?? '')) pic.altTextTitle = titleFor(payload, natural)
      // Bild markieren, um es später wiederzufinden (auch wenn die Auswahl inzwischen woanders ist)
      const cc = pic.insertContentControl()
      cc.tag = tag
      cc.appearance = 'Hidden'
      await ctx.sync()
    })
    const { session } = await api('/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload }) })
    status(t('opened'))
    await waitAndReplace(session, tag, scale, description)
  } catch (e) {
    status(e?.message ?? String(e), true)
  } finally {
    $('edit').disabled = false
  }
}

Office.onReady(async (info) => {
  // bis OpenMol antwortet: Sprache von Word
  lang = /^de/i.test(Office.context?.displayLanguage ?? navigator.language ?? '') ? 'de' : 'en'
  applyTexts()
  if (info.host !== Office.HostType.Word) {
    status(t('wordOnly'), true)
    return
  }
  $('edit').disabled = false
  $('edit').onclick = editSelected
  await checkConnection()
  status(t('ready'))
})
