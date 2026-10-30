import { describe, expect, it, vi } from 'vitest';
import { UNAUTHORIZED_CLOSE_CODE } from '../../shared/constants.js';
import {
  GameSocket,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  TOKEN_STORAGE_KEY,
  decodeServerMessage,
  reconnectDelay,
  resolveToken,
  socketUrl,
  stripToken,
} from './socket.js';
import type { SocketLike, SocketStatus, TokenStorage } from './socket.js';

class FakeSocket implements SocketLike {
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  readyState = 0;
  sent: string[] = [];
  closed = false;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }

  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }

  receive(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

function memoryStorage(initial: Record<string, string> = {}): TokenStorage {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

function harness(failures = 0) {
  let remainingFailures = failures;
  const sockets: FakeSocket[] = [];
  const timers: { callback: () => void; ms: number; cleared: boolean }[] = [];
  const socket = new GameSocket({
    url: 'ws://127.0.0.1:7777/ws?token=t',
    createSocket: (url) => {
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error('SecurityError');
      }
      const fake = new FakeSocket(url);
      sockets.push(fake);
      return fake;
    },
    setTimer: (callback, ms) => {
      const timer = { callback, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  });
  const statuses: SocketStatus[] = [];
  socket.onStatus((status) => statuses.push(status));
  const latest = () => {
    const fake = sockets.at(-1);
    if (!fake) throw new Error('no socket');
    return fake;
  };
  return { socket, sockets, timers, statuses, latest };
}

describe('decodeServerMessage', () => {
  it('accepts known message types', () => {
    expect(
      decodeServerMessage(
        '{"type":"permission:resolved","requestId":"r","agentId":"a","outcome":"denied"}',
      ),
    ).toMatchObject({ type: 'permission:resolved' });
    expect(decodeServerMessage('{"type":"agent:activity","activity":{}}')).toMatchObject({
      type: 'agent:activity',
    });
    expect(decodeServerMessage('{"type":"agent:removed","agentId":"a"}')).toEqual({
      type: 'agent:removed',
      agentId: 'a',
    });
  });

  it('rejects unknown types, non-objects and invalid json', () => {
    expect(decodeServerMessage('{"type":"nope"}')).toBeNull();
    expect(decodeServerMessage('{"type":1}')).toBeNull();
    expect(decodeServerMessage('[]')).toBeNull();
    expect(decodeServerMessage('null')).toBeNull();
    expect(decodeServerMessage('{')).toBeNull();
  });
});

describe('reconnectDelay', () => {
  it('backs off exponentially up to the cap', () => {
    expect(reconnectDelay(0)).toBe(RECONNECT_BASE_MS);
    expect(reconnectDelay(1)).toBe(RECONNECT_BASE_MS * 2);
    expect(reconnectDelay(20)).toBe(RECONNECT_MAX_MS);
  });
});

describe('resolveToken', () => {
  it('prefers the url token and stores it', () => {
    const storage = memoryStorage({ [TOKEN_STORAGE_KEY]: 'old' });
    expect(resolveToken(new URL('http://h/?token=new'), storage)).toBe('new');
    expect(storage.getItem(TOKEN_STORAGE_KEY)).toBe('new');
  });

  it('falls back to the stored token', () => {
    const storage = memoryStorage({ [TOKEN_STORAGE_KEY]: 'saved' });
    expect(resolveToken(new URL('http://h/'), storage)).toBe('saved');
  });

  it('returns null without a token or storage', () => {
    expect(resolveToken(new URL('http://h/'), null)).toBeNull();
    expect(resolveToken(new URL('http://h/'), memoryStorage())).toBeNull();
  });

  it('survives storage errors', () => {
    const broken: TokenStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(resolveToken(new URL('http://h/?token=x'), broken)).toBe('x');
    expect(resolveToken(new URL('http://h/'), broken)).toBeNull();
  });
});

describe('stripToken', () => {
  it('removes only the token parameter', () => {
    const clean = stripToken(new URL('http://h/?demo&token=x#a'));
    expect(clean.toString()).toBe('http://h/?demo=#a');
  });
});

describe('socketUrl', () => {
  it('builds a ws url with the token', () => {
    expect(socketUrl(new URL('http://127.0.0.1:7777/?token=x'), 'a b')).toBe(
      'ws://127.0.0.1:7777/ws?token=a+b',
    );
  });

  it('uses wss on https and omits a missing token', () => {
    expect(socketUrl(new URL('https://host/app'), null)).toBe('wss://host/ws');
  });
});

describe('GameSocket', () => {
  it('connects once and reports status changes', () => {
    const { socket, sockets, statuses, latest } = harness();
    expect(socket.getStatus()).toBe('closed');
    socket.connect();
    socket.connect();
    expect(sockets).toHaveLength(1);
    expect(latest().url).toBe('ws://127.0.0.1:7777/ws?token=t');
    latest().open();
    expect(statuses).toEqual(['connecting', 'open']);
    expect(socket.getStatus()).toBe('open');
  });

  it('sends only while open', () => {
    const { socket, latest } = harness();
    expect(socket.send({ type: 'agent:removeAll' })).toBe(false);
    socket.connect();
    expect(socket.send({ type: 'agent:removeAll' })).toBe(false);
    latest().open();
    expect(socket.send({ type: 'agent:remove', agentId: 'a' })).toBe(true);
    expect(latest().sent).toEqual(['{"type":"agent:remove","agentId":"a"}']);
  });

  it('dispatches valid string messages to listeners', () => {
    const { socket, latest } = harness();
    const listener = vi.fn();
    const unsubscribe = socket.onMessage(listener);
    socket.connect();
    latest().receive('{"type":"term:reset","agentId":"a"}');
    latest().receive('{"type":"bogus"}');
    latest().receive(new ArrayBuffer(1));
    expect(listener).toHaveBeenCalledExactlyOnceWith({ type: 'term:reset', agentId: 'a' });
    unsubscribe();
    latest().receive('{"type":"term:reset","agentId":"a"}');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reconnects with backoff and resets it after opening', () => {
    const { socket, sockets, timers, latest } = harness();
    socket.connect();
    latest().drop();
    expect(socket.getStatus()).toBe('closed');
    expect(timers.at(-1)?.ms).toBe(RECONNECT_BASE_MS);
    timers.at(-1)?.callback();
    expect(sockets).toHaveLength(2);
    latest().drop();
    expect(timers.at(-1)?.ms).toBe(RECONNECT_BASE_MS * 2);
    timers.at(-1)?.callback();
    latest().open();
    latest().drop();
    expect(timers.at(-1)?.ms).toBe(RECONNECT_BASE_MS);
  });

  it('stops reconnecting after close', () => {
    const { socket, sockets, timers, statuses, latest } = harness();
    socket.connect();
    latest().drop();
    socket.close();
    expect(timers.at(-1)?.cleared).toBe(true);
    expect(statuses.at(-1)).toBe('closed');
    socket.connect();
    const current = latest();
    current.open();
    socket.close();
    expect(current.closed).toBe(true);
    current.drop();
    expect(sockets).toHaveLength(2);
  });

  it('ignores events from replaced sockets', () => {
    const { socket, timers, latest } = harness();
    const listener = vi.fn();
    socket.onMessage(listener);
    socket.connect();
    const stale = latest();
    stale.drop();
    timers.at(-1)?.callback();
    stale.open();
    stale.receive('{"type":"term:reset","agentId":"a"}');
    stale.drop();
    expect(socket.getStatus()).toBe('connecting');
    expect(listener).not.toHaveBeenCalled();
    expect(timers).toHaveLength(1);
  });

  it('stops reconnecting when the server rejects the token', () => {
    const { socket, timers, statuses, latest } = harness();
    socket.connect();
    latest().open();
    latest().drop(UNAUTHORIZED_CLOSE_CODE);
    expect(socket.getStatus()).toBe('unauthorized');
    expect(statuses).toEqual(['connecting', 'open', 'unauthorized']);
    expect(timers).toHaveLength(0);
  });

  it('allows connecting again after an unauthorized close', () => {
    const { socket, sockets, latest } = harness();
    socket.connect();
    latest().drop(UNAUTHORIZED_CLOSE_CODE);
    socket.connect();
    expect(sockets).toHaveLength(2);
    expect(socket.getStatus()).toBe('connecting');
  });

  it('retries when the socket cannot be created', () => {
    const { socket, sockets, timers, statuses } = harness(2);
    socket.connect();
    expect(socket.getStatus()).toBe('closed');
    expect(timers).toHaveLength(1);
    timers[0]?.callback();
    expect(timers[1]?.ms).toBe(RECONNECT_BASE_MS * 2);
    timers[1]?.callback();
    expect(sockets).toHaveLength(1);
    expect(statuses.at(-1)).toBe('connecting');
  });

  it('keeps notifying when a listener throws', () => {
    const { socket, latest } = harness();
    const thrower = () => {
      throw new Error('boom');
    };
    const onMessage = vi.fn();
    const onStatus = vi.fn();
    socket.onMessage(thrower);
    socket.onMessage(onMessage);
    socket.onStatus(thrower);
    socket.onStatus(onStatus);
    socket.connect();
    latest().receive('{"type":"term:reset","agentId":"a"}');
    expect(onStatus).toHaveBeenCalledWith('connecting');
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it('removes status listeners', () => {
    const { socket } = harness();
    const listener = vi.fn();
    const unsubscribe = socket.onStatus(listener);
    unsubscribe();
    socket.connect();
    expect(listener).not.toHaveBeenCalled();
  });
});
