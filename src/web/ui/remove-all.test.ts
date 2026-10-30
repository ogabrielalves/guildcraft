// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentView } from '../../shared/agent.js';
import type { ClientMessage } from '../../shared/protocol.js';
import { initI18n, setLocale } from '../i18n/index.js';
import { Store } from '../state/store.js';
import { createRemoveAllButton } from './remove-all.js';

afterEach(() => {
  initI18n({ storage: null, languages: [] });
});

function agent(id: string): AgentView {
  return {
    id,
    name: id,
    cwd: '/',
    skin: 'brom',
    status: 'idle',
    permissionMode: 'default',
    tool: null,
    waitingFor: null,
    model: null,
    effort: null,
    queued: 0,
  };
}

function setup(answer: () => boolean | Promise<boolean>) {
  const store = new Store();
  const sent: ClientMessage[] = [];
  const confirm = vi.fn(answer);
  const button = createRemoveAllButton({
    store,
    socket: {
      send: (message) => {
        sent.push(message);
        return true;
      },
    },
    confirm,
  });
  return { store, sent, confirm, button };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createRemoveAllButton', () => {
  it('is styled like RECRUIT and disabled while the guild is empty', () => {
    const { store, button } = setup(() => true);
    expect(button.element.className).toBe('recruit-button recruit-button--danger');
    expect(button.element.textContent).toBe('Remove all');
    expect(button.element.disabled).toBe(true);
    store.apply({ type: 'agent:updated', agent: agent('a') });
    expect(button.element.disabled).toBe(false);
    setLocale('pt-BR');
    expect(button.element.textContent).toBe('Remover todos');
  });

  it('removes everyone only after confirmation', async () => {
    const answers = [false, true];
    const { store, sent, confirm, button } = setup(() => answers.shift() ?? false);
    store.apply({ type: 'agent:updated', agent: agent('a') });
    button.element.click();
    await flush();
    expect(sent).toEqual([]);
    button.element.click();
    await flush();
    expect(confirm).toHaveBeenCalledWith('Remove all adventurers? Every agent will be stopped.');
    expect(sent).toEqual([{ type: 'agent:removeAll' }]);
  });

  it('treats a failing confirmation as a no and stops listening on destroy', async () => {
    const { store, sent, button } = setup(() => Promise.reject(new Error('closed')));
    store.apply({ type: 'agent:updated', agent: agent('a') });
    button.element.click();
    await flush();
    expect(sent).toEqual([]);
    document.body.append(button.element);
    button.destroy();
    expect(button.element.isConnected).toBe(false);
    store.apply({ type: 'agent:removed', agentId: 'a' });
    expect(button.element.disabled).toBe(false);
  });
});
