#!/usr/bin/env bash
# Cockpit-Subagentenzeile (Claude Code `subagentStatusLine`, seit 2026-09-26).
#
# Claude Code ruft dieses Skript bei jeder Aktualisierung des Agenten-Panels
# unter dem Eingabefeld auf und uebergibt auf stdin ALLE sichtbaren
# Subagenten-Zeilen als `tasks`-Liste (id, name, type, status, description,
# label, startTime, model, effort, tokenCount, contextWindowSize, ...).
# Quelle: code.claude.com/docs/en/statusline#subagent-status-lines
#
# Zwei Aufgaben:
# 1. BRIEFKASTEN: die Liste als subagents-<session>.json ablegen, damit die
#    Subagenten-Karte des Cockpits Typ, Modell, Effort und Taetigkeit zeigen
#    kann. Diese Daten gibt Claude Code sonst keinem anderen Prozess.
# 2. PANEL LEEREN, aber nur im Cockpit: je Zeile `{"id": …, "content": ""}`
#    blendet sie laut Doku aus ("emit an empty content string to hide it").
#    Ausserhalb einer Cockpit-tmux-Sitzung gibt das Skript NICHTS aus — dann
#    bleibt die Standardanzeige von Claude Code stehen, sonst waeren laufende
#    Subagenten ohne Cockpit unsichtbar.
#
# Fail-open wie statusline.sh: dieses Skript darf Claude Code nie stoeren.
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

# Laeuft Claude Code in einer Cockpit-Sitzung? Die Launcher-Sitzungen heissen
# cockpit-<ordner> (bin/cockpit). COCKPIT_IN_COCKPIT=1/0 ueberschreibt die
# Erkennung (Pruefstaende, oder wer das Panel trotz Cockpit behalten will).
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
