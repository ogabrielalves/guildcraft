import type { Point, Size } from './parse.js';
import {
  AssetError,
  color,
  count,
  fields,
  imagePath,
  optional,
  point,
  positive,
  size,
} from './parse.js';

export const EFFECTS = [
  'bubbles',
  'sparks',
  'magic',
  'smoke',
  'dust',
  'embers',
  'sawdust',
  'paper',
] as const;
export type Effect = (typeof EFFECTS)[number];

export interface StationManifest {
  image: string;
  origin: Point;
  frame: Size;
  cell: Size;
  columns: number;
  frames: number;
  fps: number;
  anchor: Point;
  emit: Point;
  effect: Effect;
  light: string;
}

export interface StationFrame {
  sx: number;
  sy: number;
  width: number;
  height: number;
}

export const DEFAULT_EFFECT: Effect = 'dust';
export const DEFAULT_LIGHT = '#ffd76a';

function effectOf(value: unknown, path: string): Effect {
  const found = EFFECTS.find((effect) => effect === value);
  if (found === undefined) throw new AssetError(path);
  return found;
}

export function parseStationManifest(value: unknown): StationManifest {
  const raw = fields(value, '$');
  const frame = size(raw.frame, '$.frame');
  const frames = optional(raw.frames, (v, p) => count(v, p, 1), '$.frames', 1);
  return {
    image: imagePath(raw.image, '$.image'),
    origin: optional(raw.origin, point, '$.origin', { x: 0, y: 0 }),
    frame,
    cell: optional(raw.cell, size, '$.cell', frame),
    columns: optional(raw.columns, (v, p) => count(v, p, 1), '$.columns', frames),
    frames,
    fps: optional(raw.fps, positive, '$.fps', 1),
    anchor: point(raw.anchor, '$.anchor'),
    emit: optional(raw.emit, point, '$.emit', { x: frame.width / 2, y: 0 }),
    effect: effectOf(raw.effect, '$.effect'),
    light: color(raw.light, '$.light'),
  };
}

export function stationFrame(
  manifest: StationManifest,
  active: boolean,
  time: number,
): StationFrame {
  const { origin, frame, cell, columns, frames, fps } = manifest;
  const index = active ? Math.floor(Math.max(0, time) * fps) % frames : 0;
  return {
    sx: origin.x + (index % columns) * cell.width,
    sy: origin.y + Math.floor(index / columns) * cell.height,
    width: frame.width,
    height: frame.height,
  };
}
