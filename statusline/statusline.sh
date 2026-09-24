#!/usr/bin/env bash
# Cockpit-Statusline: Modell | Kontext% (Ampel 50/75) | Kosten | Branch
# Ersetzt ~/.claude/statusline-command.sh (Plugins zeigt jetzt die Cockpit-Karte 6).
#
# Zweitaufgabe seit 2026-08-04: BRIEFKASTEN fuer das Dashboard.
# Claude Code uebergibt dieses JSON NUR der Statuszeile, auf stdin, bei jeder
# Aktualisierung. Das Dashboard ist ein eigener Prozess und sieht es nie. Die
# Statuszeile legt die paar Felder deshalb als status.json ab; das Dashboard
# liest sie beim Abfragetakt. Ohne diesen Umweg gaebe es weder eine
# Kontext- noch eine Verbrauchskarte — die Daten existieren sonst nirgends.
export LC_ALL=C
input=$(cat)
MODEL=$(printf '%s' "$input" | jq -r '.model.display_name // "?"')
PCT=$(printf '%s' "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
[ -n "$PCT" ] || PCT=0
COST=$(printf '%s' "$input" | jq -r '.cost.total_cost_usd // 0')
DIR=$(printf '%s' "$input" | jq -r '.workspace.current_dir // "."')
BRANCH=$(git -C "$DIR" branch --show-current 2>/dev/null || echo '-')
[ -n "$BRANCH" ] || BRANCH='-'

# --- Briefkasten schreiben ---------------------------------------------------
# Fail-open: die Statuszeile darf NIE wegen des Dashboards ausfallen. Sie ist
# das, was der Mensch sieht; das Dashboard ist Beiwerk. Deshalb `|| true`.
# Atomar via mktemp+mv, damit das Dashboard nie eine halbe Datei liest.
# PRO SITZUNG ablegen, nicht global: laufen zwei Cockpits nebeneinander
# (ein tmux-Fenster je Projekt), ueberschrieben sie sonst gegenseitig ihre
# Zahlen — dasselbe Muster, das current-session.json bereits den cwd-Abgleich
# gekostet hat. Ohne session_id bleibt der Briefkasten leer statt falsch.
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
      # total_input_tokens sind die Token IM FENSTER (Cache-Lesungen und
      # -Schreibungen eingerechnet). NICHT current_usage.input_tokens nehmen:
      # das ist nur der letzte API-Aufruf. Real gemessen 2026-08-04 bei 41 %
      # eines 1-Mio-Fensters: total_input_tokens ~410000, aber
      # current_usage.input_tokens = 2. Die Karte haette "2 von 1.0M Token"
      # angezeigt — eine Zahl, die stimmt und trotzdem das Falsche aussagt.
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
      # rate_limits gibt es nur fuer Claude.ai-Abos und erst nach der ersten
      # API-Antwort der Sitzung; jedes Fenster kann einzeln fehlen. Absenz wird
      # als null durchgereicht und in der Karte als "noch keine Angabe"
      # ausgewiesen — nicht als 0 %, das waere eine Falschaussage.
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

# --- Ausgabe -----------------------------------------------------------------
if   [ "$PCT" -ge 75 ]; then C='\033[31m'
elif [ "$PCT" -ge 50 ]; then C='\033[33m'
else C='\033[32m'; fi
LC_NUMERIC=C printf "%s | ${C}%s%%\033[0m ctx | \$%.2f | %s" "$MODEL" "$PCT" "$COST" "$BRANCH"
