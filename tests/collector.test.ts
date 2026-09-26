import { describe, it, expect } from 'vitest';
import { Collector } from '../src/collect/collector.js';
import { loadRules } from '../src/rules.js';

const rules = loadRules(new URL('../config/rules.json', import.meta.url).pathname);

describe('Collector', () => {
  it('reports unreadable sources as errors instead of throwing', async () => {
    const c = new Collector({
      eventsPath: '/nonexistent/events.jsonl',
      transcriptPath: '/nonexistent/t.jsonl',
      rules,
      skipAgents: true,
    });
    const state = await c.poll();
    expect(state.errors.length).toBe(2);
    expect(state.errors[0].reason).toContain('waiting');
  });

  it('aggregates fixtures end-to-end, incrementally without duplicates', async () => {
    const c = new Collector({
      eventsPath: new URL('./fixtures/events-sample.jsonl', import.meta.url).pathname,
      transcriptPath: new URL('./fixtures/transcript-sample.jsonl', import.meta.url).pathname,
      rules,
      skipAgents: true,
    });
    const state = await c.poll();
    expect(state.subagents).toHaveLength(1);
    expect(state.links.length).toBe(2);
    expect(state.files.length).toBe(2);
    const second = await c.poll();
    expect(second.links.length).toBe(state.links.length);
    expect(second.subagents).toHaveLength(1);
  });
});
