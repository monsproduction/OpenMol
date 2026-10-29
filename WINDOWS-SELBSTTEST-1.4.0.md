# OpenMol 1.4.0 unter Windows selbst testen

Diese Anleitung ist für dich, ohne Windows-Claude und ohne Programmierkenntnisse. Der Installer wurde auf dem Mac gebaut und
**noch nie unter Windows gestartet**. Genau das prüfst du jetzt. Dauer: etwa 45 Minuten, Teil 1 bis 3 reichen für einen ersten
Eindruck (15 Minuten).

**So notierst du Ergebnisse:** Hinter jeden Punkt ✅ (klappt) oder ❌ (klappt nicht). Bei ❌ kurz aufschreiben, was passiert ist,
und ein Bildschirmfoto machen (**Windows-Taste + Umschalt + S**). Die Liste mit Fotos gibst du mir danach, dann behebe ich es.

---

## 1. Installieren oder aktualisieren (5 Minuten)

**Fall A – OpenMol 1.3.2 ist schon installiert** (testet auch die Update-Funktion):

- [ ] OpenMol 1.3.2 starten → Menü **Hilfe ▸ Nach Updates suchen**. Erwartet: Version 1.4.0 wird gefunden und heruntergeladen. Nach dem
  Neustart zeigt **Hilfe ▸ Über OpenMol** die Version 1.4.0.
- Falls das nicht klappt: ❌ notieren und weiter mit Fall B.

**Fall B – neu installieren:**

- [ ] Auf GitHub (Release „OpenMol 1.4.0“) die Datei **OpenMol-Setup-1.4.0.exe** herunterladen und doppelklicken.
- [ ] Windows warnt („Der Computer wurde durch Windows geschützt“). Das ist normal, weil der Installer kein gekauftes Zertifikat hat:
  **„Weitere Informationen“ ▸ „Trotzdem ausführen“**.
- [ ] Installation durchklicken. Danach liegt OpenMol im Startmenü und auf dem Desktop, und es startet.
- [ ] **Hilfe ▸ Über OpenMol** zeigt Version 1.4.0, dazu deine Angaben unter „Impressum“.

## 2. Das Wichtigste aus dem letzten Windows-Test (5 Minuten)

Diese Fehler gab es früher schon einmal. Sie dürfen nicht wiederkommen.

- [ ] Die Menüs sind **auf Deutsch**. Fenster-Menü: „Minimieren“; Datei-Menü: „Beenden“.
- [ ] **Strg + Plus** vergrößert, **Strg + Minus** verkleinert die Ansicht.
- [ ] Ein Molekül zeichnen, z. B. Benzol mit Taste **J** und Klick. Mit **Strg+C** kopieren und in **Word** mit Strg+V einfügen. In
  Word das Bild anklicken, Strg+C, zurück zu OpenMol, Strg+V. Erwartet: Das Molekül kommt **als bearbeitbare Struktur** zurück, nicht
  als Bild.

## 3. Neue Funktionen kurz ansehen (10 Minuten)

- [ ] **Leere Zeichenfläche** (Datei ▸ Neu): Unten stehen „Zuletzt verwendet“ mit deinen letzten Dateien. Ein Klick öffnet die Datei.
- [ ] **Gleichgewichtspfeil** (Pfeil-Werkzeug, zweites Symbol oben) zeichnen. Er sieht aus wie in ChemDraw: zwei enge Linien, lange
  schlanke Halbspitzen.
- [ ] **Molekülgröße:** Molekül auswählen ▸ rechts im Inspektor „Atom ▸ Größe“ auf 150 %.
- [ ] **Farbverlauf:** Molekül auswählen ▸ „Farbe & Deckkraft ▸ Verlauf“. Ebenso „Textmarker-Verlauf“. Der Inspektor rechts lässt sich
  dabei **nicht seitlich verschieben** (kein waagerechter Rollbalken).
- [ ] **Einstellungen** (Strg + Komma): Das Fenster ist breit genug, kein waagerechter Rollbalken.
- [ ] **Sperren:** Molekül auswählen, **Strg+L**. Danach lässt es sich nicht mehr anklicken oder verschieben. Mit dem
  Bindungswerkzeug draufklicken: Unten erscheint der Hinweis „Gesperrt – …“, und darin steht **„Strg+Umschalt+L“** (nicht „⇧⌘L“).
  Mit **Strg+Umschalt+L** wird es wieder frei.
