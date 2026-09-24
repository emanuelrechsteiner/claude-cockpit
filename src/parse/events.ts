import type { SubagentInfo, WorkflowInfo } from '../types.js';

export interface EventState {
  subagents: SubagentInfo[];
  workflows: WorkflowInfo[];
}

export function emptyEventState(): EventState {
  return { subagents: [], workflows: [{ name: 'Tasks', done: 0, total: 0 }] };
}

interface EventLine {
  ts: number;
  event: string;
  data: Record<string, unknown> | null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function toolInput(d: Record<string, unknown>): Record<string, unknown> {
  const ti = d['tool_input'];
  return ti && typeof ti === 'object' ? (ti as Record<string, unknown>) : {};
}

export function reduceEvents(lines: string[], prev: EventState): EventState {
  const subagents = new Map(prev.subagents.map((s) => [s.id, { ...s }]));
  const wf = { ...prev.workflows[0] };
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
        const id = str(d['subagent_id']) ?? `sa-${e.ts}`;
        const type = str(d['subagent_type']) ?? str(toolInput(d)['subagent_type']) ?? 'general';
        subagents.set(id, { id, type, status: 'running', startedAt: e.ts });
        break;
      }
      case 'SubagentStop': {
        const id = str(d['subagent_id']);
        let target = id ? subagents.get(id) : undefined;
        if (!target) {
          target = [...subagents.values()]
            .filter((s) => s.status === 'running')
            .sort((a, b) => a.startedAt - b.startedAt)[0];
        }
        if (target) {
          target.status = d['result_status'] === undefined || d['result_status'] === 'success' ? 'done' : 'error';
          target.endedAt = e.ts;
        }
        break;
      }
      case 'TaskCreated':
        wf.total += 1;
        break;
      case 'TaskCompleted':
        wf.done += 1;
        break;
      case 'TaskUpdated':
        if (str(toolInput(d)['status']) === 'completed') wf.done += 1;
        break;
    }
  }
  return { subagents: [...subagents.values()], workflows: [wf] };
}
