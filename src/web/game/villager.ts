import type { Activity } from './activity.js';
import { isWorkingActivity } from './activity.js';
import type { BayPoint, Point, WorkshopMap } from './map.js';
import { bayAt, wanderPoint } from './map.js';
import { pointAlong, route, routeLength } from './pathing.js';
import type { Direction, Pose } from './sprite-sheet.js';
import { directionTo } from './sprite-sheet.js';

export const WALK_SPEED = 40;
export const VISIT_LINGER = 3;
export const CHEER_TIME = 1.5;
export const WANDER_PAUSE = { min: 1.5, max: 4 };

interface Target {
  bay: number;
  point: Point;
}

type Visit = { phase: 'going' | 'lingering'; bay: number; timer: number } | null;

function anchorOf(activity: Activity): BayPoint | null {
  if (isWorkingActivity(activity) || activity === 'think') return 'work';
  if (activity === 'read' || activity === 'wait') return 'read';
  if (activity === 'sleep' || activity === 'off') return 'nap';
  return null;
}

export class Villager {
  position: Point;
  facing: Direction = 'south';
  private path: Point[] = [];
  private travelled = 0;
  private length = 0;
  private destination: Target;
  private pending: Target | null = null;
  private pause = 0;
  private visit: Visit = null;
  private cheer = 0;

  constructor(
    readonly id: string,
    readonly bay: number,
    private readonly map: WorkshopMap,
    private activityNow: Activity,
    private readonly random: () => number = Math.random,
  ) {
    const start = this.homeTarget();
    this.position = { ...start.point };
    this.destination = start;
    this.faceAnchor();
  }

  get activity(): Activity {
    return this.activityNow;
  }

  get moving(): boolean {
    return this.path.length > 1;
  }

  get visiting(): boolean {
    return this.visit !== null;
  }

  get pose(): Pose {
    if (this.moving) return 'walk';
    if (this.cheer > 0) return 'cheer';
    if (this.visit !== null) return 'idle';
    if (isWorkingActivity(this.activityNow)) return 'work';
    if (this.activityNow === 'sleep' || this.activityNow === 'off') return 'sit';
    return 'idle';
  }

  setActivity(activity: Activity): void {
    if (activity === this.activityNow) return;
    this.activityNow = activity;
    this.cheer = 0;
    if (this.visit === null) this.walkTo(this.homeTarget());
  }

  startVisit(bay: number): void {
    if (bay === this.bay || this.map.bays[bay] === undefined) return;
    this.cheer = 0;
    this.visit = { phase: 'going', bay, timer: 0 };
    this.walkTo({ bay, point: bayAt(this.map, bay).guest });
  }

  celebrate(): void {
    if (this.visit === null) this.cheer = CHEER_TIME;
  }

  update(dt: number): void {
    if (this.cheer > 0) this.cheer = Math.max(0, this.cheer - dt);
    if (this.moving) {
      this.advance(dt);
      return;
    }
    if (this.visit?.phase === 'lingering') {
      this.visit.timer -= dt;
      if (this.visit.timer <= 0) {
        this.visit = null;
        this.walkTo(this.homeTarget());
      }
      return;
    }
    if (this.visit === null && anchorOf(this.activityNow) === null) {
      this.pause -= dt;
      if (this.pause <= 0) this.walkTo(this.wanderTarget());
    }
  }

  private homeTarget(): Target {
    const anchor = anchorOf(this.activityNow);
    const bay = bayAt(this.map, this.bay);
    return { bay: this.bay, point: anchor === null ? wanderPoint(bay, this.random) : bay[anchor] };
  }

  private wanderTarget(): Target {
    return { bay: this.bay, point: wanderPoint(bayAt(this.map, this.bay), this.random) };
  }

  private walkTo(target: Target): void {
    if (this.crossing()) {
      this.pending = target;
      return;
    }
    this.pending = null;
    this.path = route(this.map, { bay: this.destination.bay, point: this.position }, target);
    this.travelled = 0;
    this.length = routeLength(this.path);
    this.destination = target;
    if (!this.moving) this.arrive();
  }

  private crossing(): boolean {
    return this.path.length > 2;
  }

  private advance(dt: number): void {
    const before = this.position;
    this.travelled = Math.min(this.length, this.travelled + WALK_SPEED * dt);
    this.position = pointAlong(this.path, this.travelled);
    this.facing = directionTo(this.position.x - before.x, this.position.y - before.y, this.facing);
    if (this.travelled >= this.length) {
      this.path = [];
      this.arrive();
    }
  }

  private arrive(): void {
    const pending = this.pending;
    if (pending !== null) {
      this.pending = null;
      this.walkTo(pending);
      return;
    }
    if (this.visit?.phase === 'going') {
      this.visit = { ...this.visit, phase: 'lingering', timer: VISIT_LINGER };
      this.facing = 'north';
      return;
    }
    this.faceAnchor();
    const { min, max } = WANDER_PAUSE;
    this.pause = min + this.random() * (max - min);
  }

  private faceAnchor(): void {
    const anchor = anchorOf(this.activityNow);
    if (anchor === 'work') {
      const { station, work } = bayAt(this.map, this.bay);
      this.facing = directionTo(station.x - work.x, station.y - work.y, this.facing);
    } else if (anchor !== null) {
      this.facing = 'south';
    }
  }
}
