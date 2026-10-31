import { describe, expect, it } from 'vitest';
import { Layout } from './layout.js';
import { parseWorkshopMap, stationAt } from './map.js';
import { provisionalWorkshop } from './provisional-workshop.js';
import { LOUNGE_AFTER } from './activity.js';
import { BODY_GAP, CHEER_TIME, VISIT_GAP, VISIT_LINGER, Villager, WALK_SPEED } from './villager.js';

const map = parseWorkshopMap(provisionalWorkshop());
const first = () => 0;

function layout(): Layout {
  return new Layout(map);
}

function run(villager: Villager, seconds: number, step = 0.05): void {
  for (let t = 0; t < seconds; t += step) villager.update(step);
}

function settle(villager: Villager): void {
  for (let i = 0; i < 4000 && villager.moving; i += 1) villager.update(0.05);
}

describe('Villager', () => {
  it('starts at the work spot facing the station', () => {
    const villager = new Villager('a', 0, layout(), 'write');
    expect(villager.position).toEqual(stationAt(map, 0).work);
    expect(villager.facing).toBe('west');
    expect(villager.pose).toBe('work');
    expect(villager.moving).toBe(false);
  });

  it.each([
    ['think', { x: 156, y: 128 }, 'west', 'idle'],
    ['read', { x: 440, y: 120 }, 'north', 'idle'],
    ['wait', { x: 440, y: 120 }, 'north', 'idle'],
    ['sleep', { x: 440, y: 280 }, 'south', 'sit'],
    ['off', { x: 440, y: 280 }, 'south', 'sit'],
  ] as const)('places %s at %j facing %s with pose %s', (activity, at, facing, pose) => {
    const villager = new Villager('a', 1, layout(), activity, first);
    expect(villager.position).toEqual(at);
    expect(villager.facing).toBe(facing);
    expect(villager.pose).toBe(pose);
  });

  it('falls back to its station when every spot is taken', () => {
    const shared = layout();
    new Villager('a', 0, shared, 'sleep');
    new Villager('b', 1, shared, 'sleep');
    const third = new Villager('c', 2, shared, 'sleep');
    expect(third.position).toEqual(stationAt(map, 2).work);
  });

  it('walks to the new anchor when the activity changes and frees its spot', () => {
    const shared = layout();
    const villager = new Villager('a', 1, shared, 'read', first);
    villager.setActivity('term');
    expect(villager.moving).toBe(true);
    expect(villager.pose).toBe('walk');
    expect(shared.claim('read', 'b', first)?.at).toEqual({ x: 440, y: 120 });
    settle(villager);
    expect(villager.position).toEqual(stationAt(map, 1).work);
    expect(villager.pose).toBe('work');
    expect(villager.facing).toBe('west');
  });

  it('ignores a repeated activity', () => {
    const villager = new Villager('a', 1, layout(), 'read');
    villager.setActivity('read');
    expect(villager.moving).toBe(false);
  });

  it('wanders over walkable floor while idle', () => {
    let seed = 0;
    const shared = layout();
    const villager = new Villager('a', 3, shared, 'idle', () => (seed = (seed + 0.37) % 1));
    expect(shared.nav.walkable(villager.position)).toBe(true);
    let walked = false;
    for (let i = 0; i < 400; i += 1) {
      villager.update(0.05);
      walked ||= villager.moving;
    }
    expect(walked).toBe(true);
    settle(villager);
    expect(shared.nav.walkable(villager.position)).toBe(true);
  });

  it('wanders to the map wander points and along its routes', () => {
    const wander = [{ x: 240, y: 200 }];
    const routes = [
      [
        { x: 40, y: 330 },
        { x: 460, y: 330 },
      ],
    ];
    const guided = new Layout(parseWorkshopMap({ ...provisionalWorkshop(), wander, routes }));
    const toPoint = new Villager('a', 0, guided, 'idle', () => 0);
    expect(toPoint.position).toEqual({ x: 240, y: 200 });
    const patrol = new Villager(
      'b',
      0,
      guided,
      'idle',
      () => 0.9,
      () => [],
      { x: 440, y: 340 },
    );
    let west = patrol.position.x;
    for (let i = 0; i < 4000 && patrol.moving; i += 1) {
      patrol.update(0.05);
      west = Math.min(west, patrol.position.x);
    }
    expect(west).toBeLessThan(42);
    expect(patrol.position).toEqual({ x: 460, y: 330 });
  });

  it('walks in from the entrance when it spawns there', () => {
    const shared = layout();
    const villager = new Villager('a', 0, shared, 'write', first, () => [], { x: 240, y: 340 });
    expect(villager.position).toEqual({ x: 240, y: 340 });
    expect(villager.moving).toBe(true);
    settle(villager);
    expect(villager.position).toEqual(stationAt(map, 0).work);
    expect(villager.facing).toBe('west');
  });

  it('pauses between wander walks', () => {
    let next = 0;
    const values = [0.1, 0.9, 0.5];
    const villager = new Villager(
      'a',
      0,
      layout(),
      'idle',
      () => values[next++ % values.length] ?? 0,
    );
    villager.update(0.01);
    expect(villager.moving).toBe(true);
    settle(villager);
    villager.update(0.5);
    expect(villager.moving).toBe(false);
  });

  it('visits a host, lingers facing it and walks home', () => {
    const villager = new Villager('a', 0, layout(), 'write');
    const host = stationAt(map, 3).work;
    expect(villager.note).toBeNull();
    villager.startVisit(host, 'hello');
    expect(villager.visiting).toBe(true);
    expect(villager.note).toBe('hello');
    settle(villager);
    expect(villager.position).toEqual({ x: host.x - VISIT_GAP, y: host.y });
    expect(villager.pose).toBe('idle');
    expect(villager.facing).toBe('east');
    villager.update(VISIT_LINGER / 2);
    expect(villager.moving).toBe(false);
    villager.update(VISIT_LINGER);
    expect(villager.visiting).toBe(false);
    expect(villager.note).toBeNull();
    expect(villager.moving).toBe(true);
    settle(villager);
    expect(villager.position).toEqual(stationAt(map, 0).work);
  });

  it('stands on the near side of a host to its left', () => {
    const villager = new Villager('a', 4, layout(), 'write');
    const host = stationAt(map, 0).work;
    villager.startVisit(host);
    settle(villager);
    expect(villager.position).toEqual({ x: host.x + VISIT_GAP, y: host.y });
    expect(villager.facing).toBe('west');
  });

  it('walks around obstacles on the way', () => {
    const shared = layout();
    const villager = new Villager('a', 0, shared, 'write');
    villager.startVisit(stationAt(map, 9).work);
    while (villager.moving) {
      villager.update(0.05);
      expect(shared.nav.walkable(villager.position)).toBe(true);
    }
  });

  it('keeps a new activity for after the visit', () => {
    const villager = new Villager('a', 0, layout(), 'write', first);
    villager.startVisit(stationAt(map, 5).work);
    villager.setActivity('sleep');
    settle(villager);
    run(villager, VISIT_LINGER + 0.1);
    settle(villager);
    expect(villager.position).toEqual({ x: 440, y: 280 });
    expect(villager.pose).toBe('sit');
  });

  it('changes course at once', () => {
    const villager = new Villager('a', 0, layout(), 'read', first);
    villager.setActivity('write');
    villager.update(0.1);
    villager.setActivity('sleep');
    settle(villager);
    expect(villager.position).toEqual({ x: 440, y: 280 });
  });

  it('is at its station only while working there', () => {
    const shared = layout();
    const villager = new Villager('a', 0, shared, 'write');
    expect(villager.atStation).toBe(true);
    villager.startVisit(stationAt(map, 2).work);
    expect(villager.atStation).toBe(false);
    const reader = new Villager('b', 1, shared, 'read');
    expect(reader.atStation).toBe(false);
    reader.setActivity('term');
    expect(reader.atStation).toBe(false);
    settle(reader);
    expect(reader.atStation).toBe(true);
  });

  it('cheers for a moment when it finishes', () => {
    const villager = new Villager('a', 0, layout(), 'write');
    villager.celebrate();
    expect(villager.pose).toBe('cheer');
    villager.update(CHEER_TIME + 0.1);
    expect(villager.pose).toBe('work');
  });

  it('does not cheer while visiting', () => {
    const villager = new Villager('a', 0, layout(), 'write');
    villager.startVisit(stationAt(map, 3).work);
    villager.celebrate();
    settle(villager);
    expect(villager.pose).toBe('idle');
  });

  it('remembers the last horizontal side it faced', () => {
    const villager = new Villager('a', 0, layout(), 'read', first);
    expect(villager.facing).toBe('north');
    expect(villager.side).toBe('east');
    villager.setActivity('write');
    settle(villager);
    expect(villager.facing).toBe('west');
    expect(villager.side).toBe('west');
  });

  it('releases its spot when it leaves', () => {
    const shared = layout();
    const villager = new Villager('a', 0, shared, 'sleep', first);
    villager.leave();
    expect(shared.claim('nap', 'b', first)?.at).toEqual({ x: 440, y: 280 });
  });

  it('walks at a steady speed', () => {
    const villager = new Villager('a', 0, layout(), 'read');
    const start = { ...villager.position };
    villager.setActivity('write');
    villager.update(0.1);
    const moved = Math.hypot(villager.position.x - start.x, villager.position.y - start.y);
    expect(moved).toBeCloseTo(WALK_SPEED * 0.1);
  });
});

