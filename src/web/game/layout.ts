import type { Spot, SpotKind, WorkshopMap } from './map.js';
import { NavGrid } from './pathing.js';

export class Layout {
  readonly nav: NavGrid;
  private readonly claims = new Map<Spot, string>();

  constructor(readonly map: WorkshopMap) {
    this.nav = new NavGrid(map);
  }

  claim(kind: SpotKind, owner: string, random: () => number = Math.random): Spot | null {
    this.release(owner);
    const free = this.map.spots.filter((spot) => spot.kind === kind && !this.claims.has(spot));
    const spot = free[Math.floor(random() * free.length)];
    if (spot === undefined) return null;
    this.claims.set(spot, owner);
    return spot;
  }

  hasFree(kind: SpotKind): boolean {
    return this.map.spots.some((spot) => spot.kind === kind && !this.claims.has(spot));
  }

  release(owner: string): void {
    for (const [spot, claimant] of this.claims) {
      if (claimant === owner) this.claims.delete(spot);
    }
  }

  holder(spot: Spot): string | null {
    return this.claims.get(spot) ?? null;
  }
}
