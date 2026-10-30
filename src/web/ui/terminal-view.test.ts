// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { AgentView } from '../../shared/agent.js';
import type { ClientMessage, ServerMessage } from '../../shared/protocol.js';
import type { MessageListener } from '../net/socket.js';
import { Store } from '../state/store.js';
import type { ClipboardKey, ClipboardPort, TerminalLike } from './terminal-view.js';
import { chunkInput, clipboardAction, createTerminalView } from './terminal-view.js';

class FakeTerminal implements TerminalLike {
  cols = 80;
  rows = 24;
  written = '';
  pasted: string[] = [];
  selection = '';
  parent: HTMLElement | null = null;
  focused = 0;
  disposed = false;
  keyHandler: ((event: KeyboardEvent) => boolean) | null = null;
  dataListener: ((data: string) => void) | null = null;
  fitTo: { cols: number; rows: number } | null = null;

  open(parent: HTMLElement) {
    this.parent = parent;
  }
  write(data: string) {
    this.written += data;
  }
  reset() {
    this.written = '';
  }
  paste(data: string) {
    this.pasted.push(data);
  }
  focus() {
    this.focused += 1;
  }
  fit() {
    if (this.fitTo) ({ cols: this.cols, rows: this.rows } = this.fitTo);
  }
  hasSelection() {
    return this.selection.length > 0;
  }
  getSelection() {
    return this.selection;
  }
  onData(listener: (data: string) => void) {
    this.dataListener = listener;
    return {
      dispose: () => {
        this.dataListener = null;
      },
    };
  }
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
    this.keyHandler = handler;
  }
  dispose() {
    this.disposed = true;
  }
}

function agent(id: string): AgentView {
  return {
    id,
    name: id,
    cwd: `/projects/${id}`,
    skin: 'mortis',
    status: 'idle',
    permissionMode: 'default',
    tool: null,
    waitingFor: null,
    model: null,
    effort: null,
    queued: 0,
  };
}

function setup(options: { clipboard?: ClipboardPort | null; connected?: boolean } = {}) {
  const store = new Store();
  store.apply({
    type: 'session:init',
    agents: [agent('a'), agent('b')],
    events: [],
    skins: [],
    permissions: [],
  });
  const listeners = new Set<MessageListener>();
  const sent: ClientMessage[] = [];
  const connected = { value: options.connected ?? true };
  const terminals: FakeTerminal[] = [];
  let resize: (() => void) | null = null;
  const stopObserving = vi.fn();
  const view = createTerminalView({
    store,
    socket: {
      onMessage: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      send: (message) => {
        if (connected.value) sent.push(message);
        return connected.value;
      },
    },
    createTerminal: () => {
      const terminal = new FakeTerminal();
      terminals.push(terminal);
      return terminal;
    },
    clipboard: options.clipboard ?? null,
    observeResize: (_element, callback) => {
      resize = callback;
      return stopObserving;
    },
  });
  const emit = (message: ServerMessage) => {
    for (const listener of listeners) listener(message);
  };
  const terminalOf = (agentId: string) => {
    const host = view.element.querySelector<HTMLElement>(`[data-agent-id="${agentId}"]`);
    const terminal = terminals.find((current) => current.parent === host);
    if (!host || !terminal) throw new Error(`missing terminal for ${agentId}`);
    return { host, terminal };
  };
  return {
    store,
    view,
    sent,
    connected,
    terminals,
    listeners,
    emit,
    terminalOf,
    stopObserving,
    resize: () => resize?.(),
  };
}

function key(overrides: Partial<ClipboardKey>): ClipboardKey {
  return { type: 'keydown', key: 'c', ctrlKey: true, metaKey: false, altKey: false, ...overrides };
}

describe('clipboardAction', () => {
  it('copies on Ctrl+C only when there is a selection', () => {
    expect(clipboardAction(key({}), true)).toBe('copy');
    expect(clipboardAction(key({}), false)).toBeNull();
  });

  it('pastes on Ctrl+V and Cmd+V', () => {
    expect(clipboardAction(key({ key: 'v' }), false)).toBe('paste');
    expect(clipboardAction(key({ key: 'V', ctrlKey: false, metaKey: true }), false)).toBe('paste');
  });

  it('ignores other keys, modifiers and event types', () => {
    expect(clipboardAction(key({ key: 'x' }), true)).toBeNull();
    expect(clipboardAction(key({ ctrlKey: false }), true)).toBeNull();
    expect(clipboardAction(key({ altKey: true }), true)).toBeNull();
    expect(clipboardAction(key({ type: 'keyup' }), true)).toBeNull();
  });
});