describe('Villager idle life', () => {
  const fixed = (value: number) => () => value;

  function pair(guestRandom: number, hostRandom = 0.5) {
    const shared = layout();
    const crowd: Villager[] = [];
    const peers = () => crowd;
    const guest = new Villager('a', 0, shared, 'idle', fixed(guestRandom), peers);
    const host = new Villager('b', 9, shared, 'idle', fixed(hostRandom), peers);
    crowd.push(guest, host);
    const step = (seconds: number) => {
      for (let t = 0; t < seconds; t += 0.05) {
        guest.update(0.05);
        host.update(0.05);
      }
    };
    return { shared, guest, host, step };
  }

  it('picks a plan and spends its time at the matching spot', () => {
    const shared = layout();
    const villager = new Villager('a', 0, shared, 'idle', fixed(0.5));
    villager.update(0.01);
    expect(villager.doing).toBeNull();
    settle(villager);
    expect(villager.position).toEqual({ x: 240, y: 200 });
    expect(villager.facing).toBe('north');
    expect(villager.doing).toBe('hearth');
    expect(villager.pose).toBe('idle');
    run(villager, 8.9);
    expect(villager.doing).toBe('hearth');
    run(villager, 0.2);
    settle(villager);
    expect(villager.doing).toBe('bookshelf');
    expect(villager.position).toEqual({ x: 440, y: 200 });
    expect(shared.hasFree('hearth')).toBe(true);
  });

  it('naps on a bed', () => {
    const villager = new Villager('a', 0, layout(), 'idle', fixed(0.97));
    villager.update(0.01);
    settle(villager);
    expect(villager.position).toEqual({ x: 440, y: 320 });
    expect(villager.doing).toBe('nap');
    expect(villager.pose).toBe('sit');
  });

  it('wanders when every spot is taken', () => {
    const shared = layout();
    const kinds = ['read', 'read', 'nap', 'nap', 'hearth', 'table'] as const;
    kinds.forEach((kind, index) => shared.claim(kind, `x${String(index)}`));
    const villager = new Villager('a', 0, shared, 'idle', fixed(0.5));
    villager.update(0.01);
    settle(villager);
    expect(villager.doing).toBe('wander');
    expect(shared.nav.walkable(villager.position)).toBe(true);
  });

  it('walks over to chat with an idle colleague, both facing each other', () => {
    const { guest, host, step } = pair(0.8);
    guest.update(0.01);
    expect(guest.canChat).toBe(false);
    expect(host.canChat).toBe(false);
    expect(host.doing).toBeNull();
    while (guest.moving) step(0.05);
    expect(guest.doing).toBe('chat');
    expect(host.doing).toBe('chat');
    expect(Math.abs(guest.position.x - host.position.x)).toBeCloseTo(18);
    expect(guest.facing).toBe(guest.position.x < host.position.x ? 'east' : 'west');
    expect(host.facing).toBe(guest.position.x < host.position.x ? 'west' : 'east');
  });

  it('ends the chat for both when the time is up', () => {
    const { guest, host, step } = pair(0.8);
    guest.update(0.01);
    while (guest.moving) step(0.05);
    step(7.4);
    expect(guest.doing).not.toBe('chat');
    expect(host.doing).not.toBe('chat');
  });

  it('frees the host when the guest gets work', () => {
    const { guest, host, step } = pair(0.8);
    guest.update(0.01);
    guest.setActivity('write');
    expect(host.canChat).toBe(true);
    expect(host.doing).toBeNull();
    step(0.1);
    expect(host.moving || host.doing !== null).toBe(true);
  });

  it('frees the guest when the host gets work mid chat', () => {
    const { guest, host, step } = pair(0.8);
    guest.update(0.01);
    while (guest.moving) step(0.05);
    host.setActivity('think');
    expect(guest.doing).toBeNull();
    expect(guest.canChat).toBe(true);
    host.leave();
    guest.leave();
  });

  it('drops the chat for a visit or when it leaves', () => {
    const { guest, host } = pair(0.8);
    guest.update(0.01);
    guest.startVisit(stationAt(map, 4).work);
    expect(host.canChat).toBe(true);
    const other = pair(0.8);
    other.guest.update(0.01);
    other.guest.leave();
    expect(other.host.canChat).toBe(true);
  });

  it('has no idle plan while working', () => {
    const villager = new Villager('a', 0, layout(), 'write');
    run(villager, 5);
    expect(villager.doing).toBeNull();
    expect(villager.canChat).toBe(false);
  });
});

