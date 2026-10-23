# OpenMol

Web- und Desktop-App (Mac) zum Zeichnen von Molekülen, Reaktionen und Reaktionsmechanismen – inspiriert vom
Funktionsumfang klassischer Chemie-Zeichenprogramme, aber mit aufgeräumter, moderner Oberfläche.

## Starten

- **Einfach:** `Starten.command` im Finder doppelklicken (beim ersten Mal werden die Pakete installiert).
- **Terminal:** `npm install` und danach `npm run dev`, dann http://localhost:5173 öffnen.
- **Fertige Version bauen:** `npm run build` → statische Dateien in `dist/` (auf jedem Webserver lauffähig).

## Desktop-App (Mac)

Windows: siehe [WINDOWS.md](WINDOWS.md) (Installer vorbereitet, auf Windows noch nicht getestet).

- **Installieren:** `release/OpenMol-<Version>-arm64.dmg` öffnen und OpenMol in „Programme“ ziehen (Kopien der
  Versionen liegen in `Versionen/`). Die App ist nicht von Apple beglaubigt: beim ersten Start im Finder
  **Rechtsklick → Öffnen** wählen (danach normal per Doppelklick).
- **Entwickeln:** `npm run app` startet die Desktop-App mit Live-Neuladen (Vite + Electron).
- **Bauen:** `npm run app:build` → `release/OpenMol-<Version>-arm64.dmg` (Apple Silicon). Icon neu erzeugen nach
  Änderungen an `build/icon.svg`: `npm run icons`.
- **Updates:** Die App fragt beim Start (höchstens einmal am Tag, abschaltbar in den Einstellungen) bei den
  GitHub-Releases nach einer neuen Version und zeigt die Neuerungen. Windows: herunterladen und installieren per Klick
  (electron-updater). Mac: Die neue DMG wird nach „Downloads“ geladen, geprüft und geöffnet – OpenMol dann in
  „Programme“ ziehen („Ersetzen“). Vollautomatisch ginge es auf dem Mac nur mit Apple-Entwicklerzertifikat.
  Menü „Nach Updates suchen …“ bzw. Einstellungen → „Jetzt nach Updates suchen“.
- **Neue Version veröffentlichen:**
  1. In `package.json` die `version` erhöhen (z. B. 1.2.0 → 1.3.0) – nur höhere Nummern gelten als Update.
  2. `GH_TOKEN=$(gh auth token) npm run app:release` – baut Mac- und Windows-Installer, **prüft beide**
     (`electron/check-package.mjs`: alle Dateien des Hauptprozesses, Oberfläche, KI-Server, Update-Info im Paket) und
     lädt sie erst dann samt `latest.yml`/`latest-mac.yml` als **Entwurf** in das Release `v<Version>` auf GitHub.
     Vorher die fertige Mac-App einmal selbst starten (`release/mac-arm64/OpenMol.app`).
  3. Auf GitHub beim Entwurf die Notizen („Neuerungen“ – erscheinen in der Update-Meldung) ergänzen und
     **„Publish release“** drücken. Erst dann sehen die Apps das Update.
- **Dateien:** Öffnen (⌘O), Speichern (⌘S – beim ersten Mal mit Dialog, danach direkt in dieselbe Datei),
  Speichern unter (⇧⌘S), Exportieren (⌘E bzw. Menü Ablage ▸ Exportieren: PNG, SVG, Molfile, CDXML) – jeweils mit den
  Dialogen des Systems. Dokumente heißen `.openmol` (ältere `.chemdoc.json` öffnen weiterhin); Doppelklick im Finder,
  Ablegen auf das Dock-Symbol, „Zuletzt geöffnet“ und Ziehen einer Datei ins Fenster öffnen sie direkt. Beim Schließen
  mit ungesicherten Änderungen fragt die App nach.
- **Einstellungen und Daten** liegen als lesbare JSON-Dateien in `~/Library/Application Support/OpenMol/`
  (`settings.json`: Sprache, Dezimaltrennzeichen, Design, Reihenfolge im Inspektor, Ringfüllungs-Leiste …;
  `library.json`: eigene Vorlagen; `autosave.json`: zuletzt bearbeitete Zeichnung). Menü Hilfe ▸ „Einstellungsordner
  zeigen“.
