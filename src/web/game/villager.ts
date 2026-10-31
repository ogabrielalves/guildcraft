import type { Activity, IdlePlan } from './activity.js';
import { idleSpot, idleTime, isWorkingActivity, LOUNGE_AFTER, pickIdle } from './activity.js';
import type { Layout } from './layout.js';
import type { Point, SpotKind } from './map.js';
import { stationAt } from './map.js';
import type { NavGrid } from './pathing.js';
import { BODY_REACH, pointAlong, routeLength } from './pathing.js';
import type { Direction, Pose } from './sprite-sheet.js';
import { directionTo } from './sprite-sheet.js';

export const WALK_SPEED = 56;
export const VISIT_LINGER = 3;
export const VISIT_GAP = 18;
export const CHEER_TIME = 1.5;
export const BODY_GAP = BODY_REACH;
export const REROUTE_AFTER = 0.4;
export const GIVE_UP_AFTER = 2.5;

interface Target {
  point: Point;
  facing: Direction | null;
  via?: readonly Point[];
  free?: boolean;
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

function guestSpot(nav: NavGrid, from: Point, host: Point): Point {
  const side = from.x <= host.x ? -1 : 1;
  return nav.nearest({ x: host.x + side * VISIT_GAP, y: host.y });
}

export class Villager {
  readonly zone: string | null;
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
  private idleFor = 0;
  private lounging = false;
  private stalledFor = 0;
  private rerouted = false;

