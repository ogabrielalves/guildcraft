import type { AgentView } from '../../shared/agent.js';
import type { Assets, Station } from './assets.js';
import { bubbleFor, drawBubble, drawNote } from './draw/bubble.js';
import type { Emitter, Particles } from './draw/effects.js';
import type { Light, Lighting } from './draw/lighting.js';
import { drawNameplate } from './draw/nameplate.js';
import type { Paint } from './draw/paint.js';
import { TAU } from './draw/paint.js';
import { drawRing, drawShadow } from './draw/rings.js';
import type { Bay, Point, Rect, Scenery, WorkshopMap } from './map.js';
import { frameAt } from './sprite-sheet.js';
import { DEFAULT_EFFECT, DEFAULT_LIGHT, stationFrame } from './stations.js';
import type { Villager } from './villager.js';
import type { World } from './world.js';

export type Hover = { kind: 'villager'; id: string } | { kind: 'bay'; bay: number } | null;

export interface Scene {
  world: World;
  agents: ReadonlyMap<string, AgentView>;
  assets: Assets;
  selected: ReadonlySet<string>;
  focused: string | null;
  hovered: Hover;
  time: number;
  particles?: Particles;
  lighting?: Lighting;
}

export const PALETTE = {
  station: '#8a6a45',
  stationTop: '#a88456',
  empty: '#f1e4cf',
};

export const STATION_RATE = 8;
export const HEARTH_RATE = 5;
export const BODY = { width: 16, height: 30 };
export const STATION_LIGHT = { active: 56, idle: 24 };
const PLACEHOLDER = { width: 20, height: 16 };

interface Image {
  image: CanvasImageSource;
  source: Rect;
  at: Point;
  flip: boolean;
}

export function villagerBounds(villager: Villager): Rect {
  const { x, y } = villager.position;
  return { x: x - BODY.width / 2, y: y - BODY.height, width: BODY.width, height: BODY.height + 2 };
}

function skinOf(scene: Pick<Scene, 'agents'>, villager: Villager): string {
  return scene.agents.get(villager.id)?.skin ?? '';
}

export function stationFor(
  scene: Pick<Scene, 'agents' | 'assets'>,
  villager: Villager,
): Station | null {
  const id = scene.assets.character(skinOf(scene, villager))?.manifest.station;
  return id ? scene.assets.station(id) : null;
}

function stationBox(bay: Bay, station: Station | null): Rect {
  if (!station) {
    const { width, height } = PLACEHOLDER;
    return { x: bay.station.x - width / 2, y: bay.station.y - height, width, height };
  }
  const { anchor, frame } = station.manifest;
  return {
    x: bay.station.x - anchor.x,
    y: bay.station.y - anchor.y,
    width: frame.width,
    height: frame.height,
  };
}

function owned(scene: Scene): { villager: Villager; bay: Bay }[] {
  const { map } = scene.world;
  return scene.world.all().flatMap((villager) => {
    const bay = map.bays[villager.bay];
    return bay ? [{ villager, bay }] : [];
  });
}

export function emittersFor(scene: Pick<Scene, 'world' | 'agents' | 'assets'>): Emitter[] {
  const { map } = scene.world;
  const emitters: Emitter[] = map.embers.map((at, index) => ({
    key: `ember:${String(index)}`,
    kind: 'embers',
    at,
    rate: HEARTH_RATE,
  }));
  for (const villager of scene.world.all()) {
    const bay = map.bays[villager.bay];
    if (!villager.atStation || bay === undefined) continue;
    const station = stationFor(scene, villager);
    const box = stationBox(bay, station);
    const emit = station?.manifest.emit ?? { x: box.width / 2, y: 0 };
    emitters.push({
      key: `station:${villager.id}`,
      kind: station?.manifest.effect ?? DEFAULT_EFFECT,
      at: { x: box.x + emit.x, y: box.y + emit.y },
      rate: STATION_RATE,
    });
  }
  return emitters;
}

export function lightsFor(scene: Pick<Scene, 'world' | 'agents' | 'assets'>): Light[] {
  const { map } = scene.world;
  const lights = [...map.lights];
  for (const villager of scene.world.all()) {
    const bay = map.bays[villager.bay];
    if (bay === undefined) continue;
    const station = stationFor(scene, villager);
    const box = stationBox(bay, station);
    const active = villager.atStation;
    lights.push({
      at: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      radius: active ? STATION_LIGHT.active : STATION_LIGHT.idle,
      color: station?.manifest.light ?? DEFAULT_LIGHT,
      ...(active ? { flicker: 0.05 } : {}),
    });
  }
  return lights;
}

function blit(ctx: Paint, { image, source, at, flip }: Image): void {
  const { x, y, width, height } = source;
  if (!flip) {
    ctx.drawImage(image, x, y, width, height, at.x, at.y, width, height);
    return;
  }
  ctx.save();
  ctx.translate(at.x + width, at.y);
  ctx.scale(-1, 1);
  ctx.drawImage(image, x, y, width, height, 0, 0, width, height);
  ctx.restore();
}

function drawTiled(ctx: Paint, image: CanvasImageSource, item: Scenery & { kind: 'image' }) {
  const { source, at, repeat, flip } = item;
  if (repeat === null) {
    blit(ctx, { image, source, at, flip });
    return;
  }
  for (let dy = 0; dy < repeat.height; dy += source.height) {
    for (let dx = 0; dx < repeat.width; dx += source.width) {
      const width = Math.min(source.width, repeat.width - dx);
      const height = Math.min(source.height, repeat.height - dy);
      blit(ctx, {
        image,
        source: { ...source, width, height },
        at: { x: at.x + dx, y: at.y + dy },
        flip,
      });
    }
  }
}

