import type { FsEntry, FsListing } from '../../shared/fs.js';
import type { TranslationKey } from '../i18n/index.js';
import { onLocaleChange, t } from '../i18n/index.js';

const DRIVE_PATTERN = /^[A-Za-z]:$/;

export type ListFolders = (path: string | null) => Promise<FsListing>;

export interface FolderBrowserOptions {
  listFolders: ListFolders;
  initialPath?: string | null;
  onChange?: (path: string | null) => void;
  onSelect?: (path: string) => void;
}

export interface FolderBrowser {
  readonly element: HTMLElement;
  getPath(): string | null;
  open(path: string | null): Promise<void>;
  destroy(): void;
}

export function isDrive(entry: FsEntry): boolean {
  return DRIVE_PATTERN.test(entry.name);
}

export function homeRoot(roots: readonly FsEntry[]): FsEntry | null {
  return roots.find((root) => !isDrive(root)) ?? null;
}

export function createFolderBrowser(options: FolderBrowserOptions): FolderBrowser {
  const { listFolders } = options;
  const labels = new Map<HTMLElement, TranslationKey>();
  let listing: FsListing | null = null;
  let request = 0;
  let destroyed = false;

  const element = document.createElement('div');
  element.className = 'folder-browser';

  const roots = document.createElement('nav');
  roots.className = 'folder-browser__roots';

  const bar = document.createElement('div');
  bar.className = 'folder-browser__bar';
  const up = document.createElement('button');
  up.type = 'button';
  up.className = 'folder-browser__up';
  labels.set(up, 'folders.up');
  const current = document.createElement('span');
  current.className = 'folder-browser__path';
  bar.append(up, current);

  const list = document.createElement('ul');
  list.className = 'folder-browser__list';

  const status = document.createElement('p');
  status.className = 'folder-browser__status';
  status.setAttribute('role', 'status');

  const select = document.createElement('button');
  select.type = 'button';
  select.className = 'folder-browser__select';
  labels.set(select, 'folders.select');

  element.append(roots, bar, list, status, select);

  const entryButton = (entry: FsEntry, label: string, className: string) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.title = entry.path;
    button.addEventListener('click', () => {
      void open(entry.path);
    });
    return button;
  };

  const renderRoots = (entries: readonly FsEntry[]) => {
    const home = homeRoot(entries);
    const drives = entries.filter(isDrive);
    const others = entries.filter((entry) => entry !== home && !isDrive(entry));
    const children: HTMLElement[] = [];
    if (home) children.push(entryButton(home, t('folders.home'), 'folder-browser__root'));
    for (const entry of others) {
      children.push(entryButton(entry, entry.name, 'folder-browser__root'));
    }
    if (drives.length > 0) {
      const group = document.createElement('span');
      group.className = 'folder-browser__drives';
      const label = document.createElement('span');
      label.textContent = t('folders.drives');
      group.append(label, ...drives.map((d) => entryButton(d, d.name, 'folder-browser__root')));
      children.push(group);
    }
    roots.replaceChildren(...children);
  };

  const renderStatus = (key: TranslationKey | null) => {
    status.hidden = key === null;
    status.dataset.key = key ?? '';
    status.textContent = key === null ? '' : t(key);
  };

  const render = (failed: boolean) => {
    renderRoots(listing?.roots ?? []);
    const path = listing?.path ?? null;
    current.textContent = path ?? '';
    current.title = path ?? '';
    up.disabled = !listing?.parent;
    select.disabled = path === null;
    const entries = listing?.entries ?? [];
    list.replaceChildren(
      ...entries.map((entry) => {
        const item = document.createElement('li');
        item.append(entryButton(entry, entry.name, 'folder-browser__entry'));
        return item;
      }),
    );
    if (failed) renderStatus('folders.error');
    else renderStatus(path !== null && entries.length === 0 ? 'folders.empty' : null);
  };

  const open = async (path: string | null): Promise<void> => {
    const id = ++request;
    element.setAttribute('aria-busy', 'true');
    let next: FsListing | null = null;
    try {
      next = await listFolders(path);
    } catch {
      next = null;
    }
    if (destroyed || id !== request) return;
    element.removeAttribute('aria-busy');
    if (!next && !listing && path !== null) {
      await open(null);
      return;
    }
    if (!next) {
      render(true);
      return;
    }
    const home = next.path === null ? homeRoot(next.roots) : null;
    listing = next;
    if (home) {
      await open(home.path);
      return;
    }
    render(false);
    options.onChange?.(next.path);
  };

  up.addEventListener('click', () => {
    if (listing?.parent) void open(listing.parent);
  });
  select.addEventListener('click', () => {
    if (listing?.path) options.onSelect?.(listing.path);
  });

  const renderTexts = () => {
    for (const [target, key] of labels) target.textContent = t(key);
    const failed = status.dataset.key === 'folders.error';
    render(failed);
  };

  renderTexts();
  void open(options.initialPath ?? null);
  const unsubscribeLocale = onLocaleChange(renderTexts);

  return {
    element,
    getPath: () => listing?.path ?? null,
    open,
    destroy() {
      destroyed = true;
      unsubscribeLocale();
      element.remove();
    },
  };
}
