import type { AgentView } from '../../shared/agent.js';
import { bubbleFor, drawBubble, drawNote } from './draw/bubble.js';
import type { Emitter, Particles } from './draw/effects.js';
import type { Light, Lighting } from './draw/lighting.js';
import { drawNameplate } from './draw/nameplate.js';
import type { Paint } from './draw/paint.js';
import { TAU } from './draw/paint.js';
import { drawRing, drawShadow } from './draw/rings.js';
import type { Bay, Point, Rect, WorkshopMap } from './map.js';
import type { CharacterManifest, SpriteSheet } from './sprite-sheet.js';
import { LPC_MANIFEST, frameAt } from './sprite-sheet.js';
import { LIGHTS, stationOf } from './stations.js';
import type { Villager } from './villager.js';
import type { World } from './world.js';

export type Hover = { kind: 'villager'; id: string } | { kind: 'bay'; bay: number } | null;

export interface Scene {
  world: World;
  agents: ReadonlyMap<string, AgentView>;
  sprites: { get(skin: string): SpriteSheet | null };
  selected: ReadonlySet<string>;
  focused: string | null;
  hovered: Hover;
  time: number;
  particles?: Particles;
  lighting?: Lighting;
}

export const PALETTE = {
  floor: '#6b4a2f',
  plank: '#5a3d26',
  ceiling: '#1d1410',
  wall: '#cdb48a',
  trim: '#4a3020',
  brick: '#7a3b2a',
  hearth: '#120c09',
  fire: '#f0a63a',
  window: '#9fc3d9',
  rugs: ['#3f6b3a', '#2f5530'],
  pillar: '#3b2618',
  station: '#8a6a45',
  stationTop: '#a88456',
  corridor: '#7a2f2a',
  corridorTrim: '#a8483d',
  table: '#5a3a22',
  empty: '#f1e4cf',
};

export const STATION_RATE = 8;
export const HEARTH_RATE = 5;
const PLANK_HEIGHT = 8;
const RUG_INSET = 8;
const PILLAR_WIDTH = 3;
const STATION_SIZE = { width: 20, height: 16 };

export function wallBottom(map: WorkshopMap): number {
  return Math.min(...map.bays.map((bay) => bay.area.y));
}

export function hearthPoint(map: WorkshopMap): Point {
  return { x: map.width / 2, y: wallBottom(map) - map.tileSize / 2 };
}

export function windowPoints(map: WorkshopMap): Point[] {
  const tile = map.tileSize;
  return [
    { x: tile * 2.5, y: tile * 2.25 },
    { x: map.width - tile * 2.5, y: tile * 2.25 },
  ];
}

export function manifestOf(sheet: SpriteSheet | null): CharacterManifest {
  return sheet?.manifest ?? LPC_MANIFEST;
}

export function villagerBounds(villager: Villager, manifest: CharacterManifest): Rect {
  return {
    x: villager.position.x - manifest.anchor.x,
    y: villager.position.y - manifest.anchor.y,
    width: manifest.frame.width,
    height: manifest.frame.height,
  };
}

function skinOf(scene: Pick<Scene, 'agents'>, villager: Villager): string {
  return scene.agents.get(villager.id)?.skin ?? '';
}

export function emittersFor(scene: Pick<Scene, 'world' | 'agents'>): Emitter[] {
  const { map } = scene.world;
  const emitters: Emitter[] = [
    { key: 'hearth', kind: 'embers', at: hearthPoint(map), rate: HEARTH_RATE },
  ];
  for (const villager of scene.world.all()) {
    if (!villager.atStation) continue;
    const station = map.bays[villager.bay]?.station;
    if (station === undefined) continue;
    emitters.push({
      key: `station:${villager.id}`,
      kind: stationOf(skinOf(scene, villager)).effect,
      at: { x: station.x, y: station.y - STATION_SIZE.height / 2 },
      rate: STATION_RATE,
    });
  }
  return emitters;
}

export function lightsFor(scene: Pick<Scene, 'world' | 'agents'>): Light[] {
  const { map } = scene.world;
  const lights: Light[] = [
    { at: hearthPoint(map), radius: map.tileSize * 6, color: LIGHTS.hearth, flicker: 0.08 },
    ...windowPoints(map).map((at) => ({ at, radius: map.tileSize * 3, color: LIGHTS.window })),
  ];
  for (const villager of scene.world.all()) {
    const bay = map.bays[villager.bay];
    if (bay === undefined) continue;
    const active = villager.atStation;
    lights.push({
      at: bay.station,
      radius: map.tileSize * (active ? 3.5 : 1.5),
      color: stationOf(skinOf(scene, villager)).light,
      ...(active ? { flicker: 0.05 } : {}),
    });
  }
  return lights;
}

