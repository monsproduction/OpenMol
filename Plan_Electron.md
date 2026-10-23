# Plan: OpenMol als Desktop-App (Electron)

Stand: 2026-10-22 · nur Plan, noch nichts programmiert.
Grundlage: Notion „ToDos für Electron“, Icon in `Icon/Icon.png`, Durchsicht des Codes.

## Umsetzungsstand (2026-10-22)

Phasen 1–8 umgesetzt und getestet (Entwicklungsmodus und fertige App `release/OpenMol-1.0.0-arm64.dmg`,
Kopie in `Versionen/v3_2026-10-22_Desktop-App/`). Bewusst offen: Windows-Version, mehrere Fenster, binäres `.cdx`,
Signieren/Notarisieren bei Apple, Playwright-Tests (stattdessen Tests über die Fernsteuerschnittstelle von Electron).

## Ziel

OpenMol läuft als eigenständige Mac- (und Windows-)App mit eigenem Icon, echter Menüleiste, nativen
Öffnen-/Speichern-/Export-Dialogen und Einstellungen in einer Datei auf der Festplatte. Die Web-Version
(`npm run dev`) bleibt unverändert nutzbar – beide teilen sich denselben Code.

## Was ich im Code gefunden habe (Ausgangslage)

| Bereich | Heute (Browser) | In Electron nötig |
|---|---|---|
| Speichern | Download `Name.chemdoc.json` (`io.ts: saveDocument`) | Nativer Dialog, Datei-Pfad merken, „Speichern“ ohne Dialog, „Speichern unter …“ |
| Öffnen | unsichtbares `<input type=file>` (`io.ts: openFile`) | Nativer Öffnen-Dialog, „Zuletzt geöffnet“, Doppelklick im Finder |
| Export PNG/SVG/MOL/CDXML, Vorlagen-Export | Download per `<a download>` (`io.ts`, `cdxml.ts`, `Dialogs.tsx`) | Nativer Sichern-Dialog mit passendem Dateityp |
| CDXML-Import | gibt es nicht (nur Export) | neu, Phase 2a – auch für die Web-Version |
| Einstellungen & Daten | alles über `lsGet/lsSet` in `storage.ts` (localStorage): Einstellungen, Sprache, Autosave, Bibliothek, Inspektor-Reihenfolge, Ringfüllungs-Leiste, Theme | JSON-Dateien im Benutzerordner der App (siehe Phase 3) |
| OCL-Ressourcen (3D) | `fetch('ocl-resources.json')` | eigenes App-Protokoll, damit `fetch` funktioniert (unter `file://` nicht verlässlich) |
| PubChem/Wikidata | `fetch` ins Internet | funktioniert weiter (kein CORS-Problem in Electron) |
| KI-Steuerung (MCP) | App ruft `http://127.0.0.1:5181` | **MCP-Server lehnt heute alles ab, was nicht von `http://localhost` kommt** → Origin der App (`app://openmol`) zusätzlich erlauben |
| `window.prompt` (SMILES-Fallback in `io.ts`) | Browser-Eingabefeld | gibt es in Electron nicht → durch eigenen Dialog ersetzen |
| `window.open` (PubChem/Wikipedia) | neuer Tab | im Standardbrowser öffnen (`shell.openExternal`) |
| Tastenkürzel | `keyboard.ts` | **⌘⇧X löst heute „Ausschneiden“ aus, ⌘⇧D „Duplizieren“** (Shift wird nicht geprüft) → trennen |

## Phasen

### Phase 1 – Grundgerüst (App startet)
- Ordner `electron/` mit `main.ts` (Fenster, Menü, Dialoge, Dateizugriff) und `preload.ts` (schmale,
  sichere Brücke `window.openmol.*` zur Oberfläche). Die Oberfläche bleibt die bestehende React-App.
- Sicherheit: `contextIsolation`, `sandbox`, kein Node in der Oberfläche, nur eigene Inhalte laden,
  externe Links im Standardbrowser.
- Eigenes Protokoll `app://openmol/` liefert den gebauten `dist/`-Ordner aus (stabiler Speicherort,
  `fetch` der OCL-Ressourcen funktioniert, Zwischenablage für PNG erlaubt).
- Skripte: `npm run app` (Entwicklung: Vite + Electron mit Live-Neuladen), `npm run app:build` (fertige App).
- Fenstergröße/-position merken; Mindestgröße.
- Erkennung in der App: `isDesktop` – nur dann werden native Dialoge statt Downloads benutzt.

