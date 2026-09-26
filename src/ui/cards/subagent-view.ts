import type { AgentDef, LiveAgents, SubagentInfo } from '../../types.js';

/**
 * "claude-opus-5-5[1m]" → "Opus 5.5". Family name, then the version parts
 * that are short numbers; a trailing date stamp (8 digits) and a context
 * suffix in brackets are dropped.
 */
export function formatModel(id: string | null): string | null {
  if (id === null) return null;
  const parts = id.replace(/\[.*\]$/, '').replace(/^claude-/, '').split('-');
  const family = parts[0] ?? '';
  const version = parts.slice(1).filter((p) => /^\d{1,2}$/.test(p));
  const name = family.charAt(0).toUpperCase() + family.slice(1);
  return version.length > 0 ? `${name} ${version.join('.')}` : name;
}

/** Effort is a level word, or a numeric thinking budget. */
export function formatEffort(effort: string | number | null): string | null {
  if (effort === null) return null;
  if (typeof effort === 'number') return effort >= 1000 ? `${Math.round(effort / 1000)}k tok` : `${effort} tok`;
  return effort;
}

/** Cockpit glyphs, same as the brand's iconography: ⟳ running, ✓ done, ✗ failed, ● waiting. */
export function agentGlyph(status: string): { icon: string; color: string } {
  const s = status.toLowerCase();
  if (s.includes('run') || s.includes('progress') || s.includes('active')) return { icon: '⟳', color: 'yellow' };
  if (s.includes('complet') || s.includes('done') || s.includes('success')) return { icon: '✓', color: 'green' };
  if (s.includes('fail') || s.includes('error') || s.includes('kill') || s.includes('cancel')) return { icon: '✗', color: 'red' };
  return { icon: '●', color: 'yellow' };
}

/** "42s", "3m 05s" — elapsed since a start time in ms. */
export function formatElapsed(startMs: number | null, nowMs: number): string | null {
  if (startMs === null) return null;
  const s = Math.max(0, Math.round((nowMs - startMs) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** One rendered subagent: a title line (icon, title, meta) and one status line. */
export interface SubagentRow {
  key: string;
  icon: string;
  color: string;
  title: string;
  meta: string;
  activity: string;
  running: boolean;
}

/**
 * Model names arrive in three shapes: ids ("claude-opus-5-5[1m]"), aliases
 * ("opus", "inherit") and the session's display name ("Opus 5.5 (1M
 * context)"). "inherit" and a missing value both mean: the session's model.
 */
function modelName(raw: string | null | undefined, sessionModel: string | null): string | null {
  const session = sessionModel === null ? null : sessionModel.replace(/\s*\(.*\)\s*$/, '');
  if (raw === null || raw === undefined || raw === 'inherit') return session;
  return /\s/.test(raw) ? raw.replace(/\s*\(.*\)\s*$/, '') : formatModel(raw);
}

function ago(fromMs: number | undefined, nowMs: number): string {
  if (fromMs === undefined) return '';
  const min = Math.floor(Math.max(0, nowMs - fromMs) / 60_000);
  return min < 1 ? ' · just now' : ` · ${min} min ago`;
}

/**
 * The rows of card 3. Every row names model and effort and carries one
 * status line — what the subagent is doing, or "idle" once it is done.
 *
 * Running subagents come from the live agent panel when it is fresh (it has
 * the resolved model and the current activity label); otherwise, and for
 * everything finished, from the hook events plus the agent definitions.
 */
export function subagentRows(input: {
  events: SubagentInfo[];
  live: LiveAgents | null;
  defs: Map<string, AgentDef>;
  sessionModel: string | null;
  now: number;
}): SubagentRow[] {
  const { events, live, defs, sessionModel, now } = input;
  const liveFresh = live !== null && !live.stale;
  const rows: SubagentRow[] = [];

  if (liveFresh) {
    for (const a of live.agents) {
      const title = a.type ?? a.name ?? 'subagent';
      const def = defs.get(title);
      const eventMatch = events.find((e) => e.status === 'running' && e.type === title);
      const glyph = agentGlyph(a.status);
      const meta = [
        formatModel(a.model) ?? modelName(eventMatch?.model ?? def?.model, sessionModel),
        formatEffort(a.effort) ?? def?.effort ?? eventMatch?.sessionEffort ?? null,
        formatElapsed(a.startTime, now),
      ].filter((m): m is string => m !== null && m !== '');
      const activity = [a.description, a.label !== a.description ? a.label : null].filter(
        (l): l is string => l !== null,
      );
      rows.push({
        key: `live-${a.id}`,
        icon: glyph.icon,
        color: glyph.color,
        title,
        meta: meta.join(' · '),
        activity: activity.length > 0 ? activity.join(' · ') : 'working',
        running: true,
      });
    }
  }

  const fromEvents = events.filter((e) => !(liveFresh && e.status === 'running'));
  const running = fromEvents.filter((e) => e.status === 'running');
  const finished = fromEvents.filter((e) => e.status !== 'running').reverse();
  for (const e of [...running, ...finished]) {
    const def = defs.get(e.type);
    const isRunning = e.status === 'running';
    const meta = [
      modelName(e.model ?? def?.model, sessionModel),
      def?.effort ?? e.sessionEffort ?? null,
      isRunning ? formatElapsed(e.startedAt, now) : null,
    ].filter((m): m is string => m !== null && m !== '');
    rows.push({
      key: e.id,
      icon: isRunning ? '⟳' : e.status === 'done' ? '✓' : e.status === 'lost' ? '○' : '✗',
      color: isRunning ? 'yellow' : e.status === 'done' ? 'green' : e.status === 'lost' ? 'gray' : 'red',
      title: e.type,
      meta: meta.join(' · '),
      activity: isRunning
        ? (e.description ?? 'working')
        : e.status === 'done'
          ? `idle · done${ago(e.endedAt, now).replace(' · ', ' ')}`
          : e.status === 'lost'
            ? 'idle · no stop event (session restarted)'
            : `idle · aborted${ago(e.endedAt, now).replace(' · ', ' ')}`,
      running: isRunning,
    });
  }
  return rows;
}
