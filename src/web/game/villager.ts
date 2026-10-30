import type { Activity, IdlePlan } from './activity.js';
import { idleSpot, idleTime, isWorkingActivity, pickIdle } from './activity.js';
import type { Layout } from './layout.js';
import type { Point, SpotKind } from './map.js';
import { stationAt } from './map.js';
import { pointAlong, routeLength } from './pathing.js';
import type { Direction, Pose } from './sprite-sheet.js';
import { directionTo } from './sprite-sheet.js';

export const WALK_SPEED = 40;
export const VISIT_LINGER = 3;
export const VISIT_GAP = 18;
export const CHEER_TIME = 1.5;

interface Target {
  point: Point;
  facing: Direction | null;
}

type Visit = {
  phase: 'going' | 'lingering';
  facing: Direction;
  timer: number;
  note: string | null;
} | null;

type Chat = { partner: Villager; phase: 'going' | 'talking' } | null;

function anchorOf(activity: Activity): 'work' | SpotKind | null {
  if (isWorkingActivity(activity) || activity === 'think') return 'work';
  if (activity === 'read' || activity === 'wait') return 'read';
  if (activity === 'sleep' || activity === 'off') return 'nap';
  return null;
}

function guestSpot(layout: Layout, from: Point, host: Point): Point {
  const side = from.x <= host.x ? -1 : 1;
  return layout.nav.nearest({ x: host.x + side * VISIT_GAP, y: host.y });
}

export class Villager {
  position: Point;
  facing: Direction = 'south';
  private sideNow: 'east' | 'west' = 'east';
  private path: Point[] = [];
  private travelled = 0;
  private length = 0;
  private destination: Target;
  private visit: Visit = null;
  private cheer = 0;
  private plan: IdlePlan | null = null;
  private planTimer = 0;
  private chat: Chat = null;

  constructor(
    readonly id: string,
    readonly station: number,
    private readonly layout: Layout,
    private activityNow: Activity,
    private readonly random: () => number = Math.random,
    private readonly peers: () => readonly Villager[] = () => [],
  ) {
    const start = this.homeTarget();
    this.position = { ...start.point };
    this.destination = start;
    if (start.facing !== null) this.face(start.facing);
  }

