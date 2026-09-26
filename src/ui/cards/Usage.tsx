import React from 'react';
import { Text } from 'ink';
import type { StatusInfo, StatusWindow } from '../../types.js';
import { pctColor, bar } from './Context.js';

/**
 * Time left until reset, roughly like Claude Desktop: "2h 15min left".
 * If the timestamp is in the past, the window has already reset and the
 * status line just hasn't caught up yet — so that's what we say.
 */
export function untilReset(resetsAt: number | null, nowSeconds: number): string {
  if (resetsAt === null) return '';
  const left = resetsAt - nowSeconds;
  if (left <= 0) return 'reset';
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)} d ${h % 24} h left`;
  if (h > 0) return `${h} h ${m} min left`;
  return `${m} min left`;
}

function Window(props: { label: string; data: StatusWindow | null; now: number }) {
  const w = props.data;
  if (!w || w.usedPercentage === null) {
    return (
      <Text dimColor>
        {props.label}: not yet available
      </Text>
    );
  }
  const pct = Math.round(w.usedPercentage);
  const rest = untilReset(w.resetsAt, props.now);
  return (
    <Text>
      <Text color={pctColor(pct)}>{bar(pct, 14)}</Text> {String(pct).padStart(3)}% {props.label}
      {rest !== '' ? <Text dimColor> · {rest}</Text> : null}
    </Text>
  );
}

export function Usage(props: { data: StatusInfo | null; now?: number }) {
  const s = props.data;
  const now = props.now ?? Math.floor(Date.now() / 1000);
  if (!s) return <Text dimColor>waiting for the status line…</Text>;

  // Both windows missing: that's the normal case for API users and for the
  // time before the session's first API response. Name it honestly instead
  // of showing 0%.
  if (!s.fiveHour && !s.sevenDay) {
    return <Text dimColor>no limit data (Claude.ai plans only, from the first reply)</Text>;
  }

  return (
    <>
      <Window label="5h" data={s.fiveHour} now={now} />
      <Window label="7d" data={s.sevenDay} now={now} />
      {s.stale && <Text color="yellow">stale — session is idle</Text>}
    </>
  );
}
