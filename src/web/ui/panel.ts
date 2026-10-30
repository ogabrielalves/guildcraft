import type { AgentStatus, AgentView, WaitingReason } from '../../shared/agent.js';
import type { IdlePlan } from '../game/activity.js';
import type { Assets } from '../game/assets.js';
import type { TranslationKey } from '../i18n/index.js';
import { onLocaleChange, t } from '../i18n/index.js';
import type { GameSocket } from '../net/socket.js';
import type { Store, StoreState } from '../state/store.js';
import { confirmModal } from './modal.js';
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

export const REFRESH_MS = 500;

export type PanelSocket = Pick<GameSocket, 'send'>;
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
    value: (agent) => (agent.waitingFor === null ? null : t(WAITING_KEYS[agent.waitingFor])),
  },
  {
    id: 'model',
    label: 'panel.model',
    value: (agent) => (agent.model === null ? null : modelLabel(agent.model)),
  },
  {
    id: 'effort',
    label: 'panel.effort',
    value: (agent) => (agent.effort === null ? null : effortLabel(agent.effort)),
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
}

export interface Panel {
  readonly element: HTMLElement;
  destroy(): void;
}

export { skinLabel };

export function statusKey(status: AgentStatus): TranslationKey {
  return STATUS_KEYS[status];
}

export function skinChoices(skins: readonly string[], current: string): string[] {
  return skins.includes(current) ? [...skins] : [current, ...skins];
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
  let animation: number | null = null;
  const labels = new Map<HTMLElement, TranslationKey>();
  let shown: AgentView | null = null;
  let shownSkins: readonly string[] | null = null;
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
  element.dataset.console = 'closed';

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

  const skinField = make('label', 'panel__skin');
  const skinText = label(make('span', 'panel__skin-label'), 'panel.changeSkin');
  const skinSelect = document.createElement('select');
  skinSelect.addEventListener('change', () => {
    const agent = focused();
    if (agent && skinSelect.value !== agent.skin) {
      socket.send({ type: 'agent:setSkin', agentId: agent.id, skin: skinSelect.value });
    }
  });
  skinField.append(skinText, skinSelect);

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
  const removeAll = button('remove-all', 'panel.removeAll', () => {
    void confirmed(t('panel.confirmRemoveAll')).then((ok) => {
      if (ok) socket.send({ type: 'agent:removeAll' });
    });
  });

  const actions = make('div', 'panel__actions');
  actions.append(toggle, interrupt, restart);
  const manage = make('div', 'panel__manage');
  manage.append(skinField, remove, removeAll);
  const tools = make('div', 'panel__console-tools');
  tools.append(copy, paste);
  const consoleSection = make('section', 'panel__console');
  consoleSection.hidden = true;
  consoleSection.append(tools, terminal.element);
  element.append(header, details, actions, manage, consoleSection);

  function setConsole(open: boolean): void {
    consoleOpen = open;
    consoleSection.hidden = !open;
    element.dataset.console = open ? 'open' : 'closed';
    labels.set(toggle, open ? 'panel.hideConsole' : 'panel.console');
    toggle.textContent = t(labels.get(toggle) ?? 'panel.console');
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      terminal.fit();
      terminal.focus();
    }
  }

  const renderSkins = (agent: AgentView, skins: readonly string[]) => {
    const choices = skinChoices(skins, agent.skin).map((skin) => {
      const option = document.createElement('option');
      option.value = skin;
      option.textContent = skinLabel(skin);
      return option;
    });
    skinSelect.replaceChildren(...choices);
    skinSelect.value = agent.skin;
    skinSelect.disabled = choices.length < 2;
  };

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
    renderDetails(agent);
    renderPortrait(agent);
  };

  const refresh = () => {
    if (shown) renderDetails(shown);
  };

  const render = (state: StoreState) => {
    const agent = focused() ?? null;
    if (agent === shown && state.skins === shownSkins) return;
    const wasHidden = element.hidden;
    element.hidden = agent === null;
    if (agent) {
      renderAgent(agent);
      renderSkins(agent, state.skins);
    }
    shown = agent;
    shownSkins = state.skins;
    if (agent && stopRefresh === null) stopRefresh = every(refresh, REFRESH_MS);
    if (agent && assets && animation === null) animation = frames.request(animate);
    if (!agent) {
      stopRefresh?.();
      stopRefresh = null;
      stopAnimation();
    }
    if (wasHidden && agent && consoleOpen) terminal.fit();
  };

  const renderTexts = () => {
    for (const [target, key] of labels) target.textContent = t(key);
    if (shown) renderAgent(shown);
  };

  renderTexts();
  render(store.getState());
  const unsubscribeStore = store.subscribe(render);
  const unsubscribeLocale = onLocaleChange(renderTexts);

  return {
    element,
    destroy() {
      stopRefresh?.();
      stopRefresh = null;
      stopAnimation();
      unsubscribeStore();
      unsubscribeLocale();
      element.remove();
    },
  };
}
