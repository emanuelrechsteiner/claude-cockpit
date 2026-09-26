#!/usr/bin/env bash
# Cockpit installer — brings a machine to the same state as the maintainer's:
# Ghostty, tmux, Node, the Cockpit dashboard itself, Claude Code's hooks and
# status lines, and the "rcode" Ghostty color theme + keybindings.
#
# Usage:
#   bash <(curl -fsSL https://raw.githubusercontent.com/emanuelrechsteiner/claude-cockpit/main/install.sh)
#   bash install.sh              # from a local clone
#   bash install.sh --dry-run    # show the plan and current state, change nothing
#   bash install.sh --yes        # skip the single confirmation prompt
#
# Design goals (in order): full transparency (show the plan and the current
# state of every step BEFORE asking once, then one line per change as it
# happens), idempotency (a second run reports "nothing to do" everywhere and
# leaves files byte-identical), and fail-loud (a missing hard precondition
# aborts the whole run instead of limping through a half install).
#
# bash 3.2 compatible on purpose — that is what stock macOS ships. No
# associative arrays, no `mapfile`/`readarray`, no nameref locals.
#
# Overridable environment variables. The last five exist so the test suite
# can exercise this script without touching the real machine:
#   COCKPIT_DIR              install location (default: $HOME/.claude/cockpit)
#   COCKPIT_SETTINGS         Claude Code settings.json (default: $HOME/.claude/settings.json)
#   COCKPIT_GHOSTTY_CONFIG   Ghostty config file (default: $HOME/.config/ghostty/config)
#   COCKPIT_GHOSTTY_THEMES   Ghostty themes dir (default: $HOME/.config/ghostty/themes)
#   COCKPIT_BIN_DIR          where the `cockpit` symlink is placed (default: brew prefix bin, else ~/.local/bin)
#   COCKPIT_SKIP_BREW=1      skip installing Ghostty/tmux/Node/jq via Homebrew
#   COCKPIT_SKIP_NPM=1       skip `npm install`
set -euo pipefail

REPO_URL="https://github.com/emanuelrechsteiner/claude-cockpit.git"

HELP="Cockpit installer
Usage: install.sh [--yes] [--dry-run] [--help]
  --yes, -y     apply the plan without asking for confirmation
  --dry-run     print the plan and current state, change nothing
  --help, -h    show this text
See the header of install.sh for the overridable environment variables."

ASSUME_YES=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) printf '%s\n' "$HELP"; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Hard preconditions — fail loud, do nothing halfway.
# ---------------------------------------------------------------------------
if [ "$(uname -s)" != "Darwin" ]; then
  echo "Cockpit's launcher and keybinding setup are macOS/Ghostty-specific — aborting on $(uname -s)." >&2
  exit 1
fi
if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required to install Ghostty/tmux/Node/jq and was not found." >&2
  echo "Install it first: https://brew.sh — then re-run this script." >&2
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  echo "git is required to fetch the Cockpit source and was not found." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Path resolution (all overridable for tests)
# ---------------------------------------------------------------------------
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" || SELF_DIR=""
COCKPIT_DIR="${COCKPIT_DIR:-$HOME/.claude/cockpit}"
COCKPIT_SETTINGS="${COCKPIT_SETTINGS:-$HOME/.claude/settings.json}"
COCKPIT_GHOSTTY_CONFIG="${COCKPIT_GHOSTTY_CONFIG:-$HOME/.config/ghostty/config}"
COCKPIT_GHOSTTY_THEMES="${COCKPIT_GHOSTTY_THEMES:-$HOME/.config/ghostty/themes}"
SKIP_BREW="${COCKPIT_SKIP_BREW:-0}"
SKIP_NPM="${COCKPIT_SKIP_NPM:-0}"
if [ -z "${COCKPIT_BIN_DIR:-}" ]; then
  COCKPIT_BIN_DIR="$(brew --prefix)/bin"
fi

# Where do the config/* source files (settings snippet, ghostty snippet,
# theme) live right now? If we're already running from inside a checkout
# that has them, use that immediately — this is what makes the plan/preview
# below fully precise for the primary supported path ("bash install.sh from
# a clone"). If not (a bare `curl | bash` with nothing local yet), it stays
# empty until step 7 (clone) populates $COCKPIT_DIR.
SNIPPET_DIR=""
if [ -n "$SELF_DIR" ] && [ -f "$SELF_DIR/config/claude-settings-snippet.json" ]; then
  SNIPPET_DIR="$SELF_DIR/config"
fi