describe('Villager zones', () => {
  const zoned = parseWorkshopMap({
    ...provisionalWorkshop(),
    zones: [
      { id: 'west', areas: [{ x: 0, y: 80, width: 240, height: 272 }] },
      { id: 'east', areas: [{ x: 240, y: 80, width: 240, height: 272 }] },
    ],
  });
  const fixed = (value: number) => () => value;

  function seeded(): () => number {
    let seed = 0;
    return () => (seed = (seed + 0.37) % 1);
  }

  it('takes the zone of its station', () => {
    const shared = new Layout(zoned);
    expect(new Villager('a', 0, shared, 'idle').zone).toBe('west');
    expect(new Villager('b', 9, shared, 'idle').zone).toBe('east');
    expect(new Villager('c', 0, layout(), 'idle').zone).toBeNull();
  });

  it('wanders, idles and naps only inside its zone', () => {
    const villager = new Villager('a', 0, new Layout(zoned), 'idle', seeded());
    let east = villager.position.x;
    for (let i = 0; i < 6000; i += 1) {
      villager.update(0.05);
      east = Math.max(east, villager.position.x);
    }
    expect(east).toBeLessThanOrEqual(240);
    villager.setActivity('sleep');
    settle(villager);
    expect(villager.position).toEqual(stationAt(zoned, 0).work);
  });

  it('naps in a common zone when its own has no bed', () => {
    const common = parseWorkshopMap({
      ...provisionalWorkshop(),
      zones: [
        { id: 'west', areas: [{ x: 0, y: 80, width: 240, height: 272 }] },
        { id: 'east', areas: [{ x: 240, y: 80, width: 240, height: 272 }], common: true },
      ],
    });
    const villager = new Villager('a', 0, new Layout(common), 'idle', fixed(0));
    villager.setActivity('sleep');
    settle(villager);
    expect(villager.position).toEqual({ x: 440, y: 280 });
    villager.setActivity('write');
    settle(villager);
    expect(villager.position).toEqual(stationAt(common, 0).work);
  });

  it('chats only with idle villagers of the same zone', () => {
    const shared = new Layout(zoned);
    const crowd: Villager[] = [];
    const guest = new Villager('a', 0, shared, 'idle', fixed(0.8), () => crowd);
    const stranger = new Villager('b', 9, shared, 'idle', fixed(0.5), () => crowd);
    crowd.push(guest, stranger);
    guest.update(0.01);
    settle(guest);
    expect(guest.doing).not.toBe('chat');
    expect(stranger.canChat).toBe(true);
    const neighbour = new Villager('c', 1, shared, 'idle', fixed(0.5), () => crowd);
    crowd.push(neighbour);
    run(guest, 20);
    settle(guest);
    run(guest, 0.1);
    expect([guest.doing, neighbour.doing]).toEqual(['chat', 'chat']);
  });

  it('crosses zones to visit and walks back home', () => {
    const shared = new Layout(zoned);
    const visitor = new Villager('a', 0, shared, 'write', first);
    const host = stationAt(zoned, 9).work;
    visitor.startVisit(host);
    settle(visitor);
    expect(visitor.position.x).toBeGreaterThan(240);
    run(visitor, VISIT_LINGER + 0.1);
    settle(visitor);
    expect(visitor.position).toEqual(stationAt(zoned, 0).work);
  });

  it('walks in from an entrance outside its zone', () => {
    const shared = new Layout(zoned);
    const villager = new Villager('a', 9, shared, 'write', first, () => [], { x: 20, y: 340 });
    settle(villager);
    expect(villager.position).toEqual(stationAt(zoned, 9).work);
  });
});

