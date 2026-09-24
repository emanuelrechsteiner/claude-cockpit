<!--
Status: ACTIVE
Purpose: Public README for the standalone claude-cockpit repository
-->

# Cockpit

A tmux sidebar dashboard for [Claude Code](https://code.claude.com) CLI. It runs
in a pane next to Claude Code and shows two always-on info cards (context,
usage) plus six numbered, operable cards (Team Lead, subagents, workflows,
links, files, plugins) fed by Claude Code's own hooks, its session transcript,
and `claude agents --json`.

![Cockpit overview](docs/assets/cockpit-uebersicht.png)
*Demo data — sample session shown for illustration.*

![Cockpit two-pane layout](docs/assets/cockpit-spalte.png)
*Demo data — sample session shown for illustration.*

![Cockpit card focused](docs/assets/cockpit-fokus.png)
*Demo data — sample session shown for illustration.*

## What it is

- **Two info cards** (no number): Context and Usage. Nothing to select there,
  so they carry no shortcut.
- **Six operable cards** (1–6): Team Lead, Subagents, Workflows, Links, Files,
  Plugins. Only numbered cards are reachable via ⌘1–6.
- Data sources: Claude Code hooks (`SessionStart`, `PreToolUse`,
  `PostToolUse`, `Stop`, `SubagentStop`) write an events log the dashboard
  polls; the session transcript and `claude agents --json` fill in the rest;
  the status line writes context/usage numbers to a per-session file (see
  `cockpit-event.sh` and `statusline/statusline.sh` in this repo).

## Requirements

- **macOS.** The launcher (`bin/cockpit`) and keybinding setup below are
  macOS/Ghostty-specific.
- **[Ghostty](https://ghostty.org)** as the terminal you actually run the
  session in (not merely installed) — Ghostty is what turns ⌘1–6 into an
  escape sequence tmux can route to the dashboard pane. Terminal.app cannot
  send ⌘1–6 to Cockpit (it reserves ⌘1–9 for its own window/tab switching),
  so `bin/cockpit` warns loudly at startup (without aborting) if
  `$TERM_PROGRAM` isn't `ghostty`. The mouse (see below) works regardless of
  terminal.
- **tmux ≥ 3.3** (developed and tested against 3.7b).
- **Node.js** (developed and tested against Node 22; no strict version is
  pinned in `package.json`).
- `npm install` in the installed copy (see below).

## Installation

Cockpit is designed to be installed as a full local copy at
`~/.claude/cockpit` — both the launcher (`bin/cockpit`) and the event hook
(`hooks/cockpit-event.sh`) resolve their own location from `$HOME/.claude/cockpit`
by default (overridable via `$COCKPIT_DIR`).

```bash
git clone https://github.com/emanuelrechsteiner/claude-cockpit.git ~/.claude/cockpit
cd ~/.claude/cockpit
npm install
```

### Register the hooks and status line

Cockpit observes Claude Code entirely through hooks and a status-line script
registered in Claude Code's `~/.claude/settings.json` — it does not patch
Claude Code itself. Merge the fragment in
[`config/claude-settings-snippet.json`](config/claude-settings-snippet.json)
into your own `settings.json`: for each `hooks.<Event>` entry, either add the
whole matcher block if you don't already have one for that event/matcher, or
append the one `cockpit-event.sh` command into your existing matcher's
`hooks` array. The `statusLine` entry replaces (or becomes) your status-line
command; if you already run a different status line, keep it and point
Cockpit's data collector at that script's output instead (see
`statusline/statusline.sh`).

The snippet registers 9 things in total: 8 hook entries (`SessionStart` ×2,
`PreToolUse`, `PostToolUse` ×3, `Stop`, `SubagentStop`) plus the `statusLine`
command.

### Ghostty keybindings

Append [`config/ghostty-snippet.conf`](config/ghostty-snippet.conf) to
`~/.config/ghostty/config`, then reload Ghostty's config with **⌘+Shift+,**
(`reload_config`) — a plain restart of the terminal is not required, but a
config file left unreloaded is; Ghostty keeps running on the config it had at
launch until you send this.

## Usage

```bash
cd <your-project>
cockpit          # opens tmux: Claude Code on the left, the dashboard on the right
```

**Focus follows the card** (since the underlying framework's 2026-08-04
change): pressing ⌘1–6 both selects a card and moves keyboard focus to the
dashboard pane, so arrow keys and Enter act on it immediately, GUI-panel
style. Esc returns focus to Claude. A focused card is shown in cyan, and the
footer reads "▶ keyboard here" while focus is on the dashboard.

| Key | Effect |
|---|---|
| ⌘+1..6 | Focus a card **and** move the keyboard to the dashboard (from any pane) |
| ↑ ↓ | Select an entry |
| ⏎ | Open the selected link/file; on the Plugins card: open/run the action bar |
| ← → | Choose a plugin action (enable/disable/update/reauth) |
| Esc | Close the action bar, or — if none is open — release the card and return focus to Claude |
| q | Quit the dashboard — only when no card is selected (otherwise a typed word containing "q" would quit it) |
| any other letter | You meant Claude: focus returns and the character is forwarded left — nothing is lost |
| ⌘+Click | Open an OSC-8 link directly |
| Click (mouse) | Focus that pane — an alternative to ⌘1–6, works regardless of which terminal you're in |
| Drag the divider | Freely resize the two panes |
| Shift+Click/drag (Ghostty) | Select text natively instead of reporting the click to tmux |

Markdown files open via Enter with "MD Viewer.app" if installed; everything
else with `open`.

## Known limits

- **Plugin changes take effect only from the next Claude Code session** — a
  running session only loads plugins at startup. The card marks this as
  "takes effect next session".
- **Re-auth** triggers `claude mcp login <server>`; the actual login happens
  in your browser.
- **Link/file detection is a young heuristic** — tune `config/rules.json`
  (patterns for artifacts/previews/sources, candidate file names).
- **Team Lead card:** `claude agents --json` doesn't always return a `state`
  field; without one, "working" is assumed.
- **Usage card requires a Claude.ai subscription plan.** `rate_limits` is
  only returned to Pro/Max accounts, and only after a session's first API
  response; either window (5h / 7d) can be individually absent. Missing
  values are shown as "not yet available" — **never as 0%**, which would be
  a false claim.
- **Context and usage numbers are only as fresh as the status line.** They
  update only while Claude is actively working; once a session goes idle,
  the numbers age and are marked stale after 120 seconds.
- **After a window resize, the pane can stay blank for up to 2 seconds**
  until the next poll redraws it — the trade-off for avoiding leftover
  "ghost frames" (see below).
- **Ghost frames are mitigated, not eliminated.** [Ink](https://github.com/vadimdemedes/ink)'s
  own docs still warn about ghost lines on narrowing, and its line-count
  tracking remains column-unaware on window resize (a known open Ink issue)
  — a manual screen-wipe handler is the second, independent safeguard this
  dashboard relies on in addition to Ink's own resize handling.

## Companion framework

Cockpit was built alongside, and reads state produced by,
[claude-rcode](https://github.com/emanuelrechsteiner/claude-rcode) — a
Claude Code development framework (rules, agents, hooks, skills). Cockpit
itself has no hard dependency on it; the Team Lead / Subagents / Workflows
cards are simply most useful in a project using that framework's
orchestration conventions.

## License

MIT — see [LICENSE](LICENSE).
