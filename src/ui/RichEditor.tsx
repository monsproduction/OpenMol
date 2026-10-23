import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { richToEditorHtml, sanitizeRich, toSymbolGreek } from '../model/richtext'
import { FONTS } from '../model/types'
import { useStore } from '../store'
import { useSettings } from '../settings'
import { fmtLetters } from '../i18n/i18n'

/** Formatierungsbefehle auf die aktuelle Auswahl im contentEditable anwenden */
function exec(cmd: string, value?: string) {
  try {
    document.execCommand('styleWithCSS', false, 'false')
  } catch {
    // ältere Browser
  }
  document.execCommand(cmd, false, value)
}

/** Markierten Text als Summenformel kennzeichnen bzw. die Kennzeichnung aufheben */
export function toggleFormula(root: HTMLElement) {
  const sel = window.getSelection()
  let range = sel && sel.rangeCount ? sel.getRangeAt(0) : null
  if (!range || !root.contains(range.commonAncestorContainer)) {
    range = document.createRange()
    range.selectNodeContents(root)
  } else if (range.collapsed) {
    range = document.createRange()
    range.selectNodeContents(root)
  }
  const formulaOf = (n: Node | null): HTMLElement | null => {
    while (n && n !== root) {
      if (n instanceof HTMLElement && n.classList.contains('formula')) return n
      n = n.parentNode
    }
    return null
  }
  const unwrap = (el: Element) => {
    const parent = el.parentNode
    if (!parent) return
    while (el.firstChild) parent.insertBefore(el.firstChild, el)
    parent.removeChild(el)
  }
  // Auswahl liegt komplett in einer Summenformel → aufheben
  const fa = formulaOf(range.startContainer)
  if (fa && fa === formulaOf(range.endContainer)) {
    unwrap(fa)
    return
  }
  // ganzer Inhalt markiert und bereits vollständig Formel → aufheben
  const all = document.createRange()
  all.selectNodeContents(root)
  const whole = range.toString() === all.toString()
  const spans = root.querySelectorAll('span.formula')
  if (whole && spans.length && [...spans].reduce((n, sp) => n + (sp.textContent?.length ?? 0), 0) >= (root.textContent?.trim().length ?? 0)) {
    spans.forEach(unwrap)
    return
  }
  const frag = range.extractContents()
  frag.querySelectorAll('span.formula').forEach(unwrap)
  const span = document.createElement('span')
  span.className = 'formula'
  span.appendChild(frag)
  range.insertNode(span)
  const r2 = document.createRange()
  r2.selectNodeContents(span)
  sel?.removeAllRanges()
  sel?.addRange(r2)
}

let savedRange: Range | null = null
function saveRange(root: HTMLElement | null) {
  const s = window.getSelection()
  if (!root || !s || !s.rangeCount) return
  const r = s.getRangeAt(0)
  if (root.contains(r.commonAncestorContainer)) savedRange = r.cloneRange()
}
function restoreRange(root: HTMLElement | null) {
  if (!root || !savedRange) return
  root.focus()
  const s = window.getSelection()
  s?.removeAllRanges()
  s?.addRange(savedRange)
}

/** Markierte Buchstaben (ohne Markierung: alles) in griechische umwandeln – Schrift „Symbol“ wie in ChemDraw */
function applySymbol(root: HTMLElement) {
  const s = window.getSelection()
  let range = s && s.rangeCount && root.contains(s.getRangeAt(0).commonAncestorContainer) ? s.getRangeAt(0) : null
  if (!range || range.collapsed) {
    range = document.createRange()
    range.selectNodeContents(root)
  }
  const frag = range.extractContents()
  const walker = document.createTreeWalker(frag, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) n.textContent = toSymbolGreek(n.textContent ?? '')
  const span = document.createElement('span')
  span.appendChild(frag)
  range.insertNode(span)
  const r2 = document.createRange()
  r2.selectNodeContents(span)
  s?.removeAllRanges()
  s?.addRange(r2)
}

// ---------- Schriftgröße markierter Zeichen ----------
// Gespeichert als <span style="font-size:1.5em"> relativ zur Grundgröße des Textes; im Feld steht die echte Größe.

/** Produkt aller em-Größen zwischen Knoten und Editor-Wurzel */
function emFactorAt(node: Node | null, root: HTMLElement): number {
  let f = 1
  for (let n = node; n && n !== root; n = n.parentNode) {
    if (n instanceof HTMLElement) {
      const m = /^([\d.]+)em$/.exec(n.style.fontSize)
      if (m) f *= parseFloat(m[1])
    }
  }
  return f
}

