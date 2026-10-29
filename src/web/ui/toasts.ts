import { onLocaleChange, t } from '../i18n/index.js';

export const TOAST_DURATION_MS = 5_000;
export const MAX_TOASTS = 4;

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastTimers {
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export interface Toasts {
  readonly element: HTMLElement;
  show(text: string, kind?: ToastKind, durationMs?: number): void;
  clear(): void;
  destroy(): void;
}

interface Toast {
  readonly node: HTMLElement;
  readonly dismiss: HTMLButtonElement;
  readonly text: string;
  timer: unknown;
}

const DEFAULT_TIMERS: ToastTimers = {
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export function createToasts(timers: ToastTimers = DEFAULT_TIMERS): Toasts {
  const toasts: Toast[] = [];
  const element = document.createElement('div');
  element.className = 'toasts';
  element.setAttribute('aria-live', 'polite');

  const remove = (toast: Toast) => {
    const index = toasts.indexOf(toast);
    if (index === -1) return;
    toasts.splice(index, 1);
    timers.clearTimer(toast.timer);
    toast.node.remove();
  };

  const show = (text: string, kind: ToastKind = 'info', durationMs = TOAST_DURATION_MS) => {
    const duplicate = toasts.find((toast) => toast.text === text);
    if (duplicate) remove(duplicate);
    while (toasts.length >= MAX_TOASTS) {
      const oldest = toasts[0];
      if (oldest) remove(oldest);
    }
    const node = document.createElement('div');
    node.className = `toast toast--${kind}`;
    node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    const message = document.createElement('span');
    message.className = 'toast__text';
    message.textContent = text;
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'toast__dismiss';
    dismiss.textContent = '×';
    dismiss.setAttribute('aria-label', t('modal.dismiss'));
    node.append(message, dismiss);
    const toast: Toast = { node, dismiss, text, timer: null };
    dismiss.addEventListener('click', () => {
      remove(toast);
    });
    toast.timer = timers.setTimer(() => {
      remove(toast);
    }, durationMs);
    toasts.push(toast);
    element.append(node);
  };

  const clear = () => {
    for (const toast of [...toasts]) remove(toast);
  };

  const unsubscribeLocale = onLocaleChange(() => {
    for (const toast of toasts) toast.dismiss.setAttribute('aria-label', t('modal.dismiss'));
  });

  return {
    element,
    show,
    clear,
    destroy() {
      clear();
      unsubscribeLocale();
      element.remove();
    },
  };
}
