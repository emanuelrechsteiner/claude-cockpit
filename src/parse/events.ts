import type { SubagentInfo, TaskInfo, TaskStatus, WorkflowInfo } from '../types.js';

export interface EventState {
  subagents: SubagentInfo[];
  workflows: WorkflowInfo[];
  /**
   * Task events that carry no task id (older payload shapes). They cannot be
   * placed in the task list, so they are only counted — the way the card
   * worked before it listed tasks.
   */
  anonymousTasks: { done: number; total: number };
}

export function emptyEventState(): EventState {
  return {
    subagents: [],
    workflows: [
      { name: 'Tasks', source: 'tasks', done: 0, total: 0, tasks: [] },
      { name: 'Wave', source: 'wave', done: 0, total: 0, tasks: [] },
    ],
    anonymousTasks: { done: 0, total: 0 },
  };
}

interface EventLine {
  ts: number;
  event: string;
  data: Record<string, unknown> | null;
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
  const subagents = new Map(prev.subagents.map((s) => [s.id, { ...s }]));
  const tasks = new Map<string, TaskInfo>(prev.workflows[0].tasks.map((t) => [t.id, { ...t }]));
  const anonymous = { ...prev.anonymousTasks };
  for (const line of lines) {
    let e: EventLine;
    try {
      e = JSON.parse(line) as EventLine;
    } catch {
      continue;
    }
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
        subagents.set(id, {
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
        const id = str(d['subagent_id']);
        let target = id ? subagents.get(id) : undefined;
        if (!target) {
          target = [...subagents.values()]
            .filter((s) => s.status === 'running' && (typeof agentType !== 'string' || s.type === agentType))
            .sort((a, b) => a.startedAt - b.startedAt)[0];
        }
        if (target) {
          target.status = d['result_status'] === undefined || d['result_status'] === 'success' ? 'done' : 'error';
          target.endedAt = e.ts;
          target.lastMessage = str(d['last_assistant_message']) ?? null;
        }
        break;
      }
      case 'SessionStart': {
        // A new process (resume after a restart, fresh startup) does not
        // carry over the old process's subagents; a compaction does. Without
        // this, a subagent lost to a reboot or a kill showed as "running for
        // 412 min" (real case 2026-09-26).
        const source = str(d['source']);
        if (source === 'resume' || source === 'startup') {
          for (const s of subagents.values()) {
            if (s.status === 'running') {
              s.status = 'lost';
              s.endedAt = e.ts;
            }
          }
        }
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
  const wave = buildWaveWorkflow([...subagents.values()]);
  return { subagents: [...subagents.values()], workflows: [taskWorkflow, wave], anonymousTasks: anonymous };
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
    // 'error' and 'lost' still mean the row is finished, just not cleanly —
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
