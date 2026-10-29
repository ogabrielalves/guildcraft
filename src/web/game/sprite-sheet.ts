export const DIRECTIONS = ['north', 'west', 'south', 'east'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const POSES = ['idle', 'walk', 'work', 'sit', 'cheer'] as const;
export type Pose = (typeof POSES)[number];

export interface Animation {
  row: number;
  start: number;
  frames: number;
  fps: number;
  directional: boolean;
}

export interface CharacterManifest {
  frame: { width: number; height: number };
  anchor: { x: number; y: number };
  animations: Record<Pose, Animation>;
}

export interface Frame {
  sx: number;
  sy: number;
  width: number;
  height: number;
}

export interface SpriteSheet {
  image: CanvasImageSource;
  manifest: CharacterManifest;
}

export type ImageLoader = (url: string) => Promise<CanvasImageSource>;

function lpc(row: number, start: number, frames: number, fps: number): Animation {
  return { row, start, frames, fps, directional: true };
}

export const LPC_MANIFEST: CharacterManifest = {
  frame: { width: 32, height: 32 },
  anchor: { x: 16, y: 30 },
  animations: {
    idle: lpc(22, 0, 2, 2),
    walk: lpc(8, 1, 8, 10),
    work: lpc(0, 0, 7, 8),
    sit: lpc(30, 1, 1, 1),
    cheer: lpc(34, 2, 1, 1),
  },
};

export function characterUrl(skin: string): string {
  return `/assets/characters/lpc/${encodeURIComponent(skin)}.png`;
}

export function frameAt(
  manifest: CharacterManifest,
  pose: Pose,
  direction: Direction,
  time: number,
): Frame {
  const animation = manifest.animations[pose];
  const { width, height } = manifest.frame;
  const step = Math.floor(Math.max(0, time) * animation.fps) % animation.frames;
  const row = animation.row + (animation.directional ? DIRECTIONS.indexOf(direction) : 0);
  return { sx: (animation.start + step) * width, sy: row * height, width, height };
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

export class SpriteLibrary {
  private readonly sheets = new Map<string, SpriteSheet | null>();

  constructor(
    private readonly load: ImageLoader,
    private readonly manifest: CharacterManifest = LPC_MANIFEST,
  ) {}

  get(skin: string): SpriteSheet | null {
    if (!this.sheets.has(skin)) {
      this.sheets.set(skin, null);
      this.load(characterUrl(skin)).then(
        (image) => {
          this.sheets.set(skin, { image, manifest: this.manifest });
        },
        () => undefined,
      );
    }
    return this.sheets.get(skin) ?? null;
  }
}
