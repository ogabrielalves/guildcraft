import { describe, expect, it } from 'vitest';
import { Layout } from './layout.js';
import { parseWorkshopMap } from './map.js';
import { provisionalWorkshop } from './provisional-workshop.js';

const map = parseWorkshopMap(provisionalWorkshop());

describe('Layout', () => {
  it('builds the nav grid from the obstacles', () => {
    const layout = new Layout(map);
    expect(layout.nav.walkable({ x: 10, y: 10 })).toBe(false);
    expect(layout.nav.walkable({ x: 10, y: 200 })).toBe(true);
  });

  it('hands out free spots of a kind and remembers who holds them', () => {
    const layout = new Layout(map);
    const first = layout.claim('nap', 'a', () => 0);
    const second = layout.claim('nap', 'b', () => 0);
    expect(first?.at).toEqual({ x: 440, y: 280 });
    expect(second?.at).toEqual({ x: 440, y: 320 });
    expect(layout.claim('nap', 'c')).toBeNull();
    if (first) expect(layout.holder(first)).toBe('a');
  });

  it('tells whether a spot of a kind is still free', () => {
    const layout = new Layout(map);
    expect(layout.hasFree('nap')).toBe(true);
    layout.claim('nap', 'a');
    layout.claim('nap', 'b');
    expect(layout.hasFree('nap')).toBe(false);
    expect(layout.hasFree('hearth')).toBe(true);
    layout.claim('hearth', 'c');
    expect(layout.hasFree('hearth')).toBe(false);
  });

  it('frees the previous spot of the same owner', () => {
    const layout = new Layout(map);
    const nap = layout.claim('nap', 'a', () => 0);
    layout.claim('read', 'a', () => 0);
    if (nap) expect(layout.holder(nap)).toBeNull();
    layout.release('a');
    expect(layout.claim('read', 'b', () => 0)?.at).toEqual({ x: 440, y: 120 });
  });
});

describe('Layout zones', () => {
  const zoned = parseWorkshopMap({
    ...provisionalWorkshop(),
    wander: [
      { x: 100, y: 200 },
      { x: 400, y: 200 },
    ],
    routes: [
      [
        { x: 100, y: 330 },
        { x: 200, y: 330 },
      ],
      [
        { x: 300, y: 330 },
        { x: 460, y: 330 },
      ],
    ],
    zones: [
      { id: 'west', areas: [{ x: 0, y: 80, width: 240, height: 272 }] },
      { id: 'east', areas: [{ x: 240, y: 80, width: 240, height: 272 }] },
    ],
  });

  it('builds one masked grid per zone and the open grid for no zone', () => {
    const layout = new Layout(zoned);
    const west = layout.navFor('west');
    expect(layout.navFor('west')).toBe(west);
    expect(west.walkable({ x: 100, y: 200 })).toBe(true);
    expect(west.walkable({ x: 400, y: 200 })).toBe(false);
    expect(layout.navFor(null)).toBe(layout.nav);
    expect(layout.navFor('nowhere')).toBe(layout.nav);
    expect(layout.nav.walkable({ x: 400, y: 200 })).toBe(true);
  });

  it('splits wander points and routes by zone', () => {
    const layout = new Layout(zoned);
    expect(layout.paths('west')).toEqual({ wander: [zoned.wander[0]], routes: [zoned.routes[0]] });
    expect(layout.paths('east').wander).toEqual([zoned.wander[1]]);
    expect(layout.paths(null)).toEqual({ wander: zoned.wander, routes: zoned.routes });
  });

  it('hands out spots only inside the asked zone', () => {
    const layout = new Layout(zoned);
    expect(layout.hasFree('nap', 'west')).toBe(false);
    expect(layout.claim('nap', 'a', () => 0, 'west')).toBeNull();
    expect(layout.hasFree('table', 'west')).toBe(true);
    expect(layout.claim('read', 'a', () => 0, 'east')?.at).toEqual({ x: 440, y: 120 });
    expect(layout.zoneOf({ x: 440, y: 120 })).toBe('east');
    expect(layout.zoneOf({ x: 10, y: 10 })).toBeNull();
  });
});

describe('Layout common zones', () => {
  const west = { id: 'west', areas: [{ x: 0, y: 80, width: 240, height: 272 }] };
  const shared = parseWorkshopMap({
    ...provisionalWorkshop(),
    zones: [
      west,
      { id: 'east', areas: [{ x: 240, y: 80, width: 240, height: 272 }], common: true },
    ],
  });

  it('lends the spots of a common zone to the other zones', () => {
    const layout = new Layout(shared);
    expect(layout.isCommon('east')).toBe(true);
    expect(layout.isCommon('west')).toBe(false);
    expect(layout.hasFree('nap', 'west')).toBe(true);
    expect(layout.claim('nap', 'a', () => 0, 'west')?.at).toEqual({ x: 440, y: 280 });
  });

  it('prefers a spot of its own zone', () => {
    const layout = new Layout(shared);
    for (const id of ['a', 'b', 'c']) {
      const spot = layout.claim('table', id, () => 0.99, 'west');
      expect(spot && layout.zoneOf(spot.at)).toBe('west');
      layout.release(id);
    }
  });
});

describe('Layout bench and common zone', () => {
  const porch = parseWorkshopMap({
    ...provisionalWorkshop(),
    spots: [...provisionalWorkshop().spots, { kind: 'bench', at: { x: 10, y: 340 } }],
    zones: [
      { id: 'west', areas: [{ x: 0, y: 80, width: 240, height: 272 }] },
      { id: 'east', areas: [{ x: 240, y: 80, width: 240, height: 272 }], common: true },
    ],
  });

  it('names the common zone, or none', () => {
    expect(new Layout(porch).commonZone()).toBe('east');
    expect(new Layout(map).commonZone()).toBeNull();
  });

  it('offers bench spots to every zone', () => {
    const layout = new Layout(porch);
    expect(layout.hasFree('bench', 'west')).toBe(true);
    expect(layout.claim('bench', 'a', () => 0, 'east')?.at).toEqual({ x: 10, y: 340 });
    expect(layout.hasFree('bench', 'west')).toBe(false);
  });
});
