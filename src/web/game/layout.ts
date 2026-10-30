import type { Point, Spot, SpotKind, WorkshopMap } from './map.js';
import { zoneAt } from './map.js';
import { NAV_CELL, NavGrid } from './pathing.js';

export interface ZonePaths {
  wander: Point[];
  routes: Point[][];
}

export class Layout {
  readonly nav: NavGrid;
  private readonly claims = new Map<Spot, string>();
  private readonly grids = new Map<string, NavGrid>();

  constructor(readonly map: WorkshopMap) {
    this.nav = new NavGrid(map);
  }

  zoneOf(target: Point): string | null {
    return zoneAt(this.map, target);
  }

  navFor(zone: string | null): NavGrid {
    const areas = this.map.zones.find(({ id }) => id === zone)?.areas;
    if (zone === null || areas === undefined) return this.nav;
    let grid = this.grids.get(zone);
    if (grid === undefined) {
      grid = new NavGrid(this.map, NAV_CELL, areas);
      this.grids.set(zone, grid);
    }
    return grid;
  }

  paths(zone: string | null): ZonePaths {
    const keep = (target: Point | undefined) =>
      zone === null || (target !== undefined && this.zoneOf(target) === zone);
    return {
      wander: this.map.wander.filter((target) => keep(target)),
      routes: this.map.routes.filter((route) => keep(route[0])),
    };
  }

  claim(
    kind: SpotKind,
    owner: string,
    random: () => number = Math.random,
    zone: string | null = null,
  ): Spot | null {
    this.release(owner);
    const free = this.free(kind, zone);
    const spot = free[Math.floor(random() * free.length)];
    if (spot === undefined) return null;
    this.claims.set(spot, owner);
    return spot;
  }

  hasFree(kind: SpotKind, zone: string | null = null): boolean {
    return this.free(kind, zone).length > 0;
  }

  release(owner: string): void {
    for (const [spot, claimant] of this.claims) {
      if (claimant === owner) this.claims.delete(spot);
    }
  }

  holder(spot: Spot): string | null {
    return this.claims.get(spot) ?? null;
  }

  private free(kind: SpotKind, zone: string | null): Spot[] {
    return this.map.spots.filter(
      (spot) =>
        spot.kind === kind &&
        !this.claims.has(spot) &&
        (zone === null || this.zoneOf(spot.at) === zone),
    );
  }
}
