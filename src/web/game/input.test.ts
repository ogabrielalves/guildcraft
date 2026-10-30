// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { AgentView } from '../../shared/agent.js';
import { DRAG_THRESHOLD, bindInput, hitTest, selectMode, wheelFactor } from './input.js';
import { parseWorkshopMap, stationAt } from './map.js';
import { provisionalWorkshop } from './provisional-workshop.js';
import { World } from './world.js';

const map = parseWorkshopMap(provisionalWorkshop());

function agent(id: string): AgentView {
  return {
    id,
    name: id,
    cwd: '/',
    skin: id,
    status: 'thinking',
    permissionMode: 'default',
    tool: null,
    waitingFor: null,
    model: null,
    effort: null,
    queued: 0,
  };
}

function target(ids: string[]) {
  const world = new World(map, () => 0);
  world.sync(ids.map(agent));
  return world;
}

describe('hitTest', () => {
  it('hits a villager over its sprite box', () => {
    const work = stationAt(map, 0).work;
    expect(hitTest(target(['a']), { x: work.x, y: work.y - 10 })).toEqual({
      kind: 'villager',
      id: 'a',
    });
  });

  it('ignores stations, free or taken', () => {
    const hit = target(['a']);
    for (const index of [0, 5]) {
      const { at } = stationAt(map, index);
      expect(hitTest(hit, { x: at.x, y: at.y - 4 })).toBeNull();
    }
  });

  it('misses the empty floor and walls', () => {
    expect(hitTest(target([]), { x: 240, y: 220 })).toBeNull();
    expect(hitTest(target([]), { x: 240, y: 10 })).toBeNull();
  });

  it('picks the villager in front when two overlap', () => {
    const world = target(['a', 'b']);
    const [a, b] = world.all();
    if (!a || !b) throw new Error('missing villagers');
    a.position = { x: 50, y: 120 };
    b.position = { x: 52, y: 124 };
    expect(hitTest(world, { x: 51, y: 110 })).toEqual({ kind: 'villager', id: 'b' });
  });
});

describe('selectMode', () => {
  it.each([
    [{ shiftKey: false, ctrlKey: false, metaKey: false }, 'replace'],
    [{ shiftKey: true, ctrlKey: false, metaKey: false }, 'toggle'],
    [{ shiftKey: false, ctrlKey: true, metaKey: false }, 'toggle'],
    [{ shiftKey: false, ctrlKey: false, metaKey: true }, 'toggle'],
  ])('maps %j to %s', (modifiers, mode) => {
    expect(selectMode(modifiers)).toBe(mode);
  });
});

