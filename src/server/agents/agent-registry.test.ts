import { describe, expect, it, vi } from 'vitest';
import { MAX_AGENTS, MAX_NAME_LENGTH } from '../../shared/constants.js';
import { AgentRegistry, normalizeName } from './agent-registry.js';

const base = { cwd: '/repo', skin: 'mortis', permissionMode: 'default' } as const;

function added(registry: AgentRegistry, name: string) {
  const result = registry.add({ ...base, name });
  if (!result.ok) throw new Error(result.code);
  return result.agent;
}

describe('normalizeName', () => {
  it.each([
    ['  Mortis  ', 'Mortis'],
    ['front-end_2.0', 'front-end_2.0'],
    ['Ação', 'Ação'],
  ])('accepts %j', (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });

  it.each(['', '   ', '-dash', 'a/b', 'x'.repeat(MAX_NAME_LENGTH + 1)])('rejects %j', (input) => {
    expect(normalizeName(input)).toBeNull();
  });
});

describe('AgentRegistry', () => {
  it('adds, finds and removes agents', () => {
    const registry = new AgentRegistry();
    const agent = added(registry, ' Mortis ');
    expect(agent.name).toBe('Mortis');
    expect(registry.get(agent.id)).toBe(agent);
    expect(registry.findByName('mortis')).toBe(agent);
    expect(registry.list()).toEqual([agent]);
    expect(registry.remove(agent.id)).toBe(agent);
    expect(registry.size).toBe(0);
    expect(registry.remove(agent.id)).toBeUndefined();
  });

  it('rejects duplicate names ignoring case', () => {
    const registry = new AgentRegistry();
    added(registry, 'Corvin');
    expect(registry.add({ ...base, name: 'CORVIN' })).toEqual({
      ok: false,
      code: 'AGENT_NAME_TAKEN',
    });
  });

  it('rejects a duplicate id without replacing the existing agent', () => {
    const registry = new AgentRegistry();
    const first = registry.add({ ...base, id: 'a1', name: 'Mortis' });
    expect(registry.add({ ...base, id: 'a1', name: 'Corvin' })).toEqual({
      ok: false,
      code: 'AGENT_ID_TAKEN',
    });
    expect(first.ok && registry.get('a1')).toBe(first.ok && first.agent);
    expect(registry.size).toBe(1);
  });

  it('finds names with surrounding spaces and returns undefined when missing', () => {
    const registry = new AgentRegistry();
    const agent = added(registry, 'Mortis');
    expect(registry.findByName('  mortis ')).toBe(agent);
    expect(registry.findByName('Lyra')).toBeUndefined();
  });

  it('treats composed and decomposed names as the same', () => {
    const registry = new AgentRegistry();
    added(registry, 'Ação');
    expect(registry.add({ ...base, name: 'Ação' })).toEqual({
      ok: false,
      code: 'AGENT_NAME_TAKEN',
    });
  });

  it('compares names without the system locale', () => {
    const registry = new AgentRegistry();
    added(registry, 'MIRA');
    const lower = vi.spyOn(String.prototype, 'toLocaleLowerCase').mockReturnValue('mıra');
    expect(registry.findByName('mira')?.name).toBe('MIRA');
    lower.mockRestore();
  });

  it('rejects invalid names', () => {
    expect(new AgentRegistry().add({ ...base, name: '../x' })).toEqual({
      ok: false,
      code: 'INVALID_NAME',
    });
  });

  it(`stops at ${MAX_AGENTS} agents`, () => {
    const registry = new AgentRegistry();
    for (let i = 0; i < MAX_AGENTS; i++) added(registry, `agent${i}`);
    expect(registry.isFull).toBe(true);
    expect(registry.add({ ...base, name: 'extra' })).toEqual({
      ok: false,
      code: 'AGENT_LIMIT_REACHED',
    });
  });

  it('accepts a custom limit', () => {
    const registry = new AgentRegistry(1);
    added(registry, 'solo');
    expect(registry.isFull).toBe(true);
  });
});