- **Menüleiste:** Ablage, Bearbeiten, Struktur (⇧⌘K Struktur aufräumen, ⇧⌘X Reaktion aufräumen, ⇧⌘D 2D ↔ 3D,
  Kürzel, Name/CAS → Struktur, Analyse), Darstellung, Fenster, Hilfe – auf Deutsch oder Englisch je nach Sprache der
  Oberfläche.
- **KI-Steuerung (MCP):** Der MCP-Server ist in der App enthalten (ab 1.1.0) – kein Projektordner und kein Node.js
  nötig. Einstellungen → „KI-Anwendung verbinden“ → **„Prompt für die KI kopieren“** (bzw. Konfiguration oder Befehl
  für Claude Code); die Texte enthalten die Pfade des eigenen Rechners. OpenMol führt den Server selbst aus
  (`ELECTRON_RUN_AS_NODE=1`). Beim Bauen wird er mit `npm run mcp:bundle` zu einer Datei gebündelt
  (`mcp/bundle/server.mjs`). Nach einem Update von OpenMol die KI-Anwendung einmal neu starten.
- Sicherheit: Die Oberfläche hat keinen Zugriff auf das Dateisystem, sie liest/schreibt nur Dateien, die im Dialog
  gewählt wurden; Netzzugriff nur zu PubChem, Wikidata und dem lokalen MCP-Server; Links öffnen im Standardbrowser.
- Aufbau: `electron/main.mjs` (Fenster, Protokoll `app://openmol/`, Dialoge), `menu.mjs`, `store.mjs`
  (Einstellungsdateien), `preload.cjs` (Brücke `window.openmol`); in der Oberfläche `src/desktop.ts`,
  `src/desktopApp.ts`.

## Funktionen

**Zeichnen**
- Bindungen: einfach, doppelt, dreifach, Keil, schraffiert, Wellenlinie, fett, gestrichelt, delokalisiert
- Dreifachbindungen immer linear (180°): beim Zeichnen, Anbauen und Umwandeln wird der kleinere Molekülteil gestreckt
  (in Ringen wie Cyclooctin bleibt die Geometrie)
- Zickzack-Ketten mit Bindungszähler, Ringe (3–8, Benzol) frei, an Atomen (spiro) und an Bindungen (ankondensiert)
- Atome per Tastatur: Maus über Atom halten (oder Atome markieren) und `N`, `O`, `S`, `l` (Cl), `b` (Br) … tippen;
  `C` auf einem C-Atom blendet nur dessen Beschriftung ein (z. B. CH₂) bzw. wieder aus – andere C-Atome bleiben unsichtbar
- Beschriftungen und Abkürzungen (`OMe`, `CO2H`, `Ph`, `NHBoc`, `OTBS`, `R` …), automatisch gespiegelt (MeO–);
  kondensierte Formeln (`CH2OH`, `iPr2N`, `N(iPr)2`, `CMe2OH`) werden erkannt und je nach Bindungsseite gespiegelt
  (`HOH2C–`, `–NiPr2`); Summenformel versteht auch Ladungen (`NH3+`, `CO2−` → ⁻O2C–), Oxo-Gruppen (`SO2NH2`,
  `CONHMe`), Ketten (`C2H5`), Isotope (`D`, `CD3`) und Arylkürzel (`C6H5`, `p-Tol`, `Mes`)
- „Kürzel bilden“: ausgeschriebene Gruppen (OMe, OTf, Bpin, CO2Me, OAc, TBS, CF3, tBu …) per Klick als Beschriftung
- Alkyl-Präfixe hochgestellt und kursiv: ᵗBu, ⁱPr, ⁿBu, ˢBu, ⁱBu, auch in Kombinationen (ᵗBuO, ⁱPr₂N);
  mit Bindestrich kursiv auf der Grundlinie (*sec*-Bu, *tert*-Bu, *n*-BuLi)
- Stereozentren markieren (Taste `*` über dem Atom bzw. Eigenschaften-Panel); Konfiguration (R/S) wird nach CIP
  automatisch bestimmt und auf Wunsch angezeigt – je Atom oder für alle Stereozentren (Dokument-Stil)
- Struktur bereinigen und Import ohne übereinanderliegende Molekülteile – Bindungswinkel haben Vorrang:
  Substituenten stehen in idealer 120°-Richtung (symmetrisch zu ihrer Bindung, Nitrile gestreckt); Platz entsteht
  durch Verlängern der verbindenden Bindung (gleichwertige Substituenten gleich weit), Drehen nur als letzter Ausweg
  (z. B. 4CzIPN, ortho-ständige Carbazole)
