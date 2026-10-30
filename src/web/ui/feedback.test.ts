// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentStatus, AgentView, VillageEvent } from '../../shared/agent.js';
import type { ServerMessage } from '../../shared/protocol.js';
import { initI18n, setLocale } from '../i18n/index.js';
import type { MessageListener } from '../net/socket.js';
import { Store } from '../state/store.js';
import { createFeed, eventText, FEED_SIZE } from './feed.js';
import { confirmModal } from './modal.js';
import type { SystemNotifier } from './notifications.js';
import { createNotifications, newlyWaiting, reportFailedSends, tabTitle } from './notifications.js';
import { countAgents, createStats } from './stats.js';
import type { ToastTimers } from './toasts.js';
import { createToasts, MAX_TOASTS, TOAST_DURATION_MS } from './toasts.js';
import { createTooltip, placeTooltip, TOOLTIP_OFFSET } from './tooltip.js';

afterEach(() => {
  initI18n({ storage: null, languages: [] });
  document.body.replaceChildren();
});

function agent(id: string, status: AgentStatus = 'idle'): AgentView {
  return {
    id,
    name: `Agent ${id}`,
    cwd: `/projects/${id}`,
    skin: 'mortis',
    status,
    permissionMode: 'default',
    tool: null,
    waitingFor: null,
    model: null,
    effort: null,
    queued: 0,
  };
}

function storeWith(agents: AgentView[], events: VillageEvent[] = []) {
  const store = new Store();
  store.apply({ type: 'session:init', agents, events, skins: [], permissions: [], activities: [] });
  return store;
}

const event = (kind: VillageEvent['kind'], agentId = 'a', targetId?: string): VillageEvent =>
  targetId === undefined ? { kind, agentId, at: 0 } : { kind, agentId, targetId, at: 0 };

function fakeTimers() {
  const pending = new Map<number, () => void>();
  let next = 0;
  const timers: ToastTimers = {
    setTimer: (callback) => {
      next += 1;
      pending.set(next, callback);
      return next;
    },
    clearTimer: (handle) => {
      pending.delete(handle as number);
    },
  };
  const fire = () => {
    for (const [id, callback] of [...pending]) {
      pending.delete(id);
      callback();
    }
  };
  return { timers, pending, fire };
}

describe('confirmModal', () => {
  const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('dialog button')];

  it('resolves true on confirm and removes itself', async () => {
    const answer = confirmModal('Remove?', { confirmLabel: 'Remove', danger: true });
    const dialog = document.querySelector('dialog');
    expect(dialog?.open).toBe(true);
    expect(dialog?.querySelector('.modal__message')?.textContent).toBe('Remove?');
    expect(buttons().map((b) => b.textContent)).toEqual(['Cancel', 'Remove']);
    expect(buttons()[1]?.classList.contains('dialog__button--danger')).toBe(true);
    expect(document.activeElement).toBe(buttons()[0]);
    buttons()[1]?.click();
    buttons()[0]?.click();
    await expect(answer).resolves.toBe(true);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('resolves false on cancel and on Escape', async () => {
    const cancelled = confirmModal('A?');
    buttons()[0]?.click();
    await expect(cancelled).resolves.toBe(false);
    const parent = document.createElement('div');
    document.body.append(parent);
    const escaped = confirmModal('B?', { parent });
    expect(buttons()[1]?.textContent).toBe('Confirm');
    const cancel = new Event('cancel', { cancelable: true });
    parent.querySelector('dialog')?.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    await expect(escaped).resolves.toBe(false);
  });
});

describe('createToasts', () => {
  it('shows, expires and dismisses toasts', () => {
    const { timers, fire } = fakeTimers();
    const toasts = createToasts(timers);
    toasts.show('saved', 'success');
    toasts.show('boom', 'error');
    const nodes = () => [...toasts.element.querySelectorAll<HTMLElement>('.toast')];
    expect(nodes().map((n) => n.className)).toEqual(['toast toast--success', 'toast toast--error']);
    expect(nodes()[1]?.getAttribute('role')).toBe('alert');
    nodes()[0]?.querySelector<HTMLButtonElement>('.toast__dismiss')?.click();
    expect(nodes()).toHaveLength(1);
    fire();
    expect(nodes()).toHaveLength(0);
  });

  it('replaces duplicates and keeps at most MAX_TOASTS', () => {
    const { timers, pending } = fakeTimers();
    const setTimer = vi.spyOn(timers, 'setTimer');
    const toasts = createToasts(timers);
    toasts.show('same');
    toasts.show('same');
    expect(toasts.element.children).toHaveLength(1);
    for (let i = 0; i < MAX_TOASTS + 2; i += 1) toasts.show(`t${i}`);
    const texts = [...toasts.element.querySelectorAll('.toast__text')].map((n) => n.textContent);
    expect(texts).toEqual(['t2', 't3', 't4', 't5']);
    expect(pending.size).toBe(MAX_TOASTS);
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), TOAST_DURATION_MS);
  });

  it('translates the dismiss label and clears on destroy', () => {
    const { timers, pending } = fakeTimers();
    const toasts = createToasts(timers);
    toasts.show('x');
    setLocale('pt-BR');
    expect(toasts.element.querySelector('.toast__dismiss')?.getAttribute('aria-label')).toBe(
      'Fechar',
    );
    toasts.destroy();
    expect(toasts.element.children).toHaveLength(0);
    expect(pending.size).toBe(0);
  });

  it('works with real timers by default', () => {
    vi.useFakeTimers();
    const toasts = createToasts();
    toasts.show('later', 'info', 100);
    vi.advanceTimersByTime(100);
    expect(toasts.element.children).toHaveLength(0);
    vi.useRealTimers();
  });
});

