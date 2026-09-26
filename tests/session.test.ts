import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, readFileSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSession } from '../src/collect/session.js';

const PROJ = '/projekt/a';
const HOME = '/anderswo/fremd';

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

describe('resolveSession — pro Sitzung statt global', () => {
  it('findet die Sitzung des eigenen Ordners, auch wenn eine fremde später startete', () => {
    const d = dir();
    writeSession(d, 'meine', PROJ, 60);
    writeSession(d, 'fremde', HOME);
    // Der reale Fehler vom 2026-08-04: die fremde Sitzung hatte die globale
    // Datei überschrieben.
    writeFileSync(join(d, 'current-session.json'), JSON.stringify({ session_id: 'fremde', cwd: HOME }));

    const s = resolveSession(d, PROJ);
    expect(s.session_id).toBe('meine');
    expect(s.cwd).toBe(PROJ);
    rmSync(d, { recursive: true, force: true });
  });

  it('nimmt bei mehreren Sitzungen im selben Ordner die jüngste', () => {
    const d = dir();
    writeSession(d, 'alt', PROJ, 600);
    writeSession(d, 'neu', PROJ);
    expect(resolveSession(d, PROJ).session_id).toBe('neu');
    rmSync(d, { recursive: true, force: true });
  });

  it('findet die Sitzung auch, wenn sie aus einem Unterordner des Projekts meldet', () => {
    // Real beobachtet 2026-09-26: nach einer Verdichtung meldete SessionStart
    // den Unterordner, in dem die Shell gerade stand (…/projekt/a/site). Der
    // exakte Abgleich fand nichts, alle Karten standen auf "keine …".
    const d = dir();
    writeSession(d, 'meine', `${PROJ}/site`);
    expect(resolveSession(d, PROJ).session_id).toBe('meine');
    rmSync(d, { recursive: true, force: true });
  });

  it('verwechselt keinen Nachbarordner mit gleichem Namensanfang', () => {
    const d = dir();
    writeSession(d, 'nachbar', `${PROJ}b`);
    expect(resolveSession(d, PROJ)).toEqual({});
    rmSync(d, { recursive: true, force: true });
  });

  it('fällt NICHT auf eine fremde Sitzung zurück, wenn keine passt', () => {
    const d = dir();
    writeSession(d, 'fremde', HOME);
    writeFileSync(join(d, 'current-session.json'), JSON.stringify({ session_id: 'fremde', cwd: HOME }));
    // Lieber ehrlich leer als fremde Zahlen anzeigen (fail-loud.md).
    expect(resolveSession(d, PROJ)).toEqual({});
    rmSync(d, { recursive: true, force: true });
  });

  it('nutzt ohne Ordnervorgabe die Rückfalllinie current-session.json', () => {
    const d = dir();
    writeFileSync(join(d, 'current-session.json'), JSON.stringify({ session_id: 'irgendeine', cwd: HOME }));
    expect(resolveSession(d, undefined).session_id).toBe('irgendeine');
    rmSync(d, { recursive: true, force: true });
  });

  it('überlebt kaputte, leere und fehlende Dateien', () => {
    const d = dir();
    writeFileSync(join(d, 'session-kaputt.json'), 'kein-json{{{');
    writeFileSync(join(d, 'session-leer.json'), '{}');
    // Real files from older hook payloads carry "cwd": null.
    writeFileSync(join(d, 'session-ohne-ort.json'), JSON.stringify({ session_id: 'x', cwd: null }));
    writeFileSync(join(d, 'nicht-relevant.txt'), 'x');
    expect(() => resolveSession(d, PROJ)).not.toThrow();
    expect(resolveSession(d, PROJ)).toEqual({});
    // Eine gültige Datei daneben wird trotzdem gefunden
    writeSession(d, 'gut', PROJ);
    expect(resolveSession(d, PROJ).session_id).toBe('gut');
    rmSync(d, { recursive: true, force: true });
    expect(resolveSession('/gibt/es/nicht', PROJ)).toEqual({});
  });
});

describe('cockpit-event.sh legt die Sitzungsdatei pro Sitzung ab', () => {
  it('schreibt session-<sid>.json UND current-session.json bei SessionStart', () => {
    const d = dir();
    execFileSync('bash', ['hooks/cockpit-event.sh', 'SessionStart'], {
      input: JSON.stringify({ session_id: 'abc', transcript_path: '/t/abc.jsonl', cwd: PROJ }),
      env: { ...process.env, COCKPIT_DIR: d },
    });
    const perSession = JSON.parse(readFileSync(join(d, 'session-abc.json'), 'utf8')) as { cwd: string };
    expect(perSession.cwd).toBe(PROJ);
    expect(existsSync(join(d, 'current-session.json'))).toBe(true);

    // Eine zweite Sitzung überschreibt die globale Datei — aber NICHT die erste
    // Sitzungsdatei. Genau das war der Fehler.
    execFileSync('bash', ['hooks/cockpit-event.sh', 'SessionStart'], {
      input: JSON.stringify({ session_id: 'xyz', transcript_path: '/t/xyz.jsonl', cwd: HOME }),
      env: { ...process.env, COCKPIT_DIR: d },
    });
    expect(JSON.parse(readFileSync(join(d, 'session-abc.json'), 'utf8')).cwd).toBe(PROJ);
    expect(resolveSession(d, PROJ).session_id).toBe('abc');
    rmSync(d, { recursive: true, force: true });
  });
});