/** Markierung im Editor (aktuell oder zuletzt gemerkt) */
function rangeIn(root: HTMLElement): Range | null {
  const s = window.getSelection()
  if (s && s.rangeCount && root.contains(s.getRangeAt(0).commonAncestorContainer)) return s.getRangeAt(0)
  if (savedRange && root.contains(savedRange.commonAncestorContainer)) return savedRange
  return null
}

/** Größenfaktor am Anfang der Markierung */
function factorAtSelection(root: HTMLElement): number {
  const r = rangeIn(root)
  if (!r) return emFactorAt(root.firstChild, root)
  let n: Node | null = r.startContainer
  // Markierung beginnt zwischen Elementen → erstes markiertes Element ansehen
  if (n.nodeType === 1 && n.childNodes[r.startOffset]) n = n.childNodes[r.startOffset]
  while (n && n.nodeType === 1 && n.firstChild && n !== root) n = n.firstChild
  return emFactorAt(n, root)
}

/** Markierten Text (ohne Markierung: alles) auf den Größenfaktor bringen */
function applySizeFactor(root: HTMLElement, factor: number, select: boolean) {
  let range = rangeIn(root)?.cloneRange() ?? null
  if (!range || range.collapsed) {
    range = document.createRange()
    range.selectNodeContents(root)
  }
  // Markierung umfasst genau den Inhalt eines Größen-Spans (z. B. erneutes Ändern) → diesen anpassen statt zu verschachteln
  const c = range.startContainer
  if (c === range.endContainer && c instanceof HTMLElement && c !== root && c.style.fontSize && range.startOffset === 0 && range.endOffset === c.childNodes.length) {
    c.querySelectorAll<HTMLElement>('[style]').forEach((el) => (el.style.fontSize = ''))
    const rel = factor / emFactorAt(c.parentNode, root)
    c.style.fontSize = Math.abs(rel - 1) > 0.001 ? `${Math.round(rel * 1000) / 1000}em` : ''
    const r2 = document.createRange()
    r2.selectNodeContents(c)
    savedRange = r2.cloneRange()
    if (select) {
      root.focus()
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r2)
    }
    return
  }
  const frag = range.extractContents()
  // vorhandene Größen im markierten Teil entfernen, leere Hüll-Spans auflösen
  frag.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
    el.style.fontSize = ''
    if (!el.getAttribute('style')?.trim()) el.removeAttribute('style')
    if (el.tagName === 'SPAN' && !el.attributes.length) {
      while (el.firstChild) el.parentNode?.insertBefore(el.firstChild, el)
      el.remove()
    }
  })
  const rel = factor / emFactorAt(range.startContainer, root)
  const span = document.createElement('span')
  if (Math.abs(rel - 1) > 0.001) span.style.fontSize = `${Math.round(rel * 1000) / 1000}em`
  span.appendChild(frag)
  range.insertNode(span)
  const r2 = document.createRange()
  r2.selectNodeContents(span)
  savedRange = r2.cloneRange()
  if (select) {
    root.focus()
    const s = window.getSelection()
    s?.removeAllRanges()
    s?.addRange(r2)
  }
}

const SIZE_PRESETS_BASE = [6, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64]

