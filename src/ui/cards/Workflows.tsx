import React from 'react';
import { Text } from 'ink';
import type { TaskStatus, WorkflowInfo } from '../../types.js';
import { taskBar, visibleTasks } from './workflow-view.js';

const MAX_TASKS = 6;
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
 * Card 4: the overall bar for the session's task list, then one row per task
 * with its own small bar. Row 0 is the overall bar, rows 1..n the tasks —
 * the keyboard cursor walks them in that order.
 */
export function Workflows(props: { data: WorkflowInfo[]; focused: boolean; cursor: number }) {
  if (props.data.every((w) => w.total === 0)) return <Text dimColor>keine aktiven Workflows</Text>;
  const now = Date.now();
  return (
    <>
      {props.data.map((w) => {
        const { shown, hidden } = visibleTasks(w.tasks, MAX_TASKS);
        return (
          <React.Fragment key={w.name}>
            <Text inverse={props.focused && props.cursor === 0}>
              {w.name.slice(0, 20)} [{bar(w.done, w.total)}] {w.done}/{w.total}
            </Text>
            {shown.map((t, i) => (
              <Text key={t.id} inverse={props.focused && props.cursor === i + 1} dimColor={t.status === 'pending'}>
                <Text color={COLOR[t.status]}>{ICON[t.status]}</Text> {subject(t.subject)}{' '}
                <Text color={COLOR[t.status]}>{taskBar(t.status, now)}</Text>
              </Text>
            ))}
            {hidden > 0 ? <Text dimColor>… +{hidden} weitere</Text> : null}
          </React.Fragment>
        );
      })}
    </>
  );
}
