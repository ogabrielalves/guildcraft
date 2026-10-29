import { describe, expect, it, vi } from 'vitest';
import type { AgentStatus, AgentView } from '../../shared/agent.js';
import { Particles } from './draw/effects.js';
import { Lighting } from './draw/lighting.js';
import { recordingPaint } from './draw/recording-paint.js';
import type { FakeImage } from './fake-assets.js';
import { SIDE_CHARACTER, STOVE, fakeAssets } from './fake-assets.js';
import { bayAt, parseWorkshopMap } from './map.js';
import { provisionalWorkshop } from './provisional-workshop.js';
import type { Scene } from './renderer.js';
import {
  BODY,
  HEARTH_RATE,
  PALETTE,
  STATION_LIGHT,
  STATION_RATE,
  drawScene,
  emittersFor,
  lightsFor,
  stationFor,
  villagerBounds,
} from './renderer.js';
import { DEFAULT_EFFECT, DEFAULT_LIGHT } from './stations.js';
import { World } from './world.js';

const map = parseWorkshopMap({
  ...provisionalWorkshop(),
  floor: '#123456',
  scenery: [
    { color: '#1d1410', area: { x: 0, y: 0, width: 480, height: 24 } },
    {
      image: 'tiles/walls.png',
      source: { x: 16, y: 32, width: 16, height: 48 },
      at: { x: 0, y: 32 },
      repeat: { width: 40, height: 48 },
    },
    {
      image: 'tiles/props.png',
      source: { x: 1, y: 2, width: 20, height: 26 },
      at: { x: 100, y: 200 },
      flip: true,
    },
  ],
  lights: [{ at: { x: 240, y: 74 }, radius: 96, color: '#ff9a3c', flicker: 0.08 }],
  embers: [{ x: 240, y: 72 }],
});

const assets = fakeAssets({ mortis: SIDE_CHARACTER }, { stove: STOVE });

