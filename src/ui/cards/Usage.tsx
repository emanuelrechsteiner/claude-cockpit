import React from 'react';
import { Text } from 'ink';
import type { StatusInfo, StatusWindow } from '../../types.js';
import { pctColor, bar } from './Context.js';

/**
 * Restzeit bis zum Zuruecksetzen, grob wie bei Claude Desktop: "noch 2 h 15 min".
 * Liegt der Zeitpunkt in der Vergangenheit, ist das Fenster bereits zurueckgesetzt
 * und die Statuszeile hat es nur noch nicht nachgetragen — dann sagen wir das.
 */
export function untilReset(resetsAt: number | null, nowSeconds: number): string {
  if (resetsAt === null) return '';
  const left = resetsAt - nowSeconds;
  if (left <= 0) return 'zurückgesetzt';
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  if (h >= 24) return `noch ${Math.floor(h / 24)} d ${h % 24} h`;
  if (h > 0) return `noch ${h} h ${m} min`;
  return `noch ${m} min`;
}

function Window(props: { label: string; data: StatusWindow | null; now: number }) {
  const w = props.data;
  if (!w || w.usedPercentage === null) {
    return (
      <Text dimColor>
        {props.label}: noch keine Angabe
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
  if (!s) return <Text dimColor>wartet auf die Statuszeile…</Text>;

  // Beide Fenster fehlen: das ist der Normalfall fuer API-Nutzer und fuer die
  // Zeit vor der ersten API-Antwort. Ehrlich benennen statt 0 % zeigen.
  if (!s.fiveHour && !s.sevenDay) {
    return <Text dimColor>keine Limit-Angaben (nur für Claude.ai-Abos, ab der ersten Antwort)</Text>;
  }

  return (
    <>
      <Window label="5 Std" data={s.fiveHour} now={now} />
      <Window label="7 Tage" data={s.sevenDay} now={now} />
      {s.stale && <Text color="yellow">Stand veraltet — Sitzung arbeitet gerade nicht</Text>}
    </>
  );
}
