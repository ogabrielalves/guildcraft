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
import type { Effect } from './stations.js';
import { EFFECTS } from './stations.js';

export type { Point, Rect, Size } from './parse.js';

export const SPOT_KINDS = ['read', 'nap', 'hearth', 'table', 'bench'] as const;
export type SpotKind = (typeof SPOT_KINDS)[number];

export interface StationPlace {
  id: string | null;
  effect: Effect | null;
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

export interface Zone {
  id: string;
  areas: Rect[];
  sign: Point | null;
  common: boolean;
}

export interface WorkshopMap {
  width: number;
  height: number;
  tileSize: number;
  floor: string;
  stations: StationPlace[];
  obstacles: Rect[];
  spots: Spot[];
  wander: Point[];
  routes: Point[][];
  entrance: Point | null;
  view: Rect;
  house: Rect | null;
  zones: Zone[];
  scenery: Scenery[];
  embers: Point[];
}

export const DEFAULT_FLOOR = '#6b4a2f';
const COLLISION_ROW = /^[#.]+$/;

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
  const id = optional<string | null>(raw.id, text, `${path}.id`, null);
  const effect = optional<Effect | null>(raw.effect, oneOf(EFFECTS), `${path}.effect`, null);
  if (id === null && effect === null) throw new AssetError(`${path}.id`);
  return { id, effect, at: point(raw.at, `${path}.at`), work: point(raw.work, `${path}.work`) };
}

function parseZone(value: unknown, path: string): Zone {
  const raw = fields(value, path);
  const areas = each(raw.areas, `${path}.areas`, rect);
  if (areas.length === 0) throw new AssetError(`${path}.areas`);
  const sign = optional<Point | null>(raw.sign, point, `${path}.sign`, null);
  const common = optional(raw.common, flag, `${path}.common`, false);
  return { id: text(raw.id, `${path}.id`), areas, sign, common };
}

function parseRoute(value: unknown, path: string): Point[] {
  const route = each(value, path, point);
  if (route.length < 2) throw new AssetError(path);
  return route;
}

function parseCollision(value: unknown, columns: number, rows: number, tile: number): Rect[] {
  const lines = list(value, '$.collision');
  if (lines.length !== rows) throw new AssetError('$.collision');
  return lines.flatMap((line, row) => {
    const path = `$.collision[${String(row)}]`;
    if (typeof line !== 'string' || !COLLISION_ROW.test(line) || line.length !== columns) {
      throw new AssetError(path);
    }
    return [...line.matchAll(/#+/g)].map((run) => ({
      x: run.index * tile,
      y: row * tile,
      width: run[0].length * tile,
      height: tile,
    }));
  });
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
  const wander = each(raw.wander, '$.wander', point);
  wander.forEach((at, index) => {
    inside(at, `$.wander[${String(index)}]`);
  });
  const routes = each(raw.routes, '$.routes', parseRoute);
  routes.forEach((route, index) => {
    route.forEach((at, step) => {
      inside(at, `$.routes[${String(index)}][${String(step)}]`);
    });
  });
  const entrance = optional<Point | null>(raw.entrance, point, '$.entrance', null);
  if (entrance !== null) inside(entrance, '$.entrance');
  const view = optional(raw.view, rect, '$.view', bounds);
  inside(view, '$.view');
  inside({ x: view.x + view.width, y: view.y + view.height }, '$.view');
  const house = optional<Rect | null>(raw.house, rect, '$.house', null);
  if (house !== null) {
    inside(house, '$.house');
    inside({ x: house.x + house.width, y: house.y + house.height }, '$.house');
  }
  const zones = each(raw.zones, '$.zones', parseZone);
  zones.forEach(({ id, areas, sign }, index) => {
    const path = `$.zones[${String(index)}]`;
    if (zones.findIndex((zone) => zone.id === id) !== index) throw new AssetError(`${path}.id`);
    areas.forEach((area, step) => {
      const at = `${path}.areas[${String(step)}]`;
      inside(area, at);
      inside({ x: area.x + area.width, y: area.y + area.height }, at);
    });
    if (sign !== null) inside(sign, `${path}.sign`);
  });
  if (house !== null) {
    const indoors = (target: Point, path: string) => {
      if (!contains(house, target)) throw new AssetError(path);
    };
    stations.forEach(({ at, work }, index) => {
      indoors(at, `$.stations[${String(index)}].at`);
      indoors(work, `$.stations[${String(index)}].work`);
    });
    spots.forEach(({ kind, at }, index) => {
      if (kind !== 'bench') indoors(at, `$.spots[${String(index)}].at`);
    });
    wander.forEach((at, index) => {
      indoors(at, `$.wander[${String(index)}]`);
    });
    routes.forEach((route, index) => {
      route.forEach((at, step) => {
        indoors(at, `$.routes[${String(index)}][${String(step)}]`);
      });
    });
    zones.forEach(({ areas }, index) => {
      areas.forEach(({ x, y, width: w, height: h }, step) => {
        const path = `$.zones[${String(index)}].areas[${String(step)}]`;
        indoors({ x, y }, path);
        indoors({ x: x + w, y: y + h }, path);
      });
    });
  }
  const tileSize = positive(raw.tileSize, '$.tileSize');
  const collision =
    raw.collision === undefined
      ? []
      : parseCollision(
          raw.collision,
          Math.ceil(width / tileSize),
          Math.ceil(height / tileSize),
          tileSize,
        );
  return {
    width,
    height,
    tileSize,
    floor: optional(raw.floor, color, '$.floor', DEFAULT_FLOOR),
    stations,
    obstacles: [...each(raw.obstacles, '$.obstacles', rect), ...collision],
    spots,
    wander,
    routes,
    entrance,
    view,
    house,
    zones,
    scenery: each(raw.scenery, '$.scenery', parseScenery),
    embers: each(raw.embers, '$.embers', point),
  };
}

export async function loadWorkshopMap(url: string, request: FetchLike): Promise<WorkshopMap> {
  return parseWorkshopMap(await fetchJson(url, request));
}

export function zoneAt(map: Pick<WorkshopMap, 'zones'>, target: Point): string | null {
  return map.zones.find(({ areas }) => areas.some((area) => contains(area, target)))?.id ?? null;
}

export function stationAt(map: WorkshopMap, index: number): StationPlace {
  const station = map.stations[index];
  if (station === undefined) throw new RangeError(`unknown station ${String(index)}`);
  return station;
}