describe('Villager lounging', () => {
  const lounge = parseWorkshopMap({
    ...provisionalWorkshop(),
    spots: [...provisionalWorkshop().spots, { kind: 'bench', at: { x: 300, y: 340 } }],
    zones: [
      { id: 'west', areas: [{ x: 0, y: 80, width: 240, height: 272 }] },
      { id: 'east', areas: [{ x: 240, y: 80, width: 240, height: 272 }], common: true },
    ],
  });
  const fixed = (value: number) => () => value;
  const home = (station: number) => stationAt(lounge, station).work;

  function lounger(random = fixed(0.5)) {
    return new Villager('a', 0, new Layout(lounge), 'idle', random);
  }

  it('rests on the bench when the roll picks it', () => {
    const villager = lounger(fixed(0.99));
    run(villager, LOUNGE_AFTER + 1);
    settle(villager);
    run(villager, 1);
    settle(villager);
    expect(villager.doing).toBe('bench');
    expect(villager.pose).toBe('sit');
    expect(villager.position).toEqual({ x: 300, y: 340 });
  });

  it('never takes the bench before the two minutes are up', () => {
    const villager = lounger(fixed(0.99));
    run(villager, LOUNGE_AFTER - 5);
    expect(villager.doing).not.toBe('bench');
  });

  it('goes back to its station and frees the bench when it gets work', () => {
    const shared = new Layout(lounge);
    const villager = new Villager('a', 0, shared, 'idle', fixed(0.99));
    run(villager, LOUNGE_AFTER + 1);
    settle(villager);
    run(villager, 1);
    settle(villager);
    expect(shared.hasFree('bench')).toBe(false);
    villager.setActivity('write');
    expect(villager.moving).toBe(true);
    settle(villager);
    expect(villager.position).toEqual(home(0));
    expect(villager.pose).toBe('work');
    expect(shared.hasFree('bench')).toBe(true);
  });

  it('starts counting from zero after working', () => {
    const villager = lounger(fixed(0.99));
    run(villager, LOUNGE_AFTER + 1);
    villager.setActivity('write');
    settle(villager);
    villager.setActivity('idle');
    settle(villager);
    for (let t = 0; t < LOUNGE_AFTER - 5; t += 0.05) {
      villager.update(0.05);
      expect(villager.doing).not.toBe('bench');
    }
  });

  it('sits on a chair at the table', () => {
    const chairs = parseWorkshopMap({
      ...provisionalWorkshop(),
      spots: [{ kind: 'table', at: { x: 300, y: 200 }, facing: 'south' }],
      zones: [
        { id: 'west', areas: [{ x: 0, y: 80, width: 240, height: 272 }] },
        { id: 'east', areas: [{ x: 240, y: 80, width: 240, height: 272 }], common: true },
      ],
    });
    const villager = new Villager('a', 0, new Layout(chairs), 'idle', fixed(0.99));
    for (let i = 0; i < 400 && villager.doing !== 'table'; i += 1) villager.update(0.05);
    expect(villager.doing).toBe('table');
    expect(villager.pose).toBe('sit');
    expect(villager.facing).toBe('south');
  });

  it('stays out of its work zone for as long as it is idle', () => {
    const villager = lounger(seededLounge());
    run(villager, LOUNGE_AFTER + 5);
    settle(villager);
    for (let t = 0; t < 300; t += 0.05) {
      villager.update(0.05);
      expect(villager.position.x).toBeGreaterThanOrEqual(240);
    }
  });

  it('keeps its post when there is no common zone', () => {
    const solo = parseWorkshopMap({
      ...provisionalWorkshop(),
      zones: [{ id: 'west', areas: [{ x: 0, y: 80, width: 240, height: 272 }] }],
    });
    const villager = new Villager('a', 0, new Layout(solo), 'idle', seededLounge());
    let east = villager.position.x;
    for (let t = 0; t < LOUNGE_AFTER * 3; t += 0.05) {
      villager.update(0.05);
      east = Math.max(east, villager.position.x);
    }
    expect(east).toBeLessThanOrEqual(240);
  });
});

