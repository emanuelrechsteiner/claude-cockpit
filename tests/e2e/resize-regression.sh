#!/usr/bin/env bash
# Regression against GHOST FRAMES (2026-08-04, adapted for Ink 7.1.1 +
# Alternate Screen — same date, third version).
#
# Why this check doesn't fit in vitest: the bug only manifests in a real
# terminal. Ink erases its previous frame by moving the cursor up by the LAST
# rendered line count. When the terminal width changes, the lines wrap
# differently, so the remembered count no longer matches — the old frame
# stays put. Measured on the running dashboard on 2026-08-04: SEVEN stacked
# frames. A renderer test without a real tty cannot see this.
#
# Alternate Screen changes the MEASUREMENT METHOD, not the question: while
# the app runs in Alternate Screen, there is NO scrollback — empirically
# checked via `tmux capture-pane -S -` against an Alternate-Screen test pane:
# the result was exactly the visible pane height, no line from BEFORE the
# screen switch was reachable. `-S -` is therefore a no-op in Alternate
# Screen. This check therefore deliberately captures only the visible pane
# (`capture-pane -p` without `-S`) and makes the pane generously tall (200
# instead of the previous 50 lines), so multiple stacked ghost frames fully
# fit in the visible area — otherwise the check would turn green on a
# too-small window because excess frames simply sit outside the pane, not
# because the bug was fixed.
#
# IMPORTANT FINDING (step 6, negative control): a sequence of INDIVIDUAL
# `resize-window` calls with a pause in between (the original version of this
# check) does NOT trigger the bug — neither with nor without the fix. Only a
# FAST BURST of consecutive `resize-window` calls WITHOUT a pause (which
# simulates a real window-edge drag, where many SIGWINCH arrive in quick
# succession) reliably reproduces the race condition: measured 8 -> 13 card
# frames (`╭`) and a duplicated "· Team Lead" on Ink 5.2.1 + React 18.3.0
# without the workaround. With the burst as the stimulus, this check is
# demonstrably DISCRIMINATING (see the report): it fails when the workaround
# in app.tsx (screen wipe on resize) is missing — even with Ink 7.1.1 +
# Alternate Screen, whose own resize fix (PR #828) does NOT survive the same
# burst.
#
# Setup: its own tmux session in a temp directory, the dashboard runs in it
# with stand-in data. The user's real session is never touched.
#
# Usage:  bash tests/e2e/resize-regression.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
REPO=$PWD

command -v tmux >/dev/null || { echo "tmux missing — cannot run this check" >&2; exit 1; }

PASS=0; FAIL=0
check() { # check <name> <expected> <got>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf '  [%s] expected=%s got=%s\n' "$1" "$2" "$3"; fi
}

DIR=$(mktemp -d)
SESSION="cockpit-resize-test-$$"
cleanup() { tmux kill-session -t "$SESSION" 2>/dev/null; rm -rf "$DIR"; }
trap cleanup EXIT

# --- Stand-in data -------------------------------------------------------------
# session-<sid>.json has been the authoritative path (per session) since
# 2026-08-04; current-session.json is now only the fallback for runs WITHOUT
# COCKPIT_TARGET_CWD. This check sets TARGET_CWD, so it needs the session
# file — with only the global one it rightly stayed red.
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

# --- Start the dashboard in its own session -----------------------------------
# --rules explicit: the ruleset lives in the INSTALLATION, not the stand-in
# directory. Without the path, loadRules aborts (fail-loud) and the dashboard
# doesn't even start — exactly what the first version of this test rig failed on.
tmux new-session -d -s "$SESSION" -x 200 -y 200 -c "$REPO" \
  "COCKPIT_DIR='$DIR' COCKPIT_TARGET_CWD='$DIR' exec npx tsx src/ui/app.tsx --rules '$REPO/config/rules.json' 2>'$DIR/err.log'"
P="$SESSION:0.0"

# Wait for the first frame (npx startup takes a few seconds)
for _ in $(seq 1 40); do
  tmux capture-pane -p -t "$P" 2>/dev/null | grep -q "Team Lead" && break
  sleep 0.5
done

# No `-S -`: that's a no-op in Alternate Screen (see comment above) — the
# visible pane IS the full reachable state.
frames() { tmux capture-pane -p -t "$P" 2>/dev/null | grep -c "· Team Lead"; }

check "start/exactly-one-frame" 1 "$(frames)"

# --- The actual test: BURST of resizes without a pause -----------------------
# Simulates a real window-edge drag (many SIGWINCH in quick succession).
# Individual resize-window calls WITH a pause in between demonstrably do NOT
# trigger the bug (see comment above) — only the burst does.
for w in 190 170 150 130 110 90 70 50 30 25 40 60 80 100 120 140 160 180 200; do
  tmux resize-window -t "$SESSION" -x "$w" -y 200 2>/dev/null
done
sleep 1.5

check "after-burst-resizes/exactly-one-frame" 1 "$(frames)"

# --- The two new cards must be visible and show numbers -----------------------
SNAP=$(tmux capture-pane -p -t "$P" 2>/dev/null)
check "card-context-present"  1 "$(grep -c "Context"  <<<"$SNAP" | head -1)"
check "card-usage-present" 1 "$(grep -c "Usage" <<<"$SNAP" | head -1)"
check "context-shows-percent"    1 "$(grep -c "31%" <<<"$SNAP" | head -1)"
check "usage-shows-5h"     1 "$(grep -c "5h" <<<"$SNAP" | head -1)"
check "usage-shows-7d"    1 "$(grep -c "7d" <<<"$SNAP" | head -1)"

# --- The numbered cards remain unchanged, 1..6 --------------------------------
for n in 1 2 3 4 5 6; do
  check "card-$n-numbered" 1 "$(grep -c "$n · " <<<"$SNAP" | head -1)"
done

printf '── resize-regression: %d passed, %d failed ──\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || { echo "--- error log ---"; cat "$DIR/err.log" 2>/dev/null | head -20; }
[ "$FAIL" -eq 0 ]
