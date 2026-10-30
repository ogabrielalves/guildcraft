import type { Point, Size } from './parse.js';
import {
  AssetError,
  count,
  fields,
  imagePath,
  optional,
  point,
  positive,
  size,
  text,
} from './parse.js';

export const DIRECTIONS = ['north', 'west', 'south', 'east'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const POSES = ['idle', 'walk', 'work', 'sit', 'cheer'] as const;
export type Pose = (typeof POSES)[number];

export const FACINGS = ['four', 'side'] as const;
export type Facing = (typeof FACINGS)[number];

export interface Animation {
  image: string;
  frame: Size;
  anchor: Point;
  row: number;
  start: number;
  frames: number;
  fps: number;
  hop: number;
}

export interface CharacterManifest {
  name: Partial<Record<string, string>>;
  station: string | null;
  facing: Facing;
  animations: Record<Pose, Animation>;
}

export interface Frame {
  image: string;
  sx: number;
  sy: number;
  width: number;
  height: number;
  anchor: Point;
  flip: boolean;
  lift: number;
}

function facingOf(value: unknown, path: string): Facing {
  const found = FACINGS.find((facing) => facing === value);
  if (found === undefined) throw new AssetError(path);
  return found;
}

function names(value: unknown, path: string): Partial<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(fields(value, path)).map(([locale, name]) => [
      locale,
      text(name, `${path}.${locale}`),
    ]),
  );
}

function parseAnimation(value: unknown, path: string, defaults: Partial<Animation>): Animation {
  const raw = fields(value, path);
  const image = raw.image ?? defaults.image;
  const frame = raw.frame ?? defaults.frame;
  const anchor = raw.anchor ?? defaults.anchor;
  return {
    image: imagePath(image, `${path}.image`),
    frame: size(frame, `${path}.frame`),
    anchor: point(anchor, `${path}.anchor`),
    row: optional(raw.row, count, `${path}.row`, 0),
    start: optional(raw.start, count, `${path}.start`, 0),
    frames: count(raw.frames, `${path}.frames`, 1),
    fps: positive(raw.fps, `${path}.fps`),
    hop: optional(raw.hop, count, `${path}.hop`, 0),
  };
}

export function parseCharacterManifest(value: unknown): CharacterManifest {
  const raw = fields(value, '$');
  const animations = fields(raw.animations, '$.animations');
  const defaults: Partial<Animation> = {};
  if (raw.image !== undefined) defaults.image = imagePath(raw.image, '$.image');
  if (raw.frame !== undefined) defaults.frame = size(raw.frame, '$.frame');
  if (raw.anchor !== undefined) defaults.anchor = point(raw.anchor, '$.anchor');
  const parsed = {} as Record<Pose, Animation>;
  for (const pose of POSES) {
    parsed[pose] = parseAnimation(animations[pose], `$.animations.${pose}`, defaults);
  }
  return {
    name: optional(raw.name, names, '$.name', {}),
    station: optional<string | null>(raw.station, text, '$.station', null),
    facing: facingOf(raw.facing, '$.facing'),
    animations: parsed,
  };
}

export function frameAt(
  manifest: CharacterManifest,
  pose: Pose,
  direction: Direction,
  side: 'east' | 'west',
  time: number,
): Frame {
  const animation = manifest.animations[pose];
  const { width, height } = animation.frame;
  const clock = Math.max(0, time);
  const step = Math.floor(clock * animation.fps) % animation.frames;
  const four = manifest.facing === 'four';
  const row = animation.row + (four ? DIRECTIONS.indexOf(direction) : 0);
  return {
    image: animation.image,
    sx: (animation.start + step) * width,
    sy: row * height,
    width,
    height,
    anchor: animation.anchor,
    flip: !four && side === 'west',
    lift: Math.round(Math.abs(Math.sin(clock * Math.PI * 2)) * animation.hop),
  };
}

export function directionTo(dx: number, dy: number, fallback: Direction): Direction {
  if (dx === 0 && dy === 0) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'east' : 'west';
  return dy > 0 ? 'south' : 'north';
}

export function loadImage(url: string): Promise<CanvasImageSource> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      reject(new Error(`failed to load ${url}`));
    };
    image.src = url;
  });
}