  get side(): 'east' | 'west' {
    return this.sideNow;
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

  get note(): string | null {
    return this.visit?.note ?? null;
  }

  get atStation(): boolean {
    return isWorkingActivity(this.activityNow) && !this.moving && this.visit === null;
  }

  get doing(): IdlePlan | null {
    if (this.moving || this.visit !== null || this.activityNow !== 'idle') return null;
    if (this.chat !== null) return this.chat.phase === 'talking' ? 'chat' : null;
    return this.plan === 'chat' ? null : this.plan;
  }

  get canChat(): boolean {
    return this.activityNow === 'idle' && this.visit === null && this.chat === null;
  }

  get pose(): Pose {
    if (this.moving) return 'walk';
    if (this.cheer > 0) return 'cheer';
    if (this.visit !== null) return 'idle';
    if (isWorkingActivity(this.activityNow)) return 'work';
    if (this.activityNow === 'sleep' || this.activityNow === 'off') return 'sit';
    if (this.doing === 'nap') return 'sit';
    return 'idle';
  }

  setActivity(activity: Activity): void {
    if (activity === this.activityNow) return;
    this.leaveChat();
    this.activityNow = activity;
    this.cheer = 0;
    this.plan = null;
    this.planTimer = 0;
    if (this.visit === null) this.walkTo(this.homeTarget());
  }

  startVisit(host: Point, note: string | null = null): void {
    this.leaveChat();
    const guest = guestSpot(this.layout, this.position, host);
    this.layout.release(this.id);
    this.cheer = 0;
    this.visit = {
      phase: 'going',
      facing: directionTo(host.x - guest.x, host.y - guest.y, this.facing),
      timer: 0,
      note,
    };
    this.walkTo({ point: guest, facing: null });
  }

  hostChat(guest: Villager): void {
    this.layout.release(this.id);
    this.path = [];
    this.plan = 'chat';
    this.chat = { partner: guest, phase: 'going' };
    this.face(directionTo(guest.position.x - this.position.x, 0, this.facing));
  }

  celebrate(): void {
    if (this.visit === null) this.cheer = CHEER_TIME;
  }

  leave(): void {
    this.leaveChat();
    this.layout.release(this.id);
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
    if (this.visit !== null || this.activityNow !== 'idle') return;
    if (this.chat?.phase === 'going') return;
    this.planTimer -= dt;
    if (this.planTimer > 0) return;
    if (this.chat !== null) this.leaveChat();
    this.nextPlan();
  }

  private nextPlan(): void {
    const partners = this.peers().filter((peer) => peer !== this && peer.canChat);
    const plan = pickIdle(
      (option) => {
        if (option === 'chat') return partners.length > 0;
        const kind = idleSpot(option);
        return kind !== null && this.layout.hasFree(kind);
      },
      this.random,
      this.plan,
    );
    this.plan = plan;
    this.planTimer = idleTime(plan, this.random);
    const partner = partners[Math.floor(this.random() * partners.length)];
    if (plan === 'chat' && partner !== undefined) {
      this.layout.release(this.id);
      partner.hostChat(this);
      this.chat = { partner, phase: 'going' };
      this.walkTo({ point: guestSpot(this.layout, this.position, partner.position), facing: null });
      return;
    }
    const kind = idleSpot(plan);
    const spot = kind === null ? null : this.layout.claim(kind, this.id, this.random);
    if (spot !== null) {
      this.walkTo({ point: spot.at, facing: spot.facing });
      return;
    }
    this.plan = 'wander';
    this.walkTo(this.wanderTarget());
  }

  private leaveChat(): void {
    const chat = this.chat;
    if (chat === null) return;
    this.chat = null;
    this.planTimer = 0;
    if (chat.partner.chat?.partner === this) chat.partner.leaveChat();
  }

  private homeTarget(): Target {
    const anchor = anchorOf(this.activityNow);
    if (anchor === null) {
      this.layout.release(this.id);
      return this.wanderTarget();
    }
    if (anchor !== 'work') {
      const spot = this.layout.claim(anchor, this.id, this.random);
      if (spot !== null) return { point: spot.at, facing: spot.facing };
    } else {
      this.layout.release(this.id);
    }
    const { at, work } = stationAt(this.layout.map, this.station);
    return { point: work, facing: directionTo(at.x - work.x, at.y - work.y, 'south') };
  }

  private wanderTarget(): Target {
    return { point: this.layout.nav.randomPoint(this.random), facing: null };
  }

  private walkTo(target: Target): void {
    this.path = this.layout.nav.route(this.position, target.point);
    this.travelled = 0;
    this.length = routeLength(this.path);
    this.destination = target;
    if (!this.moving) this.arrive();
  }

  private advance(dt: number): void {
    const before = this.position;
    this.travelled = Math.min(this.length, this.travelled + WALK_SPEED * dt);
    this.position = pointAlong(this.path, this.travelled);
    this.face(directionTo(this.position.x - before.x, this.position.y - before.y, this.facing));
    if (this.travelled >= this.length) {
      this.position = { ...this.destination.point };
      this.path = [];
      this.arrive();
    }
  }

  private arrive(): void {
    if (this.visit?.phase === 'going') {
      this.visit = { ...this.visit, phase: 'lingering', timer: VISIT_LINGER };
      this.face(this.visit.facing);
      return;
    }
    if (this.chat?.phase === 'going') {
      this.startTalking(this.chat.partner);
      return;
    }
    if (this.destination.facing !== null) this.face(this.destination.facing);
  }

  private startTalking(partner: Villager): void {
    this.chat = { partner, phase: 'talking' };
    partner.chat = { partner: this, phase: 'talking' };
    partner.planTimer = this.planTimer;
    const { x } = partner.position;
    this.face(directionTo(x - this.position.x, 0, this.facing));
    partner.face(directionTo(this.position.x - x, 0, partner.facing));
  }

  private face(direction: Direction): void {
    this.facing = direction;
    if (direction === 'east' || direction === 'west') this.sideNow = direction;
  }
}
