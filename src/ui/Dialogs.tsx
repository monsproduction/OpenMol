import { useEffect, useMemo, useRef, useState } from 'react'
import { AboutDialog } from './AboutDialog'
import { SYMBOLS, elementCategory, ptPosition } from '../model/elements'
import { nameToStructure, oclToFragment, parseStructure } from '../model/ocl'
import { getScene, sceneBBox } from '../model/scene'
import { TEMPLATE_GROUPS, type Template } from '../model/templates'
import type { Doc } from '../model/types'
import { emptyDoc } from '../model/types'
import { DocContent } from '../render/DocSvg'
import { insertFragment, pasteClip } from '../model/ops'
import {
  addCollection,
  addTemplate,
  deleteCollection,
  deleteTemplate,
  exportUserLib,
  hideBuiltin,
  importUserLib,
  renameCollection,
  restoreBuiltin,
  useUserLib,
  type UserTemplate,
} from '../model/userlib'
import { getState, setState, setTool, toast, useStore } from '../store'
import { getSettings, setSettings, useSettings } from '../settings'
import { useAiStatus } from '../tools/aiBridge'
import { fitView, insertStructureText, selectionAsTemplateClip } from '../tools/actions'
import { copyImageToClipboard, copySmiles, exportMolfile, exportPdf, exportPng, exportSvg, saveBlob, saveDocument } from '../tools/io'
import { exportCdxml } from '../tools/cdxml'
import { Icon } from './Icons'
import { T } from '../i18n/i18n'
import { SECTION_IDS, resetSectionOrder, useSectionOrder } from './inspectorOrder'
import { desktop, type McpInfo } from '../desktop'
import { claudeCodeCommand, mcpConfigJson, mcpPrompt } from '../mcpSetup'

export function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      // Felder mit eigenem Esc (z. B. Umbenennen) behandeln die Taste selbst
      if (e.key === 'Escape' && !(e.target as HTMLElement | null)?.closest?.('[data-own-esc]')) {
        // nicht weiterreichen: sonst setzt das globale Esc zusätzlich Werkzeug und Auswahl zurück
        e.stopPropagation()
        onClose()
      }
    }
    // Capture-Phase: Esc schließt auch, wenn ein Eingabefeld im Dialog die Taste sonst abfängt
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen">
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

const close = () => setState({ dialog: null })

export function Dialogs() {
  const dialog = useStore((s) => s.dialog)
  if (!dialog) return null
  if (dialog === 'import') return <ImportDialog />
  if (dialog === 'periodic') return <PeriodicDialog />
  if (dialog === 'help') return <HelpDialog />
  if (dialog === 'about') return <AboutDialog />
  if (dialog === 'templates') return <TemplatesDialog />
  if (dialog === 'export') return <ExportDialog />
  if (dialog === 'saveTemplate') return <SaveTemplateDialog />
  if (dialog === 'settings') return <SettingsDialog />
  return null
}

// ---------- Import ----------

function ImportDialog() {
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // Treffer der Namenssuche: solange das SMILES unverändert im Feld steht, wird PubChems 2D-Darstellung verwendet
  const [pub, setPub] = useState<{ smiles: string; molfile?: string } | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  // Einfügepunkt (Rechtsklick „Name → Struktur“) gilt nur für diesen Dialog: beim Öffnen merken und zurücksetzen
  const at = useRef(getState().importAt)
  useEffect(() => {
    ref.current?.focus()
    if (getState().importAt) setState({ importAt: null })
  }, [])
  const source = pub?.molfile && text === pub.smiles ? pub.molfile : text

  const { preview, parseErr } = useMemo((): { preview: Doc | null; parseErr: string } => {
    if (!source.trim()) return { preview: null, parseErr: '' }
    try {
      const mol = parseStructure(source)
      const f = oclToFragment(mol, 40)
      const d: Doc = emptyDoc()
      for (const a of f.atoms) d.atoms[a.id] = a
      for (const b of f.bonds) d.bonds[b.id] = b
      return { preview: d, parseErr: '' }
    } catch (e) {
      return { preview: null, parseErr: e instanceof Error ? e.message : '' }
    }
  }, [source])

  const searchName = async () => {
    if (!name.trim()) return
    setBusy(true)
    setErr('')
    try {
      const r = await nameToStructure(name.trim())
      setPub(r)
      setText(r.smiles)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Struktur importieren" onClose={close} wide>
      <div className="import-grid">
        <div>
          <label className="field-label">Name oder CAS-Nummer → Struktur (PubChem, online)</label>
          <div className="input-row">
            <input
              ref={ref}
              value={name}
              placeholder="z. B. caffeine, ibuprofen oder 50-78-2"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') searchName()
              }}
            />
            <button className="btn" onClick={searchName} disabled={busy}>
              {busy ? 'Suche …' : 'Suchen'}
            </button>
          </div>
          <p className="muted small">Die Suche schickt den eingegebenen Namen bzw. die CAS-Nummer an PubChem (NIH). Englische Namen funktionieren am zuverlässigsten.</p>
          {err && <p className="error">{err}</p>}
          <label className="field-label">SMILES oder Molfile</label>
          <textarea
            className="mono"
            rows={8}
            value={text}
            placeholder="z. B. CC(=O)Oc1ccccc1C(=O)O"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        <div className="import-preview">
          {preview ? <Thumb doc={preview} size={260} /> : <p className="muted">{text.trim() ? parseErr || 'Nicht lesbar' : 'Vorschau'}</p>}
        </div>
      </div>
      <footer>
        <button className="btn ghost" onClick={close}>
          Abbrechen
        </button>
        <button
          className="btn primary"
          disabled={!preview}
          onClick={() => {
            if (insertStructureText(source, at.current ?? undefined)) {
              close()
              setTool('select')
            }
          }}
        >
          Einfügen
        </button>
      </footer>
    </Modal>
  )
}

