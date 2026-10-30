import { afterEach, describe, expect, it, vi } from 'vitest';
import { SIDE_CHARACTER } from './fake-assets.js';
import { AssetError } from './parse.js';
import type { CharacterManifest } from './sprite-sheet.js';
import { directionTo, frameAt, loadImage, parseCharacterManifest } from './sprite-sheet.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function lpc(overrides: Record<string, unknown> = {}) {
  return {
    name: { en: 'Brom' },
    source: 'lpc',
    facing: 'four',
    image: 'brom.png',
    frame: { width: 32, height: 32 },
    anchor: { x: 16, y: 30 },
    animations: {
      idle: { row: 22, frames: 2, fps: 2 },
      walk: { row: 8, start: 1, frames: 8, fps: 10 },
      work: { row: 0, frames: 7, fps: 8 },
      sit: { row: 30, start: 1, frames: 1, fps: 1 },
      cheer: { row: 34, start: 2, frames: 1, fps: 1, hop: 2 },
    },
    ...overrides,
  };
}

function failsAt(raw: unknown): string | undefined {
  try {
    parseCharacterManifest(raw);
    return undefined;
  } catch (error) {
    if (error instanceof AssetError) return error.path;
    throw error;
  }
}

describe('parseCharacterManifest', () => {
  it('fills animations from the sheet defaults', () => {
    const manifest = parseCharacterManifest(lpc());
    expect(manifest.name).toEqual({ en: 'Brom' });
    expect(manifest.facing).toBe('four');
    expect(manifest.animations.walk).toEqual({
      image: 'brom.png',
      frame: { width: 32, height: 32 },
      anchor: { x: 16, y: 30 },
      row: 8,
      start: 1,
      frames: 8,
      fps: 10,
      hop: 0,
    });
    expect(manifest.animations.cheer.hop).toBe(2);
  });

  it('lets each animation bring its own sheet, frame and anchor', () => {
    const raw = lpc({
      name: undefined,
      image: undefined,
      frame: undefined,
      anchor: undefined,
    });
    const animations = Object.fromEntries(
      Object.keys(raw.animations).map((pose) => [
        pose,
        {
          image: `${pose}.png`,
          frame: { width: 64, height: 32 },
          anchor: { x: 32, y: 31 },
          frames: 6,
          fps: 10,
        },
      ]),
    );
    const manifest = parseCharacterManifest({ ...raw, facing: 'side', animations });
    expect(manifest.name).toEqual({});
    expect(manifest.animations.sit).toMatchObject({ image: 'sit.png', row: 0, start: 0 });
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['a bad facing', { facing: 'up' }, '$.facing'],
    ['a list of names', { name: ['Brom'] }, '$.name'],
    ['an empty name', { name: { en: '' } }, '$.name.en'],
    ['missing animations', { animations: null }, '$.animations'],
    ['a missing pose', { animations: { ...lpc().animations, sit: undefined } }, '$.animations.sit'],
    ['an unsafe sheet', { image: '../secret.png' }, '$.image'],
    ['a non-png sheet', { image: 'brom.gif' }, '$.image'],
    ['a bad frame', { frame: { width: 0, height: 32 } }, '$.frame.width'],
    ['a bad anchor', { anchor: { x: 'a', y: 1 } }, '$.anchor.x'],
  ])('rejects %s', (_, overrides, path) => {
    expect(failsAt(lpc(overrides))).toBe(path);
  });

  it.each([
    [{ frames: 0, fps: 2 }, '$.animations.idle.frames'],
    [{ frames: 2, fps: 0 }, '$.animations.idle.fps'],
    [{ frames: 2, fps: 2, row: 1.5 }, '$.animations.idle.row'],
    [{ frames: 2, fps: 2, start: -1 }, '$.animations.idle.start'],
  ])('rejects the idle animation %j', (idle, path) => {
    expect(failsAt(lpc({ animations: { ...lpc().animations, idle } }))).toBe(path);
  });

  it('needs a sheet, frame and anchor somewhere', () => {
    expect(failsAt(lpc({ image: undefined }))).toBe('$.animations.idle.image');
    expect(failsAt(lpc({ frame: undefined }))).toBe('$.animations.idle.frame');
    expect(failsAt(lpc({ anchor: undefined }))).toBe('$.animations.idle.anchor');
  });

  it('rejects a non-object manifest', () => {
    expect(failsAt([])).toBe('$');
  });
});

describe('frameAt', () => {
  const four = parseCharacterManifest(lpc());

  it('picks the row of the facing direction on four-way sheets', () => {
    expect(frameAt(four, 'idle', 'north', 'east', 0)).toEqual({
      image: 'brom.png',
      sx: 0,
      sy: 22 * 32,
      width: 32,
      height: 32,
      anchor: { x: 16, y: 30 },
      flip: false,
      lift: 0,
    });
    expect(frameAt(four, 'idle', 'east', 'west', 0)).toMatchObject({ sy: 25 * 32, flip: false });
  });

  it('advances frames with time, loops and clamps negative time', () => {
    expect(frameAt(four, 'walk', 'south', 'east', 0).sx).toBe(32);
    expect(frameAt(four, 'walk', 'south', 'east', 0.25).sx).toBe(3 * 32);
    expect(frameAt(four, 'walk', 'south', 'east', 0.8).sx).toBe(32);
    expect(frameAt(four, 'sit', 'west', 'east', -3).sx).toBe(32);
  });

  it('mirrors side sheets for the west side and keeps their single row', () => {
    const side: CharacterManifest = SIDE_CHARACTER;
    expect(frameAt(side, 'walk', 'north', 'west', 0)).toMatchObject({
      image: 'run.png',
      sy: 0,
      width: 64,
      anchor: { x: 30, y: 63 },
      flip: true,
    });
    expect(frameAt(side, 'walk', 'south', 'east', 0).flip).toBe(false);
    expect(frameAt(side, 'sit', 'south', 'east', 0).sx).toBe(5 * 64);
  });

  it('lifts hopping poses with time', () => {
    expect(frameAt(SIDE_CHARACTER, 'cheer', 'south', 'east', 0).lift).toBe(0);
    expect(frameAt(SIDE_CHARACTER, 'cheer', 'south', 'east', 0.25).lift).toBe(3);
  });
});

describe('directionTo', () => {
  it.each([
    [1, 0, 'east'],
    [-1, 0.5, 'west'],
    [0.2, 1, 'south'],
    [0, -1, 'north'],
    [0, 0, 'west'],
  ] as const)('maps (%d, %d) to %s', (dx, dy, expected) => {
    expect(directionTo(dx, dy, 'west')).toBe(expected);
  });
});

describe('loadImage', () => {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(url: string) {
      queueMicrotask(() => {
        if (url.endsWith('ok.png')) this.onload?.();
        else this.onerror?.();
      });
    }
  }

  it('resolves with the image or rejects on error', async () => {
    vi.stubGlobal('Image', FakeImage);
    await expect(loadImage('/ok.png')).resolves.toBeInstanceOf(FakeImage);
    await expect(loadImage('/bad.png')).rejects.toThrow('/bad.png');
  });
});
