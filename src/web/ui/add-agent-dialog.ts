import type { AgentView, PermissionMode } from '../../shared/agent.js';
import { PERMISSION_MODES } from '../../shared/agent.js';
import { MAX_AGENTS, MAX_NAME_LENGTH } from '../../shared/constants.js';
import type { ErrorCode } from '../../shared/errors.js';
import type { TranslationKey } from '../i18n/index.js';
import { onLocaleChange, t } from '../i18n/index.js';
import type { GameSocket } from '../net/socket.js';
import type { Store } from '../state/store.js';
import type { FolderBrowser, ListFolders } from './folder-browser.js';
import { createFolderBrowser } from './folder-browser.js';
import { skinLabel } from './panel.js';

const PERMISSION_KEYS: Record<PermissionMode, TranslationKey> = {
  default: 'recruit.permission.default',
  acceptEdits: 'recruit.permission.acceptEdits',
  plan: 'recruit.permission.plan',
};

const NAME_CHARS = /[^\p{L}\p{N} _.-]+/gu;
const LEADING_SYMBOLS = /^[^\p{L}\p{N}]+/u;

export type AddAgentSocket = Pick<GameSocket, 'send' | 'onMessage'>;
export type Step = 'details' | 'trust';

export interface AddAgentDialogOptions {
  store: Store;
  socket: AddAgentSocket;
  listFolders: ListFolders;
}

export interface AddAgentDialog {
  readonly element: HTMLDialogElement;
  open(): void;
  close(): void;
  destroy(): void;
}

export interface RecruitButton {
  readonly element: HTMLButtonElement;
  destroy(): void;
}

export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part.length > 0);
  return parts.at(-1) ?? '';
}

export function sameName(a: string, b: string): boolean {
  return a.normalize('NFC').trim().toLowerCase() === b.normalize('NFC').trim().toLowerCase();
}

export function suggestName(path: string, agents: readonly Pick<AgentView, 'name'>[]): string {
  const base = folderName(path)
    .replace(NAME_CHARS, '-')
    .replace(LEADING_SYMBOLS, '')
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  if (!base) return '';
  const taken = (name: string) => agents.some((agent) => sameName(agent.name, name));
  if (!taken(base)) return base;
  for (let n = 2; n <= MAX_AGENTS + 1; n += 1) {
    const suffix = ` ${n}`;
    const candidate = `${base.slice(0, MAX_NAME_LENGTH - suffix.length).trimEnd()}${suffix}`;
    if (!taken(candidate)) return candidate;
  }
  return base;
}

export function defaultSkin(skins: readonly string[], agents: readonly Pick<AgentView, 'skin'>[]) {
  return skins.find((skin) => !agents.some((agent) => agent.skin === skin)) ?? skins[0] ?? null;
}

export function isFull(agents: readonly unknown[]): boolean {
  return agents.length >= MAX_AGENTS;
}

export function createRecruitButton(store: Store, onClick: () => void): RecruitButton {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'recruit-button';
  element.addEventListener('click', onClick);
  const render = () => {
    const full = isFull(store.getState().agents);
    element.textContent = t('workshop.recruit');
    element.disabled = full;
    element.title = full ? t('workshop.full', { max: MAX_AGENTS }) : '';
  };
  render();
  const unsubscribeStore = store.subscribe((state, previous) => {
    if (state.agents !== previous.agents) render();
  });
  const unsubscribeLocale = onLocaleChange(render);
  return {
    element,
    destroy() {
      unsubscribeStore();
      unsubscribeLocale();
      element.remove();
    },
  };
}

