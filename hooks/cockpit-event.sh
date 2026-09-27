#!/usr/bin/env bash
# Cockpit sensor: appends hook events to events-<session_id>.jsonl.
# Fail-open toward Claude Code (always exit 0); errors go to errors.log.
#
# SMALL, ATOMIC LINES (2026-09-27): the sensor used to store the whole hook
# payload — FileWrite events carried the full file contents (lines up to
# 137 KB). Two hooks firing in the same second (two TaskUpdate calls in one
# assistant message) appended concurrently, interleaved into one unreadable
# line, and both events were lost (Card 4 showed 22/24 for a 24/24 list).
# Now every payload is trimmed to the fields src/parse/events.ts reads, and
# the finished line is appended under a per-session mkdir lock.
set -u
DIR="${COCKPIT_DIR:-$HOME/.claude/cockpit}"
EVENT="${1:-unknown}"
INPUT="$(cat 2>/dev/null || true)"

# One jq program; $ev is the event name passed on the command line.
# Known events keep only the fields the reducer consumes (plus session_id,
# hook_event_name, cwd); transcript_path only on SessionStart (session-<sid>.json
# needs it). Unknown events keep session_id + hook_event_name. Free text is
# capped at 300 chars; if the payload would still exceed the byte budget
# (multi-byte text, long paths), the free text is cut again to 60 chars.
# getpath() keeps "" and false — SubagentStop agent_type "" is load-bearing.
# shellcheck disable=SC2016  # $ev, $n, $p, $in are jq variables
TRIM='
def base: [["session_id"], ["hook_event_name"]];
def known:
  [["cwd"], ["tool_name"], ["tool_use_id"], ["subagent_id"], ["subagent_type"],
   ["tool_input","subagent_type"], ["tool_input","description"], ["tool_input","model"],
   ["tool_input","taskId"], ["tool_input","status"], ["tool_input","subject"],
   ["tool_input","file_path"], ["effort","level"], ["agent_type"], ["agent_id"],
   ["result_status"], ["last_assistant_message"], ["source"],
   ["tool_response","task","id"], ["tool_response","task","subject"],
   ["tool_response","taskId"], ["task_id"], ["task_name"]];
def text:
  [["last_assistant_message"], ["tool_input","description"], ["tool_input","subject"],
   ["tool_response","task","subject"], ["task_name"]];
def cut($n): if type == "string" and length > $n then .[0:$n] else . end;
def paths_for($ev):
  if ($ev | IN("SessionStart","SubagentStart","SubagentStop","TaskCreated",
               "TaskUpdated","TaskCompleted","FileWrite"))
  then base + known + (if $ev == "SessionStart" then [["transcript_path"]] else [] end)
  else base end;
def pick($in; $ps):
  reduce $ps[] as $p ({};
    ($in | try getpath($p) catch null) as $v
    | if $v == null then . else setpath($p; $v) end);
def shorten($n):
  reduce text[] as $p (.;
    if (try getpath($p) catch null) == null then . else setpath($p; getpath($p) | cut($n)) end);
if type != "object" then null
else pick(.; paths_for($ev)) | shorten(300)
  | if (tojson | utf8bytelength) > 1900 then shorten(60) else . end
end'

LOCK=""
release() { if [ -n "$LOCK" ]; then rmdir "$LOCK" 2>/dev/null; LOCK=""; fi; }
trap release EXIT

{
  DATA="$(printf '%s' "$INPUT" | jq -c --arg ev "$EVENT" "$TRIM" 2>/dev/null)" || DATA='null'
  [ -n "$DATA" ] || DATA='null'
  SID="$(printf '%s' "$DATA" | jq -r '.session_id // "unknown"' 2>/dev/null)" || SID="unknown"
  # The session id becomes part of file names: never let it carry a path.
  case "$SID" in ''|.*|*[!A-Za-z0-9._-]*) SID="unknown" ;; esac
  TS="$(( $(date +%s) * 1000 ))"
  # Build the complete line first, then append it with one printf.
  LINE="$(printf '{"ts":%s,"event":"%s","data":%s}' "$TS" "$EVENT" "$DATA")"

  # macOS has no flock(1); mkdir is atomic. Spin at most 50 x 20 ms, then
  # write anyway — never block Claude Code. A lock still held after 1 s is
  # stale (its holder died between mkdir and rmdir): remove it and log.
  CANDIDATE="$DIR/.lock-$SID"
  TRIES=0
  while ! mkdir "$CANDIDATE" 2>/dev/null; do
    TRIES=$((TRIES + 1))
    if [ "$TRIES" -ge 50 ]; then
      echo "$(date '+%Y-%m-%dT%H:%M:%S') cockpit-event: lock timeout on $CANDIDATE ($EVENT); wrote unlocked, stale lock removed" >&2
      rmdir "$CANDIDATE" 2>/dev/null
      break
    fi
    sleep 0.02
  done
  if [ "$TRIES" -lt 50 ]; then LOCK="$CANDIDATE"; fi
  printf '%s\n' "$LINE" >> "$DIR/events-$SID.jsonl"
  release

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
