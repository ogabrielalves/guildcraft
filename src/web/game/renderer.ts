import type { AgentView } from '../../shared/agent.js';
import { isWorkingActivity } from './activity.js';
import type { Bay, Rect, WorkshopMap } from './map.js';
import type { CharacterManifest, SpriteSheet } from './sprite-sheet.js';
import { LPC_MANIFEST, frameAt } from './sprite-sheet.js';
import type { Villager } from './villager.js';
import type { World } from './world.js';

export type Paint = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
  | 'globalAlpha'
  | 'fillRect'
  | 'strokeRect'
  | 'beginPath'
  | 'ellipse'
  | 'arc'
  | 'fill'
  | 'stroke'
  | 'fillText'
  | 'measureText'
  | 'drawImage'
  | 'save'
  | 'restore'
>;

export type Hover = { kind: 'villager'; id: string } | { kind: 'bay'; bay: number } | null;

export interface Scene {
  world: World;
  agents: ReadonlyMap<string, AgentView>;
  sprites: { get(skin: string): SpriteSheet | null };
  selected: ReadonlySet<string>;
  focused: string | null;
  hovered: Hover;
  time: number;
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
  glow: '#f2c94c',
  corridor: '#7a2f2a',
  corridorTrim: '#a8483d',
  table: '#5a3a22',
  empty: '#f1e4cf',
  shadow: '#000000',
  selected: '#f0a63a',
  waiting: '#f2c94c',
  plate: '#17110d',
  name: '#f1e4cf',
};

const NAME_FONT = '600 7px system-ui, sans-serif';
const PLANK_HEIGHT = 8;
const RUG_INSET = 8;
const PILLAR_WIDTH = 3;
const STATION_SIZE = { width: 20, height: 16 };

export function wallBottom(map: WorkshopMap): number {
  return Math.min(...map.bays.map((bay) => bay.area.y));
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
  ctx.fillRect(tile * 1.5, tile * 1.5, tile * 2, tile * 1.5);
  ctx.fillRect(map.width - tile * 3.5, tile * 1.5, tile * 2, tile * 1.5);
  const hearthX = map.width / 2 - tile * 1.5;
  ctx.fillStyle = PALETTE.brick;
  ctx.fillRect(hearthX, tile, tile * 3, bottom - tile);
  ctx.fillStyle = PALETTE.hearth;
  ctx.fillRect(hearthX + tile / 2, bottom - tile * 2, tile * 2, tile * 2);
  ctx.globalAlpha = 0.75 + 0.25 * Math.sin(time * 9);
  ctx.fillStyle = PALETTE.fire;
  ctx.beginPath();
  ctx.ellipse(map.width / 2, bottom - tile / 2, tile * 0.7, tile * 0.6, 0, 0, Math.PI * 2);
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
  ctx.arc(map.width / 2, map.corridorY, tile * 0.75, 0, Math.PI * 2);
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
  const working = isWorkingActivity(owner.activity) && !owner.moving && !owner.visiting;
  const left = bay.station.x - STATION_SIZE.width / 2;
  const top = bay.station.y - STATION_SIZE.height / 2;
  if (working) {
    ctx.globalAlpha = 0.25 + 0.1 * Math.sin(scene.time * 6);
    ctx.fillStyle = PALETTE.glow;
    ctx.beginPath();
    ctx.arc(bay.station.x, bay.station.y, STATION_SIZE.width, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = PALETTE.station;
  ctx.fillRect(left, top, STATION_SIZE.width, STATION_SIZE.height);
  ctx.fillStyle = PALETTE.stationTop;
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

function drawRing(ctx: Paint, villager: Villager, scene: Scene): void {
  const { x, y } = villager.position;
  const waiting = villager.activity === 'wait';
  const selected = scene.selected.has(villager.id);
  const hovered = scene.hovered?.kind === 'villager' && scene.hovered.id === villager.id;
  if (!waiting && !selected && !hovered) return;
  ctx.strokeStyle = waiting ? PALETTE.waiting : PALETTE.selected;
  ctx.lineWidth = scene.focused === villager.id ? 2 : 1;
  ctx.globalAlpha = waiting ? 0.6 + 0.4 * Math.sin(scene.time * 5) : selected ? 1 : 0.5;
  ctx.beginPath();
  ctx.ellipse(x, y, 10, 4, 0, 0, Math.PI * 2);
  ctx.stroke();
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
    ctx.ellipse(villager.position.x, villager.position.y - 8, 5, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return bounds;
}

function drawNameplate(ctx: Paint, name: string, centerX: number, top: number): void {
  ctx.font = NAME_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const width = Math.ceil(ctx.measureText(name).width) + 4;
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = PALETTE.plate;
  ctx.fillRect(Math.round(centerX - width / 2), top - 9, width, 9);
  ctx.globalAlpha = 1;
  ctx.fillStyle = PALETTE.name;
  ctx.fillText(name, Math.round(centerX), top - 1);
}

function drawVillager(ctx: Paint, villager: Villager, scene: Scene): void {
  const agent = scene.agents.get(villager.id);
  drawRing(ctx, villager, scene);
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = PALETTE.shadow;
  ctx.beginPath();
  ctx.ellipse(villager.position.x, villager.position.y, 6, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  const bounds = drawBody(ctx, villager, agent, scene);
  if (agent) drawNameplate(ctx, agent.name, villager.position.x, Math.round(bounds.y + 4));
}

export function drawScene(ctx: Paint, scene: Scene): void {
  const { map } = scene.world;
  const owners = new Map(scene.world.all().map((villager) => [villager.bay, villager]));
  ctx.save();
  drawFloor(ctx, map);
  drawWall(ctx, map, scene.time);
  drawCorridor(ctx, map);
  map.bays.forEach((bay, index) => {
    drawBay(ctx, bay, index, owners.get(index), scene);
  });
  for (const villager of scene.world.byDepth()) drawVillager(ctx, villager, scene);
  ctx.restore();
}