describe('bindInput', () => {
  function setup(hover: ReturnType<typeof hitTest>) {
    const canvas = document.createElement('canvas');
    const options = {
      canvas,
      toWorld: vi.fn((x: number, y: number) => ({ x: x / 2, y: y / 2 })),
      hit: vi.fn(() => hover),
      onSelect: vi.fn(),
      onHover: vi.fn(),
      onPan: vi.fn(),
      onZoom: vi.fn(),
    };
    const unbind = bindInput(options);
    return { canvas, options, unbind };
  }

  it('selects a clicked villager with the modifier mode', () => {
    const { canvas, options } = setup({ kind: 'villager', id: 'a' });
    canvas.dispatchEvent(new MouseEvent('click', { clientX: 20, clientY: 40, shiftKey: true }));
    expect(options.toWorld).toHaveBeenCalledWith(20, 40);
    expect(options.hit).toHaveBeenCalledWith({ x: 10, y: 20 });
    expect(options.onSelect).toHaveBeenCalledWith('a', 'toggle');
  });

  it('ignores clicks on nothing', () => {
    const { canvas, options } = setup(null);
    canvas.dispatchEvent(new MouseEvent('click'));
    expect(options.onSelect).not.toHaveBeenCalled();
  });

  it('reports hover and shows a pointer', () => {
    const { canvas, options } = setup({ kind: 'villager', id: 'a' });
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 4, clientY: 6 }));
    expect(options.onHover).toHaveBeenLastCalledWith({ kind: 'villager', id: 'a' }, 4, 6);
    expect(canvas.style.cursor).toBe('pointer');
    canvas.dispatchEvent(new MouseEvent('mouseleave', { clientX: 1, clientY: 2 }));
    expect(options.onHover).toHaveBeenLastCalledWith(null, 1, 2);
    expect(canvas.style.cursor).toBe('');
  });

  it('clears the pointer over nothing', () => {
    const { canvas } = setup(null);
    canvas.style.cursor = 'pointer';
    canvas.dispatchEvent(new MouseEvent('mousemove'));
    expect(canvas.style.cursor).toBe('');
  });

  it('pans while dragging the empty floor and skips the click after', () => {
    const { canvas, options } = setup(null);
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10, button: 0 }));
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 11, clientY: 11 }));
    expect(options.onPan).not.toHaveBeenCalled();
    canvas.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 10 + DRAG_THRESHOLD, clientY: 10 }),
    );
    expect(options.onPan).toHaveBeenLastCalledWith(DRAG_THRESHOLD, 0);
    expect(canvas.style.cursor).toBe('grabbing');
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 15 }));
    expect(options.onPan).toHaveBeenLastCalledWith(20 - 10 - DRAG_THRESHOLD, 5);
    expect(options.onHover).not.toHaveBeenCalled();
    canvas.dispatchEvent(new MouseEvent('mouseup'));
    expect(canvas.style.cursor).toBe('');
    options.hit.mockReturnValue({ kind: 'villager', id: 'a' });
    canvas.dispatchEvent(new MouseEvent('click'));
    expect(options.onSelect).not.toHaveBeenCalled();
    canvas.dispatchEvent(new MouseEvent('click'));
    expect(options.onSelect).toHaveBeenCalledWith('a', 'replace');
  });

  it('keeps a plain click after a press without movement', () => {
    const { canvas, options } = setup(null);
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    canvas.dispatchEvent(new MouseEvent('mouseup'));
    options.hit.mockReturnValue({ kind: 'villager', id: 'b' });
    canvas.dispatchEvent(new MouseEvent('click'));
    expect(options.onSelect).toHaveBeenCalledWith('b', 'replace');
  });

  it('does not drag from a villager or with another button', () => {
    const { canvas, options } = setup({ kind: 'villager', id: 'a' });
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 0 }));
    options.hit.mockReturnValue(null);
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 2 }));
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 0 }));
    expect(options.onPan).not.toHaveBeenCalled();
  });

  it('ends a drag when the pointer leaves', () => {
    const { canvas, options } = setup(null);
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 0 }));
    canvas.dispatchEvent(new MouseEvent('mouseleave'));
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 0 }));
    expect(options.onPan).toHaveBeenCalledTimes(1);
  });

  it('keeps the next click after a drag that left the canvas', () => {
    const { canvas, options } = setup(null);
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 0 }));
    canvas.dispatchEvent(new MouseEvent('mouseleave'));
    canvas.dispatchEvent(new MouseEvent('mouseup'));
    options.hit.mockReturnValue({ kind: 'villager', id: 'a' });
    canvas.dispatchEvent(new MouseEvent('click'));
    expect(options.onSelect).toHaveBeenCalledWith('a', 'replace');
  });

  it('zooms with the wheel around the pointer', () => {
    const { canvas, options } = setup(null);
    const event = new WheelEvent('wheel', { deltaY: -100, cancelable: true });
    Object.defineProperties(event, { clientX: { value: 7 }, clientY: { value: 9 } });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(options.onZoom).toHaveBeenCalledWith(7, 9, wheelFactor(-100));
  });

  it('stops listening when unbound', () => {
    const { canvas, options, unbind } = setup({ kind: 'villager', id: 'a' });
    unbind();
    canvas.dispatchEvent(new MouseEvent('click'));
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    canvas.dispatchEvent(new MouseEvent('mousemove'));
    canvas.dispatchEvent(new MouseEvent('mouseup'));
    canvas.dispatchEvent(new MouseEvent('mouseleave'));
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 10 }));
    expect(options.onSelect).not.toHaveBeenCalled();
    expect(options.onHover).not.toHaveBeenCalled();
    expect(options.onZoom).not.toHaveBeenCalled();
  });
});

describe('wheelFactor', () => {
  it('zooms in on a negative delta and out on a positive one', () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(0)).toBe(1);
    expect(wheelFactor(100) * wheelFactor(-100)).toBeCloseTo(1);
  });
});
