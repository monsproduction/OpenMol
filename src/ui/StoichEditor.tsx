// Editor der Ansatztabelle: Leiste unter der Zeichenfläche, Zeile pro Stoff. Jede Mengenangabe hat ihre eigene
// Einheit (automatisch oder fest, z. B. mg ↔ g); Eingaben wie „105 mg“ oder „0,2 mL“ werden direkt verstanden.
// Berechnete Werte sind grau, eingegebene schwarz.
import { useMemo, useState } from 'react'
import {
  LIBRARY,
  STOICH_ROLES,
  UNITS,
  computeTable,
  fmtNum,
  parseNum,
  parseQty,
  pickUnit,
  rowFromName,
  rowMW,
  type QtyKind,
} from '../model/stoich'
import { casValid, hillFormula, parseStructure, oclToFragment } from '../model/ocl'
import type { StoichRole, StoichRow, StoichTable, StoichUnitKey } from '../model/types'
import { commit, setState, toast, useStore } from '../store'
import { useSettings } from '../settings'
import { Icon } from './Icons'
import { GHS_NAMES, GhsIcon } from '../render/Ghs'
import { fillSafety } from '../tools/safety'

/** Zahl > 0 aus einer Eingabe (sonst null) – für Äquivalente, Molmasse, Dichte */
const positive = (v: string): number | null => {
  const x = parseNum(v)
  return x !== null && x > 0 ? x : null
}

const T = {
  de: {
    title: 'Ansatztabelle',
    ref: 'Bezug',
    role: 'Rolle',
    name: 'Substanz',
    cas: 'CAS-Nr.',
    casFind: 'CAS & GHS suchen',
    mw: 'M',
    eq: 'Äq.',
    eqUnit: 'Äq.',
    n: 'n',
    m: 'm',
    V: 'V',
    rho: 'ρ',
    conc: 'c',
    obt: 'erhalten',
    yield: 'Ausbeute',
    add: 'Stoff hinzufügen: Name, Formel, SMILES oder Lösung (z. B. THF, K2CO3, NaHMDS 2 M in Hexan) …',
    temp: 'Temperatur',
    time: 'Zeit',
    atm: 'Atmosphäre',
    notes: 'Notizen',
    hint: 'Mengen mit Einheit eintippen (z. B. 105 mg, 0,2 mL, 1,5 mmol). Lösung: Konzentration bei c eintragen (z. B. 2) – das Volumen wird berechnet. Graue Werte sind berechnet. ★ = Bezug.',
    auto: 'automatisch',
    cref: 'Konzentration (Bezug)',
    theo: 'theor.',
  },
  en: {
    title: 'Stoichiometry table',
    ref: 'Ref.',
    role: 'Role',
    name: 'Compound',
    cas: 'CAS No.',
    casFind: 'Find CAS & GHS',
    mw: 'MW',
    eq: 'equiv.',
    eqUnit: 'equiv',
    n: 'n',
    m: 'm',
    V: 'V',
    rho: 'ρ',
    conc: 'c',
    obt: 'isolated',
    yield: 'Yield',
    add: 'Add compound: name, formula, SMILES or solution (e.g. THF, K2CO3, NaHMDS 2 M in hexane) …',
    temp: 'Temperature',
    time: 'Time',
    atm: 'Atmosphere',
    notes: 'Notes',
    hint: 'Type amounts with units (e.g. 105 mg, 0.2 mL, 1.5 mmol). Solution: enter the concentration under c (e.g. 2) – the volume is calculated. Grey values are calculated. ★ = reference.',
    auto: 'automatic',
    cref: 'Concentration (ref.)',
    theo: 'theor.',
  },
}

function updateTable(id: string, f: (t: StoichTable) => void) {
  commit((d) => {
    const t = d.tables[id]
    if (t) f(t)
  })
}

function updateRow(tid: string, rid: string, f: (r: StoichRow, t: StoichTable) => void) {
  updateTable(tid, (t) => {
    const r = t.rows.find((x) => x.id === rid)
    if (r) f(r, t)
  })
}

