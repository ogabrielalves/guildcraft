import { describe, expect, it, vi } from 'vitest';
import { AssetError } from './parse.js';
import {
  DEFAULT_FLOOR,
  contains,
  loadWorkshopMap,
  parseWorkshopMap,
  stationAt,
  zoneAt,
} from './map.js';
import { provisionalWorkshop } from './provisional-workshop.js';

function invalidAt(raw: unknown): string | undefined {
  try {
    parseWorkshopMap(raw);
    return undefined;
  } catch (error) {
    if (error instanceof AssetError) return error.path;
    throw error;
  }
}

describe('parseWorkshopMap', () => {
  it('reads the size, stations, obstacles and spots', () => {
    const raw = provisionalWorkshop();
    const map = parseWorkshopMap(raw);
    expect(map).toMatchObject({ width: 480, height: 352, tileSize: 16 });
    expect(map.stations).toHaveLength(12);
    expect(map.stations[6]).toEqual({ ...raw.stations[6], effect: null });
    expect(map.obstacles).toEqual(raw.obstacles);
    expect(map.spots[0]).toEqual({ kind: 'read', at: { x: 440, y: 120 }, facing: 'north' });
    expect(map.spots[1]?.facing).toBe('south');
  });

  it('drops unknown fields', () => {
    const raw = provisionalWorkshop();
    const station = { ...raw.stations[0], note: 'x' };
    const map = parseWorkshopMap({ ...raw, extra: true, stations: [station, ...raw.stations] });
    expect(map).not.toHaveProperty('extra');
    expect(map.stations[0]).not.toHaveProperty('note');
  });

  it.each([null, [], 'map', 3])('rejects a non-object root %j', (raw) => {
    expect(invalidAt(raw)).toBe('$');
  });

  it.each([
    ['width', 0],
    ['height', -1],
    ['tileSize', '16'],
  ])('rejects %s = %j', (field, value) => {
    expect(invalidAt({ ...provisionalWorkshop(), [field]: value })).toBe(`$.${field}`);
  });

  it('requires at least one station per agent', () => {
    const raw = provisionalWorkshop();
    expect(invalidAt({ ...raw, stations: raw.stations.slice(3) })).toBe('$.stations');
    expect(invalidAt({ ...raw, stations: {} })).toBe('$.stations');
  });

  it.each([
    [{ id: '' }, '$.stations[2].id'],
    [{ at: { x: 900, y: 10 } }, '$.stations[2].at'],
    [{ work: { x: 10, y: -1 } }, '$.stations[2].work'],
    [{ work: { x: 10, y: null } }, '$.stations[2].work.y'],
  ])('rejects station %j', (overrides, path) => {
    const raw = provisionalWorkshop();
    const stations: unknown[] = [...raw.stations];
    stations[2] = { ...raw.stations[2], ...overrides };
    expect(invalidAt({ ...raw, stations })).toBe(path);
  });

  it.each([
    [{ kind: 'dance' }, '$.spots[1].kind'],
    [{ facing: 'up' }, '$.spots[1].facing'],
    [{ at: { x: 10, y: 999 } }, '$.spots[1].at'],
  ])('rejects spot %j', (overrides, path) => {
    const raw = provisionalWorkshop();
    const spots: unknown[] = [...raw.spots];
    spots[1] = { ...raw.spots[1], ...overrides };
    expect(invalidAt({ ...raw, spots })).toBe(path);
  });

  it('reads stations drawn into the scenery by their effect', () => {
    const raw = provisionalWorkshop();
    const stations = [{ effect: 'sparks', at: { x: 10, y: 10 }, work: { x: 10, y: 30 } }];
    const map = parseWorkshopMap({ ...raw, stations: [...stations, ...raw.stations] });
    expect(map.stations[0]).toEqual({ id: null, effect: 'sparks', ...stations[0] });
  });

  it.each([
    [{ id: undefined }, '$.stations[2].id'],
    [{ effect: 'fireworks' }, '$.stations[2].effect'],
  ])('rejects station effect %j', (overrides, path) => {
    const raw = provisionalWorkshop();
    const stations: unknown[] = [...raw.stations];
    stations[2] = { ...raw.stations[2], ...overrides };
    expect(invalidAt({ ...raw, stations })).toBe(path);
  });

  const open = '.'.repeat(30);
  const grid = (...top: string[]) => [
    ...top.map((row) => row.padEnd(30, '.')),
    ...Array<string>(22 - top.length).fill(open),
  ];

  it('turns the collision grid into obstacles', () => {
    const raw = { ...provisionalWorkshop(), obstacles: [] };
    const map = parseWorkshopMap({ ...raw, collision: grid('#..#', '.##.') });
    expect(map.obstacles).toEqual([
      { x: 0, y: 0, width: 16, height: 16 },
      { x: 48, y: 0, width: 16, height: 16 },
      { x: 16, y: 16, width: 32, height: 16 },
    ]);
  });

  it.each([
    [{}, '$.collision'],
    [[open, open], '$.collision'],
    [[open, '...', ...grid().slice(2)], '$.collision[1]'],
    [grid(open, '..x'), '$.collision[1]'],
    [grid(open, `${open}.`), '$.collision[1]'],
    [[open, 4, ...grid().slice(2)], '$.collision[1]'],
  ])('rejects collision %#', (collision, path) => {
    expect(invalidAt({ ...provisionalWorkshop(), collision })).toBe(path);
  });

  it('reads zones and finds the zone of a point', () => {
    const zones = [
      { id: 'west', areas: [{ x: 0, y: 0, width: 240, height: 352 }], sign: { x: 120, y: 8 } },
      {
        id: 'east',
        areas: [
          { x: 240, y: 0, width: 240, height: 100 },
          { x: 300, y: 100, width: 180, height: 252 },
        ],
      },
    ];
    const map = parseWorkshopMap({ ...provisionalWorkshop(), zones });
    expect(map.zones).toEqual(zones.map((zone) => ({ sign: null, common: false, ...zone })));
    expect(zoneAt(map, { x: 10, y: 10 })).toBe('west');
    expect(zoneAt(map, { x: 400, y: 300 })).toBe('east');
    expect(zoneAt(map, { x: 260, y: 200 })).toBeNull();
    expect(parseWorkshopMap(provisionalWorkshop()).zones).toEqual([]);
  });

  it('marks a zone as common for idle villagers', () => {
    const area = { x: 0, y: 0, width: 100, height: 100 };
    const map = parseWorkshopMap({
      ...provisionalWorkshop(),
      zones: [
        { id: 'hall', areas: [area], common: true },
        { id: 'room', areas: [area] },
      ],
    });
    expect(map.zones.map(({ common }) => common)).toEqual([true, false]);
  });

  it.each([
    [{ zones: {} }, '$.zones'],
    [
      {
        zones: [{ id: 'a', areas: [{ x: 0, y: 0, width: 1, height: 1 }], sign: { x: 900, y: 0 } }],
      },
      '$.zones[0].sign',
    ],
    [{ zones: [{ id: '', areas: [{ x: 0, y: 0, width: 1, height: 1 }] }] }, '$.zones[0].id'],
    [{ zones: [{ id: 'a', areas: [] }] }, '$.zones[0].areas'],
    [
      { zones: [{ id: 'a', areas: [{ x: 400, y: 0, width: 100, height: 1 }] }] },
      '$.zones[0].areas[0]',
    ],
    [
      {
        zones: [
          { id: 'a', areas: [{ x: 0, y: 0, width: 1, height: 1 }] },
          { id: 'a', areas: [{ x: 5, y: 5, width: 1, height: 1 }] },
        ],
      },
      '$.zones[1].id',
    ],
  ])('rejects zones %j', (overrides, path) => {
    expect(invalidAt({ ...provisionalWorkshop(), ...overrides })).toBe(path);
  });

  it('reads the house and rejects one outside the world', () => {
    const raw = provisionalWorkshop();
    const house = { x: 0, y: 0, width: 480, height: 352 };
    expect(parseWorkshopMap({ ...raw, house }).house).toEqual(house);
    expect(parseWorkshopMap(raw).house).toBeNull();
    expect(invalidAt({ ...raw, house: { x: 400, y: 0, width: 100, height: 10 } })).toBe('$.house');
    expect(invalidAt({ ...raw, house: { x: 0, y: 0, width: 100 } })).toBe('$.house.height');
  });

  it('rejects stations, spots, wander points, routes and zones outside the house', () => {
    const raw = provisionalWorkshop();
    const house = { x: 0, y: 0, width: 480, height: 352 };
    const outside = { x: 470, y: 345 };
    const tight = { x: 0, y: 0, width: 460, height: 340 };
    const small = { x: 0, y: 0, width: 10, height: 10 };
    expect(invalidAt({ ...raw, house: small })?.startsWith('$.stations[')).toBe(true);
    expect(invalidAt({ ...raw, house, wander: [outside], zones: [] })).toBeUndefined();
    expect(invalidAt({ ...raw, house: tight, wander: [outside] })).toBe('$.wander[0]');
    expect(invalidAt({ ...raw, house: tight, routes: [[{ x: 1, y: 1 }, outside]] })).toBe(
      '$.routes[0][1]',
    );
    expect(
      invalidAt({
        ...raw,
        house: tight,
        zones: [{ id: 'z', areas: [{ x: 450, y: 0, width: 20, height: 10 }] }],
      }),
    ).toBe('$.zones[0].areas[0]');
  });

  it('lets bench spots sit outside the house but no other kind', () => {
    const raw = provisionalWorkshop();
    const tight = { x: 0, y: 0, width: 460, height: 340 };
    const outside = { x: 470, y: 345 };
    const bench = { kind: 'bench', at: outside };
    expect(invalidAt({ ...raw, house: tight, spots: [...raw.spots, bench] })).toBeUndefined();
    expect(
      invalidAt({ ...raw, house: tight, spots: [...raw.spots, { kind: 'nap', at: outside }] }),
    ).toBe(`$.spots[${String(raw.spots.length)}].at`);
  });

  it('reads wander points, routes, the entrance and the start view', () => {
    const raw = provisionalWorkshop();
    const map = parseWorkshopMap({
      ...raw,
      wander: [{ x: 1, y: 2 }],
      routes: [
        [
          { x: 3, y: 4 },
          { x: 5, y: 6 },
        ],
      ],
      entrance: { x: 7, y: 8 },
      view: { x: 10, y: 20, width: 100, height: 50 },
    });
    expect(map).toMatchObject({
      wander: [{ x: 1, y: 2 }],
      routes: [
        [
          { x: 3, y: 4 },
          { x: 5, y: 6 },
        ],
      ],
      entrance: { x: 7, y: 8 },
      view: { x: 10, y: 20, width: 100, height: 50 },
    });
    expect(parseWorkshopMap(raw)).toMatchObject({
      wander: [],
      routes: [],
      entrance: null,
      view: { x: 0, y: 0, width: 480, height: 352 },
    });
  });

  it.each([
    [{ wander: [{ x: -1, y: 0 }] }, '$.wander[0]'],
    [{ routes: [[{ x: 1, y: 1 }]] }, '$.routes[0]'],
    [
      {
        routes: [
          [
            { x: 1, y: 1 },
            { x: 1, y: 900 },
          ],
        ],
      },
      '$.routes[0][1]',
    ],
    [{ entrance: { x: 999, y: 1 } }, '$.entrance'],
    [{ view: { x: 400, y: 0, width: 100, height: 10 } }, '$.view'],
    [{ view: { x: -1, y: 0, width: 100, height: 10 } }, '$.view'],
  ])('rejects %j', (overrides, path) => {
    expect(invalidAt({ ...provisionalWorkshop(), ...overrides })).toBe(path);
  });

  it('rejects an obstacle with an empty size', () => {
    const raw = provisionalWorkshop();
    expect(invalidAt({ ...raw, obstacles: [{ x: 0, y: 0, width: 0, height: 4 }] })).toBe(
      '$.obstacles[0].width',
    );
  });
});