WARNINGS=""
warn() { WARNINGS="${WARNINGS}$1
"; }

# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

# version_ge HAVE WANT -> prints 1 or 0. Compares dotted-numeric prefixes
# only (so "3.7b" and "3.7" compare equal, and "22.22.0" >= "22" is true).
version_ge() {
  local have want
  have="$(printf '%s' "$1" | sed -E 's/^v?([0-9]+(\.[0-9]+)*).*/\1/')"
  want="$(printf '%s' "$2" | sed -E 's/^v?([0-9]+(\.[0-9]+)*).*/\1/')"
  awk -v h="$have" -v w="$want" 'BEGIN{
    n1=split(h,a,"."); n2=split(w,b,".");
    n=(n1>n2)?n1:n2;
    for(i=1;i<=n;i++){
      hv=(i<=n1)?a[i]:0; wv=(i<=n2)?b[i]:0;
      if (hv+0 > wv+0) { print 1; exit }
      if (hv+0 < wv+0) { print 0; exit }
    }
    print 1
  }'
}

# write_if_changed TARGET NEWCONTENTFILE LABEL — backs up TARGET (if it
# exists and differs), then replaces it. Prints exactly one status line.
# Idempotent: if NEWCONTENTFILE is byte-identical to TARGET, does nothing.
write_if_changed() {
  local target="$1" newfile="$2" label="$3"
  if [ -f "$target" ] && cmp -s "$target" "$newfile"; then
    echo "  = $label: already up to date ✓"
    return 0
  fi
  if [ -f "$target" ]; then
    local backup
    backup="${target}.bak-$(date +%Y%m%d-%H%M%S)"
    cp "$target" "$backup"
    mkdir -p "$(dirname "$target")"
    cp "$newfile" "$target"
    echo "  ~ $label: updated (previous version backed up to $backup)"
  else
    mkdir -p "$(dirname "$target")"
    cp "$newfile" "$target"
    echo "  + $label: created ($target)"
  fi
}

# ---------------------------------------------------------------------------
# The 12 steps. Index 0 is unused so step numbers below match array index.
# ---------------------------------------------------------------------------
STEP_DESC[1]="Verify macOS (required — Cockpit's launcher and keybindings are macOS/Ghostty-specific)"
STEP_DESC[2]="Verify Homebrew is installed (required to install Ghostty/tmux/Node/jq)"
STEP_DESC[3]="Install Ghostty via 'brew install --cask ghostty' if missing"
STEP_DESC[4]="Install tmux >= 3.3 via 'brew install tmux' if missing or older"
STEP_DESC[5]="Install Node.js >= 22 via 'brew install node' if missing or older"
STEP_DESC[6]="Install jq via 'brew install jq' if missing"
STEP_DESC[7]="Get the Cockpit source at $COCKPIT_DIR (git clone, or reuse/update if already present)"
STEP_DESC[8]="Run 'npm install' inside $COCKPIT_DIR"
STEP_DESC[9]="Put the 'cockpit' command on PATH ($COCKPIT_BIN_DIR/cockpit -> $COCKPIT_DIR/bin/cockpit)"
STEP_DESC[10]="Register Cockpit's hooks + status lines in $COCKPIT_SETTINGS"
STEP_DESC[11]="Install the 'rcode' Ghostty color theme into $COCKPIT_GHOSTTY_THEMES"
STEP_DESC[12]="Add Cockpit's Cmd+1-7 keybindings and enable the rcode theme in $COCKPIT_GHOSTTY_CONFIG"

print_plan() {
  echo "Cockpit installer — plan (nothing is written yet):"
  local i
  for i in $(seq 1 12); do
    printf ' %2d. %s\n' "$i" "${STEP_DESC[$i]}"
  done
}

# ---------------------------------------------------------------------------
# check_* functions: read-only, print a short machine-parseable status.
# ---------------------------------------------------------------------------
check_macos() { echo "present"; }               # we already aborted otherwise
check_brew()  { echo "present"; }               # we already aborted otherwise

check_ghostty() {
  if [ -d "/Applications/Ghostty.app" ] || command -v ghostty >/dev/null 2>&1; then
    echo "present"
  else
    echo "missing"
  fi
}

check_tmux() {
  if command -v tmux >/dev/null 2>&1; then
    local v; v="$(tmux -V 2>/dev/null | awk '{print $2}')"
    if [ "$(version_ge "$v" "3.3")" = "1" ]; then echo "present:$v"; else echo "outdated:$v"; fi
  else
    echo "missing"
  fi
}

