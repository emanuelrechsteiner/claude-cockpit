import React, { useEffect, useMemo, useState } from 'react';
import { render, Box, Text, useStdin, useApp } from 'ink';
import type { CurrentSession } from '../collect/session.js';
import { resolveSession, buildCollector } from './bootstrap.js';
import type { CockpitState, CardId } from '../types.js';
import { Card } from './Card.js';
import { Footer } from './Footer.js';
import { useWipeOnResize } from './useWipeOnResize.js';
import { useKeyboard } from './useKeyboard.js';
import { ModelEffort } from './cards/ModelEffort.js';
import { TeamLead } from './cards/TeamLead.js';
import { Subagents } from './cards/Subagents.js';
import { Workflows } from './cards/Workflows.js';
import { Links } from './cards/Links.js';
import { Files } from './cards/Files.js';
import { Plugins } from './cards/Plugins.js';
import { Context } from './cards/Context.js';
import { Usage } from './cards/Usage.js';

const CARDS: { id: CardId; title: string }[] = [
  { id: 'model', title: 'Model & Effort' },
  { id: 'teamlead', title: 'Team Lead' },
  { id: 'subagents', title: 'Subagents' },
  { id: 'workflows', title: 'Workflows' },
  { id: 'links', title: 'Links' },
  { id: 'files', title: 'Files' },
  { id: 'plugins', title: 'Plugins' },
];

function App() {
  const [session, setSession] = useState<CurrentSession>(resolveSession);
  const collector = useMemo(() => buildCollector(session), [session.session_id]);
  const [state, setState] = useState<CockpitState | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [cursor, setCursor] = useState(0);
  const [actionCursor, setActionCursor] = useState<number | null>(null);
  const [pending, setPending] = useState<Map<string, string>>(new Map());
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [stamp, setStamp] = useState(() => Date.now());
  const { stdin, setRawMode, isRawModeSupported } = useStdin();
  const { exit } = useApp();

  // Ghost-frame resize wipe: see useWipeOnResize.ts for the load-bearing
  // prependListener comment (Ink attaches its own resize listener first;
  // a plain .on() would run too late and get deduped away).
  useWipeOnResize();

  useEffect(() => {
    const tick = () => {
      const fresh = resolveSession();
      if (fresh.session_id !== undefined && fresh.session_id !== session.session_id) {
        setSession(fresh);
        return;
      }
      void collector.poll().then((s) => {
        setState(s);
        // The timestamp is DISPLAYED, and that is intentional: Ink discards
        // a frame whose text hasn't changed. If only the pane HEIGHT
        // changes, the text stays identical — after clearing, the pane
        // would then stay blank. The running clock guarantees that it gets
        // redrawn at the latest on the next tick.
        setStamp(Date.now());
      });
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => clearInterval(t);
  }, [collector, session.session_id]);

  useKeyboard({
    cards: CARDS,
    stdin,
    setRawMode,
    isRawModeSupported,
    exit,
    state,
    focus,
    cursor,
    actionCursor,
    setFocus,
    setCursor,
    setActionCursor,
    setLastSent,
    setPending,
  });

  if (!state) return <Text>loading…</Text>;
  const plugins = state.plugins.map((p) => ({ ...p, pendingChange: pending.get(p.name) ?? p.pendingChange }));
  const body: Record<CardId, React.ReactNode> = {
    model: (
      <ModelEffort
        current={state.status?.model ?? null}
        lastSent={lastSent}
        focused={focus === 0}
        cursor={cursor}
        effortCursor={focus === 0 ? actionCursor : null}
      />
    ),
    teamlead: <TeamLead data={state.teamLead} focused={focus === 1} cursor={cursor} />,
    subagents: (
      <Subagents
        data={state.subagents}
        live={state.liveAgents}
        defs={state.agentDefs}
        sessionModel={state.status?.model ?? null}
        focused={focus === 2}
        cursor={cursor}
      />
    ),
    workflows: <Workflows data={state.workflows} focused={focus === 3} cursor={cursor} />,
    links: <Links data={state.links} focused={focus === 4} cursor={cursor} />,
    files: <Files data={state.files} focused={focus === 5} cursor={cursor} />,
    plugins: <Plugins data={plugins} focused={focus === 6} cursor={cursor} actionCursor={actionCursor} />,
  };
  return (
    <Box flexDirection="column">
      {/* Two pure display cards, deliberately WITHOUT a number and right at
          the top: they are status values with nothing to select. Numbers
          belong to the operable cards — seven since 2026-09-24 (⌘1 = Model &
          Effort, per the user's wish; the rest moved down by one). */}
      <Card title="Context" focused={false}>
        <Context data={state.status} />
      </Card>
      <Card title="Usage" focused={false}>
        <Usage data={state.status} />
      </Card>
      {CARDS.map((c, i) => (
        <Card key={c.id} title={c.title} index={i + 1} focused={focus === i}>
          {body[c.id]}
        </Card>
      ))}
      {state.errors.map((e) =>
        e.reason.startsWith('waiting') ? (
          <Text key={e.source} dimColor>
            {e.source}: {e.reason}
          </Text>
        ) : (
          <Text key={e.source} color="red">
            source unreadable: {e.source} — {e.reason.slice(0, 60)}
          </Text>
        ),
      )}
      {session.session_id === undefined && (
        <Text dimColor>waiting for a Claude session in this folder…</Text>
      )}
      <Footer focused={focus !== null} freshness={state.freshness} stamp={stamp} />
    </Box>
  );
}

// Alternate Screen (ink 7.0.0+, see RenderOptions.alternateScreen): the same
// technique as vim/htop/less — the dashboard gets its own screen page,
// isolated from the pane's tmux scrollback. This does NOT fix the line-count
// math from the ghost-frame comment above: log-update still counts LOGICAL
// rather than PHYSICAL lines, and Ink's own RenderOptions docs warn that
// "ghost lines" can still occur when narrowing (Ink issue #907, still open —
// PR #916 with a wrap-aware fix was NOT merged, see README "Ghost frames").
// Alternate Screen only keeps a computation error from bleeding into the
// scrollback buffer the user can see — it does not correct the computation
// error itself.
render(<App />, { alternateScreen: true });
