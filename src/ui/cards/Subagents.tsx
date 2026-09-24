import React from 'react';
import { Text } from 'ink';
import type { SubagentInfo } from '../../types.js';

const ICON: Record<SubagentInfo['status'], string> = { running: '⟳', done: '✓', error: '✗' };
const ICON_COLOR: Record<SubagentInfo['status'], string> = { running: 'yellow', done: 'green', error: 'red' };

export function Subagents(props: { data: SubagentInfo[]; focused: boolean; cursor: number }) {
  if (props.data.length === 0) return <Text dimColor>keine Subagenten</Text>;
  const recent = props.data.slice(-6);
  return (
    <>
      {recent.map((s, i) => (
        <Text key={s.id} inverse={props.focused && i === props.cursor}>
          <Text color={ICON_COLOR[s.status]}>{ICON[s.status]}</Text> {s.type.slice(0, 36)}
          {s.endedAt === undefined ? ` · ${Math.max(0, Math.round((Date.now() - s.startedAt) / 1000))}s` : ''}
        </Text>
      ))}
    </>
  );
}
