// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentView, VillageEvent } from '../../shared/agent.js';
import type { ServerMessage } from '../../shared/protocol.js';
import { Store } from '../state/store.js';
import { NO_ASSETS } from './assets.js';
import { createGame } from './game.js';
import { parseWorkshopMap, stationAt } from './map.js';
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
    waitingFor: null,
    model: null,
    effort: null,
    queued: 0,
  };
}

function setup(agents: AgentView[] = []) {
  const store = new Store();
  store.apply({ type: 'session:init', agents, events: [], skins: ['brom'], permissions: [] });
  const callbacks: FrameRequestCallback[] = [];
  const onHover = vi.fn();
  const listeners = new Set<(message: ServerMessage) => void>();
  const socket = {
    onMessage: (listener: (message: ServerMessage) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const emit = (message: ServerMessage) => {
    for (const listener of listeners) listener(message);
  };
  const game = createGame({
    store,
    socket,
    map,
    assets: NO_ASSETS,
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
  return { store, game, callbacks, onHover, emit, listeners };
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
    const { store, game } = setup([agent('a', 'tool')]);
    const finished: VillageEvent = { kind: 'finished', agentId: 'a', at: 4000 };
    store.apply({ type: 'event', event: finished });
    expect(game.world.villager('a')?.pose).toBe('cheer');
    game.world.update(5);
    store.focus('a');
    expect(game.world.villager('a')?.pose).toBe('work');
  });

  it('sends the sender to the recipient with the note', () => {
    const { game, emit } = setup([agent('a'), agent('b')]);
    emit({ type: 'agent:visit', fromId: 'a', toId: 'b', preview: 'run the tests' });
    expect(game.world.villager('a')?.note).toBe('run the tests');
    emit({ type: 'agent:removed', agentId: 'b' });
    expect(game.world.villager('b')).toBeDefined();
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

  it('selects villagers and ignores stations', () => {
    const { store, game, onHover } = setup([agent('a')]);
    game.start();
    const work = game.world.villager('a')?.position ?? { x: 0, y: 0 };
    game.element.dispatchEvent(new MouseEvent('click', at(work.x, work.y - 8)));
    expect(store.getState().selected).toEqual(['a']);
    const free = stationAt(map, 2).at;
    game.element.dispatchEvent(new MouseEvent('mousemove', at(free.x, free.y - 4)));
    expect(onHover).toHaveBeenLastCalledWith(null, free.x, free.y - 4);
    game.element.dispatchEvent(new MouseEvent('click', at(free.x, free.y - 4)));
    expect(store.getState().selected).toEqual(['a']);
  });

  it('zooms with the wheel and pans by dragging the floor', () => {
    const { game } = setup();
    game.start();
    const wheel = new WheelEvent('wheel', { deltaY: -400, cancelable: true });
    Object.defineProperties(wheel, { clientX: { value: 0 }, clientY: { value: 0 } });
    game.element.dispatchEvent(wheel);
    const zoomed = game.engine.view;
    expect(zoomed.scale).toBeGreaterThan(1);
    expect([zoomed.x, zoomed.y]).toEqual([0, 0]);
    game.element.dispatchEvent(new MouseEvent('mousedown', { ...at(200, 220), button: 0 }));
    game.element.dispatchEvent(new MouseEvent('mousemove', at(150, 200)));
    game.element.dispatchEvent(new MouseEvent('mouseup'));
    expect(game.engine.view.x).toBe(-50);
    expect(game.engine.view.y).toBe(-20);
  });

  it('stops everything on destroy', () => {
    const { store, game, listeners } = setup([agent('a')]);
    game.start();
    game.destroy();
    expect(listeners.size).toBe(0);
    expect(game.engine.running).toBe(false);
    expect(game.element.isConnected).toBe(false);
    store.apply({ type: 'agent:updated', agent: agent('b') });
    expect(game.world.villager('b')).toBeUndefined();
    const work = game.world.villager('a')?.position ?? { x: 0, y: 0 };
    game.element.dispatchEvent(new MouseEvent('click', at(work.x, work.y - 8)));
    expect(store.getState().selected).toEqual([]);
  });
});
