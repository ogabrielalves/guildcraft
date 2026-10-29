import { MAX_AGENTS, MAX_NAME_LENGTH } from '../../shared/constants.js';
import type { Failure } from '../../shared/errors.js';
import type { AgentInit } from './agent.js';
import { Agent } from './agent.js';

export type RegistryResult = { ok: true; agent: Agent } | ({ ok: false } & Failure);

const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u;

export function normalizeName(name: string): string | null {
  const trimmed = name.normalize('NFC').trim();
  return trimmed.length <= MAX_NAME_LENGTH && NAME_PATTERN.test(trimmed) ? trimmed : null;
}

export class AgentRegistry {
  private readonly agents = new Map<string, Agent>();

  constructor(private readonly limit = MAX_AGENTS) {}

  get size(): number {
    return this.agents.size;
  }

  get isFull(): boolean {
    return this.agents.size >= this.limit;
  }

  add(init: AgentInit): RegistryResult {
    const name = normalizeName(init.name);
    if (name === null) return { ok: false, code: 'INVALID_NAME' };
    if (this.isFull) return { ok: false, code: 'AGENT_LIMIT_REACHED' };
    if (init.id !== undefined && this.agents.has(init.id)) {
      return { ok: false, code: 'AGENT_ID_TAKEN' };
    }
    if (this.findByName(name)) return { ok: false, code: 'AGENT_NAME_TAKEN', params: { name } };
    const agent = new Agent({ ...init, name });
    this.agents.set(agent.id, agent);
    return { ok: true, agent };
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  findByName(name: string): Agent | undefined {
    const wanted = name.normalize('NFC').trim().toLowerCase();
    return this.list().find((agent) => agent.name.toLowerCase() === wanted);
  }

  remove(id: string): Agent | undefined {
    const agent = this.agents.get(id);
    this.agents.delete(id);
    return agent;
  }

  list(): Agent[] {
    return [...this.agents.values()];
  }
}