// ---------- Periodensystem ----------

function PeriodicDialog() {
  const pick = (el: string) => {
    setTool('atom', { element: el, label: null })
    close()
  }
  return (
    <Modal title="Periodensystem" onClose={close} wide>
      <div className="pse">
        {SYMBOLS.map((s, i) => {
          const z = i + 1
          const { row, col } = ptPosition(z)
          return (
            <button
              key={s}
              className={'pse-el cat-' + elementCategory(z)}
              style={{ gridRow: row + (row >= 9 ? 0.5 : 0), gridColumn: col }}
              onClick={() => pick(s)}
              title={`${s} (${z})`}
            >
              <small>{z}</small>
              <b>{s}</b>
            </button>
          )
        })}
      </div>
      <p className="muted small">Element wählen und dann auf ein Atom klicken. Schneller: Maus über ein Atom halten und das Elementsymbol tippen (z. B. N, O, S; l = Cl, b = Br). Andere Buchstaben (z. B. R) werden direkt als Beschriftung gesetzt.</p>
    </Modal>
  )
}

// ---------- Vorlagen ----------

const thumbCache = new Map<string, Doc | null>()
function templateDoc(t: Template): Doc | null {
  if (thumbCache.has(t.name)) return thumbCache.get(t.name)!
  let d: Doc | null = null
  try {
    const f = t.build ? t.build(40) : oclToFragment(parseStructure(t.smiles!), 40)
    d = emptyDoc()
    insertFragment(d, f)
  } catch {
    d = null
  }
  thumbCache.set(t.name, d)
  return d
}

export function Thumb({ doc, size }: { doc: Doc; size: number }) {
  const scene = getScene(doc)
  const box = sceneBBox(scene)
  if (!box) return null
  // einheitlicher Maßstab: kleine Moleküle nicht aufblasen
  const pad = 10
  const minSize = 150
  const w = Math.max(minSize, box.x2 - box.x1 + pad * 2)
  const h = Math.max(minSize, box.y2 - box.y1 + pad * 2)
  const cx = (box.x1 + box.x2) / 2
  const cy = (box.y1 + box.y2) / 2
  return (
    <svg viewBox={`${cx - w / 2} ${cy - h / 2} ${w} ${h}`} width={size} height={size} className="thumb">
      <DocContent scene={scene} exportMode />
    </svg>
  )
}

const userThumbCache = new Map<string, Doc>()
function userTemplateDoc(t: UserTemplate): Doc {
  const c = userThumbCache.get(t.id)
  if (c) return c
  const d = emptyDoc()
  pasteClip(d, t.clip, 0, 0)
  userThumbCache.set(t.id, d)
  return d
}

type GroupKey = string // 'b:<Name>' (mitgeliefert) bzw. 'u:<id>' (eigene)

