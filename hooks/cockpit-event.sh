#!/usr/bin/env bash
# Cockpit sensor: appends hook events to events-<session_id>.jsonl.
# Fail-open toward Claude Code (always exit 0); errors go to errors.log.
set -u
DIR="${COCKPIT_DIR:-$HOME/.claude/cockpit}"
EVENT="${1:-unknown}"
INPUT="$(cat 2>/dev/null || true)"
{
  SID="$(printf '%s' "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null)" || SID="unknown"
  [ -n "$SID" ] || SID="unknown"
  TS="$(( $(date +%s) * 1000 ))"
  DATA="$(printf '%s' "$INPUT" | jq -c . 2>/dev/null)" || DATA='null'
  [ -n "$DATA" ] || DATA='null'
  printf '{"ts":%s,"event":"%s","data":%s}\n' "$TS" "$EVENT" "$DATA" >> "$DIR/events-$SID.jsonl"
  if [ "$EVENT" = "SessionStart" ] && [ "$DATA" != "null" ]; then
    # PER SESSION (2026-08-04): current-session.json is global — whoever
    # starts last overwrites it. If a second Claude session starts anywhere,
    # the dashboard loses its own identifier and finds neither its mailbox
    # nor the transcript. Really observed: a session in the home directory
    # overwrote the project's; the Context and Usage cards then permanently
    # read "waiting for the status line".
    # Same pattern as events-<sid>.jsonl and status-<sid>.json.
    printf '%s' "$DATA" | jq -c '{session_id, transcript_path, cwd}' > "$DIR/session-$SID.json" 2>/dev/null || true
    # current-session.json is also kept around: fallback for calls without
    # COCKPIT_TARGET_CWD (there is no folder to match against there).
    printf '%s' "$DATA" | jq -c '{session_id, transcript_path, cwd}' > "$DIR/current-session.json" 2>/dev/null || true
  fi
} 2>> "$DIR/errors.log" || true
exit 0
