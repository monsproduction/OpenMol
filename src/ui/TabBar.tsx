// Tab-Leiste: mehrere Dokumente gleichzeitig offen. Erscheint erst ab zwei Tabs (wie bei Mac-Apps üblich).
// Klick wechselt, Mittelklick oder × schließt (bei ungesicherten Änderungen mit Nachfrage), ● = ungesichert.
import { switchTab, useStore } from '../store'
import { closeTab, newDocument } from '../tools/io'

export function TabBar() {
  const tabs = useStore((s) => s.tabs)
  const active = useStore((s) => s.activeTab)
  const fileName = useStore((s) => s.fileName)
  const dirty = useStore((s) => s.dirty)
  if (tabs.length < 2) return null
  return (
    <div className="tabbar" role="tablist">
      {tabs.map((t) => {
        const on = t.id === active
        // der aktive Tab zeigt den laufenden Stand (Name, ungesichert), die übrigen ihren gemerkten
        const name = (on ? fileName : t.fileName) || 'Unbenannt'
        const unsaved = on ? dirty : t.dirty
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={on}
            className={'doc-tab' + (on ? ' active' : '')}
            data-tip={name}
            onPointerDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                void closeTab(t.id)
              } else if (e.button === 0) switchTab(t.id)
            }}
          >
            <span className="doc-tab-name">{name}</span>
            <button
              className={'doc-tab-close' + (unsaved ? ' dirty' : '')}
              aria-label="Tab schließen"
              data-tip={unsaved ? 'Ungesicherte Änderungen – Tab schließen (⌘W)' : 'Tab schließen (⌘W)'}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => void closeTab(t.id)}
            >
              <span className="dot" />
              <span className="x">×</span>
            </button>
          </div>
        )
      })}
      <button className="doc-tab-new" aria-label="Neuer Tab" data-tip="Neuer Tab (⌘T)" onClick={() => newDocument()}>
        +
      </button>
    </div>
  )
}
