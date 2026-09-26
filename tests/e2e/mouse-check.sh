#!/usr/bin/env bash
# Behavioral proof: mouse in Cockpit — click-focus and a freely draggable
# divider (2026-09-23, revision from `mouse off` -> `mouse on`, see
# docs/adr/0001-mouse-not-only-keyboard.md).
#
# Why this doesn't fit in vitest: the behavior arises exclusively in tmux's
# mouse handling (mouse-select-pane / MouseDrag1Border). A renderer test
# without a real tmux client and without real SGR mouse events sees none of
# it — exactly the mistake that testing-quality.md's "Rendered-Proof for
# Visual Claims" and slop-prevention.md Trigger 3 describe (proof against
# the ARTIFACT, not the declaration).
#
# Why `tmux send-keys` is NOT enough here (unlike in navigation-check.sh):
# `send-keys` writes keys directly into a pane's/session's input buffer —
# that bypasses exactly the layer meant to be tested: the translation of raw
# SGR mouse escape sequences (as a real terminal like Ghostty sends to the
# attached tmux CLIENT) into tmux-internal actions (focus switch, border
# resize). This test therefore attaches a REAL tmux client via a
# pseudo-terminal (Python `pty.fork()` + `tmux attach`) and writes the SGR
# bytes to the master side of the pseudo-terminal — exactly what a real
# terminal would write to the client's standard input. The tmux SERVER (not
# the client) parses these bytes and decides on focus/resize; the client is
# only the thin relay that a real terminal replaces.
#
# Safety note: runs exclusively on its own socket (`-L cockpit-mouse-proof`)
# — the user's own running standard tmux server is never touched.
# `kill-server` at the end only ends this dedicated socket.
#
# Usage:  bash tests/e2e/mouse-check.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
REPO=$PWD
CONF="$REPO/config/tmux-cockpit.conf"
SOCK="cockpit-mouse-proof"
SESSION="cockpit-mouse-test-$$"
COLS=200
ROWS=50
RIGHT_W=48
DELTA=15   # columns by which the divider is dragged (>=10 required)

command -v tmux >/dev/null || { echo "tmux missing — cannot run" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 missing — cannot run" >&2; exit 1; }

PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf '  [%s] expected=%s got=%s\n' "$1" "$2" "$3"; fi; }

T() { tmux -L "$SOCK" "$@"; }

DIR=$(mktemp -d)
cleanup() { T kill-server 2>/dev/null; rm -rf "$DIR"; }
trap cleanup EXIT

# ── Pseudo-terminal client: writes raw bytes to the standard input ─────────
# of a `tmux attach` client REALLY attached to the session. Each line from
# stdin is ONE escape sequence (with no line ending of its own — an
# appended '\n' would itself be a keypress and would land as Enter in the
# focused pane).
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
    os._exit(127)  # only reached if execvpe fails

# Set the window size on the pseudo-terminal, so the client doesn't settle
# on a different size (the kernel sends SIGWINCH automatically).
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

time.sleep(0.6)  # client must be attached and have rendered
for line in lines:
    try:
        os.write(fd, line)
    except OSError:
        break
    time.sleep(0.12)
time.sleep(0.3)

# WHY SIGTERM + immediate close() instead of a blocking waitpid() afterward
# (measured 2026-09-23): a `tmux attach` client that just processed a mouse
# action does not always terminate immediately on SIGTERM — a blocking
# `waitpid(pid, 0)` reproducibly hung indefinitely there. Closing the master
# side of the pseudo-terminal triggers a SIGHUP for the client (session
# leader with no terminal left) and reliably terminates it — the actual kill
# signal here is the close, SIGTERM is only the first, faster attempt.
# `waitpid` afterward only NON-blocking with a time budget: if the process
# stays alive longer, it becomes orphaned and is later reaped by the system
# instead of blocking the test.
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

send_mouse() {  # send_mouse <file-with-sgr-lines>
  python3 "$DIR/send_mouse.py" "$SOCK" "$SESSION" "$COLS" "$ROWS" < "$1"
}

build_click() {  # build_click <col> <row> > file — press + release
  local col=$1 row=$2
  printf '\033[<0;%d;%dM\n' "$col" "$row"
  printf '\033[<0;%d;%dm\n' "$col" "$row"
}

