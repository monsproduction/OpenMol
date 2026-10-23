# OpenMol unter Windows

Stand: 2026-10-22. Die Windows-Version ist vorbereitet und der Installer wurde bereits auf dem Mac gebaut –
**auf Windows getestet ist sie noch nicht.** Bitte die Checkliste unten durchgehen.

## A) Sofort ausprobieren (ohne selbst zu bauen)

1. `OpenMol Setup 1.1.0.exe` auf den Windows-Rechner kopieren und doppelklicken.
2. Windows zeigt vermutlich eine SmartScreen-Warnung („Der Computer wurde durch Windows geschützt“), weil die App
   nicht mit einem gekauften Zertifikat signiert ist: **„Weitere Informationen“ → „Trotzdem ausführen“**.
3. Installationsordner wählen (Standard: nur für den aktuellen Benutzer) → Fertig. OpenMol liegt danach im Startmenü
   und auf dem Desktop.

Einstellungen und Daten liegen in `%APPDATA%\OpenMol\` (`settings.json`, `library.json`, `autosave.json`);
Menü Hilfe ▸ „Einstellungsordner zeigen“.

## B) Selbst bauen bzw. weiterentwickeln

1. **Node.js** installieren: <https://nodejs.org> → Version „LTS“ (Installer mit Standardeinstellungen).
2. Den Ordner `OpenMol-Projekt` auf den Windows-Rechner kopieren (z. B. nach `C:\Users\<Name>\OpenMol`).
3. Eingabeaufforderung (cmd) oder PowerShell in diesem Ordner öffnen und einmalig ausführen:

   ```
   npm install
   ```

4. Installer bauen:

   ```
   npm run app:build:win
   ```

   Ergebnis: `release\OpenMol Setup <Version>.exe`.
5. Zum Entwickeln mit Live-Neuladen: `npm run app` (Desktop-App) bzw. `npm run dev` (im Browser,
   <http://localhost:5173>).

Mit **Claude Code auf dem Windows-Rechner** (Projektordner öffnen) kann Claude dort direkt bauen, Fehler beheben und
testen.

## Test-Checkliste

- [ ] Installieren, Starten, Fenster und Symbol (Taskleiste, Startmenü, Desktop) sehen richtig aus
- [ ] Menüleiste im Fenster: Datei, Bearbeiten, Struktur, Darstellung, Fenster, Hilfe; Kürzel werden als „Strg+…“ angezeigt
- [ ] Hinweise/Tooltips in der App zeigen „Strg“/„Umschalt“ statt ⌘/⇧ (z. B. „Speichern (Strg+S)“)
- [ ] Zeichnen, Kopieren/Einfügen (Strg+C/V), Rückgängig (Strg+Z), Duplizieren (Strg+D)
- [ ] Strg+Umschalt+K (Struktur aufräumen), Strg+Umschalt+X (Reaktion aufräumen), Strg+Umschalt+D (2D ↔ 3D)
- [ ] Strg+Alt+Umschalt+F/B (Ebene vor/zurück) – auf deutschen Tastaturen kann Strg+Alt wie AltGr wirken; bitte prüfen
- [ ] Speichern (Strg+S): beim ersten Mal Dialog, danach ohne Dialog in dieselbe Datei; Fenstertitel zeigt „*“ bei
      ungesicherten Änderungen
- [ ] Speichern unter (Strg+Umschalt+S), Öffnen (Strg+O), Exportieren (PNG, SVG, Molfile, CDXML)
- [ ] Doppelklick auf eine `.openmol`-Datei im Explorer öffnet OpenMol (auch wenn OpenMol schon läuft)
- [ ] Datei ins Fenster ziehen öffnet sie (auch `.cdxml` aus ChemDraw)
- [ ] Schließen mit ungesicherten Änderungen fragt „Sichern / Nicht sichern / Abbrechen“
- [ ] Einstellungen (Sprache, Inspektor-Reihenfolge …) bleiben nach Neustart erhalten
- [ ] Name/CAS → Struktur (z. B. `50-78-2`), PubChem-Suche, 3D (Strg+Umschalt+D) funktionieren (Internet nötig)
- [ ] KI-Steuerung: Einstellungen → „Prompt für die KI kopieren“ → in eine KI-Anwendung (z. B. Claude Desktop) einfügen,
      neu starten → die KI kann die Zeichnung lesen (`get_document`) und ändern
- [ ] Deinstallieren über „Apps & Features“

Auffälligkeiten bitte notieren (am besten mit Screenshot) – dann machen wir dort weiter.

## KI-Steuerung (MCP) unter Windows

Der MCP-Server ist in der App enthalten (ab 1.1.0) – **kein Node.js und kein Projektordner nötig**:
In OpenMol Einstellungen → „KI-Anwendung verbinden“ → **„Prompt für die KI kopieren“** (oder „Konfiguration
kopieren“ / „Befehl für Claude Code“), in die KI-Anwendung einfügen, KI-Anwendung neu starten. Die Texte enthalten
die Pfade dieses Rechners (Programm = `OpenMol.exe`, Server = `…\resources\mcp\server.mjs`, Umgebungsvariable
`ELECTRON_RUN_AS_NODE=1`).

Claude Desktop liest seine Einstellungen unter Windows aus `%APPDATA%\Claude\claude_desktop_config.json`
(Pfad laut Claude-Dokumentation, unter Windows noch nicht geprüft). Auf dem Mac ist dieser Weg mit der fertigen App
getestet, **unter Windows noch nicht** – siehe Checkliste.

## Bekannte offene Punkte

- Nicht signiert → SmartScreen-Hinweis beim ersten Start (Code-Signing-Zertifikat kostet Geld; für den Eigengebrauch nicht nötig).
- Nur 64-Bit-Intel/AMD (x64); läuft auf Windows-ARM-Rechnern über die Emulation.
- `.cdxml`-Dateien werden unter Windows bewusst nicht mit OpenMol verknüpft (damit ChemDraw Standard bleibt) –
  öffnen über Datei ▸ Öffnen oder Ziehen ins Fenster.
- Mehrere Fenster gleichzeitig: noch nicht (wie auf dem Mac).
