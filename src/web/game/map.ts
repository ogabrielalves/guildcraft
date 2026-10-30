import { MAX_AGENTS } from '../../shared/constants.js';
import type { FetchLike } from '../net/api.js';
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
  text,
} from './parse.js';
import type { Direction } from './sprite-sheet.js';
import { DIRECTIONS } from './sprite-sheet.js';

export type { Point, Rect, Size } from './parse.js';

export const SPOT_KINDS = ['read', 'nap', 'hearth', 'table'] as const;
export type SpotKind = (typeof SPOT_KINDS)[number];

export interface StationPlace {
  id: string;
  at: Point;
  work: Point;
}

export interface Spot {
  kind: SpotKind;
  at: Point;
  facing: Direction;
}

export type Scenery = (
  | { kind: 'image'; image: string; source: Rect; at: Point; repeat: Size | null; flip: boolean }
  | { kind: 'fill'; color: string; area: Rect }
) & { depth: number | null };

export interface WorkshopMap {
  width: number;
  height: number;
  tileSize: number;
  floor: string;
  stations: StationPlace[];
  obstacles: Rect[];
  spots: Spot[];
  scenery: Scenery[];
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

function flag(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new AssetError(path);
  return value;
}

function oneOf<T extends string>(options: readonly T[]) {
  return (value: unknown, path: string): T => {
    const found = options.find((option) => option === value);
    if (found === undefined) throw new AssetError(path);
    return found;
  };
}

function parseScenery(value: unknown, path: string): Scenery {
  const raw = fields(value, path);
  const depth = optional<number | null>(raw.depth, finite, `${path}.depth`, null);
  if (raw.color !== undefined) {
    return {
      kind: 'fill',
      color: color(raw.color, `${path}.color`),
      area: rect(raw.area, `${path}.area`),
      depth,
    };
  }
  return {
    kind: 'image',
    image: imagePath(raw.image, `${path}.image`),
    source: rect(raw.source, `${path}.source`),
    at: point(raw.at, `${path}.at`),
    repeat: optional<Size | null>(raw.repeat, size, `${path}.repeat`, null),
    flip: optional(raw.flip, flag, `${path}.flip`, false),
    depth,
  };
}

function parseStation(value: unknown, path: string): StationPlace {
  const raw = fields(value, path);
  return {
    id: text(raw.id, `${path}.id`),
    at: point(raw.at, `${path}.at`),
    work: point(raw.work, `${path}.work`),
  };
}

function parseSpot(value: unknown, path: string): Spot {
  const raw = fields(value, path);
  return {
    kind: oneOf(SPOT_KINDS)(raw.kind, `${path}.kind`),
    at: point(raw.at, `${path}.at`),
    facing: optional(raw.facing, oneOf(DIRECTIONS), `${path}.facing`, 'south'),
  };
}

function each<T>(value: unknown, path: string, parse: (item: unknown, path: string) => T): T[] {
  return list(value ?? [], path).map((item, index) => parse(item, `${path}[${String(index)}]`));
}

export function parseWorkshopMap(value: unknown): WorkshopMap {
  const raw = fields(value, '$');
  const width = positive(raw.width, '$.width');
  const height = positive(raw.height, '$.height');
  const bounds = { x: 0, y: 0, width, height };
  const inside = (target: Point, path: string) => {
    if (!contains(bounds, target)) throw new AssetError(path);
  };
  const stations = each(raw.stations, '$.stations', parseStation);
  if (stations.length < MAX_AGENTS) throw new AssetError('$.stations');
  stations.forEach(({ at, work }, index) => {
    inside(at, `$.stations[${String(index)}].at`);
    inside(work, `$.stations[${String(index)}].work`);
  });
  const spots = each(raw.spots, '$.spots', parseSpot);
  spots.forEach(({ at }, index) => {
    inside(at, `$.spots[${String(index)}].at`);
  });
  return {
    width,
    height,
    tileSize: positive(raw.tileSize, '$.tileSize'),
    floor: optional(raw.floor, color, '$.floor', DEFAULT_FLOOR),
    stations,
    obstacles: each(raw.obstacles, '$.obstacles', rect),
    spots,
    scenery: each(raw.scenery, '$.scenery', parseScenery),
    embers: each(raw.embers, '$.embers', point),
  };
}

export async function loadWorkshopMap(url: string, request: FetchLike): Promise<WorkshopMap> {
  return parseWorkshopMap(await fetchJson(url, request));
}

export function stationAt(map: WorkshopMap, index: number): StationPlace {
  const station = map.stations[index];
  if (station === undefined) throw new RangeError(`unknown station ${String(index)}`);
  return station;
}
