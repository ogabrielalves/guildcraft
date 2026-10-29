import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_AGENTS } from '../../shared/constants.js';
import { contains, parseWorkshopMap } from './map.js';
import type { Rect } from './parse.js';
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
    expect(manifest.station === null || stations.includes(manifest.station)).toBe(true);
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
    const area = {
      ...manifest.origin,
      width: Math.min(manifest.frames, manifest.columns) * manifest.frame.width,
      height: rows * manifest.frame.height,
    };
    expect(fits(manifest.image, area)).toBe(true);
  });
});

describe('shipped workshop map', () => {
  const map = parseWorkshopMap(json('maps/workshop.json'));

  it('has one bay per agent and a corridor between the rows', () => {
    expect(map.bays).toHaveLength(MAX_AGENTS);
    const above = map.bays.filter((bay) => bay.area.y + bay.area.height <= map.corridorY);
    expect(above).toHaveLength(MAX_AGENTS / 2);
  });

  it('keeps every scenery crop inside its sheet', () => {
    for (const item of map.scenery) {
      if (item.kind === 'image') expect(fits(item.image, item.source), item.image).toBe(true);
    }
  });

  it('keeps lights and embers inside the world', () => {
    const world = { x: 0, y: 0, width: map.width, height: map.height };
    for (const light of map.lights) expect(contains(world, light.at)).toBe(true);
    for (const ember of map.embers) expect(contains(world, ember)).toBe(true);
  });
});
