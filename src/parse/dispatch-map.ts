/**
 * Which subagent start a SubagentStop belongs to. The hook events cannot say:
 * SubagentStart is keyed by the Agent call's `tool_use_id`, SubagentStop only
 * carries the subagent's `agent_id`. The parent session transcript links the
 * two — the Agent call's tool_result entry has `toolUseResult.agentId`, and a
 * dispatch the permission layer refused has `is_error: true` and no agentId.
 *
 * Attribution is recomputed from the full lifecycle log on every change, so a
 * mapping that arrives after its stop (a synchronous Agent call's result is
 * written only when the subagent has finished) corrects an earlier
 * heuristic close instead of leaving it wrong for good.
 *
 * Pure functions: no I/O.
 */
import type { SubagentInfo } from '../types.js';

/** One Agent/Task call's outcome, from the parent transcript. */
export interface Dispatch {
  toolUseId: string;
  /** The subagent's id (SubagentStop `agent_id`); null when none was started. */
  agentId: string | null;
  /** The call returned an error and started no subagent (e.g. auto-mode classifier). */
  denied: boolean;
}

export type DispatchMap = Record<string, { agentId: string | null; denied: boolean }>;

/** Subagent lifecycle events in file order; the input to `resolveSubagents`. */
export type Lifecycle =
  | { kind: 'start'; info: SubagentInfo }
  | {
      kind: 'stop';
      ts: number;
      /** Legacy payloads named the start directly (`subagent_id`). */
      directId: string | null;
      agentId: string | null;
      agentType: string | null;
      failed: boolean;
      lastMessage: string | null;
    }
  | { kind: 'restart'; ts: number };

const AGENT_TOOLS = new Set(['Agent', 'Task']);

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/**
 * Dispatch outcomes from one parsed transcript entry. `agentCalls` holds the
 * tool_use ids of every Agent/Task call seen so far (kept by the caller
 * across polls) and is extended here from assistant entries; only results of
 * those calls are reported — never another tool's result.
 */
export function extractDispatches(entry: unknown, agentCalls: Set<string>): Dispatch[] {
  const e = rec(entry);
  const content = rec(e['message'])['content'];
  if (!Array.isArray(content)) return [];
  if (e['type'] === 'assistant') {
    for (const b of content.map(rec)) {
      if (b['type'] === 'tool_use' && typeof b['id'] === 'string' && AGENT_TOOLS.has(String(b['name']))) agentCalls.add(b['id']);
    }
    return [];
  }
  if (e['type'] !== 'user') return [];
  const results = content.map(rec).filter((b) => b['type'] === 'tool_result');
  // toolUseResult describes the entry as a whole; with several results in
  // one entry it cannot be tied to one of them (not seen in real transcripts).
  const agentIdRaw = results.length === 1 ? rec(e['toolUseResult'])['agentId'] : undefined;
  const out: Dispatch[] = [];
  for (const r of results) {
    const id = r['tool_use_id'];
    if (typeof id !== 'string' || !agentCalls.has(id)) continue;
    const agentId = typeof agentIdRaw === 'string' ? agentIdRaw : null;
    out.push({ toolUseId: id, agentId, denied: r['is_error'] === true && agentId === null });
  }
  return out;
}

/**
 * Replays the lifecycle log against the dispatch map. A stop closes the
 * start its agent_id maps to (or the one its legacy subagent_id names); only
 * without such a link does it fall back to the oldest running start of the
 * same type that no linked stop claims — those fallbacks are counted.
 */
export function resolveSubagents(log: Lifecycle[], dispatches: DispatchMap): { subagents: SubagentInfo[]; unmatchedStops: number } {
  const startIds = new Set(log.flatMap((l) => (l.kind === 'start' ? [l.info.id] : [])));
  const byAgent = new Map<string, string>();
  for (const [toolUseId, d] of Object.entries(dispatches)) if (d.agentId !== null) byAgent.set(d.agentId, toolUseId);
  const linked = (l: Extract<Lifecycle, { kind: 'stop' }>): string | undefined => {
    if (l.directId !== null && startIds.has(l.directId)) return l.directId;
    const viaMap = l.agentId === null ? undefined : byAgent.get(l.agentId);
    return viaMap !== undefined && startIds.has(viaMap) ? viaMap : undefined;
  };
  const claimed = new Set(log.flatMap((l) => (l.kind === 'stop' ? [linked(l)].filter((x): x is string => x !== undefined) : [])));
  const rows = new Map<string, SubagentInfo>();
  let unmatchedStops = 0;
  for (const l of log) {
    if (l.kind === 'start') {
      const denied = dispatches[l.info.id]?.denied === true;
      rows.set(l.info.id, { ...l.info, status: denied ? 'denied' : 'running', ...(denied ? { endedAt: l.info.startedAt } : {}) });
    } else if (l.kind === 'restart') {
      // A new process does not carry over the old one's subagents.
      for (const s of rows.values()) {
        if (s.status === 'running') {
          s.status = 'lost';
          s.endedAt = l.ts;
        }
      }
    } else {
      const id = linked(l);
      let target = id === undefined ? undefined : rows.get(id);
      if (target === undefined) {
        unmatchedStops += 1;
        target = [...rows.values()]
          .filter((s) => s.status === 'running' && !claimed.has(s.id) && (l.agentType === null || s.type === l.agentType))
          .sort((a, b) => a.startedAt - b.startedAt)[0];
      }
      if (target) {
        target.status = l.failed ? 'error' : 'done';
        target.endedAt = l.ts;
        target.lastMessage = l.lastMessage;
      }
    }
  }
  return { subagents: [...rows.values()], unmatchedStops };
}
