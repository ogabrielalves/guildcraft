import { describe, expect, it, vi } from 'vitest';
import {
  MapError,
  bayAt,
  contains,
  loadWorkshopMap,
  parseWorkshopMap,
  wanderPoint,
} from './map.js';
import { provisionalWorkshop } from './provisional-workshop.js';

type RawWorkshop = ReturnType<typeof provisionalWorkshop>;

function rawBay(raw: RawWorkshop, index: number): RawWorkshop['bays'][number] {
  const bay = raw.bays[index];
  if (bay === undefined) throw new Error(`missing bay ${String(index)}`);
  return bay;
}

function invalidAt(raw: unknown): string | undefined {
  try {
    parseWorkshopMap(raw);
    return undefined;
  } catch (error) {
    if (error instanceof MapError) return error.path;
    throw error;
  }
}

describe('parseWorkshopMap', () => {
  it('reads the size, corridor and all bays', () => {
    const map = parseWorkshopMap(provisionalWorkshop());
    expect(map).toMatchObject({ width: 480, height: 272, tileSize: 16, corridorY: 160 });
    expect(map.bays).toHaveLength(8);
    expect(map.bays[5]).toEqual(provisionalWorkshop().bays[5]);
  });

  it('drops unknown fields', () => {
    const raw = { ...provisionalWorkshop(), extra: true };
    raw.bays[0] = { ...rawBay(raw, 0), ...{ note: 'x' } };
    const map = parseWorkshopMap(raw);
    expect(map).not.toHaveProperty('extra');
    expect(map.bays[0]).not.toHaveProperty('note');
  });

  it.each([null, [], 'map', 3])('rejects a non-object root %j', (raw) => {
    expect(invalidAt(raw)).toBe('$');
  });

  it.each([
    ['width', 0],
    ['height', -1],
    ['tileSize', '16'],
    ['corridorY', Number.NaN],
    ['corridorY', 300],
    ['corridorY', -1],
  ])('rejects %s = %j', (field, value) => {
    expect(invalidAt({ ...provisionalWorkshop(), [field]: value })).toBe(`$.${field}`);
  });

  it('requires exactly one bay per agent', () => {
    const raw = provisionalWorkshop();
    expect(invalidAt({ ...raw, bays: raw.bays.slice(1) })).toBe('$.bays');
    expect(invalidAt({ ...raw, bays: {} })).toBe('$.bays');
  });

  it('rejects a bay point outside its area', () => {
    const raw = provisionalWorkshop();
    rawBay(raw, 2).nap = { x: 0, y: 0 };
    expect(invalidAt(raw)).toBe('$.bays[2].nap');
  });

  it('rejects a missing or malformed point', () => {
    const raw = provisionalWorkshop();
    rawBay(raw, 1).guest = { x: 100, y: null } as unknown as { x: number; y: number };
    expect(invalidAt(raw)).toBe('$.bays[1].guest.y');
  });

  it('rejects a bay with an empty area', () => {
    const raw = provisionalWorkshop();
    rawBay(raw, 3).area.width = 0;
    expect(invalidAt(raw)).toBe('$.bays[3].area.width');
  });

  it('rejects a bay that leaves the map', () => {
    const raw = provisionalWorkshop();
    rawBay(raw, 7).area.width = 600;
    expect(invalidAt(raw)).toBe('$.bays[7].area');
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
    expect(map.bays).toHaveLength(8);
  });

  it('fails on an http error', async () => {
    const request = () => Promise.resolve(new Response('missing', { status: 404 }));
    await expect(loadWorkshopMap('/map.json', request)).rejects.toBeInstanceOf(MapError);
  });
});

describe('bayAt', () => {
  it('returns the bay or rejects an unknown index', () => {
    const map = parseWorkshopMap(provisionalWorkshop());
    expect(bayAt(map, 3)).toBe(map.bays[3]);
    expect(() => bayAt(map, 8)).toThrow(RangeError);
  });
});

describe('wanderPoint', () => {
  it('picks a point inside the bay area', () => {
    const bay = bayAt(parseWorkshopMap(provisionalWorkshop()), 4);
    expect(wanderPoint(bay, () => 0)).toEqual({ x: 12, y: 196 });
    expect(wanderPoint(bay, () => 1)).toEqual({ x: 84, y: 232 });
    expect(contains(bay.area, wanderPoint(bay))).toBe(true);
  });
});
