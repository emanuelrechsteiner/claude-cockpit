#!/usr/bin/env bash
# Cockpit-Messfühler: hängt Hook-Ereignisse an events-<session_id>.jsonl an.
# Fail-open gegenüber Claude Code (exit 0 immer); Fehler landen in errors.log.
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
    # PRO SITZUNG (2026-08-04): current-session.json ist global — wer zuletzt
    # startet, ueberschreibt sie. Startet irgendwo eine zweite Claude-Sitzung,
    # verliert das Dashboard seine eigene Kennung und findet weder Briefkasten
    # noch Transcript. Real beobachtet: eine Sitzung im Heimatverzeichnis
    # ueberschrieb die des Projekts; die Kontext- und Verbrauchskarte standen
    # danach dauerhaft auf "wartet auf die Statuszeile".
    # Dieselbe Bauart wie events-<sid>.jsonl und status-<sid>.json.
    printf '%s' "$DATA" | jq -c '{session_id, transcript_path, cwd}' > "$DIR/session-$SID.json" 2>/dev/null || true
    # current-session.json bleibt zusaetzlich bestehen: Rueckfalllinie fuer
    # Aufrufe ohne COCKPIT_TARGET_CWD (dort gibt es keinen Ordner zum Abgleich).
    printf '%s' "$DATA" | jq -c '{session_id, transcript_path, cwd}' > "$DIR/current-session.json" 2>/dev/null || true
  fi
} 2>> "$DIR/errors.log" || true
exit 0
