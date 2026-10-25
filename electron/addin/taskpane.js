// Add-in-Seite in Word: markiertes OpenMol-Bild → OpenMol (zum Bearbeiten) → neues Bild an derselben Stelle.
// Die Zeichnung steckt im PNG selbst (Textblock „openmol“ = „OM1:…“); OpenMol läuft unter https://localhost:5185.
/* global Office, Word */
'use strict'

const $ = (id) => document.getElementById(id)
const OM_RE = /OM1:[A-Za-z0-9_-]{16,}/

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
    $('conn').textContent = `Verbunden mit OpenMol ${j.version}`
  } catch {
    $('conn').textContent = 'OpenMol antwortet nicht – läuft die App?'
  }
}

/** auf das Ergebnis aus OpenMol warten (bis zu 2 Stunden) und das Bild ersetzen */
async function waitAndReplace(session, tag, scale) {
  const until = Date.now() + 2 * 3600 * 1000
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1000))
    let j
    try {
      j = await api('/api/result?s=' + session)
    } catch (e) {
      status('Verbindung zu OpenMol verloren: ' + e.message, true)
      return
    }
    if (!j.ready) continue
    const newWidth = pngWidthPt(latin1(j.png)) * scale
    await Word.run(async (ctx) => {
      const ccs = ctx.document.contentControls.getByTag(tag)
      ccs.load('items')
      await ctx.sync()
      if (!ccs.items.length) throw new Error('Das ursprüngliche Bild wurde inzwischen gelöscht oder verschoben.')
      const cc = ccs.items[0]
      const old = cc.inlinePictures.getFirst()
      const pic = old.insertInlinePictureFromBase64(j.png, 'Replace')
      pic.lockAspectRatio = true
      pic.width = newWidth
      pic.altTextDescription = 'OpenMol-Struktur'
      // Hülle wieder entfernen, das Bild bleibt
      cc.delete(true)
      await ctx.sync()
    })
    status('Bild aktualisiert.')
    return
  }
  status('Zeitüberschreitung – bitte erneut „In OpenMol bearbeiten“.', true)
}

async function editSelected() {
  $('edit').disabled = true
  try {
    let payload = null
    let scale = 1
    const tag = 'openmol-' + Math.random().toString(36).slice(2, 10)
    await Word.run(async (ctx) => {
      const pics = ctx.document.getSelection().inlinePictures
      pics.load('items/width')
      await ctx.sync()
      if (!pics.items.length) throw new Error('Bitte zuerst ein Bild in Word anklicken (ein Bild im Text, nicht frei schwebend).')
      const pic = pics.items[0]
      const b64 = pic.getBase64ImageSrc()
      await ctx.sync()
      const bin = latin1(b64.value)
      payload = OM_RE.exec(bin)?.[0] ?? null
      if (!payload) throw new Error('Dieses Bild enthält keine OpenMol-Daten. Nur Bilder, die mit OpenMol (ab 1.3.2) kopiert wurden, lassen sich bearbeiten.')
      // Maßstab merken, damit das neue Bild genauso groß gezeichnet erscheint
      scale = pic.width / pngWidthPt(bin)
      // Bild markieren, um es später wiederzufinden (auch wenn die Auswahl inzwischen woanders ist)
      const cc = pic.insertContentControl()
      cc.tag = tag
      cc.appearance = 'Hidden'
      await ctx.sync()
    })
    const { session } = await api('/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload }) })
    status('In OpenMol geöffnet. Dort ändern und oben „Zurück nach Word“ klicken …')
    await waitAndReplace(session, tag, scale)
  } catch (e) {
    status(e?.message ?? String(e), true)
  } finally {
    $('edit').disabled = false
  }
}

Office.onReady((info) => {
  if (info.host !== Office.HostType.Word) {
    status('Dieses Add-in ist für Word gedacht.', true)
    return
  }
  $('edit').disabled = false
  $('edit').onclick = editSelected
  status('Bild anklicken, dann „In OpenMol bearbeiten“.')
  void checkConnection()
})
