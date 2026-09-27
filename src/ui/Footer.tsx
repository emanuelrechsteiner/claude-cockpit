import React from 'react';
import { Text } from 'ink';
import type { Freshness } from '../types.js';
import { dataAge } from './freshness-view.js';

/**
 * Bottom status line: the keyboard hint (focused vs. idle), the clock the
 * UI last redrew at, and how old the sensor data behind it is. `stamp` and
 * `freshness` are passed in rather than read from context, so the component
 * stays a pure render of its props.
 */
export function Footer(props: { focused: boolean; freshness: Freshness; stamp: number }) {
  const clock = new Date(props.stamp).toLocaleTimeString('en-US', { hour12: false });
  // The clock only says when the UI last redrew; this says how old the data
  // behind it is — so a sensor that stopped writing does not pass for a
  // quiet session.
  const age = dataAge(props.freshness, props.stamp);
  const ageText = age.stale ? (
    <Text color="yellow">{age.text} — sensor silent?</Text>
  ) : (
    <Text dimColor>{age.text}</Text>
  );
  // Focus is now REALLY here when a card is selected — that has to be
  // visible, otherwise you type into the dashboard by mistake instead
  // of into Claude. The line stands out while a card is selected.
  return props.focused ? (
    <Text>
      <Text color="cyan">▶ keyboard here · ↑↓ select · ⏎ open · esc back to Claude · as of {clock} · </Text>
      {ageText}
    </Text>
  ) : (
    <Text>
      <Text dimColor>⌘1-7 select card · q quit · as of {clock} · </Text>
      {ageText}
    </Text>
  );
}
