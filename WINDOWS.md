# OpenMol unter Windows

Stand: 2026-10-25 (OpenMol 1.3.2). Die Windows-Version wird auf dem Mac gebaut und ist dort geprüft, soweit das ohne
Windows geht – **auf Windows selbst getestet ist sie noch nicht.** Neu in 1.3.2 und besonders zu prüfen: der
Austausch mit Word (Abschnitt C). Der Windows-Installer liegt diesmal **nicht** auf GitHub – bitte selbst bauen
(Abschnitt B).

## A) Installieren

1. `OpenMol Setup <Version>.exe` doppelklicken (selbst gebaut, siehe B).
2. Windows zeigt vermutlich eine SmartScreen-Warnung („Der Computer wurde durch Windows geschützt“), weil die App
   nicht mit einem gekauften Zertifikat signiert ist: **„Weitere Informationen“ → „Trotzdem ausführen“**.
3. Installationsordner wählen (Standard: nur für den aktuellen Benutzer) → Fertig. OpenMol liegt danach im Startmenü
   und auf dem Desktop.

Einstellungen und Daten liegen in `%APPDATA%\OpenMol\` (`settings.json`, `library.json`, `autosave.json`, Ordner
`word-addin`); Menü Hilfe ▸ „Einstellungsordner zeigen“.

## B) Selbst bauen

1. **Node.js** installieren: <https://nodejs.org> → Version „LTS“ (Installer mit Standardeinstellungen).
   Für `git clone` außerdem **Git**: <https://git-scm.com> (oder auf GitHub „Code ▸ Download ZIP“).
2. Eingabeaufforderung (cmd) oder PowerShell öffnen:

   ```
   git clone https://github.com/monsproduction/OpenMol.git
   cd OpenMol
   npm install
   ```

3. **Zwischenablage-Test** (schnellster Hinweis, ob der Word-Datenweg unter Windows klappt – überschreibt kurz die
   Zwischenablage):

   ```
   npm run test:clipboard
   ```

   Erwartet: alle Zeilen `OK` und am Ende „Zwischenablage-Test bestanden“. Die Zeile „Weg: …“ zeigt, wie geschrieben
   wurde: `win-both` = Bild für alle Programme **und** Daten für Office (bestes Ergebnis); `win-raw-only` = nur das
   Office-Format „PNG“ (Word geht, Paint & Co. sehen evtl. kein Bild). Die ganze Ausgabe bitte aufheben.
4. Installer bauen:

   ```
   npm run app:build:win
   ```

   Ergebnis: `release\OpenMol Setup <Version>.exe`, danach wie in A installieren.
5. Zum Entwickeln mit Live-Neuladen: `npm run app` (Desktop-App) bzw. `npm run dev` (im Browser,
   <http://localhost:5173>).

## C) Austausch mit Word (neu, ungetestet)

**Was eingebaut ist:**

- **Strg+C** in OpenMol legt ein PNG ab, in dem die Zeichnung steckt (Textblock „openmol“) – unter Windows sowohl als
  normales Bild als auch im Office-Format „PNG“.
- **Word-Add-in** „In OpenMol bearbeiten“: OpenMol liefert es selbst über `https://localhost:5185` aus. Einrichten über
  **Datei ▸ Word-Add-in einrichten …**. Das macht drei Dinge:
  1. Zertifikat nur für `localhost` erzeugen (mit Node, kein openssl nötig; keine Zertifizierungsstelle – es kann
     nichts anderes beglaubigen). Liegt in `%APPDATA%\OpenMol\word-addin\`.
  2. Das Add-in bei Word eintragen: Manifest `%APPDATA%\OpenMol\word-addin\OpenMol-Word-Addin.xml` plus Registry-Wert
     unter `HKEY_CURRENT_USER\Software\Microsoft\Office\16.0\WEF\Developer` (Name und Wert = Pfad des Manifests; so
     trägt auch Microsofts Entwicklerwerkzeug Add-ins ein).
  3. „Vertrauen …“: trägt das Zertifikat mit `certutil -user -addstore Root …` in die Zertifikate **deines Benutzers**
     ein. Windows zeigt dabei eine **Sicherheitswarnung** („Möchten Sie dieses Zertifikat installieren?“) – mit
     **„Ja“** bestätigen. Diesen Schritt machst du selbst; OpenMol löst nur den Befehl aus.

**Voraussetzung:** Word aus Microsoft 365 bzw. Office 2021 oder neuer (Add-ins laufen dort in Microsoft Edge
WebView2). Ältere Office-Versionen (2016/2019) zeigen Add-ins mit älteren Browser-Engines – dort wird es
wahrscheinlich nicht laufen.

### Test-Schritte

1. [ ] `npm run test:clipboard` (siehe B.3) – Ergebnis notieren.
2. [ ] OpenMol starten, etwas zeichnen, markieren, **Strg+C**, in Word **Strg+V** → Bild erscheint.
3. [ ] Das Bild in Word anklicken, **Strg+C**, in OpenMol **Strg+V** → kommt als **bearbeitbare Struktur** zurück
       (Meldung „Als bearbeitbare Struktur eingefügt“). Wenn nur ein Bild bzw. nichts eingefügt wird: Word hat die
       Daten verloren – bitte notieren.
4. [ ] Strg+C in OpenMol, dann in Paint (oder Teams/Outlook) Strg+V → Bild erscheint (prüft das normale Bild für andere
       Programme).
5. [ ] OpenMol: **Datei ▸ Word-Add-in einrichten …** → Dialog „Windows muss dem OpenMol-Zertifikat einmal vertrauen“ →
       **„Vertrauen …“** → Windows-Sicherheitswarnung mit **„Ja“** bestätigen → Meldung „Fertig – das Word-Add-in ist
       eingerichtet.“
6. [ ] Word ganz beenden und neu starten. Im Reiter **Start** erscheint rechts die Gruppe „OpenMol“ mit
       **„In OpenMol bearbeiten“**. Falls nicht: Reiter **Einfügen** ▸ „Add-Ins abrufen“ bzw. „Meine Add-Ins“ ▸
       Registerkarte/Bereich **„Entwickler-Add-Ins“** ▸ „OpenMol“. (Wo genau Word Entwickler-Add-ins anzeigt, ist unter
       Windows ungeprüft.)
7. [ ] In Word das OpenMol-Bild anklicken → „In OpenMol bearbeiten“ → Seitenleiste zeigt „Verbunden mit OpenMol 1.3.2“
       → OpenMol kommt nach vorn mit Tab „Aus Word“. (Kommt das Fenster nicht nach vorn, sondern blinkt nur in der
       Taskleiste: bitte notieren.)
8. [ ] In OpenMol etwas ändern → oben **„Zurück nach Word“** → in Word wird das Bild ersetzt, Größe bleibt gleich.
9. [ ] Dasselbe Bild **ein zweites Mal** bearbeiten (Schritt 7–8) – klappt auch das?
10. [ ] Word-Datei speichern, schließen, wieder öffnen → Bild noch einmal bearbeiten.

### Wenn etwas nicht klappt

- **Add-in taucht in Word nicht auf:** prüfen, ob der Registry-Wert existiert:
  `reg query HKCU\Software\Microsoft\Office\16.0\WEF\Developer`. Word-Add-in-Zwischenspeicher leeren: Word beenden,
  Ordner `%LOCALAPPDATA%\Microsoft\Office\16.0\Wef\` löschen, Word neu starten.
  Ausweg, falls der Registry-Weg nicht greift (Microsofts zweiter Weg zum Testen): Ordner mit dem Manifest freigeben
  (Rechtsklick ▸ Eigenschaften ▸ Freigabe), in Word ▸ Datei ▸ Optionen ▸ Trust Center ▸ Einstellungen für das Trust
  Center ▸ Kataloge vertrauenswürdiger Add-Ins ▸ die Freigabe `\\RECHNERNAME\word-addin` eintragen, „Im Menü
  anzeigen“ anhaken, Word neu starten → Einfügen ▸ Meine Add-Ins ▸ „Freigegebener Ordner“.
- **Seitenleiste meldet „OpenMol antwortet nicht“ oder bleibt leer/zeigt einen Zertifikatfehler:** läuft OpenMol? Im
  Browser (Edge) `https://localhost:5185/api/ping` öffnen – erscheint `{"ok":true,…}` ohne Warnung, ist das Zertifikat
  vertraut. Zertifikat prüfen: `certmgr.msc` ▸ Vertrauenswürdige Stammzertifizierungsstellen ▸ Zertifikate ▸
  „OpenMol localhost“.
