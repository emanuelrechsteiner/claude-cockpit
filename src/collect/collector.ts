import type { CockpitState, SourceError, LinkItem, FileItem, PluginInfo, StatusInfo } from '../types.js';
import type { Rules } from '../rules.js';
import { readNewLines, parseTranscriptLines } from '../parse/transcript.js';
import { reduceEvents, emptyEventState, type EventState } from '../parse/events.js';
import { fetchAgents } from './agents.js';
import { readStatus } from './status.js';

export interface CollectorOptions {
  eventsPath: string;
  transcriptPath?: string;
  rules: Rules;
  skipAgents?: boolean;
  sessionCwd?: string;
  listPlugins?: () => PluginInfo[];
  /** Briefkasten der Statuszeile; fehlt er, bleiben Kontext- und Verbrauchskarte leer. */
  statusPath?: string;
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

    return {
      teamLead,
      status,
      subagents: this.eventState.subagents,
      workflows: this.eventState.workflows,
      links: [...this.links.values()].sort((a, b) => b.ts - a.ts),
      files: [...this.files.values()],
      plugins,
      errors,
    };
  }
}
