import { describe, expect, it } from 'vitest';
import type { AgentStatus, AgentView, VillageEvent } from '../../shared/agent.js';
import { bayAt, parseWorkshopMap } from './map.js';
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
    queued: 0,
  };
}

function event(kind: VillageEvent['kind'], agentId: string, targetId?: string): VillageEvent {
  return { kind, agentId, ...(targetId === undefined ? {} : { targetId }), at: 1000 };
}

describe('World', () => {
  it('gives each agent the first free bay', () => {
    const world = new World(map);
    world.sync([agent('a'), agent('b'), agent('c')]);
    expect(world.all().map((v) => [v.id, v.bay])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
    expect(world.villager('b')?.bay).toBe(1);
  });

  it('keeps bays stable when someone leaves and reuses the free one', () => {
    const world = new World(map);
    world.sync([agent('a'), agent('b'), agent('c')]);
    world.sync([agent('a'), agent('c')]);
    expect(world.villager('b')).toBeUndefined();
    expect(world.villager('c')?.bay).toBe(2);
    world.sync([agent('a'), agent('c'), agent('d')]);
    expect(world.villager('d')?.bay).toBe(1);
    expect([...world.occupiedBays()].sort()).toEqual([0, 1, 2]);
  });

  it('leaves agents beyond the last bay out', () => {
    const world = new World(map);
    world.sync(Array.from({ length: 9 }, (_, i) => agent(`a${String(i)}`)));
    expect(world.all()).toHaveLength(8);
    expect(world.villager('a8')).toBeUndefined();
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
    world.sync([agent('a', 'thinking'), agent('b')]);
    world.handle(event('messaged', 'a', 'b'), 1000);
    const sender = world.villager('a');
    expect(sender?.visiting).toBe(true);
    for (let i = 0; i < 400 && sender?.moving; i += 1) world.update(0.05);
    expect(sender?.position).toEqual(bayAt(map, 1).guest);
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
    world.handle(event('messaged', 'a', 'b'), 1000 + EVENT_FRESHNESS_MS + 1);
    world.handle(event('messaged', 'ghost', 'b'), 1000);
    world.handle(event('messaged', 'a', 'ghost'), 1000);
    world.handle(event('messaged', 'a'), 1000);
    world.handle(event('joined', 'a'), 1000);
    expect(world.villager('a')?.visiting).toBe(false);
  });
});