- Implizite Wasserstoffe (OH, NH2) mit sinnvoller Platzierung, Valenzfehler-Markierung
- Periodensystem, Vorlagen-Bibliothek (Ringe, Heterocyclen, Aminosäuren, Nukleobasen, Wirkstoffe, Sessel)
- Eigene Vorlagen: Struktur markieren → „Zur Bibliothek hinzufügen“ (eigener Name, eigene Sammlungen);
  Sammlungen anlegen, umbenennen, löschen (mitgelieferte ausblendbar und wiederherstellbar), als Datei exportieren
  und importieren; gespeichert im Browser
- Nachschlagen: markiertes Molekül direkt in PubChem bzw. der englischen Wikipedia öffnen (Meldung, falls es
  keinen Eintrag gibt; Wikipedia-Zuordnung über Wikidata, online)

**Reaktionen & Mechanismen**
- Reaktionspfeile: Reaktion, Gleichgewicht, Mesomerie, Retrosynthese, gestrichelt, „keine Reaktion“
- Reaktionsbedingungen über/unter dem Pfeil; Text bleibt unformatiert, Button „Summenformel“ formatiert markierte
  Teile chemisch (H2SO4 → H₂SO₄, Ladungen hochgestellt) – wie in ChemDraw
- Elektronenfluss-Pfeile (2 e⁻ und Fischhaken 1 e⁻), die an Atomen, Bindungen und freien Elektronenpaaren andocken
  und beim Verschieben mitwandern; Krümmung per Griff einstellbar
- Ladungen (⊕/⊖ oder +/−), Partialladungen δ+/δ−, freie Elektronenpaare, Radikale
- Klammern (eckig, rund, geschweift) mit Index oben (‡, 2−) und unten (n, n − 3), Rechtecke (auch mit runden
  Ecken), Ellipsen, 3D-schattierte Kugeln, Plus-Zeichen, Text; Flächen und Kugeln mit Farbe oder Farbverlauf
  (linear/radial), optional Schlagschatten und ohne Rahmen
- Polymere: „Polymerklammern“ um die markierte Wiederholungseinheit (Endstummel = C-Enden an einem C werden
  geschnitten, schräge Einheiten waagerecht gedreht, Klammern nur um die Hauptkette, wenn Seitengruppen hinausragen);
  „Zyklisch“: zyklische Wiederholungseinheit mit Ring, der die beiden Stummel verbindet (z. B. Pillar[5]aren), Analyse n × Einheit;
  Analyse als (C…H…)ₙ mit Masse pro Einheit, Endgruppen und Gesamtmasse (Zahl an der Klammer, n oder Mn eingeben)
- Ausbeute am Reaktionspfeil (Eigenschaften-Panel, z. B. „86“ → **86%**): unter den Bedingungen, bei senkrechten
  Pfeilen rechts darunter

**Bearbeiten**
- Auswahl per Rechteck/Lasso, Verschieben (deckungsgleiche Atome verschmelzen), Alt+Ziehen dupliziert
- Magnetische Hilfslinien: beim Ziehen rasten Moleküle auf gleicher Höhe (Mitte) bzw. an Kanten anderer Objekte und
  Pfeillinien ein; ⌘/Strg gedrückt halten schaltet kurz ab, Magnet-Knopf in der Auswahl-Leiste dauerhaft
- Bindung anfassen zieht das ganze Molekül, Atom anfassen nur das Atom; Doppelklick auf Atom/Bindung markiert das ganze Molekül
- Pfeil-Magnet: Pfeilspitzen/-anfänge rasten an anderen Pfeilenden und Molekülmitten ein (Ziehen, Verschieben, Zeichnen)
- Ladungen und Partialladungen frei verschiebbar (Alt+Klick = automatische Position)
- Bindungen dürfen beliebig lang gezogen werden (über einem entfernten Atom loslassen = verbinden)
- Drehen (Griff, 15°-Raster mit Umschalt, oder Gradzahl eingeben, z. B. −30° = gegen den Uhrzeigersinn), Spiegeln, Ausrichten, Struktur bereinigen (2D-Layout neu berechnen)
- Anordnung für alle Objekte: in den Vordergrund/Hintergrund, eine Ebene vor/zurück (⇧⌘F/⇧⌘B, mit ⌥ eine
  Ebene; Knöpfe oben im Eigenschaften-Panel). Moleküle gelten als ein Objekt (inkl. Ringfüllungen)
