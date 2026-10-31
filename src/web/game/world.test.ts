import { describe, expect, it, vi } from 'vitest';
import type { AgentStatus, AgentView, VillageEvent } from '../../shared/agent.js';
import { parseWorkshopMap } from './map.js';
import { provisionalWorkshop } from './provisional-workshop.js';
import { EVENT_FRESHNESS_MS, World, browserZoneMemory, projectOf } from './world.js';

const map = parseWorkshopMap(provisionalWorkshop());

function agent(id: string, status: AgentStatus = 'idle'): AgentView {
  return {
    id,
    name: id,
    cwd: '/tmp',
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

function event(kind: VillageEvent['kind'], agentId: string, targetId?: string): VillageEvent {
  return { kind, agentId, ...(targetId === undefined ? {} : { targetId }), at: 1000 };
}

describe('World', () => {
  it('walks freshly recruited agents in from the entrance', () => {
    const entrance = { x: 240, y: 340 };
    const world = new World(parseWorkshopMap({ ...provisionalWorkshop(), entrance }), () => 0.5);
    world.sync([agent('a', 'starting'), agent('b')]);
    expect(world.villager('a')?.position).toEqual(entrance);
    expect(world.villager('a')?.moving).toBe(true);
    expect(world.villager('b')?.position).not.toEqual(entrance);
  });

  it('gives each agent a random free station', () => {
    const world = new World(map, () => 0.5);
    world.sync([agent('a'), agent('b'), agent('c')]);
    expect(world.all().map((v) => [v.id, v.station])).toEqual([
      ['a', 5],
      ['b', 4],
      ['c', 6],
    ]);
    expect(world.owner(6)?.id).toBe('c');
    expect(world.owner(0)).toBeUndefined();
    expect(world.freeStations()).toEqual([0, 1, 2, 3, 7, 8, 9]);
  });

  it('keeps stations stable when someone leaves and reuses the free one', () => {
    const world = new World(map, () => 0);
    world.sync([agent('a'), agent('b'), agent('c')]);
    world.sync([agent('a'), agent('c')]);
    expect(world.villager('b')).toBeUndefined();
    expect(world.villager('c')?.station).toBe(2);
    world.sync([agent('a'), agent('c'), agent('d')]);
    expect(world.villager('d')?.station).toBe(1);
  });

  describe('browserZoneMemory', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });

    it('survives a reload but resets for a new server session', () => {
      browserZoneMemory('one').save({ '/p/web': 'left' });
      expect(browserZoneMemory('one').load()).toEqual({ '/p/web': 'left' });
      expect(browserZoneMemory('two').load()).toEqual({});
    });
  });

  describe('projects', () => {
    const zoned = parseWorkshopMap({
      ...provisionalWorkshop(),
      zones: [
        { id: 'left', areas: [{ x: 0, y: 0, width: 200, height: 352 }] },
        { id: 'middle', areas: [{ x: 200, y: 0, width: 160, height: 352 }] },
        { id: 'right', areas: [{ x: 360, y: 0, width: 120, height: 352 }] },
      ],
    });
    const at = (id: string, cwd: string): AgentView => ({ ...agent(id), cwd });
    const zonesOf = (world: World) => world.all().map((v) => [v.id, v.zone]);

    it('keeps every agent of a project in the same zone, other projects elsewhere', () => {
      const world = new World(zoned, () => 0);
      world.sync([at('a', '/p/web'), at('b', '/p/api'), at('c', '/p/web/'), at('d', '/p/web')]);
      const zone = (id: string) => world.villager(id)?.zone;
      expect(zone('a')).toBe(zone('c'));
      expect(zone('a')).toBe(zone('d'));
      expect(zone('b')).not.toBe(zone('a'));
    });

    it('keeps the project zone even after its agents leave', () => {
      const world = new World(zoned, () => 0);
      world.sync([at('a', '/p/web'), at('b', '/p/api')]);
      const web = world.villager('a')?.zone;
      world.sync([at('a', '/p/web'), at('b', '/p/api'), at('c', '/p/web')]);
      expect(world.villager('c')?.zone).toBe(web);
      world.sync([at('b', '/p/api')]);
      world.sync([at('b', '/p/api'), at('d', '/p/docs')]);
      expect(world.villager('d')?.zone).not.toBe(web);
      world.sync([at('b', '/p/api'), at('d', '/p/docs'), at('e', '/p/web')]);
      expect(world.villager('e')?.zone).toBe(web);
    });

    it('restores the project zones after a reload', () => {
      const saved: Record<string, string> = {};
      const memory = {
        load: () => ({ ...saved }),
        save: (zones: Record<string, string>) => Object.assign(saved, zones),
      };
      const first = new World(zoned, () => 0, memory);
      first.sync([at('a', '/p/web'), at('b', '/p/api')]);
      const before = zonesOf(first);
      const reloaded = new World(zoned, () => 0, memory);
      reloaded.sync([at('b', '/p/api'), at('a', '/p/web')]);
      expect(zonesOf(reloaded)).toEqual([...before].reverse());
    });

    it('treats Windows paths that differ only in case as one project', () => {
      const world = new World(zoned, () => 0);
      world.sync([at('a', 'C:\\Code\\Web'), at('b', 'c:\\code\\web\\')]);
      expect(world.villager('a')?.zone).toBe(world.villager('b')?.zone);
    });

    it('puts a project in a zone with room for all of its agents', () => {
      const world = new World(zoned, () => 0);
      world.sync([at('a', '/p/api'), at('b', '/p/web'), at('c', '/p/web'), at('d', '/p/web')]);
      const zone = (id: string) => world.villager(id)?.zone;
      expect(zone('b')).toBe(zone('c'));
      expect(zone('b')).toBe(zone('d'));
    });

    it('falls back to a free station elsewhere once the zone is full', () => {
      const world = new World(zoned, () => 0);
      world.sync(Array.from({ length: 5 }, (_, i) => at(`w${String(i)}`, '/p/web')));
      expect(world.all()).toHaveLength(5);
    });
  });

  it('normalizes project paths', () => {
    expect(projectOf('C:\\code\\web\\')).toBe('c:/code/web');
    expect(projectOf('/code//web/')).toBe('/code/web');
  });

  it('leaves agents beyond the last station out', () => {
    const world = new World(map);
    world.sync(Array.from({ length: 11 }, (_, i) => agent(`a${String(i)}`)));
    expect(world.all()).toHaveLength(10);
    expect(world.villager('a10')).toBeUndefined();
    expect(world.freeStations()).toEqual([]);
  });

  it('frees the spot of an agent that leaves', () => {
    const world = new World(map, () => 0);
    world.sync([agent('a', 'offline')]);
    world.sync([]);
    world.sync([agent('b', 'offline')]);
    expect(world.villager('b')?.position).toEqual({ x: 440, y: 280 });
  });

  it('updates the activity of known villagers', () => {
    const world = new World(map);
    world.sync([agent('a', 'thinking')]);
    world.sync([agent('a', 'offline')]);
    expect(world.villager('a')?.activity).toBe('off');
  });

  it('orders villagers by depth', () => {
    const world = new World(map);
    world.sync([agent('a', 'offline'), agent('b', 'thinking'), agent('c', 'offline')]);
    world.sync([agent('a', 'offline'), agent('b', 'thinking'), agent('c', 'offline'), agent('d')]);
    const ys = world.byDepth().map((v) => v.position.y);
    expect(ys).toEqual([...ys].sort((p, q) => p - q));
  });

  it('sends the sender to visit the recipient', () => {
    const world = new World(map);
    world.sync([agent('a', 'thinking'), agent('b', 'thinking')]);
    world.visit('a', 'b', 'please review');
    const sender = world.villager('a');
    expect(sender?.visiting).toBe(true);
    expect(sender?.note).toBe('please review');
    for (let i = 0; i < 2000 && sender?.moving; i += 1) world.update(0.05);
    const host = world.villager('b')?.position ?? { x: 0, y: 0 };
    expect(Math.abs((sender?.position.x ?? 0) - host.x)).toBeCloseTo(18);
    expect(sender?.position.y).toBe(host.y);
  });

  it('cheers when an agent finishes', () => {
    const world = new World(map);
    world.sync([agent('a', 'thinking')]);
    world.handle(event('finished', 'a'), 1000);
    expect(world.villager('a')?.pose).toBe('cheer');
  });

  it('ignores stale events and unknown agents', () => {
    const world = new World(map);
    world.sync([agent('a', 'thinking'), agent('b')]);
    world.handle(event('finished', 'a'), 1000 + EVENT_FRESHNESS_MS + 1);
    world.handle(event('finished', 'ghost'), 1000);
    world.handle(event('messaged', 'a', 'b'), 1000);
    world.handle(event('joined', 'a'), 1000);
    expect(world.villager('a')?.pose).not.toBe('cheer');
    expect(world.villager('a')?.visiting).toBe(false);
    world.visit('ghost', 'b');
    world.visit('a', 'ghost');
    world.visit('a', 'a');
    expect(world.villager('a')?.visiting).toBe(false);
  });
});
