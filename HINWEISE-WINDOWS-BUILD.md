# Hinweise für den nächsten Windows-Build (für Claude auf dem Mac)

Stand: 2026-10-27, nach dem Windows-Test von OpenMol 1.3.2 (Windows 11, deutsche Tastatur, Microsoft 365). Der Test ist in
`WINDOWS.md` und im Testbericht beschrieben; hier steht, **was beim nächsten Mal anders laufen soll**, damit dieselben Fehler
nicht wiederkommen. Alles unten wurde auf einem echten Windows-Rechner gemessen, nichts ist geraten.

## 1. Die wichtigste Lektion: Korrekturen aus dem Windows-Test müssen ins Repo

Die beiden Fehler **Strg+Plus zoomt nicht** und **Menü „Exit“ / „Minimize · Zoom · Close“ auf Englisch** waren schon am
2026-10-22 (Windows-Test von 1.0.0) gefunden und behoben worden – die Korrekturen lagen aber nur in einem Versionsordner und nie im
Repo. In 1.3.2 waren beide Fehler wieder da.

- Behebt ein Windows-Test etwas, die Änderung **sofort ins Repo übernehmen** (committen), nicht nur in einen `Versionen\…`-Ordner.
- Vor jedem Windows-Build kurz prüfen, dass diese Stellen im Code stehen (sie stehen seit Commit `822f105` drin):
  - `src/tools/keyboard.ts`: Zweig `k === '+' && desktop && !IS_MAC` → `zoomTo(...)`
  - `electron/menu.mjs`: eigene Beschriftungen `minimize`, `maximize`, `quit` und ein eigenes Fenster-Menü für Windows/Linux
  - `electron/clipboard.mjs`: unter Windows nur das rohe Format „PNG“ (siehe 3.)
  - `electron/test-clipboard.mjs`: liest unter Windows mit PowerShell zurück (siehe 3.)