/** Eingabefeld, das bei Enter/Verlassen übernimmt (zeigt sonst den aktuellen Wert) */
function Cell({ value, onCommit, muted, placeholder, width, align = 'right', title }: { value: string; onCommit: (v: string) => void; muted?: boolean; placeholder?: string; width?: number; align?: 'left' | 'right'; title?: string }) {
  return (
    <input
      key={value}
      className={'st-in' + (muted ? ' calc' : '')}
      style={{ width, textAlign: align }}
      defaultValue={value}
      placeholder={placeholder}
      title={title}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          ;(e.target as HTMLInputElement).value = value
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      onBlur={(e) => {
        const el = e.target
        if (el.value === value) return
        onCommit(el.value)
        // abgelehnte Eingabe (Meldung): Feld zeigt wieder den gültigen Wert statt des nicht übernommenen Texts;
        // übernommene Eingaben erzeugen über key={value} ohnehin ein neues Feld
        window.setTimeout(() => {
          if (el.isConnected && document.activeElement !== el) el.value = value
        }, 0)
      }}
    />
  )
}

/** Einheiten-Auswahl einer Menge (auto = passend zur Größe) */
function UnitSel({ kind, value, chosen, auto, onChange }: { kind: QtyKind; value?: number; chosen?: string; auto: string; onChange: (u: string | undefined) => void }) {
  // ohne feste Wahl zeigt die Auswahl die automatisch passende Einheit; „automatisch“ hebt eine feste Wahl auf
  const shown = chosen ?? (value !== undefined ? pickUnit(kind, value)[0] : UNITS[kind][1][0])
  return (
    <select
      className={'st-unit' + (chosen ? ' fixed' : '')}
      value={shown}
      onChange={(e) => onChange(e.target.value === '__auto' ? undefined : e.target.value)}
      onKeyDown={(e) => e.stopPropagation()}
      title={chosen ? 'Einheit fest gewählt' : 'Einheit automatisch'}
    >
      {UNITS[kind].map(([u]) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
      <option value="__auto">{auto}</option>
    </select>
  )
}

/** feste Einheit hinter einem Wert (wie die Einheitenauswahl bei n, m, V) */
const Unit = ({ u }: { u: string }) => <span className="st-u">{u}</span>

export function StoichEditor() {
  useSettings()
  const id = useStore((s) => s.tableEditor)
  const doc = useStore((s) => s.doc)
  const t = id ? doc.tables?.[id] : undefined
  const [adding, setAdding] = useState('')
  const calc = useMemo(() => (t ? computeTable(doc, t) : null), [doc, t])
  if (!id || !t || !calc) return null
  const L = t.lang
  const S = T[L]
  const num = (v: number | undefined, d?: number) => (v === undefined || !Number.isFinite(v) ? '' : fmtNum(v, L, d))
  // Menge in der gewählten (oder automatischen) Einheit
  const qty = (kind: QtyKind, v: number | undefined, chosen?: string) => {
    if (v === undefined || !Number.isFinite(v)) return ''
    const [, f] = pickUnit(kind, v, chosen)
    return fmtNum(v / f, L)
  }
  const unitFor = (kind: QtyKind, v: number | undefined, chosen?: string) => (v !== undefined ? pickUnit(kind, v, chosen)[0] : (chosen ?? UNITS[kind][1][0]))

  const setAmount = (r: StoichRow, key: StoichUnitKey, kind: QtyKind, text: string, curV: number | undefined) => {
    const trimmed = text.trim()
    if (!trimmed) {
      updateRow(t.id, r.id, (rr) => {
        if (key === 'obt') rr.obtained = undefined
        else if (kind === 'm') rr.mass = undefined
        else if (kind === 'V') rr.volume = undefined
        else rr.moles = undefined
        if (rr.driver && rr.driver !== 'eq' && (rr.driver === (kind === 'm' ? 'mass' : kind === 'V' ? 'volume' : 'moles'))) rr.driver = rr.ref ? 'mass' : 'eq'
      })
      return
    }
    const p = parseQty(trimmed, kind, unitFor(kind, curV, r.units?.[key]))
    if (!p) return toast(L === 'de' ? 'Menge nicht verstanden – z. B. „105 mg“' : 'Amount not understood – e.g. “105 mg”', 'error')
    if (key === 'obt' && p.kind !== 'm') return toast(L === 'de' ? 'Erhaltene Menge bitte als Masse angeben – z. B. „97 mg“' : 'Please give the obtained amount as a mass – e.g. “97 mg”', 'error')
    updateRow(t.id, r.id, (rr) => {
      if (key === 'obt') {
        if (p.kind !== 'm') return
        rr.obtained = p.value
        return
      }
      if (p.kind === 'm') {
        rr.mass = p.value
        rr.driver = 'mass'
      } else if (p.kind === 'V') {
        rr.volume = p.value
        rr.driver = 'volume'
      } else {
        rr.moles = p.value
        rr.driver = 'moles'
      }
    })
  }

  // Bezug wechseln: alle Mengen bleiben, die Äquivalente werden auf den neuen Bezug umgerechnet
  const setRef = (rid: string) =>
    updateTable(t.id, (tt) => {
      const ni = tt.rows.findIndex((r) => r.id === rid)
      const nNew = calc.rows[ni]?.n
      tt.rows.forEach((r, i) => {
        const c = calc.rows[i]
        const was = r.ref
        r.ref = r.id === rid || undefined
        if (r.ref && !was) {
          if (c.m !== undefined) {
            r.mass = c.m
            r.driver = 'mass'
          }
        } else if (r.role === 'reactant' || r.role === 'reagent' || r.role === 'catalyst') {
          if (c.n !== undefined && nNew) {
            r.eq = c.n / nNew
            if (was || !r.driver || r.driver === 'eq') r.driver = 'eq'
          }
        } else if (r.role === 'product' && c.theoN !== undefined && nNew) r.eq = c.theoN / nNew
      })
    })

  const addRow = async (text: string) => {
    const v = text.trim()
    if (!v) return
    let row: StoichRow = rowFromName(v)
    // SMILES? → Formel/Molmasse aus der Struktur
    if (!row.formula && /[=#()\[\]]|^[A-Za-z0-9@+\-]{3,}$/.test(v) && !/\s/.test(v)) {
      try {
        const mol = parseStructure(v)
        const f = oclToFragment(mol, 40)
        if (f.atoms.length) {
          const mf = mol.getMolecularFormula()
          row = { ...row, formula: hillFormula(mf.formula), mw: mf.relativeWeight, name: undefined, smiles: v }
        }
      } catch {
        // kein SMILES – als Name behalten
      }
    }
    updateTable(t.id, (tt) => {
      const prod = tt.rows.findIndex((r) => r.role === 'product')
      if (row.role !== 'product' && prod >= 0) tt.rows.splice(prod, 0, row)
      else tt.rows.push(row)
    })
    setAdding('')
    // CAS-Nummer und GHS-Symbole gleich nachschlagen (online)
    void fillSafety(t.id, { quiet: true, auto: true })
  }

  // CAS-Nummern und GHS-Symbole über PubChem: eine Zeile (erneut) oder alle Zeilen
  const findCas = async (rows: StoichRow[]) => {
    if (rows.length === 1) {
      updateRow(t.id, rows[0].id, (rr) => (rr.safetyChecked = undefined))
      await fillSafety(t.id)
    } else await fillSafety(t.id, { force: true })
  }
  const ghsCell = (r: StoichRow) =>
    r.ghs?.length ? (
      <span className="st-ghs">
        {r.ghs.map((code) => (
          <svg key={code} width={24} height={24} viewBox="0 0 20 20" data-tip={`${GHS_NAMES[code] ?? code}${r.ghsSource ? ' · Quelle: ' + r.ghsSource + ' (laut PubChem)' : ''}`}>
            <GhsIcon code={code} x={0} y={0} size={20} />
          </svg>
        ))}
      </span>
    ) : (
      <span
        className="muted small"
        data-tip={
          r.safetyChecked
            ? r.ghsSource
              ? 'Laut PubChem keine GHS-Piktogramme'
              : 'Keine GHS-Angaben in PubChem gefunden'
            : r.role === 'product'
              ? 'Produkte werden nicht automatisch nachgeschlagen (oft neue Verbindungen) – bei Bedarf „CAS & GHS suchen“'
              : 'Noch nicht nachgeschlagen'
        }
      >
        –
      </span>
    )
  const casCell = (r: StoichRow) => (
    <span className="st-cas">
      <Cell
        value={r.cas ?? ''}
        placeholder="–"
        align="left"
        width={78}
        title={L === 'de' ? 'CAS-Nummer, z. B. 109-99-9 (wird auf die Prüfziffer kontrolliert)' : 'CAS number, e.g. 109-99-9 (check digit is verified)'}
        onCommit={(v) => {
          const x = v.trim()
          if (x && !casValid(x)) return toast(L === 'de' ? `„${x}“ ist keine gültige CAS-Nummer (Format oder Prüfziffer)` : `“${x}” is not a valid CAS number (format or check digit)`, 'error')
          updateRow(t.id, r.id, (rr) => (rr.cas = x || undefined))
        }}
      />
      {!r.cas && (
        <button className="icon-btn small" onClick={() => void findCas([r])} aria-label={S.casFind} data-tip={L === 'de' ? 'CAS-Nummer und GHS-Symbole in PubChem suchen' : 'Look up CAS number and GHS pictograms in PubChem'}>
          <Icon name="search" size={13} />
        </button>
      )}
    </span>
  )

  const roleLabel = (v: StoichRole) => STOICH_ROLES.find((x) => x.v === v)![L]

  const roleSelect = (r: StoichRow) => (
    <select className="st-role" data-tip={L === 'de' ? 'Rolle des Stoffs im Ansatz' : 'Role of the compound'} value={r.role} onChange={(e) => updateRow(t.id, r.id, (rr) => (rr.role = e.target.value as StoichRole))} onKeyDown={(e) => e.stopPropagation()}>
      {STOICH_ROLES.map((o) => (
        <option key={o.v} value={o.v}>
          {roleLabel(o.v)}
        </option>
      ))}
    </select>
  )
  const nameCell = (r: StoichRow, info: ReturnType<typeof rowMW>) => (
    <>
      <Cell value={r.name ?? ''} placeholder={info.formula || (L === 'de' ? 'Name' : 'name')} align="left" width={116} onCommit={(v) => updateRow(t.id, r.id, (rr) => (rr.name = v.trim() || undefined))} />
      {info.linked && (
        <span className="st-link" title={L === 'de' ? 'mit der Struktur im Schema verknüpft' : 'linked to the drawn structure'}>
          ⚭
        </span>
      )}
    </>
  )
  const mwCell = (r: StoichRow, info: ReturnType<typeof rowMW>, mw: number | undefined) =>
    info.linked ? (
      <span className="st-val calc" title={info.generic ? (L === 'de' ? 'Platzhalter – keine Molmasse' : 'placeholder – no MW') : info.formula}>
        {info.generic ? '–' : num(mw, 2)}
        {!info.generic && mw !== undefined && <Unit u="g/mol" />}
      </span>
    ) : (
      <>
        <Cell value={num(mw, 2)} width={64} onCommit={(v) => updateRow(t.id, r.id, (rr) => (rr.mw = positive(v) ?? (v.trim() ? rr.mw : undefined)))} />
        <Unit u="g/mol" />
      </>
    )
  const deleteBtn = (r: StoichRow) => (
    <button className="icon-btn small" onClick={() => updateTable(t.id, (tt) => (tt.rows = tt.rows.filter((x) => x.id !== r.id)))} aria-label="Zeile löschen" data-tip={L === 'de' ? 'Zeile entfernen' : 'Remove row'}>
      <Icon name="trash" size={14} />
    </button>
  )

  return (
    <div className="stoich-editor" onKeyDown={(e) => e.stopPropagation()}>
      <header>
        <b>{S.title}</b>
        <div className="seg small">
          {(['de', 'en'] as const).map((l) => (
            <button key={l} className={t.lang === l ? 'active' : ''} data-tip={l === 'de' ? 'Tabelle auf Deutsch' : 'Tabelle auf Englisch'} onClick={() => updateTable(t.id, (tt) => (tt.lang = l))}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        <button className="btn small" onClick={() => void findCas(t.rows)} data-tip={L === 'de' ? 'CAS-Nummern und GHS-Symbole aller Stoffe in PubChem suchen (online; vorhandene CAS-Nummern bleiben)' : 'Look up CAS numbers and GHS pictograms in PubChem (online)'}>
          <Icon name="search" size={13} /> {S.casFind}
        </button>
        <span className="muted small grow">{S.hint}</span>
        <button className="icon-btn" onClick={() => setState({ tableEditor: null })} aria-label="Schließen" data-tip="Editor schließen (Tabelle bleibt im Schema)">
          <Icon name="close" size={16} />
        </button>
      </header>
      <div className="st-scroll">
        <table className="st-grid">
          <thead>
            <tr>
              <th title={S.ref}>★</th>
              <th className="l">{S.role}</th>
              <th className="l">{S.name}</th>
              <th className="l">{S.cas}</th>
              <th className="l" data-tip="GHS-Gefahrenpiktogramme laut PubChem (bevorzugt EU-Einstufung) – bitte mit dem Sicherheitsdatenblatt prüfen">GHS</th>
              <th>{S.mw}</th>
              <th>{S.eq}</th>
              <th className="q">{S.n}</th>
              <th className="q">{S.m}</th>
              <th className="q">{S.V}</th>
              <th title={L === 'de' ? 'Dichte in g/mL' : 'density in g/mL'}>{S.rho}</th>
              <th title={L === 'de' ? 'Konzentration einer eingesetzten Lösung in mol/L (z. B. 2,5)' : 'concentration of a solution used, in mol/L (e.g. 2.5)'}>{S.conc}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r, i) => {
              if (r.role === 'product') return null
              const c = calc.rows[i]
              const info = rowMW(doc, r)
              const amountRole = r.role !== 'solvent'
              const isRef = i === calc.refIndex
              const isSolv = r.role === 'solvent'
              return (
                <tr key={r.id} className={isRef ? 'ref' : ''}>
                  <td className="c">
                    {amountRole && (
                      <input type="radio" name={'ref' + t.id} checked={isRef} onChange={() => setRef(r.id)} title={L === 'de' ? 'Bezug der Äquivalente (limitierend)' : 'Reference for equivalents (limiting)'} />
                    )}
                  </td>
                  <td className="l">{roleSelect(r)}</td>
                  <td className="l">{nameCell(r, info)}</td>
                  <td className="l">{casCell(r)}</td>
                  <td className="l">{ghsCell(r)}</td>
                  <td>{mwCell(r, info, c.mw)}</td>
                  <td>
                    {isRef ? (
                      <span className="st-val">
                        {num(1, 2)}
                        <Unit u={S.eqUnit} />
                      </span>
                    ) : isSolv ? null : (
                      <Cell
                        value={num(c.eq, 2)}
                        width={52}
                        muted={r.driver !== undefined && r.driver !== 'eq'}
                        onCommit={(v) =>
                          updateRow(t.id, r.id, (rr) => {
                            const x = parseNum(v)
                            // Äquivalente nur positiv (0 oder negativ ergäbe unsinnige Mengen)
                            if (x === null || x <= 0) return
                            rr.eq = x
                            rr.driver = 'eq'
                          })
                        }
                      />
                    )}
                    {!isRef && !isSolv && <Unit u={S.eqUnit} />}
                  </td>
                  {(['n', 'm', 'V'] as const).map((k) => {
                    const v = k === 'n' ? c.n : k === 'm' ? c.m : c.V
                    if (isSolv && k === 'n') return <td key={k} />
                    const drv = k === 'n' ? 'moles' : k === 'm' ? 'mass' : 'volume'
                    const entered = isSolv ? k === 'V' : r.driver === drv
                    const editable = !(isSolv && k !== 'V')
                    return (
                      <td key={k} className="qty">
                        {editable ? (
                          <Cell value={qty(k, v, r.units?.[k])} width={58} muted={!entered} onCommit={(txt) => setAmount(r, k, k, txt, v)} />
                        ) : (
                          <span className="st-val calc">{qty(k, v, r.units?.[k])}</span>
                        )}
                        <UnitSel kind={k} value={v} chosen={r.units?.[k]} auto={S.auto} onChange={(u) => updateRow(t.id, r.id, (rr) => (rr.units = { ...rr.units, [k]: u }))} />
                      </td>
                    )
                  })}
                  <td>
                    <Cell
                      value={num(r.density, 3)}
                      title={L === 'de' ? 'Dichte in g/mL (z. B. 0,89)' : 'density in g/mL (e.g. 0.89)'}
                      width={54}
                      onCommit={(v) =>
                        updateRow(t.id, r.id, (rr) => {
                          const m = /^\s*([\d.,]+)\s*(?:g\/mL|g\/ml|g\/cm3)?\s*$/.exec(v)
                          if (!v.trim()) rr.density = undefined
                          else if (m) rr.density = positive(m[1]) ?? rr.density
                        })
                      }
                    />
                    <Unit u="g/mL" />
                  </td>
                  <td className="st-rhoc">
                    {!isSolv && (
                      <Cell
                        value={num(r.conc, 2)}
                        title={
                          L === 'de'
                            ? 'Konzentration der eingesetzten Lösung in mol/L (z. B. 2,5): dann wird das benötigte Volumen der Lösung berechnet'
                            : 'concentration of the solution used, in mol/L (e.g. 2.5): the required volume of the solution is calculated'
                        }
                        width={54}
                        onCommit={(v) =>
                          updateRow(t.id, r.id, (rr) => {
                            const m = /^\s*([\d.,]+)\s*(?:M|mol\/L|mol\/l)?\s*$/.exec(v)
                            if (!v.trim()) {
                              rr.conc = undefined
                              rr.solvent = undefined
                            } else if (m) {
                              const x = parseNum(m[1])
                              if (x !== null && x > 0) rr.conc = x
                            }
                          })
                        }
                      />
                    )}
                    {!isSolv && <Unit u="mol/L" />}
                    {r.conc !== undefined && !isSolv && (
                      <>
                        <span className="st-in-label">in</span>
                        <input
                          key={r.solvent ?? ''}
                          className="st-in st-solv"
                          list="st-solvents"
                          defaultValue={r.solvent ?? ''}
                          placeholder={L === 'de' ? 'Lösungsmittel' : 'solvent'}
                          onKeyDown={(e) => {
                            e.stopPropagation()
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                          }}
                          onBlur={(e) => {
                            const v = e.target.value.trim() || undefined
                            if (v !== r.solvent) updateRow(t.id, r.id, (rr) => (rr.solvent = v))
                          }}
                        />
                      </>
                    )}
                  </td>
                  <td>{deleteBtn(r)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {t.rows.some((r) => r.role === 'product') && (
          <table className="st-grid st-products">
            <thead>
              <tr>
                <th />
                <th className="l">{S.role}</th>
                <th className="l">{S.name}</th>
                <th className="l">{S.cas}</th>
                <th className="l">GHS</th>
                <th>{S.mw}</th>
                <th title={L === 'de' ? 'stöchiometrischer Faktor (Standard 1)' : 'stoichiometric factor (default 1)'}>{S.eq}</th>
                <th className="q">
                  {S.n} ({S.theo})
                </th>
                <th className="q">
                  {S.m} ({S.theo})
                </th>
                <th className="q">{S.obt}</th>
                <th>{S.yield}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r, i) => {
                if (r.role !== 'product') return null
                const c = calc.rows[i]
                const info = rowMW(doc, r)
                return (
                  <tr key={r.id}>
                    <td />
                    <td className="l">{roleSelect(r)}</td>
                    <td className="l">{nameCell(r, info)}</td>
                    <td className="l">{casCell(r)}</td>
                    <td className="l">{ghsCell(r)}</td>
                    <td>{mwCell(r, info, c.mw)}</td>
                    <td>
                      <Cell value={num(c.eq, 2)} width={52} onCommit={(v) => updateRow(t.id, r.id, (rr) => (rr.eq = positive(v) ?? (v.trim() ? rr.eq : undefined)))} />
                      <Unit u={S.eqUnit} />
                    </td>
                    <td className="qty">
                      <span className="st-val calc">{qty('n', c.theoN, r.units?.n)}</span>
                      <UnitSel kind="n" value={c.theoN} chosen={r.units?.n} auto={S.auto} onChange={(u) => updateRow(t.id, r.id, (rr) => (rr.units = { ...rr.units, n: u }))} />
                    </td>
                    <td className="qty">
                      <span className="st-val calc">{qty('m', c.theoM, r.units?.m)}</span>
                      <UnitSel kind="m" value={c.theoM} chosen={r.units?.m} auto={S.auto} onChange={(u) => updateRow(t.id, r.id, (rr) => (rr.units = { ...rr.units, m: u }))} />
                    </td>
                    <td className="qty">
                      <Cell value={qty('m', r.obtained, r.units?.obt)} width={58} onCommit={(txt) => setAmount(r, 'obt', 'm', txt, r.obtained)} />
                      <UnitSel kind="m" value={r.obtained} chosen={r.units?.obt} auto={S.auto} onChange={(u) => updateRow(t.id, r.id, (rr) => (rr.units = { ...rr.units, obt: u }))} />
                    </td>
                    <td>
                      <span className={'st-val strong' + (c.yieldPct !== undefined && c.yieldPct > 100 ? ' warn' : '')} title={c.yieldPct !== undefined && c.yieldPct > 100 ? (L === 'de' ? 'über 100 % – Einheiten prüfen' : 'above 100 % – check units') : undefined}>
                        {c.yieldPct !== undefined ? num(c.yieldPct, 1) + ' %' : ''}
                      </span>
                    </td>
                    <td>{deleteBtn(r)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <div className="st-add">
          <input
            list="st-lib"
            value={adding}
            placeholder={S.add}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') void addRow(adding)
            }}
          />
          <datalist id="st-solvents">
            {LIBRARY.filter((e) => e.solvent).map((e) => (
              <option key={e.names[0]} value={e.names[0]} />
            ))}
          </datalist>
          <datalist id="st-lib">
            {LIBRARY.map((e) => (
              <option key={e.names[0]} value={e.names[0]} />
            ))}
          </datalist>
          <button className="btn small" onClick={() => void addRow(adding)} disabled={!adding.trim()} data-tip={L === 'de' ? 'Stoff zur Tabelle hinzufügen' : 'Add compound to the table'}>
            +
          </button>
        </div>
        <div className="st-cond">
          <label>
            {S.temp}
            <Cell value={t.temperature ?? ''} align="left" width={90} placeholder="80 °C" onCommit={(v) => updateTable(t.id, (tt) => (tt.temperature = v.trim() || undefined))} />
          </label>
          <label>
            {S.time}
            <Cell value={t.time ?? ''} align="left" width={70} placeholder="16 h" onCommit={(v) => updateTable(t.id, (tt) => (tt.time = v.trim() || undefined))} />
          </label>
          <label>
            {S.atm}
            <Cell value={t.atmosphere ?? ''} align="left" width={60} placeholder="N2" onCommit={(v) => updateTable(t.id, (tt) => (tt.atmosphere = v.trim() || undefined))} />
          </label>
          <label className="grow">
            {S.notes}
            <Cell value={t.notes ?? ''} align="left" placeholder="" onCommit={(v) => updateTable(t.id, (tt) => (tt.notes = v.trim() || undefined))} />
          </label>
          {calc.cRef !== undefined && (
            <span className="muted small">
              {S.cref}: <b>{num(calc.cRef, 3)} mol/L</b>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
