import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface CurrentSession {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
}

/**
 * Finds the Claude session that belongs to THIS dashboard.
 *
 * Why this isn't trivial: `current-session.json` is a SINGLE global file —
 * whoever starts last overwrites it. If a second Claude session starts
 * anywhere (even in a completely different folder), a running dashboard
 * loses its own identifier and finds neither its mailbox nor the transcript.
 * Really observed 2026-08-04: a session in the home directory overwrote the
 * project's; the Context and Usage cards then permanently read "waiting for
 * the status line", even though the mailbox was full.
 *
 * Fix: the hook additionally writes `session-<sid>.json` per session — the
 * same pattern as `events-<sid>.jsonl` and `status-<sid>.json`. This
 * function searches them for the matching folder and takes the one with the
 * most recent ACTIVITY, not the one that started most recently.
 *
 * Why activity, not start time: really observed 2026-09-26 — a headless
 * `claude -p` probe (e.g. from a test suite) started in the same folder
 * AFTER the real interactive session. Its SessionStart hook wrote
 * `session-<probe>.json` and one line into `events-<probe>.jsonl`, then it
 * exited. Ranking by session-file mtime alone made the dead probe look
 * "newest" forever, even though the real session kept writing
 * `events-<sid>.jsonl` and `status-<sid>.json` every turn. Ranking by the
 * newest mtime across a session's own `session-`, `events-`, `status-`, and
 * `subagents-` files fixes this: an idle probe's activity timestamp freezes
 * at its single SessionStart write, while a live session's timestamp keeps
 * advancing. A genuinely new interactive session still wins on its first
 * turn, because SessionStart itself writes both the session and events
 * files with a fresh mtime.
 *
 * `current-session.json` remains the fallback for the case without a folder
 * given — there is nothing to match against there.
 */
export function resolveSession(cockpitDir: string, targetCwd?: string): CurrentSession {
  if (targetCwd !== undefined) {
    const match = newestSessionFor(cockpitDir, targetCwd);
    if (match) return match;
    // No match: NO fallback to current-session.json. It could belong to a
    // foreign folder — better to honestly show "waiting for a session in
    // this folder" than someone else's numbers (fail-loud.md).
    return {};
  }
  return readOne(join(cockpitDir, 'current-session.json')) ?? {};
}

function readOne(path: string): CurrentSession | null {
  try {
    const s = JSON.parse(readFileSync(path, 'utf8')) as CurrentSession;
    return typeof s === 'object' && s !== null ? s : null;
  } catch {
    return null;
  }
}

/**
 * A session belongs to the target folder when it runs in it or in one of its
 * subfolders. Claude Code reports the cwd it had at SessionStart; after a
 * compaction that is wherever the shell stood (real case 2026-09-26:
 * `<project>/site`), so an exact comparison lost the session.
 */
function belongsTo(cwd: unknown, targetCwd: string): boolean {
  // Real session files carry `"cwd": null` (older hook payloads) — not a folder.
  if (typeof cwd !== 'string') return false;
  const base = targetCwd.endsWith('/') ? targetCwd.slice(0, -1) : targetCwd;
  return cwd === base || cwd.startsWith(`${base}/`);
}

/**
 * mtime of `path`, or `undefined` when the file simply doesn't exist (a
 * missing `status-`/`subagents-`/`events-` file is normal — not every
 * session has one yet). Any other error (permissions, I/O) is not something
 * a missing-file default should hide, so it propagates (fail-loud.md).
 */
function mtimeOf(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/**
 * The most recent activity timestamp for session `sid`: the newest mtime
 * among its `session-`, `events-`, `status-`, and `subagents-` files. A
 * session that keeps running keeps advancing this value; a session that
 * exited right after SessionStart freezes at its one write.
 */
function latestActivityMs(cockpitDir: string, sid: string, sessionFileMtime: number): number {
  let latest = sessionFileMtime;
  for (const name of [`events-${sid}.jsonl`, `status-${sid}.json`, `subagents-${sid}.json`]) {
    const mtime = mtimeOf(join(cockpitDir, name));
    if (mtime !== undefined && mtime > latest) latest = mtime;
  }
  return latest;
}

function newestSessionFor(cockpitDir: string, targetCwd: string): CurrentSession | null {
  let best: { s: CurrentSession; activity: number } | null = null;
  let names: string[];
  try {
    names = readdirSync(cockpitDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  for (const name of names) {
    if (!name.startsWith('session-') || !name.endsWith('.json')) continue;
    const path = join(cockpitDir, name);
    const s = readOne(path);
    if (!s || s.session_id === undefined || !belongsTo(s.cwd, targetCwd)) continue;
    const sessionFileMtime = mtimeOf(path);
    if (sessionFileMtime === undefined) continue; // vanished between read and stat
    const activity = latestActivityMs(cockpitDir, s.session_id, sessionFileMtime);
    if (!best || activity > best.activity) best = { s, activity };
  }
  return best?.s ?? null;
}
