export type CardId = 'teamlead' | 'subagents' | 'workflows' | 'links' | 'files' | 'plugins';

export interface LinkItem {
  url: string;
  kind: 'artifact' | 'preview' | 'source';
  label: string;
  ts: number;
}

export interface FileItem {
  path: string;
  origin: 'candidate' | 'written';
  ts: number;
}

export interface SubagentInfo {
  id: string;
  type: string;
  status: 'running' | 'done' | 'error';
  startedAt: number;
  endedAt?: number;
}

export interface WorkflowInfo {
  name: string;
  done: number;
  total: number;
}

export interface PluginInfo {
  name: string;
  status: 'enabled' | 'disabled' | 'auth-needed' | 'update-available';
  pendingChange?: string;
}

export interface SourceError {
  source: string;
  reason: string;
}

export interface TeamLeadInfo {
  state: 'working' | 'needs-input' | 'idle' | 'unknown';
  step: string;
  model: string;
  contextPct: number;
}

/**
 * Kontext- und Verbrauchszahlen aus dem Statuszeilen-Briefkasten.
 *
 * Jedes Feld ist `null`-faehig, und das ist Absicht: `rate_limits` liefert
 * Claude Code nur fuer Claude.ai-Abos und erst nach der ersten API-Antwort der
 * Sitzung; jedes Fenster kann einzeln fehlen. Eine fehlende Angabe als 0 %
 * darzustellen waere eine Falschaussage — die Karten weisen sie als
 * "noch keine Angabe" aus.
 */
export interface StatusWindow {
  usedPercentage: number | null;
  resetsAt: number | null;
}

export interface StatusInfo {
  /** Unix-Sekunden, wann die Statuszeile diesen Stand abgelegt hat. */
  ts: number;
  /** true, wenn der Stand aelter ist als die Toleranz (siehe readStatus). */
  stale: boolean;
  model: string | null;
  contextPct: number | null;
  windowSize: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  durationMs: number | null;
  linesAdded: number | null;
  linesRemoved: number | null;
  fiveHour: StatusWindow | null;
  sevenDay: StatusWindow | null;
}

export interface CockpitState {
  teamLead: TeamLeadInfo;
  /** null, solange die Statuszeile noch nichts abgelegt hat. */
  status: StatusInfo | null;
  subagents: SubagentInfo[];
  workflows: WorkflowInfo[];
  links: LinkItem[];
  files: FileItem[];
  plugins: PluginInfo[];
  errors: SourceError[];
}
