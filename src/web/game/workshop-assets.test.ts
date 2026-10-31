import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MAX_AGENTS } from '../../shared/constants.js';
import type { Point } from './map.js';
import { contains, parseWorkshopMap, zoneAt } from './map.js';
import type { Rect } from './parse.js';
import { fields, list } from './parse.js';
import { NAV_CELL, NavGrid } from './pathing.js';
import { BODY, stationBox } from './renderer.js';
import { POSES, parseCharacterManifest } from './sprite-sheet.js';
import { parseStationManifest } from './stations.js';

const ROOT = join(import.meta.dirname, '../../../assets');
const OVERLAY_TOLERANCE = 16;

function json(path: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
}

function pngSize(path: string): { width: number; height: number } {
  const data = readFileSync(join(ROOT, path));
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

interface Png {
  width: number;
  channels: number;
  data: Uint8Array;
}

function paeth(left: number, up: number, corner: number): number {
  const guess = left + up - corner;
  const toLeft = Math.abs(guess - left);
  const toUp = Math.abs(guess - up);
  const toCorner = Math.abs(guess - corner);
  if (toLeft <= toUp && toLeft <= toCorner) return left;
  return toUp <= toCorner ? up : corner;
}

const decoded = new Map<string, Png>();

function decodePng(path: string): Png {
  const cached = decoded.get(path);
  if (cached) return cached;
  const file = readFileSync(join(ROOT, path));
  const { width, height } = pngSize(path);
  const channels = file[25] === 6 ? 4 : 3;
  const chunks: Buffer[] = [];
  for (let at = 8; at < file.length;) {
    const length = file.readUInt32BE(at);
    if (file.toString('ascii', at + 4, at + 8) === 'IDAT') {
      chunks.push(file.subarray(at + 8, at + 8 + length));
    }
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? (data[row + x - channels] ?? 0) : 0;
      const up = y > 0 ? (data[row - stride + x] ?? 0) : 0;
      const corner = x >= channels && y > 0 ? (data[row - stride + x - channels] ?? 0) : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) predictor = paeth(left, up, corner);
      data[row + x] = ((raw[y * (stride + 1) + 1 + x] ?? 0) + predictor) & 255;
    }
  }
  const png = { width, channels, data };
  decoded.set(path, png);
  return png;
}

function pixel(png: Png, x: number, y: number): number[] {
  const at = (y * png.width + x) * png.channels;
  const { data } = png;
  return [
    data[at] ?? 0,
    data[at + 1] ?? 0,
    data[at + 2] ?? 0,
    png.channels === 4 ? (data[at + 3] ?? 0) : 255,
  ];
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

  it('has a free station for every agent, each a known one or drawn into the map', () => {
    expect(map.stations.length).toBeGreaterThanOrEqual(MAX_AGENTS);
    for (const { id } of map.stations) if (id !== null) expect(stations).toContain(id);
  });

  it.each(map.stations.map((place, index) => [index, place] as const))(
    'station %i stands inside the world with a reachable work point',
    (_, place) => {
      const manifest = place.id === null ? undefined : manifests.get(place.id);
      const box = stationBox(place, manifest ? { manifest, base: '' } : null);
      expect(contains(world, place.at)).toBe(true);
      if (manifest) expect(inside(world, box)).toBe(true);
      if (manifest) expect(nav.walkable({ x: place.at.x, y: place.at.y - 2 })).toBe(false);
      expect(nav.walkable(place.work)).toBe(true);
      expect(inside(world, body(place.work))).toBe(true);
    },
  );

  it('lets everyone walk from any station to every work point, spot and wander point', () => {
    const start = map.stations[0]?.work ?? { x: 0, y: 0 };
    const targets = [
      ...map.stations.map(({ work }) => work),
      ...map.spots.map(({ at }) => at),
      ...map.wander,
      ...map.routes.flat(),
      ...(map.entrance === null ? [] : [map.entrance]),
    ];
    for (const target of targets) {
      const end = nav.nearest(target);
      expect(Math.hypot(end.x - target.x, end.y - target.y), JSON.stringify(target)).toBeLessThan(
        map.tileSize * 2,
      );
      const path = nav.route(start, end);
      path.slice(1).forEach((point, index) => {
        const previous = path[index] ?? point;
        expect(nav.clear(previous, point), JSON.stringify(target)).toBe(true);
      });
    }
  });

  it('frames a start view inside the world', () => {
    expect(inside(world, map.view)).toBe(true);
  });

  it('has a collision grid that covers the background', () => {
    const raw = fields(json('maps/workshop.json'), '$');
    const rows = list(raw.collision, '$.collision');
    const background = map.scenery.find((item) => item.kind === 'image' && item.depth === null);
    expect(background?.kind === 'image' ? pngSize(background.image) : null).toEqual({
      width: map.width,
      height: map.height,
    });
    expect(rows).toHaveLength(map.height / map.tileSize);
  });

  it.each(map.stations.filter(({ id }) => id !== null).map((place) => [place.id, place] as const))(
    'draws the %s overlay exactly over the station in the background',
    (id, place) => {
      const manifest = manifests.get(id ?? '');
      const background = map.scenery.find((item) => item.kind === 'image');
      if (!manifest || background?.kind !== 'image') throw new Error('missing art');
      const sheet = decodePng(manifest.image);
      const scene = decodePng(background.image);
      const box = stationBox(place, { manifest, base: '' });
      let difference = 0;
      let opaque = 0;
      for (let y = 0; y < manifest.frame.height; y++) {
        for (let x = 0; x < manifest.frame.width; x++) {
          const from = pixel(sheet, manifest.origin.x + x, manifest.origin.y + y);
          if (from[3] !== 255) continue;
          const to = pixel(scene, box.x + x, box.y + y);
          difference += [0, 1, 2].reduce(
            (sum, channel) => sum + Math.abs((from[channel] ?? 0) - (to[channel] ?? 0)),
            0,
          );
          opaque++;
        }
      }
      expect(difference / opaque / 3).toBeLessThan(OVERLAY_TOLERANCE);
    },
  );

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

  it('cuts every foreground prop out of the background pixel for pixel', () => {
    const props = map.scenery.filter((item) => item.kind === 'image' && item.depth !== null);
    expect(props.length).toBeGreaterThan(100);
    const background = map.scenery.find((item) => item.kind === 'image' && item.depth === null);
    if (background?.kind !== 'image') throw new Error('missing background');
    const scene = decodePng(background.image);
    const sheets = new Map<string, Png>();
    for (const item of props) {
      if (item.kind !== 'image') continue;
      const sheet = sheets.get(item.image) ?? decodePng(item.image);
      sheets.set(item.image, sheet);
      expect(item.depth ?? 0).toBeGreaterThan(item.at.y);
      let mismatched = 0;
      let opaque = 0;
      for (let y = 0; y < item.source.height; y++) {
        for (let x = 0; x < item.source.width; x++) {
          const from = pixel(sheet, item.source.x + x, item.source.y + y);
          if (from[3] === 0) continue;
          opaque++;
          const to = pixel(scene, item.at.x + x, item.at.y + y);
          if ([0, 1, 2].some((channel) => from[channel] !== to[channel])) mismatched++;
        }
      }
      expect(opaque, JSON.stringify(item.at)).toBeGreaterThan(0);
      expect(mismatched, JSON.stringify(item.at)).toBe(0);
    }
  });

  it('keeps embers inside the world', () => {
    for (const ember of map.embers) expect(contains(world, ember)).toBe(true);
  });
});