function seededLounge(): () => number {
  let seed = 0;
  return () => (seed = (seed + 0.37) % 1);
}

describe('Villager bodies', () => {
  function pair() {
    const shared = layout();
    const all: Villager[] = [];
    const peers = () => all;
    const make = (id: string, station: number) => {
      const villager = new Villager(id, station, shared, 'write', first, peers);
      all.push(villager);
      return villager;
    };
    return { shared, make };
  }

  it('never overlaps a colleague standing in its way', () => {
    const { make } = pair();
    const walker = make('a', 0);
    const standing = make('b', 1);
    const start = { ...walker.position };
    standing.position = { x: start.x + 40, y: start.y };
    walker.startVisit({ x: start.x + 120, y: start.y });
    let closest = Infinity;
    for (let i = 0; i < 400; i += 1) {
      walker.update(0.05);
      closest = Math.min(
        closest,
        Math.hypot(
          walker.position.x - standing.position.x,
          walker.position.y - standing.position.y,
        ),
      );
    }
    expect(closest).toBeGreaterThanOrEqual(BODY_GAP - 3);
  });

  it('waits in place while blocked and shows an idle pose', () => {
    const { make } = pair();
    const walker = make('a', 0);
    const standing = make('b', 1);
    walker.position = { x: 100, y: 100 };
    standing.position = { x: 100 + BODY_GAP + 2, y: 100 };
    (walker as unknown as { path: unknown }).path = [walker.position, { x: 160, y: 100 }];
    (walker as unknown as { length: number }).length = 60;
    walker.update(0.1);
    expect(walker.position).toEqual({ x: 100, y: 100 });
    expect(walker.stalled).toBe(true);
    expect(walker.pose).toBe('idle');
  });

  it('gives up waiting so nobody deadlocks', () => {
    const { make } = pair();
    const walker = make('a', 0);
    const standing = make('b', 1);
    walker.position = { x: 100, y: 100 };
    standing.position = { x: 100 + BODY_GAP + 2, y: 100 };
    (walker as unknown as { path: unknown }).path = [walker.position, { x: 100, y: 100 }];
    (walker as unknown as { length: number }).length = 0;
    run(walker, 1);
    expect(walker.stalled).toBe(false);
  });
});
