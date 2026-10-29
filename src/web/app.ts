import { TOKEN_QUERY } from '../shared/constants.js';
import type { Locale } from './i18n/index.js';
import { getLocale, onLocaleChange, t } from './i18n/index.js';
import type { GameSocket } from './net/socket.js';
import { resolveToken, socketUrl, stripToken } from './net/socket.js';
import type { Store } from './state/store.js';
import { createTopbar } from './ui/topbar.js';

export type SocketPort = Pick<GameSocket, 'getStatus' | 'onMessage' | 'onStatus'>;

export interface LaunchEnvironment {
  page: URL;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  replaceUrl: (url: URL) => void;
}

export function bindSocket(socket: SocketPort, store: Store): () => void {
  store.setConnection(socket.getStatus());
  const unsubscribeStatus = socket.onStatus((status) => {
    store.setConnection(status);
  });
  const unsubscribeMessage = socket.onMessage((message) => {
    store.apply(message);
  });
  return () => {
    unsubscribeStatus();
    unsubscribeMessage();
  };
}

export function launchSocketUrl({ page, storage, replaceUrl }: LaunchEnvironment): string {
  const token = resolveToken(page, storage);
  if (page.searchParams.has(TOKEN_QUERY)) replaceUrl(stripToken(page));
  return socketUrl(page, token);
}

export function applyDocumentLocale(doc: Document, locale: Locale): void {
  doc.documentElement.lang = locale;
  doc.title = t('app.title');
}

export function mountShell(
  root: HTMLElement,
  store: Store,
  overlays: readonly HTMLElement[] = [],
): () => void {
  const topbar = createTopbar(store);
  const stage = document.createElement('main');
  stage.className = 'stage';
  stage.append(...overlays);
  root.replaceChildren(topbar.element, stage);
  applyDocumentLocale(document, getLocale());
  const unsubscribeLocale = onLocaleChange((locale) => {
    applyDocumentLocale(document, locale);
  });
  return () => {
    unsubscribeLocale();
    topbar.destroy();
    stage.remove();
  };
}
