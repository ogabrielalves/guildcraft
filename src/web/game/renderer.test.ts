import { describe, expect, it, vi } from 'vitest';
import type { AgentStatus, AgentView } from '../../shared/agent.js';
import { Particles } from './draw/effects.js';
import { Lighting } from './draw/lighting.js';
import { recordingPaint } from './draw/recording-paint.js';
import { bayAt, parseWorkshopMap } from './map.js';
import { provisionalWorkshop } from './provisional-workshop.js';
import type { Scene } from './renderer.js';
import {
  HEARTH_RATE,
  PALETTE,
  STATION_RATE,
  drawScene,
  emittersFor,
  hearthPoint,
  lightsFor,
  manifestOf,
  villagerBounds,
  wallBottom,
  windowPoints,
} from './renderer.js';
import type { SpriteSheet } from './sprite-sheet.js';
import { LPC_MANIFEST } from './sprite-sheet.js';
import { LIGHTS } from './stations.js';
import { World } from './world.js';

const map = parseWorkshopMap(provisionalWorkshop());
const image = { tag: 'sheet' } as unknown as CanvasImageSource;
const sheet: SpriteSheet = { image, manifest: LPC_MANIFEST };

function agent(id: string, status: AgentStatus, skin = 'brom'): AgentView {
  return {
    id,
    name: id.toUpperCase(),
    cwd: '/',
    skin,
    status,
    permissionMode: 'default',
    tool: status === 'tool' ? { name: 'Bash', detail: 'npm test' } : null,
    queued: 0,
  };
}

function scene(agents: AgentView[], overrides: Partial<Scene> = {}): Scene {
  const world = new World(map, () => 0.5);
  world.sync(agents);
  return {
    world,
    agents: new Map(agents.map((a) => [a.id, a])),
    sprites: { get: (skin) => (skin === 'brom' ? sheet : null) },
    selected: new Set(),
    focused: null,
    hovered: null,
    time: 0,
    ...overrides,
  };
}

function render(target: Scene) {
  const ctx = recordingPaint();
  drawScene(ctx, target);
  return ctx;
}

function texts(target: Scene): unknown[] {
  return render(target)
    .named('fillText')
    .map((call) => call.args[0]);
}

describe('drawScene', () => {
  it('draws the empty workshop with a marker on every bay', () => {
    const ctx = render(scene([]));
    expect(ctx.calls[0]?.name).toBe('save');
    expect(ctx.calls.at(-1)?.name).toBe('restore');
    expect(ctx.named('drawImage')).toHaveLength(0);
    const markers = ctx.named('fillRect').filter((c) => c.fillStyle === PALETTE.empty);
    expect(markers).toHaveLength(16);
  });

  it('outlines the hovered empty bay', () => {
    const outline = render(scene([], { hovered: { kind: 'bay', bay: 3 } })).named('strokeRect');
    expect(outline).toHaveLength(1);
    expect(outline[0]?.args[0]).toBe(bayAt(map, 3).area.x + 4.5);
  });

  it('draws loaded sprites and nameplates', () => {
    const ctx = render(scene([agent('a', 'idle')]));
    expect(ctx.named('drawImage')[0]?.args[0]).toBe(image);
    expect(ctx.named('fillText').map((c) => c.args[0])).toEqual(['A']);
  });

  it('falls back to a plain body when the sheet is missing', () => {
    const ctx = render(scene([agent('a', 'idle', 'mortis')]));
    expect(ctx.named('drawImage')).toHaveLength(0);
    expect(ctx.named('fill').some((c) => String(c.fillStyle).startsWith('hsl('))).toBe(true);
  });

  it('greys out offline villagers', () => {
    expect(render(scene([agent('a', 'offline')])).named('drawImage')[0]?.globalAlpha).toBe(0.5);
  });

  it('paints the station top with its light while working', () => {
    const working = render(scene([agent('a', 'tool')])).named('fillRect');
    expect(working.some((c) => c.fillStyle === LIGHTS.yellow)).toBe(true);
    const idle = render(scene([agent('a', 'thinking')])).named('fillRect');
    expect(idle.some((c) => c.fillStyle === PALETTE.stationTop)).toBe(true);
  });

  it.each<[string, AgentStatus, Partial<Scene>, number]>([
    ['selected', 'idle', { selected: new Set(['a']) }, 1],
    ['focused', 'idle', { selected: new Set(['a']), focused: 'a' }, 1],
    ['hovered', 'idle', { hovered: { kind: 'villager', id: 'a' } }, 1],
    ['waiting', 'waiting', {}, 1],
    ['plain', 'idle', {}, 0],
  ])('rings a %s villager', (_, status, overrides, rings) => {
    expect(render(scene([agent('a', status)], overrides)).named('stroke')).toHaveLength(rings);
  });

  it('adds the activity bubble over the nameplate', () => {
    expect(texts(scene([agent('a', 'thinking')]))).toEqual(['A', '💭']);
    expect(texts(scene([agent('a', 'waiting')]))).toEqual(['A', '❗']);
  });

  it('shows the queue on the nameplate', () => {
    const queued = { ...agent('a', 'idle'), queued: 3 };
    expect(texts(scene([queued]))).toEqual(['A', '3']);
  });

  it('draws labels in depth order after the bodies', () => {
    const target = scene([agent('a', 'offline'), agent('b', 'thinking')]);
    const ctx = render(target);
    const names = ctx
      .named('fillText')
      .map((c) => c.args[0])
      .filter((text) => text === 'A' || text === 'B');
    expect(names).toEqual(target.world.byDepth().map((v) => v.id.toUpperCase()));
    const lastBody = ctx.calls.findLastIndex((c) => c.name === 'drawImage');
    const firstText = ctx.calls.findIndex((c) => c.name === 'fillText');
    expect(firstText).toBeGreaterThan(lastBody);
  });

  it('skips labels of a villager without agent data', () => {
    const target = scene([agent('a', 'idle')]);
    expect(render({ ...target, agents: new Map() }).named('fillText')).toHaveLength(0);
  });

  it('draws particles and light between bodies and labels', () => {
    const particles = new Particles(() => 0.5);
    particles.update(1, [{ key: 'k', kind: 'sparks', at: { x: 10, y: 10 }, rate: 1 }]);
    const layer = recordingPaint();
    const lighting = new Lighting(map.width, map.height, () => ({
      canvas: { width: map.width, height: map.height } as HTMLCanvasElement,
      ctx: layer,
    }));
    const draw = vi.spyOn(lighting, 'draw');
    const ctx = render(scene([agent('a', 'tool')], { particles, lighting }));
    expect(draw).toHaveBeenCalledTimes(1);
    const lit = ctx.calls.findIndex((c) => c.composite === 'lighter');
    expect(lit).toBeGreaterThan(ctx.calls.findIndex((c) => c.name === 'drawImage'));
    expect(lit).toBeLessThan(ctx.calls.findIndex((c) => c.name === 'fillText'));
  });
});