describe('feed', () => {
  const names = (id: string | undefined) => (id ? `N${id}` : '?');

  it('describes every event kind', () => {
    expect(eventText(event('joined'), names)).toBe('Na joined the workshop');
    expect(eventText(event('left'), names)).toBe('Na left the workshop');
    expect(eventText(event('finished'), names)).toBe('Na finished');
    expect(eventText(event('waiting'), names)).toBe('Na needs your approval');
    expect(eventText(event('prompted'), names)).toBe('Prompt sent to Na');
    expect(eventText(event('messaged', 'a', 'b'), names)).toBe('Na sent a message to Nb');
    expect(eventText(event('delivered', 'a', 'b'), names)).toBe('Message delivered to Nb');
  });

  it('shows the last events and remembers names of agents that left', () => {
    const store = storeWith([agent('a')]);
    const feed = createFeed(store);
    expect(feed.element.hidden).toBe(true);
    store.apply({ type: 'agent:removed', agentId: 'a' });
    store.apply({ type: 'event', event: event('left') });
    store.apply({ type: 'event', event: event('messaged', 'a', 'ghost') });
    const items = () => [...feed.element.querySelectorAll('li')].map((n) => n.textContent);
    expect(items()).toEqual(['Agent a left the workshop', 'Agent a sent a message to ?']);
    for (let i = 0; i < FEED_SIZE; i += 1) store.apply({ type: 'event', event: event('finished') });
    expect(items()).toHaveLength(FEED_SIZE);
    setLocale('pt-BR');
    expect(items()[0]).toBe('Agent a terminou');
    feed.destroy();
    store.apply({ type: 'event', event: event('joined', 'zz') });
    expect(items()[0]).toBe('Agent a terminou');
  });
});

