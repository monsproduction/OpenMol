// Einrichtung der KI-Steuerung für die installierte Desktop-App: Konfiguration, Befehl und Prompt mit den Pfaden
// dieses Rechners. Der MCP-Server liegt in der App; OpenMol führt ihn selbst aus (ELECTRON_RUN_AS_NODE=1), es wird
// also weder der Projektordner noch ein eigenes Node.js gebraucht.
import type { McpInfo } from './desktop'

/** Eintrag für Programme mit „mcpServers“-Datei (Claude Desktop, Cursor, Windsurf, LM Studio, Gemini CLI) */
export function mcpConfigJson(info: McpInfo): string {
  return JSON.stringify({ mcpServers: { openmol: { command: info.command, args: [info.server], env: info.env } } }, null, 2)
}

/** Claude Code (Terminal): für alle Projekte (--scope user) */
export function claudeCodeCommand(info: McpInfo): string {
  const env = Object.entries(info.env)
    .map(([k, v]) => `--env ${k}=${v}`)
    .join(' ')
  return `claude mcp add ${env} --transport stdio --scope user openmol -- "${info.command}" "${info.server}"`
}

/** Codex CLI (~/.codex/config.toml); Pfade als TOML-Literale (keine Escapes nötig, auch für Windows-Pfade) */
function codexToml(info: McpInfo): string {
  const env = Object.entries(info.env)
    .map(([k, v]) => `${k} = "${v}"`)
    .join(', ')
  return `[mcp_servers.openmol]\ncommand = '${info.command}'\nargs = ['${info.server}']\nenv = { ${env} }`
}

/** VS Code (.vscode/mcp.json bzw. „MCP: Add Server“) – eigener Aufbau mit „servers“ und „type“ */
function vscodeJson(info: McpInfo): string {
  return JSON.stringify({ servers: { openmol: { type: 'stdio', command: info.command, args: [info.server], env: info.env } } }, null, 2)
}

