import type { SubagentInfo, TaskInfo, TaskStatus, WorkflowInfo } from '../types.js';
import { salvageLines } from './salvage.js';
import { resolveSubagents, type Dispatch, type DispatchMap, type Lifecycle } from './dispatch-map.js';

export type { EventLine } from './salvage.js';

export interface EventState {
  subagents: SubagentInfo[];
  workflows: WorkflowInfo[];
  /**
   * Task events that carry no task id (older payload shapes). They cannot be
   * placed in the task list, so they are only counted — the way the card
   * worked before it listed tasks.
   */
  anonymousTasks: { done: number; total: number };
  /**
   * Cumulative count of event fragments that could not be read (truncated or
   * garbled JSON). Never silently dropped: the collector surfaces it as an
   * error so a short task/subagent count is visibly explained.
   */
  unreadable: number;
  /** ms timestamp of the newest event that was applied; null before the first. */
  lastEventTs: number | null;
  /**
   * The unreadable head of a record that ended the last batch. Its tail may
   * be the first line of the next batch (interleaved writes, see salvage.ts);
   * it is counted in `unreadable` only if that line does not complete it.
   */
  pendingFragment: string | null;
  /** Subagent starts/stops/restarts in file order; `subagents` is derived from it. */
  lifecycle: Lifecycle[];
  /** Agent call outcomes from the transcript, by tool_use_id (see dispatch-map.ts). */
  dispatches: DispatchMap;
  /** Stops with no transcript link, attributed by the oldest-same-type guess. */
  unmatchedStops: number;
}