- Werkzeugleiste passt sich der Fensterhöhe an – alle Werkzeuge immer sichtbar, ohne Scrollen
- „Fett“ für alle Objekte (⌘B bzw. „F“ im Panel): Texte/Zeichen fett, Linien (Klammern, Pfeile, Formen, Zyklen,
  Ladungskreise) so dick wie ein fetter Buchstabe, Elektronenpunkte größer
- Freie Elektronenpaare und Radikale frei verschiebbar wie Ladungen (einzeln; Alt+Klick = automatische Position)
- Atom-Beschriftungen per Text-Werkzeug bearbeiten (Klick auf irgendeinen Teil der Beschriftung); selbst eingetippte
  Beschriftungen gelten wörtlich (auch „falsche“ wie H3C an einem CH₂ – keine Spiegelung, keine Korrektur)
- Bindungstyp nachträglich ändern: Bindungswerkzeug mit gewähltem Typ auf eine Bindung klicken (auch bei kleinem Zoom)
- Rückgängig/Wiederholen, Kopieren/Einfügen (auch SMILES aus anderen Programmen), automatische Sicherung im Browser
- Farben, Stilvorlagen (Standard, ACS 1996, Präsentation), helles und dunkles Design

**Schemata gestalten (wie in Publikationen)**
- Katalysezyklen: runde/elliptische Kreisläufe mit beliebig vielen Stationen (beschriftete Lücken, automatisch
  passend), Pfeilspitzen je Bogen, tangential einmündenden Zuflüssen und abgehenden Abflüssen (innen/außen);
  Griffe für Größe, Stationen, Lückenbreite (jede Seite einzeln – nur der gezogene Pfeil ändert sich) und Seitenpfeile; „Lücken an Moleküle anpassen“ macht Platz für
  Strukturen, die auf dem Kreis liegen
- Zyklus-Werkzeug mit klaren Modi: **Zeichnen** (immer ein neuer Zyklus), **Station**, **Zufluss** (von außen auf
  den Kreis ziehen), **Abfluss** (vom Kreis weg ziehen), **Durchlauf** (Edukt rein + Nebenprodukt raus an einer
  Stelle, z. B. Base → [Base–H]⁺X⁻), **2. Zyklus** (Klick auf den Kreis: kleinerer, gegenläufiger, überlappender
  Zyklus – wie Pd/Cu bei der Sonogashira-Kupplung)
- Zyklen drehen (Dreh-Griff, Drehen-Knöpfe, Umschalt = 15°-Raster) und spiegeln wie andere Objekte: Stationen, Zu-/Abflüsse
  und Schrittbezeichnungen drehen mit, beim Spiegeln kehrt sich die Laufrichtung um
- Schrittbezeichnungen an den Bögen („oxidative Addition“ …): Doppelklick auf einen Bogen, innen/außen, mit Griff
  verschiebbar, wandern mit dem Zyklus
- Ringfüllungen (Fläche) einfarbig oder mit linearem/radialem Farbverlauf; anellierte Ringsysteme teilen sich einen
  durchgehenden Verlauf (Doppelklick füllt das ganze System); aromatische Kreise (η-Ringe) gibt es in den Vorlagen
  (Cp, Ferrocen …)
- 3D-Ansicht: Ringfüllungen werden mit ihren Bindungen von hinten nach vorn gezeichnet, nach Ausrichtung zum
  Licht schattiert (zugewandte Ringe heller, geneigte dunkler) und hinten blasser – passend zu den grauen Bindungen
- Transparenz für Ringe, Bindungen, Texte usw.; Linienstärke pro Bindung/Pfeil; farbige Label-Hintergründe (z. B. „NC“-Box)
- Rich-Text: fett, kursiv, unterstrichen, hoch-/tiefgestellt, Farben, 12 Schriftarten; Ausrichtung und Hintergrund
- Winkel-, Stufen- und Klammerpfeile (Kaskaden, Verbindungslinien, 3 → 1 untereinander), Pfeilspitzen an Anfang/Ende/beiden/keinen Enden;
  Bedingungen neben senkrechten Pfeilen
