// „Über OpenMol“ (App-Menü bzw. Hilfe-Fenster): Kontakt, Impressum, Datenschutz, Lizenzen der verwendeten Bausteine und
// Haftungshinweis. Persönliche Angaben in src/legal/config.ts.
import { useEffect, useState } from 'react'
import { desktop } from '../desktop'
import { LEGAL } from '../legal/config'
import { disclaimer, impressum, privacy, type LegalSection } from '../legal/texts'
import { useSettings } from '../settings'
import { setState } from '../store'
import { Modal } from './Dialogs'

type View = 'main' | 'impressum' | 'privacy' | 'licenses' | 'disclaimer'

interface ThirdParty {
  name: string
  version: string
  license: string
  parts: string[]
  text: string | null
}

const open = (url: string) => {
  if (desktop) void desktop.openExternal(url)
  else window.open(url, '_blank', 'noopener')
}

function Sections({ list }: { list: LegalSection[] }) {
  return (
    <div className="legal-text">
      {list.map((s, i) => (
        <section key={i}>
          {s.h && <h4>{s.h}</h4>}
          {s.p.map((p, k) => (
            <p key={k}>{p.split(/(⟦[^⟧]*⟧)/).map((part, j) => (part.startsWith('⟦') ? <mark key={j}>{part}</mark> : part))}</p>
          ))}
        </section>
      ))}
    </div>
  )
}

function Licenses({ lang }: { lang: 'de' | 'en' }) {
  const [list, setList] = useState<ThirdParty[] | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  useEffect(() => {
    // groß (Lizenztexte) – erst beim Öffnen laden
    void import('../legal/thirdParty.json').then((m) => setList(m.default as ThirdParty[]))
  }, [])
  const part = (p: string) => ({ app: lang === 'de' ? 'Oberfläche' : 'app', desktop: 'Desktop', mcp: lang === 'de' ? 'KI-Server' : 'AI server' })[p] ?? p
  return (
    <div className="legal-text">
      <p>
        {lang === 'de'
          ? 'OpenMol nutzt die folgenden Bausteine anderer Entwickler. Wir danken ihnen! Ein Klick zeigt den Lizenztext.'
          : 'OpenMol uses the following components by other developers. Thank you! Click one to see its license text.'}
      </p>
      {desktop && (
        <p>
          {lang === 'de' ? 'Die Desktop-App enthält außerdem Electron mit Chromium und Node.js; deren Lizenzen: ' : 'The desktop app also contains Electron with Chromium and Node.js; their licenses: '}
          <button className="link-btn" onClick={() => void desktop?.openLicenses()}>
            LICENSES.chromium.html
          </button>
        </p>
      )}
      {!list && <p className="muted">…</p>}
      <ul className="licenses">
        {list?.map((e) => {
          const key = e.name + '@' + e.version
          return (
            <li key={key}>
              <button className="link-btn" onClick={() => setOpenKey(openKey === key ? null : key)}>
                {e.name} {e.version}
              </button>{' '}
              <span className="muted small">
                {e.license} · {e.parts.map(part).join(', ')}
              </span>
              {openKey === key && <pre className="license-text">{e.text ?? (lang === 'de' ? `Lizenz: ${e.license} (das Paket enthält keinen Lizenztext)` : `License: ${e.license} (the package contains no license text)`)}</pre>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function AboutDialog() {
  const lang = useSettings().uiLang
  const [view, setView] = useState<View>('main')
  const de = lang === 'de'
  const close = () => setState({ dialog: null })
  const titles: Record<View, string> = {
    main: 'Über OpenMol',
    impressum: 'Impressum',
    privacy: 'Datenschutzerklärung',
    licenses: 'Lizenzen',
    disclaimer: 'Haftungshinweis',
  }
  const version = desktop ? desktop.appVersion() : __APP_VERSION__
  return (
    <Modal title={titles[view]} onClose={close} wide={view !== 'main'}>
      {view === 'main' ? (
        <div className="about">
          <p className="about-title">OpenMol</p>
          <p className="about-contact">
            {de ? 'Feedback, Fehler, Ideen? Schreib mir: ' : 'Feedback, bugs, ideas? Write to me: '}
            <button className="link-btn" onClick={() => open('mailto:' + LEGAL.email)}>
              {LEGAL.email}
            </button>
          </p>
          <nav className="about-links">
            <button className="link-btn" onClick={() => setView('impressum')}>
              Impressum
            </button>
            <button className="link-btn" onClick={() => setView('privacy')}>
              Datenschutzerklärung
            </button>
            <button className="link-btn" onClick={() => setView('licenses')}>
              Lizenzen
            </button>
            <button className="link-btn" onClick={() => setView('disclaimer')}>
              Haftungshinweis
            </button>
          </nav>
          <p className="muted small about-version">
            OpenMol {version} · {de ? 'OpenMol ist ein unabhängiges Projekt und steht in keiner Verbindung zu ChemDraw oder dessen Hersteller.' : 'OpenMol is an independent project and is not affiliated with ChemDraw or its maker.'}
          </p>
        </div>
      ) : (
        <div className="about-sub">
          <button className="btn small about-back" onClick={() => setView('main')}>
            ← Zurück
          </button>
          {view === 'impressum' && <Sections list={impressum(lang)} />}
          {view === 'privacy' && <Sections list={privacy(lang)} />}
          {view === 'disclaimer' && <Sections list={disclaimer(lang)} />}
          {view === 'licenses' && <Licenses lang={lang} />}
        </div>
      )}
    </Modal>
  )
}