export function emptyEventState(): EventState {
  return {
    subagents: [],
    workflows: [
      { name: 'Tasks', source: 'tasks', done: 0, total: 0, tasks: [] },
      { name: 'Wave', source: 'wave', done: 0, total: 0, tasks: [] },
    ],
    anonymousTasks: { done: 0, total: 0 },
    unreadable: 0,
    lastEventTs: null,
    pendingFragment: null,
    lifecycle: [],
    dispatches: {},
    unmatchedStops: 0,
  };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function toolInput(d: Record<string, unknown>): Record<string, unknown> {
  return obj(d['tool_input']);
}

function toolResponse(d: Record<string, unknown>): Record<string, unknown> {
  return obj(d['tool_response']);
}

function isStatus(v: string | undefined): v is TaskStatus {
  return v === 'pending' || v === 'in_progress' || v === 'completed';
}

export function reduceEvents(lines: string[], prev: EventState): EventState {
  const lifecycle = [...prev.lifecycle];
  const tasks = new Map<string, TaskInfo>(prev.workflows[0].tasks.map((t) => [t.id, { ...t }]));
  const anonymous = { ...prev.anonymousTasks };
  const salvaged = salvageLines(lines, prev.pendingFragment);
  const unreadable = prev.unreadable + salvaged.unreadable;
  let lastEventTs = prev.lastEventTs;
  for (const e of salvaged.events) {
    lastEventTs = lastEventTs === null ? e.ts : Math.max(lastEventTs, e.ts);
    const d = e.data ?? {};
    switch (e.event) {
      case 'SubagentStart': {
        const ti = toolInput(d);
        // tool_use_id is unique per Agent call. The timestamp is only
        // second-precise: two subagents dispatched in the same message landed
        // on the same `sa-<ts>` id and one overwrote the other (real case
        // 2026-09-26: 45 starts, 44 rows).
        const id = str(d['subagent_id']) ?? str(d['tool_use_id']) ?? `sa-${e.ts}`;
        const type = str(d['subagent_type']) ?? str(ti['subagent_type']) ?? 'general';
        lifecycle.push({
          kind: 'start',
          info: {
            id,
            type,
            status: 'running',
            startedAt: e.ts,
            description: str(ti['description']) ?? null,
            // Per-call model ("opus", "sonnet", …) — absent when the call does not override it.
            model: str(ti['model']) ?? null,
            // The session's effort at dispatch; a subagent without its own
            // `effort:` frontmatter inherits it (code.claude.com/docs/en/statusline).
            sessionEffort: str(obj(d['effort'])['level']) ?? null,
            lastMessage: null,
          },
        });
        break;
      }
      case 'SubagentStop': {
        // agent_type "" marks Claude Code's own internal helpers (prompt
        // suggestions, progress summaries …), not a subagent anyone
        // dispatched — real ratio 2026-09-26: 677 of 687 stops. Closing a
        // subagent on those ticked it off while it was still working.
        const agentType = d['agent_type'];
        if (agentType === '') break;
        const rs = d['result_status'];
        lifecycle.push({
          kind: 'stop',
          ts: e.ts,
          directId: str(d['subagent_id']) ?? null,
          // Linked to its start through the transcript (see dispatch-map.ts).
          agentId: str(d['agent_id']) ?? null,
          agentType: str(agentType) ?? null,
          failed: !(rs === undefined || rs === 'success'),
          lastMessage: str(d['last_assistant_message']) ?? null,
        });
        break;
      }
      case 'SessionStart': {
        // A new process (resume after a restart, fresh startup) does not
        // carry over the old process's subagents; a compaction does. Without
        // this, a subagent lost to a reboot or a kill showed as "running for
        // 412 min" (real case 2026-09-26).
        const source = str(d['source']);
        if (source === 'resume' || source === 'startup') lifecycle.push({ kind: 'restart', ts: e.ts });
        break;
      }
      case 'TaskCreated': {
        const created = obj(toolResponse(d)['task']);
        const id = str(created['id']) ?? str(d['task_id']);
        const subject = str(toolInput(d)['subject']) ?? str(created['subject']) ?? str(d['task_name']);
        if (id === undefined) {
          anonymous.total += 1;
          break;
        }
        const known = tasks.get(id);
        if (known) {
          // An update can arrive before its create in the same batch; keep its status.
          if (subject) known.subject = subject;
        } else {
          tasks.set(id, { id, subject: subject ?? `Task ${id}`, status: 'pending' });
        }
        break;
      }
      case 'TaskUpdated': {
        const ti = toolInput(d);
        const id = str(ti['taskId']) ?? str(toolResponse(d)['taskId']);
        const status = str(ti['status']);
        if (id === undefined) {
          if (status === 'completed') anonymous.done += 1;
          break;
        }
        if (status === 'deleted') {
          tasks.delete(id);
          break;
        }
        const task = tasks.get(id) ?? { id, subject: `Task ${id}`, status: 'pending' as TaskStatus };
        if (isStatus(status)) task.status = status;
        const subject = str(ti['subject']);
        if (subject) task.subject = subject;
        tasks.set(id, task);
        break;
      }
      case 'TaskCompleted': {
        const id = str(d['task_id']);
        const task = id === undefined ? undefined : tasks.get(id);
        if (task) task.status = 'completed';
        else anonymous.done += 1;
        break;
      }
    }
  }
  const list = [...tasks.values()];
  const taskWorkflow: WorkflowInfo = {
    name: prev.workflows[0].name,
    source: 'tasks',
    done: list.filter((t) => t.status === 'completed').length + anonymous.done,
    total: list.length + anonymous.total,
    tasks: list,
  };
  return withSubagents({
    ...prev,
    workflows: [taskWorkflow, prev.workflows[1]],
    lifecycle,
    anonymousTasks: anonymous,
    unreadable,
    lastEventTs,
    pendingFragment: salvaged.pending,
  });
}

/**
 * Adds dispatch outcomes from the transcript (any order relative to the
 * events, any poll) and re-attributes every stop against the merged map.
 */
export function mergeDispatches(prev: EventState, dispatches: Dispatch[]): EventState {
  if (dispatches.length === 0) return prev;
  const map: DispatchMap = { ...prev.dispatches };
  for (const d of dispatches) map[d.toolUseId] = { agentId: d.agentId, denied: d.denied };
  return withSubagents({ ...prev, dispatches: map });
}

/** Derives subagents, unmatchedStops and the Wave workflow from the log. */
function withSubagents(state: EventState): EventState {
  const { subagents, unmatchedStops } = resolveSubagents(state.lifecycle, state.dispatches);
  return { ...state, subagents, unmatchedStops, workflows: [state.workflows[0], buildWaveWorkflow(subagents)] };
}

/**
 * The Wave workflow: one row per subagent, deterministic (SubagentStart/Stop
 * fire on every hook run, unlike the task list, which only exists when the
 * model chooses to keep one). Reads the SAME `subagents` state Card 3
 * (Subagents) is built from — not a second, independent count of the same
 * events (see rules/testing-quality.md "Verify Via the Same Code Path").
 */
function buildWaveWorkflow(subagents: SubagentInfo[]): WorkflowInfo {
  const ordered = [...subagents].sort((a, b) => a.startedAt - b.startedAt);
  const tasks: TaskInfo[] = ordered.map((s) => ({
    id: s.id,
    subject: s.description ?? s.type,
    // 'error', 'lost' and 'denied' still mean the row is finished, just not cleanly —
    // Card 3 already surfaces the failure/loss detail; TaskStatus has no
    // third state to add here without breaking Tasks-workflow consumers.
    status: s.status === 'running' ? 'in_progress' : 'completed',
  }));
  return {
    name: 'Wave',
    source: 'wave',
    done: tasks.filter((t) => t.status === 'completed').length,
    total: tasks.length,
    tasks,
  };
}
