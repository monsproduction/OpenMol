import type { FillStyle } from '../model/rings'
import { NumSlider } from './NumSlider'
import { useFillBar } from './recentFills'

function previewBg(f: FillStyle) {
  if (f.grad === 'radial') return `radial-gradient(circle, ${f.c1}, ${f.c2})`
  if (f.grad === 'linear') return `linear-gradient(${f.angle + 90}deg, ${f.c1}, ${f.c2})`
  return f.c1
}

export function FillOptions({ value, onChange, compact }: { value: FillStyle; onChange: (f: FillStyle) => void; compact?: boolean; shape?: boolean }) {
  const set = (p: Partial<FillStyle>) => onChange({ ...value, ...p })
  const bar = useFillBar()
  return (
    <div className={'fill-opts' + (compact ? ' compact' : '')}>
      <input type="color" value={value.c1} onChange={(e) => set({ c1: e.target.value })} data-tip={value.grad === 'radial' ? 'Farbe Mitte' : 'Farbe 1'} />
      {value.mode === 'fill' && (
        <>
          <select value={value.grad} onChange={(e) => set({ grad: e.target.value as FillStyle['grad'] })} className="opt-select" data-tip="Art der Füllung: einfarbig oder Farbverlauf">
            <option value="none">einfarbig</option>
            <option value="linear">linearer Verlauf</option>
            <option value="radial">radialer Verlauf</option>
          </select>
          {value.grad !== 'none' && <input type="color" value={value.c2} onChange={(e) => set({ c2: e.target.value })} data-tip={value.grad === 'radial' ? 'Farbe Rand' : 'Farbe 2'} />}
          {value.grad === 'linear' && (
            <label className="mini">
              Winkel
              <NumSlider min={0} max={360} step={15} digits={0} unit="°" value={value.angle} def={0} onChange={(v) => set({ angle: v })} />
            </label>
          )}
        </>
      )}
      <label className="mini">
        Deckkraft
        <NumSlider min={0.1} max={1} step={0.05} scale={100} digits={0} inputMin={0.01} unit="%" value={value.opacity} def={1} onChange={(v) => set({ opacity: v })} />
      </label>
      <div className="fill-presets">
        {/* 8 Plätze: Beispiele, nach und nach ersetzt durch die zuletzt benutzten eigenen Füllungen (neueste links) */}
        {bar.map(({ f, name }, i) => (
          <button
            key={i}
            className="fill-preset"
            data-tip={name ?? 'Eigene Füllung (zuletzt benutzt)'}
            style={{ background: previewBg(f), opacity: f.opacity < 1 ? 0.55 : 1 }}
            onClick={() => onChange({ ...f, mode: value.mode === 'circle' ? 'circle' : 'fill' })}
          />
        ))}
      </div>
    </div>
  )
}
