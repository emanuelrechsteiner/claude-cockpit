import React, { useEffect, useMemo, useState } from 'react';
import { render, Box, Text, useStdin, useStdout, useApp } from 'ink';
import { execFile } from 'node:child_process';
import type { CurrentSession } from '../collect/session.js';
import { KeySequencer, type KeyAction } from '../keyboard.js';
import { pluginAction, type PluginAction } from '../plugins/actions.js';
import { SETTINGS_PATH, resolveSession, buildCollector } from './bootstrap.js';
import { resolveOpenTarget, openArgs } from './activate.js';
import { returnFocusLeft, forwardToLeft, submitToLeft } from './paneFocus.js';
import { EFFORT_LEVELS, MODEL_CHOICES, DEFAULT_EFFORT_INDEX, clampIndex, switchCommands } from '../models.js';
import type { CockpitState, CardId } from '../types.js';
import { Card } from './Card.js';
import { ModelEffort } from './cards/ModelEffort.js';
import { TeamLead } from './cards/TeamLead.js';
import { Subagents } from './cards/Subagents.js';
import { Workflows } from './cards/Workflows.js';
import { Links } from './cards/Links.js';
import { Files } from './cards/Files.js';
import { Plugins, PLUGIN_ACTIONS } from './cards/Plugins.js';
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
  const { stdout } = useStdout();
  const { exit } = useApp();

  // ── Ghost frames (2026-08-04) ────────────────────────────────────────────
  // Ink erases its previous frame by moving the cursor up by the LAST
  // rendered line count (log-update). When the terminal width changes, the
  // lines wrap differently, so the remembered count no longer matches — the
  // old frame stays put and the new one is drawn below it. Measured on the
  // running dashboard: SEVEN stacked frames, each at a different width. Two
  // visible symptoms: the cards appear multiple times, and the topmost
  // (dead) frame no longer reacts to any key — which looks like broken
  // keyboard control even though focus correctly moves in the live frame.
  //
  // Fix: on every resize, clear the screen AND the scrollback buffer
  // (\x1b[3J).
  //
  // prependListener is LOAD-BEARING here, not a style choice: Ink attaches
  // its own resize listener in its constructor, i.e. BEFORE us. A plain
  // .on() would run afterward and would wipe the frame Ink just drew — and
  // Ink would NOT redraw it, because it discards an unchanged frame via
  // dedupe (ink.js: `output !== this.lastOutput`). That is exactly why the
  // first version of this fix did nothing; tests/e2e/resize-regression.sh
  // caught it.
  //
  // STILL NEEDED after the upgrade to Ink 7.1.1 + Alternate Screen
  // (2026-08-04, MEASURED, not assumed): Ink 7.1.1 includes the official
  // resize fix (PR #828, since 6.5.1) and Alternate Screen isolates from
  // tmux scrollback — together these keep single, slowly-successive resizes
  // clean. A FAST BURST of resizes without a pause (a real window-edge drag)
  // still breaks the native fix: measured 8 -> 13 card frames and a
  // duplicated "Team Lead" WITHOUT this wipe handler, clean (8, single)
  // WITH it — same Ink/React version in both cases. This fix therefore
  // stays in place. Test: tests/e2e/resize-regression.sh (burst stimulus).
  useEffect(() => {
    if (!stdout) return;
    const wipe = () => stdout.write('\x1b[2J\x1b[3J\x1b[H');
    wipe(); // leftovers from a previous instance in the pane
    stdout.prependListener('resize', wipe);
    return () => {
      stdout.off('resize', wipe);
    };
  }, [stdout]);

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

  useEffect(() => {
    if (!isRawModeSupported) return;
    setRawMode(true);
    const seq = new KeySequencer((action: KeyAction) => {
      // A printable character while a card is selected means: the user
      // meant Claude. Focus goes back, the character is forwarded — nothing
      // is lost. That also applies to 'q': if it were a quit command here,
      // a typed word containing q would close the whole dashboard.
      const strayText =
        action.type === 'text' ? action.text : action.type === 'quit' && focus !== null ? 'q' : null;
      if (strayText !== null) {
        setFocus(null);
        setActionCursor(null);
        forwardToLeft(strayText);
        returnFocusLeft();
        return;
      }
      if (action.type === 'quit') exit();
      else if (action.type === 'focus') {
        setFocus(action.card - 1);
        setCursor(0);
        setActionCursor(null);
      } else if (action.type === 'escape') {
        setActionCursor((ac) => {
          if (ac !== null) return null; // close the action bar first …
          setFocus(null);
          returnFocusLeft(); // … only then back to Claude
          return null;
        });
      } else if (action.type === 'up') setCursor((c) => Math.max(0, c - 1));
      else if (action.type === 'down') setCursor((c) => c + 1);
      else if (action.type === 'left') setActionCursor((ac) => (ac === null ? null : Math.max(0, ac - 1)));
      else if (action.type === 'right') {
        const barLength = focus !== null && CARDS[focus].id === 'model' ? EFFORT_LEVELS.length : PLUGIN_ACTIONS.length;
        setActionCursor((ac) => (ac === null ? null : Math.min(barLength - 1, ac + 1)));
      }
      else if (action.type === 'enter') handleEnter();
    });
    const onData = (buf: Buffer) => seq.push(buf.toString('utf8'));
    stdin?.on('data', onData);
    return () => {
      stdin?.off('data', onData);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stdin, setRawMode, isRawModeSupported, exit, focus, cursor, actionCursor, state]);

  function handleEnter(): void {
    if (focus === null || !state) return;
    const card = CARDS[focus].id;
    if (card === 'model') {
      const model = MODEL_CHOICES[clampIndex(cursor, MODEL_CHOICES.length)];
      // First ⏎ opens the effort bar — unless the model has no effort levels.
      if (actionCursor === null && model.effort) {
        setActionCursor(DEFAULT_EFFORT_INDEX);
        return;
      }
      const effort = actionCursor === null ? null : EFFORT_LEVELS[actionCursor];
      const summary = effort === null ? model.label : `${model.label} · ${effort}`;
      setLastSent(`sending ${summary} …`);
      void submitToLeft(switchCommands(model, effort))
        .then(() => setLastSent(`sent: ${summary}`))
        .catch((e: unknown) => setLastSent(`Error: ${String(e).slice(0, 50)}`));
      // Back to Claude: the confirmation (or rejection) appears there.
      setActionCursor(null);
      setFocus(null);
      returnFocusLeft();
      return;
    }
    if (card === 'plugins') {
      if (actionCursor === null) {
        setActionCursor(0);
        return;
      }
      const plugin = state.plugins[cursor];
      if (!plugin) return;
      const action = PLUGIN_ACTIONS[actionCursor] as PluginAction;
      void pluginAction(plugin.name, action, SETTINGS_PATH)
        .then((msg) => setPending((m) => new Map(m).set(plugin.name, msg)))
        .catch((e: unknown) => setPending((m) => new Map(m).set(plugin.name, `Error: ${String(e).slice(0, 50)}`)));
      setActionCursor(null);
      return;
    }
    // The selection is computed by activate.ts (tested); opening stays here.
    const target = resolveOpenTarget(card, state, cursor);
    if (target) execFile('open', openArgs(target));
  }

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
  const clock = new Date(stamp).toLocaleTimeString('en-US', { hour12: false });
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
      {/* Focus is now REALLY here when a card is selected — that has to be
          visible, otherwise you type into the dashboard by mistake instead
          of into Claude. The line stands out while a card is selected. */}
      {focus !== null ? (
        <Text color="cyan">
          ▶ keyboard here · ↑↓ select · ⏎ open · esc back to Claude · as of {clock}
        </Text>
      ) : (
        <Text dimColor>⌘1-7 select card · q quit · as of {clock}</Text>
      )}
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