describe('chunkInput', () => {
  it('keeps short input whole', () => {
    expect(chunkInput('abc')).toEqual(['abc']);
    expect(chunkInput('')).toEqual([]);
  });

  it('splits long input into bounded chunks', () => {
    expect(chunkInput('abcdefg', 3)).toEqual(['abc', 'def', 'g']);
  });

  it('never splits a surrogate pair', () => {
    expect(chunkInput('ab😀c', 3)).toEqual(['ab', '😀c']);
  });
});

describe('createTerminalView', () => {
  it('starts empty without creating terminals', () => {
    const { view, terminals } = setup();
    expect(view.element.dataset.empty).toBe('true');
    expect(terminals).toHaveLength(0);
  });

  it('buffers output for agents that are not visible', () => {
    const { emit, terminalOf } = setup();
    emit({ type: 'term:snapshot', agentId: 'a', data: 'old' });
    emit({ type: 'term:snapshot', agentId: 'a', data: 'snap' });
    emit({ type: 'term:output', agentId: 'a', data: '+out' });
    const { host, terminal } = terminalOf('a');
    expect(terminal.written).toBe('snap+out');
    expect(host.hidden).toBe(true);
  });

  it('clears the screen on term:reset', () => {
    const { emit, terminalOf } = setup();
    emit({ type: 'term:output', agentId: 'a', data: 'text' });
    emit({ type: 'term:reset', agentId: 'b' });
    emit({ type: 'term:reset', agentId: 'a' });
    expect(terminalOf('a').terminal.written).toBe('');
  });

  it('shows the focused agent, fits it and reports its size', () => {
    const { store, view, sent, terminalOf } = setup();
    store.focus('a');
    const { host, terminal } = terminalOf('a');
    expect(host.hidden).toBe(false);
    expect(view.element.dataset.empty).toBe('false');
    expect(terminal.focused).toBe(0);
    expect(sent).toEqual([{ type: 'term:resize', agentId: 'a', cols: 80, rows: 24 }]);
  });

  it('focuses the visible terminal only on request', () => {
    const { store, view, terminalOf } = setup();
    view.focus();
    store.focus('a');
    view.focus();
    expect(terminalOf('a').terminal.focused).toBe(1);
  });

  it('swaps the visible terminal when focus changes', () => {
    const { store, view, terminalOf } = setup();
    store.focus('a');
    store.focus('b');
    expect(terminalOf('a').host.hidden).toBe(true);
    expect(terminalOf('b').host.hidden).toBe(false);
    store.focus(null);
    expect(terminalOf('b').host.hidden).toBe(true);
    expect(view.element.dataset.empty).toBe('true');
  });

  it('resends the size only when it changes', () => {
    const { store, sent, resize, terminalOf } = setup();
    store.focus('a');
    resize();
    expect(sent).toHaveLength(1);
    terminalOf('a').terminal.fitTo = { cols: 120, rows: 40 };
    resize();
    expect(sent.at(-1)).toEqual({ type: 'term:resize', agentId: 'a', cols: 120, rows: 40 });
    expect(sent).toHaveLength(2);
  });

  it('retries the size after a failed send and after a new session', () => {
    const { store, sent, connected, resize, emit } = setup({ connected: false });
    store.focus('a');
    expect(sent).toHaveLength(0);
    connected.value = true;
    resize();
    expect(sent).toHaveLength(1);
    emit({
      type: 'session:init',
      agents: [agent('a'), agent('b')],
      events: [],
      skins: [],
      permissions: [],
    });
    expect(sent).toHaveLength(2);
  });

  it('ignores resizes while nothing is visible', () => {
    const { sent, resize } = setup();
    resize();
    expect(sent).toHaveLength(0);
  });

  it('forwards keystrokes as chunked term:input', () => {
    const { store, sent, terminalOf } = setup();
    store.focus('b');
    const { terminal } = terminalOf('b');
    terminal.dataListener?.('ls\r');
    terminal.dataListener?.('x'.repeat(70_000));
    const inputs = sent.filter((message) => message.type === 'term:input');
    expect(inputs.map((message) => message.data.length)).toEqual([3, 65_536, 4_464]);
    expect(inputs[0]).toEqual({ type: 'term:input', agentId: 'b', data: 'ls\r' });
  });

  it('lets the browser handle clipboard shortcuts', () => {
    const { emit, terminalOf } = setup();
    emit({ type: 'term:output', agentId: 'a', data: 'x' });
    const { terminal } = terminalOf('a');
    const handler = terminal.keyHandler;
    if (!handler) throw new Error('missing key handler');
    const event = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);
    expect(handler(event({ key: 'c', ctrlKey: true }))).toBe(true);
    terminal.selection = 'selected';
    expect(handler(event({ key: 'c', ctrlKey: true }))).toBe(false);
    expect(handler(event({ key: 'v', ctrlKey: true }))).toBe(false);
    expect(handler(event({ key: 'a' }))).toBe(true);
  });

  it('disposes terminals of removed agents', () => {
    const { store, emit, view, terminals } = setup();
    store.focus('a');
    emit({ type: 'term:output', agentId: 'b', data: 'x' });
    emit({ type: 'agent:removed', agentId: 'a' });
    emit({ type: 'agent:removed', agentId: 'missing' });
    expect(terminals[0]?.disposed).toBe(true);
    expect(terminals[0]?.dataListener).toBeNull();
    expect(view.element.querySelector('[data-agent-id="a"]')).toBeNull();
    emit({ type: 'session:init', agents: [agent('c')], events: [], skins: [], permissions: [] });
    expect(terminals[1]?.disposed).toBe(true);
    expect(view.element.children).toHaveLength(0);
  });

  it('ignores unrelated server messages', () => {
    const { emit, terminals } = setup();
    emit({ type: 'event', event: { kind: 'joined', agentId: 'a', at: 0 } });
    expect(terminals).toHaveLength(0);
  });

  it('copies the selection of the visible terminal', async () => {
    const clipboard = { readText: vi.fn(), writeText: vi.fn(() => Promise.resolve()) };
    const { store, view, terminalOf } = setup({ clipboard });
    expect(await view.copy()).toBe(false);
    store.focus('a');
    expect(await view.copy()).toBe(false);
    terminalOf('a').terminal.selection = 'hello';
    expect(await view.copy()).toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith('hello');
    clipboard.writeText.mockRejectedValueOnce(new Error('denied'));
    expect(await view.copy()).toBe(false);
  });

  it('pastes clipboard text into the visible terminal', async () => {
    const clipboard = { readText: vi.fn(() => Promise.resolve('npm test')), writeText: vi.fn() };
    const { store, view, terminalOf } = setup({ clipboard });
    expect(await view.paste()).toBe(false);
    store.focus('a');
    expect(await view.paste()).toBe(true);
    expect(terminalOf('a').terminal.pasted).toEqual(['npm test']);
    clipboard.readText.mockResolvedValueOnce('');
    expect(await view.paste()).toBe(false);
    clipboard.readText.mockRejectedValueOnce(new Error('denied'));
    expect(await view.paste()).toBe(false);
    expect(terminalOf('a').terminal.pasted).toEqual(['npm test']);
  });

  it('cannot copy or paste without clipboard access', async () => {
    const { store, view, terminalOf } = setup({ clipboard: null });
    store.focus('a');
    terminalOf('a').terminal.selection = 'hello';
    expect(await view.copy()).toBe(false);
    expect(await view.paste()).toBe(false);
  });

  it('releases everything on destroy', () => {
    const { store, view, emit, terminals, listeners, stopObserving } = setup();
    document.body.append(view.element);
    emit({ type: 'term:output', agentId: 'a', data: 'x' });
    view.destroy();
    expect(listeners.size).toBe(0);
    expect(stopObserving).toHaveBeenCalledOnce();
    expect(terminals[0]?.disposed).toBe(true);
    expect(view.element.isConnected).toBe(false);
    store.focus('a');
    expect(terminals).toHaveLength(1);
  });
});
