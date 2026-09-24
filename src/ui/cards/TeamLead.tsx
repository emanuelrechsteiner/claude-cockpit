import React from 'react';
import { Text } from 'ink';
import type { TeamLeadInfo } from '../../types.js';

const COLOR: Record<TeamLeadInfo['state'], string> = {
  working: 'green',
  'needs-input': 'yellow',
  idle: 'gray',
  unknown: 'gray',
};

export function TeamLead(props: { data: TeamLeadInfo; focused: boolean; cursor: number }) {
  const { data } = props;
  return (
    <>
      <Text color={COLOR[data.state]} inverse={data.state === 'needs-input'}>
        ● {data.state}
      </Text>
      {data.step !== '' && <Text dimColor>{data.step.slice(0, 42)}</Text>}
      {data.model !== '' && (
        <Text>
          {data.model} · {data.contextPct}% ctx
        </Text>
      )}
    </>
  );
}