### Phase 2 – Dateien (Notion: „Datei Speichern, Öffnen, Exportieren … mit Dialogen“)
- **Öffnen …** (⌘O): nativer Dialog für `.openmol`, `.chemdoc.json`, `.mol`, `.sdf`, `.smi` und `.cdxml` (Phase 2a).
- **Speichern** (⌘S): beim ersten Mal Dialog, danach direkt in dieselbe Datei. **Speichern unter …** (⇧⌘S).
- Fenstertitel mit Dateiname und Punkt/„bearbeitet“ bei ungespeicherten Änderungen; beim Schließen/Beenden
  mit ungespeicherten Änderungen nachfragen (Sichern / Nicht sichern / Abbrechen).
- **Exportieren** (⌘E) ▸ PNG, SVG, Molfile, CDXML – jeweils nativer Sichern-Dialog mit Vorschlagsname.
- **Zuletzt geöffnet** (Menü und Dock), Öffnen per Doppelklick/Drag aufs Dock-Icon (Dateizuordnung).
- Autosave bleibt (für Absturz-Wiederherstellung), aber als Datei im App-Ordner.

### Phase 2a – CDXML-Import (ChemDraw-Dateien öffnen)
Gegenstück zum vorhandenen CDXML-Export (`cdxml.ts`), dieselben Element- und Attributnamen. Neues Modul
`src/tools/cdxmlImport.ts`; liest die XML-Datei mit dem eingebauten `DOMParser` – läuft damit auch in der
Web-Version (Öffnen-Dialog, Datei auf die Zeichenfläche ziehen).

**Stufe 1 – Strukturen und Schema (das Wichtigste aus echten ChemDraw-Dateien):**
- Moleküle (`<fragment>`, `<n>`, `<b>`): Elemente, Koordinaten, Ladungen, Isotope, H-Zahl, Bindungsordnung
  (einfach/doppel/dreifach/aromatisch), Keil- und Strichbindungen samt Richtung, Wellen- und fette Bindungen,
  Lage der Doppelbindung.
- Beschriftete Atome und Kürzel (`NodeType="Fragment"/"Nickname"`, z. B. OMe, Ph, Boc): werden zu OpenMol-Labels;
  bekannte Kürzel bleiben auflösbar (Kürzel auflösen).
- Texte (`<t>` mit `<s>`-Abschnitten): Schrift, Größe, fett/kursiv/hoch-/tiefgestellt, Farbe → OpenMol-Rich-Text;
  Bedingungen über/unter Reaktionspfeilen werden dem Pfeil zugeordnet (wie bei „Reaktion aufräumen“).
- Reaktionspfeile (`<arrow>` sowie ältere `<graphic GraphicType="Line">` mit Pfeilspitze): gerade Pfeile,
  Gleichgewichts- und Retrosynthesepfeile, „+“-Zeichen.
- Farben aus der Farbtabelle (`<colortable>`), Maßstab über die Bindungslänge des Dokuments (ChemDraw meist
  14,4 pt → OpenMol-Bindungslänge).

**Stufe 2 – Zeichenelemente:**
- Gebogene Mechanismuspfeile (Elektronenpaar/Fischhaken), Klammern (Polymer/Komplex), Rechtecke, Kreise/Ovale,
  Linien.

**Grenzen (bewusst nicht in diesem Schritt):**
- Binäres `.cdx` (älteres ChemDraw-Format) und Einfügen aus ChemDraw über die Zwischenablage (ChemDraw legt
  dort meist das Binärformat ab) – getrennter, späterer Punkt.
- Objekte ohne Gegenstück in OpenMol (z. B. Orbitale, TLC-Platten, Spektren, eingebettete Bilder) werden
  übersprungen; nach dem Öffnen nennt eine Meldung, was nicht übernommen wurde („3 Objekte nicht übernommen: Orbital, Bild“).
- Das Ergebnis wird nicht automatisch „aufgeräumt“ – die Lage bleibt wie in ChemDraw.

**Sicherheit:** Der Browser-XML-Parser lädt keine externen Inhalte; Dateien werden nur gelesen.

**Tests:**
- Rundreise OpenMol → CDXML-Export → Import: gleiche Strukturen (SMILES-Vergleich), Texte, Pfeile und Lagen.
- Echte ChemDraw-Dateien, z. B. die öffentlich verfügbaren CDXML-Testdateien aus RDKit (dienten schon für den
  Export als Vorlage) – plus gerne eigene ChemDraw-Dateien von dir, falls vorhanden.
- Seltene Fälle: leere Datei, beschädigtes XML, sehr große Schemata, Kürzel mit innerem Fragment, Atome ohne Koordinaten.

