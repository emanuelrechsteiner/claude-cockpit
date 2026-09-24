import React from 'react';
import { Text } from 'ink';
import type { StatusInfo } from '../../types.js';

/** Ampel wie in der Statuszeile: gruen < 50 %, gelb ab 50 %, rot ab 75 %. */
export function pctColor(pct: number): string {
  if (pct >= 75) return 'red';
  if (pct >= 50) return 'yellow';
  return 'green';
}

/** Balken aus Blockzeichen — 20 Zellen, damit er in jede Pane-Breite passt. */
export function bar(pct: number, width = 20): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const full = Math.round((clamped / 100) * width);
  return '█'.repeat(full) + '░'.repeat(width - full);
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function Context(props: { data: StatusInfo | null }) {
  const s = props.data;
  if (!s) return <Text dimColor>wartet auf die Statuszeile…</Text>;
  if (s.contextPct === null) return <Text dimColor>keine Kontextangabe</Text>;

  const pct = Math.round(s.contextPct);
  return (
    <>
      <Text>
        <Text color={pctColor(pct)}>{bar(pct)}</Text> {pct}%
      </Text>
      {s.windowSize !== null && s.inputTokens !== null && (
        <Text dimColor>
          {compact(s.inputTokens)} von {compact(s.windowSize)} Token
        </Text>
      )}
      {s.costUsd !== null && (
        <Text dimColor>
          ${s.costUsd.toFixed(2)} diese Sitzung
          {s.linesAdded !== null && s.linesRemoved !== null
            ? ` · +${s.linesAdded}/-${s.linesRemoved} Zeilen`
            : ''}
        </Text>
      )}
      {s.stale && <Text color="yellow">Stand veraltet — Sitzung arbeitet gerade nicht</Text>}
    </>
  );
}
