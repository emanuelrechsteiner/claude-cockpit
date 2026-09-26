import React from 'react';
import { Text } from 'ink';
import { EFFORT_LEVELS, MODEL_CHOICES, clampIndex } from '../../models.js';

/**
 * Card 1: ↑↓ model, ⏎ opens the effort bar, ←→ level, ⏎ sends both to
 * Claude. Models without effort are switched directly with the first ⏎.
 */
export function ModelEffort(props: {
  current: string | null;
  lastSent: string | null;
  focused: boolean;
  cursor: number;
  effortCursor: number | null;
}) {
  const selectedIndex = clampIndex(props.cursor, MODEL_CHOICES.length);
  return (
    <>
      <Text dimColor>active: {props.current ?? 'not reported yet'}</Text>
      {props.focused &&
        MODEL_CHOICES.map((m, i) => {
          const selected = i === selectedIndex;
          return (
            <React.Fragment key={m.id}>
              <Text inverse={selected && props.effortCursor === null}>
                {selected ? '›' : ' '} {m.label}
                {!m.effort && <Text dimColor> (no effort)</Text>}
              </Text>
              {selected && props.effortCursor !== null && (
                <Text>
                  {'  '}
                  {EFFORT_LEVELS.map((e, j) => (
                    <Text key={e} inverse={j === props.effortCursor}>
                      [{e}]{' '}
                    </Text>
                  ))}
                </Text>
              )}
            </React.Fragment>
          );
        })}
      {props.lastSent !== null && <Text color="yellow">→ {props.lastSent}</Text>}
    </>
  );
}
