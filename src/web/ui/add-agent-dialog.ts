import type { AgentView, PermissionMode } from '../../shared/agent.js';
import { PERMISSION_MODES } from '../../shared/agent.js';
import { MAX_AGENTS, MAX_NAME_LENGTH } from '../../shared/constants.js';
import type { ErrorCode } from '../../shared/errors.js';
import type { ServerMessage } from '../../shared/protocol.js';
import type { Assets } from '../game/assets.js';
import { NO_ASSETS } from '../game/assets.js';
import type { TranslationKey } from '../i18n/index.js';
import { getLocale, onLocaleChange, t } from '../i18n/index.js';
import type { GameSocket } from '../net/socket.js';
import type { Store } from '../state/store.js';
import type { FolderBrowser, ListFolders } from './folder-browser.js';
import { createFolderBrowser } from './folder-browser.js';
import { PORTRAIT, characterName, drawPortrait } from './portrait.js';

type ErrorMessage = Extract<ServerMessage, { type: 'error' }>;

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
  assets?: Assets;
}

export interface AddAgentDialog {
  readonly element: HTMLDialogElement;
  open(): void;
  close(): void;
  handles(message: ServerMessage): boolean;
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

export function suggestName(label: string, agents: readonly Pick<AgentView, 'name'>[]): string {
  const base = label
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
  const assets = options.assets ?? NO_ASSETS;
  const labels = new Map<HTMLElement, TranslationKey>();
  let step: Step = 'details';
  let cwd: string | null = null;
  let lastCwd: string | null = null;
  let skin: string | null = null;
  let pending: string | null = null;
  let browser: FolderBrowser | null = null;
  let frame: number | null = null;
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
  const characterLabel = label(make('span', 'recruit__label'), 'recruit.character');
  const catalog = make('div', 'recruit__catalog');
  catalog.setAttribute('role', 'radiogroup');
  const folderLabel = label(make('span', 'recruit__label'), 'recruit.folder');
  const folderButton = make('button', 'recruit__folder');
  folderButton.type = 'button';
  const folderTitle = make('span', 'recruit__folder-name');
  const folderPath = make('span', 'recruit__folder-path');
  folderButton.append(folderTitle, folderPath);
  details.append(characterLabel, catalog, folderLabel, folderButton);

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

  const picker = make('dialog', 'dialog folder-picker');
  const pickerHeader = make('header', 'dialog__header');
  const pickerClose = make('button', 'dialog__close');
  pickerClose.type = 'button';
  pickerClose.textContent = '×';
  pickerHeader.append(label(make('h2', 'dialog__title'), 'folders.title'), pickerClose);
  const pickerBody = make('div', 'folder-picker__body');
  picker.append(pickerHeader, pickerBody);

  element.append(title, full, details, trust, errorBox, footer, picker);

  const agents = () => store.getState().agents;
  const agentName = () =>
    skin === null ? '' : suggestName(characterName(assets, skin, getLocale()), agents());
  const canContinue = () =>
    !isFull(agents()) && cwd !== null && skin !== null && agentName().length > 0;

  const drawPortraits = () => {
    const time = performance.now() / 1000;
    for (const card of catalog.querySelectorAll<HTMLElement>('.recruit__character')) {
      const id = card.dataset.skin ?? '';
      const name = card.querySelector('.recruit__character-name');
      const text = characterName(assets, id, getLocale());
      if (name && name.textContent !== text) name.textContent = text;
      const ctx = card.querySelector('canvas')?.getContext('2d');
      if (!ctx) continue;
      ctx.imageSmoothingEnabled = false;
      drawPortrait(ctx, assets, id, time);
    }
  };
  const animate = () => {
    drawPortraits();
    frame = requestAnimationFrame(animate);
  };
  const stopAnimation = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };

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
        const portrait = make('canvas', 'recruit__portrait');
        portrait.width = PORTRAIT.width;
        portrait.height = PORTRAIT.height;
        const name = make('span', 'recruit__character-name');
        name.textContent = characterName(assets, id, getLocale());
        card.append(portrait, name);
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
    drawPortraits();
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
    folderTitle.textContent = cwd === null ? t('recruit.chooseFolder') : folderName(cwd) || cwd;
    folderPath.textContent = cwd ?? '';
    folderPath.hidden = cwd === null;
    folderButton.title = cwd ?? '';
    warning.textContent = t('recruit.trustWarning', { name: agentName(), path: cwd ?? '' });
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
    else folderButton.focus();
  };

  const closePicker = () => {
    browser?.destroy();
    browser = null;
    if (picker.open) picker.close();
  };

  const openPicker = () => {
    if (picker.open) return;
    browser = createFolderBrowser({
      listFolders,
      initialPath: cwd ?? lastCwd,
      onSelect: (path) => {
        cwd = path;
        lastCwd = path;
        closePicker();
        render();
        folderButton.focus();
      },
    });
    pickerBody.replaceChildren(browser.element);
    picker.showModal();
  };

  const showError = (code: ErrorCode | null, params?: Record<string, string>) => {
    const name = pending ?? agentName();
    pending = null;
    error =
      code === null
        ? { key: 'connection.lost' }
        : { key: `errors.${code}`, params: params ?? { name } };
    render();
  };

  const submit = () => {
    if (pending !== null || !canContinue() || cwd === null || skin === null) return;
    const name = agentName();
    const permissionMode = PERMISSION_MODES.find((mode) => mode === modeSelect.value) ?? 'default';
    error = null;
    pending = name;
    render();
    if (!socket.send({ type: 'agent:create', name, cwd, skin, permissionMode })) showError(null);
  };

  const reset = () => {
    step = 'details';
    cwd = null;
    pending = null;
    error = null;
    modeSelect.value = 'default';
    skin = defaultSkin(store.getState().skins, agents());
  };

  const open = () => {
    if (element.open) return;
    reset();
    render();
    if (!element.isConnected) document.body.append(element);
    element.showModal();
    stopAnimation();
    frame = requestAnimationFrame(animate);
  };

  const close = () => {
    closePicker();
    stopAnimation();
    pending = null;
    if (element.open) element.close();
  };

  folderButton.addEventListener('click', openPicker);
  pickerClose.addEventListener('click', closePicker);
  picker.addEventListener('cancel', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closePicker();
  });
  element.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });

  const handles = (message: ServerMessage): message is ErrorMessage =>
    pending !== null && message.type === 'error' && message.source === 'agent:create';
  const unsubscribeMessage = socket.onMessage((message) => {
    if (handles(message)) showError(message.code, message.params);
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
    pickerClose.setAttribute('aria-label', t('modal.dismiss'));
    render();
  };
  const unsubscribeLocale = onLocaleChange(renderTexts);
  renderTexts();

  return {
    element,
    open,
    close,
    handles,
    destroy() {
      close();
      unsubscribeMessage();
      unsubscribeStore();
      unsubscribeLocale();
      element.remove();
    },
  };
}
