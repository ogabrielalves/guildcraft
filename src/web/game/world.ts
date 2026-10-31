import type { AgentView, VillageEvent } from '../../shared/agent.js';
import { activityOf } from './activity.js';
import { Layout } from './layout.js';
import type { WorkshopMap } from './map.js';
import { stationAt } from './map.js';
import { Villager } from './villager.js';

export const EVENT_FRESHNESS_MS = 10_000;

export class World {
  readonly layout: Layout;
  private readonly villagers = new Map<string, Villager>();
  private readonly projects = new Map<string, string>();
  private readonly zones: Map<string, string>;

  constructor(
    readonly map: WorkshopMap,
    private readonly random: () => number = Math.random,
    private readonly memory: ZoneMemory = memoryOnly(),
  ) {
    this.layout = new Layout(map);
    this.zones = new Map(Object.entries(memory.load()));
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
    const left = new Set<string>();
    for (const [id, villager] of this.villagers) {
      if (ids.has(id)) continue;
      left.add(this.projects.get(id) ?? '');
      villager.leave();
      this.villagers.delete(id);
      this.projects.delete(id);
    }
    this.releaseZones(left);
    for (const agent of agents) {
      const activity = activityOf(agent);
      const existing = this.villagers.get(agent.id);
      if (existing) {
        existing.setActivity(activity);
        continue;
      }
      const project = projectOf(agent.cwd);
      const station = this.pickStation(project);
      if (station === null) continue;
      this.projects.set(agent.id, project);
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

  private releaseZones(left: ReadonlySet<string>): void {
    const active = new Set(this.projects.values());
    let changed = false;
    for (const project of left) {
      if (active.has(project) || !this.zones.has(project)) continue;
      this.zones.delete(project);
      changed = true;
    }
    if (changed) this.memory.save(Object.fromEntries(this.zones));
  }

  private stationZone(station: number): string | null {
    return this.layout.zoneOf(stationAt(this.map, station).work);
  }

  private zoneFor(project: string): string | null {
    const active = new Set(this.projects.values());
    const usedBy = (zone: string) =>
      [...this.zones].some(([other, id]) => id === zone && other !== project && active.has(other));
    const remembered = this.zones.get(project);
    if (remembered !== undefined && !usedBy(remembered)) return remembered;
    const capacity = new Map<string, number>();
    for (let station = 0; station < this.map.stations.length; station++) {
      const zone = this.stationZone(station);
      if (zone !== null) capacity.set(zone, (capacity.get(zone) ?? 0) + 1);
    }
    const open = [...capacity].filter(([zone]) => !usedBy(zone));
    open.sort((a, b) => b[1] - a[1]);
    const zone = open[0]?.[0] ?? null;
    if (zone !== null) {
      this.zones.set(project, zone);
      this.memory.save(Object.fromEntries(this.zones));
    }
    return zone;
  }

  private pickStation(project: string): number | null {
    const free = this.freeStations();
    const zone = this.zoneFor(project);
    const home = free.filter((station) => this.stationZone(station) === zone);
    const claimed = new Set(this.zones.values());
    const open = free.filter((station) => !claimed.has(this.stationZone(station) ?? ''));
    const pool = [home, open, free].find((candidates) => candidates.length > 0) ?? [];
    return pool[Math.floor(this.random() * pool.length)] ?? null;
  }
}

export interface ZoneMemory {
  load(): Record<string, string>;
  save(zones: Record<string, string>): void;
}

function memoryOnly(): ZoneMemory {
  return { load: () => ({}), save: () => undefined };
}

export function browserZoneMemory(key = 'guildcraft.zones'): ZoneMemory {
  return {
    load() {
      try {
        const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
        return typeof parsed === 'object' && parsed !== null
          ? (parsed as Record<string, string>)
          : {};
      } catch {
        return {};
      }
    },
    save(zones) {
      try {
        localStorage.setItem(key, JSON.stringify(zones));
      } catch {
        // storage unavailable; zones just won't survive a reload
      }
    },
  };
}

export function projectOf(cwd: string): string {
  return cwd.replace(/[\\/]+/g, '/').replace(/\/$/, '');
}