function TemplatesDialog() {
  const lib = useUserLib()
  const builtin = TEMPLATE_GROUPS.filter((g) => !lib.hiddenBuiltin.includes(g.name))
  const firstKey: GroupKey = lib.collections.length && getState().opts.templateName.startsWith('user:') ? 'u:' + lib.collections[0].id : builtin[0] ? 'b:' + builtin[0].name : lib.collections[0] ? 'u:' + lib.collections[0].id : ''
  const [group, setGroup] = useState<GroupKey>(firstKey)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<string | null>(null) // Sammlung, die gerade umbenannt wird ('new' = neue)
  const [draft, setDraft] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const current = useStore((s) => s.opts.templateName)
  const valid = (k: GroupKey) => (k.startsWith('b:') ? builtin.some((g) => 'b:' + g.name === k) : lib.collections.some((c) => 'u:' + c.id === k))
  const key = valid(group) ? group : firstKey
  const ql = q.trim().toLowerCase()

  type Entry = { key: string; name: string; doc: Doc | null; tplName: string; userId?: string }
  const builtinEntries = (items: Template[]): Entry[] => items.map((t) => ({ key: 'b' + t.name, name: t.name, doc: templateDoc(t), tplName: t.name }))
  const userEntries = (items: UserTemplate[]): Entry[] => items.map((t) => ({ key: 'u' + t.id, name: t.name, doc: userTemplateDoc(t), tplName: 'user:' + t.id, userId: t.id }))
  let entries: Entry[]
  if (ql) {
    entries = [
      ...userEntries(lib.collections.flatMap((c) => c.items).filter((t) => t.name.toLowerCase().includes(ql))),
      ...builtinEntries(builtin.flatMap((g) => g.items).filter((t) => t.name.toLowerCase().includes(ql))),
    ]
  } else if (key.startsWith('u:')) entries = userEntries(lib.collections.find((c) => 'u:' + c.id === key)?.items ?? [])
  else entries = builtinEntries(builtin.find((g) => 'b:' + g.name === key)?.items ?? [])
  const userGroup = !ql && key.startsWith('u:') ? lib.collections.find((c) => 'u:' + c.id === key) : null

  const finishEdit = () => {
    const n = draft.trim()
    if (editing === 'new') {
      if (n) {
        const c = addCollection(n)
        setGroup('u:' + c.id)
      }
    } else if (editing && n) renameCollection(editing, n)
    setEditing(null)
    setDraft('')
  }
  const editInput = (
    <input
      className="tpl-edit"
      data-own-esc
      autoFocus
      value={draft}
      placeholder="Name der Sammlung"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finishEdit()
        if (e.key === 'Escape') {
          setEditing(null)
          setDraft('')
        }
      }}
      onBlur={finishEdit}
    />
  )

  return (
    <Modal title="Vorlagen-Bibliothek" onClose={close} wide>
      <div className="tpl-layout">
        <div className="tpl-side">
          <input className="tpl-search" placeholder="Suchen …" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          <div className="tpl-head">Eigene Sammlungen</div>
          {lib.collections.map((c) =>
            editing === c.id ? (
              <div key={c.id}>{editInput}</div>
            ) : (
              <div key={c.id} className={'tpl-cat' + ('u:' + c.id === key && !ql ? ' active' : '')} onClick={() => (setGroup('u:' + c.id), setQ(''))}>
                <span className="tpl-cat-name" onDoubleClick={() => (setEditing(c.id), setDraft(c.name))}>
                  {c.name}
                </span>
                <span className="tpl-cat-tools">
                  <button className="tpl-mini" data-tip="Umbenennen" onClick={(e) => (e.stopPropagation(), setEditing(c.id), setDraft(c.name))}>
                    <Icon name="edit" size={13} />
                  </button>
                  <button
                    className="tpl-mini"
                    data-tip="Sammlung löschen"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (window.confirm(T(`Sammlung „${c.name}“ mit ${c.items.length} Vorlage(n) endgültig löschen?`))) deleteCollection(c.id)
                    }}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </span>
                <span className="tpl-count">{c.items.length}</span>
              </div>
            ),
          )}
          {editing === 'new' ? (
            editInput
          ) : (
            <button className="tpl-new" onClick={() => (setEditing('new'), setDraft(''))}>
              + Neue Sammlung
            </button>
          )}
          <div className="tpl-head">Mitgeliefert</div>
          {builtin.map((g) => (
            <div key={g.name} className={'tpl-cat' + ('b:' + g.name === key && !ql ? ' active' : '')} onClick={() => (setGroup('b:' + g.name), setQ(''))}>
              <span className="tpl-cat-name">{g.name}</span>
              <span className="tpl-cat-tools">
                <button
                  className="tpl-mini"
                  data-tip="Sammlung entfernen (wiederherstellbar)"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (window.confirm(T(`Sammlung „${g.name}“ aus der Bibliothek entfernen? Über „Standard-Sammlungen wiederherstellen“ kommt sie zurück.`))) hideBuiltin(g.name)
                  }}
                >
                  <Icon name="trash" size={13} />
                </button>
              </span>
              <span className="tpl-count">{g.items.length}</span>
            </div>
          ))}
          {lib.hiddenBuiltin.length > 0 && (
            <button className="tpl-new" onClick={restoreBuiltin}>
              Standard-Sammlungen wiederherstellen ({lib.hiddenBuiltin.length})
            </button>
          )}
          <div className="tpl-io">
            <button
              className="btn small"
              disabled={!lib.collections.length}
              data-tip="Eigene Sammlungen als Datei sichern (z. B. für einen anderen Rechner)"
              onClick={() => {
                void saveBlob('OpenMol-Vorlagen.json', new Blob([exportUserLib()], { type: 'application/json' }))
              }}
            >
              Exportieren
            </button>
            <button className="btn small" data-tip="Vorlagen-Datei laden (gleichnamige Sammlungen werden zusammengeführt)" onClick={() => fileRef.current?.click()}>
              Importieren
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                try {
                  const n = importUserLib(await f.text())
                  toast(n ? `${n} Vorlage(n) importiert` : 'Keine neuen Vorlagen in der Datei')
                } catch (err) {
                  toast(err instanceof Error ? err.message : 'Import fehlgeschlagen', 'error')
                }
              }}
            />
          </div>
        </div>
        <div className="tpl-grid">
          {userGroup && !userGroup.items.length && (
            <p className="muted tpl-empty">
              Noch leer. Struktur zeichnen, markieren und im Eigenschaften-Panel <b>„Zur Bibliothek hinzufügen“</b> wählen.
            </p>
          )}
          {entries.map((t) => (
            <div
              key={t.key}
              role="button"
              tabIndex={0}
              className={'tpl-item' + (current === t.tplName ? ' active' : '')}
              onClick={() => {
                setTool('template', { templateName: t.tplName })
                close()
                toast(`„${t.name}“ – zum Einfügen auf die Zeichenfläche klicken`)
              }}
            >
              <div className="tpl-thumb">{t.doc && <Thumb doc={t.doc} size={96} />}</div>
              <span>{t.name}</span>
              {t.userId && (
                <button
                  className="tpl-del"
                  data-tip="Vorlage löschen"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (window.confirm(T(`Vorlage „${t.name}“ löschen?`))) deleteTemplate(t.userId!)
                  }}
                >
                  <Icon name="close" size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

// ---------- Zur Bibliothek hinzufügen ----------

const NEW = '__new__'

// ---------- Einstellungen ----------

/** KI-Anwendung mit der installierten App verbinden: fertige Texte mit den Pfaden dieses Rechners kopieren */
function McpSetup({ info }: { info: McpInfo }) {
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast(what + ' ' + T('kopiert – in die KI-Anwendung einfügen'))
    } catch {
      toast(T('Kopieren nicht möglich'), 'error')
    }
  }
  return (
    <SRow label="KI-Anwendung verbinden" tip="Der MCP-Server ist Teil von OpenMol – kein Projektordner und kein Node.js nötig. Nach dem Eintragen die KI-Anwendung neu starten.">
      <div className="cyc-add">
        <button
          className="btn small"
          data-tip="Text für die KI (Claude, Cursor, VS Code …): sie richtet die Verbindung selbst ein oder führt Schritt für Schritt hindurch. Schaltet die KI-Steuerung hier ein."
          onClick={() => {
            setSettings({ aiControl: true })
            void copy(mcpPrompt(info, getSettings().uiLang, desktop?.platform ?? ''), T('Prompt'))
          }}
        >
          Prompt für die KI kopieren
        </button>
        <button className="btn small" data-tip="Eintrag für Claude Desktop, Cursor, Windsurf, LM Studio, Gemini CLI (mcpServers)" onClick={() => void copy(mcpConfigJson(info), T('Konfiguration'))}>
          Konfiguration kopieren
        </button>
        <button className="btn small" data-tip="Befehl für das Terminal (Claude Code, für alle Projekte)" onClick={() => void copy(claudeCodeCommand(info), T('Befehl'))}>
          Befehl für Claude Code
        </button>
      </div>
    </SRow>
  )
}

/** Zeile der Einstellungen: Bezeichnung links (Erklärung als Tooltip), Bedienelement rechts */
function SRow({ label, tip, children }: { label: string; tip?: string; children: React.ReactNode }) {
  return (
    <>
      <label className="set-label" data-tip={tip}>
        {label}
        {tip && <span className="set-info">ⓘ</span>}
      </label>
      <div className="set-ctrl">{children}</div>
    </>
  )
}

/** Umschalter aus zwei oder mehr Knöpfen */
function SegPick<T extends string | boolean>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => (
        <button key={String(v)} className={value === v ? 'active' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  )
}

function SettingsDialog() {
  const s = useSettings()
  const ai = useAiStatus()
  const defaultOrder = useSectionOrder().every((id, i) => id === SECTION_IDS[i])
  // Desktop-App: mitgelieferter MCP-Server (Pfade für die Einrichtung der KI-Anwendung)
  const [mcp] = useState(() => desktop?.mcpInfo())
  return (
    <Modal title="Einstellungen" onClose={close}>
      <div className="settings-rows">
        <h4 className="set-group">Allgemein</h4>
        <SRow label="Sprache">
          <SegPick value={s.uiLang} options={[['de', 'Deutsch'], ['en', 'English']]} onChange={(v) => setSettings({ uiLang: v })} />
        </SRow>
        <SRow label="Dezimaltrennzeichen" tip="Gilt überall: Analyse, Ansatztabellen (auch im Schema und in Exporten). Eingaben verstehen immer beides.">
          <SegPick value={s.decimal} options={[[',', 'Komma (1,25)'], ['.', 'Punkt (1.25)']]} onChange={(v) => setSettings({ decimal: v })} />
        </SRow>
        <SRow label="Inspektor" tip="Kategorien lassen sich an ihrer Überschrift verschieben (ziehen oder ⌥↑ / ⌥↓).">
          <button className="btn small" onClick={() => resetSectionOrder()} disabled={defaultOrder}>
            Reihenfolge zurücksetzen
          </button>
        </SRow>

        <h4 className="set-group">Ansatztabellen</h4>
        <SRow
          label="CAS & GHS aus PubChem"
          tip="Automatisch: Edukte, Reagenzien und Lösungsmittel werden beim Anlegen in PubChem (online) nachgeschlagen. Produkte nie automatisch – neue Verbindungen verlassen den Rechner nur, wenn Sie „CAS & GHS suchen“ wählen."
        >
          <SegPick value={s.autoPubchem} options={[[true, 'Automatisch'], [false, 'Nur per Knopf']]} onChange={(v) => setSettings({ autoPubchem: v })} />
        </SRow>

        <h4 className="set-group">KI-Steuerung (MCP)</h4>
        <SRow label="Steuerung durch KI">
          <SegPick value={s.aiControl} options={[[true, 'Erlauben'], [false, 'Aus']]} onChange={(v) => setSettings({ aiControl: v })} />
        </SRow>
        <p className="muted small set-note">
          {s.aiControl
            ? ai === 'connected'
              ? '● Verbunden – eine KI-Anwendung kann die Zeichnung bearbeiten (alles mit ⌘Z rückgängig).'
              : desktop
                ? '○ Warte auf eine KI-Anwendung – Einrichtung über „Prompt für die KI kopieren“.'
                : '○ Warte auf den OpenMol-MCP-Server (127.0.0.1:5181) – er wird von der KI-Anwendung gestartet. Einrichtung: siehe mcp/ANLEITUNG.md.'
            : 'Aus: Die App nimmt keine Befehle von außen an.'}
        </p>
        {mcp?.available && <McpSetup info={mcp} />}

        {desktop && (
          <>
            <h4 className="set-group">{`Updates · Version ${desktop.appVersion()}`}</h4>
            <SRow label="Nach Updates suchen" tip="Automatisch: Beim Start (höchstens einmal am Tag) wird bei GitHub nach einer neuen Version gefragt; installiert wird nur nach Rückfrage.">
              <div className="cyc-add">
                <SegPick value={s.autoUpdate} options={[[true, 'Automatisch'], [false, 'Nur von Hand']]} onChange={(v) => setSettings({ autoUpdate: v })} />
                <button className="btn small" onClick={() => desktop?.checkUpdates()}>
                  Jetzt suchen
                </button>
              </div>
            </SRow>
          </>
        )}
      </div>
      <footer>
        <button className="btn primary" onClick={close}>
          Fertig
        </button>
      </footer>
    </Modal>
  )
}

function SaveTemplateDialog() {
  const lib = useUserLib()
  const [name, setName] = useState('')
  const [col, setCol] = useState<string>(lib.collections[0]?.id ?? NEW)
  const [newName, setNewName] = useState(lib.collections.length ? '' : 'Eigene Vorlagen')
  const clip = useMemo(() => selectionAsTemplateClip(), [])
  const thumb = useMemo(() => {
    if (!clip) return null
    const d = emptyDoc()
    pasteClip(d, clip, 0, 0)
    return d
  }, [clip])
  const save = () => {
    if (!clip) return
    let id = col
    if (col === NEW) {
      if (!newName.trim()) return toast('Namen für die neue Sammlung eingeben', 'error')
      id = addCollection(newName).id
    }
    addTemplate(id, name || 'Ohne Namen', clip)
    close()
    toast(`„${name || 'Ohne Namen'}“ zur Bibliothek hinzugefügt`)
  }
  return (
    <Modal title="Zur Bibliothek hinzufügen" onClose={close}>
      {!clip ? (
        <p className="muted">Zuerst eine Struktur markieren.</p>
      ) : (
        <div className="save-tpl">
          <div className="tpl-thumb big">{thumb && <Thumb doc={thumb} size={150} />}</div>
          <label>
            Name
            <input autoFocus value={name} placeholder="z. B. Mein Ligand" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => (e.stopPropagation(), e.key === 'Enter' && save())} />
          </label>
          <label>
            Sammlung
            <select value={col} onChange={(e) => setCol(e.target.value)}>
              {lib.collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value={NEW}>+ Neue Sammlung …</option>
            </select>
          </label>
          {col === NEW && (
            <label>
              Neue Sammlung
              <input value={newName} placeholder="Name der Sammlung" onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => (e.stopPropagation(), e.key === 'Enter' && save())} />
            </label>
          )}
          <div className="dlg-actions">
            <button className="btn" onClick={close}>
              Abbrechen
            </button>
            <button className="btn primary" onClick={save}>
              Hinzufügen
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ---------- Export ----------

function ExportDialog() {
  const sel = useStore((s) => s.sel)
  const hasSel = Object.values(sel).some((a) => a.length)
  const [onlySel, setOnlySel] = useState(hasSel)
  const [scale, setScale] = useState(4)
  const [transparent, setTransparent] = useState(false)
  return (
    <Modal title="Exportieren" onClose={close}>
      {hasSel && (
        <label className="check">
          <input type="checkbox" checked={onlySel} onChange={(e) => setOnlySel(e.target.checked)} /> Nur Auswahl exportieren
        </label>
      )}
      <div className="export-list">
        <button className="export-item" onClick={() => (exportSvg(onlySel), close())}>
          <Icon name="image" />
          <div>
            <b>SVG-Vektorgrafik</b>
            <span>Verlustfrei skalierbar – ideal für Word, PowerPoint, Illustrator, LaTeX</span>
          </div>
        </button>
        <div className="export-item static">
          <Icon name="image" />
          <div>
            <b>PNG-Bild</b>
            <span className="inline-opts">
              Auflösung
              <select value={scale} onChange={(e) => setScale(Number(e.target.value))} data-tip="Auflösung des PNG-Bildes (größer = schärfer, größere Datei)">
                <option value={2}>2× (klein)</option>
                <option value={4}>4× (Standard)</option>
                <option value={8}>8× (Poster)</option>
              </select>
              <label>
                <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> transparent
              </label>
            </span>
          </div>
          <button className="btn small" onClick={() => (exportPng(scale, transparent, onlySel), close())}>
            Speichern
          </button>
        </div>
        <button className="export-item" onClick={() => (void exportPdf(), close())}>
          <Icon name="export" />
          <div>
            <b>PDF</b>
            <span>Vektor-PDF zum Drucken und Weitergeben – bei Seitenlayout je Blatt eine Seite</span>
          </div>
        </button>
        <button className="export-item" onClick={() => (copyImageToClipboard(), close())}>
          <Icon name="copy" />
          <div>
            <b>Als Bild kopieren</b>
            <span>PNG in die Zwischenablage – in Word/PowerPoint einfügen (auch mit ⌘C)</span>
          </div>
        </button>
        <button className="export-item" onClick={() => (exportCdxml(), close())}>
          <Icon name="export" />
          <div>
            <b>ChemDraw-Dokument (.cdxml)</b>
            <span>Öffnet in ChemDraw mit Strukturen, Pfeilen, Texten und Klammern (Ringfüllungen werden nicht übernommen)</span>
          </div>
        </button>
        <button className="export-item" onClick={() => (exportMolfile(), close())}>
          <Icon name="export" />
          <div>
            <b>MDL Molfile (.mol)</b>
            <span>Für andere Chemie-Programme (ChemDraw, Reaxys, SciFinder …)</span>
          </div>
        </button>
        <button className="export-item" onClick={() => (copySmiles(), close())}>
          <Icon name="copy" />
          <div>
            <b>SMILES kopieren</b>
            <span>Textdarstellung der Struktur (mit Stereochemie)</span>
          </div>
        </button>
        <button className="export-item" onClick={() => (void saveDocument(), close())}>
          <Icon name="save" />
          <div>
            <b>Dokument speichern</b>
            <span>Eigenes Format – enthält alles inkl. Pfeilen, Texten und Stil</span>
          </div>
        </button>
      </div>
    </Modal>
  )
}

// ---------- Hilfe ----------

const SHORTCUTS: [string, string][] = [
  ['V', 'Auswählen'],
  ['E', 'Radierer'],
  ['1 / 2 / 3', 'Einfach-/Doppel-/Dreifachbindung'],
  ['W / H', 'Keil / schraffierte Bindung'],
  ['K', 'Kette'],
  ['R / J', 'Benzolring'],
  ['A', 'Reaktionspfeil'],
  ['M', 'Mechanismuspfeil (Umschalt+M: Halbpfeil)'],
  ['T', 'Text'],
  ['+ / −', 'Ladungswerkzeug'],
  ['Leertaste + Ziehen', 'Ansicht verschieben'],
  ['⌘/Strg + Mausrad', 'Zoomen'],
  ['⌘/Strg + Z / ⇧⌘Z', 'Rückgängig / Wiederholen'],
  ['⌘/Strg + C / X / V', 'Kopieren / Ausschneiden / Einfügen (auch SMILES)'],
  ['Bild aus Word/PowerPoint', 'Von OpenMol kopierte Bilder tragen die Zeichnung in sich: dort kopieren, in OpenMol einfügen – wieder bearbeitbar (Desktop-App; unter Windows noch ungetestet)'],
  ['⌘/Strg + D', 'Duplizieren'],
  ['⌘/Strg + P', 'Drucken (Seitenlayout wie beim PDF)'],
  ['⌘/Strg + G / ⇧⌘G', 'Gruppieren / Gruppierung aufheben'],
  ['⌘/Strg + L / ⇧⌘L', 'Sperren / Alle entsperren'],
  ['⌘/Strg + B / I', 'Ausgewählte Atome/Texte fett / kursiv'],
  ['⌘/Strg + A', 'Alles auswählen'],
  ['Klick auf Atom/Bindung', 'Nur dieses Atom bzw. diese Bindung markieren'],
  ['Doppelklick auf Atom/Bindung', 'Ganzes Molekül markieren'],
  ['Enter (Auswahl)', 'Auswahl wird Hotspot (grüner Punkt) für ChemDraw-Tasten; nochmals Enter = Atom beschriften'],
  ['Leertaste / Tab (Hotspot)', 'Ganzes Molekül markieren'],
  ['Pfeiltasten (Hotspot)', 'Hotspot zum nächsten Atom bzw. zur nächsten Bindung bewegen'],
  ['⌘/Strg + S / ⇧⌘S', 'Speichern / Speichern unter'],
  ['⌘/Strg + O', 'Öffnen'],
  ['⌘/Strg + N / T', 'Neues Dokument in einem neuen Tab (Desktop-App)'],
  ['⌘/Strg + W', 'Tab schließen (Desktop-App)'],
  ['Strg + Tab / Strg + ⇧ + Tab', 'Nächster / vorheriger Tab (Desktop-App)'],
  ['⌘/Strg + E', 'Exportieren'],
  ['⌘/Strg + 0', 'Ansicht einpassen'],
  ['⇧⌘K', 'Struktur aufräumen'],
  ['⇧⌘X', 'Reaktion aufräumen'],
  ['⇧⌘D', 'Markierte Struktur in 3D / zurück in 2D'],
  ['Entf / ⌫', 'Auswahl löschen'],
  ['Pfeiltasten', 'Auswahl verschieben (⇧ = 10×)'],
  ['⌥ + ← / →', 'Auswahl um 15° drehen (⌥ + ↑ / ↓: um 1°)'],
  ['⇧⌥ + Pfeiltasten', 'Auswahl räumlich (3D) drehen'],
  ['⌘ + Pfeiltaste', 'Reaktion: Kopie der Moleküle hinter einem neuen Reaktionspfeil'],
  ['⌘/Strg beim Ziehen', 'Magnetische Hilfslinien kurz ausschalten'],
  ['Esc', 'Abbrechen / Auswahl aufheben'],
  ['Im Text: ⌘B / ⌘I / ⌘U', 'Fett / Kursiv / Unterstrichen'],
  ['Im Text: ⌘↑ / ⌘↓', 'Hoch- / Tiefstellen'],
  ['Ringfüllung: Doppelklick', 'Ganzes anelliertes Ringsystem mit einem Verlauf füllen'],
  ['⇧⌘F / ⇧⌘B', 'Auswahl in den Vordergrund / Hintergrund'],
  ['⌥⇧⌘F / ⌥⇧⌘B', 'Auswahl eine Ebene nach vorn / hinten'],
  ['Zyklus: Doppelklick auf Bogen', 'Schrittbezeichnung (z. B. „oxidative Addition“) anlegen'],
  ['Ansatztabelle: Doppelklick', 'Editor öffnen (Mengen mit Einheit eintippen, z. B. 105 mg)'],
  ['⌘\\', 'Inspektor (rechte Leiste) ein-/ausblenden'],
  ['⌘,', 'Einstellungen (Dezimaltrennzeichen, Sprache …)'],
]

const HOVER_KEYS: [string, string][] = [
  ['o n s p f l b h i', 'O, N, S, P, F, Cl, Br, H, I (auch für markierte Atome)'],
  ['c', 'C – auf einem C-Atom: Beschriftung CH₃ ein-/ausblenden'],
  ['O N S P F C L B', 'OMe, NO₂, SiH₃, Ph, CF₃, Cl, Li, BH₂'],
  ['m e A y H Q E M d Z', 'Me, Et, Ac, Boc, Cbz, Fmoc, CO₂Me, MgBr, D, N₃'],
  ['1 / 0', 'Bindung anhängen (0: in die andere Richtung)'],
  ['2', 'Carbonyl (=O), am Kettenende mit weiterer Bindung'],
  ['8 / z', 'Doppel- / Dreifachbindung anhängen'],
  ['9 / 4 / 5', 'Methyl-Verzweigung (4/5 als Keil/Schraffur); am Ringatom 9: gem-Dimethyl'],
  ['K', 'Quartäres C; am Ringatom: gem-Dimethyl mit Keil und Schraffur'],
  ['k', 'Sulfonyl (SO₂)'],
  ['3 / a · 6 · 7 · u · v', 'Benzol, Cyclohexan, Cyclopentan, Cyclobutan, Cyclopropan (am Ringatom: spiro)'],
  ['andere Buchstaben (R, X, T …)', 'Genau dieser Buchstabe als Beschriftung (z. B. R für einen Rest)'],
  ['+ / −', 'Ladung ändern'],
  ['. / : / *', 'Radikal / freies Elektronenpaar / Stereozentrum'],
  ['Enter', 'Label bearbeiten'],
  ['g', 'Atom bzw. Bindung markieren'],
  ['Bindung: 1 2 3', 'Bindungsordnung'],
  ['Bindung: w · h / W · b · d · D · y', 'Keil, Schraffur (nochmals: umdrehen), fett, gestrichelt, aromatisch, Wellenlinie'],
  ['Bindung: a z v 4–8', 'Ring ankondensieren: Benzol, Cyclopentadien, 3- bis 8-Ring'],
  ['Bindung: 9 / 0', 'Sessel-Cyclohexan (zwei Ausrichtungen)'],
  ['Entf (über Objekt)', 'Löschen'],
]

function HelpDialog() {
  return (
    <Modal title="Tastenkürzel & Tipps" onClose={close} wide>
      <div className="help-grid">
        <div>
          <h3>Allgemein</h3>
          <table className="keys">
            <tbody>
              {SHORTCUTS.map(([k, v]) => (
                <tr key={k}>
                  <td>
                    <kbd>{k}</kbd>
                  </td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3>ChemDraw-Tasten: Maus über Atom/Bindung oder am Hotspot</h3>
          <p className="muted small">
            Nach einer dieser Tasten markiert ein grüner Punkt den Hotspot – weitere Tasten wirken dort, auch ohne Maus darüber. So entstehen ganze
            Moleküle mit der Tastatur, z. B. an einem Benzol-Atom <code>1B79←←←←o↓↓↓↓o→→9</code> (Pinakolboronat). Klick, Esc oder Wegbewegen der Maus beendet den Hotspot.
          </p>
          <table className="keys">
            <tbody>
              {HOVER_KEYS.map(([k, v]) => (
                <tr key={k}>
                  <td>
                    <kbd>{k}</kbd>
                  </td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Mechanismen zeichnen</h3>
          <ol className="tips">
            <li>Mit dem Ladungs-Werkzeug freie Elektronenpaare und Ladungen setzen.</li>
            <li>Mechanismuspfeil wählen (M) und vom Elektronenpaar oder der Bindung zum Ziel ziehen.</li>
            <li>Ziel ist ein Atom (neue Bindung) oder eine Bindung (Doppelbindung bilden).</li>
            <li>Krümmung am runden Griff anpassen; Endpunkte lassen sich neu andocken.</li>
          </ol>
          <h3>Beschriftungen</h3>
          <p className="muted small">
            Maus über ein Atom + Enter (bzw. Atom auswählen und zweimal Enter), dann die Beschriftung eintippen, z. B. <code>OMe</code>, <code>CO2H</code>, <code>Ph</code>,{' '}
            <code>NHBoc</code>, <code>R</code>. Bekannte Gruppen fließen korrekt in Summenformel und Masse ein und werden automatisch gespiegelt (MeO–).
          </p>
        </div>
      </div>
      <p className="muted small legal-note">OpenMol ist ein unabhängiges Projekt und steht in keiner Verbindung zu ChemDraw oder dessen Hersteller. ChemDraw ist eine Marke ihres Inhabers; Hinweise auf ChemDraw beschreiben nur die Kompatibilität (Dateiformat CDXML) und vertraute Tastenkürzel.</p>
      <footer>
        <button className="btn primary" onClick={close}>
          Verstanden
        </button>
      </footer>
    </Modal>
  )
}

export function useFitOnFirstLoad() {
  useEffect(() => {
    const d = getState().doc
    if (Object.keys(d.atoms).length) setTimeout(() => fitView(1.5), 50)
  }, [])
}