check_node() {
  if command -v node >/dev/null 2>&1; then
    local v; v="$(node --version 2>/dev/null)"
    if [ "$(version_ge "$v" "22")" = "1" ]; then echo "present:$v"; else echo "outdated:$v"; fi
  else
    echo "missing"
  fi
}

check_jq() {
  if command -v jq >/dev/null 2>&1; then echo "present"; else echo "missing"; fi
}

check_clone() {
  if [ -n "$SELF_DIR" ] && [ "$SELF_DIR" = "$COCKPIT_DIR" ]; then
    echo "self"
  elif [ -d "$COCKPIT_DIR/.git" ]; then
    echo "git-present"
  elif [ -d "$COCKPIT_DIR" ]; then
    echo "present"
  else
    echo "missing"
  fi
}

check_npm() {
  if [ -d "$COCKPIT_DIR/node_modules" ]; then
    echo "present"
  elif [ "$SKIP_NPM" = "1" ]; then
    echo "skip"
  else
    echo "missing"
  fi
}

check_bin() {
  local target="$COCKPIT_BIN_DIR/cockpit" want="$COCKPIT_DIR/bin/cockpit"
  if [ -L "$target" ] && [ "$(readlink "$target")" = "$want" ]; then
    echo "present"
  elif [ -e "$target" ]; then
    echo "conflict"
  else
    echo "missing"
  fi
}

# compute_settings_merge SETTINGS_FILE -> stdout: SETTINGS_FILE with the
# hooks snippet merged in. Pure function — never writes SETTINGS_FILE.
compute_settings_merge() {
  local settings_file="$1"
  local base="{}"
  if [ -f "$settings_file" ]; then base="$(cat "$settings_file")"; fi
  printf '%s' "$base" | jq --slurpfile snippet "$SNIPPET_DIR/claude-settings-snippet.json" '
    def add_hook_to_block($block; $cmd; $hookObj):
      ($block.hooks // []) as $existing
      | if ([$existing[]?.command] | index($cmd)) != null
        then $block
        else $block + { hooks: ($existing + [$hookObj]) }
        end;
    def merge_event($existingArr; $snippetArr):
      reduce $snippetArr[] as $nblock
        ($existingArr // [];
          . as $acc
          | ($nblock.matcher) as $m
          | ( [$acc[] | .matcher] ) as $ms
          | if ($ms | index($m)) != null then
              $acc | map(
                if .matcher == $m then
                  add_hook_to_block(.; $nblock.hooks[0].command; $nblock.hooks[0])
                else . end)
            else
              $acc + [$nblock]
            end);
    ($snippet[0]) as $snip
    | (.hooks = (.hooks // {}))
    | reduce ($snip.hooks | keys_unsorted[]) as $ev
        (.; .hooks[$ev] = merge_event(.hooks[$ev]; $snip.hooks[$ev]))
  '
}

# statusline_state FIELD SETTINGS_FILE -> "missing" | "same" | "different:<cmd>"
statusline_state() {
  local field="$1" settings_file="$2"
  local current wanted
  current=""
  if [ -f "$settings_file" ]; then
    current="$(jq -r --arg f "$field" '.[$f].command // empty' "$settings_file" 2>/dev/null)"
  fi
  wanted="$(jq -r --arg f "$field" '.[$f].command' "$SNIPPET_DIR/claude-settings-snippet.json")"
  if [ -z "$current" ]; then
    echo "missing"
  elif [ "$current" = "$wanted" ]; then
    echo "same"
  else
    echo "different:$current"
  fi
}

check_settings() {
  if [ -z "$SNIPPET_DIR" ]; then echo "unknown"; return 0; fi
  if ! command -v jq >/dev/null 2>&1; then echo "unknown"; return 0; fi
  local merged current_hooks
  merged="$(compute_settings_merge "$COCKPIT_SETTINGS" | jq '.hooks')"
  current_hooks="{}"
  if [ -f "$COCKPIT_SETTINGS" ]; then current_hooks="$(jq '.hooks // {}' "$COCKPIT_SETTINGS")"; fi
  local hooks_state="same"
  if [ "$merged" != "$current_hooks" ]; then hooks_state="changed"; fi
  echo "hooks:$hooks_state status:$(statusline_state statusLine "$COCKPIT_SETTINGS") substatus:$(statusline_state subagentStatusLine "$COCKPIT_SETTINGS")"
}

# Turn check_settings' "hooks:<s> status:<s> substatus:<s>" into one readable line.
describe_settings() {
  local hooks status substatus parts=""
  hooks="$(printf '%s' "$1" | sed -E 's/^hooks:([a-z]+) .*/\1/')"
  status="$(printf '%s' "$1" | sed -E 's/.* status:([^ ]+) .*/\1/')"
  substatus="$(printf '%s' "$1" | sed -E 's/.* substatus:(.*)$/\1/')"
  if [ "$hooks" = "changed" ]; then parts="add the Cockpit hooks"; fi
  case "$status" in
    missing) parts="${parts:+$parts, }add statusLine" ;;
    different:*) parts="${parts:+$parts, }statusLine points elsewhere (${status#different:}) — will ask before replacing" ;;
  esac
  case "$substatus" in
    missing) parts="${parts:+$parts, }add subagentStatusLine" ;;
    different:*) parts="${parts:+$parts, }subagentStatusLine points elsewhere (${substatus#different:}) — will ask before replacing" ;;
  esac
  printf 'will change → %s (backup first)\n' "$parts"
}