function agent(id: string, status: AgentStatus, skin = 'mortis'): AgentView {
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
    assets,
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

function imageUrl(arg: unknown): string {
  return (arg as FakeImage).url;
}

function drawnImages(target: Scene): string[] {
  return render(target)
    .named('drawImage')
    .map((call) => imageUrl(call.args[0]));
}

function texts(target: Scene): unknown[] {
  return render(target)
    .named('fillText')
    .map((call) => call.args[0]);
}

describe('drawScene scenery', () => {
  it('fills the floor and draws fills, tiles and flipped props', () => {
    const ctx = render(scene([]));
    expect(ctx.calls[0]?.name).toBe('save');
    expect(ctx.calls.at(-1)?.name).toBe('restore');
    expect(ctx.named('fillRect')[0]).toMatchObject({
      fillStyle: '#123456',
      args: [0, 0, 480, 272],
    });
    expect(ctx.named('fillRect')[1]).toMatchObject({ fillStyle: '#1d1410', args: [0, 0, 480, 24] });
    const draws = ctx.named('drawImage');
    expect(draws.slice(0, 3).map((c) => c.args)).toEqual([
      [expect.anything(), 16, 32, 16, 48, 0, 32, 16, 48],
      [expect.anything(), 16, 32, 16, 48, 16, 32, 16, 48],
      [expect.anything(), 16, 32, 8, 48, 32, 32, 8, 48],
    ]);
    expect(imageUrl(draws[0]?.args[0])).toBe('/assets/tiles/walls.png');
    expect(draws[3]?.args).toEqual([expect.anything(), 1, 2, 20, 26, 0, 0, 20, 26]);
    expect(ctx.named('translate')[0]?.args).toEqual([120, 200]);
    expect(ctx.named('scale')[0]?.args).toEqual([-1, 1]);
  });

  it('tiles partial rows at the bottom of a repeat area', () => {
    const tall = parseWorkshopMap({
      ...provisionalWorkshop(),
      scenery: [
        {
          image: 'tiles/floor.png',
          source: { x: 0, y: 0, width: 48, height: 48 },
          at: { x: 0, y: 0 },
          repeat: { width: 48, height: 60 },
        },
      ],
    });
    const ctx = render({ ...scene([]), world: new World(tall) });
    expect(ctx.named('drawImage').map((c) => c.args.slice(1, 5))).toEqual([
      [0, 0, 48, 48],
      [0, 0, 48, 12],
    ]);
  });

  it('skips images that are still loading', () => {
    const ctx = render(scene([], { assets: fakeAssets({}, {}, false) }));
    expect(ctx.named('drawImage')).toHaveLength(0);
  });

  it('marks every empty bay and outlines the hovered one', () => {
    const ctx = render(scene([], { hovered: { kind: 'bay', bay: 3 } }));
    const markers = ctx.named('fillRect').filter((c) => c.fillStyle === PALETTE.empty);
    expect(markers).toHaveLength(16);
    const outline = ctx.named('strokeRect');
    expect(outline).toHaveLength(1);
    expect(outline[0]?.args[0]).toBe(bayAt(map, 3).area.x + 4.5);
  });
});

describe('drawScene villagers and stations', () => {
  it('draws the station frame and the character sprite', () => {
    const urls = drawnImages(scene([agent('a', 'thinking')]));
    expect(urls).toContain('/assets/stations/stove.png');
    expect(urls).toContain('/assets/characters/mortis/idle.png');
  });

  it('places the station by its anchor and animates it only while working', () => {
    const station = bayAt(map, 0).station;
    const at = (target: Scene) =>
      render(target)
        .named('drawImage')
        .find((c) => imageUrl(c.args[0]).includes('stove'))?.args;
    expect(at(scene([agent('a', 'thinking')], { time: 1 }))).toEqual([
      expect.anything(),
      0,
      0,
      48,
      32,
      station.x - 24,
      station.y - 31,
      48,
      32,
    ]);
    expect(at(scene([agent('a', 'tool')], { time: 0.2 }))?.[1]).toBe(48);
  });

  it('mirrors side-facing characters only when they face west', () => {
    const target = scene([agent('a', 'idle')]);
    const villager = target.world.villager('a');
    if (!villager) throw new Error('missing villager');
    villager.setActivity('read');
    for (let i = 0; i < 400 && villager.moving; i += 1) target.world.update(0.05);
    villager.setActivity('write');
    target.world.update(0.05);
    const mirrored = render(target).named('scale').length > 1;
    expect(mirrored).toBe(villager.side === 'west');
  });

  it('lifts characters that hop', () => {
    const target = scene([agent('a', 'tool')], { time: 0.25 });
    target.world.handle({ kind: 'finished', agentId: 'a', at: 0 }, 0);
    const { y } = bayAt(map, 0).work;
    const ctx = render(target);
    expect(ctx.named('translate').map((c) => c.args[1])).toContain(y - 31 - 3);
  });

  it('falls back to plain shapes for unknown characters and stations', () => {
    const ctx = render(scene([agent('a', 'tool', 'stranger')]));
    expect(ctx.named('drawImage').some((c) => imageUrl(c.args[0]).includes('stranger'))).toBe(
      false,
    );
    expect(ctx.named('fill').some((c) => String(c.fillStyle).startsWith('hsl('))).toBe(true);
    expect(ctx.named('fillRect').some((c) => c.fillStyle === DEFAULT_LIGHT)).toBe(true);
    const idle = render(scene([agent('a', 'thinking', 'stranger')]));
    expect(idle.named('fillRect').some((c) => c.fillStyle === PALETTE.stationTop)).toBe(true);
  });

  it('colours villagers without agent data by id', () => {
    const target = scene([agent('a', 'idle', 'stranger')]);
    const ctx = render({ ...target, agents: new Map() });
    expect(ctx.named('fill').some((c) => String(c.fillStyle).startsWith('hsl('))).toBe(true);
    expect(ctx.named('fillText')).toHaveLength(0);
  });

  it('greys out offline villagers', () => {
    const body = render(scene([agent('a', 'offline')]))
      .named('drawImage')
      .find((c) => imageUrl(c.args[0]).includes('mortis'));
    expect(body?.globalAlpha).toBe(0.5);
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

  it('sorts stations and villagers by depth', () => {
    const target = scene([agent('a', 'idle')]);
    const villager = target.world.villager('a');
    if (!villager) throw new Error('missing villager');
    const station = bayAt(map, 0).station;
    villager.position = { x: station.x, y: station.y - 5 };
    const behind = drawnImages(target).filter((url) => !url.includes('tiles'));
    expect(behind).toEqual(['/assets/characters/mortis/idle.png', '/assets/stations/stove.png']);
    villager.position = { x: station.x, y: station.y + 5 };
    const front = drawnImages(target).filter((url) => !url.includes('tiles'));
    expect(front).toEqual(['/assets/stations/stove.png', '/assets/characters/mortis/idle.png']);
  });
});

describe('drawScene labels', () => {
  it('draws the nameplate above the body', () => {
    expect(texts(scene([agent('a', 'idle')]))).toEqual(['A']);
  });

  it('adds the activity bubble over the nameplate', () => {
    expect(texts(scene([agent('a', 'thinking')]))).toEqual(['A', '💭']);
    expect(texts(scene([agent('a', 'waiting')]))).toEqual(['A', '❗']);
  });

  it('shows the note while visiting, or the letter icon without one', () => {
    const target = scene([agent('a', 'thinking'), agent('b', 'idle')]);
    target.world.visit('a', 'b', 'please run the tests');
    expect(texts(target)).toContain('✉️ please run the tests');
    const silent = scene([agent('a', 'thinking'), agent('b', 'idle')]);
    silent.world.visit('a', 'b', '');
    expect(texts(silent)).toContain('✉️');
  });

  it('shows the queue on the nameplate', () => {
    expect(texts(scene([{ ...agent('a', 'idle'), queued: 3 }]))).toEqual(['A', '3']);
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
    const lastBody = ctx.calls.findIndex(
      (c) => c.name === 'drawImage' && imageUrl(c.args[0]).includes('mortis'),
    );
    expect(lit).toBeGreaterThan(lastBody);
    expect(lit).toBeLessThan(ctx.calls.findIndex((c) => c.name === 'fillText'));
  });
});

describe('emittersFor', () => {
  it('burns the embers and adds working stations', () => {
    const target = scene([agent('a', 'tool'), agent('b', 'thinking'), agent('c', 'tool', 'x')]);
    const station = bayAt(map, 0).station;
    const fallback = bayAt(map, 2).station;
    expect(emittersFor(target)).toEqual([
      { key: 'ember:0', kind: 'embers', at: { x: 240, y: 72 }, rate: HEARTH_RATE },
      {
        key: 'station:a',
        kind: 'magic',
        at: { x: station.x, y: station.y - 31 + 8 },
        rate: STATION_RATE,
      },
      {
        key: 'station:c',
        kind: DEFAULT_EFFECT,
        at: { x: fallback.x, y: fallback.y - 16 },
        rate: STATION_RATE,
      },
    ]);
  });
});

describe('lightsFor', () => {
  it('adds a light per station, stronger while working', () => {
    const lights = lightsFor(scene([agent('a', 'tool'), agent('b', 'idle', 'x')]));
    expect(lights[0]).toEqual(map.lights[0]);
    expect(lights[1]).toMatchObject({
      color: STOVE.light,
      radius: STATION_LIGHT.active,
      flicker: 0.05,
    });
    expect(lights[2]).toMatchObject({ color: DEFAULT_LIGHT, radius: STATION_LIGHT.idle });
    expect(lights[2]).not.toHaveProperty('flicker');
  });
});

describe('geometry', () => {
  it('uses a fixed body box over the feet', () => {
    const world = new World(map);
    world.sync([agent('a', 'thinking')]);
    const villager = world.villager('a');
    if (!villager) throw new Error('missing villager');
    const work = bayAt(map, 0).work;
    expect(villagerBounds(villager)).toEqual({
      x: work.x - BODY.width / 2,
      y: work.y - BODY.height,
      width: BODY.width,
      height: BODY.height + 2,
    });
  });

  it('finds the station of a character', () => {
    const target = scene([agent('a', 'idle'), agent('b', 'idle', 'x')]);
    const [a, b] = target.world.all();
    if (!a || !b) throw new Error('missing villagers');
    expect(stationFor(target, a)?.manifest).toBe(STOVE);
    expect(stationFor(target, b)).toBeNull();
    const bare = { ...SIDE_CHARACTER, station: null };
    expect(stationFor({ ...target, assets: fakeAssets({ mortis: bare }) }, a)).toBeNull();
  });
});
