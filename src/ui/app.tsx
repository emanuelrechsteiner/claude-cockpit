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
  { id: 'model', title: 'Modell & Effort' },
  { id: 'teamlead', title: 'Team Lead' },
  { id: 'subagents', title: 'Subagenten' },
  { id: 'workflows', title: 'Workflows' },
  { id: 'links', title: 'Links' },
  { id: 'files', title: 'Dateien' },
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

  // ── Geisterrahmen (2026-08-04) ───────────────────────────────────────────
  // Ink loescht seinen vorherigen Rahmen, indem es den Cursor um die ZULETZT
  // gezeichnete Zeilenzahl hochfaehrt (log-update). Aendert sich die
  // Terminalbreite, brechen die Zeilen anders um, die gemerkte Zahl stimmt
  // nicht mehr — der alte Rahmen bleibt stehen, der neue wird darunter
  // gezeichnet. Am laufenden Dashboard gemessen: SIEBEN gestapelte Rahmen,
  // jeder in anderer Breite. Zwei sichtbare Folgen: die Karten erscheinen
  // mehrfach, und der oberste (tote) Rahmen reagiert auf keine Taste mehr —
  // was wie eine kaputte Tastensteuerung aussieht, obwohl der Fokus im
  // lebenden Rahmen korrekt umspringt.
  //
  // Behebung: bei jeder Groessenaenderung Bildschirm UND Rueckblaetterpuffer
  // loeschen (\x1b[3J).
  //
  // prependListener ist hier LASTTRAGEND, nicht Geschmackssache: Ink haengt
  // seinen eigenen resize-Horcher im Konstruktor ein, also VOR uns. Ein
  // normales .on() liefe danach und wuerde den Rahmen wegwischen, den Ink
  // gerade gezeichnet hat — und Ink zeichnet ihn NICHT nach, weil es einen
  // unveraenderten Rahmen per Dedupe verwirft (ink.js: `output !==
  // this.lastOutput`). Genau so blieb die erste Fassung dieser Behebung leer;
  // der Pruefstand tests/e2e/resize-regression.sh hat es gefangen.
  //
  // WEITERHIN NOETIG nach dem Upgrade auf Ink 7.1.1 + Alternate Screen
  // (2026-08-04, MESSUNG statt Meinung): Ink 7.1.1 enthaelt die offizielle
  // Resize-Korrektur (PR #828, seit 6.5.1) und Alternate Screen isoliert vom
  // tmux-Scrollback — beides zusammen haelt einzelne, langsam aufeinander-
  // folgende Groessenaenderungen sauber. Ein SCHNELLER BURST an
  // Groessenaenderungen ohne Pause (echtes Ziehen am Fensterrand) bricht
  // die native Korrektur trotzdem: gemessen 8 -> 13 Kartenrahmen und ein
  // doppeltes "Team Lead" OHNE diesen Wisch-Handler, sauber (8, einfach) MIT
  // ihm — jeweils bei identischer Ink-/React-Version. Diese Behebung bleibt
  // deshalb bestehen. Test: tests/e2e/resize-regression.sh (Burst-Reiz).
  useEffect(() => {
    if (!stdout) return;
    const wipe = () => stdout.write('\x1b[2J\x1b[3J\x1b[H');
    wipe(); // Reste einer Vorgaengerinstanz im Pane
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
        // Der Zeitstempel wird ANGEZEIGT, und das ist Absicht: Ink verwirft
        // einen Rahmen, dessen Text sich nicht geaendert hat. Aendert sich nur
        // die Pane-HOEHE, bleibt der Text identisch — nach dem Loeschen bliebe
        // das Pane dann leer. Die mitlaufende Uhr garantiert, dass spaetestens
        // beim naechsten Takt wieder gezeichnet wird.
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
      // Ein Schriftzeichen bei gewaehlter Karte heisst: der Nutzer meinte
      // Claude. Fokus zurueck, Zeichen mit hinueber — nichts geht verloren.
      // Das gilt auch fuer 'q': waere es hier ein Beenden-Befehl, verschwaende
      // ein getipptes Wort mit q das ganze Dashboard.
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
          if (ac !== null) return null; // erst die Aktionsleiste schliessen …
          setFocus(null);
          returnFocusLeft(); // … dann erst zurueck zu Claude
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
      // Erstes ⏎ oeffnet die Effort-Leiste — ausser das Modell kennt keinen Effort.
      if (actionCursor === null && model.effort) {
        setActionCursor(DEFAULT_EFFORT_INDEX);
        return;
      }
      const effort = actionCursor === null ? null : EFFORT_LEVELS[actionCursor];
      const summary = effort === null ? model.label : `${model.label} · ${effort}`;
      setLastSent(`sende ${summary} …`);
      void submitToLeft(switchCommands(model, effort))
        .then(() => setLastSent(`gesendet: ${summary}`))
        .catch((e: unknown) => setLastSent(`Fehler: ${String(e).slice(0, 50)}`));
      // Zurueck zu Claude: dort erscheint die Bestaetigung (oder die Ablehnung).
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
        .catch((e: unknown) => setPending((m) => new Map(m).set(plugin.name, `Fehler: ${String(e).slice(0, 50)}`)));
      setActionCursor(null);
      return;
    }
    // Auswahl rechnet activate.ts (geprüft), das Öffnen bleibt hier.
    const target = resolveOpenTarget(card, state, cursor);
    if (target) execFile('open', openArgs(target));
  }

  if (!state) return <Text>lade…</Text>;
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
  const clock = new Date(stamp).toLocaleTimeString('de-DE', { hour12: false });
  return (
    <Box flexDirection="column">
      {/* Zwei reine Anzeigekarten, bewusst OHNE Nummer und ganz oben: sie sind
          Statuswerte, an denen es nichts auszuwaehlen gibt. Die Nummern gehoeren
          den bedienbaren Karten — seit 2026-09-24 sieben (⌘1 = Modell & Effort,
          Nutzerwunsch; die uebrigen rueckten um eins nach unten). */}
      <Card title="Kontext" focused={false}>
        <Context data={state.status} />
      </Card>
      <Card title="Verbrauch" focused={false}>
        <Usage data={state.status} />
      </Card>
      {CARDS.map((c, i) => (
        <Card key={c.id} title={c.title} index={i + 1} focused={focus === i}>
          {body[c.id]}
        </Card>
      ))}
      {state.errors.map((e) =>
        e.reason.startsWith('wartet') ? (
          <Text key={e.source} dimColor>
            {e.source}: {e.reason}
          </Text>
        ) : (
          <Text key={e.source} color="red">
            Quelle nicht lesbar: {e.source} — {e.reason.slice(0, 60)}
          </Text>
        ),
      )}
      {session.session_id === undefined && (
        <Text dimColor>wartet auf Claude-Session in diesem Ordner…</Text>
      )}
      {/* Der Fokus liegt jetzt WIRKLICH hier, wenn eine Karte gewählt ist —
          das muss sichtbar sein, sonst tippt man versehentlich ins Dashboard
          statt zu Claude. Bei gewählter Karte hebt die Zeile sich deshalb ab. */}
      {focus !== null ? (
        <Text color="cyan">
          ▶ Tastatur hier · ↑↓ wählen · ⏎ öffnen · esc zurück zu Claude · Stand {clock}
        </Text>
      ) : (
        <Text dimColor>⌘1-7 Karte wählen · q Ende · Stand {clock}</Text>
      )}
    </Box>
  );
}

// Alternate Screen (ink 7.0.0+, siehe RenderOptions.alternateScreen): dieselbe
// Technik wie vim/htop/less — das Dashboard bekommt eine eigene Bildschirmseite,
// isoliert vom tmux-Scrollback der Pane. Das behebt NICHT die Zeilenrechnung aus
// dem Geisterrahmen-Kommentar oben: log-update zaehlt weiterhin LOGISCHE statt
// PHYSISCHE Zeilen, und Ink selbst warnt in den RenderOptions-Docs, dass beim
// Verschmaelern weiterhin "ghost lines" auftreten koennen (Ink-Issue #907, bis
// heute offen — PR #916 mit einer zeilenumbruch-bewussten Korrektur wurde NICHT
// gemerged, siehe README "Geisterrahmen"). Alternate Screen sorgt nur dafuer,
// dass ein Rechenfehler nicht in den fuer den Nutzer sichtbaren Rueckblaetterpuffer
// durchschlaegt — es korrigiert den Rechenfehler selbst nicht.
render(<App />, { alternateScreen: true });
