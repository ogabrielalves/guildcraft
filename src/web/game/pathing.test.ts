import { describe, expect, it } from 'vitest';
import { bayAt, parseWorkshopMap } from './map.js';
import { pointAlong, route, routeLength } from './pathing.js';
import { provisionalWorkshop } from './provisional-workshop.js';

const map = parseWorkshopMap(provisionalWorkshop());

describe('route', () => {
  it('walks straight inside the same bay', () => {
    const bay = bayAt(map, 0);
    expect(route(map, { bay: 0, point: bay.work }, { bay: 0, point: bay.nap })).toEqual([
      bay.work,
      bay.nap,
    ]);
  });

  it('collapses a route to where it already is', () => {
    const bay = bayAt(map, 0);
    expect(route(map, { bay: 0, point: bay.work }, { bay: 0, point: bay.work })).toEqual([
      bay.work,
    ]);
  });

  it('goes through both doors and the corridor between bays', () => {
    const from = bayAt(map, 0);
    const to = bayAt(map, 7);
    expect(route(map, { bay: 0, point: from.work }, { bay: 7, point: to.guest })).toEqual([
      from.work,
      from.door,
      { x: 48, y: 160 },
      { x: 432, y: 160 },
      to.door,
      to.guest,
    ]);
  });

  it('skips the corridor turn when doors face each other', () => {
    const from = bayAt(map, 1);
    const to = bayAt(map, 5);
    expect(route(map, { bay: 1, point: from.door }, { bay: 5, point: to.guest })).toEqual([
      from.door,
      { x: 144, y: 160 },
      to.door,
      to.guest,
    ]);
  });

  it('rejects an unknown bay', () => {
    const point = { x: 0, y: 0 };
    expect(() => route(map, { bay: 8, point }, { bay: 0, point })).toThrow(RangeError);
    expect(() => route(map, { bay: 0, point }, { bay: -1, point })).toThrow(RangeError);
  });
});

describe('routeLength', () => {
  it('sums every segment', () => {
    expect(
      routeLength([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
        { x: 3, y: 10 },
      ]),
    ).toBe(11);
  });

  it('is zero for a single point or none', () => {
    expect(routeLength([{ x: 5, y: 5 }])).toBe(0);
    expect(routeLength([])).toBe(0);
  });
});

describe('pointAlong', () => {
  const path = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];

  it.each([
    [-5, { x: 0, y: 0 }],
    [0, { x: 0, y: 0 }],
    [4, { x: 4, y: 0 }],
    [10, { x: 10, y: 0 }],
    [15, { x: 10, y: 5 }],
    [20, { x: 10, y: 10 }],
    [99, { x: 10, y: 10 }],
  ])('at %d returns %j', (distance, expected) => {
    expect(pointAlong(path, distance)).toEqual(expected);
  });

  it('handles repeated points', () => {
    expect(
      pointAlong(
        [
          { x: 1, y: 1 },
          { x: 1, y: 1 },
        ],
        0,
      ),
    ).toEqual({ x: 1, y: 1 });
  });

  it('returns a copy of a lone point', () => {
    const lone = { x: 2, y: 3 };
    const result = pointAlong([lone], 5);
    expect(result).toEqual(lone);
    expect(result).not.toBe(lone);
  });

  it('rejects an empty route', () => {
    expect(() => pointAlong([], 0)).toThrow(RangeError);
  });
});
