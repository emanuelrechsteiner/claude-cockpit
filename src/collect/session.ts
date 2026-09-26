import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface CurrentSession {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
}

/**
 * Findet die Claude-Sitzung, die zu DIESEM Dashboard gehoert.
 *
 * Warum das nicht trivial ist: `current-session.json` ist eine EINZIGE globale
 * Datei — wer zuletzt startet, ueberschreibt sie. Startet irgendwo eine zweite
 * Claude-Sitzung (auch in einem ganz anderen Ordner), verliert ein laufendes
 * Dashboard seine Kennung und findet weder Briefkasten noch Transcript.
 * Real beobachtet 2026-08-04: eine Sitzung im Heimatverzeichnis ueberschrieb
 * die des Projekts; Kontext- und Verbrauchskarte standen danach dauerhaft auf
 * "wartet auf die Statuszeile", obwohl der Briefkasten gefuellt war.
 *
 * Loesung: der Hook legt zusaetzlich `session-<sid>.json` pro Sitzung ab —
 * dieselbe Bauart wie `events-<sid>.jsonl` und `status-<sid>.json`. Diese
 * Funktion durchsucht sie nach dem passenden Ordner und nimmt die JUENGSTE
 * (mehrere Sitzungen im selben Ordner sind erlaubt; die letzte gewinnt).
 *
 * `current-session.json` bleibt die Rueckfalllinie fuer den Fall ohne
 * Ordnervorgabe — dort gibt es nichts abzugleichen.
 */
export function resolveSession(cockpitDir: string, targetCwd?: string): CurrentSession {
  if (targetCwd !== undefined) {
    const match = newestSessionFor(cockpitDir, targetCwd);
    if (match) return match;
    // Kein Treffer: KEIN Rueckfall auf current-session.json. Die koennte zu
    // einem fremden Ordner gehoeren — lieber ehrlich "wartet auf Session in
    // diesem Ordner" anzeigen als fremde Zahlen (fail-loud.md).
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

function newestSessionFor(cockpitDir: string, targetCwd: string): CurrentSession | null {
  let best: { s: CurrentSession; mtime: number } | null = null;
  let names: string[];
  try {
    names = readdirSync(cockpitDir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.startsWith('session-') || !name.endsWith('.json')) continue;
    const path = join(cockpitDir, name);
    const s = readOne(path);
    if (!s || s.session_id === undefined || !belongsTo(s.cwd, targetCwd)) continue;
    let mtime = 0;
    try {
      mtime = statSync(path).mtimeMs;
    } catch {
      continue;
    }
    if (!best || mtime > best.mtime) best = { s, mtime };
  }
  return best?.s ?? null;
}