  constructor(
    readonly id: string,
    readonly station: number,
    private readonly layout: Layout,
    private activityNow: Activity,
    private readonly random: () => number = Math.random,
    private readonly peers: () => readonly Villager[] = () => [],
    spawn: Point | null = null,
  ) {
    this.zone = layout.zoneOf(stationAt(layout.map, station).work);
    const start = this.homeTarget();
    this.position = { ...(spawn ?? start.point) };
    this.destination = start;
    if (spawn !== null) this.walkTo(start);
    else if (start.facing !== null) this.face(start.facing);
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

  get stalled(): boolean {
    return this.stalledFor > 0 && this.stalledFor < GIVE_UP_AFTER;
  }

  get pose(): Pose {
    if (this.stalled) return 'idle';
    if (this.moving) return 'walk';
    if (this.cheer > 0) return 'cheer';
    if (this.visit !== null) return 'idle';
    if (isWorkingActivity(this.activityNow)) return 'work';
    if (this.activityNow === 'sleep' || this.activityNow === 'off') return 'sit';
    if (this.doing === 'nap' || this.doing === 'bench' || this.doing === 'table') return 'sit';
    return 'idle';
  }

  setActivity(activity: Activity): void {
    if (activity === this.activityNow) return;
    this.leaveChat();
    this.activityNow = activity;
    this.cheer = 0;
    this.plan = null;
    this.planTimer = 0;
    this.idleFor = 0;
    this.lounging = false;
    if (this.visit === null) this.walkTo(this.homeTarget());
  }

  startVisit(host: Point, note: string | null = null): void {
    this.leaveChat();
    const guest = guestSpot(this.layout.nav, this.position, host);
    this.layout.release(this.id);
    this.cheer = 0;
    this.visit = {
      phase: 'going',
      facing: directionTo(host.x - guest.x, host.y - guest.y, this.facing),
      timer: 0,
      note,
    };
    this.walkTo({ point: guest, facing: null, free: true });
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
    this.tire(dt);
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

  private tire(dt: number): void {
    if (this.activityNow !== 'idle') return;
    this.idleFor += dt;
    if (this.lounging || this.idleFor < LOUNGE_AFTER || this.layout.commonZone() === null) return;
    this.lounging = true;
    this.leaveChat();
    this.planTimer = 0;
  }

  private get roam(): string | null {
    return this.lounging ? (this.layout.commonZone() ?? this.zone) : this.zone;
  }

  private nextPlan(): void {
    const { roam } = this;
    const partners = this.peers().filter(
      (peer) =>
        peer !== this &&
        peer.canChat &&
        (this.lounging || peer.zone === this.zone) &&
        this.layout.zoneOf(peer.position) === roam &&
        this.layout.zoneOf(this.position) === roam,
    );
    const plan = pickIdle(
      (option) => {
        if (option === 'chat') return partners.length > 0;
        const kind = idleSpot(option);
        if (option === 'bench' && !this.lounging) return false;
        return kind !== null && this.layout.hasFree(kind, roam, !this.lounging);
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
      this.walkTo({ point: guestSpot(this.nav, this.position, partner.position), facing: null });
      return;
    }
    const kind = idleSpot(plan);
    const spot =
      kind === null ? null : this.layout.claim(kind, this.id, this.random, roam, !this.lounging);
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
      const spot = this.layout.claim(anchor, this.id, this.random, this.zone);
      if (spot !== null) return { point: spot.at, facing: spot.facing };
    } else {
      this.layout.release(this.id);
    }
    const { at, work } = stationAt(this.layout.map, this.station);
    return { point: work, facing: directionTo(at.x - work.x, at.y - work.y, 'south') };
  }

  private get nav(): NavGrid {
    return this.layout.navFor(this.roam);
  }

  private wanderTarget(): Target {
    const { nav } = this;
    const { wander, routes } = this.layout.paths(this.roam);
    const choice = Math.floor(this.random() * (wander.length + routes.length));
    const route = routes[choice - wander.length]?.map((point) => nav.nearest(point));
    const point = wander[choice] ?? route?.at(-1);
    if (point === undefined) return { point: nav.randomPoint(this.random), facing: null };
    return { point: nav.nearest(point), facing: null, via: route?.slice(0, -1) ?? [] };
  }

  private bodies(): Point[] {
    return this.peers()
      .filter((peer) => peer !== this)
      .map((peer) => peer.position);
  }

  private blocker(next: Point): Villager | undefined {
    const { point } = this.destination;
    return this.peers().find((peer) => {
      if (peer === this) return false;
      const gap = Math.hypot(peer.position.x - next.x, peer.position.y - next.y);
      if (gap >= BODY_GAP) return false;
      const now = Math.hypot(peer.position.x - this.position.x, peer.position.y - this.position.y);
      if (gap >= now) return false;
      return Math.hypot(peer.position.x - point.x, peer.position.y - point.y) >= BODY_GAP;
    });
  }

  private yield(dt: number): void {
    this.stalledFor += dt;
    if (this.rerouted || this.stalledFor < REROUTE_AFTER) return;
    this.rerouted = true;
    const stalledFor = this.stalledFor;
    this.walkTo({ ...this.destination, via: [] }, this.bodies());
    this.stalledFor = stalledFor;
  }

  private walkTo(target: Target, avoid: readonly Point[] = []): void {
    const away =
      target.free === true ||
      this.layout.zoneOf(this.position) !== this.roam ||
      this.layout.zoneOf(target.point) !== this.roam;
    const nav = away ? this.layout.nav : this.nav;
    let from = this.position;
    this.path = [from];
    for (const stop of [...(target.via ?? []), target.point]) {
      this.path.push(...nav.route(from, stop, avoid).slice(1));
      from = stop;
    }
    this.travelled = 0;
    this.length = routeLength(this.path);
    this.destination = target;
    if (avoid.length === 0) {
      this.stalledFor = 0;
      this.rerouted = false;
    }
    if (!this.moving) this.arrive();
  }

  private advance(dt: number): void {
    const before = this.position;
    const travelled = Math.min(this.length, this.travelled + WALK_SPEED * dt);
    const next = pointAlong(this.path, travelled);
    if (this.blocker(next) !== undefined && this.stalledFor < GIVE_UP_AFTER) {
      this.yield(dt);
      return;
    }
    if (this.stalledFor < GIVE_UP_AFTER) this.stalledFor = 0;
    this.travelled = travelled;
    this.position = next;
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
