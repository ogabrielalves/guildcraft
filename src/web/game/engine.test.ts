import { describe, expect, it, vi } from 'vitest';
import {
  CAMERA_ZOOM,
  Engine,
  MAX_FRAME_TIME,
  MAX_ZOOM,
  clampView,
  fitView,
  panView,
  scaleLimits,
  screenToWorld,
  zoomView,
} from './engine.js';

describe('fitView', () => {
  it('fills the screen and crops the top of a taller world', () => {
    expect(fitView({ width: 960, height: 480 }, { width: 480, height: 272 })).toEqual({
      scale: 2,
      x: 0,
      y: -64,
    });
  });

  it('crops at most a little and letterboxes the rest', () => {
    const view = fitView({ width: 2400, height: 544 }, { width: 480, height: 272 });
    expect(view.scale).toBeCloseTo(2 * MAX_ZOOM);
    expect(view.x).toBeGreaterThan(0);
    expect(view.y).toBeLessThan(0);
  });

  it('centers a world that fits the height and crops the sides', () => {
    const view = fitView({ width: 960, height: 700 }, { width: 480, height: 272 });
    expect(view.scale).toBeCloseTo(2 * MAX_ZOOM);
    expect(view.x).toBe(-72);
    expect(view.y).toBe(37);
  });

  it('never scales below one', () => {
    expect(fitView({ width: 200, height: 100 }, { width: 480, height: 272 })).toEqual({
      scale: 1,
      x: -140,
      y: -172,
    });
  });
});

describe('screenToWorld', () => {
  it('undoes the view transform', () => {
    expect(screenToWorld({ scale: 2, x: 20, y: 28 }, { x: 120, y: 48 })).toEqual({
      x: 50,
      y: 10,
    });
  });
});

describe('camera', () => {
  const screen = { width: 200, height: 100 };
  const world = { width: 100, height: 100 };

  it('zooms between the whole world and a few times the fitted view', () => {
    expect(scaleLimits(screen, world)).toEqual({ min: 1, max: MAX_ZOOM * CAMERA_ZOOM });
    expect(scaleLimits({ width: 100, height: 100 }, world)).toEqual({ min: 1, max: CAMERA_ZOOM });
  });

  it('centers an axis the world does not fill and clamps the other', () => {
    expect(clampView({ scale: 1, x: 30, y: 7 }, screen, world)).toEqual({ scale: 1, x: 50, y: 0 });
    expect(clampView({ scale: 3, x: 30, y: -500 }, screen, world)).toEqual({
      scale: 3,
      x: 0,
      y: -200,
    });
    expect(clampView({ scale: 0.1, x: 0, y: 0 }, screen, world).scale).toBe(1);
  });

  it('zooms around a fixed screen point', () => {
    const view = zoomView({ scale: 2, x: 0, y: -50 }, screen, world, { x: 100, y: 50 }, 1.5);
    expect(view.scale).toBe(3);
    expect(screenToWorld(view, { x: 100, y: 50 })).toEqual({ x: 50, y: 50 });
    expect(zoomView(view, screen, world, { x: 0, y: 0 }, 100).scale).toBe(MAX_ZOOM * CAMERA_ZOOM);
  });

  it('pans inside the world edges', () => {
    expect(panView({ scale: 3, x: -50, y: -50 }, screen, world, 20, -10)).toEqual({
      scale: 3,
      x: -30,
      y: -60,
    });
    expect(panView({ scale: 3, x: -50, y: -50 }, screen, world, 500, -500)).toEqual({
      scale: 3,
      x: 0,
      y: -200,
    });
  });
});

function setup(context: Partial<CanvasRenderingContext2D> | null = {}) {
  const callbacks: FrameRequestCallback[] = [];
  const ctx = {
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: '',
    imageSmoothingEnabled: true,
    ...context,
  };
  const canvas = {
    clientWidth: 500,
    clientHeight: 300,
    width: 0,
    height: 0,
    getContext: () => (context === null ? null : ctx),
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
  } as unknown as HTMLCanvasElement;
  const draw = vi.fn();
  const cancelFrame = vi.fn();
  const engine = new Engine({
    canvas,
    world: { width: 500, height: 300 },
    background: '#000',
    draw,
    requestFrame: (callback) => callbacks.push(callback),
    cancelFrame,
    pixelRatio: () => 2,
  });
  const frame = (time: number) => {
    const callback = callbacks.shift();
    if (!callback) throw new Error('no frame requested');
    callback(time);
  };
  return { engine, canvas, ctx, draw, cancelFrame, callbacks, frame };
}

describe('Engine', () => {
  it('sizes the canvas in device pixels on start', () => {
    const { engine, canvas } = setup();
    engine.start();
    expect(canvas.width).toBe(1000);
    expect(canvas.height).toBe(600);
    expect(engine.view).toEqual({ scale: 2, x: 0, y: 0 });
    expect(engine.running).toBe(true);
  });

  it('draws each frame with the elapsed time, capped', () => {
    const { engine, ctx, draw, frame } = setup();
    engine.start();
    frame(1000);
    expect(draw).toHaveBeenLastCalledWith(ctx, 0, 1);
    frame(1050);
    expect(draw.mock.lastCall?.[1]).toBeCloseTo(0.05);
    frame(5000);
    expect(draw.mock.lastCall?.[1]).toBe(MAX_FRAME_TIME);
    expect(ctx.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
    expect(ctx.imageSmoothingEnabled).toBe(false);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1000, 600);
  });

  it('skips drawing without a 2d context', () => {
    const { engine, draw, frame } = setup(null);
    engine.start();
    frame(0);
    expect(draw).not.toHaveBeenCalled();
  });

  it('starts once and stops the loop', () => {
    const { engine, callbacks, cancelFrame } = setup();
    engine.start();
    engine.start();
    expect(callbacks).toHaveLength(1);
    engine.stop();
    expect(cancelFrame).toHaveBeenCalledWith(1);
    expect(engine.running).toBe(false);
    engine.stop();
    expect(cancelFrame).toHaveBeenCalledTimes(1);
  });

  it('maps client coordinates to the world', () => {
    const { engine } = setup();
    engine.start();
    expect(engine.toWorld(70, 54)).toEqual({ x: 60, y: 34 });
  });

  it('zooms toward the pointer and pans in client pixels', () => {
    const { engine } = setup();
    engine.start();
    engine.zoomAt(60, 50, 2);
    expect(engine.view).toEqual({ scale: 4, x: -100, y: -60 });
    expect(engine.toWorld(60, 50)).toEqual({ x: 50, y: 30 });
    engine.panBy(10, 5);
    expect(engine.view).toEqual({ scale: 4, x: -80, y: -50 });
    engine.panBy(100, 100);
    expect(engine.view).toEqual({ scale: 4, x: 0, y: 0 });
  });

  it('keeps the zoom and the focus when the canvas resizes', () => {
    const { engine, canvas } = setup();
    engine.start();
    engine.zoomAt(60, 50, 2);
    engine.panBy(10, 5);
    Object.assign(canvas, { clientWidth: 250 });
    engine.resize();
    expect(engine.view.scale).toBeCloseTo(2.3);
    expect(engine.view.x).toBe(-83);
    expect(engine.view.y).toBe(0);
  });
});