### Phase 3 – Einstellungen lokal auf der Festplatte (Notion)
- Alles, was heute über `lsGet/lsSet` läuft, landet in lesbaren JSON-Dateien im App-Ordner
  (Mac: `~/Library/Application Support/OpenMol/`): `settings.json` (Sprache, Dezimaltrennzeichen,
  Theme, Inspektor-Reihenfolge, Ringfüllungs-Leiste …), `library.json` (eigene Vorlagen), `autosave.json`.
- Umsetzung zentral in `storage.ts` (ein Ort für alle Werte) – die übrigen Module bleiben unverändert.
- Beim ersten Start werden vorhandene Werte übernommen; Dateien sind sicher geschrieben (erst temporär,
  dann umbenennen), damit bei einem Absturz nichts kaputtgeht.
- Hinweis: Electron würde localStorage auch ohne Umbau auf der Festplatte ablegen, aber in einem nicht
  lesbaren Format und an die Adresse der App gebunden – die JSON-Dateien sind robuster und lassen sich sichern.

### Phase 4 – Menüleiste (Notion: „sinnvoll, aber übersichtlich“)
Vorschlag (Mac; Windows gleich, App-Menü-Punkte dort unter „Datei“/„Hilfe“):

- **OpenMol**: Über OpenMol · Einstellungen … (⌘,) · Ausblenden · Beenden
- **Ablage**: Neu (⌘N) · Öffnen … (⌘O) · Zuletzt geöffnet ▸ · Schließen (⌘W) · Speichern (⌘S) ·
  Speichern unter … (⇧⌘S) · Importieren (CDXML, Name/SMILES/Molfile …) · Exportieren ▸ (PNG, SVG, Molfile, CDXML)
- **Bearbeiten**: Widerrufen · Wiederholen · Ausschneiden · Kopieren · Als Bild kopieren · Einfügen ·
  Duplizieren · Löschen · Alles auswählen
- **Struktur**: Struktur aufräumen (⇧⌘K) · Reaktion aufräumen (⇧⌘X) · 2D ↔ 3D (⇧⌘D) ·
  Kürzel bilden · Kürzel auflösen · Name → Struktur … · Struktur → Name · Analyse ▸
- **Ansicht**: Einpassen (⌘0) · Vergrößern/Verkleinern · Inspektor ein/aus (⌘\) · Hell/Dunkel · Vollbild
- **Fenster** (Standard) · **Hilfe**: Tastenkürzel · Anleitung KI-Steuerung

Technik: Menüpunkte schicken einen Befehl an die Oberfläche, die dieselben Funktionen wie die Knöpfe aufruft.
Damit ein Kürzel nicht doppelt auslöst (Menü **und** `keyboard.ts`), bekommt jedes Kürzel genau einen
Besitzer – das prüfe ich beim Programmieren in der echten App.

### Phase 5 – Neue Funktionen aus Notion
- **⇧⌘K / Strg+⇧+K**: Struktur aufräumen (bestehende Funktion `cleanStructure`).
- **⇧⌘X / Strg+⇧+X**: Reaktion aufräumen (Entscheidung 1). ⌘X (ohne Shift) bleibt Ausschneiden.
- **⇧⌘D / Strg+⇧+D**: markierte Struktur in 3D, ist sie schon 3D → zurück in 2D. ⌘D (ohne Shift) bleibt Duplizieren.
  Wie beim bisherigen 3D-Modus nur für markierte Moleküle. „Zurück in 2D“ = z-Koordinaten entfernen und
  2D-Struktur neu anordnen (wie „Struktur aufräumen“).
- **Name → Struktur auch mit CAS-Nummer**: CAS-Format erkennen (mit Prüfziffer, Funktion `casValid` gibt es
  schon), dann gezielt über die CAS-Nummer in PubChem suchen; bei Mehrdeutigkeit Hinweis. Ob die bisherige
  Namenssuche CAS-Nummern schon zuverlässig findet, habe ich noch nicht geprüft – teste ich beim Umsetzen.
  Gilt auch für die KI-Werkzeuge (`name:64-17-5`).
- Die Kürzel kommen auch in die Web-Version (dort ⇧⌘X/⇧⌘D, soweit der Browser sie nicht selbst belegt).

### Phase 6 – Icon & Paket
- **Icon**: `Icon/Icon.png` ist 458 × 468 px, nicht quadratisch und hat einen **weißen, nicht
  transparenten Hintergrund** um das abgerundete Quadrat. macOS braucht 1024 × 1024 px mit transparentem
  Rand (sonst weißer Kasten im Dock); Windows eine `.ico` bis 256 px. *Siehe Frage 2.*
