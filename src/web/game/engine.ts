import type { Point, Rect } from './map.js';

export const MAX_FRAME_TIME = 0.1;
export const MAX_ZOOM = 1.15;
export const CAMERA_ZOOM = 3;
export const FOCUS_ZOOM = 2;
export const FLIGHT_SECONDS = 0.6;

export interface View {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Stage extends Size {
  view?: Rect;
}

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  world: Stage;
  background: string;
  draw(ctx: CanvasRenderingContext2D, dt: number, time: number): void;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  pixelRatio?: () => number;
}

export function fitView(screen: Size, world: Stage): View {
  const area = world.view ?? { x: 0, y: 0, width: world.width, height: world.height };
  const ratios = [screen.width / area.width, screen.height / area.height];
  const scale = Math.max(1, Math.min(Math.max(...ratios), Math.min(...ratios) * MAX_ZOOM));
  return {
    scale,
    x: axis(
      screen.width / 2 - (area.x + area.width / 2) * scale,
      screen.width,
      world.width * scale,
    ),
    y: axis(
      screen.height / 2 - (area.y + area.height / 2) * scale,
      screen.height,
      world.height * scale,
    ),
  };
}

export function screenToWorld(view: View, point: Point): Point {
  return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
}

export function scaleLimits(screen: Size, world: Size): { min: number; max: number } {
  const fit = fitView(screen, world).scale;
  const contain = Math.min(screen.width / world.width, screen.height / world.height);
  return { min: Math.min(contain, fit), max: fit * CAMERA_ZOOM };
}

function axis(offset: number, screen: number, span: number): number {
  if (span <= screen) return Math.round((screen - span) / 2);
  return Math.round(Math.min(0, Math.max(screen - span, offset)));
}

export function clampView(view: View, screen: Size, world: Size): View {
  const { min, max } = scaleLimits(screen, world);
  const scale = Math.min(max, Math.max(min, view.scale));
  return {
    scale,
    x: axis(view.x, screen.width, world.width * scale),
    y: axis(view.y, screen.height, world.height * scale),
  };
}

export function zoomView(view: View, screen: Size, world: Size, at: Point, factor: number): View {
  const { min, max } = scaleLimits(screen, world);
  const scale = Math.min(max, Math.max(min, view.scale * factor));
  const anchor = screenToWorld(view, at);
  return clampView(
    { scale, x: at.x - anchor.x * scale, y: at.y - anchor.y * scale },
    screen,
    world,
  );
}

export function focusView(screen: Size, world: Stage, target: Point, scale: number): View {
  return clampView(
    { scale, x: screen.width / 2 - target.x * scale, y: screen.height / 2 - target.y * scale },
    screen,
    world,
  );
}

export function blendView(from: View, to: View, ratio: number, screen: Size, world: Stage): View {
  const middle = { x: screen.width / 2, y: screen.height / 2 };
  const start = screenToWorld(from, middle);
  const end = screenToWorld(to, middle);
  const scale = from.scale + (to.scale - from.scale) * ratio;
  const center = {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
  };
  return focusView(screen, world, center, scale);
}

export function easeOut(ratio: number): number {
  const clamped = Math.min(1, Math.max(0, ratio));
  return 1 - (1 - clamped) ** 3;
}

export function panView(view: View, screen: Size, world: Size, dx: number, dy: number): View {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, screen, world);
}

export class Engine {
  private handle: number | null = null;
  private last: number | null = null;
  private viewNow: View = { scale: 1, x: 0, y: 0 };
  private camera: { zoom: number; focus: Point } | null = null;
  private flight: { from: View; to: View; elapsed: number } | null = null;
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
    const fit = fitView(canvas, world);
    if (this.camera === null) {
      this.viewNow = fit;
      return;
    }
    const { zoom, focus } = this.camera;
    const scale = fit.scale * zoom;
    this.viewNow = clampView(
      { scale, x: canvas.width / 2 - focus.x * scale, y: canvas.height / 2 - focus.y * scale },
      canvas,
      world,
    );
  }

  flyTo(target: Point): void {
    const { canvas, world } = this.options;
    const scale = Math.max(this.viewNow.scale, fitView(canvas, world).scale * FOCUS_ZOOM);
    const to = focusView(canvas, world, target, scale);
    this.flight = { from: this.viewNow, to, elapsed: 0 };
  }

  get flying(): boolean {
    return this.flight !== null;
  }

  zoomAt(clientX: number, clientY: number, factor: number): void {
    this.flight = null;
    const { canvas, world } = this.options;
    this.moveCamera(zoomView(this.viewNow, canvas, world, this.toScreen(clientX, clientY), factor));
  }

  panBy(dx: number, dy: number): void {
    this.flight = null;
    const { canvas, world } = this.options;
    const ratio = this.pixelRatio();
    this.moveCamera(panView(this.viewNow, canvas, world, dx * ratio, dy * ratio));
  }

  toWorld(clientX: number, clientY: number): Point {
    return screenToWorld(this.viewNow, this.toScreen(clientX, clientY));
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

  private toScreen(clientX: number, clientY: number): Point {
    const rect = this.options.canvas.getBoundingClientRect();
    const ratio = this.pixelRatio();
    return { x: (clientX - rect.left) * ratio, y: (clientY - rect.top) * ratio };
  }

  private moveCamera(view: View): void {
    const { canvas, world } = this.options;
    this.viewNow = view;
    this.camera = {
      zoom: view.scale / fitView(canvas, world).scale,
      focus: screenToWorld(view, { x: canvas.width / 2, y: canvas.height / 2 }),
    };
  }

  private readonly tick = (now: number): void => {
    const dt = this.last === null ? 0 : Math.min(MAX_FRAME_TIME, (now - this.last) / 1000);
    this.last = now;
    this.render(dt, now / 1000);
    this.handle = this.requestFrame(this.tick);
  };

  private fly(dt: number): void {
    const flight = this.flight;
    if (flight === null) return;
    const { canvas, world } = this.options;
    flight.elapsed += dt;
    const ratio = Math.min(1, flight.elapsed / FLIGHT_SECONDS);
    this.moveCamera(blendView(flight.from, flight.to, easeOut(ratio), canvas, world));
    if (ratio >= 1) this.flight = null;
  }

  private render(dt: number, time: number): void {
    this.fly(dt);
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
