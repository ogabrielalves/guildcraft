import { t } from '../i18n/index.js';

export interface ConfirmOptions {
  confirmLabel?: string;
  danger?: boolean;
  parent?: HTMLElement;
}

export function confirmModal(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog modal';
    const text = document.createElement('p');
    text.className = 'modal__message';
    text.textContent = message;

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'dialog__button dialog__button--secondary';
    cancel.textContent = t('modal.cancel');

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = `dialog__button dialog__button--primary${options.danger ? ' dialog__button--danger' : ''}`;
    confirm.textContent = options.confirmLabel ?? t('modal.confirm');

    const footer = document.createElement('footer');
    footer.className = 'dialog__footer';
    footer.append(cancel, confirm);
    dialog.append(text, footer);

    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancel.addEventListener('click', () => {
      finish(false);
    });
    confirm.addEventListener('click', () => {
      finish(true);
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });

    (options.parent ?? document.body).append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}
