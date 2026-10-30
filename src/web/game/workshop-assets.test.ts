import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_AGENTS } from '../../shared/constants.js';
import type { Bay } from './map.js';
import { WANDER_MARGIN, contains, parseWorkshopMap } from './map.js';
import type { Rect } from './parse.js';
import { BODY } from './renderer.js';
import { POSES, parseCharacterManifest } from './sprite-sheet.js';
import { parseStationManifest } from './stations.js';

const ROOT = join(import.meta.dirname, '../../../assets');
const PILLAR_CLEARANCE = 8;
const PILLAR_HEIGHT = 60;

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

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function usable({ area }: Bay): Rect {
  return { ...area, x: area.x + PILLAR_CLEARANCE, width: area.width - 2 * PILLAR_CLEARANCE };
}

function body(at: { x: number; y: number }): Rect {
  return {
    x: at.x - BODY.width / 2,
    y: at.y - BODY.height,
    width: BODY.width,
    height: BODY.height,
  };
}

describe('shipped workshop map', () => {
  const map = parseWorkshopMap(json('maps/workshop.json'));

  it('has one bay per agent and a corridor between the rows', () => {
    expect(map.bays).toHaveLength(MAX_AGENTS);
    const above = map.bays.filter((bay) => bay.area.y + bay.area.height <= map.corridorY);
    expect(above).toHaveLength(MAX_AGENTS / 2);
  });

  const boxes = stations.map((id) => {
    const manifest = parseStationManifest(json(`stations/${id}.json`));
    return { id, manifest };
  });

  it.each(map.bays.map((bay, index) => [index, bay] as const))(
    'bay %i fits every station clear of its pillars and edges',
    (_, bay) => {
      for (const { id, manifest } of boxes) {
        const box = {
          x: bay.station.x - manifest.anchor.x,
          y: bay.station.y - manifest.anchor.y,
          ...manifest.frame,
        };
        expect(inside(usable(bay), box), id).toBe(true);
        const worker = body(bay.work);
        expect(inside(usable(bay), { ...worker, y: bay.area.y }), `${id} worker`).toBe(true);
        expect(worker.x >= box.x + box.width, `${id} worker beside`).toBe(true);
      }
    },
  );

  it('keeps wandering adventurers clear of the pillars', () => {
    for (const bay of map.bays) {
      const left = body({ x: bay.area.x + WANDER_MARGIN.side, y: bay.area.y + bay.area.height });
      const right = body({
        x: bay.area.x + bay.area.width - WANDER_MARGIN.side,
        y: bay.area.y + bay.area.height,
      });
      expect(left.x).toBeGreaterThanOrEqual(usable(bay).x);
      expect(right.x + right.width).toBeLessThanOrEqual(usable(bay).x + usable(bay).width);
    }
  });

  it('keeps the pillars out of the usable part of every bay', () => {
    const pillars = map.scenery.flatMap((item) =>
      item.kind === 'image' && item.repeat === null && item.source.height >= PILLAR_HEIGHT
        ? [{ ...item.at, width: item.source.width, height: item.source.height }]
        : [],
    );
    expect(pillars.length).toBeGreaterThanOrEqual(MAX_AGENTS);
    for (const pillar of pillars) {
      for (const bay of map.bays) expect(overlaps(pillar, usable(bay))).toBe(false);
    }
  });

  it('keeps every scenery crop inside its sheet', () => {
    for (const item of map.scenery) {
      if (item.kind === 'image') expect(fits(item.image, item.source), item.image).toBe(true);
    }
  });

  it('keeps embers inside the world', () => {
    const world = { x: 0, y: 0, width: map.width, height: map.height };
    for (const ember of map.embers) expect(contains(world, ember)).toBe(true);
  });
});
