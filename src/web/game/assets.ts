import type { FetchLike } from '../net/api.js';
import { fetchJson } from './parse.js';
import type { CharacterManifest } from './sprite-sheet.js';
import { parseCharacterManifest } from './sprite-sheet.js';
import type { StationManifest } from './stations.js';
import { parseStationManifest } from './stations.js';

export const ASSET_ROOT = '/assets';

export interface Loaded<T> {
  manifest: T;
  base: string;
}

export type Character = Loaded<CharacterManifest>;
export type Station = Loaded<StationManifest>;

export interface Assets {
  image(url: string): CanvasImageSource | null;
  character(skin: string): Character | null;
  station(id: string): Station | null;
  url(path: string): string;
}

export interface AssetOptions {
  loadImage(url: string): Promise<CanvasImageSource>;
  request: FetchLike;
  root?: string;
  onError?: (url: string, error: unknown) => void;
}

class Cache<T> {
  private readonly entries = new Map<string, T | null>();

  constructor(
    private readonly load: (key: string) => Promise<T>,
    private readonly onError: (key: string, error: unknown) => void,
  ) {}

  get(key: string): T | null {
    if (!this.entries.has(key)) {
      this.entries.set(key, null);
      this.load(key).then(
        (value) => {
          this.entries.set(key, value);
        },
        (error: unknown) => {
          this.onError(key, error);
        },
      );
    }
    return this.entries.get(key) ?? null;
  }
}

export class AssetLibrary implements Assets {
  private readonly root: string;
  private readonly images: Cache<CanvasImageSource>;
  private readonly characters: Cache<Character>;
  private readonly stations: Cache<Station>;

  constructor(options: AssetOptions) {
    this.root = options.root ?? ASSET_ROOT;
    const onError = options.onError ?? (() => undefined);
    this.images = new Cache((url) => options.loadImage(url), onError);
    this.characters = new Cache(async (skin) => {
      const base = `${this.root}/characters/${encodeURIComponent(skin)}/`;
      const raw = await fetchJson(`${base}${encodeURIComponent(skin)}.json`, options.request);
      const manifest = parseCharacterManifest(raw);
      for (const animation of Object.values(manifest.animations))
        this.image(base + animation.image);
      return { manifest, base };
    }, onError);
    this.stations = new Cache(async (id) => {
      const url = `${this.root}/stations/${encodeURIComponent(id)}.json`;
      const manifest = parseStationManifest(await fetchJson(url, options.request));
      this.image(this.url(manifest.image));
      return { manifest, base: `${this.root}/` };
    }, onError);
  }

  image(url: string): CanvasImageSource | null {
    return this.images.get(url);
  }

  character(skin: string): Character | null {
    return this.characters.get(skin);
  }

  station(id: string): Station | null {
    return this.stations.get(id);
  }

  url(path: string): string {
    return `${this.root}/${path}`;
  }
}

export const NO_ASSETS: Assets = {
  image: () => null,
  character: () => null,
  station: () => null,
  url: (path) => path,
};
