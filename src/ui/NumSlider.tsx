import { useEffect, useRef, useState } from 'react'
import { fmtDec, useSettings } from '../settings'

/**
 * Schieberegler mit Zahlenfeld rechts daneben: Ziehen für grobe, Eintippen für genaue Werte.
 * Doppelklick auf Regler oder Feld stellt den Ausgangswert wieder her.
 * `scale` rechnet nur für die Anzeige um (z. B. 100 → Deckkraft 0,35 erscheint als 35 %).
 */
export function NumSlider({
  value,
  min,
  max,
  step,
  onChange,
  def,
  onReset,
  scale = 1,
  unit,
  inputMin = min,
  inputMax = max,
  digits,
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  /** Ausgangswert für den Doppelklick */
  def?: number
  /** statt onChange(def), z. B. um eine Eigenschaft ganz zu entfernen (= automatisch) */
  onReset?: () => void
  scale?: number
  unit?: string
  /** eingetippte Werte dürfen etwas über den Reglerbereich hinausgehen */
  inputMin?: number
  inputMax?: number
  digits?: number
}) {
  useSettings()
  const dig = digits ?? decimalsOf(step * scale)
  const shown = fmtDec(value * scale, dig)
  const [text, setText] = useState(shown)
  const [editing, setEditing] = useState(false)
  // nach Doppelklick/Escape darf das folgende Verlassen des Feldes nichts mehr übernehmen
  const skip = useRef(false)
  useEffect(() => {
    if (!editing) setText(shown)
  }, [shown, editing])

  const reset = () => {
    if (onReset) onReset()
    else if (def !== undefined) onChange(def)
    skip.current = true
    setEditing(false)
  }
  const commitText = () => {
    setEditing(false)
    if (skip.current) {
      skip.current = false
      return
    }
    const x = parseFloat(text.replace(',', '.').replace(/[^\d.+-]/g, ''))
    if (!Number.isFinite(x)) return setText(shown)
    const v = Math.min(inputMax, Math.max(inputMin, x / scale))
    if (v !== value) onChange(v)
    else setText(shown)
  }
  const resettable = onReset !== undefined || def !== undefined
  const tip = resettable ? 'Doppelklick: Ausgangswert' : undefined

  return (
    <span className="num-slider">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={reset} data-tip={tip} />
      <input
        type="text"
        inputMode="decimal"
        className="num-field"
        value={editing ? text : shown}
        onFocus={(e) => {
          skip.current = false
          setEditing(true)
          setText(shown)
          e.target.select()
        }}
        onChange={(e) => {
          skip.current = false
          setEditing(true)
          setText(e.target.value)
        }}
        onBlur={commitText}
        onDoubleClick={reset}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            skip.current = true
            setEditing(false)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        data-tip={tip}
        aria-label="Wert"
      />
      {unit && <span className="num-unit">{unit}</span>}
    </span>
  )
}

function decimalsOf(x: number): number {
  const s = String(+x.toFixed(6))
  const i = s.indexOf('.')
  return i < 0 ? 0 : s.length - i - 1
}
