import type { AgentView } from '../../shared/agent.js';
import type { GameSocket } from '../net/socket.js';
import type { Store } from '../state/store.js';
import type { Assets } from './assets.js';
import { Particles } from './draw/effects.js';
import type { EngineOptions } from './engine.js';
import { Engine } from './engine.js';
import { bindInput, hitTest } from './input.js';
import type { WorkshopMap } from './map.js';
import type { Hover } from './renderer.js';
import { drawScene, emittersFor } from './renderer.js';
import { World } from './world.js';

export const STAGE_BACKGROUND = '#17110d';

export interface GameOptions {
  store: Store;
  socket: Pick<GameSocket, 'onMessage'>;
  map: WorkshopMap;
  assets: Assets;
  onRecruit(bay: number): void;
  onHover?(hover: Hover, clientX: number, clientY: number): void;
  now?: () => number;
  random?: () => number;
  frames?: Pick<EngineOptions, 'requestFrame' | 'cancelFrame' | 'pixelRatio'>;
}

export interface Game {
  readonly element: HTMLCanvasElement;
  readonly world: World;
  readonly engine: Engine;
  start(): void;
  destroy(): void;
}

export function createGame(options: GameOptions): Game {
  const { store, map, assets } = options;
  const now = options.now ?? (() => Date.now());
  const canvas = document.createElement('canvas');
  canvas.className = 'game';
  const world = new World(map, options.random);
  let agents = new Map<string, AgentView>();
  let hovered: Hover = null;
  const particles = new Particles(options.random);

  const syncAgents = (list: readonly AgentView[]) => {
    agents = new Map(list.map((agent) => [agent.id, agent]));
    world.sync(list);
  };
  syncAgents(store.getState().agents);

  const engine = new Engine({
    ...options.frames,
    canvas,
    world: map,
    background: STAGE_BACKGROUND,
    draw(ctx, dt, time) {
      world.update(dt);
      particles.update(dt, emittersFor({ world, agents, assets }));
      const { selected, focused } = store.getState();
      drawScene(ctx, {
        world,
        agents,
        assets,
        selected: new Set(selected),
        focused,
        hovered,
        time,
        particles,
      });
    },
  });

  const unsubscribe = store.subscribe((state, previous) => {
    if (state.agents !== previous.agents) syncAgents(state.agents);
    if (state.events === previous.events) return;
    const seen = new Set(previous.events);
    for (const event of state.events) {
      if (!seen.has(event)) world.handle(event, now());
    }
  });

  const unsubscribeSocket = options.socket.onMessage((message) => {
    if (message.type === 'agent:visit') world.visit(message.fromId, message.toId, message.preview);
  });

  const unbindInput = bindInput({
    canvas,
    toWorld: (x, y) => engine.toWorld(x, y),
    hit: (point) => hitTest(world, point),
    onSelect(agentId, mode) {
      store.select(agentId, mode);
    },
    onRecruit(bay) {
      options.onRecruit(bay);
    },
    onHover(hover, clientX, clientY) {
      hovered = hover;
      options.onHover?.(hover, clientX, clientY);
    },
  });

  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          engine.resize();
        });

  return {
    element: canvas,
    world,
    engine,
    start() {
      observer?.observe(canvas);
      engine.start();
    },
    destroy() {
      observer?.disconnect();
      engine.stop();
      unbindInput();
      unsubscribe();
      unsubscribeSocket();
      canvas.remove();
    },
  };
}
