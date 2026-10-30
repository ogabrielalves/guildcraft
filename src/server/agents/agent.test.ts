import { describe, expect, it } from 'vitest';
import { Agent } from './agent.js';

const INIT = { name: 'Mortis', cwd: '/repo', skin: 'mortis', permissionMode: 'default' } as const;

describe('Agent', () => {
  it('starts offline with a generated id', () => {
    const agent = new Agent(INIT);
    expect(agent.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(agent.toView()).toEqual({
      id: agent.id,
      ...INIT,
      status: 'offline',
      tool: null,
      waitingFor: null,
      model: null,
      effort: null,
      queued: 0,
    });
  });

  it('keeps a given id', () => {
    expect(new Agent({ ...INIT, id: 'a1' }).id).toBe('a1');
  });

  it('reports whether the status changed', () => {
    const agent = new Agent(INIT);
    expect(agent.setStatus('idle')).toBe(true);
    expect(agent.setStatus('idle')).toBe(false);
  });

  it('tracks the current tool only while in the tool status', () => {
    const agent = new Agent(INIT);
    const edit = { name: 'Edit', detail: 'App.tsx' };
    expect(agent.setStatus('tool', edit)).toBe(true);
    expect(agent.setStatus('tool', { ...edit })).toBe(false);
    expect(agent.setStatus('tool', { name: 'Edit', detail: 'main.ts' })).toBe(true);
    expect(agent.setStatus('thinking', edit)).toBe(true);
    expect(agent.tool).toBeNull();
  });

  it('clears the tool when the tool status has none', () => {
    const agent = new Agent(INIT);
    agent.setStatus('tool', { name: 'Bash', detail: 'npm test' });
    expect(agent.setStatus('tool')).toBe(true);
    expect(agent.tool).toBeNull();
    expect(agent.setStatus('tool')).toBe(false);
  });

  it('reports whether the model or effort changed', () => {
    const agent = new Agent(INIT);
    expect(agent.setModel('claude-opus-5-5', 'medium')).toBe(true);
    expect(agent.setModel('claude-opus-5-5', 'medium')).toBe(false);
    expect(agent.setModel('claude-opus-5-5', 'high')).toBe(true);
    expect(agent.setModel('claude-sonnet-5-5', 'high')).toBe(true);
    expect(agent.setModel('claude-sonnet-5-5', null)).toBe(true);
    expect(agent.toView()).toMatchObject({ model: 'claude-sonnet-5-5', effort: null });
  });

  it('returns a view that does not share the tool object', () => {
    const agent = new Agent(INIT);
    agent.setStatus('tool', { name: 'Edit', detail: 'App.tsx' });
    const view = agent.toView();
    if (view.tool) view.tool.detail = 'changed';
    expect(agent.tool?.detail).toBe('App.tsx');
  });

  it('serializes the persisted fields', () => {
    const agent = new Agent({ ...INIT, id: 'a1' });
    agent.setStatus('idle');
    expect(agent.toStored()).toEqual({ id: 'a1', ...INIT });
  });
});
