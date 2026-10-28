// Impressum, Datenschutzerklärung und Haftungshinweis (Deutsch/Englisch) für „Über OpenMol“. Vorlage nach dem, was
// OpenMol tatsächlich tut (Online-Dienste siehe unten) – keine Rechtsberatung; vor dem Veröffentlichen prüfen lassen.
// Persönliche Angaben kommen aus config.ts (leer = Platzhalter ⟦…⟧).
import { LEGAL, fill } from './config'

export interface LegalSection {
  h?: string
  p: string[]
}

type Lang = 'de' | 'en'

const L = LEGAL
const addr = (lang: Lang) => [
  fill(L.name, lang === 'de' ? 'Vor- und Nachname' : 'Full name'),
  fill(L.street, lang === 'de' ? 'Straße und Hausnummer bzw. c/o-Anschrift' : 'Street address or c/o address'),
  fill(L.city, lang === 'de' ? 'PLZ und Ort' : 'Postcode and city'),
  L.country,
]

export function impressum(lang: Lang): LegalSection[] {
  if (lang === 'en')
    return [
      { h: 'Information pursuant to § 5 DDG (German Digital Services Act)', p: addr('en') },
      { h: 'Contact', p: [`Email: ${L.email}`, ...(L.phone ? [`Phone: ${L.phone}`] : [])] },
      {
        h: 'Consumer dispute resolution',
        p: ['We are neither willing nor obliged to take part in dispute resolution proceedings before a consumer arbitration board.'],
      },
    ]
  return [
    { h: 'Angaben gemäß § 5 DDG', p: addr('de') },
    { h: 'Kontakt', p: [`E-Mail: ${L.email}`, ...(L.phone ? [`Telefon: ${L.phone}`] : [])] },
    {
      h: 'Verbraucherstreitbeilegung',
      p: ['Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.'],
    },
  ]
}

export function privacy(lang: Lang): LegalSection[] {
  const who = addr(lang).join(', ') + ' · ' + L.email
  if (lang === 'en')
    return [
      { h: '1. Controller', p: [who] },
      {
        h: '2. In short',
        p: [
          'OpenMol runs on your device. Drawings, settings, your template collections and automatic backups stay on your computer (desktop app: settings folder; browser version: the browser’s storage). There is no account, no tracking and no analytics.',
          'Data only leaves your device when you use one of the online functions below. The request then goes directly from your device to the respective service; the service necessarily also receives your IP address.',
        ],
      },
      {
        h: '3. Online functions',
        p: [
          'PubChem (National Center for Biotechnology Information, U.S. National Library of Medicine, USA): for “Name/CAS → structure”, “Structure → name”, CAS numbers and GHS pictograms, molar mass and density in the stoichiometry table. Transmitted: the name or CAS number, or the structure as SMILES. For new stoichiometry tables this happens automatically for starting materials and reagents (not for products); it can be switched off in the settings.',
          'Wikidata and Wikipedia (Wikimedia Foundation, USA): only when you open the Wikipedia article for a structure. Transmitted: an identifier of the structure (PubChem CID/InChIKey); to find it, OpenMol first asks PubChem with the structure (SMILES).',
          'Update check (desktop app): once a day a request to GitHub (GitHub, Inc., USA) asks whether a new version exists; updates are downloaded from GitHub. Can be switched off in the settings.',
          'Word add-in: runs inside Microsoft Word, which loads Microsoft’s Office library for it. The connection between Word and OpenMol stays on your computer (localhost).',
          'AI control (MCP): runs locally. What the connected AI application does with the drawing is governed by its provider.',
          'Support button and email: the link opens PayPal in your browser or your email program; their privacy policies apply. OpenMol itself transmits nothing.',
          'Legal basis: Art. 6(1)(b) and (f) GDPR – you request the function, and we have a legitimate interest in offering it.',
        ],
      },
      {
        h: '4. Web version',
        p: [
          L.webHoster
            ? `If you use OpenMol in the browser, it is delivered by ${L.webHoster}. The host processes technically necessary access data (e.g. IP address, time, browser) in server log files.`
            : 'If OpenMol is offered as a web page, the host and its server log files will be named here.',
        ],
      },
      { h: '5. Contact by email', p: ['If you write to us, we use your email only to answer it and delete it when it is no longer needed.'] },
      {
        h: '6. Your rights',
        p: [
          'You have the right to access, rectification, erasure, restriction of processing, data portability and to object, as well as the right to lodge a complaint with a data protection supervisory authority.',
          `As of ${L.updated}.`,
        ],
      },
    ]
  return [
    { h: '1. Verantwortlicher', p: [who] },
    {
      h: '2. Kurz gesagt',
      p: [
        'OpenMol läuft auf deinem Gerät. Zeichnungen, Einstellungen, eigene Sammlungen und automatische Sicherungen bleiben auf deinem Rechner (Desktop-App: Einstellungsordner; Browser-Version: Speicher des Browsers). Es gibt kein Konto, kein Tracking und keine Analyse-Dienste.',
        'Daten verlassen dein Gerät nur, wenn du eine der Online-Funktionen unten nutzt. Die Anfrage geht dann direkt von deinem Gerät an den jeweiligen Dienst; dieser erhält dabei technisch bedingt auch deine IP-Adresse.',
      ],
    },
    {
      h: '3. Online-Funktionen',
      p: [
        'PubChem (National Center for Biotechnology Information, U.S. National Library of Medicine, USA): bei „Name/CAS → Struktur“, „Struktur → Name“, CAS-Nummern und GHS-Symbolen, Molmasse und Dichte in der Ansatztabelle. Übertragen wird der Name bzw. die CAS-Nummer oder die Struktur als SMILES. Bei neuen Ansatztabellen geschieht das automatisch für Edukte und Reagenzien (nicht für Produkte); das lässt sich in den Einstellungen abschalten.',
        'Wikidata und Wikipedia (Wikimedia Foundation, USA): nur, wenn du den Wikipedia-Artikel zu einer Struktur öffnest. Übertragen wird eine Kennung der Struktur (PubChem-CID/InChIKey); um sie zu finden, fragt OpenMol zuvor PubChem mit der Struktur (SMILES).',
        'Update-Prüfung (Desktop-App): einmal täglich fragt OpenMol bei GitHub (GitHub, Inc., USA) nach einer neuen Version; Updates werden von GitHub geladen. Abschaltbar in den Einstellungen.',
        'Word-Add-in: läuft in Microsoft Word, das dafür die Office-Bibliothek von Microsoft lädt. Die Verbindung zwischen Word und OpenMol bleibt auf deinem Rechner (localhost).',
        'KI-Steuerung (MCP): läuft lokal. Was die verbundene KI-Anwendung mit der Zeichnung macht, regelt deren Anbieter.',
        'Unterstützen-Knopf und E-Mail: Der Link öffnet PayPal in deinem Browser bzw. dein E-Mail-Programm; es gelten deren Datenschutzbestimmungen. OpenMol selbst überträgt dabei nichts.',
        'Rechtsgrundlage: Art. 6 Abs. 1 lit. b und f DSGVO – du forderst die Funktion an, und wir haben ein berechtigtes Interesse, sie anzubieten.',
      ],
    },
    {
      h: '4. Web-Version',
      p: [
        L.webHoster
          ? `Nutzt du OpenMol im Browser, wird es von ${L.webHoster} ausgeliefert. Der Hoster verarbeitet dabei technisch notwendige Zugriffsdaten (z. B. IP-Adresse, Zeitpunkt, Browser) in Server-Logdateien.`
          : 'Wird OpenMol als Webseite angeboten, stehen hier der Hoster und seine Server-Logdateien.',
      ],
    },
    { h: '5. Kontakt per E-Mail', p: ['Schreibst du uns, nutzen wir deine E-Mail nur zur Beantwortung und löschen sie, wenn sie nicht mehr gebraucht wird.'] },
    {
      h: '6. Deine Rechte',
      p: [
        'Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch sowie das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren.',
        `Stand: ${L.updated}.`,
      ],
    },
  ]
}

