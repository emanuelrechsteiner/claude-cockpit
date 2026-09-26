import { readFileSync } from 'node:fs';
import type { LiveAgent, LiveAgents } from '../types.js';

/**
 * Reads the mailbox that statusline/subagent-statusline.sh drops per session.
 *
 * Claude Code hands the running subagents (with model and effort) only to the
 * `subagentStatusLine` command, once per refresh tick while the agent panel
 * shows rows. When no subagent is visible the command stops running and the
 * file ages — so an old file means "none running", not "still running".
 */
export const LIVE_STALE_AFTER_SECONDS = 15;

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function agentOf(v: unknown): LiveAgent | null {
  if (v === null || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = str(o['id']);
  if (id === null) return null;
  const effort = o['effort'];
  return {
    id,
    name: str(o['name']),
    type: str(o['type']),
    status: str(o['status']) ?? 'running',
    description: str(o['description']),
    label: str(o['label']),
    startTime: num(o['startTime']),
    model: str(o['model']),
    effort: typeof effort === 'number' ? num(effort) : str(effort),
    tokenCount: num(o['tokenCount']),
  };
}

export function readLiveAgents(path: string, nowSeconds = Math.floor(Date.now() / 1000)): LiveAgents {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const ts = num(raw['ts']) ?? 0;
  const tasks = Array.isArray(raw['tasks']) ? raw['tasks'] : [];
  return {
    ts,
    stale: nowSeconds - ts > LIVE_STALE_AFTER_SECONDS,
    agents: tasks.map(agentOf).filter((a): a is LiveAgent => a !== null),
  };
}