build_drag() {  # build_drag <start-col> <row> <delta> > file
  # Press on the divider, then DELTA drag steps to the right
  # (Cb=32 = movement with button 1 held), then release — simulates a real
  # drag, not just a jump.
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

# ── Split the session like bin/cockpit (left large, right 48 columns) ──────
# `-x`/`-y` set explicitly (like resize-regression.sh/navigation-check.sh):
# without an attached client, the size would otherwise depend on the calling
# terminal or an 80x24 default — deterministic here for the test.
# Instead of `claude`/the real app, both panes run `cat > file`: this test
# checks only tmux's mouse mechanics (focus, border resize), not the
# dashboard app — the split itself is identical to bin/cockpit.
T -f "$CONF" new-session -d -s "$SESSION" -x "$COLS" -y "$ROWS" -c "$DIR" "cat > '$DIR/left.txt'"
T split-window -h -l "$RIGHT_W" -t "$SESSION" -c "$DIR" "cat > '$DIR/right.txt'"
T select-pane -t "$SESSION:0.0"

read -r RIGHT_LEFT RIGHT_TOP <<<"$(T display-message -p -t "$SESSION:0.1" '#{pane_left} #{pane_top}')"
CLICK_COL=$((RIGHT_LEFT + 3))
CLICK_ROW=$((RIGHT_TOP + 3))
# tmux's 0-based edge column (`pane_left` of the right pane) is numerically
# equal to the 1-based SGR column of the divider immediately to its left
# ((RIGHT_LEFT - 1) + 1 == RIGHT_LEFT).
BORDER_COL=$RIGHT_LEFT
BORDER_ROW=$((RIGHT_TOP + 6))

echo "== Geometry: right pane left=$RIGHT_LEFT top=$RIGHT_TOP · divider column=$BORDER_COL =="

# ── (a) Clicking the right pane moves focus there ───────────────────────────
check "start/left-active" 0 "$(active_pane)"
build_click "$CLICK_COL" "$CLICK_ROW" > "$DIR/click.seq"
send_mouse "$DIR/click.seq"
check "click-right/focus-switches" 1 "$(active_pane)"

# ── (b) Dragging the divider changes the width of both panes ───────────────
T select-pane -t "$SESSION:0.0"
W_LEFT_BEFORE=$(pane_width 0)
W_RIGHT_BEFORE=$(pane_width 1)
echo "== before dragging: left=${W_LEFT_BEFORE} right=${W_RIGHT_BEFORE} =="
build_drag "$BORDER_COL" "$BORDER_ROW" "$DELTA" > "$DIR/drag.seq"
send_mouse "$DIR/drag.seq"
W_LEFT_AFTER=$(pane_width 0)
W_RIGHT_AFTER=$(pane_width 1)
echo "== after dragging (+$DELTA columns requested): left=${W_LEFT_AFTER} right=${W_RIGHT_AFTER} =="
check "drag/left-wider" "$((W_LEFT_BEFORE + DELTA))" "$W_LEFT_AFTER"
check "drag/right-narrower" "$((W_RIGHT_BEFORE - DELTA))" "$W_RIGHT_AFTER"

# ── Counter-check: with `mouse off`, (a) and (b) fail ───────────────────────
# Without this counter-check it would be unclear whether the checks above
# really depend on the mouse option or turned green for some other reason
# (e.g. default keybindings, test artifact) — see testing-quality.md
# "Verify at the Sink, Not the Suite".
T set-option -g mouse off
T select-pane -t "$SESSION:0.0"
check "counter-check/start-left-active" 0 "$(active_pane)"
send_mouse "$DIR/click.seq"
check "counter-check/click-ignored-without-mouse" 0 "$(active_pane)"

W_LEFT_OFF_BEFORE=$(pane_width 0)
W_RIGHT_OFF_BEFORE=$(pane_width 1)
send_mouse "$DIR/drag.seq"
W_LEFT_OFF_AFTER=$(pane_width 0)
W_RIGHT_OFF_AFTER=$(pane_width 1)
echo "== counter-check (mouse off) drag: left ${W_LEFT_OFF_BEFORE}->${W_LEFT_OFF_AFTER}, right ${W_RIGHT_OFF_BEFORE}->${W_RIGHT_OFF_AFTER} =="
check "counter-check/width-unchanged-left"  "$W_LEFT_OFF_BEFORE"  "$W_LEFT_OFF_AFTER"
check "counter-check/width-unchanged-right" "$W_RIGHT_OFF_BEFORE" "$W_RIGHT_OFF_AFTER"

printf '── mouse-check: %d passed, %d failed ──\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
