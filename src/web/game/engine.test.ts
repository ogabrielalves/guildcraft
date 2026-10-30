import { describe, expect, it, vi } from 'vitest';
import { Engine, MAX_FRAME_TIME, MAX_ZOOM, fitView, screenToWorld } from './engine.js';

describe('fitView', () => {
  it('fills the screen and centers the world', () => {
    expect(fitView({ width: 960, height: 480 }, { width: 480, height: 272 })).toEqual({
      scale: 2,
      x: 0,
      y: -32,
    });
  });

  it('crops at most a little and letterboxes the rest', () => {
    const view = fitView({ width: 2400, height: 544 }, { width: 480, height: 272 });
    expect(view.scale).toBeCloseTo(2 * MAX_ZOOM);
    expect(view.x).toBeGreaterThan(0);
    expect(view.y).toBeLessThan(0);
  });

  it('never scales below one', () => {
    expect(fitView({ width: 200, height: 100 }, { width: 480, height: 272 })).toEqual({
      scale: 1,
      x: -140,
      y: -86,
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
});
