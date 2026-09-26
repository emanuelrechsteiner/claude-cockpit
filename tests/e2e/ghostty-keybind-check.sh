#!/usr/bin/env bash
# Prueft die Ghostty-Tastenbelegung des Cockpits — die Datei UND, falls Ghostty
# installiert ist, wie Ghostty sie tatsaechlich auflöst.
#
# Warum es diese Pruefung gibt (2026-08-04): ⌘1-6 erreichte das Dashboard nicht,
# obwohl tmux-Bindungen und Dashboard beide nachweislich korrekt waren. Ursache
# lag ganz am Anfang der Kette: Ghostty fuehrt je Taste ZWEI Steckplaetze — die
# physische Taste (`physical:one` / intern `digit_1`) und das erzeugte Zeichen
# (`one` / intern `1`) — und belegt in seiner Vorgabe BEIDE mit `goto_tab`.
# Die erste Fassung des Schnipsels band nur den uebersetzten Steckplatz; der
# physische blieb beim Tab-Wechsel, und der gewinnt beim Tastendruck.
#
# Diese Pruefung faengt genau diesen Rueckfall.
#
# Aufruf:  bash tests/e2e/ghostty-keybind-check.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
SNIPPET="config/ghostty-snippet.conf"

PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf '  [%s] erwartet=%s bekommen=%s\n' "$1" "$2" "$3"; fi; }

[ -f "$SNIPPET" ] || { echo "Schnipsel fehlt: $SNIPPET" >&2; exit 1; }

# ── A) Der Schnipsel selbst: beide Steckplaetze je Ziffer ────────────────────
for n in one two three four five six seven; do
  check "schnipsel/physical-$n" 1 "$(grep -c "^keybind = cmd+physical:$n=text:" "$SNIPPET")"
  check "schnipsel/logisch-$n"  1 "$(grep -c "^keybind = cmd+$n=text:" "$SNIPPET")"
done
check "schnipsel/vierzehn-bindungen" 14 "$(grep -c '^keybind = cmd+' "$SNIPPET")"

# ── B) Ghostty loest es auf wie erwartet (nur wenn installiert UND der Nutzer
#      den Schnipsel uebernommen hat) ─────────────────────────────────────────
GH=/Applications/Ghostty.app/Contents/MacOS/ghostty
if [ -x "$GH" ] && [ -f "$HOME/.config/ghostty/config" ] \
   && grep -q 'ck1' "$HOME/.config/ghostty/config" 2>/dev/null; then
  check "ghostty/konfiguration-gueltig" "" "$("$GH" +validate-config 2>&1)"
  KB=$("$GH" +list-keybinds 2>/dev/null)
  # Kein goto_tab mehr auf 1-7 — das war der Fehler (7 seit 2026-09-24).
  check "ghostty/kein-goto_tab-auf-1-7" 0 "$(grep -cE 'super\+(digit_)?[1-7]=goto_tab' <<<"$KB")"
  # Alle vierzehn Steckplaetze zeigen auf das Cockpit.
  check "ghostty/vierzehn-cockpit-bindungen" 14 "$(grep -cE 'super\+(digit_)?[1-7]=text:.*ck[1-7]' <<<"$KB")"
  # NICHT zu viel gekapert: 8 muss weiter Tabs wechseln.
  check "ghostty/8-unberuehrt" 2 "$(grep -cE 'super\+(digit_)?8=goto_tab' <<<"$KB")"
else
  echo "  (Ghostty-Teil uebersprungen: nicht installiert oder Schnipsel nicht uebernommen)"
fi

# ── C) Sichtbare Vorbedingung: laeuft Ghostty ueberhaupt? (kein Pass/Fail) ────
# A) und B) pruefen ausschliesslich die KONFIGURATIONSDATEI und wie das
# Ghostty-BINARY sie statisch aufloest — das ist kein Nachweis, dass die
# GERADE LAUFENDE Terminalsitzung Ghostty ist. "17/17 gruen" bedeutet daher
# nicht "Kette ⌘1-6 -> Dashboard geschlossen". TERM_PROGRAM ist fuer diese
# Frage ungeeignet, sobald tmux angehaengt ist: tmux ueberschreibt es fuer
# jeden Pane-Prozess auf "tmux" (gemessen 2026-09-23) — deshalb Prozessliste.
if pgrep -x ghostty >/dev/null 2>&1 || pgrep -f '/Applications/Ghostty.app/Contents/MacOS/ghostty' >/dev/null 2>&1; then
  echo "  Vorbedingung: Ghostty läuft als Prozess — ⌘1-7 kann diese Sitzung grundsätzlich erreichen."
else
  echo "  ⚠ Vorbedingung NICHT erfüllt: Ghostty läuft NICHT — ⌘1-7 kann keine laufende Terminalsitzung erreichen, auch wenn A) und B) oben grün sind."
fi

printf '── ghostty-keybind-check: %d bestanden, %d fehlgeschlagen ──\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