/** Feld für die Schriftgröße der Markierung (echte Größe in Zeichnungseinheiten wie „Größe“ im Inspektor) */
function SizeBox({ target, base }: { target: React.RefObject<HTMLDivElement | null>; base: number }) {
  const { decimal } = useSettings()
  const fmt = (v: number) => {
    const x = Math.round(v * 10) / 10
    const t = Number.isInteger(x) ? String(x) : x.toFixed(1)
    return decimal === ',' ? t.replace('.', ',') : t
  }
  const [cur, setCur] = useState(base)
  const [text, setText] = useState<string | null>(null)
  // getippt, aber noch nicht übernommen (Ref, damit das Blur nach Enter nicht ein zweites Mal anwendet)
  const pending = useRef(false)
  const [open, setOpen] = useState(false)
  // Vorschläge inklusive der Grundgröße dieses Textes (z. B. 13,6 bei Pfeiltexten)
  const SIZE_PRESETS = [...new Set([...SIZE_PRESETS_BASE, Math.round(base * 10) / 10])].sort((a, b) => a - b)
  const box = useRef<HTMLSpanElement>(null)
  // Ausklappliste schließen bei Klick außerhalb
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close, true)
    return () => document.removeEventListener('mousedown', close, true)
  }, [open])
  useEffect(() => {
    const upd = () => {
      const root = target.current
      if (root && document.activeElement === root) setCur(factorAtSelection(root) * base)
    }
    upd()
    document.addEventListener('selectionchange', upd)
    return () => document.removeEventListener('selectionchange', upd)
  }, [target, base])
  const apply = (raw: string, refocus: boolean) => {
    pending.current = false
    setText(null)
    const root = target.current
    const v = parseFloat(raw.replace(',', '.'))
    if (!root || !Number.isFinite(v) || v <= 0) return
    const size = Math.min(400, Math.max(1, v))
    applySizeFactor(root, size / base, refocus)
    setCur(size)
    root.dispatchEvent(new Event('input', { bubbles: true }))
  }
  return (
    <span className="rt-size-box" ref={box}>
      <input
        className="rt-size"
        inputMode="decimal"
        value={text ?? fmt(cur)}
        data-tip="Schriftgröße der markierten Zeichen (ohne Markierung: ganzer Text) · Doppelklick: Grundgröße"
        aria-label="Schriftgröße"
        onMouseDown={() => saveRange(target.current)}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          pending.current = true
          setText(e.target.value)
        }}
        onDoubleClick={() => apply(String(base), true)}
        onBlur={(e) => {
          if (pending.current) apply(e.target.value, false)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            apply((e.target as HTMLInputElement).value, true)
          }
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            pending.current = false
            setText(null)
            setOpen(false)
            restoreRange(target.current)
          }
        }}
      />
      <button
        className="rt-size-btn"
        aria-label="Schriftgrößen"
        data-tip="Schriftgröße auswählen"
        onMouseDown={(e) => {
          // Fokus und Markierung im Textfeld lassen
          e.preventDefault()
          saveRange(target.current)
          setOpen(!open)
        }}
      >
        ▾
      </button>
      {open && (
        <div className="rt-size-list" role="listbox">
          {SIZE_PRESETS.map((v) => (
            <div
              key={v}
              role="option"
              aria-selected={Math.abs(v - cur) < 0.05}
              className={'rt-size-opt' + (Math.abs(v - cur) < 0.05 ? ' active' : '') + (Math.abs(v - base) < 0.05 ? ' base' : '')}
              onMouseDown={(e) => {
                e.preventDefault()
                restoreRange(target.current)
                apply(String(v), true)
                setOpen(false)
              }}
            >
              {fmt(v)}
            </div>
          ))}
        </div>
      )}
    </span>
  )
}

export function RichToolbar({
  target,
  style,
  formula,
  baseSize,
}: {
  target: React.RefObject<HTMLDivElement | null>
  style?: CSSProperties
  formula?: boolean
  /** Grundgröße des bearbeiteten Textes (ohne Angabe: Schriftgröße des Dokuments) */
  baseSize?: number
}) {
  const docSize = useStore((s) => s.doc.style.fontSize)
  const btn = (label: React.ReactNode, title: string, cmd: string, value?: string) => (
    <button
      className="rt-btn"
      data-tip={title}
      onMouseDown={(e) => {
        e.preventDefault()
        exec(cmd, value)
        target.current?.dispatchEvent(new Event('input', { bubbles: true }))
      }}
    >
      {label}
    </button>
  )
  return (
    <div className="rich-toolbar" style={style} onMouseDown={(e) => e.stopPropagation()}>
      {btn(<b>{fmtLetters().bold}</b>, 'Fett (⌘B)', 'bold')}
      {btn(<i>{fmtLetters().italic}</i>, 'Kursiv (⌘I)', 'italic')}
      {btn(<u>{fmtLetters().under}</u>, 'Unterstrichen (⌘U)', 'underline')}
      {btn(
        <span>
          x<sup>2</sup>
        </span>,
        'Hochgestellt (⌘↑)',
        'superscript',
      )}
      {btn(
        <span>
          x<sub>2</sub>
        </span>,
        'Tiefgestellt (⌘↓)',
        'subscript',
      )}
      <label className="rt-color" data-tip="Textfarbe" onMouseDown={() => saveRange(target.current)}>
        <span>A</span>
        <input
          type="color"
          defaultValue="#d42a2a"
          onChange={(e) => {
            restoreRange(target.current)
            exec('foreColor', e.target.value)
            target.current?.dispatchEvent(new Event('input', { bubbles: true }))
          }}
        />
      </label>
      <select
        className="rt-font"
        defaultValue=""
        onMouseDown={() => saveRange(target.current)}
        onChange={(e) => {
          if (!e.target.value) return
          restoreRange(target.current)
          if (e.target.value === '__symbol') {
            if (target.current) applySymbol(target.current)
            target.current?.dispatchEvent(new Event('input', { bubbles: true }))
            e.target.value = ''
            return
          }
          exec('fontName', e.target.value)
          target.current?.dispatchEvent(new Event('input', { bubbles: true }))
          e.target.value = ''
        }}
      >
        <option value="">Schrift …</option>
        {FONTS.map((f) => (
          <option key={f.name} value={f.name} style={{ fontFamily: f.css }}>
            {f.name}
          </option>
        ))}
        <option value="__symbol">Symbol (griechisch: a → α)</option>
      </select>
      <SizeBox target={target} base={baseSize ?? docSize} />
      {btn('⌫', 'Formatierung entfernen', 'removeFormat')}
      {formula !== false && (
        <button
          className="rt-btn chem"
          data-tip="Summenformel: markierten Text (ohne Markierung: alles) chemisch formatieren – Zahlen tief, Ladungen hoch. Nochmals klicken = aufheben"
          onMouseDown={(e) => {
            e.preventDefault()
            if (target.current) toggleFormula(target.current)
            target.current?.dispatchEvent(new Event('input', { bubbles: true }))
          }}
        >
          Summenformel
        </button>
      )}
    </div>
  )
}