- Fehlt noch (nur in v5 behoben, nie übernommen): die Meldung „OpenMol ist nicht verbunden“ in `mcp/server.mjs` nennt nur den
  Browser (`http://localhost:5173`) und das Mac-Kürzel ⌘, – besser: „OpenMol-Desktop-App öffnen … (Mac ⌘, / Windows Strg+,),
  Verbinden dauert bis zu etwa 10 Sekunden“. Dasselbe gilt für die Gebrauchsanweisung am Ende von `mcp/server.mjs`
  (Zeile „If a tool says that OpenMol is not connected, ask the user to open the app (usually http://localhost:5173) …“).

## 2. Tastenkürzel und Menü: nicht von einer US-Tastatur ausgehen

- Menü-Beschleuniger wie `CmdOrCtrl+Plus` lösen auf der **deutschen Tastatur nicht aus** (Plus liegt dort ohne Umschalt auf einer
  anderen Taste; Electron erwartet Umschalt+=). Zoom-Kürzel deshalb zusätzlich im Renderer abfangen (`e.key === '+'`), nicht nur im Menü.
- Beschleuniger mit Sonderzeichen (`\`, `,`, `+`, `-`) zeigt Windows im Menü anders an (z. B. „Strg+^“ statt „Strg+\“). Das ist
  nur Anzeige; in Tooltips der Oberfläche steht noch „Strg+\“ – die deutsche Tastatur hat dafür `Strg+#` (funktioniert, `e.code === 'Backslash'`).
- **Strg+Alt+Umschalt+F/B (Ebene vor/zurück):** funktioniert mit der **linken** Strg- und Alt-Taste. Mit **AltGr** statt Alt
  kommt nur Umschalt+F/B an – und über einem Atom macht das daraus Fluor/Bor. Kürzel nicht auf AltGr-Kombinationen stützen.
- Standard-Rollen von Electron (`windowMenu`, `quit`, `about`, `close`, `minimize`) sind unter Windows **englisch**, wenn man kein
  `label` mitgibt. Immer ein Label setzen (die Sprache kommt aus der Oberfläche, `setMenuLang`). Bei neuen Menüpunkten daran denken.
- Windows-Menüs schreiben „Strg+Umschalttaste+S“ selbst aus; das ist normal, keine Änderung nötig.

## 3. Zwischenablage (Word-Austausch) – das war der heikelste Teil

Gemessen unter Windows mit Electron 44:

- `clipboard.write` mit `image/png` → Chromium **codiert das PNG neu**, der Datenblock „openmol“ geht verloren. Auch wenn man
  zusätzlich das Rohformat mitgibt, **setzt sich das neu codierte PNG durch** (die Daten sind weg).
- Nur das Rohformat `electron application/osclipboard;format="PNG"` → die Daten **bleiben erhalten**; Word übernimmt es,
  Paint und andere Programme zeigen das Bild an. Deshalb schreibt `writePng` unter Windows **nur** dieses Rohformat.
- `clipboard.read()` zeigt das rohe „PNG“ **nicht** an (nur als `image/png`, und das ist neu codiert). Ein Rücklese-Test über
  `clipboard.read()` kann es daher nie finden – der Windows-Zweig in `test-clipboard.mjs` liest mit PowerShell
  (`[Windows.Forms.Clipboard]::GetDataObject().GetData('PNG')`, Latin-1) zurück. Faustregel: **nie mit derselben Schnittstelle prüfen,
  die das Format nicht sehen kann.**
- Aus Word zurück: Word legt sein **eigenes „PNG“ neu codiert** (ohne Daten) ab, die OpenMol-Daten stecken im Format
  **„Art::GVML ClipFormat“** (ZIP, Daten im Alternativtext-Titel). `clipboard.read()` zeigt dieses Format als
  `electron application/osclipboard;format="Art::GVML ClipFormat"`; `scanClipboard()` liest es (nicht aus der Skip-Liste streichen!).
- Windows-PowerShell 5.1 hat kein `[Text.Encoding]::Latin1` – `[Text.Encoding]::GetEncoding(28591)` verwenden.
- Ändert Electron die Zwischenablage-Schnittstelle erneut (ist schon einmal passiert: 44 hat nur noch `read()`/`write()` mit
  `ClipboardItem`), zuerst `npm run test:clipboard` **unter Windows** laufen lassen.

## 4. Word-Add-in

- **Word muss normal gestartet werden.** Eine per Automatisierung/Skript gestartete Instanz (`WINWORD.EXE /Automation -Embedding`)
  lädt **keine** Web-Add-ins – die Gruppe „OpenMol“ fehlt dann, obwohl alles richtig eingerichtet ist. Wer das Add-in prüft: Word aus
  dem Startmenü oder per Doppelklick auf eine Word-Datei öffnen.
- Der Weg Registry `HKCU\Software\Microsoft\Office\16.0\WEF\Developer` (Name = Wert = Pfad des Manifests) funktioniert mit
  Microsoft 365; die Gruppe erscheint im Reiter **Start** rechts, die Seitenleiste meldet „Verbunden mit OpenMol 1.3.2“.
- Zertifikat: `certutil -user -addstore Root …` und das spätere `-delstore` lösen jeweils eine **Windows-Abfrage** aus, die der
  Nutzer selbst bestätigen muss. Ein Befehl, der darauf wartet, **blockiert** den aufrufenden Prozess (bei Tests im Hintergrund
  starten). Der Name „OpenMol localhost“ enthält ein Leerzeichen – beim Aufruf aus Skripten korrekt quoten.
- Zum Testen einen **eigenen Einstellungsordner** (`OPENMOL_USERDATA`) benutzen: Registry-Wert und Zertifikat zeigen sonst in den
  echten OpenMol-Ordner des Nutzers. Danach Registry-Wert, Zertifikat und Testordner wieder entfernen.

## 5. Bauen und Veröffentlichen

- **Dateiname:** electron-builder legt lokal `OpenMol Setup 1.3.2.exe` (mit Leerzeichen) ab, `latest.yml` verweist aber auf
  `OpenMol-Setup-1.3.2.exe` (mit Bindestrichen). Lädt man von Hand hoch, **unter dem Namen aus `latest.yml` hochladen**, sonst
  findet der Auto-Updater die Datei nicht. Besser: in `package.json` unter `build.nsis` `"artifactName": "OpenMol-Setup-${version}.${ext}"`
  setzen, dann sind lokale Datei und Update-Datei gleich benannt (nach dem Ändern einmal prüfen).
- **Eine Quelle für beide Dateien:** Im 1.3.2-Draft wurde die Mac-DMG aus `cc782c5` gebaut, der Windows-Installer aus `cc782c5` + den
  Windows-Korrekturen (`822f105`). Veröffentlichen taggt `main`. Immer Mac und Windows **aus demselben Commit** bauen (zuerst alle
  Korrekturen committen, dann beide bauen) und den Commit im Release nennen.
- **Draft ist kein Test:** „Windows eingebaut, ungetestet“ im Release-Text nur schreiben, wenn es wirklich so ist – und nach einem
  Windows-Test den Text und `WINDOWS.md` im selben Schritt aktualisieren.
- Build-Stolpersteine auf Windows (alle aufgetreten):
  - `npm install` überspringt Electrons Installationsskript (npm `allowScripts`): danach fehlt `node_modules\electron\dist\electron.exe`.
    Abhilfe: `node node_modules/electron/install.js`.
  - Gelegentlich `EPERM … rename 'win-unpacked.tmp'` beim Entpacken von Electron (Virenschutz/Defender vermutet, nicht geklärt).
    Abhilfe: Build mit `--config.electronDist=node_modules/electron/dist`. Im 1.3.2-Lauf trat es nicht auf.
  - PowerShell: `npm.ps1` kann durch die Ausführungsrichtlinie blockiert sein → `npm.cmd` benutzen; Windows PowerShell 5.1 kennt kein `&&`.
  - Pfade enthalten Leerzeichen („Claude Projects“, „Program Files“): in Skripten und in JSON-Konfigurationen immer quoten bzw. `\\`.
- `public/ocl-resources.json` wird beim `npm install` (postinstall) neu erzeugt und erscheint danach unter Windows als geändert
  (Zeilenenden LF/CRLF). Nicht mit einchecken; besser: Datei nicht im Repo verfolgen oder per `.gitattributes` auf LF festlegen.

## 6. Wie man Windows-Fehler schneller findet (vom Mac aus nicht möglich, aber vorbereiten)

- Alles Windows-spezifische bleibt hinter `process.platform` bzw. `IS_MAC`; trotzdem **nie** „funktioniert“ schreiben, solange es nicht
  auf Windows lief – „gebaut, nicht getestet“ ist die ehrliche Formulierung.
- Vor dem Weitergeben des Windows-Builds an den Tester eine kurze **Regressionsliste** mitgeben (jeweils 1 Minute): Fenster-Menü deutsch
  · Strg+Plus zoomt · `npm run test:clipboard` besteht · Strg+C → in Word einfügen → wieder kopieren → in OpenMol einfügen ·
  Word-Add-in „In OpenMol bearbeiten“ (Word normal gestartet) · KI-Steuerung verbindet (bis ~10 s).
- Der Testweg ohne Klicken (Debug-Port, `OPENMOL_USERDATA`, `OPENMOL_TEST_DIALOGS`) funktioniert unter Windows genauso wie auf dem Mac.
  Echte Tastenkürzel (Menü-Beschleuniger) kommen nur mit echten Tastendrücken an, nicht über das Debug-Protokoll.

## 7. Noch offen / nie unter Windows geprüft

- Installation und Deinstallation des **1.3.2-Installers** (nur `win-unpacked` wurde gestartet; Installation/Deinstallation lief nur mit 1.0.0).
- SmartScreen-Hinweis beim Installer aus dem Internet; echter Doppelklick auf `.openmol` im Explorer mit der Maus.
- Word-Add-in: Schritte C.9 (zweites Bearbeiten) und C.10 (Datei speichern, schließen, öffnen, nochmal bearbeiten) einzeln.
- Neue 1.3.2-Funktionen wie Tabs nur kurz geprüft (Datei ▸ Neuer Tab, zweiter Start öffnet als Tab).
- Kein Test mit PowerPoint oder älteren Office-Versionen (2016/2019 vermutlich ohne Add-in-Unterstützung).
