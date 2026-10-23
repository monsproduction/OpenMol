# OpenMol mit einer KI steuern (MCP)

OpenMol bringt einen MCP-Server mit (Model Context Protocol – offener Standard für KI-Werkzeuge). Damit kann jede
MCP-fähige KI-Anwendung die geöffnete App bedienen (im Browser oder die Desktop-App): Claude Desktop, Claude Code, Cursor, VS Code
(Copilot), Windsurf, LM Studio, Gemini CLI, Codex CLI und andere. Der Server reicht die Befehle an die App weiter
(nur lokal über `127.0.0.1:5181`). Alles, was die KI ändert, lässt sich in der App mit ⌘Z rückgängig machen.

## Einfachster Weg: mit der installierten Desktop-App

Der MCP-Server ist in der Desktop-App enthalten (ab Version 1.1.0); OpenMol führt ihn selbst aus, es braucht weder
diesen Projektordner noch Node.js. In OpenMol **Einstellungen → „KI-Anwendung verbinden“**:
- **Prompt für die KI kopieren** – in die KI-Anwendung einfügen; sie richtet alles ein (oder führt hindurch).
- **Konfiguration kopieren** – Eintrag `mcpServers` für Claude Desktop, Cursor, Windsurf, LM Studio, Gemini CLI.
- **Befehl für Claude Code** – im Terminal ausführen.

Die kopierten Texte enthalten die Pfade des eigenen Rechners (Programm = OpenMol selbst, dazu die
Umgebungsvariable `ELECTRON_RUN_AS_NODE=1`). Danach die KI-Anwendung neu starten.

## Einmalig einrichten (mit Projektordner)

**Tipp:** `PROMPT-KI-VERBINDEN.md` enthält einen fertigen Text für die KI – einfügen, Projektpfad ergänzen, die KI
erledigt die Einrichtung (oder führt Schritt für Schritt hindurch).

1. **Abhängigkeiten installieren** (im Terminal):
   ```
   cd "<Projektordner>/mcp"
   npm install
   ```
2. **In der KI-Anwendung eintragen** – siehe unten. Die meisten Programme starten den Server selbst (stdio).
3. **Die KI-Anwendung neu starten** bzw. die MCP-Server neu laden. Danach erscheint „openmol“ unter den Werkzeugen.

### Zwei Arten der Verbindung

| Art | Wann | Eintrag |
| --- | --- | --- |
| **stdio** (Standard) | Programm startet den Server selbst | Befehl `/opt/homebrew/bin/node` mit Argument `…/mcp/server.mjs` |
| **HTTP** | Programm kann nur eine URL eintragen | Server selbst starten (siehe unten), URL `http://127.0.0.1:5182/mcp` |

Den HTTP-Server startest du im Terminal und lässt das Fenster offen:
```
cd "<Projektordner>/mcp"
npm run start:http
```
(Anderer Port: `node server.mjs --http --port=5190`.) Der HTTP-Endpunkt ist nur auf diesem Rechner erreichbar.

### Weniger Werkzeuge

Der Server bietet 39 Werkzeuge. Kleinere lokale Modelle oder Programme mit Werkzeug-Obergrenze kommen mit der
**Grundausstattung** (20 Werkzeuge: Zeichnen, Reaktionen, Ansatztabellen, Export, Bild, Rückgängig) besser zurecht:
Argument `--tools=basic` anhängen bzw. Umgebungsvariable `OPENMOL_TOOLS=basic` setzen.

## Konfiguration je Programm

> Die Dateipfade und Schlüssel der fremden Programme entsprechen dem Stand bei Erstellung dieser Anleitung
> (Oktober 2026) und wurden nicht in jedem Programm ausprobiert. Wenn etwas nicht klappt: In der Dokumentation des
> Programms unter „MCP“ nachsehen – gebraucht werden immer nur **Befehl + Argument** (stdio) oder die **URL** (HTTP).

Pfad zum Server (überall gleich; `<Projektordner>` = Ordner, in dem dieses Projekt liegt):
`<Projektordner>/mcp/server.mjs`