# ---------------------------------------------------------------------------
# describe_*: turn a check_* result into one human-readable line.
# ---------------------------------------------------------------------------
describe_versioned() {
  local raw="$1"
  case "$raw" in
    present:*) echo "present ✓ (${raw#present:}) — nothing to do" ;;
    present) echo "present ✓ — nothing to do" ;;
    outdated:*) echo "outdated (${raw#outdated:}) → will upgrade" ;;
    missing) if [ "$SKIP_BREW" = "1" ]; then echo "missing → SKIPPED (COCKPIT_SKIP_BREW=1)"; else echo "missing → will install"; fi ;;
    *) echo "$raw" ;;
  esac
}

# report N STATUS — the shared two-line "N. <description>\n     -> <status>"
# layout used for every step, so alignment never depends on path length.
report() {
  printf '  %2d. %s\n      -> %s\n' "$1" "${STEP_DESC[$1]}" "$2"
}

print_status_pass() {
  echo
  echo "Current state:"
  report 1 "present ✓"
  report 2 "present ✓"
  report 3 "$(describe_versioned "$(check_ghostty)")"
  report 4 "$(describe_versioned "$(check_tmux)")"
  report 5 "$(describe_versioned "$(check_node)")"
  report 6 "$(describe_versioned "$(check_jq)")"

  local c; c="$(check_clone)"
  case "$c" in
    self) c="already running from $COCKPIT_DIR — nothing to clone" ;;
    git-present) c="present as a git checkout → will 'git pull --ff-only'" ;;
    present) c="already present (not a git checkout) — leaving as is" ;;
    missing) c="missing → will clone" ;;
  esac
  report 7 "$c"

  local n; n="$(check_npm)"
  case "$n" in
    present) n="present ✓ — nothing to do" ;;
    skip) n="SKIPPED (COCKPIT_SKIP_NPM=1)" ;;
    missing) n="missing → will run npm install" ;;
  esac
  report 8 "$n"

  local b; b="$(check_bin)"
  case "$b" in
    present) b="present ✓ — nothing to do" ;;
    conflict) b="a different file already exists there → will WARN, not overwrite" ;;
    missing) b="missing → will create symlink" ;;
  esac
  report 9 "$b"

  local s; s="$(check_settings)"
  if [ "$s" = "unknown" ]; then
    report 10 "(source not available yet — shown after step 7)"
  elif [ "$s" = "hooks:same status:same substatus:same" ]; then
    report 10 "present ✓ — nothing to do"
  else
    report 10 "$(describe_settings "$s")"
  fi

  if [ -n "$SNIPPET_DIR" ]; then
    local theme_target="$COCKPIT_GHOSTTY_THEMES/rcode"
    if [ -f "$theme_target" ] && cmp -s "$theme_target" "$SNIPPET_DIR/ghostty-theme-rcode"; then
      report 11 "present ✓ — nothing to do"
    else
      report 11 "missing or outdated → will (re)install"
    fi
    local kb_missing=0
    while IFS= read -r line; do
      if [ -f "$COCKPIT_GHOSTTY_CONFIG" ] && grep -qxF "$line" "$COCKPIT_GHOSTTY_CONFIG" 2>/dev/null; then
        :
      else
        kb_missing=$((kb_missing+1))
      fi
    done < <(grep '^keybind = ' "$SNIPPET_DIR/ghostty-snippet.conf")
    local theme_line_missing=1
    if [ -f "$COCKPIT_GHOSTTY_CONFIG" ] && grep -qxF "theme = rcode" "$COCKPIT_GHOSTTY_CONFIG" 2>/dev/null; then
      theme_line_missing=0
    fi
    if [ "$kb_missing" = "0" ] && [ "$theme_line_missing" = "0" ]; then
      report 12 "present ✓ — nothing to do"
    else
      report 12 "$kb_missing keybind line(s) + theme-line missing=$theme_line_missing → will update"
    fi
  else
    report 11 "(source not available yet — shown after step 7)"
    report 12 "(source not available yet — shown after step 7)"
  fi
}

