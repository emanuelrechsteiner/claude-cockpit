import React from 'react';
import { Box, Text } from 'ink';

/**
 * `index` ist optional: reine Anzeigekarten (Kontext, Verbrauch) tragen keine
 * Nummer, weil an ihnen nichts auszuwaehlen ist. Nur nummerierte Karten sind
 * ueber ⌘1-6 anspringbar — die Nummer ist damit ein Versprechen, keine Zierde.
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
