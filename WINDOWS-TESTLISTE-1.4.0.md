# Windows-Testliste für OpenMol 1.4.0 (für Claude auf Windows und den Tester)

Stand: 2026-10-29. Ergänzt `HINWEISE-WINDOWS-BUILD.md` (bitte vorher lesen). Seit dem letzten Windows-Test (1.3.2) sind
rund 20 Funktionen und Korrekturen dazugekommen. Auf dem Mac sind alle Prüfreihen fehlerfrei. **Unter Windows ist davon noch
nichts gelaufen.** Diese Liste nennt, was nur unter Windows geprüft werden kann oder dort anders laufen könnte.

Ergebnis bitte je Punkt mit ✅ / ❌ (+ kurze Beschreibung, Bildschirmfoto bei Darstellungsfehlern) in `WINDOWS.md` eintragen.
Fehler, die unter Windows behoben werden, **sofort ins Repo committen** (siehe Hinweise, Abschnitt 1).

## 0. Vor dem Bauen

- [ ] Stand von GitHub holen. Der Windows-Build muss **denselben Commit** haben wie die Mac-Version. Commit im Testbericht nennen.
- [ ] Korrekturen aus dem 1.3.2-Test sind im Code (Hinweise, Abschnitt 1):
  - Strg+Plus in `src/tools/keyboard.ts`
  - Menübeschriftungen in `electron/menu.mjs`
  - Rohformat „PNG“ in `electron/clipboard.mjs`
  - MCP-Meldung in `mcp/server.mjs`
  - `artifactName` in `package.json`
- [ ] Nach dem Bauen heißt der Installer `OpenMol-Setup-<Version>.exe`, genau wie in `latest.yml`.

## 1. Prüfreihen automatisch (Entwicklungsserver, ca. 5 Minuten)

`npm.cmd run dev` starten, http://localhost:5173 im Browser öffnen und in der Konsole nacheinander aufrufen (jede liefert eine
Fehlerliste, leer = gut). Achtung: Die Reihen überschreiben das offene Dokument.

```js
const f = await import('/src/dev/featureTests.ts')
await f.run(); await f.run2(); await f.run3(7)
await (await import('/src/dev/reactionLinkTests.ts')).run()
await (await import('/src/dev/wordAddinTests.ts')).run()
```

Danach `npm.cmd run test:clipboard` (Zwischenablage mit dem echten Windows-Format).

## 2. Regressionsliste aus dem 1.3.2-Test (je 1 Minute)

- [ ] Fenster-Menü auf Deutsch („Minimieren“, „Beenden“) und auf Englisch, wenn die Oberfläche auf Englisch steht.
- [ ] Strg+Plus / Strg+Minus zoomen (deutsche Tastatur).
- [ ] Strg+C in OpenMol → in Word einfügen → dort kopieren → in OpenMol einfügen: Die Struktur ist wieder bearbeitbar.
- [ ] Word-Add-in „In OpenMol bearbeiten“. Word dafür **normal** starten, nicht per Skript.
- [ ] KI-Steuerung verbindet sich (bis etwa 10 Sekunden).

## 3. Installation

- [ ] Installer installieren (SmartScreen-Hinweis notieren) und OpenMol über das Startmenü starten.
- [ ] Doppelklick auf eine `.openmol`-Datei im Explorer öffnet sie.
- [ ] Deinstallieren entfernt das Programm. Die eigenen Sammlungen und Einstellungen bleiben erhalten.
- [ ] Nur falls ein Release-Entwurf existiert: Update von installiertem 1.3.2 auf 1.4.0 über die Update-Funktion.

## 4. Neu seit 1.3.2 – Windows-relevant

### Word-Austausch und Add-in (auf dem Mac nur mit nachgebautem Word geprüft)
- [ ] Molekül mit **Größe 150 %**, **Farbverlauf** (Farbe & Deckkraft ▸ Verlauf) und **Textmarker-Verlauf** kopieren → in Word
  einfügen → wieder zurück. Größe und Verläufe bleiben erhalten.
- [ ] Im Add-in ein Bild bearbeiten, dessen Größe in Word vorher geändert wurde. Nach „Zurück nach Word“ hat es wieder dieselbe Größe.
- [ ] OpenMol aus dem Add-in heraus öffnen, dann **schließen, ohne** „Zurück nach Word“ zu klicken. Der Knopf „In OpenMol
  bearbeiten“ ist sofort wieder klickbar. Vorher blieb er bis zu 2 Stunden gesperrt.
