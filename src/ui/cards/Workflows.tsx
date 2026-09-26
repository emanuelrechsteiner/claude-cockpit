import React from 'react';
import { Text } from 'ink';
import type { TaskStatus, WorkflowInfo } from '../../types.js';
import { taskBar, workflowBlocks } from './workflow-view.js';

// Up to two blocks (Tasks + Wave) can be visible at once now; 4 keeps a
// two-block card within roughly the same height the single-block card used
// to take at its old MAX_TASKS of 6 (1 + 6 = 7 rows -> 2 + 2*4 = 10 rows,
// still short enough for the sidebar, per the caller's own budget call).
const MAX_TASKS = 4;
const SUBJECT_WIDTH = 26;
const ICON: Record<TaskStatus, string> = { completed: '✓', in_progress: '⟳', pending: '○' };
const COLOR: Record<TaskStatus, string | undefined> = { completed: 'green', in_progress: 'yellow', pending: undefined };

function bar(done: number, total: number): string {
  const width = 12;
  const filled = Math.min(width, Math.round((width * done) / Math.max(total, 1)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function subject(s: string): string {
  return s.length > SUBJECT_WIDTH ? `${s.slice(0, SUBJECT_WIDTH - 1)}…` : s.padEnd(SUBJECT_WIDTH);
}

/**
 * Card 4: one block per non-empty workflow (Tasks, Wave), each with its own
 * overall bar followed by one row per task. `workflowBlocks` (workflow-view.ts)
 * does the row-layout math — including the continuous cursor numbering across
 * blocks, so cursor 0 never highlights two bars at once when both are shown.
 */
export function Workflows(props: { data: WorkflowInfo[]; focused: boolean; cursor: number }) {
  const blocks = workflowBlocks(props.data, MAX_TASKS);
  if (blocks.length === 0) return <Text dimColor>no active workflows</Text>;
  const now = Date.now();
  return (
    <>
      {blocks.map((b) => (
        <React.Fragment key={b.name}>
          <Text inverse={props.focused && props.cursor === b.barRow}>
            {b.name.slice(0, 20)} [{bar(b.done, b.total)}] {b.done}/{b.total}
          </Text>
          {b.taskRows.map(({ row, task: t }) => (
            <Text key={t.id} inverse={props.focused && props.cursor === row} dimColor={t.status === 'pending'}>
              <Text color={COLOR[t.status]}>{ICON[t.status]}</Text> {subject(t.subject)}{' '}
              <Text color={COLOR[t.status]}>{taskBar(t.status, now)}</Text>
            </Text>
          ))}
          {b.hidden > 0 ? <Text dimColor>… +{b.hidden} more</Text> : null}
        </React.Fragment>
      ))}
    </>
  );
}
