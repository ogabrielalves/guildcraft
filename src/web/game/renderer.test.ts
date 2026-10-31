import { describe, expect, it, vi } from 'vitest';
import type { AgentStatus, AgentView } from '../../shared/agent.js';
import { Particles } from './draw/effects.js';
import { recordingPaint } from './draw/recording-paint.js';
import type { FakeImage } from './fake-assets.js';
import { SIDE_CHARACTER, STOVE, fakeAssets } from './fake-assets.js';
import { parseWorkshopMap, stationAt } from './map.js';
import { provisionalWorkshop } from './provisional-workshop.js';
import type { Scene } from './renderer.js';
import {
  BODY,
  HEARTH_RATE,
  OUTSIDE_DIM,
  PALETTE,
  STATION_RATE,
  drawScene,
  emittersFor,
  stationBox,
  villagerBounds,
} from './renderer.js';
import { DEFAULT_EFFECT } from './stations.js';
import { World } from './world.js';

const raw = provisionalWorkshop();
const map = parseWorkshopMap({
  ...raw,
  stations: raw.stations.map((station, index) => ({
    ...station,
    id: index === 1 ? 'missing' : 'stove',
  })),
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
    {
      image: 'tiles/shelf.png',
      source: { x: 0, y: 0, width: 16, height: 16 },
      at: { x: 300, y: 184 },
      depth: 200,
    },
  ],
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
    waitingFor: null,
    model: null,
    effort: null,
    queued: 0,
  };
}

function scene(agents: AgentView[], overrides: Partial<Scene> = {}): Scene {
  const world = new World(map, () => 0);
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
      args: [0, 0, 480, 352],
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
    const floor = ctx.named('drawImage').filter((c) => imageUrl(c.args[0]).includes('floor'));
    expect(floor.map((c) => c.args.slice(1, 5))).toEqual([
      [0, 0, 48, 48],
      [0, 0, 48, 12],
    ]);
  });

  it('skips images that are still loading', () => {
    const ctx = render(scene([], { assets: fakeAssets({}, {}, false) }));
    expect(ctx.named('drawImage')).toHaveLength(0);
  });

  it('draws every station even when nobody works there', () => {
    const urls = drawnImages(scene([]));
    expect(urls.filter((url) => url.includes('stove'))).toHaveLength(9);
  });

  it('sorts depth scenery with the villagers', () => {
    const target = scene([agent('a', 'idle')]);
    const villager = target.world.villager('a');
    if (!villager) throw new Error('missing villager');
    const order = () =>
      drawnImages(target).filter((url) => url.includes('shelf') || url.includes('mortis'));
    villager.position = { x: 300, y: 190 };
    expect(order()).toEqual(['/assets/characters/mortis/idle.png', '/assets/tiles/shelf.png']);
    villager.position = { x: 300, y: 210 };
    expect(order()).toEqual(['/assets/tiles/shelf.png', '/assets/characters/mortis/idle.png']);
  });
});

describe('foreground props', () => {
  it('covers a villager walking behind a prop but not one in front of it', () => {
    const target = scene([agent('a', 'idle'), agent('b', 'idle')]);
    const behind = target.world.villager('a');
    const front = target.world.villager('b');
    if (!behind || !front) throw new Error('missing villagers');
    behind.position = { x: 305, y: 195 };
    front.position = { x: 310, y: 205 };
    const order = render(target)
      .named('drawImage')
      .map((call) => imageUrl(call.args[0]))
      .filter((url) => url.includes('shelf') || url.includes('characters'));
    expect(order).toEqual([
      '/assets/characters/mortis/idle.png',
      '/assets/tiles/shelf.png',
      '/assets/characters/mortis/idle.png',
    ]);
  });
});

describe('drawScene outside the house', () => {
  const house = { x: 40, y: 30, width: 200, height: 100 };

  it('dims the four bands around the house after the scenery', () => {
    const dim = (ctx: ReturnType<typeof render>) =>
      ctx.named('fillRect').filter((c) => c.fillStyle === PALETTE.outside);
    const ctx = render({ ...scene([]), world: new World({ ...map, house }, () => 0) });
    expect(dim(ctx).map((c) => c.args)).toEqual([
      [0, 0, 480, 30],
      [0, 130, 480, 222],
      [0, 30, 40, 100],
      [240, 30, 240, 100],
    ]);
    expect(ctx.named('fillRect').find((c) => c.fillStyle === PALETTE.outside)).toMatchObject({
      globalAlpha: OUTSIDE_DIM,
    });
  });

  it('leaves the map as is without a house', () => {
    expect(
      render(scene([]))
        .named('fillRect')
        .some((c) => c.fillStyle === PALETTE.outside),
    ).toBe(false);
  });
});

