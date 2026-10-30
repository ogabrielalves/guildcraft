import { onLocaleChange, t } from '../i18n/index.js';
import type { GameSocket } from '../net/socket.js';
import type { Store } from '../state/store.js';
import { confirmModal } from './modal.js';

export interface RemoveAllOptions {
  store: Store;
  socket: Pick<GameSocket, 'send'>;
  confirm?: (message: string) => boolean | Promise<boolean>;
}

export interface RemoveAllButton {
  readonly element: HTMLButtonElement;
  destroy(): void;
}

export function createRemoveAllButton(options: RemoveAllOptions): RemoveAllButton {
  const { store, socket } = options;
  const confirm = options.confirm ?? ((message) => confirmModal(message, { danger: true }));
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'recruit-button recruit-button--danger';
  element.addEventListener('click', () => {
    void Promise.resolve()
      .then(() => confirm(t('workshop.confirmRemoveAll')))
      .catch(() => false)
      .then((ok) => {
        if (ok) socket.send({ type: 'agent:removeAll' });
      });
  });
  const render = () => {
    element.textContent = t('workshop.removeAll');
    element.disabled = store.getState().agents.length === 0;
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