- [ ] **Gruppieren:** Molekül und Text auswählen, **Strg+G**. Beides bewegt sich nur noch zusammen. Strg+Umschalt+G löst die Gruppe.
- [ ] **Drucken:** **Strg+P** öffnet den Windows-Druckdialog. Die Vorschau zeigt die Zeichnung (Drucken selbst nicht nötig).
- [ ] **Lineale:** Inspektor ▸ Dokument-Stil ▸ „Lineale“ einschalten. Aus dem Lineal eine Hilfslinie in die Zeichenfläche ziehen und
  wieder zurück ins Lineal ziehen (verschwindet). Strg+Z holt sie zurück.
- [ ] **Hilfe** (Fragezeichen oben rechts): Unten links steht „Über OpenMol · Impressum · Datenschutz · Lizenzen“, und der Link
  funktioniert.

## 4. Word-Austausch mit den neuen Funktionen (10 Minuten)

- [ ] Ein Molekül auf **150 %** stellen, einen **Farbverlauf** geben, mit Strg+C nach Word kopieren und von dort zurück nach OpenMol
  (wie in Teil 2). Erwartet: Größe und Verlauf sind noch da.

**Word-Add-in** (nur falls schon einmal eingerichtet; sonst in OpenMol **Datei ▸ Word-Add-in einrichten …** und den Anweisungen
folgen, die Windows-Sicherheitsabfrage zum Zertifikat mit „Ja“ bestätigen). Word **normal** über das Startmenü öffnen:

- [ ] Im Reiter **Start** gibt es rechts die Gruppe „OpenMol“. Das eingefügte Molekülbild anklicken ▸ **„In OpenMol bearbeiten“**.
  OpenMol öffnet es. Etwas ändern ▸ oben **„Zurück nach Word“**. Erwartet: Das Bild in Word ist ersetzt.
- [ ] Das Bild in Word vorher **kleiner ziehen**, dann noch einmal bearbeiten. Erwartet: Nach „Zurück nach Word“ ist es wieder so
  klein wie vorher.
- [ ] Noch einmal „In OpenMol bearbeiten“, dann OpenMol **schließen, ohne** „Zurück nach Word“ zu klicken. Erwartet: In Word ist der
  Knopf „In OpenMol bearbeiten“ **sofort wieder klickbar**.
- [ ] Word-Datei speichern, Word schließen, Datei wieder öffnen, Bild noch einmal bearbeiten. Klappt es weiterhin?

## 5. Eigene Sammlungen in einem Cloud-Ordner (5 Minuten)

- [ ] **Einstellungen ▸ Eigene Sammlungen ▸ Ordner wählen** und einen Ordner in **OneDrive** wählen. Ein Molekül auswählen ▸
  „Zur Bibliothek hinzufügen“. Erwartet: Im OneDrive-Ordner liegt eine Datei „OpenMol-Sammlungen.json“.
- [ ] Optional: einen Ordner mit Umlauten oder Leerzeichen im Namen wählen (z. B. „Chemie Übung“). Speichern klappt.

## 6. Darstellung (5 Minuten)

- [ ] Windows-Einstellungen ▸ System ▸ Bildschirm ▸ **Skalierung** einmal auf **125 %** und einmal auf **150 %** stellen und OpenMol
  ansehen. Alles lesbar, nichts abgeschnitten, rechts kein waagerechter Rollbalken, genug Platz zum Zeichnen.
- [ ] Oberfläche auf **Englisch** stellen (Einstellungen ▸ Sprache). Menüs, Tooltips und Hinweise sind englisch.

## 7. Zum Schluss

- [ ] Optional: OpenMol über Windows-Einstellungen ▸ Apps **deinstallieren** und wieder installieren. Erwartet: Deine eigenen Sammlungen
  und Einstellungen sind danach noch da.

**Bekannt und kein Fehler:** die SmartScreen-Warnung beim Installieren (Teil 1) und die Windows-Sicherheitsabfrage beim Einrichten
des Word-Add-ins.
