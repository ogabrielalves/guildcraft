import type { SelectMode } from '../state/store.js';
import type { Point } from './map.js';
import { contains } from './map.js';
import type { Hover } from './renderer.js';
import { manifestOf, villagerBounds } from './renderer.js';
import type { SpriteSheet } from './sprite-sheet.js';
import type { World } from './world.js';

export type Modifiers = Pick<MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>;

export interface HitTarget {
  world: World;
  skinOf: (agentId: string) => string | undefined;
  sprites: { get(skin: string): SpriteSheet | null };
}

export interface InputOptions {
  canvas: HTMLCanvasElement;
  toWorld(clientX: number, clientY: number): Point;
  hit(point: Point): Hover;
  onSelect(agentId: string, mode: SelectMode): void;
  onRecruit(bay: number): void;
  onHover(hover: Hover, clientX: number, clientY: number): void;
}

export function hitTest({ world, skinOf, sprites }: HitTarget, point: Point): Hover {
  for (const villager of world.byDepth().reverse()) {
    const skin = skinOf(villager.id);
    const manifest = manifestOf(skin === undefined ? null : sprites.get(skin));
    if (contains(villagerBounds(villager, manifest), point)) {
      return { kind: 'villager', id: villager.id };
    }
  }
  const occupied = world.occupiedBays();
  const bay = world.map.bays.findIndex(({ area }) => contains(area, point));
  return bay === -1 || occupied.has(bay) ? null : { kind: 'bay', bay };
}

export function selectMode(event: Modifiers): SelectMode {
  return event.shiftKey || event.ctrlKey || event.metaKey ? 'toggle' : 'replace';
}

export function bindInput(options: InputOptions): () => void {
  const { canvas } = options;
  const hitAt = (event: MouseEvent) => options.hit(options.toWorld(event.clientX, event.clientY));

  const onMove = (event: MouseEvent) => {
    const hover = hitAt(event);
    canvas.style.cursor = hover === null ? '' : 'pointer';
    options.onHover(hover, event.clientX, event.clientY);
  };
  const onLeave = (event: MouseEvent) => {
    canvas.style.cursor = '';
    options.onHover(null, event.clientX, event.clientY);
  };
  const onClick = (event: MouseEvent) => {
    const hover = hitAt(event);
    if (hover?.kind === 'villager') options.onSelect(hover.id, selectMode(event));
    if (hover?.kind === 'bay') options.onRecruit(hover.bay);
  };

  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  canvas.addEventListener('click', onClick);
  return () => {
    canvas.removeEventListener('mousemove', onMove);
    canvas.removeEventListener('mouseleave', onLeave);
    canvas.removeEventListener('click', onClick);
  };
}
