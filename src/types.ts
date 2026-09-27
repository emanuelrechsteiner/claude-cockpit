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
  /**
   * lost = the session restarted (resume/startup) before any stop arrived.
   * denied = the Agent call was refused (e.g. auto-mode classifier); the
   * subagent never started.
   */
  status: 'running' | 'done' | 'error' | 'lost' | 'denied';
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
  /**
   * 'tasks' = Claude Code's own task list (TaskCreated/TaskUpdated) — only
   * appears when the model chooses to keep one. 'wave' = derived from the
   * SubagentStart/SubagentStop hook events, which fire deterministically
   * whenever a subagent runs, whether or not a task list exists.
   */
  source: 'tasks' | 'wave';
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
 * Context and usage numbers from the status line's mailbox.
 *
 * Every field is nullable, and that is intentional: Claude Code only returns
 * `rate_limits` for Claude.ai subscription plans and only after the
 * session's first API response; either window can be individually absent.
 * Showing a missing value as 0% would be a false claim — the cards report
 * it as "not yet available" instead.
 */
export interface StatusWindow {
  usedPercentage: number | null;
  resetsAt: number | null;
}

export interface StatusInfo {
  /** Unix seconds when the status line wrote this reading. */
  ts: number;
  /** true when the reading is older than the tolerance (see readStatus). */
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

/**
 * When each sensor last wrote (file mtime, ms). null = the file does not
 * exist (yet) or no path was configured. Lets the UI tell a quiet session
 * from a sensor that stopped writing.
 */
export interface Freshness {
  eventsMs: number | null;
  statusMs: number | null;
  liveMs: number | null;
}

export interface CockpitState {
  teamLead: TeamLeadInfo;
  /** null while the status line has not written anything yet. */
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
  /** When each sensor file last changed; drives the footer's data-age indicator. */
  freshness: Freshness;
  /** Event fragments that could not be read (see EventState.unreadable). */
  unreadableEvents?: number;
  /** ms of the newest applied hook event; null before the first. */
  lastEventTs?: number | null;
  /** SubagentStops attributed by guess, not by transcript link (see EventState.unmatchedStops). */
  unmatchedStops?: number;
}
