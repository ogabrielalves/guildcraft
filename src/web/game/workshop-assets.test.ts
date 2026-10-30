import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_AGENTS } from '../../shared/constants.js';
import type { Point } from './map.js';
import { contains, parseWorkshopMap } from './map.js';
import type { Rect } from './parse.js';
import { NavGrid } from './pathing.js';
import { BODY, stationBox } from './renderer.js';
import { POSES, parseCharacterManifest } from './sprite-sheet.js';
import { parseStationManifest } from './stations.js';

const ROOT = join(import.meta.dirname, '../../../assets');

function json(path: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
}

function pngSize(path: string): { width: number; height: number } {
  const data = readFileSync(join(ROOT, path));
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function fits(path: string, area: Rect): boolean {
  const { width, height } = pngSize(path);
  return (
    area.x >= 0 && area.y >= 0 && area.x + area.width <= width && area.y + area.height <= height
  );
}

const characters = readdirSync(join(ROOT, 'characters'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const stations = readdirSync(join(ROOT, 'stations'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.slice(0, -'.json'.length));

describe('shipped characters', () => {
  it('has the fixed cast and the LPC adventurers', () => {
    expect(characters).toEqual(
      expect.arrayContaining(['mortis', 'corvin', 'lyra', 'aldwin', 'brom', 'seren']),
    );
  });

  it.each(characters)('%s has a valid manifest whose frames fit its sheets', (id) => {
    const manifest = parseCharacterManifest(json(`characters/${id}/${id}.json`));
    for (const pose of POSES) {
      const animation = manifest.animations[pose];
      const sheet = `characters/${id}/${animation.image}`;
      expect(existsSync(join(ROOT, sheet))).toBe(true);
      const rows = manifest.facing === 'four' ? 4 : 1;
      const area = {
        x: animation.start * animation.frame.width,
        y: animation.row * animation.frame.height,
        width: animation.frames * animation.frame.width,
        height: rows * animation.frame.height,
      };
      expect(fits(sheet, area), `${id} ${pose}`).toBe(true);
    }
  });
});

describe('shipped stations', () => {
  it.each(stations)('%s has a valid manifest whose frames fit its sheet', (id) => {
    const manifest = parseStationManifest(json(`stations/${id}.json`));
    const rows = Math.ceil(manifest.frames / manifest.columns);
    const columns = Math.min(manifest.frames, manifest.columns);
    const area = {
      ...manifest.origin,
      width: (columns - 1) * manifest.cell.width + manifest.frame.width,
      height: (rows - 1) * manifest.cell.height + manifest.frame.height,
    };
    expect(fits(manifest.image, area)).toBe(true);
  });
});

function inside(outer: Rect, box: Rect): boolean {
  return (
    box.x >= outer.x &&
    box.y >= outer.y &&
    box.x + box.width <= outer.x + outer.width &&
    box.y + box.height <= outer.y + outer.height
  );
}

function body(at: Point): Rect {
  return {
    x: at.x - BODY.width / 2,
    y: at.y - BODY.height,
    width: BODY.width,
    height: BODY.height,
  };
}

describe('shipped workshop map', () => {
  const map = parseWorkshopMap(json('maps/workshop.json'));
  const world = { x: 0, y: 0, width: map.width, height: map.height };
  const nav = new NavGrid(map);
  const manifests = new Map(
    stations.map((id) => [id, parseStationManifest(json(`stations/${id}.json`))]),
  );

  it('has a free station for every agent, each a known one', () => {
    expect(map.stations.length).toBeGreaterThanOrEqual(MAX_AGENTS);
    for (const { id } of map.stations) expect(stations).toContain(id);
  });

  it.each(map.stations.map((place, index) => [index, place] as const))(
    'station %i stands inside the world on its own obstacle',
    (_, place) => {
      const manifest = manifests.get(place.id);
      const box = stationBox(place, manifest ? { manifest, base: '' } : null);
      expect(inside(world, box)).toBe(true);
      expect(nav.walkable({ x: place.at.x, y: place.at.y - 2 })).toBe(false);
      expect(nav.walkable(place.work)).toBe(true);
      expect(inside(world, body(place.work))).toBe(true);
    },
  );

  it('lets everyone walk from any station to every work point and spot', () => {
    const start = map.stations[0]?.work ?? { x: 0, y: 0 };
    const targets = [...map.stations.map(({ work }) => work), ...map.spots.map(({ at }) => at)];
    for (const target of targets) {
      const path = nav.route(start, nav.nearest(target));
      path.slice(1).forEach((point, index) => {
        const previous = path[index] ?? point;
        expect(nav.clear(previous, point), JSON.stringify(target)).toBe(true);
      });
    }
  });

  it('has spots to read and to nap', () => {
    expect(map.spots.some(({ kind }) => kind === 'read')).toBe(true);
    expect(map.spots.some(({ kind }) => kind === 'nap')).toBe(true);
    for (const { at } of map.spots) expect(inside(world, body(at))).toBe(true);
  });

  it('keeps every scenery crop inside its sheet', () => {
    for (const item of map.scenery) {
      if (item.kind === 'image') expect(fits(item.image, item.source), item.image).toBe(true);
    }
  });

  it('keeps embers inside the world', () => {
    for (const ember of map.embers) expect(contains(world, ember)).toBe(true);
  });
});
