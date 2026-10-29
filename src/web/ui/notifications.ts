import type { AgentView } from '../../shared/agent.js';
import type { ClientMessage, ServerMessage } from '../../shared/protocol.js';
import { onLocaleChange, t } from '../i18n/index.js';
import type { GameSocket } from '../net/socket.js';
import type { Store, StoreState } from '../state/store.js';
import type { Toasts } from './toasts.js';

export interface SystemNotifier {
  readonly permission: NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  show(title: string, body: string): void;
}

export interface NotificationsOptions {
  store: Store;
  socket: Pick<GameSocket, 'onMessage'>;
  toasts: Pick<Toasts, 'show'>;
  doc?: Document;
  system?: SystemNotifier | null;
  isHandled?: (message: ServerMessage) => boolean;
}

export interface Notifications {
  destroy(): void;
}

export function tabTitle(waiting: number): string {
  return waiting > 0 ? `(❗${waiting}) ${t('app.title')}` : t('app.title');
}

export function newlyWaiting(state: StoreState, previous: StoreState): AgentView[] {
  const before = new Map(previous.agents.map((agent) => [agent.id, agent.status]));
  return state.agents.filter(
    (agent) => agent.status === 'waiting' && before.get(agent.id) !== 'waiting',
  );
}

export function browserNotifier(): SystemNotifier | null {
  if (typeof Notification === 'undefined') return null;
  return {
    get permission() {
      return Notification.permission;
    },
    requestPermission: () => Notification.requestPermission(),
    show(title, body) {
      new Notification(title, { body, tag: 'guildcraft-approval' });
    },
  };
}

export function reportFailedSends(
  socket: Pick<GameSocket, 'send'>,
  onFailure: (message: ClientMessage) => void,
): Pick<GameSocket, 'send'> {
  return {
    send(message) {
      const sent = socket.send(message);
      if (!sent) onFailure(message);
      return sent;
    },
  };
}

export function createNotifications(options: NotificationsOptions): Notifications {
  const { store, socket, toasts } = options;
  const doc = options.doc ?? document;
  const system = options.system === undefined ? browserNotifier() : options.system;

  const waitingCount = () =>
    store.getState().agents.filter((agent) => agent.status === 'waiting').length;
  const renderTitle = () => {
    doc.title = tabTitle(waitingCount());
  };

  const announce = (agent: AgentView) => {
    const title = t('notifications.approvalTitle', { name: agent.name });
    toasts.show(title, 'warning');
    if (doc.hidden && system?.permission === 'granted') {
      try {
        system.show(title, t('notifications.approvalBody'));
      } catch {
        return;
      }
    }
  };

  const askPermission = () => {
    doc.removeEventListener('pointerdown', askPermission);
    if (system?.permission === 'default') void system.requestPermission().catch(() => undefined);
  };
  doc.addEventListener('pointerdown', askPermission);

  const unsubscribeStore = store.subscribe((state, previous) => {
    if (state.agents === previous.agents) return;
    for (const agent of newlyWaiting(state, previous)) announce(agent);
    renderTitle();
  });
  const unsubscribeMessage = socket.onMessage((message) => {
    if (message.type !== 'error' || options.isHandled?.(message)) return;
    toasts.show(t(`errors.${message.code}`, message.params), 'error');
  });
  const unsubscribeLocale = onLocaleChange(renderTitle);
  renderTitle();

  return {
    destroy() {
      doc.removeEventListener('pointerdown', askPermission);
      unsubscribeStore();
      unsubscribeMessage();
      unsubscribeLocale();
    },
  };
}
