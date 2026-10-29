import type { AgentStatus, AgentView } from '../../shared/agent.js';
import type { TranslationKey } from '../i18n/index.js';
import { onLocaleChange, t } from '../i18n/index.js';
import type { GameSocket } from '../net/socket.js';
import type { Store, StoreState } from '../state/store.js';
import { confirmModal } from './modal.js';
import type { TerminalView } from './terminal-view.js';

const STATUS_KEYS: Record<AgentStatus, TranslationKey> = {
  offline: 'status.offline',
  starting: 'status.starting',
  idle: 'status.idle',
  thinking: 'status.thinking',
  tool: 'status.tool',
  waiting: 'status.waiting',
};

export type PanelSocket = Pick<GameSocket, 'send'>;
export type PanelTerminal = Pick<TerminalView, 'element' | 'fit' | 'focus' | 'copy' | 'paste'>;
export type Confirm = (message: string) => boolean | Promise<boolean>;

export interface PanelOptions {
  store: Store;
  socket: PanelSocket;
  terminal: PanelTerminal;
  confirm?: Confirm;
}

export interface Panel {
  readonly element: HTMLElement;
  destroy(): void;
}

export function statusKey(status: AgentStatus): TranslationKey {
  return STATUS_KEYS[status];
}

export function skinLabel(skin: string): string {
  return skin.charAt(0).toUpperCase() + skin.slice(1);
}

export function skinChoices(skins: readonly string[], current: string): string[] {
  return skins.includes(current) ? [...skins] : [current, ...skins];
}

function defaultConfirm(message: string): Promise<boolean> {
  return confirmModal(message, { danger: true });
}

export function createPanel(options: PanelOptions): Panel {
  const { store, socket, terminal } = options;
  const confirm = options.confirm ?? defaultConfirm;
  const labels = new Map<HTMLElement, TranslationKey>();
  let shown: AgentView | null = null;
  let shownSkins: readonly string[] | null = null;

  const element = document.createElement('aside');
  element.className = 'panel';
  element.hidden = true;

  const header = document.createElement('header');
  header.className = 'panel__header';
  const name = document.createElement('h2');
  name.className = 'panel__name';
  const status = document.createElement('span');
  status.className = 'panel__status';
  const queue = document.createElement('span');
  queue.className = 'panel__queue';
  const cwd = document.createElement('p');
  cwd.className = 'panel__cwd';
  const title = document.createElement('div');
  title.className = 'panel__title';
  title.append(name, status, queue);
  header.append(title, cwd);

  const focused = () => {
    const id = store.getState().focused;
    return id === null ? undefined : store.agent(id);
  };

  const label = <T extends HTMLElement>(target: T, key: TranslationKey): T => {
    labels.set(target, key);
    return target;
  };

  const button = (modifier: string, key: TranslationKey, action: (agent: AgentView) => void) => {
    const target = label(document.createElement('button'), key);
    target.type = 'button';
    target.className = `panel__action panel__action--${modifier}`;
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

  const skinField = document.createElement('label');
  skinField.className = 'panel__skin';
  const skinText = label(document.createElement('span'), 'panel.changeSkin');
  const skinSelect = document.createElement('select');
  skinSelect.addEventListener('change', () => {
    const agent = focused();
    if (agent && skinSelect.value !== agent.skin) {
      socket.send({ type: 'agent:setSkin', agentId: agent.id, skin: skinSelect.value });
    }
  });
  skinField.append(skinText, skinSelect);

  const interrupt = button('interrupt', 'panel.interrupt', (agent) => {
    socket.send({ type: 'agent:interrupt', agentId: agent.id });
    terminal.focus();
  });
  const restart = button('restart', 'panel.restart', (agent) => {
    socket.send({ type: 'agent:restart', agentId: agent.id });
    terminal.focus();
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

  const actions = document.createElement('div');
  actions.className = 'panel__actions';
  actions.append(skinField, interrupt, restart, copy, paste, remove, removeAll);
  element.append(header, actions, terminal.element);

  const renderSkins = (agent: AgentView, skins: readonly string[]) => {
    const options = skinChoices(skins, agent.skin).map((skin) => {
      const option = document.createElement('option');
      option.value = skin;
      option.textContent = skinLabel(skin);
      return option;
    });
    skinSelect.replaceChildren(...options);
    skinSelect.value = agent.skin;
    skinSelect.disabled = options.length < 2;
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
    if (wasHidden && agent) terminal.fit();
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
      unsubscribeStore();
      unsubscribeLocale();
      element.remove();
    },
  };
}