function drawWall(ctx: Paint, map: WorkshopMap, time: number): void {
  const bottom = wallBottom(map);
  const tile = map.tileSize;
  ctx.fillStyle = PALETTE.ceiling;
  ctx.fillRect(0, 0, map.width, tile);
  ctx.fillStyle = PALETTE.wall;
  ctx.fillRect(0, tile, map.width, bottom - 2 * tile);
  ctx.fillStyle = PALETTE.trim;
  ctx.fillRect(0, bottom - tile, map.width, tile);
  ctx.fillStyle = PALETTE.window;
  for (const { x, y } of windowPoints(map)) {
    ctx.fillRect(x - tile, y - tile * 0.75, tile * 2, tile * 1.5);
  }
  const hearthX = map.width / 2 - tile * 1.5;
  ctx.fillStyle = PALETTE.brick;
  ctx.fillRect(hearthX, tile, tile * 3, bottom - tile);
  ctx.fillStyle = PALETTE.hearth;
  ctx.fillRect(hearthX + tile / 2, bottom - tile * 2, tile * 2, tile * 2);
  const fire = hearthPoint(map);
  ctx.globalAlpha = 0.75 + 0.25 * Math.sin(time * 9);
  ctx.fillStyle = PALETTE.fire;
  ctx.beginPath();
  ctx.ellipse(fire.x, fire.y, tile * 0.7, tile * 0.6, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawFloor(ctx: Paint, map: WorkshopMap): void {
  ctx.fillStyle = PALETTE.floor;
  ctx.fillRect(0, 0, map.width, map.height);
  ctx.fillStyle = PALETTE.plank;
  for (let y = PLANK_HEIGHT; y < map.height; y += PLANK_HEIGHT) ctx.fillRect(0, y, map.width, 1);
}

function drawCorridor(ctx: Paint, map: WorkshopMap): void {
  const tile = map.tileSize;
  const half = tile * 0.6;
  ctx.fillStyle = PALETTE.corridorTrim;
  ctx.fillRect(tile, map.corridorY - half - 1, map.width - 2 * tile, half * 2 + 2);
  ctx.fillStyle = PALETTE.corridor;
  ctx.fillRect(tile + 1, map.corridorY - half, map.width - 2 * tile - 2, half * 2);
  ctx.fillStyle = PALETTE.table;
  ctx.beginPath();
  ctx.arc(map.width / 2, map.corridorY, tile * 0.75, 0, TAU);
  ctx.fill();
}

function drawBay(ctx: Paint, bay: Bay, index: number, owner: Villager | undefined, scene: Scene) {
  const { x, y, width, height } = bay.area;
  ctx.fillStyle = PALETTE.rugs[index % PALETTE.rugs.length] ?? PALETTE.floor;
  ctx.fillRect(x + RUG_INSET, y + RUG_INSET, width - 2 * RUG_INSET, height - 2 * RUG_INSET);
  ctx.fillStyle = PALETTE.pillar;
  ctx.fillRect(x, y, PILLAR_WIDTH, height);
  ctx.fillRect(x + width - PILLAR_WIDTH, y, PILLAR_WIDTH, height);
  if (owner === undefined) {
    drawEmptyBay(ctx, bay, scene.hovered?.kind === 'bay' && scene.hovered.bay === index);
    return;
  }
  const left = bay.station.x - STATION_SIZE.width / 2;
  const top = bay.station.y - STATION_SIZE.height / 2;
  ctx.fillStyle = PALETTE.station;
  ctx.fillRect(left, top, STATION_SIZE.width, STATION_SIZE.height);
  ctx.fillStyle = owner.atStation ? stationOf(skinOf(scene, owner)).light : PALETTE.stationTop;
  ctx.fillRect(left, top, STATION_SIZE.width, 4);
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

function skinColor(skin: string): string {
  let hash = 0;
  for (const char of skin) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return `hsl(${String(hash)} 45% 55%)`;
}

function drawBody(ctx: Paint, villager: Villager, agent: AgentView | undefined, scene: Scene) {
  const sheet = agent ? scene.sprites.get(agent.skin) : null;
  const manifest = manifestOf(sheet);
  const bounds = villagerBounds(villager, manifest);
  ctx.globalAlpha = villager.activity === 'off' ? 0.5 : 1;
  if (sheet) {
    const frame = frameAt(manifest, villager.pose, villager.facing, scene.time);
    ctx.drawImage(
      sheet.image,
      frame.sx,
      frame.sy,
      frame.width,
      frame.height,
      Math.round(bounds.x),
      Math.round(bounds.y),
      frame.width,
      frame.height,
    );
  } else {
    ctx.fillStyle = skinColor(agent?.skin ?? villager.id);
    ctx.beginPath();
    ctx.ellipse(villager.position.x, villager.position.y - 8, 5, 8, 0, 0, TAU);
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
  drawBody(ctx, villager, scene.agents.get(villager.id), scene);
}

function drawLabels(ctx: Paint, villager: Villager, scene: Scene): void {
  const agent = scene.agents.get(villager.id);
  if (!agent) return;
  const sheet = scene.sprites.get(agent.skin);
  const bounds = villagerBounds(villager, manifestOf(sheet));
  const plateBottom = Math.round(bounds.y + 4);
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
  const owners = new Map(scene.world.all().map((villager) => [villager.bay, villager]));
  const villagers = scene.world.byDepth();
  ctx.save();
  drawFloor(ctx, map);
  drawWall(ctx, map, scene.time);
  drawCorridor(ctx, map);
  map.bays.forEach((bay, index) => {
    drawBay(ctx, bay, index, owners.get(index), scene);
  });
  for (const villager of villagers) drawVillager(ctx, villager, scene);
  scene.particles?.draw(ctx);
  scene.lighting?.draw(ctx, lightsFor(scene), scene.time);
  for (const villager of villagers) drawLabels(ctx, villager, scene);
  ctx.restore();
}
