import type { CockpitState, SourceError, LinkItem, FileItem, PluginInfo, StatusInfo, LiveAgents } from '../types.js';
import type { Rules } from '../rules.js';
import { readNewLines, parseTranscriptLines } from '../parse/transcript.js';
import { reduceEvents, emptyEventState, type EventState } from '../parse/events.js';
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
  /** Briefkasten der Statuszeile; fehlt er, bleiben Kontext- und Verbrauchskarte leer. */
  statusPath?: string;
  /** Briefkasten der Subagentenzeile (subagent-statusline.sh); fehlt er, bleibt Karte 3 bei den Hook-Ereignissen. */
  liveAgentsPath?: string;
  /** Agent definitions (~/.claude/agents) for model/effort on card 3. */
  agentsDir?: string;
}

export class Collector {
  private eventsOffset = 0;
  private transcriptOffset = 0;
  private eventState: EventState = emptyEventState();
  private links = new Map<string, LinkItem>();
  private files = new Map<string, FileItem>();

  constructor(private opts: CollectorOptions) {}

  async poll(): Promise<CockpitState> {
    const errors: SourceError[] = [];

    try {
      const { lines, newOffset } = readNewLines(this.opts.eventsPath, this.eventsOffset);
      this.eventsOffset = newOffset;
      this.eventState = reduceEvents(lines, this.eventState);
    } catch (e) {
      const enoent = (e as NodeJS.ErrnoException).code === 'ENOENT';
      errors.push({
        source: 'events',
        reason: enoent ? 'wartet — noch keine Ereignisse' : String(e),
      });
    }

    if (this.opts.transcriptPath) {
      try {
        const { lines, newOffset } = readNewLines(this.opts.transcriptPath, this.transcriptOffset);
        this.transcriptOffset = newOffset;
        const { links, files } = parseTranscriptLines(lines, this.opts.rules);
        for (const l of links) this.links.set(l.url, l);
        for (const f of files) this.files.set(f.path, f);
      } catch (e) {
        const enoent = (e as NodeJS.ErrnoException).code === 'ENOENT';
        errors.push({
          source: 'transcript',
          reason: enoent ? 'wartet — Transcript noch nicht vorhanden' : String(e),
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
          reason: enoent ? 'wartet — Statuszeile hat noch nichts abgelegt' : String(e),
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
    };
  }
}
