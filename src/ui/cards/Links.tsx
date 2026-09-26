import React from 'react';
import { Text } from 'ink';
import type { LinkItem } from '../../types.js';
import { osc8 } from '../../osc8.js';

const BADGE: Record<LinkItem['kind'], string> = { artifact: '◆', preview: '▲', source: '§' };

export function Links(props: { data: LinkItem[]; focused: boolean; cursor: number }) {
  if (props.data.length === 0) return <Text dimColor>no links yet</Text>;
  return (
    <>
      {props.data.slice(0, 6).map((l, i) => (
        <Text key={l.url} inverse={props.focused && i === props.cursor}>
          {BADGE[l.kind]} {osc8(l.url, l.label)}
        </Text>
      ))}
    </>
  );
}