export function richKeyDown(e: React.KeyboardEvent) {
  const mod = e.metaKey || e.ctrlKey
  if (!mod) return false
  if (e.key === 'ArrowUp' || (e.shiftKey && (e.key === '+' || e.key === '='))) {
    e.preventDefault()
    exec('superscript')
    return true
  }
  if (e.key === 'ArrowDown' || (!e.shiftKey && e.key === '=')) {
    e.preventDefault()
    exec('subscript')
    return true
  }
  if (e.key.toLowerCase() === 'b') {
    e.preventDefault()
    exec('bold')
    return true
  }
  if (e.key.toLowerCase() === 'i') {
    e.preventDefault()
    exec('italic')
    return true
  }
  if (e.key.toLowerCase() === 'u') {
    e.preventDefault()
    exec('underline')
    return true
  }
  return false
}

/** Kleines Rich-Text-Feld für das Eigenschaften-Panel (übernimmt beim Verlassen) */
export function RichField({
  value,
  onCommit,
  placeholder,
  focusEvent,
  baseSize,
}: {
  value: string
  onCommit: (v: string) => void
  placeholder?: string
  focusEvent?: string
  baseSize?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const focused = useRef(false)
  // zuletzt getippter Inhalt, der noch nicht übernommen ist (für Klick außerhalb und Verschwinden des Feldes)
  const pending = useRef<string | null>(null)
  const latest = useRef({ value, onCommit })
  latest.current = { value, onCommit }
  useEffect(() => {
    if (ref.current && !focused.current) ref.current.innerHTML = richToEditorHtml(value)
  }, [value])
  useEffect(() => {
    // Klick außerhalb (z. B. in die Zeichenfläche) übernimmt sofort – dort wechselt der Fokus nicht immer
    const outside = (e: PointerEvent) => {
      const box = ref.current?.closest('.rich-field')
      if (pending.current !== null && box && !box.contains(e.target as Node)) flush()
    }
    document.addEventListener('pointerdown', outside, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      // Feld verschwindet (Auswahl gewechselt) mit noch nicht übernommenem Text → für das bisherige Objekt übernehmen
      flush()
    }
  }, [])
  useEffect(() => {
    if (!focusEvent) return
    const f = () => ref.current?.focus()
    window.addEventListener(focusEvent, f)
    return () => window.removeEventListener(focusEvent, f)
  }, [focusEvent])
  const flush = () => {
    if (pending.current === null) return
    const v = sanitizeRich(pending.current)
    pending.current = null
    if (v !== latest.current.value) latest.current.onCommit(v)
  }
  const commit = () => {
    if (ref.current) pending.current = ref.current.innerHTML
    flush()
  }
  return (
    <div className="rich-field">
      <RichToolbar target={ref} baseSize={baseSize} />
      <div
        ref={ref}
        className="rich-input"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onFocus={() => (focused.current = true)}
        // Formatierungsknöpfe (Fett, Summenformel …) melden sich mit einem künstlichen input-Ereignis → sofort
        // übernehmen, damit die Zeichnung gleich reagiert; Tippen wird weiterhin erst beim Verlassen übernommen
        onInput={(e) => {
          pending.current = (e.currentTarget as HTMLDivElement).innerHTML
          if (!e.nativeEvent.isTrusted) commit()
        }}
        onBlur={() => {
          focused.current = false
          commit()
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (richKeyDown(e)) return
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            ;(e.target as HTMLElement).blur()
          }
        }}
        spellCheck={false}
      />
    </div>
  )
}
