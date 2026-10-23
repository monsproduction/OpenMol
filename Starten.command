#!/bin/zsh
# Startet OpenMol: Doppelklick im Finder genügt.
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "Installiere Abhängigkeiten (nur beim ersten Start) …"
  npm install || { echo "npm install fehlgeschlagen"; read; exit 1; }
fi
echo "OpenMol läuft auf http://localhost:5173 – dieses Fenster offen lassen, Strg+C beendet."
npm run dev -- --port 5173 --open
