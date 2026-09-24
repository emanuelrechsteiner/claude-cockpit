#!/usr/bin/env bash
# Regression gegen GEISTERRAHMEN (2026-08-04, angepasst auf Ink 7.1.1 +
# Alternate Screen — selbes Datum, dritte Fassung).
#
# Warum diese Pruefung nicht in vitest passt: Der Fehler entsteht erst im echten
# Terminal. Ink loescht seinen vorherigen Rahmen, indem es den Cursor um die
# ZULETZT gezeichnete Zeilenzahl hochfaehrt. Aendert sich die Terminalbreite,
# brechen die Zeilen anders um, die gemerkte Zahl stimmt nicht mehr — der alte
# Rahmen bleibt stehen. Am 2026-08-04 im laufenden Dashboard gemessen: SIEBEN
# gestapelte Rahmen. Ein Renderer-Test ohne echtes tty kann das nicht sehen.
#
# Alternate Screen aendert die MESSMETHODE, nicht die Fragestellung: Waehrend
# die App im Alternate Screen laeuft, gibt es KEINEN Scrollback — empirisch
# geprueft per `tmux capture-pane -S -` gegen eine Alternate-Screen-Testpane:
# das Ergebnis war exakt die sichtbare Pane-Hoehe, keine Zeile von VOR dem
# Bildschirmwechsel war erreichbar. `-S -` ist damit im Alternate Screen ein
# No-op. Diese Pruefung erfasst deshalb bewusst nur die sichtbare Pane
# (`capture-pane -p` ohne `-S`) und macht die Pane grosszuegig hoch (200 statt
# vormals 50 Zeilen), damit auch mehrere gestapelte Geisterrahmen vollstaendig
# im sichtbaren Bereich liegen — sonst wuerde die Pruefung an einem zu kleinen
# Fenster gruen, weil ueberschuessige Rahmen einfach ausserhalb der Pane
# liegen, nicht weil der Fehler behoben waere.
#
# WICHTIGER BEFUND (Schritt 6, Negativkontrolle): eine Folge EINZELNER
# `resize-window`-Aufrufe mit Pause dazwischen (die urspruengliche Fassung
# dieser Pruefung) loest den Fehler NICHT aus — weder mit noch ohne Fix. Erst
# ein SCHNELLER BURST aufeinanderfolgender `resize-window`-Aufrufe OHNE Pause
# (das simuliert ein echtes Ziehen am Fensterrand, bei dem viele SIGWINCH kurz
# hintereinander eintreffen) reproduziert die Race Condition zuverlaessig:
# gemessen 8 -> 13 Kartenrahmen (`╭`) und ein doppeltes "· Team Lead" bei Ink
# 5.2.1 + React 18.3.0 ohne Workaround. Mit dem Burst als Reiz ist diese
# Pruefung nachweislich DISKRIMINIEREND (siehe Bericht): sie schlaegt fehl,
# wenn der Workaround in app.tsx (Bildschirm-Wischen bei resize) fehlt — auch
# mit Ink 7.1.1 + Alternate Screen, dessen eigene Resize-Korrektur (PR #828)
# denselben Burst NICHT uebersteht.
#
# Aufbau: eigene tmux-Sitzung in einem Temporaerverzeichnis, das Dashboard laeuft
# darin mit Attrappen-Daten. Die echte Sitzung des Nutzers wird nie angefasst.
#
# Aufruf:  bash tests/e2e/resize-regression.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
REPO=$PWD

command -v tmux >/dev/null || { echo "tmux fehlt — Pruefung nicht durchfuehrbar" >&2; exit 1; }

PASS=0; FAIL=0
check() { # check <name> <erwartet> <bekommen>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf '  [%s] erwartet=%s bekommen=%s\n' "$1" "$2" "$3"; fi
}

DIR=$(mktemp -d)
SESSION="cockpit-resize-test-$$"
cleanup() { tmux kill-session -t "$SESSION" 2>/dev/null; rm -rf "$DIR"; }
trap cleanup EXIT

