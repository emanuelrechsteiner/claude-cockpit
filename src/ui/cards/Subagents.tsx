import React from 'react';
import { Text } from 'ink';
import type { AgentDef, LiveAgents, SubagentInfo } from '../../types.js';
import { subagentRows } from './subagent-view.js';

/** Four subagents at two lines each keep the card inside the sidebar. */
const MAX_ROWS = 4;
const LINE = 48;

function clip(s: string): string {
  return s.length > LINE ? `${s.slice(0, LINE - 1)}…` : s;
}

/**
 * Card 3. Every subagent gets two lines: the title (status glyph, agent
 * type, model · effort · elapsed) and a status line with what it is doing —
 * its task while it runs, "idle · fertig vor N min" once it is done.
 * Row logic and data precedence: subagent-view.ts (subagentRows).
 */
export function Subagents(props: {
  data: SubagentInfo[];
  live: LiveAgents | null;
  defs: Map<string, AgentDef>;
  sessionModel: string | null;
  focused: boolean;
  cursor: number;
}) {
  const rows = subagentRows({
    events: props.data,
    live: props.live,
    defs: props.defs,
    sessionModel: props.sessionModel,
    now: Date.now(),
  });
  if (rows.length === 0) return <Text dimColor>keine Subagenten</Text>;
  const shown = rows.slice(0, MAX_ROWS);
  return (
    <>
      {shown.map((r, i) => (
        <React.Fragment key={r.key}>
          <Text inverse={props.focused && i === props.cursor}>
            <Text color={r.color}>{r.icon}</Text> <Text bold={r.running}>{r.title}</Text>
            {r.meta !== '' ? <Text dimColor>{` · ${r.meta}`}</Text> : null}
          </Text>
          <Text dimColor>
            {'  '}
            {clip(r.activity)}
          </Text>
        </React.Fragment>
      ))}
      {rows.length > MAX_ROWS ? <Text dimColor>… +{rows.length - MAX_ROWS} weitere</Text> : null}
    </>
  );
}