- „Reaktion aufräumen“: Kaskaden, Winkel- und Verzweigungspfeile mit bündigen Spitzen, Verbindungsnummern;
  mehrzeilige Schemata (Zeilen aus der groben Anordnung, Schlangenlinie wie →/↓/←): senkrechte bzw. grob schräg
  gezeichnete Pfeile zwischen Zeilen werden senkrecht und mittig, verbundene Moleküle exakt untereinander;
  senkrechte Reaktionen (Edukte oben, Produkt unten); Reagenz-Moleküle an Pfeilen, freie Texte an Pfeilen und
  Fußnoten wandern mit; „+“ hält Edukte in einer Zeile; Verzweigungen eines Hauptpfeils (z. B. drei Bedingungen →
  drei Produkte): alle Pfeile so lang wie ihre Bedingungen, genug Abstand nach oben/unten, Produkte hinter den Spitzen
- Pfeile beschriften: Doppelklick über/unter dem Pfeil (Tab wechselt die Seite) oder Text-Werkzeug am Pfeil
- 3D: Werkzeug zum freien Drehen im Raum, Tiefendarstellung (hinten grau, Überkreuzungen freigestellt),
  „3D bereinigen“: Makrozyklen aus Ringeinheiten (Cycloparaphenylene, Nanohoops – auch mit anellierten Einheiten)
  werden idealisiert und symmetrisch als Reifen angelegt; andere Moleküle über OpenChemLib-Konformer/MMFF94,
  [n]Cycloparaphenylen-Vorlagen, Pillar[n]arene als regelmäßiges Prisma (Arene als aufrechte Wände, CH₂ auf den
  Ecken, OMe oben/unten; Vorlagen Pillar[5–7]aren), Cp-/Cp*-/Aren-Ringe in Perspektive, Ferrocen, Ruthenocen, Dibenzolchrom
  Verbünde aus mehreren Makrozyklen mit gemeinsamem Ring (z. B. CPP mit 1–5 eingebauten Pillararenen) werden
  einzeln aufgebaut und am gemeinsamen Ring zusammengesetzt (angesetzte Zyklen nach außen);
  „2D“ stellt die ursprüngliche 2D-Zeichnung vor dem ersten 3D-Schritt wieder her (am aktuellen Ort)
- Anknüpfungspunkte (Wellenlinie), Labels mit Hochstellung (z. B. `Fe^II`)
- Atom-Beschriftungen fett/kursiv (⌘B/⌘I), Teile hoch-/tiefgestellt oder farbig (Atom auswählen bzw. Maus darüber + Enter);
  „Bindungen fett“ macht die Bindungen fetter Atome so dick wie den fetten Buchstaben

**Analyse**
- Summenformel, Molmasse, exakte Masse, Elementaranalyse, cLogP, TPSA, H-Donoren/-Akzeptoren, Stereozentren
- SMILES (inkl. Stereochemie aus Keilen), Namensabfrage und Name → Struktur über PubChem (online)

**KI-Steuerung (MCP)**: Ordner `mcp/` – jede MCP-fähige KI-Anwendung (Claude Desktop/Code, Cursor, VS Code, Windsurf,
LM Studio, Gemini CLI, Codex CLI …; per stdio oder HTTP) kann Strukturen und ganze Reaktionen zeichnen,
aufräumen, Ansatztabellen anlegen/ausfüllen, exportieren und sich die Zeichnung als Bild ansehen – außerdem
Katalysezyklen, Ringfüllungen, Atome/Bindungen, Mechanismuspfeile, Formen/Klammern, Vorlagen, Stil, alle Aktionen der
Werkzeugleiste und über `edit_objects` jedes Objekt des Datenmodells. Einrichtung siehe
`mcp/ANLEITUNG.md` (mit Konfiguration je Programm, Grundausstattung mit 20 Werkzeugen über `--tools=basic`); in der App
unter Einstellungen „KI-Steuerung (MCP)“ erlauben.

**Einstellungen** (Zahnrad oben rechts, ⌘,): Sprache der Oberfläche Deutsch/Englisch (Wörterbuch in `src/i18n/en.ts`, fehlende Einträge bleiben deutsch; im Entwicklungsmodus sammelt `window.__i18nMissing` nicht übersetzte Texte), PubChem-Nachschlagen in der Ansatztabelle automatisch oder nur per Knopf (Produkte nie automatisch), Dezimaltrennzeichen Komma/Punkt (gilt überall), Sprache neuer
Ansatztabellen, Inspektor ein-/ausblenden (auch ⌘\\)