describe('feed toggle', () => {
  it('shows only the latest event until the user opens the list', () => {
    const store = storeWith([agent('a')]);
    const feed = createFeed(store);
    document.body.append(feed.element);
    const toggle = feed.element.querySelector<HTMLButtonElement>('.feed__toggle');
    const list = feed.element.querySelector<HTMLElement>('.feed__list');
    if (!toggle || !list) throw new Error('missing feed parts');
    store.apply({ type: 'event', event: event('joined') });
    store.apply({ type: 'event', event: event('waiting') });
    expect(toggle.textContent).toBe('Agent a needs your approval');
    expect(toggle.classList.contains('feed__toggle--waiting')).toBe(true);
    expect(toggle.title).toBe('Recent events');
    expect(list.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    expect(list.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(feed.element.classList.contains('feed--expanded')).toBe(true);
    expect(list.children).toHaveLength(2);
    toggle.click();
    expect(list.hidden).toBe(true);
    expect(feed.element.classList.contains('feed--expanded')).toBe(false);
    feed.destroy();
  });
});

describe('feed names', () => {
  it('fills in the name when the agent arrives after its event', () => {
    const store = storeWith([]);
    const feed = createFeed(store);
    const items = () => [...feed.element.querySelectorAll('li')].map((n) => n.textContent);
    store.apply({ type: 'event', event: event('joined', 'n') });
    expect(items()).toEqual(['? joined the workshop']);
    store.apply({ type: 'agent:updated', agent: agent('n') });
    expect(items()).toEqual(['Agent n joined the workshop']);
    const before = feed.element.querySelector('li');
    store.apply({ type: 'agent:updated', agent: agent('n', 'thinking') });
    expect(feed.element.querySelector('li')).toBe(before);
    feed.destroy();
  });
});

describe('stats', () => {
  it('counts working and waiting agents', () => {
    expect(
      countAgents([agent('a', 'thinking'), agent('b', 'tool'), agent('c', 'waiting')]),
    ).toEqual({ agents: 3, working: 2, waiting: 1 });
  });

  it('renders and follows the store', () => {
    const store = storeWith([agent('a', 'tool')]);
    const stats = createStats(store);
    const texts = () => [...stats.element.children].map((n) => n.textContent);
    expect(texts()).toEqual(['1 adventurers', '1 working', '0 waiting for you']);
    store.apply({ type: 'agent:updated', agent: agent('a', 'waiting') });
    expect(texts()[2]).toBe('1 waiting for you');
    setLocale('pt-BR');
    expect(texts()[0]).toBe('1 aventureiros');
    stats.destroy();
    store.apply({ type: 'agent:removed', agentId: 'a' });
    expect(texts()[0]).toBe('1 aventureiros');
  });
});

describe('tooltip', () => {
  it('places the tip next to the pointer and flips at the edges', () => {
    const tip = { width: 50, height: 20 };
    const bounds = { width: 200, height: 100 };
    expect(placeTooltip(10, 10, tip, bounds)).toEqual({
      left: 10 + TOOLTIP_OFFSET,
      top: 10 + TOOLTIP_OFFSET,
    });
    expect(placeTooltip(190, 95, tip, bounds)).toEqual({
      left: 190 - TOOLTIP_OFFSET - 50,
      top: 95 - TOOLTIP_OFFSET - 20,
    });
    expect(placeTooltip(5, 5, { width: 500, height: 500 }, bounds)).toEqual({ left: 0, top: 0 });
  });

  it('shows text, hides and removes itself', () => {
    const tooltip = createTooltip();
    tooltip.show('free', 4, 4);
    expect(tooltip.element.hidden).toBe(false);
    expect(tooltip.element.style.left).toBe(`${4 + TOOLTIP_OFFSET}px`);
    const parent = document.createElement('div');
    parent.append(tooltip.element);
    document.body.append(parent);
    tooltip.show('Mortis', 1, 2);
    expect(tooltip.element.textContent).toBe('Mortis');
    tooltip.hide();
    expect(tooltip.element.hidden).toBe(true);
    tooltip.destroy();
    expect(tooltip.element.isConnected).toBe(false);
  });
});

describe('notifications', () => {
  function setup(system: SystemNotifier | null = null, isHandled?: () => boolean) {
    const store = storeWith([agent('a'), agent('b')]);
    const listeners = new Set<MessageListener>();
    const toasts = { show: vi.fn() };
    const notifications = createNotifications({
      store,
      socket: {
        onMessage: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      toasts,
      system,
      ...(isHandled ? { isHandled } : {}),
    });
    const emit = (message: ServerMessage) => {
      for (const listener of listeners) listener(message);
    };
    return { store, toasts, notifications, emit, listeners };
  }

  function fakeSystem(permission: NotificationPermission) {
    const show = vi.fn();
    const requestPermission = vi.fn(() => Promise.resolve<NotificationPermission>('granted'));
    const system: SystemNotifier = { permission, requestPermission, show };
    return { system, show, requestPermission };
  }

  it('builds the tab title from the waiting count', () => {
    expect(tabTitle(0)).toBe('Guildcraft');
    expect(tabTitle(2)).toBe('(❗2) Guildcraft');
  });

  it('finds agents that just started waiting', () => {
    const previous = storeWith([agent('a'), agent('b', 'waiting')]).getState();
    const next = storeWith([
      agent('a', 'waiting'),
      agent('b', 'waiting'),
      agent('c', 'waiting'),
    ]).getState();
    expect(newlyWaiting(next, previous).map((a) => a.id)).toEqual(['a', 'c']);
  });

  it('toasts approvals and keeps the tab title in sync', () => {
    const { store, toasts } = setup();
    expect(document.title).toBe('Guildcraft');
    store.apply({ type: 'agent:updated', agent: agent('a', 'waiting') });
    expect(toasts.show).toHaveBeenCalledWith('Agent a is waiting for you', 'warning');
    expect(document.title).toBe('(❗1) Guildcraft');
    store.apply({ type: 'agent:updated', agent: agent('a', 'waiting') });
    expect(toasts.show).toHaveBeenCalledOnce();
    store.select('a');
    expect(document.title).toBe('(❗1) Guildcraft');
  });

  it('uses system notifications only when the tab is hidden and allowed', () => {
    const granted = fakeSystem('granted');
    const { store } = setup(granted.system);
    store.apply({ type: 'agent:updated', agent: agent('a', 'waiting') });
    expect(granted.show).not.toHaveBeenCalled();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    store.apply({ type: 'agent:updated', agent: agent('b', 'waiting') });
    expect(granted.show).toHaveBeenCalledWith(
      'Agent b is waiting for you',
      'Open the workshop to approve or reply.',
    );
    granted.show.mockImplementation(() => {
      throw new Error('blocked');
    });
    store.apply({ type: 'agent:updated', agent: agent('c', 'waiting') });
    hidden.mockRestore();
  });

  it('asks for permission on the first pointer press only', () => {
    const system = fakeSystem('default');
    setup(system.system);
    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new Event('pointerdown'));
    expect(system.requestPermission).toHaveBeenCalledOnce();
    const denied = fakeSystem('denied');
    setup(denied.system);
    document.dispatchEvent(new Event('pointerdown'));
    expect(denied.requestPermission).not.toHaveBeenCalled();
  });

  it('toasts server errors unless another component handles them', () => {
    const handled = { value: false };
    const { emit, toasts } = setup(null, () => handled.value);
    emit({ type: 'error', code: 'AGENT_NAME_TAKEN', params: { name: 'web' } });
    expect(toasts.show).toHaveBeenCalledWith('There is already an adventurer named web', 'error');
    handled.value = true;
    emit({ type: 'error', code: 'QUEUE_FULL' });
    emit({ type: 'term:reset', agentId: 'a' });
    expect(toasts.show).toHaveBeenCalledOnce();
  });

  it('updates the title on locale change and stops on destroy', () => {
    const { store, notifications, listeners } = setup();
    store.apply({ type: 'agent:updated', agent: agent('a', 'waiting') });
    setLocale('pt-BR');
    expect(document.title).toBe('(❗1) Guildcraft');
    notifications.destroy();
    expect(listeners.size).toBe(0);
    store.apply({ type: 'agent:updated', agent: agent('b', 'waiting') });
    expect(document.title).toBe('(❗1) Guildcraft');
  });

  it('reports sends the socket refuses', () => {
    const onFailure = vi.fn();
    const results = [true, false];
    const socket = reportFailedSends({ send: () => results.shift() ?? false }, onFailure);
    expect(socket.send({ type: 'agent:removeAll' })).toBe(true);
    expect(socket.send({ type: 'agent:restart', agentId: 'a' })).toBe(false);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith({ type: 'agent:restart', agentId: 'a' });
  });
});
