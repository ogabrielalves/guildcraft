import { MAX_TERM_INPUT_LENGTH } from '../../shared/constants.js';
import type { ServerMessage } from '../../shared/protocol.js';
import type { GameSocket } from '../net/socket.js';
import type { Store } from '../state/store.js';

export interface Disposable {
  dispose(): void;
}

export interface TerminalLike {
  readonly cols: number;
  readonly rows: number;
  open(parent: HTMLElement): void;
  write(data: string): void;
  reset(): void;
  paste(data: string): void;
  focus(): void;
  fit(): void;
  hasSelection(): boolean;
  getSelection(): string;
  onData(listener: (data: string) => void): Disposable;
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
  dispose(): void;
}

export type ClipboardPort = Pick<Clipboard, 'readText' | 'writeText'>;
export type TerminalSocket = Pick<GameSocket, 'onMessage' | 'send'>;
export type ClipboardAction = 'copy' | 'paste' | null;
export type ClipboardKey = Pick<KeyboardEvent, 'type' | 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>;

export interface TerminalViewOptions {
  store: Store;
  socket: TerminalSocket;
  createTerminal: () => TerminalLike;
  clipboard?: ClipboardPort | null;
  observeResize?: (element: HTMLElement, callback: () => void) => () => void;
}

export interface TerminalView {
  readonly element: HTMLElement;
  fit(): void;
  copy(): Promise<boolean>;
  paste(): Promise<boolean>;
  destroy(): void;
}

interface Session {
  readonly terminal: TerminalLike;
  readonly host: HTMLElement;
  readonly input: Disposable;
  sentCols: number;
  sentRows: number;
}

export function clipboardAction(event: ClipboardKey, hasSelection: boolean): ClipboardAction {
  if (event.type !== 'keydown' || event.altKey || !(event.ctrlKey || event.metaKey)) return null;
  const key = event.key.toLowerCase();
  if (key === 'c' && hasSelection) return 'copy';
  if (key === 'v') return 'paste';
  return null;
}

export function chunkInput(data: string, size = MAX_TERM_INPUT_LENGTH): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < data.length) {
    let end = Math.min(start + size, data.length);
    const last = data.charCodeAt(end - 1);
    if (end < data.length && end - start > 1 && last >= 0xd800 && last <= 0xdbff) end -= 1;
    chunks.push(data.slice(start, end));
    start = end;
  }
  return chunks;
}

function defaultObserveResize(element: HTMLElement, callback: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  const observer = new ResizeObserver(callback);
  observer.observe(element);
  return () => {
    observer.disconnect();
  };
}

function defaultClipboard(): ClipboardPort | null {
  return typeof navigator !== 'undefined' && 'clipboard' in navigator ? navigator.clipboard : null;
}

export function createTerminalView(options: TerminalViewOptions): TerminalView {
  const { store, socket, createTerminal } = options;
  const clipboard = options.clipboard === undefined ? defaultClipboard() : options.clipboard;
  const sessions = new Map<string, Session>();
  let visible: string | null = null;

  const element = document.createElement('section');
  element.className = 'terminal-view';

  const sendSize = (agentId: string, session: Session) => {
    const { cols, rows } = session.terminal;
    if (cols === session.sentCols && rows === session.sentRows) return;
    if (socket.send({ type: 'term:resize', agentId, cols, rows })) {
      session.sentCols = cols;
      session.sentRows = rows;
    }
  };

  const open = (agentId: string): Session => {
    const existing = sessions.get(agentId);
    if (existing) return existing;
    const host = document.createElement('div');
    host.className = 'terminal-view__host';
    host.dataset.agentId = agentId;
    host.hidden = agentId !== visible;
    element.append(host);
    const terminal = createTerminal();
    terminal.open(host);
    terminal.attachCustomKeyEventHandler(
      (event) => clipboardAction(event, terminal.hasSelection()) === null,
    );
    const input = terminal.onData((data) => {
      for (const chunk of chunkInput(data))
        socket.send({ type: 'term:input', agentId, data: chunk });
    });
    const session: Session = { terminal, host, input, sentCols: 0, sentRows: 0 };
    sessions.set(agentId, session);
    return session;
  };

  const close = (agentId: string) => {
    const session = sessions.get(agentId);
    if (!session) return;
    sessions.delete(agentId);
    session.input.dispose();
    session.terminal.dispose();
    session.host.remove();
    if (visible === agentId) visible = null;
  };

  const fit = () => {
    if (visible === null) return;
    const session = sessions.get(visible);
    if (!session) return;
    session.terminal.fit();
    sendSize(visible, session);
  };

  const show = (agentId: string | null) => {
    if (agentId === visible) return;
    visible = agentId;
    if (agentId !== null) open(agentId);
    for (const [id, session] of sessions) session.host.hidden = id !== agentId;
    element.dataset.empty = String(agentId === null);
    fit();
    if (agentId !== null) sessions.get(agentId)?.terminal.focus();
  };

  const handleMessage = (message: ServerMessage) => {
    switch (message.type) {
      case 'term:snapshot': {
        const { terminal } = open(message.agentId);
        terminal.reset();
        terminal.write(message.data);
        return;
      }
      case 'term:output':
        open(message.agentId).terminal.write(message.data);
        return;
      case 'term:reset':
        sessions.get(message.agentId)?.terminal.reset();
        return;
      case 'agent:removed':
        close(message.agentId);
        return;
      case 'session:init': {
        const ids = new Set(message.agents.map((agent) => agent.id));
        for (const id of [...sessions.keys()]) if (!ids.has(id)) close(id);
        for (const session of sessions.values()) {
          session.sentCols = 0;
          session.sentRows = 0;
        }
        fit();
        return;
      }
      default:
        return;
    }
  };

  const unsubscribeMessage = socket.onMessage(handleMessage);
  const unsubscribeStore = store.subscribe((state, previous) => {
    if (state.focused !== previous.focused) show(state.focused);
  });
  const stopObserving = (options.observeResize ?? defaultObserveResize)(element, fit);
  element.dataset.empty = 'true';
  show(store.getState().focused);

  const focusedTerminal = () =>
    visible === null ? null : (sessions.get(visible)?.terminal ?? null);

  return {
    element,
    fit,
    async copy() {
      const terminal = focusedTerminal();
      if (!terminal || !clipboard || !terminal.hasSelection()) return false;
      try {
        await clipboard.writeText(terminal.getSelection());
        return true;
      } catch {
        return false;
      }
    },
    async paste() {
      const terminal = focusedTerminal();
      if (!terminal || !clipboard) return false;
      try {
        const text = await clipboard.readText();
        if (text) terminal.paste(text);
        terminal.focus();
        return text.length > 0;
      } catch {
        return false;
      }
    },
    destroy() {
      unsubscribeMessage();
      unsubscribeStore();
      stopObserving();
      for (const id of [...sessions.keys()]) close(id);
      element.remove();
    },
  };
}
