import type { ActionState, AgentAction, AgentActivity, TaskStatus } from '../../shared/activity.js';
import type { AgentStatus, AgentView, WaitingReason } from '../../shared/agent.js';
import type { IdlePlan } from '../game/activity.js';
import type { Assets } from '../game/assets.js';
import type { TranslationKey } from '../i18n/index.js';
import { onLocaleChange, t } from '../i18n/index.js';
import type { GameSocket } from '../net/socket.js';
import type { Store, StoreState } from '../state/store.js';
import { pendingFor, resolvePermission } from '../state/store.js';
import { confirmModal } from './modal.js';
import { createPermissionCard } from './permission-card.js';
import { PORTRAIT, drawPortrait, skinLabel } from './portrait.js';
import type { TerminalView } from './terminal-view.js';

const STATUS_KEYS: Record<AgentStatus, TranslationKey> = {
  offline: 'status.offline',
  starting: 'status.starting',
  idle: 'status.idle',
  thinking: 'status.thinking',
  tool: 'status.tool',
  waiting: 'status.waiting',
};

const WAITING_KEYS: Record<WaitingReason, TranslationKey> = {
  permission: 'waitingFor.permission',
  question: 'waitingFor.question',
  trust: 'waitingFor.trust',
  dialog: 'waitingFor.dialog',
  other: 'waitingFor.other',
};

const IDLE_KEYS: Record<IdlePlan, TranslationKey> = {
  wander: 'idle.wander',
  hearth: 'idle.hearth',
  bookshelf: 'idle.bookshelf',
  table: 'idle.table',
  chat: 'idle.chat',
  nap: 'idle.nap',
};

const ACTION_KEYS: Record<ActionState, TranslationKey> = {
  running: 'action.running',
  done: 'action.done',
  error: 'action.error',
  rejected: 'action.rejected',
  interrupted: 'action.interrupted',
};

export const ACTION_ICONS: Record<ActionState, string> = {
  running: '»',
  done: '✓',
  error: '✗',
  rejected: '⊘',
  interrupted: '■',
};

const TASK_KEYS: Record<TaskStatus, TranslationKey> = {
  pending: 'task.pending',
  in_progress: 'task.inProgress',
  completed: 'task.completed',
};

export const REFRESH_MS = 500;

export type PanelSocket = Pick<GameSocket, 'send'> & Partial<Pick<GameSocket, 'onMessage'>>;
export type PanelTerminal = Pick<TerminalView, 'element' | 'fit' | 'focus' | 'copy' | 'paste'>;
export type Confirm = (message: string) => boolean | Promise<boolean>;
export type Every = (callback: () => void, ms: number) => () => void;
export interface Frames {
  request(callback: (now: number) => void): number;
  cancel(handle: number): void;
}

export interface DetailRow {
  id: string;
  label: TranslationKey;
  value(agent: AgentView, doing: IdlePlan | null): string | null;
}

export const DETAIL_ROWS: readonly DetailRow[] = [
  { id: 'now', label: 'panel.now', value: nowText },
  { id: 'tool', label: 'panel.tool', value: (agent) => agent.tool?.name ?? null },
  {
    id: 'waiting',
    label: 'panel.waitingFor',
    value: (agent) => (agent.waitingFor == null ? null : t(WAITING_KEYS[agent.waitingFor])),
  },
  {
    id: 'model',
    label: 'panel.model',
    value: (agent) => (agent.model == null ? null : modelLabel(agent.model)),
  },
  {
    id: 'effort',
    label: 'panel.effort',
    value: (agent) => (agent.effort == null ? null : effortLabel(agent.effort)),
  },
];

export interface PanelOptions {
  store: Store;
  socket: PanelSocket;
  terminal: PanelTerminal;
  confirm?: Confirm;
  assets?: Assets;
  doing?: (agentId: string) => IdlePlan | null;
  every?: Every;
  frames?: Frames;
  keys?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  now?: () => number;
}

export interface Panel {
  readonly element: HTMLElement;
  readonly console: HTMLElement;
  destroy(): void;
}

export { skinLabel };

export function statusKey(status: AgentStatus): TranslationKey {
  return STATUS_KEYS[status];
}

const MODEL_ID = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[[^\]]*\])?$/;
const EFFORT_KEYS = new Map<string, TranslationKey>([
  ['low', 'effort.low'],
  ['medium', 'effort.medium'],
  ['high', 'effort.high'],
  ['max', 'effort.max'],
]);

