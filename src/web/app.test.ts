// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '../shared/protocol.js';
import type { SocketPort } from './app.js';
import { applyDocumentLocale, bindSocket, launchSocketUrl, mountShell } from './app.js';
import { initI18n, setLocale } from './i18n/index.js';
import type { MessageListener, SocketStatus, StatusListener } from './net/socket.js';
import { TOKEN_STORAGE_KEY } from './net/socket.js';
import { Store } from './state/store.js';

function fakeSocket(status: SocketStatus = 'closed') {
  const messages = new Set<MessageListener>();
  const statuses = new Set<StatusListener>();
  const socket: SocketPort = {
    getStatus: () => status,
    onMessage: (listener) => {
      messages.add(listener);
      return () => messages.delete(listener);
    },
    onStatus: (listener) => {
      statuses.add(listener);
      return () => statuses.delete(listener);
    },
  };
  return {
    socket,
    emitStatus: (next: SocketStatus) => {
      for (const listener of statuses) listener(next);
    },
    emitMessage: (message: ServerMessage) => {
      for (const listener of messages) listener(message);
    },
  };
}

afterEach(() => {
  initI18n({ storage: null, languages: [] });
  document.body.replaceChildren();
});

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

describe('bindSocket', () => {
  it('mirrors socket status and messages into the store', () => {
    const { socket, emitStatus, emitMessage } = fakeSocket('closed');
    const store = new Store();
    bindSocket(socket, store);
    expect(store.getState().connection).toBe('closed');
    emitStatus('unauthorized');
    expect(store.getState().connection).toBe('unauthorized');
    emitMessage({ type: 'session:init', agents: [], events: [], skins: ['mortis'] });
    expect(store.getState().skins).toEqual(['mortis']);
  });

  it('stops mirroring after unbinding', () => {
    const { socket, emitStatus } = fakeSocket('open');
    const store = new Store();
    const unbind = bindSocket(socket, store);
    unbind();
    emitStatus('closed');
    expect(store.getState().connection).toBe('open');
  });
});

describe('launchSocketUrl', () => {
  it('stores the url token and strips it from the address bar', () => {
    const storage = memoryStorage();
    const replaceUrl = vi.fn();
    const url = launchSocketUrl({
      page: new URL('http://127.0.0.1:7777/?token=abc&demo'),
      storage,
      replaceUrl,
    });
    expect(url).toBe('ws://127.0.0.1:7777/ws?token=abc');
    expect(storage.getItem(TOKEN_STORAGE_KEY)).toBe('abc');
    expect(String(replaceUrl.mock.calls[0]?.[0])).toBe('http://127.0.0.1:7777/?demo=');
  });

  it('reuses the stored token without touching the url', () => {
    const storage = memoryStorage();
    storage.setItem(TOKEN_STORAGE_KEY, 'saved');
    const replaceUrl = vi.fn();
    const url = launchSocketUrl({ page: new URL('http://127.0.0.1:7777/'), storage, replaceUrl });
    expect(url).toBe('ws://127.0.0.1:7777/ws?token=saved');
    expect(replaceUrl).not.toHaveBeenCalled();
  });
});

describe('applyDocumentLocale', () => {
  it('sets the document language and title', () => {
    applyDocumentLocale(document, 'pt-BR');
    expect(document.documentElement.lang).toBe('pt-BR');
    expect(document.title).toBe('Guildcraft');
  });
});

describe('mountShell', () => {
  it('renders the topbar and stage and follows locale changes', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const unmount = mountShell(root, new Store());
    expect(root.querySelector('.topbar')).not.toBeNull();
    expect(root.querySelector('.stage')).not.toBeNull();
    setLocale('pt-BR');
    expect(document.documentElement.lang).toBe('pt-BR');
    unmount();
    expect(root.children).toHaveLength(0);
    setLocale('en');
    expect(document.documentElement.lang).toBe('pt-BR');
  });
});
