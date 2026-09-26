# 0001 — Mouse in addition to the keyboard (click-focus, freely draggable divider)

Translated to English 2026-09-26; decision unchanged.

- Status: accepted
- Date: 2026-09-23

## Context

The original design decision from 2026-08-03
(internal design spec `docs/superpowers/specs/2026-08-03-cockpit-design.md`,
not part of the public repo; section "Decisions") set, for interacting
with the Cockpit dashboard: "Keyboard only, no mouse" —
`config/tmux-cockpit.conf` accordingly set `set -g mouse off`. This
decision made ⌘1-6 an additional functional necessity: since Terminal.app
structurally cannot send ⌘1-6 to Cockpit (it reserves ⌘1-9 for its own
window switching), `mouse off` without an alternative path made Ghostty
mandatory as the running terminal — there was no way to focus a pane by
clicking or to change the column width between the two panes.

On 2026-09-23, the user reported this directly as a symptom: the right
column could not be selected by clicking, the divider could not be
dragged. Measured on the running server: `tmux show-options -g mouse` →
`off`. The user explicitly reversed the decision ("1 with mouse",
additionally "freely draggable" for the divider).

## Decision

`config/tmux-cockpit.conf` sets `mouse on` instead of `mouse off`. This
provides two additional interaction paths, without changing the existing
keyboard control (⌘1-6 + arrow keys/Enter/Esc, `src/ui/paneFocus.ts`):

- **Click-focus:** clicking a pane makes it the active pane (tmux's
  default binding `MouseDown1Pane` → `select-pane`, no custom binding
  needed).
- **Freely draggable divider:** holding a click on the vertical divider
  between the panes and dragging changes the column width (tmux's default
  binding `MouseDrag1Border` → `resize-pane -M`).

Ghostty remains mandatory for ⌘1-6 (unchanged from the original decision)
— the mouse is the additional, terminal-independent path, not a
replacement for the keybinding's Ghostty dependency.

Behavioral proof: `tests/e2e/mouse-check.sh` — a real tmux client attached
via a pseudo-terminal sends SGR mouse events to a throwaway server
(`-L cockpit-mouse-proof`); what's checked is the actual focus switch and
the actual width change of both panes, not the config declaration. A
counter-check with `mouse off` shows that both effects are absent without
the option.

## Consequences

**Gets easier:**
- Cockpit can still be operated when ⌘1-6 doesn't arrive for some reason
  (e.g. Terminal.app, a Ghostty config mistake, or simply a user
  preference for the mouse).
- The column width (previously fixed via `-l 48` at startup) can be
  adjusted at runtime, without restarting `bin/cockpit`.

**Gets harder / side effects:**
- The mouse wheel now scrolls through the tmux pane history instead of
  the app's native terminal scrollback underneath — a familiar gesture
  behaves differently than before.
- Selecting text with the mouse (for copying) needs an extra key in
  Ghostty: holding Shift while clicking/dragging, because Ghostty by
  default (`mouse-shift-capture = false`, measured via
  `ghostty +show-config --default --docs`) does not send Shift with the
  mouse protocol and instead keeps the selection native in the terminal.
  This behavior is not checked for Terminal.app.
- An accidental click (e.g. while scrolling with a trackpad) can now shift
  focus unintentionally — previously structurally excluded.

**Not affected:** keyboard control (⌘1-6, arrow keys, Enter, Esc, `q`)
stays exactly as it was before this decision; none of the existing
regressions (`tests/e2e/navigation-check.sh`, `tests/e2e/resize-regression.sh`,
`tests/e2e/ghostty-keybind-check.sh`) change their result.
