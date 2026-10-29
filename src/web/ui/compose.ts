import { MAX_PROMPT_LENGTH } from '../../shared/constants.js';
import type { TranslationKey } from '../i18n/index.js';
import { onLocaleChange, t } from '../i18n/index.js';
import type { GameSocket } from '../net/socket.js';
import type { Store, StoreState } from '../state/store.js';

export type ComposeSocket = Pick<GameSocket, 'send'>;
export type SubmitKey = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'isComposing'>;

export interface ComposeOptions {
  store: Store;
  socket: ComposeSocket;
}

export interface Compose {
  readonly element: HTMLElement;
  focus(): void;
  destroy(): void;
}

export function isSubmitKey(event: SubmitKey): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing;
}

export function canSend(text: string, state: Pick<StoreState, 'selected' | 'connection'>): boolean {
  return state.connection === 'open' && state.selected.length > 0 && text.trim().length > 0;
}

export function createCompose(options: ComposeOptions): Compose {
  const { store, socket } = options;
  const labels = new Map<HTMLElement, TranslationKey>();

  const element = document.createElement('form');
  element.className = 'compose';
  element.hidden = true;

  const input = document.createElement('textarea');
  input.className = 'compose__input';
  input.rows = 2;
  input.maxLength = MAX_PROMPT_LENGTH;

  const hint = document.createElement('span');
  hint.className = 'compose__hint';
  labels.set(hint, 'compose.hint');

  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'compose__send';
  labels.set(send, 'compose.send');

  const footer = document.createElement('div');
  footer.className = 'compose__footer';
  footer.append(hint, send);
  element.append(input, footer);

  const renderState = () => {
    const state = store.getState();
    element.hidden = state.selected.length === 0;
    input.placeholder = t('compose.placeholder', { count: state.selected.length });
    send.disabled = !canSend(input.value, state);
  };

  const submit = () => {
    const state = store.getState();
    if (!canSend(input.value, state)) return;
    const sent = socket.send({
      type: 'prompt:send',
      agentIds: [...state.selected],
      text: input.value,
    });
    if (!sent) return;
    input.value = '';
    renderState();
  };

  element.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });
  input.addEventListener('keydown', (event) => {
    if (!isSubmitKey(event)) return;
    event.preventDefault();
    submit();
  });
  input.addEventListener('input', renderState);

  const renderTexts = () => {
    for (const [target, key] of labels) target.textContent = t(key);
    renderState();
  };

  renderTexts();
  const unsubscribeStore = store.subscribe((state, previous) => {
    if (state.selected !== previous.selected || state.connection !== previous.connection) {
      renderState();
    }
  });
  const unsubscribeLocale = onLocaleChange(renderTexts);

  return {
    element,
    focus() {
      input.focus();
    },
    destroy() {
      unsubscribeStore();
      unsubscribeLocale();
      element.remove();
    },
  };
}
