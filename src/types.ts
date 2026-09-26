export type CardId = 'model' | 'teamlead' | 'subagents' | 'workflows' | 'links' | 'files' | 'plugins';

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
  /** lost = the session restarted (resume/startup) before any stop arrived. */
  status: 'running' | 'done' | 'error' | 'lost';
  startedAt: number;
  endedAt?: number;
  /** The `description` of the Agent call — what it was sent to do. */
  description?: string | null;
  /** Model requested on the call ("opus", "sonnet" …); null = not overridden. */
  model?: string | null;
  /** The session's effort level at dispatch (inherited unless the agent sets its own). */
  sessionEffort?: string | null;
  /** SubagentStop's last_assistant_message. */
  lastMessage?: string | null;
}

/** model/effort from an agent definition's frontmatter (~/.claude/agents/<name>.md). */
export interface AgentDef {
  model: string | null;
  effort: string | null;
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed';

/** One task of the session's task list (TaskCreate / TaskUpdate). */
export interface TaskInfo {
  id: string;
  subject: string;
  status: TaskStatus;
}

export interface WorkflowInfo {
  name: string;
  done: number;
  total: number;
  /** The individual tasks behind done/total, in creation order. */
  tasks: TaskInfo[];
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

/** One row of Claude Code's agent panel, as handed to `subagentStatusLine`. */
export interface LiveAgent {
  id: string;
  name: string | null;
  type: string | null;
  status: string;
  description: string | null;
  label: string | null;
  startTime: number | null;
  model: string | null;
  effort: string | number | null;
  tokenCount: number | null;
}

export interface LiveAgents {
  ts: number;
  /** The panel stopped reporting: nothing is running any more. */
  stale: boolean;
  agents: LiveAgent[];
}

export interface CockpitState {
  teamLead: TeamLeadInfo;
  /** null, solange die Statuszeile noch nichts abgelegt hat. */
  status: StatusInfo | null;
  subagents: SubagentInfo[];
  /** null while subagent-statusline.sh has never written for this session. */
  liveAgents: LiveAgents | null;
  /** model/effort per agent name from ~/.claude/agents/*.md. */
  agentDefs: Map<string, AgentDef>;
  workflows: WorkflowInfo[];
  links: LinkItem[];
  files: FileItem[];
  plugins: PluginInfo[];
  errors: SourceError[];
}
