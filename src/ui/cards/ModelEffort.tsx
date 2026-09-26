import React from 'react';
import { Text } from 'ink';
import { EFFORT_LEVELS, MODEL_CHOICES, clampIndex } from '../../models.js';

/**
 * Karte 1: ↑↓ Modell, ⏎ oeffnet die Effort-Leiste, ←→ Stufe, ⏎ schickt beides
 * an Claude. Modelle ohne Effort werden mit dem ersten ⏎ direkt umgestellt.
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
      <Text dimColor>aktiv: {props.current ?? 'noch keine Angabe'}</Text>
      {props.focused &&
        MODEL_CHOICES.map((m, i) => {
          const selected = i === selectedIndex;
          return (
            <React.Fragment key={m.id}>
              <Text inverse={selected && props.effortCursor === null}>
                {selected ? '›' : ' '} {m.label}
                {!m.effort && <Text dimColor> (ohne Effort)</Text>}
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
