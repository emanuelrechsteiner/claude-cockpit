import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, readFileSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSession } from '../src/collect/session.js';

const PROJ = '/project/a';
const HOME = '/elsewhere/foreign';

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'cockpit-'));
}

function writeSession(d: string, sid: string, cwd: string, ageSeconds = 0): void {
  const p = join(d, `session-${sid}.json`);
  writeFileSync(p, JSON.stringify({ session_id: sid, transcript_path: `/t/${sid}.jsonl`, cwd }));
  if (ageSeconds > 0) {
    const t = new Date(Date.now() - ageSeconds * 1000);
    utimesSync(p, t, t);
  }
}

/** Writes an activity file (`events-<sid>.jsonl` or `status-<sid>.json`) with a given age. */
function writeActivity(d: string, name: string, ageSeconds = 0): void {
  const p = join(d, name);
  writeFileSync(p, '{"line":"activity"}\n');
  if (ageSeconds > 0) {
    const t = new Date(Date.now() - ageSeconds * 1000);
    utimesSync(p, t, t);
  }
}

describe('resolveSession — per session instead of global', () => {
  it('finds its own folder\'s session, even when a foreign one started later', () => {
    const d = dir();
    writeSession(d, 'mine', PROJ, 60);
    writeSession(d, 'foreign', HOME);
    // The real bug from 2026-08-04: the foreign session had overwritten the
    // global file.
    writeFileSync(join(d, 'current-session.json'), JSON.stringify({ session_id: 'foreign', cwd: HOME }));

    const s = resolveSession(d, PROJ);
    expect(s.session_id).toBe('mine');
    expect(s.cwd).toBe(PROJ);
    rmSync(d, { recursive: true, force: true });
  });

  it('takes the newest of several sessions in the same folder', () => {
    const d = dir();
    writeSession(d, 'old', PROJ, 600);
    writeSession(d, 'new', PROJ);
    expect(resolveSession(d, PROJ).session_id).toBe('new');
    rmSync(d, { recursive: true, force: true });
  });

  it('finds the session even when it reports from a subfolder of the project', () => {
    // Really observed 2026-09-26: after a compaction, SessionStart reported
    // the subfolder the shell happened to be in (…/project/a/site). The exact
    // match found nothing, all cards read "no …".
    const d = dir();
    writeSession(d, 'mine', `${PROJ}/site`);
    expect(resolveSession(d, PROJ).session_id).toBe('mine');
    rmSync(d, { recursive: true, force: true });
  });

  it('does not confuse a neighboring folder with the same name prefix', () => {
    const d = dir();
    writeSession(d, 'neighbor', `${PROJ}b`);
    expect(resolveSession(d, PROJ)).toEqual({});
    rmSync(d, { recursive: true, force: true });
  });

  it('does NOT fall back to a foreign session when none matches', () => {
    const d = dir();
    writeSession(d, 'foreign', HOME);
    writeFileSync(join(d, 'current-session.json'), JSON.stringify({ session_id: 'foreign', cwd: HOME }));
    // Better to honestly show empty than someone else's numbers (fail-loud.md).
    expect(resolveSession(d, PROJ)).toEqual({});
    rmSync(d, { recursive: true, force: true });
  });

  it('follows the most recently ACTIVE session, not the one that started most recently', () => {
    // Really observed 2026-09-26: a headless `claude -p` probe started in
    // the same folder, wrote its session file and one events line, then
    // exited. Its session file's mtime was newer than the real, still-busy
    // session's — but the real session kept writing events/status, the
    // probe never wrote again.
    const d = dir();
    writeSession(d, 'real', PROJ, 120); // started 2 minutes ago
    writeActivity(d, 'events-real.jsonl', 0); // still writing right now
    writeSession(d, 'probe', PROJ, 10); // started 10s ago — newer session file
    writeActivity(d, 'events-probe.jsonl', 10); // one line at start, then silence
    expect(resolveSession(d, PROJ).session_id).toBe('real');
    rmSync(d, { recursive: true, force: true });
  });

  it('lets a genuinely new interactive session take over once it starts writing', () => {
    // A brand-new session must still win — SessionStart writes both the
    // session file and the first events line with a fresh mtime.
    const d = dir();
    writeSession(d, 'old', PROJ, 60);
    writeActivity(d, 'events-old.jsonl', 60);
    writeSession(d, 'newreal', PROJ, 0);
    writeActivity(d, 'events-newreal.jsonl', 0);
    expect(resolveSession(d, PROJ).session_id).toBe('newreal');
    rmSync(d, { recursive: true, force: true });
  });

  it('ignores activity files belonging to a session from a different, unrelated cwd', () => {
    // A foreign-folder session with very fresh activity must never leak in
    // just because its files happen to be the newest in the directory.
    const d = dir();
    writeSession(d, 'mine', PROJ, 120);
    writeActivity(d, 'events-mine.jsonl', 0);
    writeSession(d, 'foreign', HOME, 0);
    writeActivity(d, 'events-foreign.jsonl', 0);
    expect(resolveSession(d, PROJ).session_id).toBe('mine');
    rmSync(d, { recursive: true, force: true });
  });

  it('uses the current-session.json fallback when no folder is given', () => {
    const d = dir();
    writeFileSync(join(d, 'current-session.json'), JSON.stringify({ session_id: 'whichever', cwd: HOME }));
    expect(resolveSession(d, undefined).session_id).toBe('whichever');
    rmSync(d, { recursive: true, force: true });
  });

  it('survives broken, empty, and missing files', () => {
    const d = dir();
    writeFileSync(join(d, 'session-broken.json'), 'not-json{{{');
    writeFileSync(join(d, 'session-empty.json'), '{}');
    // Real files from older hook payloads carry "cwd": null.
    writeFileSync(join(d, 'session-no-location.json'), JSON.stringify({ session_id: 'x', cwd: null }));
    writeFileSync(join(d, 'not-relevant.txt'), 'x');
    expect(() => resolveSession(d, PROJ)).not.toThrow();
    expect(resolveSession(d, PROJ)).toEqual({});
    // A valid file alongside it is still found
    writeSession(d, 'good', PROJ);
    expect(resolveSession(d, PROJ).session_id).toBe('good');
    rmSync(d, { recursive: true, force: true });
    expect(resolveSession('/does/not/exist', PROJ)).toEqual({});
  });
});

describe('cockpit-event.sh writes the session file per session', () => {
  it('writes session-<sid>.json AND current-session.json on SessionStart', () => {
    const d = dir();
    execFileSync('bash', ['hooks/cockpit-event.sh', 'SessionStart'], {
      input: JSON.stringify({ session_id: 'abc', transcript_path: '/t/abc.jsonl', cwd: PROJ }),
      env: { ...process.env, COCKPIT_DIR: d },
    });
    const perSession = JSON.parse(readFileSync(join(d, 'session-abc.json'), 'utf8')) as { cwd: string };
    expect(perSession.cwd).toBe(PROJ);
    expect(existsSync(join(d, 'current-session.json'))).toBe(true);

    // A second session overwrites the global file — but NOT the first
    // session's file. That was exactly the bug.
    execFileSync('bash', ['hooks/cockpit-event.sh', 'SessionStart'], {
      input: JSON.stringify({ session_id: 'xyz', transcript_path: '/t/xyz.jsonl', cwd: HOME }),
      env: { ...process.env, COCKPIT_DIR: d },
    });
    expect(JSON.parse(readFileSync(join(d, 'session-abc.json'), 'utf8')).cwd).toBe(PROJ);
    expect(resolveSession(d, PROJ).session_id).toBe('abc');
    rmSync(d, { recursive: true, force: true });
  });
});
