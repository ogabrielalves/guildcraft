import { describe, expect, it } from 'vitest';
import type { AgentStatus, AgentView } from '../../shared/agent.js';
import { bayAt, parseWorkshopMap } from './map.js';
import { provisionalWorkshop } from './provisional-workshop.js';
import type { Paint, Scene } from './renderer.js';
import { PALETTE, drawScene, manifestOf, villagerBounds, wallBottom } from './renderer.js';
import type { SpriteSheet } from './sprite-sheet.js';
import { LPC_MANIFEST } from './sprite-sheet.js';
import { World } from './world.js';

interface PaintCall {
  name: string;
  args: unknown[];
  fillStyle: unknown;
  globalAlpha: number;
}

type RecordingPaint = Paint & { calls: PaintCall[] };

function recordingPaint(): RecordingPaint {
  const calls: PaintCall[] = [];
  const state = {
    fillStyle: '' as unknown,
    strokeStyle: '' as unknown,
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
  };
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args, fillStyle: state.fillStyle, globalAlpha: state.globalAlpha });
    };
  return Object.assign(state, {
    calls,
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    beginPath: record('beginPath'),
    ellipse: record('ellipse'),
    arc: record('arc'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillText: record('fillText'),
    drawImage: record('drawImage'),
    save: record('save'),
    restore: record('restore'),
    measureText: (text: string) => ({ width: text.length * 4 }) as TextMetrics,
  }) as unknown as RecordingPaint;
}

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
    tool: null,
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
  return ctx.calls;
}

describe('drawScene', () => {
  it('draws the empty workshop with a marker on every bay', () => {
    const calls = render(scene([]));
    expect(calls[0]?.name).toBe('save');
    expect(calls.at(-1)?.name).toBe('restore');
    expect(calls.filter((c) => c.name === 'drawImage')).toHaveLength(0);
    const markers = calls.filter((c) => c.name === 'fillRect' && c.fillStyle === PALETTE.empty);
    expect(markers).toHaveLength(16);
  });

  it('outlines the hovered empty bay', () => {
    const calls = render(scene([], { hovered: { kind: 'bay', bay: 3 } }));
    const outline = calls.filter((c) => c.name === 'strokeRect');
    expect(outline).toHaveLength(1);
    expect(outline[0]?.args[0]).toBe(bayAt(map, 3).area.x + 4.5);
  });

  it('draws loaded sprites and nameplates', () => {
    const calls = render(scene([agent('a', 'idle')]));
    const draw = calls.find((c) => c.name === 'drawImage');
    expect(draw?.args[0]).toBe(image);
    expect(calls.some((c) => c.name === 'fillText' && c.args[0] === 'A')).toBe(true);
  });

  it('falls back to a plain body when the sheet is missing', () => {
    const calls = render(scene([agent('a', 'idle', 'mortis')]));
    expect(calls.some((c) => c.name === 'drawImage')).toBe(false);
    expect(calls.some((c) => c.name === 'fill' && String(c.fillStyle).startsWith('hsl('))).toBe(
      true,
    );
  });

  it('greys out offline villagers', () => {
    const calls = render(scene([agent('a', 'offline')]));
    expect(calls.find((c) => c.name === 'drawImage')?.globalAlpha).toBe(0.5);
  });

  it('lights the station of a working villager', () => {
    const working = { ...agent('a', 'tool'), tool: { name: 'Bash', detail: 'npm test' } };
    const calls = render(scene([working]));
    expect(calls.some((c) => c.name === 'fill' && c.fillStyle === PALETTE.glow)).toBe(true);
  });

  it.each<[string, AgentStatus, Partial<Scene>, number]>([
    ['selected', 'idle', { selected: new Set(['a']) }, 1],
    ['focused', 'idle', { selected: new Set(['a']), focused: 'a' }, 1],
    ['hovered', 'idle', { hovered: { kind: 'villager', id: 'a' } }, 1],
    ['waiting', 'waiting', {}, 1],
    ['plain', 'idle', {}, 0],
  ])('rings a %s villager', (_, status, overrides, rings) => {
    const calls = render(scene([agent('a', status)], overrides));
    expect(calls.filter((c) => c.name === 'stroke')).toHaveLength(rings);
  });

  it('draws villagers in depth order', () => {
    const agents = [agent('a', 'offline'), agent('b', 'thinking')];
    const target = scene(agents);
    const names = render(target)
      .filter((c) => c.name === 'fillText')
      .map((c) => c.args[0]);
    const expected = target.world.byDepth().map((v) => v.id.toUpperCase());
    expect(names).toEqual(expected);
  });

  it('skips the nameplate of a villager without agent data', () => {
    const target = scene([agent('a', 'idle')]);
    const calls = render({ ...target, agents: new Map() });
    expect(calls.some((c) => c.name === 'fillText')).toBe(false);
  });
});

describe('geometry', () => {
  it('finds where the wall ends', () => {
    expect(wallBottom(map)).toBe(80);
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
