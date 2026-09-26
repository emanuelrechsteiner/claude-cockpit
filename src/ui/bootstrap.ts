import { Collector } from '../collect/collector.js';
import { resolveSession as resolveSessionIn, type CurrentSession } from '../collect/session.js';
import { loadRules } from '../rules.js';
import { listPlugins } from '../plugins/actions.js';

/**
 * Verkabelung des Dashboards: woher es liest, welche Sitzung es meint.
 * Bewusst getrennt von app.tsx — dort geht es um Darstellung, hier um Pfade.
 */
const HOME = process.env['HOME'] ?? '';
export const COCKPIT_DIR = process.env['COCKPIT_DIR'] ?? `${HOME}/.claude/cockpit`;
export const SETTINGS_PATH = process.env['COCKPIT_SETTINGS'] ?? `${HOME}/.claude/settings.json`;
export const TARGET_CWD = process.env['COCKPIT_TARGET_CWD'];

/** Kommandozeilen-Ueberschreibung, damit Pruefstaende ohne echte Sitzung laufen. */
function argOf(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Aufloesungslogik samt Begruendung in collect/session.ts (dort auch geprueft). */
export function resolveSession(): CurrentSession {
  return resolveSessionIn(COCKPIT_DIR, TARGET_CWD);
}

export function buildCollector(session: CurrentSession): Collector {
  const eventsPath =
    argOf('--events') ?? `${COCKPIT_DIR}/events-${session.session_id ?? 'unknown'}.jsonl`;
  const transcriptPath = argOf('--transcript') ?? session.transcript_path;
  const rulesPath = argOf('--rules') ?? `${COCKPIT_DIR}/config/rules.json`;
  // Ohne Sitzungskennung KEIN Briefkastenpfad: eine geratene Datei waere
  // schlimmer als keine — die Karten sagen dann ehrlich "wartet".
  const statusPath =
    argOf('--status') ??
    (session.session_id !== undefined
      ? `${COCKPIT_DIR}/status-${session.session_id}.json`
      : undefined);
  const liveAgentsPath =
    session.session_id !== undefined ? `${COCKPIT_DIR}/subagents-${session.session_id}.json` : undefined;
  return new Collector({
    eventsPath,
    transcriptPath,
    rules: loadRules(rulesPath),
    sessionCwd: session.cwd ?? TARGET_CWD,
    listPlugins: () => listPlugins(SETTINGS_PATH),
    statusPath,
    liveAgentsPath,
    agentsDir: process.env['COCKPIT_AGENTS_DIR'] ?? `${HOME}/.claude/agents`,
  });
}