describe('parseWorkshopMap scenery and embers', () => {
  const base = provisionalWorkshop();

  it('defaults to a plain floor with nothing else', () => {
    expect(parseWorkshopMap({ ...base, obstacles: undefined, spots: undefined })).toMatchObject({
      floor: DEFAULT_FLOOR,
      obstacles: [],
      spots: [],
      scenery: [],
      embers: [],
    });
  });

  it('reads fills, images, depths and embers', () => {
    const map = parseWorkshopMap({
      ...base,
      floor: '#112233',
      scenery: [
        { color: '#000', area: { x: 0, y: 0, width: 10, height: 10 } },
        {
          image: 'tiles/a.png',
          source: { x: 1, y: 2, width: 3, height: 4 },
          at: { x: 5, y: 6 },
          repeat: { width: 30, height: 40 },
          flip: true,
          depth: 12,
        },
        { image: 'tiles/b.png', source: { x: 0, y: 0, width: 8, height: 8 }, at: { x: 0, y: 0 } },
      ],
      embers: [{ x: 7, y: 8 }],
    });
    expect(map.floor).toBe('#112233');
    expect(map.scenery).toEqual([
      { kind: 'fill', color: '#000', area: { x: 0, y: 0, width: 10, height: 10 }, depth: null },
      {
        kind: 'image',
        image: 'tiles/a.png',
        source: { x: 1, y: 2, width: 3, height: 4 },
        at: { x: 5, y: 6 },
        repeat: { width: 30, height: 40 },
        flip: true,
        depth: 12,
      },
      {
        kind: 'image',
        image: 'tiles/b.png',
        source: { x: 0, y: 0, width: 8, height: 8 },
        at: { x: 0, y: 0 },
        repeat: null,
        flip: false,
        depth: null,
      },
    ]);
    expect(map.embers).toEqual([{ x: 7, y: 8 }]);
  });

  it.each([
    [{ floor: 'brown' }, '$.floor'],
    [{ scenery: {} }, '$.scenery'],
    [
      { scenery: [{ color: 'x', area: { x: 0, y: 0, width: 1, height: 1 } }] },
      '$.scenery[0].color',
    ],
    [
      { scenery: [{ color: '#000', area: { x: 0, y: 0, width: 1, height: 1 }, depth: 'a' }] },
      '$.scenery[0].depth',
    ],
    [{ scenery: [{ image: '../x.png' }] }, '$.scenery[0].image'],
    [
      {
        scenery: [
          {
            image: 'a.png',
            source: { x: 0, y: 0, width: 1, height: 1 },
            at: { x: 0, y: 0 },
            flip: 'yes',
          },
        ],
      },
      '$.scenery[0].flip',
    ],
    [{ embers: [{ x: 'a', y: 0 }] }, '$.embers[0].x'],
  ])('rejects %j', (overrides, path) => {
    expect(invalidAt({ ...base, ...overrides })).toBe(path);
  });
});