- **Meldung „Anschluss 5185 belegt“:** ein anderes Programm (oder eine zweite OpenMol-Instanz) nutzt den Anschluss.

### Wieder entfernen

```
reg delete HKCU\Software\Microsoft\Office\16.0\WEF\Developer /v "%APPDATA%\OpenMol\word-addin\OpenMol-Word-Addin.xml" /f
```

(löscht nur den OpenMol-Eintrag; bei Abweichungen den genauen Namen mit `reg query` nachsehen), Zertifikat in `certmgr.msc` unter „Vertrauenswürdige
Stammzertifizierungsstellen“ ▸ „OpenMol localhost“ löschen, Ordner `%APPDATA%\OpenMol\word-addin` löschen.

### Prompt für Claude Code auf dem Windows-Rechner

Projektordner in Claude Code öffnen und z. B. einfügen:

> Das ist OpenMol (ChemDraw-Nachbau, Electron-App). Auf dem Mac funktioniert der Austausch mit Word: Strg/⌘+C legt
> ein PNG mit den Zeichnungsdaten (tEXt-Block „openmol“, „OM1:…“) ab, und ein Word-Add-in (electron/wordAddin.mjs,
> electron/addin/) öffnet markierte Bilder in OpenMol und ersetzt sie danach. Die Windows-Teile sind eingebaut, aber
> ungetestet: electron/clipboard.mjs (writePng: Rohformat „PNG“ plus image/png, mit Rücklese-Prüfung),
> electron/selfsignedCert.mjs (Zertifikat ohne openssl), electron/wordAddin.mjs (certutil, Registry WEF\Developer,
> PowerShell Test-Path). Bitte gehe mit mir die Test-Schritte in WINDOWS.md Abschnitt C durch, führe
> `npm run test:clipboard` aus und behebe, was unter Windows nicht klappt. Sicherheitseinstellungen (Zertifikat
> vertrauen) bestätige ich selbst.

## Allgemeine Test-Checkliste

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
- Word-Add-in: nur Bilder im Text (nicht frei schwebend); ein Doppelklick auf das Bild öffnet OpenMol nicht (dafür
  bräuchte es OLE wie bei ChemDraw) – stattdessen der Knopf „In OpenMol bearbeiten“.
- Wird das Zertifikat erneuert (30 Tage vor Ablauf, nach gut 2 Jahren), bleibt das alte in der Windows-Liste stehen,
  bis es abläuft (harmlos; kann in `certmgr.msc` gelöscht werden).
