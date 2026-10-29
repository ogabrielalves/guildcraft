import { MAX_AGENTS } from '../../shared/constants.js';
import type { FetchLike } from '../net/api.js';
import type { Light } from './draw/lighting.js';
import type { Point, Rect, Size } from './parse.js';
import {
  AssetError,
  color,
  fetchJson,
  fields,
  finite,
  imagePath,
  list,
  optional,
  point,
  positive,
  rect,
  size,
} from './parse.js';

export type { Point, Rect, Size } from './parse.js';

export const BAY_POINTS = ['door', 'station', 'work', 'read', 'nap', 'guest'] as const;
export type BayPoint = (typeof BAY_POINTS)[number];

export type Bay = Record<BayPoint, Point> & { area: Rect };

export type Scenery =
  | { kind: 'image'; image: string; source: Rect; at: Point; repeat: Size | null; flip: boolean }
  | { kind: 'fill'; color: string; area: Rect };

export interface WorkshopMap {
  width: number;
  height: number;
  tileSize: number;
  corridorY: number;
  floor: string;
  bays: Bay[];
  scenery: Scenery[];
  lights: Light[];
  embers: Point[];
}

export const DEFAULT_FLOOR = '#6b4a2f';

export function contains(area: Rect, target: Point): boolean {
  return (
    target.x >= area.x &&
    target.x <= area.x + area.width &&
    target.y >= area.y &&
    target.y <= area.y + area.height
  );
}

function parseBay(value: unknown, path: string): Bay {
  const raw = fields(value, path);
  const area = rect(raw.area, `${path}.area`);
  const bay = { area } as Bay;
  for (const name of BAY_POINTS) {
    const spot = point(raw[name], `${path}.${name}`);
    if (!contains(area, spot)) throw new AssetError(`${path}.${name}`);
    bay[name] = spot;
  }
  return bay;
}

function flag(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new AssetError(path);
  return value;
}

function parseScenery(value: unknown, path: string): Scenery {
  const raw = fields(value, path);
  if (raw.color !== undefined) {
    return {
      kind: 'fill',
      color: color(raw.color, `${path}.color`),
      area: rect(raw.area, `${path}.area`),
    };
  }
  return {
    kind: 'image',
    image: imagePath(raw.image, `${path}.image`),
    source: rect(raw.source, `${path}.source`),
    at: point(raw.at, `${path}.at`),
    repeat: optional<Size | null>(raw.repeat, size, `${path}.repeat`, null),
    flip: optional(raw.flip, flag, `${path}.flip`, false),
  };
}

function parseLight(value: unknown, path: string): Light {
  const raw = fields(value, path);
  const light: Light = {
    at: point(raw.at, `${path}.at`),
    radius: positive(raw.radius, `${path}.radius`),
    color: color(raw.color, `${path}.color`),
  };
  if (raw.flicker !== undefined) light.flicker = positive(raw.flicker, `${path}.flicker`);
  return light;
}

function each<T>(value: unknown, path: string, parse: (item: unknown, path: string) => T): T[] {
  return list(value ?? [], path).map((item, index) => parse(item, `${path}[${String(index)}]`));
}

export function parseWorkshopMap(value: unknown): WorkshopMap {
  const raw = fields(value, '$');
  const width = positive(raw.width, '$.width');
  const height = positive(raw.height, '$.height');
  const tileSize = positive(raw.tileSize, '$.tileSize');
  const corridorY = finite(raw.corridorY, '$.corridorY');
  if (corridorY < 0 || corridorY > height) throw new AssetError('$.corridorY');
  if (!Array.isArray(raw.bays) || raw.bays.length !== MAX_AGENTS) throw new AssetError('$.bays');
  const bays = each(raw.bays, '$.bays', parseBay);
  bays.forEach(({ area }, index) => {
    if (area.x < 0 || area.y < 0 || area.x + area.width > width || area.y + area.height > height) {
      throw new AssetError(`$.bays[${String(index)}].area`);
    }
  });
  return {
    width,
    height,
    tileSize,
    corridorY,
    floor: optional(raw.floor, color, '$.floor', DEFAULT_FLOOR),
    bays,
    scenery: each(raw.scenery, '$.scenery', parseScenery),
    lights: each(raw.lights, '$.lights', parseLight),
    embers: each(raw.embers, '$.embers', point),
  };
}

export async function loadWorkshopMap(url: string, request: FetchLike): Promise<WorkshopMap> {
  return parseWorkshopMap(await fetchJson(url, request));
}

export function bayAt(map: WorkshopMap, index: number): Bay {
  const bay = map.bays[index];
  if (bay === undefined) throw new RangeError(`unknown bay ${String(index)}`);
  return bay;
}

export const WANDER_MARGIN = { side: 16, top: 20, bottom: 8 };

export function wanderPoint(bay: Bay, random: () => number = Math.random): Point {
  const { x, y, width, height } = bay.area;
  const { side, top, bottom } = WANDER_MARGIN;
  return {
    x: x + side + random() * (width - 2 * side),
    y: y + top + random() * (height - top - bottom),
  };
}
