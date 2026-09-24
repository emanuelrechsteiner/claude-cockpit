#!/usr/bin/env bash
# Verhaltensbeweis: Maus im Cockpit — Klick-Fokus und frei verschiebbare
# Trennlinie (2026-09-23, Revision von `mouse off` -> `mouse on`, siehe
# docs/adr/0001-maus-statt-nur-tastatur.md).
#
# Warum das nicht in vitest passt: das Verhalten entsteht ausschliesslich in
# tmux' Maus-Verarbeitung (mouse-select-pane / MouseDrag1Border). Ein
# Renderer-Test ohne echten tmux-Client und ohne echte SGR-Mausereignisse
# sieht davon nichts — genau der Fehler, den testing-quality.md unter
# "Rendered-Proof for Visual Claims" und slop-prevention.md Trigger 3
# beschreiben (Beweis am ARTEFAKT, nicht an der Deklaration).
#
# Warum `tmux send-keys` hier NICHT reicht (anders als in navigation-check.sh):
# `send-keys` schreibt Tasten direkt in den Eingabepuffer eines Panes/der
# Session — das umgeht genau die Schicht, die geprueft werden soll: die
# Umwandlung roher SGR-Maus-Escapesequenzen (wie sie ein echtes Terminal wie
# Ghostty an den angehaengten tmux-CLIENT schickt) in tmux-interne Aktionen
# (Fokuswechsel, Rahmen-Resize). Deshalb haengt dieser Test einen ECHTEN
# tmux-Client ueber ein Pseudo-Terminal an (Python `pty.fork()` + `tmux
# attach`) und schreibt die SGR-Bytes auf die Master-Seite des Pseudo-
# Terminals — genau das, was ein echtes Terminal auf die Standardeingabe des
# Clients schreiben wuerde. Der tmux-SERVER (nicht der Client) parst diese
# Bytes und entscheidet ueber Fokus/Resize; der Client ist nur die duenne
# Weiterleitung, die ein echtes Terminal ersetzt.
#
# Sicherheitshinweis: laeuft ausschliesslich auf einem eigenen Socket
# (`-L cockpit-mouse-proof`) — der laufende Standard-tmux-Server der
# Nutzersitzung wird nie angefasst. `kill-server` am Ende beendet nur diesen
# eigenen Socket.
#
# Aufruf:  bash tests/e2e/mouse-check.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
REPO=$PWD
CONF="$REPO/config/tmux-cockpit.conf"
SOCK="cockpit-mouse-proof"
SESSION="cockpit-mouse-test-$$"
COLS=200
ROWS=50
RIGHT_W=48
DELTA=15   # Spalten, um die die Trennlinie gezogen wird (>=10 gefordert)

command -v tmux >/dev/null || { echo "tmux fehlt — nicht durchfuehrbar" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 fehlt — nicht durchfuehrbar" >&2; exit 1; }

PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf '  [%s] erwartet=%s bekommen=%s\n' "$1" "$2" "$3"; fi; }

T() { tmux -L "$SOCK" "$@"; }

DIR=$(mktemp -d)
cleanup() { T kill-server 2>/dev/null; rm -rf "$DIR"; }
trap cleanup EXIT

# ── Pseudo-Terminal-Client: schreibt rohe Bytes auf die Standardeingabe ─────
# eines ECHT an die Session angehaengten `tmux attach`-Clients. Jede Zeile
# von stdin ist EINE Escape-Sequenz (ohne eigenes Zeilenende — ein
# angehaengtes '\n' waere selbst ein Tastendruck und wuerde als Enter im
# fokussierten Pane landen).
cat > "$DIR/send_mouse.py" <<'PY'
import fcntl
import os
import pty
import struct
import sys
import termios
import time

sock, session, cols, rows = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
lines = [l for l in sys.stdin.buffer.read().split(b"\n") if l]

pid, fd = pty.fork()
if pid == 0:
    env = dict(os.environ)
    env["TERM"] = "xterm-256color"
    os.execvpe("tmux", ["tmux", "-L", sock, "attach", "-t", session], env)
    os._exit(127)  # nur erreicht, wenn execvpe fehlschlaegt