describe('drawScene villagers and stations', () => {
  it('draws the station frame and the character sprite', () => {
    const urls = drawnImages(scene([agent('a', 'thinking')]));
    expect(urls).toContain('/assets/stations/stove.png');
    expect(urls).toContain('/assets/characters/mortis/idle.png');
  });

  it('places the station by its anchor and animates it only while working', () => {
    const station = stationAt(map, 0).at;
    const at = (target: Scene) =>
      render(target)
        .named('drawImage')
        .find((c) => imageUrl(c.args[0]).includes('stove') && c.args[5] === station.x - 24)?.args;
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
    const { y } = stationAt(map, 0).work;
    const ctx = render(target);
    expect(ctx.named('translate').map((c) => c.args[1])).toContain(y - 31 - 3);
  });

  it('falls back to plain shapes for unknown characters and stations', () => {
    const ctx = render(scene([agent('a', 'thinking'), agent('b', 'tool', 'stranger')]));
    expect(ctx.named('drawImage').some((c) => imageUrl(c.args[0]).includes('stranger'))).toBe(
      false,
    );
    expect(ctx.named('fill').some((c) => String(c.fillStyle).startsWith('hsl('))).toBe(true);
    expect(ctx.named('fillRect').some((c) => c.fillStyle === PALETTE.stationActive)).toBe(true);
    const idle = render(scene([agent('a', 'thinking'), agent('b', 'thinking', 'stranger')]));
    expect(idle.named('fillRect').some((c) => c.fillStyle === PALETTE.stationTop)).toBe(true);
    expect(idle.named('fillRect').some((c) => c.fillStyle === PALETTE.stationActive)).toBe(false);
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
    const station = stationAt(map, 0).at;
    const order = () =>
      render(target)
        .named('drawImage')
        .filter(
          (c) =>
            imageUrl(c.args[0]).includes('mortis') ||
            (imageUrl(c.args[0]).includes('stove') &&
              c.args[5] === station.x - 24 &&
              c.args[6] === station.y - 31),
        )
        .map((c) => imageUrl(c.args[0]));
    villager.position = { x: station.x, y: station.y - 5 };
    expect(order()).toEqual(['/assets/characters/mortis/idle.png', '/assets/stations/stove.png']);
    villager.position = { x: station.x, y: station.y + 5 };
    expect(order()).toEqual(['/assets/stations/stove.png', '/assets/characters/mortis/idle.png']);
  });
});

describe('drawScene labels', () => {
  it('draws the nameplate above the body', () => {
    expect(texts(scene([agent('a', 'idle')]))).toEqual(['A']);
  });

  it('adds the activity bubble over the nameplate', () => {
    expect(texts(scene([agent('a', 'thinking')]))).toEqual(['A', '💭']);
    expect(texts(scene([agent('a', 'waiting')]))).toEqual(['A', '❗']);
    expect(texts(scene([agent('a', 'thinking')], { alerts: new Set(['a']) }))).toEqual(['A', '❗']);
  });

  it('shows the note while visiting, or the letter icon without one', () => {
    const target = scene([agent('a', 'thinking'), agent('b', 'idle')]);
    target.world.visit('a', 'b', 'please run the tests');
    expect(texts(target)).toContain('✉️ please run the tests');
    const silent = scene([agent('a', 'thinking'), agent('b', 'idle')]);
    silent.world.visit('a', 'b', '');
    expect(texts(silent)).toContain('✉️');
  });

  it('tags the station with the project folder when the map has no zones', () => {
    const target = scene([{ ...agent('a', 'idle'), cwd: 'C:\\code\\guildcraft\\' }]);
    const villager = target.world.villager('a');
    if (!villager) throw new Error('missing villager');
    villager.position = { x: 0, y: 0 };
    const { work } = stationAt(map, villager.station);
    const calls = render(target)
      .named('fillText')
      .map((call) => call.args);
    expect(calls).toContainEqual(['guildcraft', work.x, work.y + 14.5]);
    expect(calls.at(-1)).toEqual(['A', 0, -31]);
  });

  it('pins the tag to the sign of the zone, wherever the villager stands', () => {
    const zoned = parseWorkshopMap({
      ...provisionalWorkshop(),
      zones: [
        { id: 'all', sign: { x: 200, y: 20 }, areas: [{ x: 0, y: 0, width: 480, height: 352 }] },
      ],
    });
    const world = new World(zoned, () => 0);
    const agents = [{ ...agent('a', 'idle'), cwd: '/code/guildcraft' }];
    world.sync(agents);
    const villager = world.villager('a');
    if (!villager) throw new Error('missing villager');
    const tagAt = () =>
      render({ ...scene(agents), world })
        .named('fillText')
        .find((call) => call.args[0] === 'guildcraft')?.args;
    const first = tagAt();
    villager.position = { x: 300, y: 300 };
    expect(tagAt()).toEqual(first);
    expect(first?.[1]).toBe(200);
  });

  it('draws a single folder tag per zone when agents share a project', () => {
    const cwd = '/code/guildcraft';
    const zoned = parseWorkshopMap({
      ...provisionalWorkshop(),
      zones: [{ id: 'all', areas: [{ x: 0, y: 0, width: 480, height: 352 }] }],
    });
    const world = new World(zoned, () => 0);
    const agents = [
      { ...agent('a', 'idle'), cwd },
      { ...agent('b', 'idle'), cwd },
    ];
    world.sync(agents);
    const target = { ...scene(agents), world };
    // each tag engraves its text twice: shadow, then lettering
    expect(texts(target).filter((text) => text === 'guildcraft')).toHaveLength(2);
  });

  it('shows the queue on the nameplate', () => {
    expect(texts(scene([{ ...agent('a', 'idle'), queued: 3 }]))).toEqual(['A', '3']);
  });

  it('draws particles between bodies and labels', () => {
    const particles = new Particles(() => 0.5);
    particles.update(1, [{ key: 'k', kind: 'sparks', at: { x: 10, y: 10 }, rate: 1 }]);
    vi.spyOn(particles, 'draw').mockImplementation((paint) => {
      paint.fillRect(-1, -1, 1, 1);
    });
    const ctx = render(scene([agent('a', 'tool')], { particles }));
    const lit = ctx.calls.findIndex((c) => c.name === 'fillRect' && c.args[0] === -1);
    const lastBody = ctx.calls.findIndex(
      (c) => c.name === 'drawImage' && imageUrl(c.args[0]).includes('mortis'),
    );
    expect(lit).toBeGreaterThan(lastBody);
    expect(lit).toBeLessThan(ctx.calls.findIndex((c) => c.name === 'fillText'));
  });
});

