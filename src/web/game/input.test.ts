// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { AgentView } from '../../shared/agent.js';
import { bindInput, hitTest, selectMode } from './input.js';
import { bayAt, parseWorkshopMap } from './map.js';
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
    queued: 0,
  };
}

function target(ids: string[]) {
  const world = new World(map);
  world.sync(ids.map(agent));
  return world;
}

describe('hitTest', () => {
  it('hits a villager over its sprite box', () => {
    const work = bayAt(map, 0).work;
    expect(hitTest(target(['a']), { x: work.x, y: work.y - 10 })).toEqual({
      kind: 'villager',
      id: 'a',
    });
  });

  it('hits an empty bay but not an occupied one', () => {
    const hit = target(['a']);
    expect(hitTest(hit, { x: bayAt(map, 0).area.x + 2, y: bayAt(map, 0).area.y + 2 })).toBeNull();
    expect(hitTest(hit, { x: bayAt(map, 5).area.x + 2, y: bayAt(map, 5).area.y + 2 })).toEqual({
      kind: 'bay',
      bay: 5,
    });
  });

  it('misses the corridor and walls', () => {
    expect(hitTest(target([]), { x: 240, y: 160 })).toBeNull();
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
      onRecruit: vi.fn(),
      onHover: vi.fn(),
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
    expect(options.onRecruit).not.toHaveBeenCalled();
  });

  it('recruits on a click over an empty bay', () => {
    const { canvas, options } = setup({ kind: 'bay', bay: 4 });
    canvas.dispatchEvent(new MouseEvent('click'));
    expect(options.onRecruit).toHaveBeenCalledWith(4);
    expect(options.onSelect).not.toHaveBeenCalled();
  });

  it('ignores clicks on nothing', () => {
    const { canvas, options } = setup(null);
    canvas.dispatchEvent(new MouseEvent('click'));
    expect(options.onRecruit).not.toHaveBeenCalled();
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

  it('stops listening when unbound', () => {
    const { canvas, options, unbind } = setup({ kind: 'bay', bay: 1 });
    unbind();
    canvas.dispatchEvent(new MouseEvent('click'));
    canvas.dispatchEvent(new MouseEvent('mousemove'));
    canvas.dispatchEvent(new MouseEvent('mouseleave'));
    expect(options.onRecruit).not.toHaveBeenCalled();
    expect(options.onHover).not.toHaveBeenCalled();
  });
});
