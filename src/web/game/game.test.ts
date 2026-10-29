// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentView, VillageEvent } from '../../shared/agent.js';
import { Store } from '../state/store.js';
import { createGame } from './game.js';
import { bayAt, parseWorkshopMap } from './map.js';
import { provisionalWorkshop } from './provisional-workshop.js';

const map = parseWorkshopMap(provisionalWorkshop());

function agent(id: string, status: AgentView['status'] = 'thinking'): AgentView {
  return {
    id,
    name: id,
    cwd: '/',
    skin: 'brom',
    status,
    permissionMode: 'default',
    tool: null,
    queued: 0,
  };
}

function setup(agents: AgentView[] = []) {
  const store = new Store();
  store.apply({ type: 'session:init', agents, events: [], skins: ['brom'] });
  const callbacks: FrameRequestCallback[] = [];
  const onRecruit = vi.fn();
  const onHover = vi.fn();
  const game = createGame({
    store,
    map,
    sprites: { get: () => null },
    onRecruit,
    onHover,
    now: () => 5000,
    random: () => 0.5,
    frames: {
      requestFrame: (callback) => callbacks.push(callback),
      cancelFrame: vi.fn(),
      pixelRatio: () => 1,
    },
  });
  Object.defineProperty(game.element, 'clientWidth', { value: map.width });
  Object.defineProperty(game.element, 'clientHeight', { value: map.height });
  document.body.append(game.element);
  return { store, game, callbacks, onRecruit, onHover };
}

function at(x: number, y: number) {
  return { clientX: x, clientY: y };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('createGame', () => {
  it('creates villagers for the agents already in the store', () => {
    const { game } = setup([agent('a'), agent('b')]);
    expect(game.element.tagName).toBe('CANVAS');
    expect(game.world.all().map((v) => v.id)).toEqual(['a', 'b']);
  });

  it('follows agents joining, changing and leaving', () => {
    const { store, game } = setup([agent('a')]);
    store.apply({ type: 'agent:updated', agent: agent('b') });
    store.apply({ type: 'agent:updated', agent: agent('a', 'offline') });
    expect(game.world.villager('a')?.activity).toBe('off');
    store.apply({ type: 'agent:removed', agentId: 'b' });
    expect(game.world.villager('b')).toBeUndefined();
  });

  it('reacts only to new events', () => {
    const { store, game } = setup([agent('a'), agent('b')]);
    const messaged: VillageEvent = { kind: 'messaged', agentId: 'a', targetId: 'b', at: 4000 };
    store.apply({ type: 'event', event: messaged });
    expect(game.world.villager('a')?.visiting).toBe(true);
    store.focus('a');
    expect(game.world.villager('a')?.visiting).toBe(true);
  });

  it('runs the loop and draws the scene', () => {
    const { store, game, callbacks } = setup([agent('a')]);
    const drawn: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_, key) =>
          key === 'measureText'
            ? () => ({ width: 10 })
            : (...args: unknown[]) => {
                if (key === 'fillText') drawn.push(String(args[0]));
              },
        set: () => true,
      },
    );
    game.element.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
    store.select('a');
    game.start();
    expect(callbacks).toHaveLength(1);
    callbacks.shift()?.(16);
    expect(drawn).toEqual(['a', '💭']);
    expect(callbacks).toHaveLength(1);
  });

  it('selects villagers and recruits on empty bays', () => {
    const { store, game, onRecruit, onHover } = setup([agent('a')]);
    game.start();
    const work = bayAt(map, 0).work;
    game.element.dispatchEvent(new MouseEvent('click', at(work.x, work.y - 8)));
    expect(store.getState().selected).toEqual(['a']);
    const empty = bayAt(map, 6).area;
    game.element.dispatchEvent(new MouseEvent('mousemove', at(empty.x + 2, empty.y + 2)));
    expect(onHover).toHaveBeenLastCalledWith({ kind: 'bay', bay: 6 }, empty.x + 2, empty.y + 2);
    game.element.dispatchEvent(new MouseEvent('click', at(empty.x + 2, empty.y + 2)));
    expect(onRecruit).toHaveBeenCalledWith(6);
  });

  it('stops everything on destroy', () => {
    const { store, game, onRecruit } = setup([agent('a')]);
    game.start();
    game.destroy();
    expect(game.engine.running).toBe(false);
    expect(game.element.isConnected).toBe(false);
    store.apply({ type: 'agent:updated', agent: agent('b') });
    expect(game.world.villager('b')).toBeUndefined();
    game.element.dispatchEvent(new MouseEvent('click', at(2, 90)));
    expect(onRecruit).not.toHaveBeenCalled();
  });
});
