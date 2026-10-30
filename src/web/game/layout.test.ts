import { describe, expect, it } from 'vitest';
import { Layout } from './layout.js';
import { parseWorkshopMap } from './map.js';
import { provisionalWorkshop } from './provisional-workshop.js';

const map = parseWorkshopMap(provisionalWorkshop());

describe('Layout', () => {
  it('builds the nav grid from the obstacles', () => {
    const layout = new Layout(map);
    expect(layout.nav.walkable({ x: 10, y: 10 })).toBe(false);
    expect(layout.nav.walkable({ x: 10, y: 200 })).toBe(true);
  });

  it('hands out free spots of a kind and remembers who holds them', () => {
    const layout = new Layout(map);
    const first = layout.claim('nap', 'a', () => 0);
    const second = layout.claim('nap', 'b', () => 0);
    expect(first?.at).toEqual({ x: 440, y: 280 });
    expect(second?.at).toEqual({ x: 440, y: 320 });
    expect(layout.claim('nap', 'c')).toBeNull();
    if (first) expect(layout.holder(first)).toBe('a');
  });

  it('tells whether a spot of a kind is still free', () => {
    const layout = new Layout(map);
    expect(layout.hasFree('nap')).toBe(true);
    layout.claim('nap', 'a');
    layout.claim('nap', 'b');
    expect(layout.hasFree('nap')).toBe(false);
    expect(layout.hasFree('hearth')).toBe(true);
    layout.claim('hearth', 'c');
    expect(layout.hasFree('hearth')).toBe(false);
  });

  it('frees the previous spot of the same owner', () => {
    const layout = new Layout(map);
    const nap = layout.claim('nap', 'a', () => 0);
    layout.claim('read', 'a', () => 0);
    if (nap) expect(layout.holder(nap)).toBeNull();
    layout.release('a');
    expect(layout.claim('read', 'b', () => 0)?.at).toEqual({ x: 440, y: 120 });
  });
});
