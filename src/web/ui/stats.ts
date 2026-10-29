import type { AgentView } from '../../shared/agent.js';
import type { TranslationKey } from '../i18n/index.js';
import { onLocaleChange, t } from '../i18n/index.js';
import type { Store } from '../state/store.js';

export interface AgentStats {
  agents: number;
  working: number;
  waiting: number;
}

export interface Stats {
  readonly element: HTMLElement;
  destroy(): void;
}

const STAT_FIELDS = ['agents', 'working', 'waiting'] as const;

const STAT_KEYS: Record<keyof AgentStats, TranslationKey> = {
  agents: 'stats.agents',
  working: 'stats.working',
  waiting: 'stats.waiting',
};

export function countAgents(agents: readonly Pick<AgentView, 'status'>[]): AgentStats {
  return {
    agents: agents.length,
    working: agents.filter((agent) => agent.status === 'thinking' || agent.status === 'tool')
      .length,
    waiting: agents.filter((agent) => agent.status === 'waiting').length,
  };
}

export function createStats(store: Store): Stats {
  const element = document.createElement('div');
  element.className = 'stats';
  const nodes = new Map(
    STAT_FIELDS.map((field) => {
      const node = document.createElement('span');
      node.className = `stats__item stats__item--${field}`;
      return [field, node] as const;
    }),
  );
  element.append(...nodes.values());

  const render = () => {
    const stats = countAgents(store.getState().agents);
    for (const [field, node] of nodes) {
      node.textContent = t(STAT_KEYS[field], { count: stats[field] });
      node.dataset.count = String(stats[field]);
    }
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
