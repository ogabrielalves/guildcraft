import { describe, expect, it, vi } from 'vitest';
import { AssetLibrary, NO_ASSETS } from './assets.js';

const character = {
  station: 'stove',
  facing: 'side',
  animations: Object.fromEntries(
    ['idle', 'walk', 'work', 'sit', 'cheer'].map((pose) => [
      pose,
      {
        image: pose === 'walk' ? 'run.png' : 'idle.png',
        frame: { width: 32, height: 32 },
        anchor: { x: 16, y: 31 },
        frames: 4,
        fps: 6,
      },
    ]),
  ),
};

const station = {
  image: 'stations/stove.png',
  frame: { width: 48, height: 32 },
  anchor: { x: 24, y: 31 },
  effect: 'magic',
};

function setup(files: Record<string, unknown>) {
  const loadImage = vi.fn((url: string) =>
    url.includes('broken')
      ? Promise.reject(new Error('broken'))
      : Promise.resolve({ url } as unknown as CanvasImageSource),
  );
  const request = vi.fn((url: string) =>
    Promise.resolve(
      url in files ? Response.json(files[url]) : new Response('missing', { status: 404 }),
    ),
  );
  const onError = vi.fn();
  const library = new AssetLibrary({ loadImage, request, onError });
  return { library, loadImage, request, onError };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AssetLibrary', () => {
  it('loads a character manifest from its folder and preloads its sheets', async () => {
    const { library, loadImage, request } = setup({
      '/assets/characters/mortis/mortis.json': character,
    });
    expect(library.character('mortis')).toBeNull();
    await settle();
    const loaded = library.character('mortis');
    expect(loaded?.base).toBe('/assets/characters/mortis/');
    expect(loaded?.manifest.station).toBe('stove');
    expect(request).toHaveBeenCalledTimes(1);
    expect(loadImage.mock.calls.map(([url]) => url).sort()).toEqual([
      '/assets/characters/mortis/idle.png',
      '/assets/characters/mortis/run.png',
    ]);
  });

  it('loads a station manifest with images relative to the asset root', async () => {
    const { library, loadImage } = setup({ '/assets/stations/stove.json': station });
    library.station('stove');
    await settle();
    expect(library.station('stove')).toMatchObject({ base: '/assets/' });
    expect(loadImage).toHaveBeenCalledWith('/assets/stations/stove.png');
    expect(library.image('/assets/stations/stove.png')).toEqual({
      url: '/assets/stations/stove.png',
    });
  });

  it('reports failures once and keeps the asset empty', async () => {
    const { library, onError, request } = setup({
      '/assets/characters/bad/bad.json': { facing: 'up' },
    });
    library.character('ghost');
    library.character('bad');
    library.image('/assets/broken.png');
    await settle();
    expect(library.character('ghost')).toBeNull();
    expect(library.character('bad')).toBeNull();
    expect(library.image('/assets/broken.png')).toBeNull();
    expect(onError.mock.calls.map(([url]) => String(url)).sort()).toEqual([
      '/assets/broken.png',
      'bad',
      'ghost',
    ]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('escapes ids and supports another root', async () => {
    const request = vi.fn(() => Promise.resolve(new Response('', { status: 404 })));
    const library = new AssetLibrary({ loadImage: vi.fn(), request, root: '/static' });
    library.character('a b');
    library.station('c/d');
    await settle();
    expect(request.mock.calls).toEqual([
      ['/static/characters/a%20b/a%20b.json'],
      ['/static/stations/c%2Fd.json'],
    ]);
    expect(library.url('maps/workshop.json')).toBe('/static/maps/workshop.json');
  });
});

describe('NO_ASSETS', () => {
  it('never has anything loaded', () => {
    expect(NO_ASSETS.image('/a.png')).toBeNull();
    expect(NO_ASSETS.character('a')).toBeNull();
    expect(NO_ASSETS.station('a')).toBeNull();
    expect(NO_ASSETS.url('x.png')).toBe('x.png');
  });
});
