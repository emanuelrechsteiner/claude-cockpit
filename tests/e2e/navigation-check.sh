#!/usr/bin/env bash
# Prueft das Fokus-Verhalten der Kartenbedienung (2026-08-04).
#
# Warum das nicht in vitest passt: Es geht um das ZUSAMMENSPIEL von tmux-Pane-
# Fokus und Dashboard. Eine Einheitspruefung sieht keinen Pane.
#
# Der Fehler, der dazu fuehrte: tmux leitete nur die sechs Ziffern ans rechte
# Pane um. Pfeile und Enter gingen ans AKTIVE Pane — links zu Claude. Man
# konnte eine Karte anwaehlen, aber darin nichts tun.
#
# Behebung (vom Nutzer gewaehlt): der Fokus wandert mit. ⌘1-6 macht das
# Dashboard zum aktiven Pane, esc gibt den Fokus zurueck, und ein
# versehentlich hier getipptes Zeichen wird nach links durchgereicht.
#
# Aufruf:  bash tests/e2e/navigation-check.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
REPO=$PWD
CONF="config/tmux-cockpit.conf"

command -v tmux >/dev/null || { echo "tmux fehlt — nicht durchfuehrbar" >&2; exit 1; }

PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf '  [%s] erwartet=%s bekommen=%s\n' "$1" "$2" "$3"; fi; }

# ── A) Die tmux-Konfiguration: jede Ziffer muss den Fokus mitziehen ──────────
for n in 10 11 12 13 14 15; do
  check "conf/user$n-sendet"      1 "$(grep -c "bind -n User$n send-keys -t \"{right}\"" "$CONF")"
  check "conf/user$n-fokussiert"  1 "$(grep -c "bind -n User$n .*select-pane -t \"{right}\"" "$CONF")"
done

# ── B) Zusammenspiel am echten Pane-Paar ────────────────────────────────────
DIR=$(mktemp -d)
SESSION="cockpit-nav-test-$$"
cleanup() { tmux kill-session -t "$SESSION" 2>/dev/null; rm -rf "$DIR"; }
trap cleanup EXIT

cat > "$DIR/session-e2e.json" <<EOF
{"session_id":"e2e","transcript_path":"$DIR/transcript.jsonl","cwd":"$DIR"}
EOF
: > "$DIR/events-e2e.jsonl"; : > "$DIR/transcript.jsonl"
printf '{"ts":%s,"session_id":"e2e","context":{"used_percentage":31.4}}\n' "$(date +%s)" > "$DIR/status-e2e.json"

# Links eine ruhige Attrappe statt Claude: `cat` sammelt, was ankommt — so
# laesst sich pruefen, ob ein Zeichen wirklich nach links durchgereicht wurde.
tmux -f "$REPO/$CONF" new-session -d -s "$SESSION" -x 200 -y 60 -c "$DIR" \
  "cat > '$DIR/links-empfangen.txt'"
tmux split-window -h -t "$SESSION" -c "$REPO" \
  "COCKPIT_DIR='$DIR' COCKPIT_TARGET_CWD='$DIR' exec npx tsx src/ui/app.tsx --rules '$REPO/config/rules.json' 2>'$DIR/err.log'"

for _ in $(seq 1 40); do
  tmux capture-pane -p -t "$SESSION:0.1" 2>/dev/null | grep -q "Team Lead" && break
  sleep 0.5
done

active() { tmux display-message -p -t "$SESSION" '#{pane_index}'; }
frame_color() {  # 6 = cyan/fokussiert, 7 = weiss
  # Die Sequenz ist ESC [ 1 m ESC [ 3 X m — X steht an RSTART+7, nicht +8.
  tmux capture-pane -p -e -t "$SESSION:0.1" 2>/dev/null \
    | LC_ALL=C grep -a "· Team Lead" \
    | LC_ALL=C awk '{ if (match($0,/\033\[1m\033\[3[0-9]m/)) print substr($0,RSTART+7,1) }' | head -1
}

# Ausgangslage: links aktiv, keine Karte gewaehlt
tmux select-pane -t "$SESSION:0.0"; sleep 0.5
check "start/links-aktiv"    0   "$(active)"
check "start/karte-nicht-fokussiert" 7 "$(frame_color)"

# ⌘1 nachstellen: genau das, was die tmux-Bindung tut
tmux send-keys -t "$SESSION:0.1" Escape c k 1
tmux select-pane -t "$SESSION:0.1"
sleep 1.5
check "nach-cmd1/rechts-aktiv"  1 "$(active)"
check "nach-cmd1/karte-cyan"    6 "$(frame_color)"

# Pfeiltaste muss jetzt IM Dashboard wirken (nicht mehr links landen)
tmux send-keys -t "$SESSION:0.1" Down; sleep 1
check "nach-pfeil/rechts-noch-aktiv" 1 "$(active)"
check "nach-pfeil/karte-noch-cyan"   6 "$(frame_color)"

# esc: Karte loslassen UND Fokus zurueck nach links
tmux send-keys -t "$SESSION:0.1" Escape; sleep 1.5
check "nach-esc/links-aktiv"      0 "$(active)"
check "nach-esc/karte-losgelassen" 7 "$(frame_color)"

# Versehentlich getipptes Zeichen: Fokus zurueck UND Zeichen kommt links an
tmux select-pane -t "$SESSION:0.1"
tmux send-keys -t "$SESSION:0.1" Escape c k 1; sleep 1.2
tmux send-keys -t "$SESSION:0.1" -l "H"; sleep 1.5
check "verirrtes-zeichen/links-aktiv"   0 "$(active)"
check "verirrtes-zeichen/karte-los"      7 "$(frame_color)"
# Das Terminal links puffert zeilenweise — ein Zeilenumbruch schiebt das vom
# Dashboard durchgereichte Zeichen erst in die Datei. Der Umbruch selbst ist
# Messwerkzeug, das "H" muss vom Dashboard gekommen sein.
tmux send-keys -t "$SESSION:0.0" Enter; sleep 0.8
check "verirrtes-zeichen/zeichen-kam-an" 1 "$(grep -c H "$DIR/links-empfangen.txt" 2>/dev/null || echo 0)"

# 'q' bei gewaehlter Karte darf NICHT beenden — sonst verschwaende ein
# getipptes Wort mit q das ganze Dashboard.
tmux select-pane -t "$SESSION:0.1"
tmux send-keys -t "$SESSION:0.1" Escape c k 1; sleep 1.2
tmux send-keys -t "$SESSION:0.1" -l "q"; sleep 1.5
check "q-bei-karte/dashboard-lebt" 1 "$(tmux list-panes -t "$SESSION" 2>/dev/null | wc -l | tr -d ' ' | awk '{print ($1>=2)?1:0}')"

printf '── navigation-check: %d bestanden, %d fehlgeschlagen ──\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || { echo "--- Fehlerprotokoll ---"; head -20 "$DIR/err.log" 2>/dev/null; }
[ "$FAIL" -eq 0 ]
