#!/usr/bin/env bash
# Checks Cockpit's Ghostty keybindings — the file itself AND, if Ghostty is
# installed, how Ghostty actually resolves it.
#
# Why this check exists (2026-08-04): ⌘1-6 didn't reach the dashboard, even
# though tmux bindings and the dashboard were both demonstrably correct. The
# cause sat right at the start of the chain: Ghostty carries TWO slots per
# key — the physical key (`physical:one` / internally `digit_1`) and the
# character produced (`one` / internally `1`) — and its default assigns BOTH
# to `goto_tab`. The first version of the snippet bound only the translated
# slot; the physical one stayed on the tab switch, and that one wins on a
# keypress.
#
# This check catches exactly that regression.
#
# Usage:  bash tests/e2e/ghostty-keybind-check.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
SNIPPET="config/ghostty-snippet.conf"

PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf '  [%s] expected=%s got=%s\n' "$1" "$2" "$3"; fi; }

[ -f "$SNIPPET" ] || { echo "Snippet missing: $SNIPPET" >&2; exit 1; }

# ── A) The snippet itself: both slots per digit ───────────────────────────────
for n in one two three four five six seven; do
  check "snippet/physical-$n" 1 "$(grep -c "^keybind = cmd+physical:$n=text:" "$SNIPPET")"
  check "snippet/logical-$n"  1 "$(grep -c "^keybind = cmd+$n=text:" "$SNIPPET")"
done
check "snippet/fourteen-bindings" 14 "$(grep -c '^keybind = cmd+' "$SNIPPET")"

# ── B) Ghostty resolves it as expected (only if installed AND the user has
#      adopted the snippet) ───────────────────────────────────────────────────
GH=/Applications/Ghostty.app/Contents/MacOS/ghostty
if [ -x "$GH" ] && [ -f "$HOME/.config/ghostty/config" ] \
   && grep -q 'ck1' "$HOME/.config/ghostty/config" 2>/dev/null; then
  check "ghostty/config-valid" "" "$("$GH" +validate-config 2>&1)"
  KB=$("$GH" +list-keybinds 2>/dev/null)
  # No more goto_tab on 1-7 — that was the bug (7 since 2026-09-24).
  check "ghostty/no-goto_tab-on-1-7" 0 "$(grep -cE 'super\+(digit_)?[1-7]=goto_tab' <<<"$KB")"
  # All fourteen slots point at Cockpit.
  check "ghostty/fourteen-cockpit-bindings" 14 "$(grep -cE 'super\+(digit_)?[1-7]=text:.*ck[1-7]' <<<"$KB")"
  # NOT too much captured: 8 must still switch tabs.
  check "ghostty/8-untouched" 2 "$(grep -cE 'super\+(digit_)?8=goto_tab' <<<"$KB")"
else
  echo "  (Ghostty part skipped: not installed, or the snippet was not adopted)"
fi

# ── C) Visible precondition: is Ghostty even running? (not a pass/fail) ──────
# A) and B) check ONLY the CONFIG FILE and how the Ghostty BINARY resolves it
# statically — that is no proof that the CURRENTLY RUNNING terminal session
# is Ghostty. "17/17 green" therefore does not mean "chain ⌘1-6 -> dashboard
# closed". TERM_PROGRAM is unsuitable for this question once tmux is
# attached: tmux overwrites it to "tmux" for every pane process (measured
# 2026-09-23) — hence the process list.
if pgrep -x ghostty >/dev/null 2>&1 || pgrep -f '/Applications/Ghostty.app/Contents/MacOS/ghostty' >/dev/null 2>&1; then
  echo "  Precondition: Ghostty is running as a process — ⌘1-7 can in principle reach this session."
else
  echo "  ⚠ Precondition NOT met: Ghostty is NOT running — ⌘1-7 cannot reach any running terminal session, even if A) and B) above are green."
fi

printf '── ghostty-keybind-check: %d passed, %d failed ──\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
