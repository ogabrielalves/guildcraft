import { MAX_AGENTS } from '../../shared/constants.js';
import type { FetchLike } from '../net/api.js';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const BAY_POINTS = ['door', 'station', 'work', 'read', 'nap', 'guest'] as const;
export type BayPoint = (typeof BAY_POINTS)[number];

export type Bay = Record<BayPoint, Point> & { area: Rect };

export interface WorkshopMap {
  width: number;
  height: number;
  tileSize: number;
  corridorY: number;
  bays: Bay[];
}

export class MapError extends Error {
  constructor(readonly path: string) {
    super(`invalid workshop map at ${path}`);
    this.name = 'MapError';
  }
}

type Fields = Partial<Record<string, unknown>>;

function fields(value: unknown, path: string): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MapError(path);
  }
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new MapError(path);
  return value;
}

function positive(value: unknown, path: string): number {
  const number = finite(value, path);
  if (number <= 0) throw new MapError(path);
  return number;
}

function parsePoint(value: unknown, path: string): Point {
  const { x, y } = fields(value, path);
  return { x: finite(x, `${path}.x`), y: finite(y, `${path}.y`) };
}

function parseRect(value: unknown, path: string): Rect {
  const { x, y, width, height } = fields(value, path);
  return {
    x: finite(x, `${path}.x`),
    y: finite(y, `${path}.y`),
    width: positive(width, `${path}.width`),
    height: positive(height, `${path}.height`),
  };
}

export function contains(area: Rect, point: Point): boolean {
  return (
    point.x >= area.x &&
    point.x <= area.x + area.width &&
    point.y >= area.y &&
    point.y <= area.y + area.height
  );
}

function parseBay(value: unknown, path: string): Bay {
  const raw = fields(value, path);
  const area = parseRect(raw.area, `${path}.area`);
  const bay = { area } as Bay;
  for (const name of BAY_POINTS) {
    const point = parsePoint(raw[name], `${path}.${name}`);
    if (!contains(area, point)) throw new MapError(`${path}.${name}`);
    bay[name] = point;
  }
  return bay;
}

export function parseWorkshopMap(value: unknown): WorkshopMap {
  const raw = fields(value, '$');
  const width = positive(raw.width, '$.width');
  const height = positive(raw.height, '$.height');
  const tileSize = positive(raw.tileSize, '$.tileSize');
  const corridorY = finite(raw.corridorY, '$.corridorY');
  if (corridorY < 0 || corridorY > height) throw new MapError('$.corridorY');
  if (!Array.isArray(raw.bays) || raw.bays.length !== MAX_AGENTS) throw new MapError('$.bays');
  const bays = raw.bays.map((bay, index) => parseBay(bay, `$.bays[${String(index)}]`));
  bays.forEach(({ area }, index) => {
    if (area.x < 0 || area.y < 0 || area.x + area.width > width || area.y + area.height > height) {
      throw new MapError(`$.bays[${String(index)}].area`);
    }
  });
  return { width, height, tileSize, corridorY, bays };
}

export async function loadWorkshopMap(url: string, request: FetchLike): Promise<WorkshopMap> {
  const response = await request(url);
  if (!response.ok) throw new MapError(url);
  return parseWorkshopMap(await response.json());
}

export function bayAt(map: WorkshopMap, index: number): Bay {
  const bay = map.bays[index];
  if (bay === undefined) throw new RangeError(`unknown bay ${String(index)}`);
  return bay;
}

export const WANDER_MARGIN = { side: 12, top: 20, bottom: 8 };

export function wanderPoint(bay: Bay, random: () => number = Math.random): Point {
  const { x, y, width, height } = bay.area;
  const { side, top, bottom } = WANDER_MARGIN;
  return {
    x: x + side + random() * (width - 2 * side),
    y: y + top + random() * (height - top - bottom),
  };
}