# --- Attrappen-Daten ---------------------------------------------------------
# session-<sid>.json ist seit 2026-08-04 der massgebliche Weg (pro Sitzung);
# current-session.json ist nur noch Rueckfalllinie fuer Laeufe OHNE
# COCKPIT_TARGET_CWD. Diese Pruefung setzt TARGET_CWD, braucht also die
# Sitzungsdatei — mit der globalen allein blieb sie zu Recht rot.
cat > "$DIR/session-e2e.json" <<EOF
{"session_id":"e2e","transcript_path":"$DIR/transcript.jsonl","cwd":"$DIR"}
EOF
cat > "$DIR/current-session.json" <<EOF
{"session_id":"e2e","transcript_path":"$DIR/transcript.jsonl","cwd":"$DIR"}
EOF
: > "$DIR/events-e2e.jsonl"
: > "$DIR/transcript.jsonl"
cat > "$DIR/status-e2e.json" <<EOF
{"ts":$(date +%s),"session_id":"e2e","model":"Opus 5",
 "context":{"used_percentage":31.4,"window_size":1000000,"input_tokens":314000,"output_tokens":12000},
 "cost":{"total_usd":20.69,"duration_ms":900000,"lines_added":578,"lines_removed":303},
 "rate_limits":{"five_hour":{"used_percentage":42,"resets_at":$(( $(date +%s) + 7200 ))},
                "seven_day":{"used_percentage":18,"resets_at":$(( $(date +%s) + 200000 ))}}}
EOF

# --- Dashboard in einer eigenen Sitzung starten ------------------------------
# --rules explizit: das Regelwerk liegt in der INSTALLATION, nicht im
# Attrappen-Verzeichnis. Ohne den Pfad bricht loadRules ab (fail-loud) und das
# Dashboard startet gar nicht erst — genau daran ist die erste Fassung dieses
# Pruefstands gescheitert.
tmux new-session -d -s "$SESSION" -x 200 -y 200 -c "$REPO" \
  "COCKPIT_DIR='$DIR' COCKPIT_TARGET_CWD='$DIR' exec npx tsx src/ui/app.tsx --rules '$REPO/config/rules.json' 2>'$DIR/err.log'"
P="$SESSION:0.0"

# Auf den ersten Rahmen warten (npx-Start braucht ein paar Sekunden)
for _ in $(seq 1 40); do
  tmux capture-pane -p -t "$P" 2>/dev/null | grep -q "Team Lead" && break
  sleep 0.5
done

# Kein `-S -`: im Alternate Screen ist das ein No-op (siehe Kommentar oben) —
# die sichtbare Pane IST der vollstaendige erreichbare Zustand.
frames() { tmux capture-pane -p -t "$P" 2>/dev/null | grep -c "· Team Lead"; }

check "start/genau-ein-rahmen" 1 "$(frames)"

# --- Der eigentliche Test: BURST aus Groessenaenderungen ohne Pause ----------
# Simuliert ein echtes Ziehen am Fensterrand (viele SIGWINCH kurz hintereinander).
# Einzelne resize-window-Aufrufe MIT Pause dazwischen loesen den Fehler
# nachweislich NICHT aus (siehe Kommentar oben) — nur der Burst tut es.
for w in 190 170 150 130 110 90 70 50 30 25 40 60 80 100 120 140 160 180 200; do
  tmux resize-window -t "$SESSION" -x "$w" -y 200 2>/dev/null
done
sleep 1.5

check "nach-burst-groessenaenderungen/genau-ein-rahmen" 1 "$(frames)"

# --- Die beiden neuen Karten muessen sichtbar sein und Zahlen zeigen ---------
SNAP=$(tmux capture-pane -p -t "$P" 2>/dev/null)
check "karte-kontext-vorhanden"  1 "$(grep -c "Kontext"  <<<"$SNAP" | head -1)"
check "karte-verbrauch-vorhanden" 1 "$(grep -c "Verbrauch" <<<"$SNAP" | head -1)"
check "kontext-zeigt-prozent"    1 "$(grep -c "31%" <<<"$SNAP" | head -1)"
check "verbrauch-zeigt-5std"     1 "$(grep -c "5 Std" <<<"$SNAP" | head -1)"
check "verbrauch-zeigt-7tage"    1 "$(grep -c "7 Tage" <<<"$SNAP" | head -1)"

# --- Die nummerierten Karten bleiben unveraendert 1..6 ----------------------
for n in 1 2 3 4 5 6; do
  check "karte-$n-nummeriert" 1 "$(grep -c "$n · " <<<"$SNAP" | head -1)"
done

printf '── resize-regression: %d bestanden, %d fehlgeschlagen ──\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || { echo "--- Fehlerprotokoll ---"; cat "$DIR/err.log" 2>/dev/null | head -20; }
[ "$FAIL" -eq 0 ]
