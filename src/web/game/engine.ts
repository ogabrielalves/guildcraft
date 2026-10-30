import type { Point } from './map.js';

export const MAX_FRAME_TIME = 0.1;
export const MAX_ZOOM = 1.15;

export interface View {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  world: Size;
  background: string;
  draw(ctx: CanvasRenderingContext2D, dt: number, time: number): void;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  pixelRatio?: () => number;
}

export function fitView(screen: Size, world: Size): View {
  const ratios = [screen.width / world.width, screen.height / world.height];
  const contain = Math.min(...ratios);
  const cover = Math.max(...ratios);
  const scale = Math.max(1, Math.min(cover, contain * MAX_ZOOM));
  return {
    scale,
    x: Math.floor((screen.width - world.width * scale) / 2),
    y: Math.floor((screen.height - world.height * scale) / 2),
  };
}

export function screenToWorld(view: View, point: Point): Point {
  return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
}

export class Engine {
  private handle: number | null = null;
  private last: number | null = null;
  private viewNow: View = { scale: 1, x: 0, y: 0 };
  private readonly requestFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly pixelRatio: () => number;

  constructor(private readonly options: EngineOptions) {
    this.requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
    this.cancelFrame =
      options.cancelFrame ??
      ((handle) => {
        cancelAnimationFrame(handle);
      });
    this.pixelRatio = options.pixelRatio ?? (() => window.devicePixelRatio || 1);
  }

  get view(): View {
    return this.viewNow;
  }

  get running(): boolean {
    return this.handle !== null;
  }

  resize(): void {
    const { canvas, world } = this.options;
    const ratio = this.pixelRatio();
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    this.viewNow = fitView(canvas, world);
  }

  toWorld(clientX: number, clientY: number): Point {
    const rect = this.options.canvas.getBoundingClientRect();
    const ratio = this.pixelRatio();
    return screenToWorld(this.viewNow, {
      x: (clientX - rect.left) * ratio,
      y: (clientY - rect.top) * ratio,
    });
  }

  start(): void {
    if (this.handle !== null) return;
    this.resize();
    this.handle = this.requestFrame(this.tick);
  }

  stop(): void {
    if (this.handle !== null) this.cancelFrame(this.handle);
    this.handle = null;
    this.last = null;
  }

  private readonly tick = (now: number): void => {
    const dt = this.last === null ? 0 : Math.min(MAX_FRAME_TIME, (now - this.last) / 1000);
    this.last = now;
    this.render(dt, now / 1000);
    this.handle = this.requestFrame(this.tick);
  };

  private render(dt: number, time: number): void {
    const { canvas, background } = this.options;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { scale, x, y } = this.viewNow;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, x, y);
    this.options.draw(ctx, dt, time);
  }
}
