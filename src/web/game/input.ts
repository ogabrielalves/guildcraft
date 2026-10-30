import type { SelectMode } from '../state/store.js';
import type { Point } from './map.js';
import { contains } from './map.js';
import type { Hover } from './renderer.js';
import { villagerBounds } from './renderer.js';
import type { World } from './world.js';

export type Modifiers = Pick<MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>;

export const DRAG_THRESHOLD = 4;
export const WHEEL_ZOOM = 0.0015;

export interface InputOptions {
  canvas: HTMLCanvasElement;
  toWorld(clientX: number, clientY: number): Point;
  hit(point: Point): Hover;
  onSelect(agentId: string, mode: SelectMode): void;
  onHover(hover: Hover, clientX: number, clientY: number): void;
  onPan(dx: number, dy: number): void;
  onZoom(clientX: number, clientY: number, factor: number): void;
}

export function hitTest(world: World, point: Point): Hover {
  const villager = world
    .byDepth()
    .reverse()
    .find((candidate) => contains(villagerBounds(candidate), point));
  return villager === undefined ? null : { kind: 'villager', id: villager.id };
}

export function selectMode(event: Modifiers): SelectMode {
  return event.shiftKey || event.ctrlKey || event.metaKey ? 'toggle' : 'replace';
}

export function wheelFactor(deltaY: number): number {
  return Math.exp(-deltaY * WHEEL_ZOOM);
}

export function bindInput(options: InputOptions): () => void {
  const { canvas } = options;
  const hitAt = (event: MouseEvent) => options.hit(options.toWorld(event.clientX, event.clientY));
  let drag: { x: number; y: number; moved: boolean } | null = null;
  let suppressClick = false;

  const onDown = (event: MouseEvent) => {
    if (event.button !== 0 || hitAt(event) !== null) return;
    drag = { x: event.clientX, y: event.clientY, moved: false };
  };
  const onMove = (event: MouseEvent) => {
    if (drag !== null) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag = { x: event.clientX, y: event.clientY, moved: true };
      canvas.style.cursor = 'grabbing';
      options.onPan(dx, dy);
      return;
    }
    const hover = hitAt(event);
    canvas.style.cursor = hover === null ? '' : 'pointer';
    options.onHover(hover, event.clientX, event.clientY);
  };
  const onUp = () => {
    if (drag?.moved === true) {
      suppressClick = true;
      canvas.style.cursor = '';
    }
    drag = null;
  };
  const onLeave = (event: MouseEvent) => {
    drag = null;
    suppressClick = false;
    canvas.style.cursor = '';
    options.onHover(null, event.clientX, event.clientY);
  };
  const onClick = (event: MouseEvent) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const hover = hitAt(event);
    if (hover !== null) options.onSelect(hover.id, selectMode(event));
  };
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    options.onZoom(event.clientX, event.clientY, wheelFactor(event.deltaY));
  };

  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseup', onUp);
  canvas.addEventListener('mouseleave', onLeave);
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    canvas.removeEventListener('mousedown', onDown);
    canvas.removeEventListener('mousemove', onMove);
    canvas.removeEventListener('mouseup', onUp);
    canvas.removeEventListener('mouseleave', onLeave);
    canvas.removeEventListener('click', onClick);
    canvas.removeEventListener('wheel', onWheel);
  };
}
