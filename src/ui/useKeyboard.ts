import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { execFile } from 'node:child_process';
import type { CockpitState, CardId } from '../types.js';
import { KeySequencer, type KeyAction } from '../keyboard.js';
import { pluginAction, type PluginAction } from '../plugins/actions.js';
import { SETTINGS_PATH } from './bootstrap.js';
import { resolveOpenTarget, openArgs } from './activate.js';
import { returnFocusLeft, forwardToLeft, submitToLeft } from './paneFocus.js';
import { EFFORT_LEVELS, MODEL_CHOICES, DEFAULT_EFFORT_INDEX, clampIndex, switchCommands } from '../models.js';
import { PLUGIN_ACTIONS } from './cards/Plugins.js';

interface UseKeyboardParams {
  /** Card order/titles — passed in so app.tsx stays the single source. */
  cards: { id: CardId; title: string }[];
  stdin: NodeJS.ReadStream;
  setRawMode: (value: boolean) => void;
  isRawModeSupported: boolean;
  exit: (errorOrResult?: Error | unknown) => void;
  state: CockpitState | null;
  focus: number | null;
  cursor: number;
  actionCursor: number | null;
  setFocus: Dispatch<SetStateAction<number | null>>;
  setCursor: Dispatch<SetStateAction<number>>;
  setActionCursor: Dispatch<SetStateAction<number | null>>;
  setLastSent: Dispatch<SetStateAction<string | null>>;
  setPending: Dispatch<SetStateAction<Map<string, string>>>;
}

/**
 * Wires terminal key sequences (via KeySequencer) to focus/cursor state and
 * to each card's ⏎ action. The effect and `handleEnter` are kept together
 * in ONE hook on purpose — they share a closure, so the effect's dependency
 * array below stays byte-identical to the one that used to sit inline in
 * app.tsx (`[stdin, setRawMode, isRawModeSupported, exit, focus, cursor,
 * actionCursor, state]`).
 */
export function useKeyboard(params: UseKeyboardParams): void {
  const {
    cards,
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
  } = params;

  function handleEnter(): void {
    if (focus === null || !state) return;
    const card = cards[focus].id;
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
        const barLength =
          focus !== null && cards[focus].id === 'model' ? EFFORT_LEVELS.length : PLUGIN_ACTIONS.length;
        setActionCursor((ac) => (ac === null ? null : Math.min(barLength - 1, ac + 1)));
      } else if (action.type === 'enter') handleEnter();
    });
    const onData = (buf: Buffer) => seq.push(buf.toString('utf8'));
    stdin?.on('data', onData);
    return () => {
      stdin?.off('data', onData);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stdin, setRawMode, isRawModeSupported, exit, focus, cursor, actionCursor, state]);
}
