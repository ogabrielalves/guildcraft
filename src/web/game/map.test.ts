import { describe, expect, it, vi } from 'vitest';
import { AssetError } from './parse.js';
import { DEFAULT_FLOOR, contains, loadWorkshopMap, parseWorkshopMap, stationAt } from './map.js';
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
    expect(map.stations).toHaveLength(10);
    expect(map.stations[6]).toEqual(raw.stations[6]);
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
    expect(map.stations).toHaveLength(10);
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
    expect(() => stationAt(map, 10)).toThrow(RangeError);
  });
});
