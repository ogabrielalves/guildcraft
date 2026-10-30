// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentView } from '../../shared/agent.js';
import { MAX_PROMPT_LENGTH } from '../../shared/constants.js';
import type { ClientMessage } from '../../shared/protocol.js';
import { DICTIONARIES, initI18n, setLocale } from '../i18n/index.js';
import { Store } from '../state/store.js';
import { canSend, createCompose, isSubmitKey } from './compose.js';

afterEach(() => {
  initI18n({ storage: null, languages: [] });
});

function agent(id: string): AgentView {
  return {
    id,
    name: id,
    cwd: `/projects/${id}`,
    skin: 'mortis',
    status: 'idle',
    permissionMode: 'default',
    tool: null,
    waitingFor: null,
    queued: 0,
  };
}

function setup(connected = true) {
  const store = new Store();
  store.apply({
    type: 'session:init',
    agents: [agent('a'), agent('b')],
    events: [],
    skins: [],
    permissions: [],
  });
  store.setConnection('open');
  const sent: ClientMessage[] = [];
  const link = { connected };
  const compose = createCompose({
    store,
    socket: {
      send: (message) => {
        if (link.connected) sent.push(message);
        return link.connected;
      },
    },
  });
  const part = <T extends Element>(selector: string, type: new () => T): T => {
    const found = compose.element.querySelector(selector);
    if (!(found instanceof type)) throw new Error(`missing ${selector}`);
    return found;
  };
  const input = part('.compose__input', HTMLTextAreaElement);
  const button = part('.compose__send', HTMLButtonElement);
  const type = (text: string) => {
    input.value = text;
    input.dispatchEvent(new Event('input'));
  };
  const press = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { cancelable: true, ...init });
    input.dispatchEvent(event);
    return event;
  };
  return { store, compose, sent, link, input, button, type, press };
}

describe('isSubmitKey', () => {
  it('submits on plain Enter only', () => {
    expect(isSubmitKey({ key: 'Enter', shiftKey: false, isComposing: false })).toBe(true);
    expect(isSubmitKey({ key: 'Enter', shiftKey: true, isComposing: false })).toBe(false);
    expect(isSubmitKey({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false);
    expect(isSubmitKey({ key: 'a', shiftKey: false, isComposing: false })).toBe(false);
  });
});

describe('canSend', () => {
  it('needs an open connection, a selection and non-blank text', () => {
    expect(canSend('hi', { selected: ['a'], connection: 'open' })).toBe(true);
    expect(canSend('  \n', { selected: ['a'], connection: 'open' })).toBe(false);
    expect(canSend('hi', { selected: [], connection: 'open' })).toBe(false);
    expect(canSend('hi', { selected: ['a'], connection: 'closed' })).toBe(false);
  });
});

describe('createCompose', () => {
  it('shows only while agents are selected', () => {
    const { store, compose } = setup();
    expect(compose.element.hidden).toBe(true);
    store.select('a');
    expect(compose.element.hidden).toBe(false);
    store.clearSelection();
    expect(compose.element.hidden).toBe(true);
  });

  it('counts the selected agents in the placeholder', () => {
    const { store, input } = setup();
    store.select('a');
    store.select('b', 'add');
    expect(input.placeholder).toBe('Send a prompt to 2 selected');
    expect(input.maxLength).toBe(MAX_PROMPT_LENGTH);
  });

  it('enables sending only with text', () => {
    const { store, button, type } = setup();
    store.select('a');
    expect(button.disabled).toBe(true);
    type('hello');
    expect(button.disabled).toBe(false);
    type('   ');
    expect(button.disabled).toBe(true);
  });

  it('sends to every selected agent on Enter and clears the input', () => {
    const { store, sent, input, type, press } = setup();
    store.select('a');
    store.select('b', 'add');
    type('run the tests');
    const event = press({ key: 'Enter' });
    expect(event.defaultPrevented).toBe(true);
    expect(sent).toEqual([{ type: 'prompt:send', agentIds: ['a', 'b'], text: 'run the tests' }]);
    expect(input.value).toBe('');
  });

  it('keeps Shift+Enter as a new line', () => {
    const { store, sent, type, press } = setup();
    store.select('a');
    type('line');
    const event = press({ key: 'Enter', shiftKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(sent).toEqual([]);
  });

  it('sends with the button', () => {
    const { store, compose, sent, button, type } = setup();
    document.body.append(compose.element);
    store.select('b');
    type('hi');
    button.click();
    expect(sent).toEqual([{ type: 'prompt:send', agentIds: ['b'], text: 'hi' }]);
  });

  it('does not send blank prompts', () => {
    const { store, sent, type, press } = setup();
    store.select('a');
    type(' ');
    press({ key: 'Enter' });
    expect(sent).toEqual([]);
  });

  it('keeps the text when the socket refuses the message', () => {
    const { store, sent, link, input, type, press } = setup(false);
    store.select('a');
    type('important');
    press({ key: 'Enter' });
    expect(sent).toEqual([]);
    expect(input.value).toBe('important');
    link.connected = true;
    press({ key: 'Enter' });
    expect(sent).toHaveLength(1);
  });

  it('disables sending while disconnected', () => {
    const { store, button, type } = setup();
    store.select('a');
    type('hi');
    store.setConnection('closed');
    expect(button.disabled).toBe(true);
    store.setConnection('open');
    expect(button.disabled).toBe(false);
  });

  it('translates texts when the locale changes', () => {
    const { store, input, button } = setup();
    store.select('a');
    setLocale('pt-BR');
    expect(button.textContent).toBe(DICTIONARIES['pt-BR'].get('compose.send'));
    expect(input.placeholder).toBe('Enviar prompt para 1 selecionados');
  });

  it('focuses the input on request', () => {
    const { store, compose, input } = setup();
    document.body.append(compose.element);
    store.select('a');
    compose.focus();
    expect(document.activeElement).toBe(input);
  });

  it('stops listening on destroy', () => {
    const { store, compose } = setup();
    document.body.append(compose.element);
    compose.destroy();
    expect(compose.element.isConnected).toBe(false);
    store.select('a');
    expect(compose.element.hidden).toBe(true);
  });
});
