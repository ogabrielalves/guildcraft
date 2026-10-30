import { describe, expect, it } from 'vitest';
import type { AgentStatus, AgentView, VillageEvent } from '../../shared/agent.js';
import { parseWorkshopMap } from './map.js';
import { provisionalWorkshop } from './provisional-workshop.js';
import { EVENT_FRESHNESS_MS, World } from './world.js';

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
