import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { countEchoes, hasReply } from '../models.js';

/**
 * Returns tmux focus to the left pane (Claude) — and, on request, forwards a
 * character that landed here by accident along with it.
 *
 * Background: since 2026-08-04, ⌘1-6 moves tmux focus onto the dashboard
 * along with the card selection, so arrows and Enter work without any
 * further key combination (GUI behavior: select a panel, work in it, leave
 * again). The cost would otherwise be that a user keeps typing after looking
 * at the card and their text disappears into the dashboard. So: the first
 * ordinary character sends focus back AND is forwarded left — nothing is
 * lost, and from the second character on you type normally again.
 *
 * Fail-open in every respect: outside tmux nothing happens, and a failure in
 * the tmux call must never disturb the dashboard.
 */

/** Panes only exist at all inside a tmux session. */
function inTmux(): boolean {
  return typeof process.env['TMUX'] === 'string' && process.env['TMUX'] !== '';
}

/**
 * `-L` selects the pane to the LEFT of the active one, direction-relative.
 * The launcher always places the dashboard on the right (`split-window -h`),
 * so this matches.
 */
export function returnFocusLeft(): void {
  if (!inTmux()) return;
  execFile('tmux', ['select-pane', '-L'], () => {
    /* fail-open: a failed focus switch must never block anything */
  });
}

/**
 * Sends a character to the left pane. `-l` = literal, so tmux doesn't
 * interpret it as a key name ("q" would otherwise stay q, but "Enter" would
 * be a special case); `--` ends the option list so a character like "-"
 * isn't read as a flag. execFile with an argument list, so NO shell — the
 * text comes from the keyboard and is never interpreted anywhere.
 */
export function forwardToLeft(text: string): void {
  if (!inTmux() || text === '') return;
  execFile('tmux', ['send-keys', '-l', '-t', '{left}', '--', text], () => {
    /* fail-open */
  });
}

const tmuxRun = promisify(execFile);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Visible content on the left plus 200 lines of history; -J joins wrapped lines. */
async function captureLeft(): Promise<string> {
  const { stdout } = await tmuxRun('tmux', ['capture-pane', '-p', '-J', '-t', '{left}', '-S', '-200']);
  return stdout;
}

/**
 * Types whole command lines into the left pane and submits each with Enter
 * (Model & Effort card). Unlike the character forwarding above, this is NOT
 * fail-open: someone who chose "Opus · high" needs to know if it didn't
 * arrive — the caller shows the error on the card.
 *
 * Before each further line, it waits until Claude has visibly answered the
 * previous one (see hasReply in models.ts — that's where it explains why a
 * fixed pause wasn't enough). If the reply doesn't come, e.g. because Claude
 * is in the middle of answering something else, the rest is NOT sent blind.
 */
export async function submitToLeft(lines: string[], replyTimeoutMs = 6000): Promise<void> {
  if (!inTmux()) throw new Error('no tmux — left pane unreachable');
  for (const [i, line] of lines.entries()) {
    const echoesBefore = countEchoes(await captureLeft(), line);
    await tmuxRun('tmux', ['send-keys', '-l', '-t', '{left}', '--', line]);
    await tmuxRun('tmux', ['send-keys', '-t', '{left}', 'Enter']);
    if (i === lines.length - 1) break;
    const deadline = Date.now() + replyTimeoutMs;
    while (!hasReply(await captureLeft(), line, echoesBefore)) {
      if (Date.now() > deadline) throw new Error(`${line} unconfirmed — rest not sent`);
      await pause(150);
    }
    await pause(250);
  }
}
