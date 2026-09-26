#!/usr/bin/env bash
# Cockpit status line: model | context% (traffic light 50/75) | cost | branch
# Replaces ~/.claude/statusline-command.sh (plugins are now shown by Cockpit card 6).
#
# Second job since 2026-08-04: MAILBOX for the dashboard.
# Claude Code hands this JSON ONLY to the status line, on stdin, on every
# refresh. The dashboard is a separate process and never sees it. The status
# line therefore drops the few fields as status.json; the dashboard reads
# them on its poll tick. Without this detour there would be neither a
# Context nor a Usage card — the data doesn't exist anywhere else.
export LC_ALL=C
input=$(cat)
MODEL=$(printf '%s' "$input" | jq -r '.model.display_name // "?"')
PCT=$(printf '%s' "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
[ -n "$PCT" ] || PCT=0
COST=$(printf '%s' "$input" | jq -r '.cost.total_cost_usd // 0')
DIR=$(printf '%s' "$input" | jq -r '.workspace.current_dir // "."')
BRANCH=$(git -C "$DIR" branch --show-current 2>/dev/null || echo '-')
[ -n "$BRANCH" ] || BRANCH='-'

# --- Write the mailbox --------------------------------------------------------
# Fail-open: the status line must NEVER fail because of the dashboard. It is
# what the human sees; the dashboard is a bonus. Hence `|| true`.
# Atomic via mktemp+mv, so the dashboard never reads a half-written file.
# Written PER SESSION, not globally: if two Cockpits run side by side (one
# tmux window per project), they would otherwise overwrite each other's
# numbers — the same pattern that already cost current-session.json its cwd
# matching. Without a session_id the mailbox stays empty instead of wrong.
COCKPIT_DIR="${COCKPIT_DIR:-$HOME/.claude/cockpit}"
SESSION_ID=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
if [ -d "$COCKPIT_DIR" ] && [ -n "$SESSION_ID" ]; then
  {
    tmp=$(mktemp "$COCKPIT_DIR/.status.XXXXXX") || exit 0
    printf '%s' "$input" | jq -c '{
      ts:            (now | floor),
      session_id:    (.session_id // null),
      cwd:           (.workspace.current_dir // .cwd // null),
      model:         (.model.display_name // null),
      # total_input_tokens are the tokens IN THE WINDOW (cache reads and
      # writes included). Do NOT take current_usage.input_tokens: that is
      # only the last API call. Really measured 2026-08-04 at 41% of a
      # 1M window: total_input_tokens ~410000, but current_usage.input_tokens
      # = 2. The card would have shown "2 of 1.0M tokens" — a number that is
      # correct and still says the wrong thing.
      context: {
        used_percentage: (.context_window.used_percentage // null),
        window_size:     (.context_window.context_window_size // null),
        input_tokens:    (.context_window.total_input_tokens // null),
        output_tokens:   (.context_window.total_output_tokens // null)
      },
      cost: {
        total_usd:       (.cost.total_cost_usd // null),
        duration_ms:     (.cost.total_duration_ms // null),
        lines_added:     (.cost.total_lines_added // null),
        lines_removed:   (.cost.total_lines_removed // null)
      },
      # rate_limits only exists for Claude.ai subscription plans and only
      # after the first API response of the session; either window can be
      # individually absent. Absence is passed through as null and shown on
      # the card as "not yet available" — not as 0%, which would be a false
      # claim.
      rate_limits: {
        five_hour: (if .rate_limits.five_hour then {
          used_percentage: .rate_limits.five_hour.used_percentage,
          resets_at:       .rate_limits.five_hour.resets_at
        } else null end),
        seven_day: (if .rate_limits.seven_day then {
          used_percentage: .rate_limits.seven_day.used_percentage,
          resets_at:       .rate_limits.seven_day.resets_at
        } else null end)
      }
    }' > "$tmp" && mv -f "$tmp" "$COCKPIT_DIR/status-$SESSION_ID.json" || rm -f "$tmp"
  } 2>/dev/null || true
fi

# --- Output --------------------------------------------------------------
if   [ "$PCT" -ge 75 ]; then C='\033[31m'
elif [ "$PCT" -ge 50 ]; then C='\033[33m'
else C='\033[32m'; fi
LC_NUMERIC=C printf "%s | ${C}%s%%\033[0m ctx | \$%.2f | %s" "$MODEL" "$PCT" "$COST" "$BRANCH"
