import React from 'react';
import { Text } from 'ink';
import type { WorkflowInfo } from '../../types.js';

function bar(done: number, total: number): string {
  const width = 12;
  const filled = Math.min(width, Math.round((width * done) / Math.max(total, 1)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function Workflows(props: { data: WorkflowInfo[]; focused: boolean; cursor: number }) {
  if (props.data.every((w) => w.total === 0)) return <Text dimColor>keine aktiven Workflows</Text>;
  return (
    <>
      {props.data.map((w, i) => (
        <Text key={w.name} inverse={props.focused && i === props.cursor}>
          {w.name.slice(0, 20)} [{bar(w.done, w.total)}] {w.done}/{w.total}
        </Text>
      ))}
    </>
  );
}
