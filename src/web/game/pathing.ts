import type { Point, Rect, WorkshopMap } from './map.js';
import { contains } from './map.js';

export const NAV_CELL = 8;
const DIAGONAL = Math.SQRT2;
const STEPS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, DIAGONAL],
  [1, -1, DIAGONAL],
  [-1, 1, DIAGONAL],
  [-1, -1, DIAGONAL],
] as const;

function withoutRepeats(points: Point[]): Point[] {
  const kept: Point[] = [];
  for (const point of points) {
    const last = kept.at(-1);
    if (last?.x !== point.x || last.y !== point.y) kept.push(point);
  }
  return kept;
}

class Heap {
  private readonly items: [number, number][] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, priority: number): void {
    const { items } = this;
    items.push([item, priority]);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const [above, below] = [items[parent], items[index]];
      if (above === undefined || below === undefined || above[1] <= below[1]) break;
      [items[parent], items[index]] = [below, above];
      index = parent;
    }
  }

  pop(): number {
    const { items } = this;
    const top = items[0];
    const last = items.pop();
    if (top === undefined || last === undefined) throw new RangeError('empty heap');
    if (items.length === 0) return top[0];
    items[0] = last;
    let index = 0;
    for (;;) {
      let smallest = index;
      for (const child of [index * 2 + 1, index * 2 + 2]) {
        const candidate = items[child];
        const best = items[smallest];
        if (candidate !== undefined && best !== undefined && candidate[1] < best[1]) {
          smallest = child;
        }
      }
      if (smallest === index) return top[0];
      const [a, b] = [items[index], items[smallest]];
      if (a === undefined || b === undefined) return top[0];
      [items[index], items[smallest]] = [b, a];
      index = smallest;
    }
  }
}

export class NavGrid {
  readonly columns: number;
  readonly rows: number;
  private readonly blocked: Uint8Array;

  constructor(
    map: Pick<WorkshopMap, 'width' | 'height' | 'obstacles'>,
    readonly cell = NAV_CELL,
    within: readonly Rect[] | null = null,
  ) {
    this.columns = Math.ceil(map.width / cell);
    this.rows = Math.ceil(map.height / cell);
    this.blocked = new Uint8Array(this.columns * this.rows);
    for (const { x, y, width, height } of map.obstacles) {
      const left = Math.max(0, Math.floor(x / cell));
      const right = Math.min(this.columns, Math.ceil((x + width) / cell));
      const top = Math.max(0, Math.floor(y / cell));
      const bottom = Math.min(this.rows, Math.ceil((y + height) / cell));
      for (let row = top; row < bottom; row++) {
        this.blocked.fill(1, row * this.columns + left, row * this.columns + right);
      }
    }
    if (within !== null) {
      this.blocked.forEach((_, index) => {
        const center = this.center(index % this.columns, Math.floor(index / this.columns));
        if (!within.some((area) => contains(area, center))) this.blocked[index] = 1;
      });
    }
    this.keepLargestArea();
  }

  open(column: number, row: number): boolean {
    if (column < 0 || row < 0 || column >= this.columns || row >= this.rows) return false;
    return this.blocked[row * this.columns + column] === 0;
  }

  walkable(point: Point): boolean {
    return this.open(Math.floor(point.x / this.cell), Math.floor(point.y / this.cell));
  }