- [ ] Oberfläche auf Englisch stellen. Die Add-in-Seitenleiste und das Menüband erscheinen auf Englisch.
- [ ] Dasselbe Bild zweimal hintereinander bearbeiten. Datei speichern, schließen, wieder öffnen und noch einmal bearbeiten
  (offen seit 1.3.2: Schritte C.9 und C.10).

### Tastenkürzel (Strg statt ⌘)
- [ ] Strg+G gruppiert, Strg+Umschalt+G löst die Gruppe.
- [ ] Strg+L sperrt, Strg+Umschalt+L entsperrt alles. Bindungs-, Ring- und Nummern-Werkzeug auf ein gesperrtes Molekül zeigen den
  Hinweis „Gesperrt – …“. Der Hinweis muss **„Strg+Umschalt+L“** nennen, nicht „⇧⌘L“.
- [ ] Taste J wählt das Benzolring-Werkzeug.
- [ ] Strg+P öffnet den **Windows-Druckdialog**. Die Seiten entsprechen dem PDF-Export.
- [ ] Tooltips und Kontextmenü zeigen überall „Strg“ und keine ⌘-Zeichen (Stichproben: Inspektor ▸ Anordnung, Rechtsklick-Menü).

### Eigene Sammlungen in eigenem Ordner (Einstellungen ▸ Eigene Sammlungen)
- [ ] Einen **OneDrive-Ordner** wählen, dann eine Vorlage speichern. Die Datei erscheint im Ordner.
- [ ] Pfad mit Leerzeichen und Umlauten (z. B. `C:\Users\…\Eigene Dateien\Chemie Übung`).
- [ ] Ordner auf einem USB-Stick wählen, dann den Stick abziehen. Die Einstellungen zeigen einen Hinweis, und es entsteht eine
  Kopie im App-Ordner. Kein Absturz.
- [ ] Datei im Ordner von außen ändern (z. B. zweiter Rechner oder von Hand ersetzen) und dann ins OpenMol-Fenster zurückkehren.
  Die Änderung ist sichtbar.

### Darstellung (Bildschirmfotos genügen)
- [ ] Leere Zeichenfläche: „Zuletzt verwendet“ zeigt die letzten Dokumente. Ein Klick öffnet sie (Windows-Pfade).
- [ ] Knopf „Über OpenMol“: Das Symbol (Kaffee, Funke, Geldscheine, Winken, Händedruck) erscheint **farbig** und nicht als Kästchen.
  Es wechselt frühestens nach 5 Stunden, auch über Neustarts hinweg.
- [ ] Inspektor (jetzt 360 px) und Einstellungen (580 px) bei Anzeigeskalierung **125 % und 150 %** und auf einem kleinen
  Laptop-Bildschirm. Es gibt kein waagerechtes Scrollen, und es bleibt genug Zeichenfläche.
- [ ] Lineale, Raster und Hilfslinien (Dokument-Stil ▸ Lineale, Raster & Hilfslinien) bei 125 % / 150 % Skalierung. Eine
  Hilfslinie aus dem Lineal ziehen und wieder zurückziehen (löschen). Strg+Z stellt sie wieder her.
- [ ] Gleichgewichtspfeil (neu gezeichnet wie ChemDraw) auf dem Bildschirm, im PNG- und PDF-Export. Falls ChemDraw unter Windows
  vorhanden ist: CDXML-Export dort öffnen.
- [ ] Textmarker- und Farbverläufe im PNG-, SVG- und PDF-Export.

### Ansatztabelle ↔ Reaktionspfeil (wichtig für den Nutzer)
- [ ] Ansatztabelle aus dem Pfeil erstellen. Lösungsmittel, Temperatur und Zeit im Pfeil ändern → die Tabelle folgt, und
  umgekehrt. Einmal mit Dezimaltrennzeichen „Komma“ (Einstellungen) und einmal mit „Punkt“.

## 5. Nicht in dieser Liste (bewusst)

- PowerPoint und ältere Office-Versionen (2016/2019).
- Alles rein Rechnerische (Analyse, Isotopenmuster, Nummerierung, Sperren-Logik). Das decken die Prüfreihen in Abschnitt 1 ab und
  ist nicht plattformabhängig.
