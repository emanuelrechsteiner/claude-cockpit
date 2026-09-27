import { statSync } from 'node:fs';
import type { CockpitState, SourceError, LinkItem, FileItem, PluginInfo, StatusInfo, LiveAgents } from '../types.js';
import type { Rules } from '../rules.js';
import { readNewLines, parseTranscriptLines } from '../parse/transcript.js';
import { reduceEvents, emptyEventState, mergeDispatches, type EventState } from '../parse/events.js';
import { fetchAgents } from './agents.js';
import { readStatus } from './status.js';
import { readLiveAgents } from './live-agents.js';
import { readAgentDefs } from './agent-defs.js';

export interface CollectorOptions {
  eventsPath: string;
  transcriptPath?: string;
  rules: Rules;
  skipAgents?: boolean;
  sessionCwd?: string;
  listPlugins?: () => PluginInfo[];
  /** Status line's mailbox; if missing, the Context and Usage cards stay empty. */
  statusPath?: string;
  /** Subagent status line's mailbox (subagent-statusline.sh); if missing, card 3 falls back to the hook events. */
  liveAgentsPath?: string;
  /** Agent definitions (~/.claude/agents) for model/effort on card 3. */
  agentsDir?: string;
}

/**
 * mtime (ms) of a sensor file. No path configured or file absent → null
 * (the normal "not written yet" state); any other stat failure is reported.
 */
function fileAgeMs(path: string | undefined, source: string, errors: SourceError[]): number | null {
  if (path === undefined) return null;
  try {
    return statSync(path).mtimeMs;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      errors.push({ source, reason: `cannot read file age: ${String(e)}` });
    }
    return null;
  }
}

export class Collector {
  private eventsOffset = 0;
  private transcriptOffset = 0;
  private eventState: EventState = emptyEventState();
  private links = new Map<string, LinkItem>();
  private files = new Map<string, FileItem>();
  /** Agent/Task tool_use ids seen in the transcript so far (see dispatch-map.ts). */
  private agentCalls = new Set<string>();
  private eventsSize = -1;
  /** Consecutive polls in which a record fragment waited and the file did not grow. */
  private fragmentStalls = 0;

  constructor(private opts: CollectorOptions) {}

  async poll(): Promise<CockpitState> {
    const errors: SourceError[] = [];

    try {
      const { lines, newOffset, size } = readNewLines(this.opts.eventsPath, this.eventsOffset);
      this.eventsOffset = newOffset;
      this.eventState = reduceEvents(lines, this.eventState);
      const grew = size !== this.eventsSize;
      this.eventsSize = size;
      this.fragmentStalls = this.eventState.pendingFragment === null ? 0 : grew ? 0 : this.fragmentStalls + 1;
    } catch (e) {
      const enoent = (e as NodeJS.ErrnoException).code === 'ENOENT';
      errors.push({
        source: 'events',
        reason: enoent ? 'waiting — no events yet' : String(e),
      });
    }
    if (this.eventState.unreadable > 0) {
      errors.push({
        source: 'events',
        reason: `${this.eventState.unreadable} unreadable line(s) — some tasks/subagents may be missing`,
      });
    }
    // A head held back for its tail is normal for one poll; a file that has
    // stopped growing will never deliver it — say so instead of waiting silently.
    if (this.fragmentStalls >= 2) {
      errors.push({ source: 'events', reason: '1 record cut off at end of file — waiting for its tail' });
    }

    if (this.opts.transcriptPath) {
      try {
        const { lines, newOffset } = readNewLines(this.opts.transcriptPath, this.transcriptOffset);
        this.transcriptOffset = newOffset;
        const { links, files, dispatches } = parseTranscriptLines(lines, this.opts.rules, this.agentCalls);
        for (const l of links) this.links.set(l.url, l);
        for (const f of files) this.files.set(f.path, f);
        this.eventState = mergeDispatches(this.eventState, dispatches);
      } catch (e) {
        const enoent = (e as NodeJS.ErrnoException).code === 'ENOENT';
        errors.push({
          source: 'transcript',
          reason: enoent ? 'waiting — no transcript yet' : String(e),
        });
      }
    }

    let teamLead: CockpitState['teamLead'] = { state: 'unknown', step: '', model: '', contextPct: 0 };
    if (!this.opts.skipAgents) {
      try {
        const rows = await fetchAgents();
        const match = this.opts.sessionCwd ? rows.find((r) => r.cwd === this.opts.sessionCwd) : rows[0];
        if (match) {
          const state = match.state ?? 'working';
          teamLead = {
            state: (['working', 'needs-input', 'idle'] as const).includes(state as never)
              ? (state as CockpitState['teamLead']['state'])
              : 'working',
            step: match.name ?? '',
            model: '',
            contextPct: 0,
          };
        }
      } catch (e) {
        errors.push({ source: 'agents', reason: String(e) });
      }
    }

    let plugins: PluginInfo[] = [];
    if (this.opts.listPlugins) {
      try {
        plugins = this.opts.listPlugins();
      } catch (e) {
        errors.push({ source: 'plugins', reason: String(e) });
      }
    }

    let status: StatusInfo | null = null;
    if (this.opts.statusPath) {
      try {
        status = readStatus(this.opts.statusPath);
      } catch (e) {
        const enoent = (e as NodeJS.ErrnoException).code === 'ENOENT';
        errors.push({
          source: 'status',
          reason: enoent ? 'waiting — status line has not written yet' : String(e),
        });
      }
    }

    let liveAgents: LiveAgents | null = null;
    if (this.opts.liveAgentsPath) {
      try {
        liveAgents = readLiveAgents(this.opts.liveAgentsPath);
      } catch (e) {
        // Missing file is the normal state before the first subagent runs;
        // only a real read/parse failure is worth reporting.
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') errors.push({ source: 'subagents', reason: String(e) });
      }
    }

    const freshness = {
      eventsMs: fileAgeMs(this.opts.eventsPath, 'events', errors),
      statusMs: fileAgeMs(this.opts.statusPath, 'status', errors),
      liveMs: fileAgeMs(this.opts.liveAgentsPath, 'subagents', errors),
    };

    return {
      teamLead,
      status,
      subagents: this.eventState.subagents,
      liveAgents,
      agentDefs: this.opts.agentsDir ? readAgentDefs(this.opts.agentsDir) : new Map(),
      workflows: this.eventState.workflows,
      links: [...this.links.values()].sort((a, b) => b.ts - a.ts),
      files: [...this.files.values()],
      plugins,
      errors,
      freshness,
      unreadableEvents: this.eventState.unreadable,
      lastEventTs: this.eventState.lastEventTs,
      unmatchedStops: this.eventState.unmatchedStops,
    };
  }
}
