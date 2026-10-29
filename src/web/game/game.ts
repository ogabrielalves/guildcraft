import type { AgentView } from '../../shared/agent.js';
import type { GameSocket } from '../net/socket.js';
import type { Store } from '../state/store.js';
import { Particles } from './draw/effects.js';
import type { LayerFactory } from './draw/lighting.js';
import { Lighting } from './draw/lighting.js';
import type { EngineOptions } from './engine.js';
import { Engine } from './engine.js';
import { bindInput, hitTest } from './input.js';
import type { WorkshopMap } from './map.js';
import type { Hover } from './renderer.js';
import { drawScene, emittersFor } from './renderer.js';
import type { SpriteSheet } from './sprite-sheet.js';
import { World } from './world.js';

export const STAGE_BACKGROUND = '#17110d';

export interface GameOptions {
  store: Store;
  socket: Pick<GameSocket, 'onMessage'>;
  map: WorkshopMap;
  sprites: { get(skin: string): SpriteSheet | null };
  onRecruit(bay: number): void;
  onHover?(hover: Hover, clientX: number, clientY: number): void;
  now?: () => number;
  random?: () => number;
  frames?: Pick<EngineOptions, 'requestFrame' | 'cancelFrame' | 'pixelRatio'>;
  lightLayer?: LayerFactory;
}

export interface Game {
  readonly element: HTMLCanvasElement;
  readonly world: World;
  readonly engine: Engine;
  start(): void;
  destroy(): void;
}

export function createGame(options: GameOptions): Game {
  const { store, map, sprites } = options;
  const now = options.now ?? (() => Date.now());
  const canvas = document.createElement('canvas');
  canvas.className = 'game';
  const world = new World(map, options.random);
  let agents = new Map<string, AgentView>();
  let hovered: Hover = null;
  const particles = new Particles(options.random);
  const lighting = new Lighting(map.width, map.height, options.lightLayer);

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
      particles.update(dt, emittersFor({ world, agents }));
      const { selected, focused } = store.getState();
      drawScene(ctx, {
        world,
        agents,
        sprites,
        selected: new Set(selected),
        focused,
        hovered,
        time,
        particles,
        lighting,
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
    hit: (point) => hitTest({ world, sprites, skinOf: (id) => agents.get(id)?.skin }, point),
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