  nearest(point: Point): Point {
    if (this.walkable(point)) return point;
    const column = Math.floor(point.x / this.cell);
    const row = Math.floor(point.y / this.cell);
    const limit = Math.max(this.columns, this.rows);
    for (let radius = 1; radius <= limit; radius++) {
      let best: Point | null = null;
      let distance = Infinity;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          if (!this.open(column + dx, row + dy)) continue;
          const center = this.center(column + dx, row + dy);
          const away = Math.hypot(center.x - point.x, center.y - point.y);
          if (away < distance) [best, distance] = [center, away];
        }
      }
      if (best !== null) return best;
    }
    return point;
  }

  randomPoint(random: () => number = Math.random): Point {
    const open: number[] = [];
    this.blocked.forEach((value, index) => {
      if (value === 0) open.push(index);
    });
    const index = open[Math.floor(random() * open.length)];
    if (index === undefined) throw new RangeError('no walkable cell');
    return this.center(index % this.columns, Math.floor(index / this.columns));
  }

  clear(from: Point, to: Point): boolean {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.ceil(length / (this.cell / 4));
    for (let step = 0; step <= steps; step++) {
      const ratio = steps === 0 ? 0 : step / steps;
      const x = from.x + (to.x - from.x) * ratio;
      const y = from.y + (to.y - from.y) * ratio;
      if (!this.walkable({ x, y })) return false;
    }
    return true;
  }

  route(from: Point, to: Point): Point[] {
    const start = this.nearest(from);
    const goal = this.nearest(to);
    const cells = this.search(start, goal);
    if (cells === null) return withoutRepeats([from, to]);
    const inner = this.smooth([start, ...cells.slice(1, -1), goal]);
    return withoutRepeats([from, ...inner, to]);
  }

  private keepLargestArea(): void {
    const area = new Int32Array(this.blocked.length).fill(-1);
    const sizes: number[] = [];
    this.blocked.forEach((value, start) => {
      if (value === 1 || area[start] !== -1) return;
      const id = sizes.length;
      const stack = [start];
      area[start] = id;
      let size = 0;
      for (let cell = stack.pop(); cell !== undefined; cell = stack.pop()) {
        size++;
        const column = cell % this.columns;
        const row = Math.floor(cell / this.columns);
        for (const [dx, dy] of STEPS.slice(0, 4)) {
          const next = (row + dy) * this.columns + column + dx;
          if (this.open(column + dx, row + dy) && area[next] === -1) {
            area[next] = id;
            stack.push(next);
          }
        }
      }
      sizes.push(size);
    });
    const largest = sizes.indexOf(Math.max(...sizes));
    area.forEach((id, cell) => {
      if (id !== -1 && id !== largest) this.blocked[cell] = 1;
    });
  }

  private center(column: number, row: number): Point {
    return { x: (column + 0.5) * this.cell, y: (row + 0.5) * this.cell };
  }

  private search(start: Point, goal: Point): Point[] | null {
    const { columns } = this;
    const index = (point: Point) =>
      Math.floor(point.y / this.cell) * columns + Math.floor(point.x / this.cell);
    const first = index(start);
    const last = index(goal);
    const cost = new Float64Array(this.blocked.length).fill(Infinity);
    const from = new Int32Array(this.blocked.length).fill(-1);
    const heuristic = (cell: number) => {
      const dx = Math.abs((cell % columns) - (last % columns));
      const dy = Math.abs(Math.floor(cell / columns) - Math.floor(last / columns));
      return Math.max(dx, dy) + (DIAGONAL - 1) * Math.min(dx, dy);
    };
    const open = new Heap();
    cost[first] = 0;
    open.push(first, heuristic(first));
    while (open.size > 0) {
      const current = open.pop();
      if (current === last) return this.trace(from, current);
      const column = current % columns;
      const row = Math.floor(current / columns);
      for (const [dx, dy, step] of STEPS) {
        if (!this.open(column + dx, row + dy)) continue;
        if (dx !== 0 && dy !== 0 && !(this.open(column + dx, row) && this.open(column, row + dy))) {
          continue;
        }
        const next = (row + dy) * columns + column + dx;
        const total = (cost[current] ?? Infinity) + step;
        if (total >= (cost[next] ?? Infinity)) continue;
        cost[next] = total;
        from[next] = current;
        open.push(next, total + heuristic(next));
      }
    }
    return null;
  }

  private trace(from: Int32Array, end: number): Point[] {
    const cells: Point[] = [];
    for (let cell = end; cell !== -1; cell = from[cell] ?? -1) {
      cells.unshift(this.center(cell % this.columns, Math.floor(cell / this.columns)));
    }
    return cells;
  }

  private smooth(points: Point[]): Point[] {
    const first = points[0];
    if (first === undefined) return [];
    const kept = [first];
    let anchor = 0;
    while (anchor < points.length - 1) {
      let next = anchor + 1;
      for (let candidate = points.length - 1; candidate > anchor + 1; candidate--) {
        const [a, b] = [points[anchor], points[candidate]];
        if (a !== undefined && b !== undefined && this.clear(a, b)) {
          next = candidate;
          break;
        }
      }
      const point = points[next];
      if (point !== undefined) kept.push(point);
      anchor = next;
    }
    return kept;
  }
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
