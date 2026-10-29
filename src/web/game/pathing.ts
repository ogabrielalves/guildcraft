import type { Point, WorkshopMap } from './map.js';
import { bayAt } from './map.js';

export interface Place {
  bay: number;
  point: Point;
}

function withoutRepeats(points: Point[]): Point[] {
  const kept: Point[] = [];
  for (const point of points) {
    const last = kept.at(-1);
    if (last?.x !== point.x || last.y !== point.y) kept.push(point);
  }
  return kept;
}

function segments(points: readonly Point[]): [Point, Point, number][] {
  const result: [Point, Point, number][] = [];
  points.forEach((current, index) => {
    const previous = points[index - 1];
    if (previous === undefined) return;
    result.push([previous, current, Math.hypot(current.x - previous.x, current.y - previous.y)]);
  });
  return result;
}

export function route(map: WorkshopMap, from: Place, to: Place): Point[] {
  const exit = bayAt(map, from.bay).door;
  const entry = bayAt(map, to.bay).door;
  if (from.bay === to.bay) return withoutRepeats([from.point, to.point]);
  return withoutRepeats([
    from.point,
    exit,
    { x: exit.x, y: map.corridorY },
    { x: entry.x, y: map.corridorY },
    entry,
    to.point,
  ]);
}

export function routeLength(points: readonly Point[]): number {
  return segments(points).reduce((total, [, , length]) => total + length, 0);
}

export function pointAlong(points: readonly Point[], distance: number): Point {
  const first = points[0];
  if (first === undefined) throw new RangeError('empty route');
  let remaining = Math.max(0, distance);
  for (const [start, end, length] of segments(points)) {
    if (remaining <= length) {
      const ratio = length === 0 ? 1 : remaining / length;
      return { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
    }
    remaining -= length;
  }
  const last = points.at(-1) ?? first;
  return { x: last.x, y: last.y };
}
