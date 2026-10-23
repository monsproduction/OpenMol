// Globale Tooltips: Beim Überfahren eines Bedienelements erscheint nach kurzer Verzögerung seine Beschreibung
// (data-tip, ersatzweise title oder aria-label). Schwebt über allem (nicht von Scrollbereichen abgeschnitten), bleibt im
// Fenster und funktioniert auch an Eingabefeldern und Auswahllisten. In der linken Werkzeugleiste rechts daneben.
import { useEffect, useRef, useState } from 'react'

const SELECTOR = '[data-tip], [title], button, [role="button"], input:not([type="hidden"]), select, textarea, .insp-head'

function tipOf(el: HTMLElement): string {
  // natives title in data-tip umziehen, damit nicht zusätzlich der Browser-Tooltip erscheint
  const title = el.getAttribute('title')
  if (title) {
    if (!el.dataset.tip) el.dataset.tip = title
    el.removeAttribute('title')
  }
  const own = el.dataset.tip || el.getAttribute('aria-label')
  if (own) return own.trim()
  // umgebendes Element mit Beschreibung (z. B. Farbwähler in einem beschrifteten Rahmen)
  const outer = el.parentElement?.closest('[data-tip], [title]') as HTMLElement | null
  if (outer && outer.contains(el) && !outer.matches('.app, body')) return tipOf(outer)
  return fallback(el).trim()
}

/** Ohne eigene Beschreibung: Text der zugehörigen Beschriftung bzw. des Platzhalters. Knöpfe mit sichtbarem Text
 *  (z. B. „Fertig“) erklären sich selbst und bekommen keinen zusätzlichen Tooltip */
function fallback(el: HTMLElement): string {
  const norm = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim()
  if (el.classList.contains('insp-head')) return `${norm(el.textContent)} – Bereich auf- oder zuklappen`
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) return norm(el.closest('label')?.textContent)
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    const rowLabel = norm(el.closest('.insp-row')?.querySelector(':scope > label')?.textContent)
    const ph = norm(el.getAttribute('placeholder'))
    const own = norm(el.closest('label')?.textContent)
    return rowLabel || own || ph
  }
  return ''
}

export function Tooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; side: 'below' | 'right' | 'above' } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const pos = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  useEffect(() => {
    let timer = 0
    let current: HTMLElement | null = null
    const hide = () => {
      window.clearTimeout(timer)
      current = null
      setTip(null)
    }
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.(SELECTOR) as HTMLElement | null
      if (el === current) return
      hide()
      if (!el || el.closest('.no-tip')) return
      const text = tipOf(el)
      if (!text) return
      current = el
      timer = window.setTimeout(() => {
        if (current !== el || !el.isConnected) return
        const r = el.getBoundingClientRect()
        const inRail = !!el.closest('.rail')
        if (inRail) setTip({ text, x: r.right + 8, y: r.top + r.height / 2, side: 'right' })
        else if (r.bottom + 40 > window.innerHeight) setTip({ text, x: r.left + r.width / 2, y: r.top - 6, side: 'above' })
        else setTip({ text, x: r.left + r.width / 2, y: r.bottom + 6, side: 'below' })
      }, 380)
    }
    const move = (e: MouseEvent) => {
      pos.current = { x: e.clientX, y: e.clientY }
    }
    document.addEventListener('mouseover', over)
    document.addEventListener('mousemove', move, { passive: true })
    document.addEventListener('mousedown', hide, true)
    document.addEventListener('keydown', hide, true)
    window.addEventListener('blur', hide)
    window.addEventListener('scroll', hide, true)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('mouseover', over)
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mousedown', hide, true)
      document.removeEventListener('keydown', hide, true)
      window.removeEventListener('blur', hide)
      window.removeEventListener('scroll', hide, true)
    }
  }, [])

  // im Fenster halten (erst nach dem Messen der Breite)
  const [shift, setShift] = useState(0)
  useEffect(() => {
    const el = box.current
    if (!tip || !el) return setShift(0)
    const r = el.getBoundingClientRect()
    let dx = 0
    if (r.right > window.innerWidth - 8) dx = window.innerWidth - 8 - r.right
    if (r.left + dx < 8) dx = 8 - r.left
    setShift(dx)
  }, [tip])

  if (!tip) return null
  const style: React.CSSProperties =
    tip.side === 'right'
      ? { left: tip.x, top: tip.y, transform: 'translateY(-50%)' }
      : tip.side === 'above'
        ? { left: tip.x + shift, top: tip.y, transform: 'translate(-50%, -100%)' }
        : { left: tip.x + shift, top: tip.y, transform: 'translateX(-50%)' }
  return (
    <div className="tooltip" ref={box} style={style} role="tooltip">
      {tip.text}
    </div>
  )
}
