> **Hinweis (für Menschen):** Wer OpenMol als Desktop-App installiert hat, braucht diese Datei nicht: In OpenMol unter
> Einstellungen → „KI-Anwendung verbinden“ → **„Prompt für die KI kopieren“** gibt es einen fertigen Prompt mit den
> Pfaden des eigenen Rechners – ohne Projektordner und ohne Node.js. Diese Datei ist für die Variante mit Projektordner.

Bitte richte die Verbindung zwischen dir und **OpenMol** ein und prüfe, dass sie funktioniert. Antworte auf Deutsch.

## Worum es geht
OpenMol ist ein Programm zum Zeichnen chemischer Strukturen, Reaktionen und Mechanismen (Desktop-App für
Mac/Windows). Es bringt einen **MCP-Server** mit (Model Context
Protocol). Über ihn kannst du die geöffnete Zeichnung lesen und bearbeiten: Strukturen einfügen (SMILES oder
`name:<englischer Name oder CAS-Nummer>`), Reaktionen zeichnen, Ansatztabellen anlegen, exportieren, ein Bild der
Zeichnung abrufen. Alles lässt sich in OpenMol rückgängig machen.

So hängt alles zusammen: Deine KI-Anwendung startet den Server `mcp/server.mjs` (Node.js) → der Server spricht
lokal über `127.0.0.1:5181` mit der geöffneten OpenMol-App. Alles bleibt auf diesem Rechner.

## Angaben, die du brauchst
- **Projektordner von OpenMol:** `<PFAD ZUM PROJEKTORDNER>` – falls hier noch der Platzhalter steht, frag mich nach
  dem Pfad (der Ordner enthält `package.json`, `src/` und `mcp/`).
- **Server-Datei:** `<Projektordner>/mcp/server.mjs`
- **Ausführliche Anleitung mit Einträgen für viele Programme:** `<Projektordner>/mcp/ANLEITUNG.md`

## Schritte
1. **Node.js prüfen:** `node --version` (Version 18 oder neuer). Den **vollständigen Pfad** zu `node` ermitteln
   (Mac: `which node`, z. B. `/opt/homebrew/bin/node`; Windows: `where node`, z. B.
   `C:\Program Files\nodejs\node.exe`) – viele KI-Anwendungen finden `node` sonst nicht.
2. **Abhängigkeiten des Servers installieren:** im Ordner `<Projektordner>/mcp` einmalig `npm install`.
3. **Server in deiner KI-Anwendung eintragen** – passend zu dem Programm, in dem du gerade läufst
   (Einträge für Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, LM Studio, Gemini CLI, Codex stehen in
   `ANLEITUNG.md`). Gebraucht wird immer nur:
   - Name `openmol`, Befehl = vollständiger Pfad zu `node`, Argument = vollständiger Pfad zu `mcp/server.mjs`, **oder**
   - (für Programme, die nur eine URL kennen) den HTTP-Server mit `npm run start:http` im Ordner `mcp` starten und
     die URL `http://127.0.0.1:5182/mcp` eintragen.
   - Kleine lokale Modelle bzw. Programme mit Werkzeug-Obergrenze: Argument `--tools=basic` anhängen
     (20 statt 39 Werkzeuge).
   - Beispiel Claude Desktop (`claude_desktop_config.json`; Mac: `~/Library/Application Support/Claude/`,
     Windows: `%APPDATA%\Claude\`):
     ```json
     { "mcpServers": { "openmol": { "command": "<Pfad zu node>", "args": ["<Projektordner>/mcp/server.mjs"] } } }
     ```
   - Beispiel Claude Code: `claude mcp add openmol -- "<Pfad zu node>" "<Projektordner>/mcp/server.mjs"`
4. **Vorsicht bei Konfigurationsdateien:** vorher eine Sicherungskopie anlegen, nur den Eintrag `openmol` ergänzen,
   vorhandene Einträge nicht verändern, gültiges JSON/TOML erhalten (Windows-Pfade in JSON mit `\\` oder `/`).
5. **KI-Anwendung neu starten** (bzw. MCP-Server neu laden) – sag mir, wann das nötig ist.
6. **In OpenMol erlauben:** die OpenMol-Desktop-App starten → Einstellungen (Zahnrad oben rechts, Mac: ⌘, ,
   Windows: Strg+,) → „KI-Steuerung (MCP)“ → **Erlauben**. Oben rechts erscheint „● KI“, sobald die Verbindung
   steht. Die Einstellung bleibt gespeichert.
7. **Testen:** das Werkzeug `get_document` aufrufen. Danach zur Probe mit `insert_structure` Aspirin einfügen
   (`CC(=O)Oc1ccccc1C(=O)O`) und mit `get_image` prüfen, dass es zu sehen ist; anschließend mit `undo` wieder entfernen.

## Wenn du selbst nichts einrichten kannst
Falls du keine Befehle ausführen oder Dateien ändern kannst (z. B. in einem reinen Chat-Fenster): führe mich
Schritt für Schritt durch die Schritte oben, mit genau den Einträgen für mein Programm, und warte jeweils auf meine
Rückmeldung. Webdienste ohne Zugriff auf diesen Rechner (z. B. ChatGPT im Browser) können sich nicht verbinden – sag
mir das dann ehrlich.

## Häufige Fehler
- „OpenMol ist nicht verbunden“: App nicht geöffnet oder „KI-Steuerung (MCP)“ nicht erlaubt (Schritt 6).
- Werkzeuge `openmol` fehlen: Eintrag falsch (Pfade prüfen) oder KI-Anwendung nicht neu gestartet.
- `Cannot find module …`: `npm install` im Ordner `mcp` vergessen.
- `node` nicht gefunden: vollständigen Pfad zu `node` eintragen statt nur `node`.
- Port 5181 belegt: läuft bereits ein OpenMol-Server einer anderen KI-Anwendung, ist das in Ordnung – der zweite
  Server leitet seine Befehle automatisch weiter.

## Danach
Bestätige mir kurz, dass die Verbindung steht und welche Werkzeuge verfügbar sind. Beim Arbeiten mit OpenMol: erst
`get_document` lesen, nach größeren Änderungen mit `get_image` kontrollieren; Strukturen als SMILES oder
`name:<englischer Name/CAS>`; Koordinaten: x nach rechts, y nach unten, eine Bindung ≈ 40 Einheiten.