describe('contains', () => {
  const area = { x: 10, y: 20, width: 30, height: 40 };

  it.each([
    [{ x: 10, y: 20 }, true],
    [{ x: 40, y: 60 }, true],
    [{ x: 25, y: 30 }, true],
    [{ x: 9, y: 30 }, false],
    [{ x: 25, y: 61 }, false],
  ])('checks %j', (point, expected) => {
    expect(contains(area, point)).toBe(expected);
  });
});

describe('loadWorkshopMap', () => {
  it('fetches and parses the map', async () => {
    const request = vi.fn(() => Promise.resolve(Response.json(provisionalWorkshop())));
    const map = await loadWorkshopMap('/assets/maps/workshop.json', request);
    expect(request).toHaveBeenCalledWith('/assets/maps/workshop.json');
    expect(map.stations).toHaveLength(12);
  });

  it('fails on an http error', async () => {
    const request = () => Promise.resolve(new Response('missing', { status: 404 }));
    await expect(loadWorkshopMap('/map.json', request)).rejects.toBeInstanceOf(AssetError);
  });
});

describe('stationAt', () => {
  it('returns the station or rejects an unknown index', () => {
    const map = parseWorkshopMap(provisionalWorkshop());
    expect(stationAt(map, 3)).toBe(map.stations[3]);
    expect(() => stationAt(map, 12)).toThrow(RangeError);
  });
});