- Paket mit **electron-builder**: Mac `.dmg` (Apple Silicon + Intel), Windows-Installer `.exe`.
- App-Name „OpenMol“, eigene Paket-ID, Dateizuordnung für OpenMol-Dokumente mit eigenem Dokument-Icon.
- **Signieren**: Ohne Apple-Entwicklerkonto (99 $/Jahr) warnt macOS beim ersten Öffnen („nicht verifizierter
  Entwickler“, Öffnen per Rechtsklick → Öffnen). Für den Eigengebrauch reicht das; Signieren/Notarisieren
  später möglich. Windows ähnlich (SmartScreen-Hinweis).
- Ob sich der Windows-Installer direkt auf dem Mac bauen lässt, prüfe ich beim Umsetzen (sonst per
  GitHub-Actions oder auf einem Windows-Rechner).

### Phase 7 – KI-Steuerung (MCP) in der Desktop-App
- MCP-Server erlaubt zusätzlich den Origin `app://openmol` (fremde Webseiten können diesen Origin nicht
  annehmen – die Schutzwirkung bleibt).
- Der MCP-Server liegt weiter im Projektordner `mcp/`; optional später mit in die App packen und den Pfad
  in den Einstellungen anzeigen („Konfiguration kopieren“).

### Phase 8 – Test & Übergabe
- Oberflächen-Teile wie bisher im Browser testen; die Desktop-Teile (Menü, Dialoge, Dateien, Kürzel)
  in der echten App. Für wiederholbare Tests: kleine automatische Tests mit Playwright (startet die
  Electron-App und klickt Menü/Kürzel durch) – nur falls gewünscht, braucht eine zusätzliche Entwickler-Abhängigkeit.
- README-Abschnitt „Desktop-App“ (bauen, starten, wo die Einstellungen liegen).
- Fertige Builds landen versioniert in `Versionen/` (keine Überschreibung früherer Stände).

## Reihenfolge & Aufwand (grobe Einschätzung)

1. Grundgerüst + Protokoll + Sicherheit (Phase 1) – zuerst, alles andere baut darauf auf
2. Dateien + Dialoge (Phase 2) und Einstellungen auf der Festplatte (Phase 3)
3. CDXML-Import (Phase 2a) – unabhängig von Electron, kann auch vorgezogen werden (funktioniert sofort in der Web-Version)
4. Menüleiste + Kürzel + 2D/3D + CAS (Phase 4/5)
5. Icon + Paket (Phase 6), MCP-Origin (Phase 7), Tests/README (Phase 8)

Jede Phase endet mit einem lauffähigen Stand, den ich teste, bevor die nächste beginnt.

## Entscheidungen (2026-10-22)

1. **⇧⌘X = Reaktion aufräumen** (wie ChemDraw); ⇧⌘K = Struktur aufräumen.
2. **Icon als Vektorgrafik (SVG) nachzeichnen** – transparenter Hintergrund, scharf in allen Größen;
   daraus `.icns` (Mac) und später `.ico` (Windows). Das Original `Icon/Icon.png` bleibt unverändert.
3. **Zuerst nur Mac**, Windows danach.
4. **Eigene Dateiendung `.openmol`** mit Dateizuordnung und Dokument-Icon; `.chemdoc.json` lässt sich weiter öffnen.
5. Mehrere Fenster: noch offen – Vorschlag: zunächst ein Fenster, mehrere Fenster als späterer Ausbau.

## Ursprüngliche Fragen (beantwortet, siehe oben)

1. **⇧⌘X**: In Notion steht bei ⇧⌘K *und* ⇧⌘X „Struktur aufräumen“. Soll ⇧⌘X **„Reaktion aufräumen“** sein
   (wie in ChemDraw)?
2. **Icon**: Das PNG ist klein (458 px) und hat einen weißen Hintergrund. Optionen:
   a) Ich schneide den weißen Rand frei und skaliere auf 1024 px (geht sofort, wird leicht weich);
   b) du lieferst eine größere Version (≥ 1024 px, transparenter Hintergrund);
   c) ich zeichne das Icon als Vektorgrafik (SVG) nach – gestochen scharf in allen Größen, sieht aber im Detail
      minimal anders aus.
3. **Plattformen**: Zuerst nur Mac, oder Mac und Windows gleichzeitig?
4. **Dateiendung**: bei `.chemdoc.json` bleiben oder eine eigene Endung wie **`.openmol`** (sauberer für
   Doppelklick-Öffnen und eigenes Dokument-Icon; alte Dateien lassen sich weiter öffnen)?
5. **Mehrere Fenster**: Reicht zunächst ein Dokument pro Fenster mit einem Fenster, oder sollen gleich mehrere
   Dokumente parallel (mehrere Fenster) möglich sein?
