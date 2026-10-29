import type { VillageEvent } from '../../shared/agent.js';
import { onLocaleChange, t } from '../i18n/index.js';
import type { Store, StoreState } from '../state/store.js';

export const FEED_SIZE = 6;
const UNKNOWN_NAME = '?';

export type NameOf = (agentId: string | undefined) => string;

export interface Feed {
  readonly element: HTMLElement;
  destroy(): void;
}

export function eventText(event: VillageEvent, nameOf: NameOf): string {
  const name = nameOf(event.agentId);
  switch (event.kind) {
    case 'joined':
      return t('feed.joined', { name });
    case 'left':
      return t('feed.left', { name });
    case 'finished':
      return t('feed.finished', { name });
    case 'waiting':
      return t('feed.needsApproval', { name });
    case 'prompted':
      return t('feed.prompted', { name });
    case 'messaged':
      return t('feed.message', { from: name, to: nameOf(event.targetId) });
    case 'delivered':
      return t('feed.delivered', { name: nameOf(event.targetId) });
  }
}

export function createFeed(store: Store): Feed {
  const names = new Map<string, string>();
  const element = document.createElement('ol');
  element.className = 'feed';
  element.setAttribute('aria-live', 'polite');

  const nameOf: NameOf = (agentId) =>
    agentId === undefined ? UNKNOWN_NAME : (names.get(agentId) ?? UNKNOWN_NAME);

  const remember = (state: StoreState): boolean => {
    let learned = false;
    for (const agent of state.agents) {
      if (names.get(agent.id) === agent.name) continue;
      names.set(agent.id, agent.name);
      learned = true;
    }
    return learned;
  };

  const render = () => {
    const events = store.getState().events.slice(-FEED_SIZE);
    element.hidden = events.length === 0;
    element.replaceChildren(
      ...events.map((event) => {
        const item = document.createElement('li');
        item.className = `feed__item feed__item--${event.kind}`;
        item.textContent = eventText(event, nameOf);
        return item;
      }),
    );
  };

  remember(store.getState());
  render();
  const unsubscribeStore = store.subscribe((state, previous) => {
    const learned = state.agents !== previous.agents && remember(state);
    if (learned || state.events !== previous.events) render();
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