/** Text für eine KI: richtet die Verbindung ein (oder führt Schritt für Schritt hindurch) und prüft sie */
export function mcpPrompt(info: McpInfo, lang: 'de' | 'en', platform: string): string {
  const win = platform === 'win32'
  const claudeCfg = win ? '%APPDATA%\\Claude\\claude_desktop_config.json' : '~/Library/Application Support/Claude/claude_desktop_config.json'
  const block = (s: string, l = '') => '```' + l + '\n' + s + '\n```'
  if (lang === 'en')
    return `Please set up the connection between you and **OpenMol** and check that it works.

OpenMol is a desktop app for drawing chemical structures, reactions and mechanisms. It ships with an **MCP server**
(Model Context Protocol). Through it you can read and edit the open drawing: insert structures (SMILES or
\`name:<English name or CAS number>\`), draw reactions, create stoichiometry tables, export, and get an image of the drawing.

The MCP server is part of the installed app; OpenMol itself runs it (environment variable ELECTRON_RUN_AS_NODE=1),
so **no separate Node.js and no project folder** are needed. Everything stays on this computer (OpenMol and the server
talk to each other locally via 127.0.0.1).

**Program:** \`${info.command}\`
**Server file:** \`${info.server}\`
**Environment:** \`ELECTRON_RUN_AS_NODE=1\` (required)

Steps:
1. Add the server to the AI application you are running in – only add the \`openmol\` entry, keep existing entries,
   make a backup of the configuration file first.
   - Claude Desktop (\`${claudeCfg}\`), Cursor (\`~/.cursor/mcp.json\`), Windsurf, LM Studio, Gemini CLI:
${block(mcpConfigJson(info), 'json')}
   - Claude Code (terminal):
${block(claudeCodeCommand(info))}
   - VS Code (GitHub Copilot):
${block(vscodeJson(info), 'json')}
   - Codex CLI (\`~/.codex/config.toml\`):
${block(codexToml(info), 'toml')}
   - Other programs: same values – command, argument and the environment variable.
2. Restart the AI application (or reload its MCP servers) – tell me when that is needed.
3. In OpenMol: Settings → "AI control (MCP)" → **Allow** (already done if this text was copied from there).
   "● AI" appears at the top right as soon as the connection is up.
4. Test: call \`get_document\`, then insert aspirin with \`insert_structure\` (\`CC(=O)Oc1ccccc1C(=O)O\`), check it with
   \`get_image\` and remove it again with \`undo\`.

If you cannot run commands or edit files yourself, guide me step by step and wait for my reply each time.
Web services without access to this computer cannot connect – please tell me honestly in that case.

When working with OpenMol: read \`get_document\` first, check larger changes with \`get_image\`; coordinates: x to the
right, y downwards, one bond ≈ 40 units.`
  return `Bitte richte die Verbindung zwischen dir und **OpenMol** ein und prüfe, dass sie funktioniert. Antworte auf Deutsch.

OpenMol ist eine Desktop-App zum Zeichnen chemischer Strukturen, Reaktionen und Mechanismen. Sie bringt einen
**MCP-Server** mit (Model Context Protocol). Über ihn kannst du die geöffnete Zeichnung lesen und bearbeiten: Strukturen
einfügen (SMILES oder \`name:<englischer Name oder CAS-Nummer>\`), Reaktionen zeichnen, Ansatztabellen anlegen,
exportieren und ein Bild der Zeichnung abrufen. Alles lässt sich in OpenMol rückgängig machen.

Der MCP-Server ist Teil der installierten App; OpenMol führt ihn selbst aus (Umgebungsvariable ELECTRON_RUN_AS_NODE=1),
es wird also **kein eigenes Node.js und kein Projektordner** gebraucht. Alles bleibt auf diesem Rechner (OpenMol und
der Server sprechen lokal über 127.0.0.1 miteinander).

**Programm:** \`${info.command}\`
**Server-Datei:** \`${info.server}\`
**Umgebung:** \`ELECTRON_RUN_AS_NODE=1\` (unbedingt nötig)

Schritte:
1. Den Server in der KI-Anwendung eintragen, in der du gerade läufst – nur den Eintrag \`openmol\` ergänzen,
   vorhandene Einträge nicht verändern, vorher eine Sicherungskopie der Konfigurationsdatei anlegen.
   - Claude Desktop (\`${claudeCfg}\`), Cursor (\`~/.cursor/mcp.json\`), Windsurf, LM Studio, Gemini CLI:
${block(mcpConfigJson(info), 'json')}
   - Claude Code (Terminal):
${block(claudeCodeCommand(info))}
   - VS Code (GitHub Copilot):
${block(vscodeJson(info), 'json')}
   - Codex CLI (\`~/.codex/config.toml\`):
${block(codexToml(info), 'toml')}
   - Andere Programme: dieselben Angaben – Befehl, Argument und die Umgebungsvariable.
2. Die KI-Anwendung neu starten (bzw. MCP-Server neu laden) – sag mir, wann das nötig ist.
3. In OpenMol: Einstellungen → „KI-Steuerung (MCP)“ → **Erlauben** (schon erledigt, wenn dieser Text von dort kopiert
   wurde). Oben rechts erscheint „● KI“, sobald die Verbindung steht.
4. Testen: \`get_document\` aufrufen, dann mit \`insert_structure\` Aspirin einfügen (\`CC(=O)Oc1ccccc1C(=O)O\`), mit
   \`get_image\` prüfen und mit \`undo\` wieder entfernen.

Wenn du selbst keine Befehle ausführen oder Dateien ändern kannst: führe mich Schritt für Schritt hindurch und warte
jeweils auf meine Rückmeldung. Webdienste ohne Zugriff auf diesen Rechner können sich nicht verbinden – sag mir das
dann ehrlich.

Beim Arbeiten mit OpenMol: erst \`get_document\` lesen, nach größeren Änderungen mit \`get_image\` kontrollieren;
Koordinaten: x nach rechts, y nach unten, eine Bindung ≈ 40 Einheiten.`
}
