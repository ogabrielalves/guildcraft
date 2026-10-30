import type { AgentView, VillageEvent } from '../../shared/agent.js';
import { activityOf } from './activity.js';
import { Layout } from './layout.js';
import type { WorkshopMap } from './map.js';
import { Villager } from './villager.js';

export const EVENT_FRESHNESS_MS = 10_000;

export class World {
  readonly layout: Layout;
  private readonly villagers = new Map<string, Villager>();

  constructor(
    readonly map: WorkshopMap,
    private readonly random: () => number = Math.random,
  ) {
    this.layout = new Layout(map);
  }

  villager(agentId: string): Villager | undefined {
    return this.villagers.get(agentId);
  }

  all(): Villager[] {
    return [...this.villagers.values()];
  }

  byDepth(): Villager[] {
    return this.all().sort((a, b) => a.position.y - b.position.y);
  }

  owner(station: number): Villager | undefined {
    return this.all().find((villager) => villager.station === station);
  }

  freeStations(): number[] {
    const taken = new Set(this.all().map((villager) => villager.station));
    return this.map.stations.flatMap((_, index) => (taken.has(index) ? [] : [index]));
  }

  sync(agents: readonly AgentView[]): void {
    const ids = new Set(agents.map((agent) => agent.id));
    for (const [id, villager] of this.villagers) {
      if (ids.has(id)) continue;
      villager.leave();
      this.villagers.delete(id);
    }
    for (const agent of agents) {
      const activity = activityOf(agent);
      const existing = this.villagers.get(agent.id);
      if (existing) {
        existing.setActivity(activity);
        continue;
      }
      const station = this.pickStation();
      if (station === null) continue;
      const spawn = agent.status === 'starting' ? this.map.entrance : null;
      this.villagers.set(
        agent.id,
        new Villager(
          agent.id,
          station,
          this.layout,
          activity,
          this.random,
          () => this.all(),
          spawn,
        ),
      );
    }
  }

  handle(event: VillageEvent, now: number): void {
    if (event.kind !== 'finished' || now - event.at > EVENT_FRESHNESS_MS) return;
    this.villagers.get(event.agentId)?.celebrate();
  }

  visit(fromId: string, toId: string, note: string | null = null): void {
    const host = this.villagers.get(toId);
    if (host && fromId !== toId) this.villagers.get(fromId)?.startVisit(host.position, note);
  }

  update(dt: number): void {
    for (const villager of this.villagers.values()) villager.update(dt);
  }

  private pickStation(): number | null {
    const free = this.freeStations();
    return free[Math.floor(this.random() * free.length)] ?? null;
  }
}
