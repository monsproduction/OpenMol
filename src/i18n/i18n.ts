// Sprache der Oberfläche (Deutsch/Englisch). Die App ist auf Deutsch geschrieben; für Englisch werden die
// angezeigten Texte der Bedienoberfläche (Textknoten und die Attribute title, data-tip, placeholder, aria-label)
// über ein Wörterbuch ausgetauscht. Die Zeichnung selbst (SVG der Zeichenfläche, Vorschaubilder), Eingabefelder und
// bearbeitbarer Text bleiben unberührt. Fehlt eine Übersetzung, bleibt der deutsche Text stehen.
// Beim Zurückschalten auf Deutsch werden die Originaltexte wiederhergestellt.
import { EN, EN_PATTERNS } from './en'
import { getSettings, setSettings } from '../settings'
import { desktop } from '../desktop'

// ---------- Tastenbezeichnungen: Mac ⌘⇧⌥ – unter Windows/Linux „Strg+Umschalt+…“ ----------

export const IS_MAC = desktop ? desktop.platform === 'darwin' : typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform)

/** Mac-Tastensymbole in Windows-Schreibweise (Reihenfolge Strg, Alt, Umschalt): „⇧⌘K“ → „Strg+Umschalt+K“ */
export function winKeys(s: string, lang: 'de' | 'en'): string {
  if (!/[⌘⌃⌥⇧]/.test(s)) return s
  const n = lang === 'en' ? { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' } : { ctrl: 'Strg', alt: 'Alt', shift: 'Umschalt' }
  return s
    .replace(/⌘\s*\/\s*(Strg|Ctrl)|(Strg|Ctrl)\s*\/\s*⌘/g, n.ctrl)
    .replace(/([⌘⌃⌥⇧]+)(\+?)/g, (_m, mods: string, plus: string, off: number, str: string) => {
      const names = [/[⌘⌃]/.test(mods) && n.ctrl, mods.includes('⌥') && n.alt, mods.includes('⇧') && n.shift].filter(Boolean).join('+')
      const next = str[off + _m.length]
      // gefolgt von einer Taste (Buchstabe, Ziffer, Pfeil, Satzzeichen als Taste) → „+“; allein stehend („⌘ = aus“) nicht
      const keyFollows = !!plus || (next !== undefined && !/[\s)]/.test(next))
      return keyFollows ? names + '+' : names
    })
}

/** Tastenkürzel passend zum Rechner beschriften (Mac: Symbole, sonst Strg+ …) */
export const keyLabel = (k: string) => (IS_MAC ? k : winKeys(k, getSettings().uiLang))

const ATTRS = ['title', 'data-tip', 'placeholder', 'aria-label'] as const

// Wörterbuch: exakte Texte und Muster mit Platzhaltern {0}, {1} …
const exact = new Map<string, string>(Object.entries(EN))
const patterns: { re: RegExp; out: string }[] = []
const esc = (s: string) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/[{}]/g, (c) => '\\' + c)
for (const [de, en] of Object.entries(EN_PATTERNS)) {
  const re = new RegExp('^' + esc(de).replace(/\\\{(\d)\\\}/g, '(.*?)') + '$', 's')
  patterns.push({ re, out: en.replace(/\{(\d)\}/g, (_m, i) => '$' + (Number(i) + 1)) })
}

/** Übersetzung eines Oberflächentextes ins Englische (null = keine vorhanden) */
function translate(s: string): string | null {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s)
  if (!m || !m[2]) return null
  const core = m[2]
  let out = exact.get(core) ?? null
  if (out === null) {
    for (const p of patterns)
      if (p.re.test(core)) {
        out = core.replace(p.re, p.out)
        break
      }
  }
  if (out === null) {
    // Werkzeugname mit Tastenkürzel: „Ringe  (R)“, „Einpassen (⌘0)“
    const k = /^(.*\S)(\s+)\(([^()]{1,24})\)$/.exec(core)
    const head = k ? translate(k[1]) : null
    if (k && head !== null) out = head + k[2] + '(' + (translate(k[3]) ?? k[3]) + ')'
  }
  if (out === null && core.includes(' · ')) {
    // Hinweiszeilen aus mehreren Teilen („Klick = … · Ziehen = …“)
    const parts = core.split(' · ').map((x) => translate(x))
    if (parts.every((x) => x !== null)) out = parts.join(' · ')
  }
  return out === null ? null : m[1] + out + m[3]
}

/** Buchstaben der Formatierungsknöpfe: Deutsch F/K/U, Englisch B/I/U */
export function fmtLetters(): { bold: string; italic: string; under: string } {
  return getSettings().uiLang === 'en' ? { bold: 'B', italic: 'I', under: 'U' } : { bold: 'F', italic: 'K', under: 'U' }
}

/** Für Texte, die nicht im DOM stehen (Bestätigungsfragen): passend zur eingestellten Sprache */
export function T(de: string): string {
  const lang = getSettings().uiLang
  const t = lang === 'en' ? (translate(de) ?? de) : de
  return IS_MAC ? t : winKeys(t, lang)
}

// ---------- DOM ----------