**Claude Desktop** – *Einstellungen → Entwickler → Konfiguration bearbeiten*
(`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "openmol": {
      "command": "/opt/homebrew/bin/node",
      "args": ["<Projektordner>/mcp/server.mjs"]
    }
  }
}
```
(Stehen dort schon andere Einträge, nur den Block `"openmol": { … }` ergänzen.)

**Claude Code** – im Terminal:
```
claude mcp add openmol -- /opt/homebrew/bin/node "<Projektordner>/mcp/server.mjs"
```

**Cursor** – `~/.cursor/mcp.json` (für alle Projekte): gleicher Block wie bei Claude Desktop (`mcpServers`).
Per HTTP stattdessen: `"openmol": { "url": "http://127.0.0.1:5182/mcp" }`.

**VS Code (GitHub Copilot, Agent-Modus)** – `.vscode/mcp.json` im Projekt oder über den Befehl „MCP: Add Server“:
```json
{
  "servers": {
    "openmol": {
      "type": "stdio",
      "command": "/opt/homebrew/bin/node",
      "args": ["<Projektordner>/mcp/server.mjs"]
    }
  }
}
```
Per HTTP: `"openmol": { "type": "http", "url": "http://127.0.0.1:5182/mcp" }`.

**Windsurf** – `~/.codeium/windsurf/mcp_config.json`: gleicher Block wie bei Claude Desktop (`mcpServers`).
Per HTTP: `"openmol": { "serverUrl": "http://127.0.0.1:5182/mcp" }`.

**LM Studio** (lokale Modelle) – *Programm → Integrations/MCP → mcp.json bearbeiten*: gleicher Block wie bei
Claude Desktop (`mcpServers`). Ein Modell mit Werkzeug-Unterstützung wählen; bei kleinen Modellen `--tools=basic`
in `args` ergänzen.

**Gemini CLI** – `~/.gemini/settings.json`: gleicher Block wie bei Claude Desktop (`mcpServers`).
Per HTTP: `"openmol": { "httpUrl": "http://127.0.0.1:5182/mcp" }`.

**Codex CLI (OpenAI)** – `~/.codex/config.toml`:
```toml
[mcp_servers.openmol]
command = "/opt/homebrew/bin/node"
args = ["<Projektordner>/mcp/server.mjs"]
```

**Andere Programme**: Jedes Programm, das lokale MCP-Server unterstützt, braucht dieselben Angaben – Befehl
`/opt/homebrew/bin/node` und Argument `…/mcp/server.mjs` – oder die URL `http://127.0.0.1:5182/mcp`.

**ChatGPT im Browser / Webdienste** können sich nicht mit einem Server auf deinem Rechner verbinden (sie brauchen
eine öffentlich erreichbare HTTPS-Adresse). Das ist bewusst nicht eingerichtet.

**Testen ohne KI**: Mit dem MCP Inspector (`npx @modelcontextprotocol/inspector`) lassen sich die Werkzeuge
von Hand aufrufen – Transport „Streamable HTTP“, URL `http://127.0.0.1:5182/mcp`.

## Benutzen

1. OpenMol öffnen – im Browser (z. B. `http://localhost:5173`) oder die Desktop-App.
2. In der App **Einstellungen** (Zahnrad oben rechts oder ⌘,) → „KI-Steuerung (MCP)“ → **Erlauben**.
   Oben rechts zeigt „● KI“ (grün), dass die Verbindung steht.
3. In der KI-Anwendung z. B. schreiben:
   - „Zeichne in OpenMol die Suzuki-Kupplung von 4-Bromanisol mit Phenylboronsäure zu 4-Methoxybiphenyl,
     Bedingungen Pd(PPh3)4 (5 mol%), K2CO3 (2.0 equiv), Toluol/H2O, 90 °C, 16 h.“
   - „Leg eine Ansatztabelle an: 1,87 g 4-Bromanisol, 1,2 Äq. Boronsäure.“
   - „Zeig mir die Zeichnung.“ (Die KI bekommt eine Textbeschreibung und ein Bild der aktuellen Zeichnung.)

Beim Verbinden erhält jede KI eine kurze Gebrauchsanweisung (Koordinaten, Bindungslänge, Strukturangabe als SMILES
oder `name:…`, Rich-Text), damit auch KIs ohne Vorwissen über OpenMol gleich richtig arbeiten.

## Werkzeuge

**Grundausstattung (20, auch mit `--tools=basic`):** `get_document`, `get_image`, `new_document`,
`insert_structure` (SMILES oder `name:…` über PubChem), `draw_reaction`, `add_text`, `add_arrow`, `move_object`,
`delete_objects`, `clean_reaction`, `clean_structures`, `contract_groups`, `create_stoich_table`, `set_stoich_row`,
`add_stoich_row`, `set_reaction_conditions`, `export` (svg, cdxml, molfile, smiles), `set_style`, `undo`, `redo`.

**Zusätzlich im Vollzugriff (19):** `add_curved_arrow` (Mechanismuspfeile, auch Halbpfeil), `add_shape` (Rechteck,
Ellipse, Kugel, Klammern …), `add_catalytic_cycle` (Stationen mit Text oder Struktur, Zu-/Abflüsse,
Schrittbezeichnungen), `insert_template` / `list_templates`, `set_atoms` (Element, Label, Ladung, freie
Elektronenpaare, Farbe, Hervorhebung …), `set_bonds` (Typ, Keil-Richtung, Farbe …), `fill_rings` /
`remove_ring_fills`, `set_colors`, `set_document_style`, `select`, `select_all`, `clear_selection`, `run_action`
(Drehen, Spiegeln, Ausrichten, 3D, Scheren, Nummerieren, Polymer-/Ringklammern, Ebenen, Fett, Duplizieren, Löschen,
Aufräumen, Kürzel bilden, Zyklen anpassen/verbinden/andocken), `get_molecule`, `get_document_json`,
`get_data_model`, `edit_objects` (jedes Objekt anlegen/ändern/löschen – damit ist alles erreichbar, was im
Datenmodell steht).

Nach einer Erweiterung der Werkzeuge muss die KI-Anwendung neu gestartet werden (bzw. der HTTP-Server), damit die
neuen Werkzeuge sichtbar werden.

## Hinweise

- Die App muss geöffnet und die KI-Steuerung erlaubt sein; sonst meldet die KI „OpenMol ist nicht verbunden“.
- Anderer Port für die Brücke: in der Konfiguration `"env": { "OPENMOL_PORT": "5191" }` setzen (dann aber auch
  die App anpassen – Standard ist 5181).
- Namen → Struktur laufen über PubChem (online, englische Namen am zuverlässigsten).
- Brücke und HTTP-Endpunkt nehmen nur Anfragen von diesem Rechner (`localhost`) an.
- Sind mehrere KI-Anwendungen gleichzeitig offen, startet jede einen eigenen OpenMol-Server. Der erste übernimmt die
  Brücke, die weiteren reichen ihre Befehle an ihn weiter – alle können die App steuern.
