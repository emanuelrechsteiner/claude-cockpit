#!/usr/bin/env bash
# Checks the focus behavior of card operation (2026-08-04).
#
# Why this doesn't fit in vitest: it's about the INTERPLAY of tmux pane focus
# and the dashboard. A unit check sees no pane.
#
# The bug that led to this: tmux only routed the six digits to the right
# pane. Arrows and Enter went to the ACTIVE pane — Claude on the left. You
# could select a card but do nothing in it.
#
# Fix (chosen by the user): focus moves along. ⌘1-6 makes the dashboard the
# active pane, esc returns focus, and a character typed here by accident is
# forwarded left.
#
# Usage:  bash tests/e2e/navigation-check.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
REPO=$PWD
CONF="config/tmux-cockpit.conf"

command -v tmux >/dev/null || { echo "tmux missing — cannot run" >&2; exit 1; }

PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf '  [%s] expected=%s got=%s\n' "$1" "$2" "$3"; fi; }

# ── A) The tmux configuration: every digit must move focus along ────────────
for n in 10 11 12 13 14 15 16; do
  check "conf/user$n-sends"    1 "$(grep -c "bind -n User$n send-keys -t \"{right}\"" "$CONF")"
  check "conf/user$n-focuses"  1 "$(grep -c "bind -n User$n .*select-pane -t \"{right}\"" "$CONF")"
done

# ── B) Interplay on a real pane pair ────────────────────────────────────────
DIR=$(mktemp -d)
SESSION="cockpit-nav-test-$$"
cleanup() { tmux kill-session -t "$SESSION" 2>/dev/null; rm -rf "$DIR"; }
trap cleanup EXIT

cat > "$DIR/session-e2e.json" <<EOF
{"session_id":"e2e","transcript_path":"$DIR/transcript.jsonl","cwd":"$DIR"}
EOF
: > "$DIR/events-e2e.jsonl"; : > "$DIR/transcript.jsonl"
printf '{"ts":%s,"session_id":"e2e","context":{"used_percentage":31.4}}\n' "$(date +%s)" > "$DIR/status-e2e.json"

# A quiet stand-in on the left instead of Claude: `cat` collects whatever
# arrives — so it's checkable whether a character was really forwarded left.
tmux -f "$REPO/$CONF" new-session -d -s "$SESSION" -x 200 -y 60 -c "$DIR" \
  "cat > '$DIR/left-received.txt'"
tmux split-window -h -t "$SESSION" -c "$REPO" \
  "COCKPIT_DIR='$DIR' COCKPIT_TARGET_CWD='$DIR' exec npx tsx src/ui/app.tsx --rules '$REPO/config/rules.json' 2>'$DIR/err.log'"

for _ in $(seq 1 40); do
  tmux capture-pane -p -t "$SESSION:0.1" 2>/dev/null | grep -q "Team Lead" && break
  sleep 0.5
done

active() { tmux display-message -p -t "$SESSION" '#{pane_index}'; }
frame_color() {  # 6 = cyan/focused, 7 = white
  # The sequence is ESC [ 1 m ESC [ 3 X m — X sits at RSTART+7, not +8.
  tmux capture-pane -p -e -t "$SESSION:0.1" 2>/dev/null \
    | LC_ALL=C grep -a "· Team Lead" \
    | LC_ALL=C awk '{ if (match($0,/\033\[1m\033\[3[0-9]m/)) print substr($0,RSTART+7,1) }' | head -1
}

# Starting point: left active, no card selected
tmux select-pane -t "$SESSION:0.0"; sleep 0.5
check "start/left-active"    0   "$(active)"
check "start/card-not-focused" 7 "$(frame_color)"

# Simulate ⌘2 (Team Lead has been card 2 since 2026-09-24): exactly what the tmux binding does
tmux send-keys -t "$SESSION:0.1" Escape c k 2
tmux select-pane -t "$SESSION:0.1"
sleep 1.5
check "after-cmd1/right-active"  1 "$(active)"
check "after-cmd1/card-cyan"    6 "$(frame_color)"

# The arrow key must now act IN the dashboard (no longer land on the left)
tmux send-keys -t "$SESSION:0.1" Down; sleep 1
check "after-arrow/right-still-active" 1 "$(active)"
check "after-arrow/card-still-cyan"   6 "$(frame_color)"

# esc: release the card AND return focus to the left
tmux send-keys -t "$SESSION:0.1" Escape; sleep 1.5
check "after-esc/left-active"      0 "$(active)"
check "after-esc/card-released" 7 "$(frame_color)"

# Character typed by accident: focus returns AND the character arrives on the left
tmux select-pane -t "$SESSION:0.1"
tmux send-keys -t "$SESSION:0.1" Escape c k 2; sleep 1.2
tmux send-keys -t "$SESSION:0.1" -l "H"; sleep 1.5
check "stray-character/left-active"   0 "$(active)"
check "stray-character/card-released"      7 "$(frame_color)"
# The left terminal buffers line by line — a newline only pushes the
# character forwarded by the dashboard into the file. The newline itself is
# a measurement tool; the "H" must have come from the dashboard.
tmux send-keys -t "$SESSION:0.0" Enter; sleep 0.8
check "stray-character/character-arrived" 1 "$(grep -c H "$DIR/left-received.txt" 2>/dev/null || echo 0)"

# 'q' while a card is selected must NOT quit — otherwise a typed word
# containing q would close the whole dashboard.
tmux select-pane -t "$SESSION:0.1"
tmux send-keys -t "$SESSION:0.1" Escape c k 2; sleep 1.2
tmux send-keys -t "$SESSION:0.1" -l "q"; sleep 1.5
check "q-while-card-selected/dashboard-alive" 1 "$(tmux list-panes -t "$SESSION" 2>/dev/null | wc -l | tr -d ' ' | awk '{print ($1>=2)?1:0}')"

printf '── navigation-check: %d passed, %d failed ──\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || { echo "--- error log ---"; head -20 "$DIR/err.log" 2>/dev/null; }
[ "$FAIL" -eq 0 ]
