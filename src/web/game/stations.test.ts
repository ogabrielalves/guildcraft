import { describe, expect, it } from 'vitest';
import { AssetError } from './parse.js';
import { parseStationManifest, stationFrame } from './stations.js';

function anvil(overrides: Record<string, unknown> = {}) {
  return {
    name: { en: 'Anvil' },
    image: 'stations/anvil.png',
    frame: { width: 64, height: 80 },
    columns: 8,
    frames: 35,
    fps: 12,
    anchor: { x: 32, y: 78 },
    emit: { x: 28, y: 46 },
    effect: 'sparks',
    ...overrides,
  };
}

function failsAt(raw: unknown): string | undefined {
  try {
    parseStationManifest(raw);
    return undefined;
  } catch (error) {
    if (error instanceof AssetError) return error.path;
    throw error;
  }
}

describe('parseStationManifest', () => {
  it('reads an animated sheet', () => {
    expect(parseStationManifest(anvil())).toEqual({
      image: 'stations/anvil.png',
      origin: { x: 0, y: 0 },
      frame: { width: 64, height: 80 },
      cell: { width: 64, height: 80 },
      columns: 8,
      frames: 35,
      fps: 12,
      anchor: { x: 32, y: 78 },
      emit: { x: 28, y: 46 },
      effect: 'sparks',
    });
  });

  it('fills a static crop with defaults', () => {
    const raw = anvil({
      origin: { x: 103, y: 60 },
      columns: undefined,
      frames: undefined,
      fps: undefined,
      emit: undefined,
    });
    expect(parseStationManifest(raw)).toMatchObject({
      origin: { x: 103, y: 60 },
      columns: 1,
      frames: 1,
      fps: 1,
      emit: { x: 32, y: 0 },
    });
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['an unknown effect', { effect: 'rainbows' }, '$.effect'],
    ['an unsafe image', { image: '/etc/passwd.png' }, '$.image'],
    ['zero frames', { frames: 0 }, '$.frames'],
    ['zero columns', { columns: 0 }, '$.columns'],
    ['a missing anchor', { anchor: undefined }, '$.anchor'],
  ])('rejects %s', (_, overrides, path) => {
    expect(failsAt(anvil(overrides))).toBe(path);
  });
});

describe('stationFrame', () => {
  const manifest = parseStationManifest(anvil());

  it('holds the first frame while idle', () => {
    expect(stationFrame(manifest, false, 10)).toEqual({ sx: 0, sy: 0, width: 64, height: 80 });
  });

  it('walks the grid row by row while active', () => {
    expect(stationFrame(manifest, true, 0.5)).toMatchObject({ sx: 6 * 64, sy: 0 });
    expect(stationFrame(manifest, true, 1)).toMatchObject({ sx: 4 * 64, sy: 80 });
    expect(stationFrame(manifest, true, 35 / 12)).toMatchObject({ sx: 0, sy: 0 });
    expect(stationFrame(manifest, true, -1)).toMatchObject({ sx: 0, sy: 0 });
  });

  it('crops each cell of a grid when the frame is smaller than the cell', () => {
    const tight = parseStationManifest(
      anvil({
        origin: { x: 0, y: 17 },
        frame: { width: 64, height: 62 },
        cell: { width: 64, height: 80 },
      }),
    );
    expect(stationFrame(tight, true, 1)).toEqual({
      sx: 4 * 64,
      sy: 17 + 80,
      width: 64,
      height: 62,
    });
  });

  it('offsets crops by their origin', () => {
    const crop = parseStationManifest(anvil({ origin: { x: 10, y: 20 }, frames: 1 }));
    expect(stationFrame(crop, true, 3)).toMatchObject({ sx: 10, sy: 20 });
  });
});