const origText = new WeakMap<Text, string>()
const setText = new WeakMap<Text, string>()
const origAttr = new WeakMap<Element, Map<string, string>>()
const setAttr = new WeakMap<Element, Map<string, string>>()
const missing = new Set<string>()
// Entwicklung: alle nicht übersetzten Texte mit Buchstaben sammeln (window.__i18nMissing)
const looksGerman = /[A-Za-zÄÖÜäöüß]{2}/

function excluded(el: Element | null): boolean {
  if (!el) return true
  // Zeichnung, Vorschaubilder, bearbeitbarer Text, Eingaben
  return !!el.closest('svg, [contenteditable="true"], [contenteditable=""], textarea, .no-i18n')
}

/** angezeigter Text für einen Originaltext (null = Original unverändert lassen) */
function render(orig: string, en: boolean): string | null {
  let out = en ? translate(orig) : null
  if (out === null && en && import.meta.env.DEV && looksGerman.test(orig)) missing.add(orig.trim())
  if (!IS_MAC) out = winKeys(out ?? orig, en ? 'en' : 'de')
  return out === null || out === orig ? null : out
}

function doText(n: Text, en: boolean) {
  if (en || !IS_MAC) {
    if (setText.get(n) !== n.nodeValue) origText.set(n, n.nodeValue ?? '') // neuer Text aus der App
    const orig = origText.get(n) ?? ''
    if (excluded(n.parentElement)) return
    const t = render(orig, en)
    if (t !== null) {
      if (n.nodeValue !== t) n.nodeValue = t
      setText.set(n, t)
    } else if (setText.has(n)) {
      if (n.nodeValue === setText.get(n)) n.nodeValue = orig
      setText.delete(n)
    }
  } else if (setText.has(n) && n.nodeValue === setText.get(n)) {
    n.nodeValue = origText.get(n) ?? n.nodeValue
    setText.delete(n)
  }
}

function doAttrs(el: Element, en: boolean) {
  for (const a of ATTRS) {
    const v = el.getAttribute(a)
    if (v === null) continue
    let o = origAttr.get(el)
    let s = setAttr.get(el)
    if (!o) origAttr.set(el, (o = new Map()))
    if (!s) setAttr.set(el, (s = new Map()))
    if (en || !IS_MAC) {
      if (s.get(a) !== v) o.set(a, v)
      const orig = o.get(a) ?? v
      if (excluded(el) && el.tagName.toLowerCase() !== 'svg') continue
      const t = render(orig, en)
      if (t !== null) {
        if (v !== t) el.setAttribute(a, t)
        s.set(a, t)
      } else if (s.has(a)) {
        if (s.get(a) === v) el.setAttribute(a, orig)
        s.delete(a)
      }
    } else if (s.get(a) === v && o.has(a)) {
      el.setAttribute(a, o.get(a)!)
      s.delete(a)
    }
  }
}

function walk(root: Node, en: boolean) {
  if (root.nodeType === 3) return doText(root as Text, en)
  if (root.nodeType !== 1) return
  const el = root as Element
  // Inhalt von Zeichnungen (Linien, Atome …) sofort überspringen – ändert sich beim Zeichnen ständig
  if (el instanceof SVGElement && el.tagName.toLowerCase() !== 'svg') return
  // Zeichnungen (SVG) nur auf Attribute prüfen (z. B. GHS-Symbole mit Tooltip), nicht hineinlaufen
  if (el.tagName.toLowerCase() === 'svg') return doAttrs(el, en)
  doAttrs(el, en)
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === 1 && (n as Element).tagName.toLowerCase() === 'svg' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === 3) doText(n as Text, en)
    else doAttrs(n as Element, en)
  }
  // abgelehnte SVGs: nur ihre eigenen Attribute
  el.querySelectorAll('svg').forEach((s) => doAttrs(s, en))
}

let observer: MutationObserver | null = null

function apply(lang: 'de' | 'en') {
  const en = lang === 'en'
  // aktiv bei Englisch und auf Nicht-Mac-Rechnern (Tastenbezeichnungen)
  const active = en || !IS_MAC
  document.documentElement.lang = lang
  if (active && !observer) {
    observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.target instanceof SVGElement || (r.target.parentNode instanceof SVGElement && r.type !== 'attributes')) continue
        if (r.type === 'characterData') doText(r.target as Text, current === 'en')
        else if (r.type === 'attributes') doAttrs(r.target as Element, current === 'en')
        else r.addedNodes.forEach((n) => walk(n, current === 'en'))
      }
    })
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] })
  }
  if (!active && observer) {
    observer.disconnect()
    observer = null
  }
  walk(document.body, en)
}

let current: 'de' | 'en' = 'de'

/** Beim Start aufrufen; folgt danach den Einstellungen */
let started = false
export function startI18n(subscribe: (cb: () => void) => () => void) {
  if (started) return
  started = true
  current = getSettings().uiLang
  if (current === 'en' || !IS_MAC) apply(current)
  subscribe(() => {
    const l = getSettings().uiLang
    if (l !== current) {
      current = l
      apply(l)
    }
  })
  if (import.meta.env.DEV) (window as unknown as { __i18nMissing: Set<string> }).__i18nMissing = missing
}

export function setUiLang(l: 'de' | 'en') {
  setSettings({ uiLang: l })
}
