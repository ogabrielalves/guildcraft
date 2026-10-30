import { describe, expect, it } from 'vitest';
import type { Point } from './map.js';
import { NavGrid, pointAlong, routeLength } from './pathing.js';

const wall = { x: 32, y: 0, width: 16, height: 64 };
const room = { width: 80, height: 80, obstacles: [wall] };

function blocked(grid: NavGrid, path: readonly Point[]): boolean {
  return path.slice(1).some((point, index) => {
    const previous = path[index];
    return previous !== undefined && !grid.clear(previous, point);
  });
}

describe('NavGrid', () => {
  it('blocks every cell an obstacle touches', () => {
    const grid = new NavGrid(room);
    expect([grid.columns, grid.rows]).toEqual([10, 10]);
    expect(grid.walkable({ x: 20, y: 20 })).toBe(true);
    expect(grid.walkable({ x: 40, y: 20 })).toBe(false);
    expect(grid.walkable({ x: 40, y: 70 })).toBe(true);
    expect(grid.open(-1, 0)).toBe(false);
    expect(grid.open(10, 0)).toBe(false);
  });

  it('walks straight when nothing is in the way', () => {
    const grid = new NavGrid(room);
    expect(grid.route({ x: 4, y: 4 }, { x: 20, y: 60 })).toEqual([
      { x: 4, y: 4 },
      { x: 20, y: 60 },
    ]);
  });

  it('collapses a route to where it already is', () => {
    const grid = new NavGrid(room);
    expect(grid.route({ x: 12, y: 12 }, { x: 12, y: 12 })).toEqual([{ x: 12, y: 12 }]);
  });

  it('goes around an obstacle', () => {
    const grid = new NavGrid(room);
    const path = grid.route({ x: 12, y: 12 }, { x: 68, y: 12 });
    expect(path.at(0)).toEqual({ x: 12, y: 12 });
    expect(path.at(-1)).toEqual({ x: 68, y: 12 });
    expect(path.length).toBeGreaterThan(2);
    expect(path.some((point) => point.y >= 64)).toBe(true);
    expect(blocked(grid, path)).toBe(false);
    expect(routeLength(path)).toBeLessThan(150);
  });

  it('steps off and onto blocked points at the ends', () => {
    const grid = new NavGrid(room);
    const path = grid.route({ x: 40, y: 10 }, { x: 40, y: 50 });
    expect(path.at(0)).toEqual({ x: 40, y: 10 });
    expect(path.at(-1)).toEqual({ x: 40, y: 50 });
    expect(blocked(grid, path.slice(1, -1))).toBe(false);
  });

  it('walks straight when the goal cannot be reached', () => {
    const grid = new NavGrid({ width: 80, height: 16, obstacles: [{ ...wall, height: 16 }] });
    expect(grid.route({ x: 4, y: 4 }, { x: 76, y: 4 })).toEqual([
      { x: 4, y: 4 },
      { x: 76, y: 4 },
    ]);
  });

  it('finds the nearest walkable point', () => {
    const grid = new NavGrid(room);
    expect(grid.nearest({ x: 10, y: 10 })).toEqual({ x: 10, y: 10 });
    expect(grid.nearest({ x: 34, y: 20 })).toEqual({ x: 28, y: 20 });
    expect(grid.nearest({ x: 46, y: 20 })).toEqual({ x: 52, y: 20 });
  });

  it('keeps a point when nothing is walkable', () => {
    const grid = new NavGrid({
      width: 16,
      height: 16,
      obstacles: [{ x: 0, y: 0, width: 16, height: 16 }],
    });
    expect(grid.nearest({ x: 3, y: 3 })).toEqual({ x: 3, y: 3 });
    expect(() => grid.randomPoint(() => 0)).toThrow(RangeError);
  });

  it('picks random points on walkable cells', () => {
    const grid = new NavGrid(room);
    expect(grid.randomPoint(() => 0)).toEqual({ x: 4, y: 4 });
    expect(grid.randomPoint(() => 0.999)).toEqual({ x: 76, y: 76 });
    for (let i = 0; i < 20; i++) expect(grid.walkable(grid.randomPoint())).toBe(true);
  });

  it('checks the line of sight', () => {
    const grid = new NavGrid(room);
    expect(grid.clear({ x: 4, y: 4 }, { x: 4, y: 76 })).toBe(true);
    expect(grid.clear({ x: 4, y: 4 }, { x: 76, y: 4 })).toBe(false);
    expect(grid.clear({ x: 4, y: 4 }, { x: 4, y: 4 })).toBe(true);
  });

  it('uses a custom cell size', () => {
    const grid = new NavGrid(room, 16);
    expect([grid.columns, grid.rows]).toEqual([5, 5]);
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