function drawScenery(ctx: Paint, map: WorkshopMap, assets: Assets): void {
  ctx.fillStyle = map.floor;
  ctx.fillRect(0, 0, map.width, map.height);
  for (const item of map.scenery) {
    if (item.kind === 'fill') {
      ctx.fillStyle = item.color;
      ctx.fillRect(item.area.x, item.area.y, item.area.width, item.area.height);
      continue;
    }
    const image = assets.image(assets.url(item.image));
    if (image) drawTiled(ctx, image, item);
  }
}

function drawEmptyBay(ctx: Paint, bay: Bay, hovered: boolean): void {
  const cx = bay.area.x + bay.area.width / 2;
  const cy = bay.area.y + bay.area.height / 2;
  ctx.globalAlpha = hovered ? 0.9 : 0.35;
  ctx.fillStyle = PALETTE.empty;
  ctx.fillRect(cx - 6, cy - 1, 12, 2);
  ctx.fillRect(cx - 1, cy - 6, 2, 12);
  if (hovered) {
    ctx.strokeStyle = PALETTE.empty;
    ctx.lineWidth = 1;
    ctx.strokeRect(bay.area.x + 4.5, bay.area.y + 4.5, bay.area.width - 9, bay.area.height - 9);
  }
  ctx.globalAlpha = 1;
}

function drawStation(ctx: Paint, bay: Bay, villager: Villager, scene: Scene): void {
  const station = stationFor(scene, villager);
  const box = stationBox(bay, station);
  const image = station ? scene.assets.image(station.base + station.manifest.image) : null;
  if (station && image) {
    const frame = stationFrame(station.manifest, villager.atStation, scene.time);
    blit(ctx, {
      image,
      source: { x: frame.sx, y: frame.sy, width: frame.width, height: frame.height },
      at: { x: Math.round(box.x), y: Math.round(box.y) },
      flip: false,
    });
    return;
  }
  ctx.fillStyle = PALETTE.station;
  ctx.fillRect(box.x, box.y, box.width, box.height);
  ctx.fillStyle = villager.atStation ? DEFAULT_LIGHT : PALETTE.stationTop;
  ctx.fillRect(box.x, box.y, box.width, 4);
}

function skinColor(skin: string): string {
  let hash = 0;
  for (const char of skin) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return `hsl(${String(hash)} 45% 55%)`;
}

function drawBody(ctx: Paint, villager: Villager, scene: Scene): void {
  const skin = skinOf(scene, villager);
  const character = scene.assets.character(skin);
  const { x, y } = villager.position;
  ctx.globalAlpha = villager.activity === 'off' ? 0.5 : 1;
  const frame = character
    ? frameAt(character.manifest, villager.pose, villager.facing, villager.side, scene.time)
    : null;
  const image = character && frame ? scene.assets.image(character.base + frame.image) : null;
  if (frame && image) {
    const anchorX = frame.flip ? frame.width - frame.anchor.x : frame.anchor.x;
    blit(ctx, {
      image,
      source: { x: frame.sx, y: frame.sy, width: frame.width, height: frame.height },
      at: { x: Math.round(x - anchorX), y: Math.round(y - frame.anchor.y - frame.lift) },
      flip: frame.flip,
    });
  } else {
    ctx.fillStyle = skinColor(skin === '' ? villager.id : skin);
    ctx.beginPath();
    ctx.ellipse(x, y - 8, 5, 8, 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawVillager(ctx: Paint, villager: Villager, scene: Scene): void {
  drawRing(
    ctx,
    villager.position,
    {
      waiting: villager.activity === 'wait',
      selected: scene.selected.has(villager.id),
      focused: scene.focused === villager.id,
      hovered: scene.hovered?.kind === 'villager' && scene.hovered.id === villager.id,
    },
    scene.time,
  );
  drawShadow(ctx, villager.position);
  drawBody(ctx, villager, scene);
}

function drawLabels(ctx: Paint, villager: Villager, scene: Scene): void {
  const agent = scene.agents.get(villager.id);
  if (!agent) return;
  const plateBottom = Math.round(villagerBounds(villager).y);
  drawNameplate(ctx, agent.name, agent.queued, villager.position.x, plateBottom);
  const bubbleBottom = plateBottom - 10;
  const { note } = villager;
  if (note !== null && note !== '') {
    drawNote(ctx, note, villager.position.x, bubbleBottom, scene.time);
    return;
  }
  const bubble = bubbleFor(villager.activity, villager.visiting);
  if (bubble !== null) drawBubble(ctx, bubble, villager.position.x, bubbleBottom, scene.time);
}

export function drawScene(ctx: Paint, scene: Scene): void {
  const { map } = scene.world;
  const pairs = owned(scene);
  const occupied = new Set(pairs.map(({ villager }) => villager.bay));
  ctx.save();
  drawScenery(ctx, map, scene.assets);
  map.bays.forEach((bay, index) => {
    if (occupied.has(index)) return;
    drawEmptyBay(ctx, bay, scene.hovered?.kind === 'bay' && scene.hovered.bay === index);
  });
  const layers = [
    ...pairs.map(({ villager, bay }) => ({
      depth: bay.station.y,
      draw: () => {
        drawStation(ctx, bay, villager, scene);
      },
    })),
    ...scene.world.all().map((villager) => ({
      depth: villager.position.y,
      draw: () => {
        drawVillager(ctx, villager, scene);
      },
    })),
  ].sort((a, b) => a.depth - b.depth);
  for (const layer of layers) layer.draw();
  scene.particles?.draw(ctx);
  scene.lighting?.draw(ctx, lightsFor(scene), scene.time);
  for (const villager of scene.world.byDepth()) drawLabels(ctx, villager, scene);
  ctx.restore();
}
