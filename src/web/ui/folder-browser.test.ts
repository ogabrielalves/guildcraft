// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FsEntry, FsListing } from '../../shared/fs.js';
import { DICTIONARIES, initI18n, setLocale } from '../i18n/index.js';
import type { ListFolders } from './folder-browser.js';
import { createFolderBrowser, homeRoot, isDrive } from './folder-browser.js';

afterEach(() => {
  initI18n({ storage: null, languages: [] });
});

const POSIX_ROOTS: FsEntry[] = [
  { name: '~', path: '/home/me' },
  { name: '/', path: '/' },
];

const WINDOWS_ROOTS: FsEntry[] = [
  { name: '~', path: 'C:\\Users\\me' },
  { name: 'C:', path: 'C:\\' },
  { name: 'D:', path: 'D:\\' },
];

function tree(roots: FsEntry[], folders: Record<string, string[]>): ListFolders {
  return (path) => {
    if (path === null) return Promise.resolve({ path: null, parent: null, entries: [], roots });
    const children = folders[path];
    if (!children) return Promise.reject(new Error('missing'));
    const parent = path === '/' ? null : path.slice(0, path.lastIndexOf('/')) || '/';
    const entries = children.map((name) => ({
      name,
      path: path === '/' ? `/${name}` : `${path}/${name}`,
    }));
    return Promise.resolve({ path, parent, entries, roots });
  };
}

const POSIX_TREE = tree(POSIX_ROOTS, {
  '/': ['home'],
  '/home': ['me'],
  '/home/me': ['code', 'notes'],
  '/home/me/code': [],
});

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function setup(listFolders: ListFolders = POSIX_TREE, initialPath: string | null = null) {
  const onChange = vi.fn();
  const onSelect = vi.fn();
  const browser = createFolderBrowser({ listFolders, initialPath, onChange, onSelect });
  const all = (selector: string) => [...browser.element.querySelectorAll<HTMLElement>(selector)];
  const one = (selector: string) => {
    const found = browser.element.querySelector<HTMLElement>(selector);
    if (!found) throw new Error(`missing ${selector}`);
    return found;
  };
  const button = (selector: string) => {
    const found = one(selector);
    if (!(found instanceof HTMLButtonElement)) throw new Error(`${selector} is not a button`);
    return found;
  };
  const texts = (selector: string) => all(selector).map((node) => node.textContent);
  const clickEntry = (name: string) => {
    const entry = all('.folder-browser__entry, .folder-browser__root').find(
      (node) => node.textContent === name,
    );
    if (!entry) throw new Error(`missing entry ${name}`);
    entry.click();
  };
  return { browser, onChange, onSelect, one, button, texts, clickEntry };
}

describe('helpers', () => {
  it('recognizes drive letters', () => {
    expect(isDrive({ name: 'C:', path: 'C:\\' })).toBe(true);
    expect(isDrive({ name: '~', path: '/home/me' })).toBe(false);
    expect(isDrive({ name: '/', path: '/' })).toBe(false);
  });

  it('finds the home root', () => {
    expect(homeRoot(WINDOWS_ROOTS)?.path).toBe('C:\\Users\\me');
    expect(homeRoot([{ name: 'C:', path: 'C:\\' }])).toBeNull();
  });
});

