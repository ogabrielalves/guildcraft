import type { AgentView, VillageEvent } from '../../shared/agent.js';
import { activityOf } from './activity.js';
import type { WorkshopMap } from './map.js';
import { Villager } from './villager.js';

export const EVENT_FRESHNESS_MS = 10_000;

export class World {
  private readonly villagers = new Map<string, Villager>();

  constructor(
    readonly map: WorkshopMap,
    private readonly random: () => number = Math.random,
  ) {}

  villager(agentId: string): Villager | undefined {
    return this.villagers.get(agentId);
  }

  all(): Villager[] {
    return [...this.villagers.values()];
  }

  byDepth(): Villager[] {
    return this.all().sort((a, b) => a.position.y - b.position.y);
  }

  occupiedBays(): Set<number> {
    return new Set(this.all().map((villager) => villager.bay));
  }

  sync(agents: readonly AgentView[]): void {
    const ids = new Set(agents.map((agent) => agent.id));
    for (const id of this.villagers.keys()) {
      if (!ids.has(id)) this.villagers.delete(id);
    }
    for (const agent of agents) {
      const activity = activityOf(agent);
      const existing = this.villagers.get(agent.id);
      if (existing) {
        existing.setActivity(activity);
        continue;
      }
      const bay = this.freeBay();
      if (bay === null) continue;
      this.villagers.set(agent.id, new Villager(agent.id, bay, this.map, activity, this.random));
    }
  }

  handle(event: VillageEvent, now: number): void {
    if (event.kind !== 'finished' || now - event.at > EVENT_FRESHNESS_MS) return;
    this.villagers.get(event.agentId)?.celebrate();
  }

  visit(fromId: string, toId: string, note: string | null = null): void {
    const target = this.villagers.get(toId);
    if (target) this.villagers.get(fromId)?.startVisit(target.bay, note);
  }

  update(dt: number): void {
    for (const villager of this.villagers.values()) villager.update(dt);
  }

  private freeBay(): number | null {
    const taken = this.occupiedBays();
    const index = this.map.bays.findIndex((_, bay) => !taken.has(bay));
    return index === -1 ? null : index;
  }
}