describe('shipped workshop zones', () => {
  const map = parseWorkshopMap(json('maps/workshop.json'));
  const places = [
    ...map.stations.map(({ work }) => work),
    ...map.spots.map(({ at }) => at),
    ...map.wander,
    ...map.routes.flat(),
  ];

  function reachable(nav: NavGrid, start: Point, target: Point): boolean {
    const end = nav.nearest(target);
    if (Math.hypot(end.x - target.x, end.y - target.y) >= map.tileSize * 2) return false;
    const path = nav.route(start, end);
    return path.slice(1).every((point, index) => nav.clear(path[index] ?? point, point));
  }

  it('keeps every work point, spot, wander point, route and zone inside the house', () => {
    const { house } = map;
    expect(house).not.toBeNull();
    if (house === null) return;
    for (const place of places) expect(contains(house, place), JSON.stringify(place)).toBe(true);
    for (const { areas } of map.zones) {
      for (const { x, y, width, height } of areas) {
        expect(contains(house, { x, y }) && contains(house, { x: x + width, y: y + height })).toBe(
          true,
        );
      }
    }
  });

  it('gives every zone a sign point inside the zone', () => {
    for (const { id, areas, sign } of map.zones) {
      expect(sign, id).not.toBeNull();
      if (sign === null) continue;
      expect(
        areas.some((area) => contains(area, sign)),
        id,
      ).toBe(true);
    }
  });

  it('puts every work point, spot, wander point and route inside one zone', () => {
    expect(map.zones.length).toBeGreaterThan(1);
    for (const place of places) expect(zoneAt(map, place), JSON.stringify(place)).not.toBeNull();
    for (const route of map.routes) {
      expect(new Set(route.map((point) => zoneAt(map, point))).size, JSON.stringify(route)).toBe(1);
    }
  });

  it.each(map.zones.map((zone) => [zone.id, zone] as const))(
    '%s has a station and somewhere to idle, all reachable inside the zone',
    (id, zone) => {
      const inZone = (target: Point) => zoneAt(map, target) === id;
      const stations = map.stations.filter(({ work }) => inZone(work));
      const idle = [...map.spots.map(({ at }) => at), ...map.wander].filter(inZone);
      expect(stations.length).toBeGreaterThan(0);
      expect(idle.length).toBeGreaterThan(0);
      const nav = new NavGrid(map, NAV_CELL, zone.areas);
      const start = stations[0]?.work ?? { x: 0, y: 0 };
      for (const station of stations) expect(nav.walkable(station.work)).toBe(true);
      for (const target of places.filter(inZone)) {
        expect(reachable(nav, start, target), JSON.stringify(target)).toBe(true);
      }
    },
  );
});

describe('interface frames', () => {
  const styles = join(import.meta.dirname, '../styles');
  const used = readdirSync(styles)
    .filter((file) => file.endsWith('.css'))
    .flatMap((file) => [
      ...readFileSync(join(styles, file), 'utf8').matchAll(/url\('\/assets\/(ui\/[^']+)'\)/g),
    ])
    .map((match) => match[1] ?? '');

  it('ships every frame the stylesheets use', () => {
    expect(used.length).toBeGreaterThan(0);
    for (const path of used) expect(existsSync(join(ROOT, path)), path).toBe(true);
  });

  it('keeps the nine-slice frames at their pack size', () => {
    expect(pngSize('ui/slate-frame.png')).toEqual({ width: 28, height: 23 });
    expect(pngSize('ui/wood-button.png')).toEqual({ width: 28, height: 20 });
  });
});