describe('createFolderBrowser', () => {
  it('opens the home folder first', async () => {
    const { browser, onChange, one, texts } = setup();
    expect(browser.element.getAttribute('aria-busy')).toBe('true');
    await flush();
    expect(browser.getPath()).toBe('/home/me');
    expect(one('.folder-browser__path').textContent).toBe('/home/me');
    expect(texts('.folder-browser__entry')).toEqual(['code', 'notes']);
    expect(texts('.folder-browser__root')).toEqual(['Home', '/']);
    expect(onChange).toHaveBeenCalledExactlyOnceWith('/home/me');
    expect(browser.element.hasAttribute('aria-busy')).toBe(false);
  });

  it('starts at the initial path when given', async () => {
    const { browser } = setup(POSIX_TREE, '/home');
    await flush();
    expect(browser.getPath()).toBe('/home');
  });

  it('falls back to home when the initial path cannot be opened', async () => {
    const { browser, one } = setup(POSIX_TREE, '/gone');
    await flush();
    expect(browser.getPath()).toBe('/home/me');
    expect(one('.folder-browser__status').hidden).toBe(true);
  });

  it('navigates into folders, up and to roots', async () => {
    const { browser, button, clickEntry } = setup();
    await flush();
    clickEntry('code');
    await flush();
    expect(browser.getPath()).toBe('/home/me/code');
    button('.folder-browser__up').click();
    await flush();
    expect(browser.getPath()).toBe('/home/me');
    clickEntry('/');
    await flush();
    expect(browser.getPath()).toBe('/');
    expect(button('.folder-browser__up').disabled).toBe(true);
    button('.folder-browser__up').click();
    clickEntry('Home');
    await flush();
    expect(browser.getPath()).toBe('/home/me');
  });

  it('shows a message for folders without subfolders', async () => {
    const { clickEntry, one } = setup();
    await flush();
    clickEntry('code');
    await flush();
    expect(one('.folder-browser__status').hidden).toBe(false);
    expect(one('.folder-browser__status').textContent).toBe('No subfolders');
  });

  it('keeps the current folder and shows an error when a folder fails', async () => {
    const { browser, clickEntry, one } = setup();
    await flush();
    clickEntry('notes');
    await flush();
    expect(browser.getPath()).toBe('/home/me');
    expect(one('.folder-browser__status').textContent).toBe('Could not open this folder');
  });

  it('shows the error when even the roots fail', async () => {
    const { browser, button, one } = setup(() => Promise.reject(new Error('down')));
    await flush();
    expect(browser.getPath()).toBeNull();
    expect(one('.folder-browser__status').textContent).toBe('Could not open this folder');
    expect(button('.folder-browser__select').disabled).toBe(true);
  });

  it('stays on the roots when there is no home', async () => {
    const roots = [{ name: 'C:', path: 'C:\\' }];
    const { browser, texts } = setup(() =>
      Promise.resolve({ path: null, parent: null, entries: [], roots }),
    );
    await flush();
    expect(browser.getPath()).toBeNull();
    expect(texts('.folder-browser__root')).toEqual(['C:']);
  });

  it('groups Windows drives', async () => {
    const listFolders: ListFolders = (path) =>
      Promise.resolve({ path: path ?? null, parent: null, entries: [], roots: WINDOWS_ROOTS });
    const { texts, one } = setup(listFolders);
    await flush();
    expect(texts('.folder-browser__root')).toEqual(['Home', 'C:', 'D:']);
    expect(one('.folder-browser__drives').firstChild?.textContent).toBe('Drives');
  });

  it('selects the current folder', async () => {
    const { button, onSelect } = setup();
    button('.folder-browser__select').click();
    expect(onSelect).not.toHaveBeenCalled();
    await flush();
    button('.folder-browser__select').click();
    expect(onSelect).toHaveBeenCalledWith('/home/me');
  });

  it('ignores answers that arrive after a newer request', async () => {
    let release: (listing: FsListing) => void = () => undefined;
    const slow = new Promise<FsListing>((resolve) => {
      release = resolve;
    });
    const listFolders: ListFolders = (path) => (path === '/slow' ? slow : POSIX_TREE(path));
    const { browser } = setup(listFolders);
    await flush();
    const pending = browser.open('/slow');
    await browser.open('/home');
    release({ path: '/slow', parent: '/', entries: [], roots: POSIX_ROOTS });
    await pending;
    expect(browser.getPath()).toBe('/home');
  });

  it('translates labels when the locale changes', async () => {
    const { button, texts, clickEntry, one } = setup();
    await flush();
    clickEntry('notes');
    await flush();
    setLocale('pt-BR');
    const pt = DICTIONARIES['pt-BR'];
    expect(button('.folder-browser__up').textContent).toBe(pt.get('folders.up'));
    expect(texts('.folder-browser__root')[0]).toBe(pt.get('folders.home'));
    expect(one('.folder-browser__status').textContent).toBe(pt.get('folders.error'));
  });

  it('stops updating after destroy', async () => {
    const { browser, onChange } = setup();
    document.body.append(browser.element);
    browser.destroy();
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(browser.element.isConnected).toBe(false);
  });
});
