import React from 'react';
import { Text } from 'ink';
import type { PluginInfo } from '../../types.js';

const STATUS_ICON: Record<PluginInfo['status'], string> = {
  enabled: '●',
  disabled: '○',
  'auth-needed': '⚠',
  'update-available': '↑',
};
const STATUS_COLOR: Record<PluginInfo['status'], string> = {
  enabled: 'green',
  disabled: 'gray',
  'auth-needed': 'yellow',
  'update-available': 'cyan',
};

export const PLUGIN_ACTIONS = ['enable', 'disable', 'update', 'reauth'] as const;
export type PluginActionName = (typeof PLUGIN_ACTIONS)[number];

export function Plugins(props: {
  data: PluginInfo[];
  focused: boolean;
  cursor: number;
  actionCursor: number | null;
}) {
  if (props.data.length === 0) return <Text dimColor>no plugins found</Text>;
  const visible = props.focused ? props.data : props.data.slice(0, 6);
  return (
    <>
      {visible.map((p, i) => {
        const selected = props.focused && i === props.cursor;
        return (
          <React.Fragment key={p.name}>
            <Text inverse={selected && props.actionCursor === null}>
              <Text color={STATUS_COLOR[p.status]}>{STATUS_ICON[p.status]}</Text>{' '}
              {p.name.split('@')[0].slice(0, 32)}
            </Text>
            {selected && props.actionCursor !== null && (
              <Text>
                {'  '}
                {PLUGIN_ACTIONS.map((a, j) => (
                  <Text key={a} inverse={j === props.actionCursor}>
                    [{a}]{' '}
                  </Text>
                ))}
              </Text>
            )}
            {p.pendingChange !== undefined && (
              <Text color="yellow">{'  '}⏳ {p.pendingChange}</Text>
            )}
          </React.Fragment>
        );
      })}
      {!props.focused && props.data.length > 6 && <Text dimColor>… +{props.data.length - 6} more</Text>}
    </>
  );
}
