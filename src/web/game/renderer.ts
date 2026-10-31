import type { AgentView } from '../../shared/agent.js';
import { folderName } from '../../shared/agent.js';
import type { Assets, Station } from './assets.js';
import { ALERT_ICON, bubbleFor, drawBubble, drawNote } from './draw/bubble.js';
import type { Emitter, Particles } from './draw/effects.js';
import { drawFolderTag, drawNameplate } from './draw/nameplate.js';
import type { Paint } from './draw/paint.js';
import { TAU } from './draw/paint.js';
import { drawRing, drawShadow } from './draw/rings.js';
import type { Point, Rect, Scenery, StationPlace, WorkshopMap } from './map.js';
import { frameAt } from './sprite-sheet.js';
import { DEFAULT_EFFECT, stationFrame } from './stations.js';
import type { Villager } from './villager.js';
import type { World } from './world.js';

export type Hover = { kind: 'villager'; id: string } | null;

export interface Scene {
  world: World;
  agents: ReadonlyMap<string, AgentView>;
  assets: Assets;
  selected: ReadonlySet<string>;
  focused: string | null;
  hovered: Hover;
  time: number;
  particles?: Particles;
  alerts?: ReadonlySet<string>;
}

export const PALETTE = {
  station: '#8a6a45',
  stationTop: '#a88456',
  stationActive: '#ffd76a',
};

export const STATION_RATE = 8;
export const HEARTH_RATE = 5;
export const BODY = { width: 16, height: 30 };
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

export function stationBox(place: StationPlace, station: Station | null): Rect {
  if (!station) {
    const { width, height } = PLACEHOLDER;
    return { x: place.at.x - width / 2, y: place.at.y - height, width, height };
  }
  const { anchor, frame } = station.manifest;
  return {
    x: place.at.x - anchor.x,
    y: place.at.y - anchor.y,
    width: frame.width,
    height: frame.height,
  };
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
    const place = map.stations[villager.station];
    if (!villager.atStation || place === undefined) continue;
    const station = place.id === null ? null : scene.assets.station(place.id);
    const box = stationBox(place, station);
    const emit = station?.manifest.emit ?? { x: box.width / 2, y: 0 };
    emitters.push({
      key: `station:${String(villager.station)}`,
      kind: place.effect ?? station?.manifest.effect ?? DEFAULT_EFFECT,
      at: place.id === null ? place.at : { x: box.x + emit.x, y: box.y + emit.y },
      rate: STATION_RATE,
    });
  }
  return emitters;
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

function drawSceneryItem(ctx: Paint, item: Scenery, assets: Assets): void {
  if (item.kind === 'fill') {
    ctx.fillStyle = item.color;
    ctx.fillRect(item.area.x, item.area.y, item.area.width, item.area.height);
    return;
  }
  const image = assets.image(assets.url(item.image));
  if (image) drawTiled(ctx, image, item);
}

function drawFloor(ctx: Paint, map: WorkshopMap, assets: Assets): void {
  ctx.fillStyle = map.floor;
  ctx.fillRect(0, 0, map.width, map.height);
  for (const item of map.scenery) {
    if (item.depth === null) drawSceneryItem(ctx, item, assets);
  }
}

function drawStation(
  ctx: Paint,
  place: StationPlace & { id: string },
  active: boolean,
  scene: Scene,
): void {
  const station = scene.assets.station(place.id);
  const box = stationBox(place, station);
  const image = station ? scene.assets.image(station.base + station.manifest.image) : null;
  if (station && image) {
    const frame = stationFrame(station.manifest, active, scene.time);
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
  ctx.fillStyle = active ? PALETTE.stationActive : PALETTE.stationTop;
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
      waiting: villager.activity === 'wait' || scene.alerts?.has(villager.id) === true,
      selected: scene.selected.has(villager.id),
      focused: scene.focused === villager.id,
      hovered: scene.hovered?.kind === 'villager' && scene.hovered.id === villager.id,
    },
    scene.time,
  );
  drawShadow(ctx, villager.position);
  drawBody(ctx, villager, scene);
}

const TAG_GAP = 4;

function drawStationTags(ctx: Paint, scene: Scene): void {
  const drawn = new Set<string>();
  for (const villager of scene.world.all()) {
    const place = scene.world.map.stations[villager.station];
    const cwd = scene.agents.get(villager.id)?.cwd;
    const folder = cwd === undefined ? '' : folderName(cwd);
    if (place === undefined || folder === '') continue;
    if (villager.zone !== null) {
      const key = `${villager.zone}/${folder}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
    }
    drawFolderTag(ctx, folder, place.work.x, Math.round(place.work.y + TAG_GAP));
  }
}

function drawLabels(ctx: Paint, villager: Villager, scene: Scene): void {
  const agent = scene.agents.get(villager.id);
  if (!agent) return;
  const plateBottom = Math.round(villagerBounds(villager).y);
  drawNameplate(ctx, agent.name, agent.queued, villager.position.x, plateBottom);
  const bubbleBottom = plateBottom - 10;
  if (scene.alerts?.has(villager.id) === true) {
    drawBubble(ctx, ALERT_ICON, villager.position.x, bubbleBottom, scene.time);
    return;
  }
  const { note } = villager;
  if (note !== null && note !== '') {
    drawNote(ctx, note, villager.position.x, bubbleBottom, scene.time);
    return;
  }
  const bubble = bubbleFor(villager.activity, villager.visiting, villager.doing);
  if (bubble !== null) drawBubble(ctx, bubble, villager.position.x, bubbleBottom, scene.time);
}

export function drawScene(ctx: Paint, scene: Scene): void {
  const { world } = scene;
  const { map } = world;
  ctx.save();
  drawFloor(ctx, map, scene.assets);
  const layers = [
    ...map.scenery.flatMap((item) =>
      item.depth === null
        ? []
        : [
            {
              depth: item.depth,
              draw: () => {
                drawSceneryItem(ctx, item, scene.assets);
              },
            },
          ],
    ),
    ...map.stations.flatMap(({ id, ...place }, index) =>
      id === null
        ? []
        : [
            {
              depth: place.at.y,
              draw: () => {
                drawStation(ctx, { ...place, id }, world.owner(index)?.atStation ?? false, scene);
              },
            },
          ],
    ),
    ...scene.world.all().map((villager) => ({
      depth: villager.position.y,
      draw: () => {
        drawVillager(ctx, villager, scene);
      },
    })),
  ].sort((a, b) => a.depth - b.depth);
  for (const layer of layers) layer.draw();
  scene.particles?.draw(ctx);
  drawStationTags(ctx, scene);
  for (const villager of scene.world.byDepth()) drawLabels(ctx, villager, scene);
  ctx.restore();
}
