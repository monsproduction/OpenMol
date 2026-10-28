// Standard-Dokumentstil (Einstellungen): neue Dokumente beginnen damit statt mit der Vorlage „Standard“.
import { fitLayout } from './model/pages'
import type { Doc, DocStyle } from './model/types'
import { emptyDoc, normalizeDoc } from './model/types'
import { getSettings, setSettings } from './settings'

/** Stil eines Dokuments als Standard speichern (vom Seitenlayout nur Format und Ausrichtung, Hilfslinien nicht) */
export function saveDefaultStyle(style: DocStyle) {
  const { page, aids, ...rest } = style
  const keepAids = aids ? { ...aids, guidesX: undefined, guidesY: undefined } : undefined
  setSettings({
    defaultStyle: JSON.parse(
      JSON.stringify({ ...rest, aids: keepAids, pageFormat: page?.format, pageLandscape: page?.landscape || undefined }),
    ) as Record<string, unknown>,
  })
}

export function resetDefaultStyle() {
  setSettings({ defaultStyle: undefined })
}

/** leeres Dokument mit dem Standard-Dokumentstil (geprüft wie eine geöffnete Datei) */
export function newDoc(): Doc {
  const ds = getSettings().defaultStyle
  if (!ds) return emptyDoc()
  const { pageFormat, pageLandscape, ...style } = ds as { pageFormat?: unknown; pageLandscape?: unknown } & Record<string, unknown>
  const d = normalizeDoc({ ...emptyDoc(), style: { ...emptyDoc().style, ...(style as Partial<DocStyle>) } })
  if (typeof pageFormat === 'string') d.style.page = fitLayout(d, pageFormat, pageLandscape === true, { x: 0, y: 0 })
  return d
}
