import React from 'react';
import { Box, Text } from 'ink';

/**
 * `index` is optional: pure display cards (Context, Usage) carry no number,
 * because there is nothing to select on them. Only numbered cards are
 * reachable via ⌘1-6 — the number is therefore a promise, not decoration.
 */
export function Card(props: { title: string; index?: number; focused: boolean; children: React.ReactNode }) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={props.focused ? 'cyan' : 'gray'}
      paddingX={1}
    >
      <Text bold color={props.focused ? 'cyan' : 'white'}>
        {props.index !== undefined ? `${props.index} · ${props.title}` : props.title}
      </Text>
      {props.children}
    </Box>
  );
}