# ---------------------------------------------------------------------------
# apply_*: perform the change (idempotent — safe to call unconditionally).
# ---------------------------------------------------------------------------
apply_brew_pkg() {
  # apply_brew_pkg LABEL RAW_STATUS INSTALL_CMD... — shared install/upgrade/skip logic
  local label="$1" raw="$2"; shift 2
  case "$raw" in
    present:*) echo "  = $label: present ✓ (${raw#present:})" ;;
    outdated:*)
      if [ "$SKIP_BREW" = "1" ]; then
        echo "  ~ $label: outdated (${raw#outdated:}) — skipped (COCKPIT_SKIP_BREW=1)"
      else
        echo "  ~ $label: outdated (${raw#outdated:}) — running: $*"
        "$@"
      fi
      ;;
    missing)
      if [ "$SKIP_BREW" = "1" ]; then
        echo "  ~ $label: missing — skipped (COCKPIT_SKIP_BREW=1)"
      else
        echo "  + $label: installing — running: $*"
        "$@"
      fi
      ;;
  esac
}

apply_ghostty() { apply_brew_pkg "Ghostty" "$(check_ghostty)" brew install --cask ghostty; }
apply_tmux()    { apply_brew_pkg "tmux" "$(check_tmux)" brew upgrade tmux; }
apply_node()    { apply_brew_pkg "Node.js" "$(check_node)" brew upgrade node; }
apply_jq()      { apply_brew_pkg "jq" "$(check_jq)" brew install jq; }

apply_clone() {
  local c; c="$(check_clone)"
  case "$c" in
    self) echo "  = Cockpit source: already running from $COCKPIT_DIR ✓" ;;
    present) echo "  = Cockpit source: already present at $COCKPIT_DIR (not a git checkout) ✓" ;;
    git-present)
      echo "  ~ Cockpit source: updating via 'git -C $COCKPIT_DIR pull --ff-only'"
      git -C "$COCKPIT_DIR" pull --ff-only
      ;;
    missing)
      echo "  + Cockpit source: cloning $REPO_URL into $COCKPIT_DIR"
      git clone "$REPO_URL" "$COCKPIT_DIR"
      ;;
  esac
  # Now that the clone step ran, the source is guaranteed to exist.
  if [ -z "$SNIPPET_DIR" ]; then
    SNIPPET_DIR="$COCKPIT_DIR/config"
  fi
  return 0
}

apply_npm() {
  local n; n="$(check_npm)"
  case "$n" in
    present) echo "  = npm install: node_modules present ✓" ;;
    skip) echo "  ~ npm install: skipped (COCKPIT_SKIP_NPM=1)" ;;
    missing)
      echo "  + npm install: running in $COCKPIT_DIR"
      ( cd "$COCKPIT_DIR" && npm install )
      ;;
  esac
}

apply_bin() {
  local b; b="$(check_bin)"
  local target="$COCKPIT_BIN_DIR/cockpit" want="$COCKPIT_DIR/bin/cockpit"
  case "$b" in
    present) echo "  = cockpit command: already on PATH at $target ✓" ;;
    conflict)
      echo "  ! cockpit command: $target already exists and is not our symlink — leaving it, please resolve manually"
      warn "'$target' exists and is not the Cockpit symlink — the 'cockpit' command may not be on PATH."
      ;;
    missing)
      mkdir -p "$COCKPIT_BIN_DIR"
      ln -s "$want" "$target"
      echo "  + cockpit command: symlinked $target -> $want"
      ;;
  esac
}

