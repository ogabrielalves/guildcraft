import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { RawData } from 'ws';
import { UNAUTHORIZED_CLOSE_CODE } from '../../shared/constants.js';
import type { Failure } from '../../shared/errors.js';
import type { ServerMessage } from '../../shared/protocol.js';
import { decodeClientMessage } from '../../shared/protocol.js';
import type { AgentManager } from '../agents/agent-manager.js';
import { isAllowedOrigin, tokenFromUrl, tokensMatch } from '../security.js';
import type { CommandTarget } from './handlers.js';
import { handleClientMessage } from './handlers.js';

export const WS_PATH = '/ws';
export const MAX_PAYLOAD_BYTES = 1024 * 1024;
export const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
export const INTERNAL_ERROR_CLOSE_CODE = 1011;

export type GatewayTarget = CommandTarget &
  Pick<AgentManager, 'views' | 'recentEvents' | 'snapshot'>;

export interface GatewayOptions {
  server: Server;
  manager: GatewayTarget;
  token: string;
  origins: readonly string[];
  skins: () => string[];
  maxBufferedBytes?: number;
  onClientsChange?: (count: number) => void;
  log?: (message: string) => void;
}

interface Client {
  socket: WebSocket;
  pending: ServerMessage[] | null;
}

function pathOf(url: string | undefined): string | null {
  try {
    return new URL(url ?? '', 'http://127.0.0.1').pathname;
  } catch {
    return null;
  }
}

function reject(socket: Duplex, status: number, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export class Gateway {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  private readonly clients = new Set<Client>();
  private readonly log: (message: string) => void;
  private readonly onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    this.upgrade(req, socket, head);
  };

  constructor(private readonly options: GatewayOptions) {
    this.log = options.log ?? (() => undefined);
    options.server.on('upgrade', this.onUpgrade);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  broadcast(message: ServerMessage): void {
    for (const client of this.clients) {
      if (client.pending) client.pending.push(message);
      else this.send(client.socket, message);
    }
  }

  async close(): Promise<void> {
    this.options.server.off('upgrade', this.onUpgrade);
    for (const client of this.clients) client.socket.terminate();
    this.clients.clear();
    await new Promise<void>((resolve) => {
      this.wss.close(() => {
        resolve();
      });
    });
  }

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (pathOf(req.url) !== WS_PATH) {
      reject(socket, 404, 'Not Found');
      return;
    }
    if (!isAllowedOrigin(req.headers.origin, this.options.origins)) {
      this.log(`ws: rejected origin ${req.headers.origin ?? '(none)'}`);
      reject(socket, 403, 'Forbidden');
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      if (!tokensMatch(this.options.token, tokenFromUrl(req.url))) {
        ws.close(UNAUTHORIZED_CLOSE_CODE, 'unauthorized');
        return;
      }
      this.connect(ws);
    });
  }

  private connect(socket: WebSocket): void {
    const client: Client = { socket, pending: [] };
    this.clients.add(client);
    this.options.onClientsChange?.(this.clients.size);
    socket.on('message', (data, isBinary) => {
      void this.receive(socket, data, isBinary);
    });
    socket.on('close', () => {
      this.forget(client);
    });
    socket.on('error', () => {
      this.forget(client);
    });
    this.sync(client).catch((error: unknown) => {
      this.log(`ws: session sync failed: ${String(error)}`);
      this.forget(client);
      socket.close(INTERNAL_ERROR_CLOSE_CODE);
    });
  }

  private forget(client: Client): void {
    if (this.clients.delete(client)) this.options.onClientsChange?.(this.clients.size);
  }

  private async sync(client: Client): Promise<void> {
    const { manager, skins } = this.options;
    const { socket } = client;
    const agents = manager.views();
    const snapshots = agents.map((agent) => manager.snapshot(agent.id).catch(() => ''));
    this.send(socket, {
      type: 'session:init',
      agents,
      events: manager.recentEvents(),
      skins: skins(),
    });
    for (const [index, agent] of agents.entries()) {
      const data = await snapshots[index];
      if (data) this.send(socket, { type: 'term:snapshot', agentId: agent.id, data });
    }
    const pending = client.pending ?? [];
    client.pending = null;
    for (const message of pending) this.send(socket, message);
  }

  private async receive(socket: WebSocket, data: RawData, isBinary: boolean): Promise<void> {
    const message = isBinary ? null : decodeClientMessage((data as Buffer).toString());
    if (!message) {
      this.log('ws: dropped invalid message');
      return;
    }
    const failure = await handleClientMessage(this.options.manager, message).catch(
      (error: unknown): Failure => {
        this.log(`ws: ${message.type} failed: ${String(error)}`);
        return { code: 'INVALID_MESSAGE' };
      },
    );
    if (failure) this.send(socket, { type: 'error', source: message.type, ...failure });
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > (this.options.maxBufferedBytes ?? MAX_BUFFERED_BYTES)) {
      this.log('ws: dropped a slow client');
      socket.terminate();
      return;
    }
    socket.send(JSON.stringify(message));
  }
}