export function disclaimer(lang: Lang): LegalSection[] {
  if (lang === 'en')
    return [
      {
        h: 'No warranty',
        p: [
          'OpenMol is provided free of charge and without warranty. Calculations (molar masses, amounts, concentrations, isotope patterns), names, CAS numbers, densities and GHS information (from PubChem) as well as the automatic atom numbering (simplified IUPAC rules) may be wrong or incomplete. Always check them before use – in particular against the safety data sheets.',
          'Liability for intent and gross negligence remains unaffected.',
        ],
      },
      { h: 'External links', p: ['We are not responsible for the content of linked external pages (e.g. PubChem, Wikipedia, PayPal).'] },
      {
        h: 'Trademarks',
        p: [
          'OpenMol is an independent project and is not affiliated with ChemDraw or its maker. ChemDraw is a trademark of its owner; references to ChemDraw only describe compatibility (CDXML file format) and familiar keyboard shortcuts. Microsoft, Word and PowerPoint are trademarks of Microsoft Corporation.',
        ],
      },
    ]
  return [
    {
      h: 'Ohne Gewähr',
      p: [
        'OpenMol wird kostenlos und ohne Gewähr bereitgestellt. Berechnungen (Molmassen, Mengen, Konzentrationen, Isotopenmuster), Namen, CAS-Nummern, Dichten und GHS-Angaben (aus PubChem) sowie die automatische Atomnummerierung (vereinfachte IUPAC-Regeln) können fehlerhaft oder unvollständig sein. Bitte vor jeder Verwendung prüfen – insbesondere mit den Sicherheitsdatenblättern.',
        'Die Haftung für Vorsatz und grobe Fahrlässigkeit bleibt unberührt.',
      ],
    },
    { h: 'Externe Links', p: ['Für die Inhalte verlinkter fremder Seiten (z. B. PubChem, Wikipedia, PayPal) sind deren Betreiber verantwortlich.'] },
    {
      h: 'Marken',
      p: [
        'OpenMol ist ein unabhängiges Projekt und steht in keiner Verbindung zu ChemDraw oder dessen Hersteller. ChemDraw ist eine Marke ihres Inhabers; Hinweise auf ChemDraw beschreiben nur die Kompatibilität (Dateiformat CDXML) und vertraute Tastenkürzel. Microsoft, Word und PowerPoint sind Marken der Microsoft Corporation.',
      ],
    },
  ]
}
