import { describe, expect, it } from 'vitest';
import { bayAt, contains, parseWorkshopMap } from './map.js';
import { provisionalWorkshop } from './provisional-workshop.js';
import { CHEER_TIME, VISIT_LINGER, Villager, WALK_SPEED } from './villager.js';

const map = parseWorkshopMap(provisionalWorkshop());

function run(villager: Villager, seconds: number, step = 0.05): void {
  for (let t = 0; t < seconds; t += step) villager.update(step);
}

function settle(villager: Villager): void {
  for (let i = 0; i < 2000 && villager.moving; i += 1) villager.update(0.05);
}

describe('Villager', () => {
  it('starts at the work spot facing the station', () => {
    const villager = new Villager('a', 0, map, 'write');
    expect(villager.position).toEqual(bayAt(map, 0).work);
    expect(villager.facing).toBe('west');
    expect(villager.pose).toBe('work');
    expect(villager.moving).toBe(false);
  });

  it.each([
    ['think', 'work', 'idle'],
    ['read', 'read', 'idle'],
    ['wait', 'read', 'idle'],
    ['sleep', 'nap', 'sit'],
    ['off', 'nap', 'sit'],
  ] as const)('places %s at %s with pose %s', (activity, anchor, pose) => {
    const villager = new Villager('a', 2, map, activity);
    expect(villager.position).toEqual(bayAt(map, 2)[anchor]);
    expect(villager.pose).toBe(pose);
  });

  it('walks to the new anchor when the activity changes', () => {
    const villager = new Villager('a', 1, map, 'read');
    villager.setActivity('term');
    expect(villager.moving).toBe(true);
    expect(villager.pose).toBe('walk');
    villager.update(0.1);
    expect(villager.position).not.toEqual(bayAt(map, 1).read);
    settle(villager);
    expect(villager.position).toEqual(bayAt(map, 1).work);
    expect(villager.pose).toBe('work');
    expect(villager.facing).toBe('west');
  });

  it('ignores a repeated activity', () => {
    const villager = new Villager('a', 1, map, 'read');
    villager.setActivity('read');
    expect(villager.moving).toBe(false);
  });

  it('wanders inside its bay while idle', () => {
    let seed = 0;
    const villager = new Villager('a', 3, map, 'idle', () => (seed = (seed + 0.37) % 1));
    const area = bayAt(map, 3).area;
    expect(contains(area, villager.position)).toBe(true);
    let walked = false;
    for (let i = 0; i < 400; i += 1) {
      villager.update(0.05);
      walked ||= villager.moving;
      expect(contains(area, villager.position)).toBe(true);
    }
    expect(walked).toBe(true);
  });

  it('pauses between wander walks', () => {
    let next = 0;
    const values = [0.1, 0.1, 0.9, 0.9, 0];
    const villager = new Villager('a', 0, map, 'idle', () => values[next++ % values.length] ?? 0);
    villager.update(0.01);
    expect(villager.moving).toBe(true);
    settle(villager);
    villager.update(0.5);
    expect(villager.moving).toBe(false);
  });

  it('visits another bay, lingers and walks home', () => {
    const villager = new Villager('a', 0, map, 'write');
    villager.startVisit(7);
    expect(villager.visiting).toBe(true);
    settle(villager);
    expect(villager.position).toEqual(bayAt(map, 7).guest);
    expect(villager.pose).toBe('idle');
    expect(villager.facing).toBe('north');
    villager.update(VISIT_LINGER / 2);
    expect(villager.moving).toBe(false);
    villager.update(VISIT_LINGER);
    expect(villager.visiting).toBe(false);
    expect(villager.moving).toBe(true);
    settle(villager);
    expect(villager.position).toEqual(bayAt(map, 0).work);
  });

  it('takes the corridor on the way to another bay', () => {
    const villager = new Villager('a', 0, map, 'write');
    villager.startVisit(6);
    let reachedCorridor = false;
    while (villager.moving) {
      villager.update(0.05);
      reachedCorridor ||= villager.position.y === map.corridorY;
    }
    expect(reachedCorridor).toBe(true);
  });

  it('keeps a new activity for after the visit', () => {
    const villager = new Villager('a', 0, map, 'write');
    villager.startVisit(5);
    villager.setActivity('sleep');
    settle(villager);
    expect(villager.position).toEqual(bayAt(map, 5).guest);
    run(villager, VISIT_LINGER + 0.1);
    settle(villager);
    expect(villager.position).toEqual(bayAt(map, 0).nap);
    expect(villager.pose).toBe('sit');
  });

  it('finishes crossing the corridor before changing course', () => {
    const villager = new Villager('a', 0, map, 'write');
    villager.startVisit(7);
    villager.update(1);
    villager.startVisit(6);
    settle(villager);
    expect(villager.position).toEqual(bayAt(map, 6).guest);
  });

  it('changes course at once inside its own bay', () => {
    const villager = new Villager('a', 0, map, 'read');
    villager.setActivity('write');
    villager.update(0.1);
    villager.setActivity('sleep');
    settle(villager);
    expect(villager.position).toEqual(bayAt(map, 0).nap);
  });

  it('ignores visits to itself or to unknown bays', () => {
    const villager = new Villager('a', 0, map, 'write');
    villager.startVisit(0);
    villager.startVisit(9);
    expect(villager.visiting).toBe(false);
  });

  it('cheers for a moment when it finishes', () => {
    const villager = new Villager('a', 0, map, 'write');
    villager.celebrate();
    expect(villager.pose).toBe('cheer');
    villager.update(CHEER_TIME + 0.1);
    expect(villager.pose).toBe('work');
  });

  it('does not cheer while visiting', () => {
    const villager = new Villager('a', 0, map, 'write');
    villager.startVisit(3);
    villager.celebrate();
    settle(villager);
    expect(villager.pose).toBe('idle');
  });

  it('walks at a steady speed', () => {
    const villager = new Villager('a', 0, map, 'read');
    const start = { ...villager.position };
    villager.setActivity('write');
    villager.update(0.1);
    const moved = Math.hypot(villager.position.x - start.x, villager.position.y - start.y);
    expect(moved).toBeCloseTo(WALK_SPEED * 0.1);
  });
});