# Fenstergroesse auf dem Pseudo-Terminal setzen, damit der Client sich nicht
# auf eine abweichende Groesse legt (Kernel schickt SIGWINCH automatisch).
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

time.sleep(0.6)  # Client muss angehaengt und gerendert haben
for line in lines:
    try:
        os.write(fd, line)
    except OSError:
        break
    time.sleep(0.12)
time.sleep(0.3)

# WARUM SIGTERM + sofortiges close() statt blockierendem waitpid() danach
# (gemessen 2026-09-23): ein `tmux attach`-Client, der gerade eine Mausaktion
# verarbeitet hat, beendet sich auf SIGTERM nicht immer sofort — blockierendes
# `waitpid(pid, 0)` hing dabei reproduzierbar unbegrenzt. Das Schliessen der
# Master-Seite des Pseudo-Terminals loest fuer den Client (Sitzungsleiter
# ohne Terminal mehr) ein SIGHUP aus und beendet ihn zuverlaessig — das
# eigentliche Kill-Signal ist hier das Schliessen, SIGTERM ist nur der erste,
# schnellere Versuch. `waitpid` danach nur noch NICHT-blockierend mit
# Zeitbudget: bleibt der Prozess laenger am Leben, wird er verwaist und
# spaeter vom System eingesammelt statt den Test zu blockieren.
try:
    os.kill(pid, 15)
except ProcessLookupError:
    pass
os.close(fd)
for _ in range(20):
    try:
        r, _status = os.waitpid(pid, os.WNOHANG)
    except ChildProcessError:
        r = pid
    if r != 0:
        break
    time.sleep(0.05)
PY

send_mouse() {  # send_mouse <datei-mit-sgr-zeilen>
  python3 "$DIR/send_mouse.py" "$SOCK" "$SESSION" "$COLS" "$ROWS" < "$1"
}

build_click() {  # build_click <col> <row> > datei — Druecken + Loslassen
  local col=$1 row=$2
  printf '\033[<0;%d;%dM\n' "$col" "$row"
  printf '\033[<0;%d;%dm\n' "$col" "$row"
}

build_drag() {  # build_drag <startspalte> <zeile> <delta> > datei
  # Druecken auf der Trennlinie, dann DELTA Zieh-Schritte nach rechts
  # (Cb=32 = Bewegung mit gehaltener Taste 1), dann Loslassen — simuliert
  # ein echtes Ziehen, nicht nur einen Sprung.
  local col=$1 row=$2 delta=$3 i c final
  printf '\033[<0;%d;%dM\n' "$col" "$row"
  for i in $(seq 1 "$delta"); do
    c=$((col + i))
    printf '\033[<32;%d;%dM\n' "$c" "$row"
  done
  final=$((col + delta))
  printf '\033[<0;%d;%dm\n' "$final" "$row"
}

active_pane() { T display-message -p -t "$SESSION" '#{pane_index}'; }
pane_width()  { T display-message -p -t "$SESSION:0.$1" '#{pane_width}'; }

# ── Session wie bin/cockpit aufteilen (links gross, rechts 48 Spalten) ──────
# `-x`/`-y` explizit gesetzt (wie resize-regression.sh/navigation-check.sh):
# ohne angehaengten Client waere die Groesse sonst vom aufrufenden Terminal
# oder einem 80x24-Standard abhaengig — hier deterministisch fuer den Test.
# Statt `claude`/der echten App laufen beide Panes mit `cat > datei`: dieser
# Test prueft ausschliesslich tmux' Maus-Mechanik (Fokus, Rahmen-Resize),
# nicht die Dashboard-App — die Aufteilung selbst ist identisch zu bin/cockpit.
T -f "$CONF" new-session -d -s "$SESSION" -x "$COLS" -y "$ROWS" -c "$DIR" "cat > '$DIR/left.txt'"
T split-window -h -l "$RIGHT_W" -t "$SESSION" -c "$DIR" "cat > '$DIR/right.txt'"
T select-pane -t "$SESSION:0.0"

