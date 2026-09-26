#!/usr/bin/env bash
# Cockpit subagent status line (Claude Code `subagentStatusLine`, since 2026-09-26).
#
# Claude Code calls this script on every refresh of the agent panel under the
# input field and hands ALL visible subagent rows on stdin as a `tasks` list
# (id, name, type, status, description, label, startTime, model, effort,
# tokenCount, contextWindowSize, ...).
# Source: code.claude.com/docs/en/statusline#subagent-status-lines
#
# Two jobs:
# 1. MAILBOX: drop the list as subagents-<session>.json, so Cockpit's
#    Subagents card can show type, model, effort, and activity. Claude Code
#    hands this data to no other process otherwise.
# 2. CLEAR THE PANEL, but only inside Cockpit: per row `{"id": …, "content":
#    ""}` hides it per the docs ("emit an empty content string to hide it").
#    Outside a Cockpit tmux session, this script outputs NOTHING — then
#    Claude Code's default display stays, otherwise running subagents would
#    be invisible without Cockpit.
#
# Fail-open like statusline.sh: this script must never disturb Claude Code.
export LC_ALL=C
input=$(cat)

COCKPIT_DIR="${COCKPIT_DIR:-$HOME/.claude/cockpit}"
SESSION_ID=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)

if [ -d "$COCKPIT_DIR" ] && [ -n "$SESSION_ID" ]; then
  {
    tmp=$(mktemp "$COCKPIT_DIR/.subagents.XXXXXX") || exit 0
    printf '%s' "$input" | jq -c '{
      ts:    (now | floor),
      tasks: [ (.tasks // [])[] | {
        id, name, type, status, description, label, startTime,
        model, effort, tokenCount, contextWindowSize
      } ]
    }' > "$tmp" && mv -f "$tmp" "$COCKPIT_DIR/subagents-$SESSION_ID.json" || rm -f "$tmp"
  } 2>/dev/null || true
fi

# Is Claude Code running inside a Cockpit session? The launcher's sessions
# are named cockpit-<folder> (bin/cockpit). COCKPIT_IN_COCKPIT=1/0 overrides
# the detection (test rigs, or anyone who wants to keep the panel despite Cockpit).
in_cockpit() {
  case "${COCKPIT_IN_COCKPIT:-}" in
    1) return 0 ;;
    0) return 1 ;;
  esac
  [ -n "${TMUX:-}" ] || return 1
  name=$(tmux display-message -p '#S' 2>/dev/null) || return 1
  case "$name" in cockpit-*) return 0 ;; *) return 1 ;; esac
}

if in_cockpit; then
  printf '%s' "$input" | jq -c '(.tasks // [])[] | select(.id != null) | {id, content: ""}' 2>/dev/null || true
fi
exit 0
