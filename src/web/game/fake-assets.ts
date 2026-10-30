import type { Assets } from './assets.js';
import type { CharacterManifest } from './sprite-sheet.js';
import type { StationManifest } from './stations.js';

export interface FakeImage {
  url: string;
}

export function fakeImage(url: string): CanvasImageSource {
  return { url } as unknown as CanvasImageSource;
}

export function fakeAssets(
  characters: Record<string, CharacterManifest> = {},
  stations: Record<string, StationManifest> = {},
  loaded = true,
): Assets {
  const characterMap = new Map(Object.entries(characters));
  const stationMap = new Map(Object.entries(stations));
  return {
    image: (url) => (loaded ? fakeImage(url) : null),
    character: (skin) => {
      const manifest = characterMap.get(skin);
      return manifest ? { manifest, base: `/assets/characters/${skin}/` } : null;
    },
    station: (id) => {
      const manifest = stationMap.get(id);
      return manifest ? { manifest, base: '/assets/' } : null;
    },
    url: (path) => `/assets/${path}`,
  };
}

export const SIDE_CHARACTER: CharacterManifest = {
  name: { en: 'Mortis' },
  station: 'stove',
  facing: 'side',
  animations: {
    idle: {
      image: 'idle.png',
      frame: { width: 32, height: 32 },
      anchor: { x: 16, y: 31 },
      row: 0,
      start: 0,
      frames: 4,
      fps: 6,
      hop: 0,
    },
    walk: {
      image: 'run.png',
      frame: { width: 64, height: 64 },
      anchor: { x: 30, y: 63 },
      row: 0,
      start: 0,
      frames: 6,
      fps: 10,
      hop: 0,
    },
    work: {
      image: 'idle.png',
      frame: { width: 32, height: 32 },
      anchor: { x: 16, y: 31 },
      row: 0,
      start: 0,
      frames: 4,
      fps: 8,
      hop: 0,
    },
    sit: {
      image: 'death.png',
      frame: { width: 64, height: 64 },
      anchor: { x: 32, y: 63 },
      row: 0,
      start: 5,
      frames: 1,
      fps: 1,
      hop: 0,
    },
    cheer: {
      image: 'idle.png',
      frame: { width: 32, height: 32 },
      anchor: { x: 16, y: 31 },
      row: 0,
      start: 0,
      frames: 4,
      fps: 8,
      hop: 3,
    },
  },
};

export const STOVE: StationManifest = {
  image: 'stations/stove.png',
  origin: { x: 0, y: 0 },
  frame: { width: 48, height: 32 },
  cell: { width: 48, height: 32 },
  columns: 4,
  frames: 4,
  fps: 6,
  anchor: { x: 24, y: 31 },
  emit: { x: 24, y: 8 },
  effect: 'magic',
};