read -r RIGHT_LEFT RIGHT_TOP <<<"$(T display-message -p -t "$SESSION:0.1" '#{pane_left} #{pane_top}')"
CLICK_COL=$((RIGHT_LEFT + 3))
CLICK_ROW=$((RIGHT_TOP + 3))
# 0-basierte Randspalte von tmux (`pane_left` des rechten Panes) ist
# zahlengleich mit der 1-basierten SGR-Spalte der Trennlinie unmittelbar
# links davon ((RIGHT_LEFT - 1) + 1 == RIGHT_LEFT).
BORDER_COL=$RIGHT_LEFT
BORDER_ROW=$((RIGHT_TOP + 6))

echo "== Geometrie: rechtes Pane left=$RIGHT_LEFT top=$RIGHT_TOP · Trennlinie Spalte=$BORDER_COL =="

# ── (a) Klick ins rechte Pane setzt den Fokus dorthin ───────────────────────
check "start/links-aktiv" 0 "$(active_pane)"
build_click "$CLICK_COL" "$CLICK_ROW" > "$DIR/click.seq"
send_mouse "$DIR/click.seq"
check "klick-rechts/fokus-wechselt" 1 "$(active_pane)"

# ── (b) Trennlinie ziehen veraendert die Breite beider Panes ────────────────
T select-pane -t "$SESSION:0.0"
W_LEFT_BEFORE=$(pane_width 0)
W_RIGHT_BEFORE=$(pane_width 1)
echo "== vor dem Ziehen: links=${W_LEFT_BEFORE} rechts=${W_RIGHT_BEFORE} =="
build_drag "$BORDER_COL" "$BORDER_ROW" "$DELTA" > "$DIR/drag.seq"
send_mouse "$DIR/drag.seq"
W_LEFT_AFTER=$(pane_width 0)
W_RIGHT_AFTER=$(pane_width 1)
echo "== nach dem Ziehen (+$DELTA Spalten angefordert): links=${W_LEFT_AFTER} rechts=${W_RIGHT_AFTER} =="
check "ziehen/links-breiter" "$((W_LEFT_BEFORE + DELTA))" "$W_LEFT_AFTER"
check "ziehen/rechts-schmaler" "$((W_RIGHT_BEFORE - DELTA))" "$W_RIGHT_AFTER"

# ── Gegenprobe: mit `mouse off` schlagen (a) und (b) fehl ───────────────────
# Ohne diese Gegenprobe waere unklar, ob die obigen Haken wirklich an der
# Maus-Option haengen oder aus einem anderen Grund (z. B. Standard-Tasten-
# belegung, Test-Artefakt) gruen wurden — siehe testing-quality.md
# "Verify at the Sink, Not the Suite".
T set-option -g mouse off
T select-pane -t "$SESSION:0.0"
check "gegenprobe/start-links-aktiv" 0 "$(active_pane)"
send_mouse "$DIR/click.seq"
check "gegenprobe/klick-ignoriert-ohne-maus" 0 "$(active_pane)"

W_LEFT_OFF_BEFORE=$(pane_width 0)
W_RIGHT_OFF_BEFORE=$(pane_width 1)
send_mouse "$DIR/drag.seq"
W_LEFT_OFF_AFTER=$(pane_width 0)
W_RIGHT_OFF_AFTER=$(pane_width 1)
echo "== Gegenprobe (mouse off) ziehen: links ${W_LEFT_OFF_BEFORE}->${W_LEFT_OFF_AFTER}, rechts ${W_RIGHT_OFF_BEFORE}->${W_RIGHT_OFF_AFTER} =="
check "gegenprobe/breite-unveraendert-links"  "$W_LEFT_OFF_BEFORE"  "$W_LEFT_OFF_AFTER"
check "gegenprobe/breite-unveraendert-rechts" "$W_RIGHT_OFF_BEFORE" "$W_RIGHT_OFF_AFTER"

printf '── mouse-check: %d bestanden, %d fehlgeschlagen ──\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
