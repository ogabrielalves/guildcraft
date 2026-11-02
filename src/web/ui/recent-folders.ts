export const MAX_RECENT_FOLDERS = 5;
const STORAGE_KEY = 'guildcraft.recentFolders';

export type RecentStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): RecentStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadRecentFolders(storage: RecentStorage | null = browserStorage()): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === 'string' && entry !== '')
      .slice(0, MAX_RECENT_FOLDERS);
  } catch {
    return [];
  }
}

export function rememberFolder(
  path: string,
  storage: RecentStorage | null = browserStorage(),
): string[] {
  const next = [path, ...loadRecentFolders(storage).filter((entry) => entry !== path)].slice(
    0,
    MAX_RECENT_FOLDERS,
  );
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage may be blocked or full; the list just won't persist
  }
  return next;
}