apply_settings() {
  local hooks_only settings_tmp status_state substatus_state
  settings_tmp="$(mktemp)"
  hooks_only="$(compute_settings_merge "$COCKPIT_SETTINGS")"

  status_state="$(statusline_state statusLine "$COCKPIT_SETTINGS")"
  substatus_state="$(statusline_state subagentStatusLine "$COCKPIT_SETTINGS")"

  local ov_status="false" ov_substatus="false"
  case "$status_state" in
    missing|same) ov_status="true" ;;
    different:*)
      local cur="${status_state#different:}"
      if [ "$ASSUME_YES" = "1" ]; then
        echo "  ~ statusLine: overwriting existing '$cur' (--yes; previous settings.json will be backed up)"
        ov_status="true"
      else
        printf '  statusLine is already set to a different command:\n    %s\n  Overwrite with Cockpit'"'"'s status line? [y/N] ' "$cur"
        read -r reply || reply=""
        case "$reply" in y|Y|yes|YES) ov_status="true" ;; *) echo "  ~ statusLine: keeping existing command (see README for how to chain it manually)" ;; esac
      fi
      ;;
  esac
  case "$substatus_state" in
    missing|same) ov_substatus="true" ;;
    different:*)
      local cur2="${substatus_state#different:}"
      if [ "$ASSUME_YES" = "1" ]; then
        echo "  ~ subagentStatusLine: overwriting existing '$cur2' (--yes; previous settings.json will be backed up)"
        ov_substatus="true"
      else
        printf '  subagentStatusLine is already set to a different command:\n    %s\n  Overwrite with Cockpit'"'"'s subagent status line? [y/N] ' "$cur2"
        read -r reply2 || reply2=""
        case "$reply2" in y|Y|yes|YES) ov_substatus="true" ;; *) echo "  ~ subagentStatusLine: keeping existing command" ;; esac
      fi
      ;;
  esac

  printf '%s' "$hooks_only" | jq --slurpfile snippet "$SNIPPET_DIR/claude-settings-snippet.json" \
    --argjson ovS "$ov_status" --argjson ovSA "$ov_substatus" '
    ($snippet[0]) as $snip
    | (if (.statusLine == null) or $ovS then .statusLine = $snip.statusLine else . end)
    | (if (.subagentStatusLine == null) or $ovSA then .subagentStatusLine = $snip.subagentStatusLine else . end)
  ' > "$settings_tmp"

  write_if_changed "$COCKPIT_SETTINGS" "$settings_tmp" "settings.json (hooks + status lines)"
  rm -f "$settings_tmp"
}

apply_theme_file() {
  local target="$COCKPIT_GHOSTTY_THEMES/rcode"
  write_if_changed "$target" "$SNIPPET_DIR/ghostty-theme-rcode" "rcode Ghostty theme"
}

apply_ghostty_config() {
  local tmp; tmp="$(mktemp)"
  if [ -f "$COCKPIT_GHOSTTY_CONFIG" ]; then
    cp "$COCKPIT_GHOSTTY_CONFIG" "$tmp"
    if [ -s "$tmp" ]; then
      case "$(tail -c1 "$tmp" | od -An -tx1 2>/dev/null)" in
        *0a*) : ;;
        *) printf '\n' >> "$tmp" ;;
      esac
    fi
  fi
  while IFS= read -r line; do
    grep -qxF "$line" "$tmp" 2>/dev/null || printf '%s\n' "$line" >> "$tmp"
  done < <(grep '^keybind = ' "$SNIPPET_DIR/ghostty-snippet.conf")
  grep -qxF "theme = rcode" "$tmp" 2>/dev/null || printf '%s\n' "theme = rcode" >> "$tmp"
  write_if_changed "$COCKPIT_GHOSTTY_CONFIG" "$tmp" "Ghostty config (keybindings + theme)"
  rm -f "$tmp"
}

apply_all_steps() {
  echo
  echo "Applying:"
  apply_ghostty
  apply_tmux
  apply_node
  apply_jq
  apply_clone
  apply_npm
  apply_bin
  apply_theme_file
  apply_ghostty_config
  apply_settings
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
print_plan
print_status_pass

if [ "$DRY_RUN" = "1" ]; then
  echo
  echo "Dry run — no changes were made."
  exit 0
fi

if [ "$ASSUME_YES" != "1" ]; then
  printf '\nProceed with the changes above? [y/N] '
  read -r reply || reply=""
  case "$reply" in
    y|Y|yes|YES) : ;;
    *) echo "Aborted — nothing was changed."; exit 0 ;;
  esac
fi

apply_all_steps

echo
echo "Done."
if [ -n "$WARNINGS" ]; then
  echo "Warnings:"
  printf '%s' "$WARNINGS" | sed 's/^/  ! /'
fi
echo
echo "Next steps:"
echo "  1. Reload Ghostty's config: Cmd+Shift+, (reload_config)"
echo "  2. In Ghostty, cd into a project"
echo "  3. Run: cockpit"
