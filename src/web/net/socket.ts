import { TOKEN_QUERY, UNAUTHORIZED_CLOSE_CODE } from '../../shared/constants.js';
import type { ClientMessage, ServerMessage } from '../../shared/protocol.js';

export const TOKEN_STORAGE_KEY = 'guildcraft.token';
export const SOCKET_PATH = '/ws';
export const RECONNECT_BASE_MS = 500;
export const RECONNECT_MAX_MS = 10_000;

const SERVER_MESSAGE_TYPES: ReadonlySet<string> = new Set<ServerMessage['type']>([
  'session:init',
  'term:snapshot',
  'term:output',
  'term:reset',
  'agent:updated',
  'agent:removed',
  'agent:activity',
  'permission:request',
  'permission:resolved',
  'agent:visit',
  'message:delivered',
  'event',
  'error',
]);

export type SocketStatus = 'connecting' | 'open' | 'closed' | 'unauthorized';
export type MessageListener = (message: ServerMessage) => void;
export type StatusListener = (status: SocketStatus) => void;
export type TokenStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface SocketLike {
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  readonly readyState: number;
  send(data: string): void;
  close(): void;
}

export interface SocketOptions {
  url: string;
  createSocket?: (url: string) => SocketLike;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const OPEN = 1;

export function notify<T>(listeners: Iterable<(value: T) => void>, value: T): void {
  for (const listener of listeners) {
    try {
      listener(value);
    } catch {
      continue;
    }
  }
}

export function decodeServerMessage(text: string): ServerMessage | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const { type } = value as { type?: unknown };
    return typeof type === 'string' && SERVER_MESSAGE_TYPES.has(type)
      ? (value as ServerMessage)
      : null;
  } catch {
    return null;
  }
}

export function reconnectDelay(attempt: number): number {
  return Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
}

export function resolveToken(url: URL, storage: TokenStorage | null): string | null {
  const fromUrl = url.searchParams.get(TOKEN_QUERY);
  try {
    if (fromUrl) {
      storage?.setItem(TOKEN_STORAGE_KEY, fromUrl);
      return fromUrl;
    }
    return storage?.getItem(TOKEN_STORAGE_KEY) ?? null;
  } catch {
    return fromUrl;
  }
}

export function stripToken(url: URL): URL {
  const clean = new URL(url);
  clean.searchParams.delete(TOKEN_QUERY);
  return clean;
}

export function socketUrl(page: URL, token: string | null): string {
  const url = new URL(SOCKET_PATH, page);
  url.protocol = page.protocol === 'https:' ? 'wss:' : 'ws:';
  if (token) url.searchParams.set(TOKEN_QUERY, token);
  return url.toString();
}

export class GameSocket {
  private socket: SocketLike | null = null;
  private attempt = 0;
  private timer: unknown = null;
  private stopped = true;
  private status: SocketStatus = 'closed';
  private readonly messageListeners = new Set<MessageListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly createSocket: (url: string) => SocketLike;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly options: SocketOptions) {
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer =
      options.clearTimer ??
      ((handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      });
  }

  getStatus(): SocketStatus {
    return this.status;
  }

  connect(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  close(): void {
    this.stopped = true;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setStatus('closed');
  }

  send(message: ClientMessage): boolean {
    if (this.socket?.readyState !== OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private open(): void {
    this.timer = null;
    this.setStatus('connecting');
    let socket: SocketLike;
    try {
      socket = this.createSocket(this.options.url);
    } catch {
      this.setStatus('closed');
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.setStatus('open');
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || typeof event.data !== 'string') return;
      const message = decodeServerMessage(event.data);
      if (message) notify(this.messageListeners, message);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (event.code === UNAUTHORIZED_CLOSE_CODE) {
        this.stopped = true;
        this.setStatus('unauthorized');
        return;
      }
      this.setStatus('closed');
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = reconnectDelay(this.attempt);
    this.attempt += 1;
    this.timer = this.setTimer(() => {
      this.open();
    }, delay);
  }

  private setStatus(status: SocketStatus): void {
    if (status === this.status) return;
    this.status = status;
    notify(this.statusListeners, status);
  }
}