describe('emittersFor', () => {
  it('burns the embers and adds working stations', () => {
    const target = scene([agent('a', 'tool'), agent('b', 'tool'), agent('c', 'thinking')]);
    const station = stationAt(map, 0).at;
    const fallback = stationAt(map, 1).at;
    expect(emittersFor(target)).toEqual([
      { key: 'ember:0', kind: 'embers', at: { x: 240, y: 72 }, rate: HEARTH_RATE },
      {
        key: 'station:0',
        kind: 'magic',
        at: { x: station.x, y: station.y - 31 + 8 },
        rate: STATION_RATE,
      },
      {
        key: 'station:1',
        kind: DEFAULT_EFFECT,
        at: { x: fallback.x, y: fallback.y - 16 },
        rate: STATION_RATE,
      },
    ]);
  });
});

describe('stations drawn into the scenery', () => {
  const baked = parseWorkshopMap({
    ...raw,
    stations: raw.stations.map(({ at, work }) => ({ effect: 'sparks', at, work })),
  });

  it('draws no sprite and emits from the station point while working', () => {
    const world = new World(baked, () => 0);
    const agents = [agent('a', 'tool')];
    world.sync(agents);
    const target = scene(agents, { world });
    const villager = world.villager('a');
    expect(drawnImages(target).some((url) => url.includes('stove'))).toBe(false);
    expect(emittersFor(target).at(-1)).toEqual({
      key: `station:${String(villager?.station)}`,
      kind: 'sparks',
      at: stationAt(baked, villager?.station ?? 0).at,
      rate: STATION_RATE,
    });
  });
});

describe('geometry', () => {
  it('uses a fixed body box over the feet', () => {
    const world = new World(map, () => 0);
    world.sync([agent('a', 'thinking')]);
    const villager = world.villager('a');
    if (!villager) throw new Error('missing villager');
    const work = stationAt(map, 0).work;
    expect(villagerBounds(villager)).toEqual({
      x: work.x - BODY.width / 2,
      y: work.y - BODY.height,
      width: BODY.width,
      height: BODY.height + 2,
    });
  });

  it('boxes a station by its anchor or a placeholder', () => {
    const place = stationAt(map, 0);
    expect(stationBox(place, { manifest: STOVE, base: '/assets/' })).toEqual({
      x: place.at.x - 24,
      y: place.at.y - 31,
      width: 48,
      height: 32,
    });
    expect(stationBox(place, null)).toEqual({
      x: place.at.x - 10,
      y: place.at.y - 16,
      width: 20,
      height: 16,
    });
  });
});
