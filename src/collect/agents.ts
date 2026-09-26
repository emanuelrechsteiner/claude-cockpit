import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Real format (verified 2026-08-03, claude v2.1.220): state is optional.
export interface AgentRow {
  pid?: number;
  sessionId?: string;
  state?: string;
  name?: string;
  cwd?: string;
  kind?: string;
  startedAt?: number;
}

export async function fetchAgents(): Promise<AgentRow[]> {
  const { stdout } = await promisify(execFile)('claude', ['agents', '--json'], { timeout: 5000 });
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) throw new Error('claude agents --json: unexpected format');
  return parsed as AgentRow[];
}