**Ansatztabelle (Stöchiometrie)**
- „Ansatztabelle erstellen“ (Inspektor → Reaktion): liest die gezeichnete Reaktion aus – Moleküle vor dem Pfeil =
  Edukte, am Pfeil = Reagenzien, danach = Produkte; Pfeiltext („THF, 80 °C, 16 h, N2“, „K2CO3 (2 equiv)“) liefert
  Lösungsmittel, Reagenzien mit Äquivalenten, Temperatur, Zeit und Atmosphäre
- Tabelle im Schema (Publikationsstil, mit exportiert, auch als CDXML) + Editor unter der Zeichenfläche
  (Doppelklick auf die Tabelle): Bezug (★), Äquivalente, n, m, V, Dichte (g/mL) und Konzentration
  (mol/L, eigene Spalten); Produkte mit theoretischer Menge, erhaltener Masse und Ausbeute; Konzentration des Bezugsedukts
- Jede Menge mit eigener Einheit (automatisch oder fest: µg/mg/g/kg, µmol/mmol/mol, µL/mL/L); Eingaben mit
  Einheit („0,2 mL“ im Massenfeld wird als Volumen verstanden); berechnete Werte grau, eingegebene schwarz
- Mit der Struktur verknüpft (⚭): Formel und Molmasse folgen der Zeichnung; Stoffe auch per Name, Summenformel
  oder SMILES (Bibliothek mit gängigen Lösungsmitteln/Reagenzien inkl. Dichte); Beschriftungen DE/EN umschaltbar

**Import/Export**
- SVG, PNG (bis 8×, transparent, mit Auflösungsangabe für Word), ⌘C kopiert die Auswahl als Bild
- ChemDraw-Dokument (`.cdxml`): Strukturen, Stereo-Keile, Ladungen, Texte, Pfeile, Klammern, Katalysezyklen (als Kurven)
- MDL-Molfile, SMILES, eigenes Dokumentformat (`.openmol`; ältere `.chemdoc.json` werden weiter geöffnet)
- Import von SMILES, Molfiles, Namen und CAS-Nummern (PubChem; CAS mit Prüfziffer-Kontrolle)
- **ChemDraw-Dateien öffnen (CDXML):** Moleküle (alle Bindungsarten, Keile, Ladungen, Isotope, Kürzel wie OMe/Boc/TBS),
  Texte mit Formatierung und Farbe, Reaktionspfeile (auch Gleichgewicht/Retro), Bedingungen über/unter dem Pfeil und
  Ausbeute, Plus-Zeichen, gebogene Elektronenpfeile, Klammern, Rechtecke und Ovale. Nicht übernommen (mit Meldung):
  Orbitale, Bilder, Spektren, einzelne Klammern; das binäre `.cdx`-Format und Einfügen direkt aus ChemDraw fehlen noch

## Technik

React + TypeScript + Vite. Chemische Berechnungen (SMILES, Molfile, Formeln, Eigenschaften, 2D-Koordinaten)
über [OpenChemLib](https://github.com/cheminfo/openchemlib-js). Zeichnen und Rendern ist eigener Code (SVG).

| Ordner | Inhalt |
|---|---|
| `src/model` | Datenmodell, Chemie-Logik, Geometrie, OpenChemLib-Anbindung, Vorlagen |
| `src/render` | SVG-Darstellung und interaktive Zeichenfläche |
| `src/tools` | Befehle, Tastenkürzel, Import/Export |
| `src/ui` | Werkzeugleiste, Eigenschaften, Dialoge |
| `electron` | Desktop-App (Hauptprozess, Menü, Einstellungsdateien, Icon-Erzeugung) |
| `build` | App-Icon (`icon.svg` → `icon.png`, `icon.icns`) |

## Noch nicht enthalten (Ideen für später)

NMR-Vorhersage, IUPAC-Namensgenerierung offline, Stöchiometrie-Tabelle, Newman-/Fischer-Projektionen,
3D-Ansicht, mehrseitige Dokumente, Import des binären ChemDraw-Formats (`.cdx`); im CDXML-Export fehlen Ringfüllungen und
Farbverläufe, Abkürzungen wie OMe werden als Beschriftung (ohne Chemie) übergeben.