export function modelLabel(model: string): string {
  const match = MODEL_ID.exec(model);
  if (!match) return model;
  const [, family = '', major = '', minor] = match;
  const version = minor === undefined ? major : `${major}.${minor}`;
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${version}`;
}

export function effortLabel(effort: string): string {
  const key = EFFORT_KEYS.get(effort.toLowerCase());
  return key === undefined ? effort : t(key);
}

export function timeAgo(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 5) return t('history.justNow');
  if (seconds < 60) return t('history.seconds', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('history.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('history.hours', { count: hours });
  return t('history.days', { count: Math.floor(hours / 24) });
}

export function newestFirst(actions: readonly AgentAction[]): AgentAction[] {
  return [...actions].sort((a, b) => b.startedAt - a.startedAt);
}

export function nowText(agent: AgentView, doing: IdlePlan | null): string {
  if (agent.status === 'tool' && agent.tool !== null) {
    return agent.tool.detail === '' ? agent.tool.name : agent.tool.detail;
  }
  if (agent.status === 'idle') return t(IDLE_KEYS[doing ?? 'wander']);
  return t(statusKey(agent.status));
}

function defaultConfirm(message: string): Promise<boolean> {
  return confirmModal(message, { danger: true });
}

const ANIMATION_FRAMES: Frames = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => {
    cancelAnimationFrame(handle);
  },
};

function defaultEvery(callback: () => void, ms: number): () => void {
  const handle = setInterval(callback, ms);
  return () => {
    clearInterval(handle);
  };
}

export function createPanel(options: PanelOptions): Panel {
  const { store, socket, terminal, assets } = options;
  const confirm = options.confirm ?? defaultConfirm;
  const doing = options.doing ?? (() => null);
  const every = options.every ?? defaultEvery;
  const frames = options.frames ?? ANIMATION_FRAMES;
  const now = options.now ?? Date.now;
  let animation: number | null = null;
  const labels = new Map<HTMLElement, TranslationKey>();
  let shown: AgentView | null = null;
  let shownAgents: readonly AgentView[] | null = null;
  let shownActivity: AgentActivity | undefined;
  const times = new Map<HTMLElement, number>();
  let consoleOpen = false;
  let stopRefresh: (() => void) | null = null;

  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string) => {
    const target = document.createElement(tag);
    target.className = className;
    return target;
  };

  const label = <T extends HTMLElement>(target: T, key: TranslationKey): T => {
    labels.set(target, key);
    return target;
  };

  const element = make('aside', 'panel');
  element.hidden = true;

  const portrait = make('canvas', 'panel__portrait');
  portrait.width = PORTRAIT.width;
  portrait.height = PORTRAIT.height;
  const name = make('h2', 'panel__name');
  const status = make('span', 'panel__status');
  const queue = make('span', 'panel__queue');
  const cwd = make('p', 'panel__cwd');
  const title = make('div', 'panel__title');
  title.append(name, status, queue);
  const identity = make('div', 'panel__identity');
  identity.append(title, cwd);
  const close = make('button', 'panel__close');
  close.type = 'button';
  close.textContent = '×';
  close.addEventListener('click', () => {
    store.focus(null);
  });
  const header = make('header', 'panel__header');
  header.append(portrait, identity, close);

  const card = createPermissionCard({
    decide: (requestId, decision) => {
      socket.send({ type: 'permission:decide', requestId, decision });
    },
    onTerminal: () => {
      setConsole(true);
    },
  });
  let shownPermissions: StoreState['permissions'] | null = null;

  const details = make('dl', 'panel__details');
  const rows = DETAIL_ROWS.map((row) => {
    const wrapper = make('div', 'panel__row');
    wrapper.dataset.row = row.id;
    const term = label(make('dt', 'panel__term'), row.label);
    const value = make('dd', 'panel__value');
    wrapper.append(term, value);
    details.append(wrapper);
    return { row, wrapper, value };
  });

  const history = make('section', 'panel__history');
  const historyTitle = label(make('h3', 'panel__heading'), 'history.title');
  const sessionRow = make('p', 'panel__session');
  const sessionLabel = label(make('span', 'panel__session-label'), 'history.session');
  const sessionTitle = make('span', 'panel__session-title');
  sessionRow.append(sessionLabel, sessionTitle);
  const tasksTitle = label(make('h4', 'panel__subheading'), 'history.tasks');
  const tasks = make('ul', 'panel__tasks');
  const tasksBlock = make('div', 'panel__tasks-block');
  tasksBlock.append(tasksTitle, tasks);
  const log = make('ol', 'panel__log');
  const empty = label(make('p', 'panel__empty'), 'history.empty');
  history.append(historyTitle, sessionRow, tasksBlock, log, empty);

  const focused = () => {
    const id = store.getState().focused;
    return id === null ? undefined : store.agent(id);
  };

  const button = (modifier: string, key: TranslationKey, action: (agent: AgentView) => void) => {
    const target = label(make('button', `panel__action panel__action--${modifier}`), key);
    target.type = 'button';
    target.addEventListener('click', () => {
      const agent = focused();
      if (agent) action(agent);
    });
    return target;
  };

  const confirmed = async (message: string): Promise<boolean> => {
    try {
      return await confirm(message);
    } catch {
      return false;
    }
  };

  const focusConsole = () => {
    if (consoleOpen) terminal.focus();
  };

  const toggle = button('console', 'panel.console', () => {
    setConsole(!consoleOpen);
  });
  const interrupt = button('interrupt', 'panel.interrupt', (agent) => {
    socket.send({ type: 'agent:interrupt', agentId: agent.id });
    focusConsole();
  });
  const restart = button('restart', 'panel.restart', (agent) => {
    socket.send({ type: 'agent:restart', agentId: agent.id });
    focusConsole();
  });
  const copy = button('copy', 'panel.copy', () => {
    void terminal.copy().finally(() => {
      terminal.focus();
    });
  });
  const paste = button('paste', 'panel.paste', () => {
    void terminal.paste();
  });
  const remove = button('remove', 'panel.remove', (agent) => {
    void confirmed(t('panel.confirmRemove', { name: agent.name })).then((ok) => {
      if (ok) socket.send({ type: 'agent:remove', agentId: agent.id });
    });
  });

  const actions = make('div', 'panel__actions');
  actions.append(toggle, interrupt, restart);
  const manage = make('div', 'panel__manage');
  manage.append(remove);
  element.append(header, card.element, details, history, actions, manage);

  const consoleTitle = make('h2', 'console-window__title');
  const consoleClose = make('button', 'console-window__close');
  consoleClose.type = 'button';
  consoleClose.textContent = '×';
  consoleClose.addEventListener('click', () => {
    setConsole(false);
  });
  const consoleBar = make('header', 'console-window__bar');
  consoleBar.append(consoleTitle, copy, paste, consoleClose);
  const consoleWindow = make('section', 'console-window');
  consoleWindow.hidden = true;
  consoleWindow.setAttribute('role', 'dialog');
  consoleWindow.append(consoleBar, terminal.element);

  const keys = options.keys ?? window;
  const onKey = (event: Event) => {
    if (!(event instanceof KeyboardEvent) || event.key !== 'Escape' || !consoleOpen) return;
    if (event.target instanceof Node && terminal.element.contains(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setConsole(false);
  };
  keys.addEventListener('keydown', onKey, true);

  function setConsole(open: boolean): void {
    consoleOpen = open;
    consoleWindow.hidden = !open;
    labels.set(toggle, open ? 'panel.hideConsole' : 'panel.console');
    toggle.textContent = t(labels.get(toggle) ?? 'panel.console');
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      terminal.fit();
      terminal.focus();
    }
  }

  const renderDetails = (agent: AgentView) => {
    const plan = doing(agent.id);
    for (const { row, wrapper, value } of rows) {
      const text = row.value(agent, plan);
      wrapper.hidden = text === null;
      if (value.textContent !== (text ?? '')) {
        value.textContent = text ?? '';
        value.title = text ?? '';
      }
    }
  };

  const renderTimes = () => {
    const current = now();
    for (const [target, startedAt] of times) {
      const text = timeAgo(current - startedAt);
      if (target.textContent !== text) target.textContent = text;
    }
  };

  const renderAction = (action: AgentAction): HTMLElement => {
    const item = make('li', 'panel__entry');
    item.dataset.state = action.state;
    const icon = make('span', 'panel__entry-icon');
    icon.textContent = ACTION_ICONS[action.state];
    icon.title = t(ACTION_KEYS[action.state]);
    icon.setAttribute('aria-label', icon.title);
    const tool = make('span', 'panel__entry-tool');
    tool.textContent = action.tool;
    const time = make('time', 'panel__entry-time');
    time.dateTime = new Date(action.startedAt).toISOString();
    times.set(time, action.startedAt);
    const head = make('div', 'panel__entry-head');
    head.append(icon, tool, time);
    item.append(head);
    if (action.detail !== '') {
      const detail = make('p', 'panel__entry-detail');
      detail.textContent = action.detail;
      detail.title = action.detail;
      item.append(detail);
    }
    if (action.result !== null && action.result !== '') {
      const result = make('p', 'panel__entry-result');
      result.textContent = action.result;
      result.title = action.result;
      item.append(result);
    }
    return item;
  };

  const renderHistory = (activity: AgentActivity | undefined) => {
    const title = activity?.title ?? null;
    sessionRow.hidden = title === null || title === '';
    sessionTitle.textContent = title ?? '';
    sessionTitle.title = title ?? '';
    const taskList = activity?.tasks ?? [];
    tasksBlock.hidden = taskList.length === 0;
    tasks.replaceChildren(
      ...taskList.map((task) => {
        const item = make('li', 'panel__task');
        item.dataset.status = task.status;
        item.textContent = task.title;
        item.title = t(TASK_KEYS[task.status]);
        return item;
      }),
    );
    times.clear();
    const actionList = newestFirst(activity?.actions ?? []);
    log.replaceChildren(...actionList.map(renderAction));
    empty.hidden = actionList.length > 0;
    renderTimes();
  };

  const renderPortrait = (agent: AgentView, time = 0) => {
    const ctx = assets ? portrait.getContext('2d') : null;
    if (ctx && assets) drawPortrait(ctx, assets, agent.skin, time);
  };

  const animate = (now: number) => {
    if (shown) renderPortrait(shown, now / 1000);
    animation = frames.request(animate);
  };

  const stopAnimation = () => {
    if (animation !== null) frames.cancel(animation);
    animation = null;
  };

  const renderAgent = (agent: AgentView) => {
    name.textContent = agent.name;
    status.dataset.status = agent.status;
    status.textContent = t(statusKey(agent.status));
    queue.hidden = agent.queued === 0;
    queue.textContent = t('workshop.queue', { count: agent.queued });
    cwd.textContent = agent.cwd;
    cwd.title = agent.cwd;
    interrupt.disabled = agent.status === 'offline';
    close.title = t('panel.close');
    close.setAttribute('aria-label', t('panel.close'));
    consoleTitle.textContent = t('console.title', { name: agent.name });
    consoleWindow.setAttribute('aria-label', consoleTitle.textContent);
    consoleClose.title = t('console.close');
    consoleClose.setAttribute('aria-label', t('console.close'));
    renderDetails(agent);
    renderPortrait(agent);
  };

  const refresh = () => {
    if (!shown) return;
    renderDetails(shown);
    renderTimes();
  };

  const render = (state: StoreState) => {
    const agent = focused() ?? null;
    if (agent?.id !== shown?.id || state.permissions !== shownPermissions) {
      shownPermissions = state.permissions;
      const pending = agent ? pendingFor(state, agent.id) : [];
      card.show(pending[0] ?? null, Math.max(0, pending.length - 1));
    }
    const activity = agent ? store.activity(agent.id) : undefined;
    if (agent?.id !== shown?.id || activity !== shownActivity) {
      shownActivity = activity;
      if (agent) {
        renderHistory(activity);
        if (agent.id !== shown?.id) history.scrollTop = 0;
      }
    }
    if (agent === shown && state.agents === shownAgents) return;
    const wasHidden = element.hidden;
    element.hidden = agent === null;
    shown = agent;
    shownAgents = state.agents;
    if (agent && stopRefresh === null) stopRefresh = every(refresh, REFRESH_MS);
    if (agent && assets && animation === null) animation = frames.request(animate);
    if (!agent) {
      stopRefresh?.();
      stopRefresh = null;
      stopAnimation();
      if (consoleOpen) setConsole(false);
    }
    if (wasHidden && agent && consoleOpen) terminal.fit();
    if (agent) renderAgent(agent);
  };

  const renderTexts = () => {
    for (const [target, key] of labels) target.textContent = t(key);
    if (shown) {
      renderAgent(shown);
      renderHistory(shownActivity);
    }
    card.renderTexts();
  };

  renderTexts();
  render(store.getState());
  const unsubscribeStore = store.subscribe(render);
  const unsubscribeLocale = onLocaleChange(renderTexts);
  const unsubscribeSocket = socket.onMessage?.((message) => {
    if (message.type !== 'error' || message.source !== 'permission:decide') return;
    const requestId = card.sent();
    if (requestId === null) return;
    if (message.code === 'PERMISSION_NOT_FOUND') {
      store.update((state) => resolvePermission(state, requestId));
    } else {
      card.retry(requestId);
    }
  });

  return {
    element,
    console: consoleWindow,
    destroy() {
      stopRefresh?.();
      stopRefresh = null;
      stopAnimation();
      keys.removeEventListener('keydown', onKey, true);
      unsubscribeStore();
      unsubscribeLocale();
      unsubscribeSocket?.();
      element.remove();
      consoleWindow.remove();
    },
  };
}
