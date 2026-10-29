import type { FetchLike } from '../net/api.js';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

export class AssetError extends Error {
  constructor(readonly path: string) {
    super(`invalid asset at ${path}`);
    this.name = 'AssetError';
  }
}

export type Fields = Partial<Record<string, unknown>>;

const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const ASSET_PATH = /^(?![./])(?!.*\.\.)[A-Za-z0-9_./-]+\.png$/;

export function fields(value: unknown, path: string): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AssetError(path);
  }
  return value;
}

export function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new AssetError(path);
  return value;
}

export function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new AssetError(path);
  return value;
}

export function positive(value: unknown, path: string): number {
  const number = finite(value, path);
  if (number <= 0) throw new AssetError(path);
  return number;
}

export function count(value: unknown, path: string, min = 0): number {
  const number = finite(value, path);
  if (!Number.isInteger(number) || number < min) throw new AssetError(path);
  return number;
}

export function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new AssetError(path);
  return value;
}

export function color(value: unknown, path: string): string {
  if (typeof value !== 'string' || !COLOR.test(value)) throw new AssetError(path);
  return value;
}

export function imagePath(value: unknown, path: string): string {
  if (typeof value !== 'string' || !ASSET_PATH.test(value)) throw new AssetError(path);
  return value;
}

export function point(value: unknown, path: string): Point {
  const { x, y } = fields(value, path);
  return { x: finite(x, `${path}.x`), y: finite(y, `${path}.y`) };
}

export function size(value: unknown, path: string): Size {
  const { width, height } = fields(value, path);
  return { width: positive(width, `${path}.width`), height: positive(height, `${path}.height`) };
}

export function rect(value: unknown, path: string): Rect {
  return { ...point(value, path), ...size(value, path) };
}

export function optional<T>(
  value: unknown,
  parse: (value: unknown, path: string) => T,
  path: string,
  fallback: T,
): T {
  return value === undefined ? fallback : parse(value, path);
}

export async function fetchJson(url: string, request: FetchLike): Promise<unknown> {
  const response = await request(url);
  if (!response.ok) throw new AssetError(url);
  return response.json();
}