export function createAddAgentDialog(options: AddAgentDialogOptions): AddAgentDialog {
  const { store, socket, listFolders } = options;
  const labels = new Map<HTMLElement, TranslationKey>();
  let step: Step = 'details';
  let cwd: string | null = null;
  let lastCwd: string | null = null;
  let skin: string | null = null;
  let nameEdited = false;
  let pending: string | null = null;
  let browser: FolderBrowser | null = null;
  let error: { key: string; params?: Record<string, string> | undefined } | null = null;

  const label = <T extends HTMLElement>(target: T, key: TranslationKey): T => {
    labels.set(target, key);
    return target;
  };
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string) => {
    const node = document.createElement(tag);
    node.className = className;
    return node;
  };
  const button = (className: string, key: TranslationKey, onClick: () => void) => {
    const node = label(make('button', `dialog__button ${className}`), key);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  };

  const element = make('dialog', 'dialog recruit');
  const title = make('h2', 'dialog__title');
  const full = make('p', 'recruit__full');
  full.setAttribute('role', 'alert');

  const details = make('section', 'recruit__step recruit__step--details');
  const folderLabel = label(make('span', 'recruit__label'), 'recruit.folder');
  const folderSlot = make('div', 'recruit__folders');
  const nameField = make('label', 'recruit__field');
  const nameInput = make('input', 'recruit__name');
  nameInput.maxLength = MAX_NAME_LENGTH;
  nameInput.autocomplete = 'off';
  nameField.append(label(make('span', 'recruit__label'), 'recruit.name'), nameInput);
  const characterLabel = label(make('span', 'recruit__label'), 'recruit.character');
  const catalog = make('div', 'recruit__catalog');
  catalog.setAttribute('role', 'radiogroup');
  details.append(folderLabel, folderSlot, nameField, characterLabel, catalog);

  const trust = make('section', 'recruit__step recruit__step--trust');
  const warning = make('p', 'recruit__warning');
  const modeField = make('label', 'recruit__field');
  const modeSelect = make('select', 'recruit__mode');
  for (const mode of PERMISSION_MODES) {
    const option = label(document.createElement('option'), PERMISSION_KEYS[mode]);
    option.value = mode;
    modeSelect.append(option);
  }
  modeField.append(label(make('span', 'recruit__label'), 'recruit.permissionMode'), modeSelect);
  trust.append(warning, modeField);

  const errorBox = make('p', 'recruit__error');
  errorBox.setAttribute('role', 'alert');

  const cancel = button('dialog__button--secondary', 'recruit.cancel', () => {
    close();
  });
  const back = button('dialog__button--secondary', 'recruit.back', () => {
    goTo('details');
  });
  const next = button('dialog__button--primary', 'recruit.next', () => {
    if (canContinue()) goTo('trust');
  });
  const confirm = button('dialog__button--primary', 'recruit.confirm', () => {
    submit();
  });
  const footer = make('footer', 'dialog__footer');
  footer.append(cancel, back, next, confirm);

  element.append(title, full, details, trust, errorBox, footer);

  const agents = () => store.getState().agents;
  const trimmedName = () => nameInput.value.trim();
  const canContinue = () =>
    !isFull(agents()) && cwd !== null && trimmedName().length > 0 && skin !== null;

  const renderCatalog = () => {
    const skins = store.getState().skins;
    if (skin === null || !skins.includes(skin)) skin = defaultSkin(skins, agents());
    catalog.replaceChildren(
      ...skins.map((id) => {
        const card = make('button', 'recruit__character');
        card.type = 'button';
        card.dataset.skin = id;
        card.setAttribute('role', 'radio');
        card.setAttribute('aria-checked', String(id === skin));
        const name = make('span', 'recruit__character-name');
        name.textContent = skinLabel(id);
        card.append(name);
        if (agents().some((agent) => agent.skin === id)) {
          const badge = make('span', 'recruit__in-use');
          badge.textContent = t('recruit.inUse');
          card.append(badge);
        }
        card.addEventListener('click', () => {
          skin = id;
          render();
        });
        return card;
      }),
    );
  };

  const render = () => {
    const isTrust = step === 'trust';
    const busy = pending !== null;
    title.textContent = t(isTrust ? 'recruit.trustTitle' : 'recruit.title');
    full.hidden = !isFull(agents());
    full.textContent = t('workshop.full', { max: MAX_AGENTS });
    details.hidden = isTrust;
    trust.hidden = !isTrust;
    back.hidden = !isTrust;
    next.hidden = isTrust;
    confirm.hidden = !isTrust;
    next.disabled = !canContinue();
    confirm.disabled = busy || !canContinue();
    back.disabled = busy;
    modeSelect.disabled = busy;
    warning.textContent = t('recruit.trustWarning', { path: cwd ?? '' });
    errorBox.hidden = error === null;
    errorBox.textContent = error ? t(error.key, error.params) : '';
    element.setAttribute('aria-busy', String(busy));
    renderCatalog();
  };

  const goTo = (target: Step) => {
    step = target;
    error = null;
    render();
    if (target === 'trust') modeSelect.focus();
    else nameInput.focus();
  };

  const setFolder = (path: string | null) => {
    cwd = path;
    if (path !== null) lastCwd = path;
    if (path !== null && !nameEdited) nameInput.value = suggestName(path, agents());
    render();
  };

  const showError = (code: ErrorCode | null, params?: Record<string, string>) => {
    pending = null;
    error = code === null ? { key: 'connection.lost' } : { key: `errors.${code}`, params };
    render();
  };

  const submit = () => {
    if (pending !== null || !canContinue() || cwd === null || skin === null) return;
    const name = trimmedName();
    const permissionMode = PERMISSION_MODES.find((mode) => mode === modeSelect.value) ?? 'default';
    error = null;
    pending = name;
    render();
    if (!socket.send({ type: 'agent:create', name, cwd, skin, permissionMode })) showError(null);
  };

  const reset = () => {
    step = 'details';
    cwd = null;
    nameEdited = false;
    pending = null;
    error = null;
    nameInput.value = '';
    modeSelect.value = 'default';
    skin = defaultSkin(store.getState().skins, agents());
  };

  const open = () => {
    if (element.open) return;
    reset();
    browser = createFolderBrowser({
      listFolders,
      initialPath: lastCwd,
      onChange: setFolder,
      onSelect: () => {
        nameInput.focus();
      },
    });
    folderSlot.replaceChildren(browser.element);
    render();
    if (!element.isConnected) document.body.append(element);
    element.showModal();
  };

  const close = () => {
    browser?.destroy();
    browser = null;
    pending = null;
    if (element.open) element.close();
  };

  nameInput.addEventListener('input', () => {
    nameEdited = true;
    render();
  });
  element.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });

  const unsubscribeMessage = socket.onMessage((message) => {
    if (pending !== null && message.type === 'error') showError(message.code, message.params);
  });
  const unsubscribeStore = store.subscribe((state, previous) => {
    if (!element.open) return;
    const created =
      pending === null ? undefined : state.agents.find((a) => sameName(a.name, pending ?? ''));
    if (created) {
      close();
      store.focus(created.id);
      return;
    }
    if (state.agents !== previous.agents || state.skins !== previous.skins) render();
  });
  const renderTexts = () => {
    for (const [target, key] of labels) target.textContent = t(key);
    render();
  };
  const unsubscribeLocale = onLocaleChange(renderTexts);
  renderTexts();

  return {
    element,
    open,
    close,
    destroy() {
      close();
      unsubscribeMessage();
      unsubscribeStore();
      unsubscribeLocale();
      element.remove();
    },
  };
}