describe('emittersFor', () => {
  it('always burns the hearth and adds working stations', () => {
    const target = scene([
      agent('a', 'tool'),
      agent('b', 'thinking'),
      agent('c', 'tool', 'aldwin'),
    ]);
    expect(emittersFor(target)).toEqual([
      { key: 'hearth', kind: 'embers', at: hearthPoint(map), rate: HEARTH_RATE },
      {
        key: 'station:a',
        kind: 'sparks',
        at: { x: bayAt(map, 0).station.x, y: bayAt(map, 0).station.y - 8 },
        rate: STATION_RATE,
      },
      {
        key: 'station:c',
        kind: 'bubbles',
        at: { x: bayAt(map, 2).station.x, y: bayAt(map, 2).station.y - 8 },
        rate: STATION_RATE,
      },
    ]);
  });

  it('uses the default effect for unknown agents', () => {
    const target = scene([agent('a', 'tool')]);
    expect(emittersFor({ ...target, agents: new Map() })[1]?.kind).toBe('dust');
  });
});

describe('lightsFor', () => {
  it('lights the hearth, the windows and every station', () => {
    const lights = lightsFor(scene([agent('a', 'tool'), agent('b', 'idle', 'seren')]));
    expect(lights.map((l) => l.color)).toEqual([
      LIGHTS.hearth,
      LIGHTS.window,
      LIGHTS.window,
      LIGHTS.yellow,
      LIGHTS.orange,
    ]);
    expect(lights[3]).toMatchObject({ radius: 56, flicker: 0.05 });
    expect(lights[4]).toMatchObject({ radius: 24 });
    expect(lights[4]).not.toHaveProperty('flicker');
  });
});

describe('geometry', () => {
  it('finds the wall, hearth and windows', () => {
    expect(wallBottom(map)).toBe(80);
    expect(hearthPoint(map)).toEqual({ x: 240, y: 72 });
    expect(windowPoints(map)).toEqual([
      { x: 40, y: 36 },
      { x: 440, y: 36 },
    ]);
  });

  it('places the sprite box over the feet', () => {
    const world = new World(map);
    world.sync([agent('a', 'thinking')]);
    const villager = world.villager('a');
    if (!villager) throw new Error('missing villager');
    const work = bayAt(map, 0).work;
    expect(villagerBounds(villager, manifestOf(null))).toEqual({
      x: work.x - 16,
      y: work.y - 30,
      width: 32,
      height: 32,
    });
    expect(manifestOf(sheet)).toBe(LPC_MANIFEST);
  });
});
