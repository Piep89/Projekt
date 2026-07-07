#!/bin/bash
# GGP-Starter: läuft im .app-Bundle, startet den eingebetteten Server und öffnet den Browser.
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
export GGP_DATA_DIR="${GGP_DATA_DIR:-$HOME/Library/Application Support/GGP/daten}"
mkdir -p "$GGP_DATA_DIR"
export PORT="${GGP_PORT:-41780}"
URL="http://127.0.0.1:$PORT/"

# Läuft bereits eine Instanz? Dann nur das Fenster öffnen.
if curl -s --max-time 2 "${URL}api/auth/me" >/dev/null 2>&1; then
  open "$URL"
  exit 0
fi

ERSTER_START=0
[ -f "$GGP_DATA_DIR/ggp.sqlite" ] || ERSTER_START=1

"$RES/node" --disable-warning=ExperimentalWarning "$RES/app/server/index.js" \
  >> "$GGP_DATA_DIR/server.log" 2>&1 &
NODE_PID=$!
trap 'kill "$NODE_PID" 2>/dev/null' EXIT INT TERM

# Auf den Server warten (max. 15 s)
for _ in $(seq 1 75); do
  curl -s --max-time 1 "${URL}api/auth/me" >/dev/null 2>&1 && break
  kill -0 "$NODE_PID" 2>/dev/null || { open -e "$GGP_DATA_DIR/server.log"; exit 1; }
  sleep 0.2
done

open "$URL"
# Beim ersten Start das Erstpasswort anzeigen
if [ "$ERSTER_START" = "1" ] && [ -f "$GGP_DATA_DIR/ADMIN-PASSWORT.txt" ]; then
  sleep 1
  open -e "$GGP_DATA_DIR/ADMIN-PASSWORT.txt"
fi

wait "$NODE_PID"
