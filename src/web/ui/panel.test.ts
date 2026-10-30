// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentView } from '../../shared/agent.js';
import { AGENT_STATUSES, WAITING_REASONS } from '../../shared/agent.js';
import type { ClientMessage } from '../../shared/protocol.js';
import type { IdlePlan } from '../game/activity.js';
import { IDLE_PLANS } from '../game/activity.js';
import type { Assets } from '../game/assets.js';
import { SIDE_CHARACTER, fakeAssets } from '../game/fake-assets.js';
import { DICTIONARIES, initI18n, setLocale } from '../i18n/index.js';
import { Store } from '../state/store.js';
import type { Confirm, PanelTerminal } from './panel.js';
import {
  DETAIL_ROWS,
  REFRESH_MS,
  createPanel,
  effortLabel,
  modelLabel,
  nowText,
  skinChoices,
  skinLabel,
  statusKey,
} from './panel.js';

afterEach(() => {
  initI18n({ storage: null, languages: [] });
});

function agent(id: string, overrides: Partial<AgentView> = {}): AgentView {
  return {
    id,
    name: `Agent ${id}`,
    cwd: `/projects/${id}`,
    skin: 'mortis',
    status: 'idle',
    permissionMode: 'default',
    tool: null,
    waitingFor: null,
    model: null,
    effort: null,
    queued: 0,
    ...overrides,
  };
}

interface SetupOptions {
  confirm?: Confirm;
  agents?: AgentView[];
  skins?: string[];
  doing?: IdlePlan | null;
  assets?: Assets;
  keys?: EventTarget;
}

function setup(options: SetupOptions = {}) {
  const store = new Store();
  store.apply({
    type: 'session:init',
    agents: options.agents ?? [agent('a'), agent('b', { skin: 'lyra' })],
    events: [],
    skins: options.skins ?? ['mortis', 'corvin', 'lyra'],
    permissions: [],
    activities: [],
  });
  const sent: ClientMessage[] = [];
  const terminal = {
    element: document.createElement('section'),
    fit: vi.fn(),
    focus: vi.fn(),
    copy: vi.fn(() => Promise.resolve(true)),
    paste: vi.fn(() => Promise.resolve(true)),
  } satisfies PanelTerminal;
  const confirm = vi.fn(options.confirm ?? (() => true));
  const ticks: (() => void)[] = [];
  const frames: ((now: number) => void)[] = [];
  const cancelled: number[] = [];
  const stop = vi.fn();
  let doing = options.doing ?? null;
  const panel = createPanel({
    store,
    socket: {
      send: (message) => {
        sent.push(message);
        return true;
      },
    },
    terminal,
    confirm,
    ...(options.assets ? { assets: options.assets } : {}),
    ...(options.keys ? { keys: options.keys } : {}),
    doing: () => doing,
    every: (callback, ms) => {
      expect(ms).toBe(REFRESH_MS);
      ticks.push(callback);
      return stop;
    },
    frames: {
      request: (callback) => {
        frames.push(callback);
        return frames.length;
      },
      cancel: (handle) => {
        cancelled.push(handle);
      },
    },
  });
  const nextFrame = (now: number) => {
    const callback = frames.at(-1);
    frames.length = 0;
    callback?.(now);
  };
  const setDoing = (plan: IdlePlan | null) => {
    doing = plan;
  };
  const query = (selector: string): HTMLElement => {
    const found =
      panel.element.querySelector<HTMLElement>(selector) ??
      panel.console.querySelector<HTMLElement>(selector);
    if (!found) throw new Error(`missing ${selector}`);
    return found;
  };
  const button = (modifier: string): HTMLButtonElement => {
    const found = query(`.panel__action--${modifier}`);
    if (!(found instanceof HTMLButtonElement)) throw new Error(`missing ${modifier} button`);
    return found;
  };
  const select = (): HTMLSelectElement => {
    const found = query('select');
    if (!(found instanceof HTMLSelectElement)) throw new Error('missing skin select');
    return found;
  };
  const click = (modifier: string) => {
    button(modifier).click();
  };
  const row = (id: string): HTMLElement => query(`.panel__row[data-row='${id}']`);
  const value = (id: string) => row(id).querySelector('dd');
  return {
    store,
    panel,
    sent,
    terminal,
    confirm,
    query,
    button,
    select,
    click,
    row,
    value,
    ticks,
    stop,
    setDoing,
    frames,
    cancelled,
    nextFrame,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('helpers', () => {
  it.each(AGENT_STATUSES)('maps status %s to an existing translation', (status) => {
    expect(DICTIONARIES.en.has(statusKey(status))).toBe(true);
  });

  it('capitalizes skin ids', () => {
    expect(skinLabel('mortis')).toBe('Mortis');
    expect(skinLabel('')).toBe('');
  });

  it.each([
    ...WAITING_REASONS.map((reason) => `waitingFor.${reason}`),
    ...IDLE_PLANS.map((plan) => `idle.${plan}`),
    ...DETAIL_ROWS.map((detail) => detail.label),
    ...['low', 'medium', 'high', 'max'].map((level) => `effort.${level}`),
  ])('has the %s translation in every locale', (key) => {
    expect(DICTIONARIES.en.has(key)).toBe(true);
    expect(DICTIONARIES['pt-BR'].has(key)).toBe(true);
  });

  it.each([
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-sonnet-5-5', 'Sonnet 5.5'],
    ['claude-haiku-5-5', 'Haiku 5.5'],
    ['claude-fable-5-1', 'Fable 5.1'],
    ['claude-opus-5-5[1m]', 'Opus 5.5'],
    ['claude-sonnet-4-5-20250929', 'Sonnet 4.5'],
    ['claude-opus-4-20250514', 'Opus 4'],
    ['gpt-oss', 'gpt-oss'],
    ['claude-', 'claude-'],
  ])('labels model %s as %s', (model, label) => {
    expect(modelLabel(model)).toBe(label);
  });

  it('labels known effort levels and keeps unknown ones', () => {
    expect(['low', 'medium', 'high', 'max', 'MAX'].map(effortLabel)).toEqual([
      'Low',
      'Medium',
      'High',
      'Max',
      'Max',
    ]);
    expect(effortLabel('ultra')).toBe('ultra');
  });

  it('describes what the agent is doing right now', () => {
    const tool = { name: 'Bash', detail: 'npm test' };
    expect(nowText(agent('a', { status: 'tool', tool }), null)).toBe('npm test');
    expect(nowText(agent('a', { status: 'tool', tool: { ...tool, detail: '' } }), null)).toBe(
      'Bash',
    );
    expect(nowText(agent('a', { status: 'tool' }), null)).toBe('Working');
    expect(nowText(agent('a'), 'hearth')).toBe('Warming up by the fire');
    expect(nowText(agent('a'), null)).toBe('Strolling around the guild');
    expect(nowText(agent('a', { status: 'thinking' }), 'nap')).toBe('Thinking');
  });

  it('keeps the current skin selectable even when it is not listed', () => {
    expect(skinChoices(['mortis', 'lyra'], 'lyra')).toEqual(['mortis', 'lyra']);
    expect(skinChoices(['mortis'], 'ghost')).toEqual(['ghost', 'mortis']);
  });
});

describe('createPanel', () => {
  it('stays hidden until an agent is focused', () => {
    const { panel, store, terminal } = setup();
    expect(panel.element.hidden).toBe(true);
    store.focus('a');
    expect(panel.element.hidden).toBe(false);
    expect(terminal.fit).not.toHaveBeenCalled();
    expect(terminal.focus).not.toHaveBeenCalled();
    store.focus(null);
    expect(panel.element.hidden).toBe(true);
  });

  it('opens the console in its own window without widening the menu', () => {
    const { panel, store, terminal, button, click } = setup();
    const window = panel.console;
    expect(terminal.element.parentElement).toBe(window);
    expect(window.getAttribute('role')).toBe('dialog');
    expect(panel.element.contains(terminal.element)).toBe(false);
    store.focus('a');
    expect(window.hidden).toBe(true);
    expect(button('console').textContent).toBe('Open console');
    click('console');
    expect(window.hidden).toBe(false);
    expect(panel.element.hidden).toBe(false);
    expect(panel.element.dataset.console).toBeUndefined();
    expect(window.querySelector('.console-window__title')?.textContent).toBe('Agent a · Console');
    expect(window.getAttribute('aria-label')).toBe('Agent a · Console');
    expect(button('console').getAttribute('aria-expanded')).toBe('true');
    expect(button('console').textContent).toBe('Hide console');
    expect(terminal.fit).toHaveBeenCalledOnce();
    expect(terminal.focus).toHaveBeenCalledOnce();
    store.focus('b');
    expect(window.hidden).toBe(false);
    expect(window.querySelector('.console-window__title')?.textContent).toBe('Agent b · Console');
    click('console');
    expect(window.hidden).toBe(true);
    expect(button('console').textContent).toBe('Open console');
    setLocale('pt-BR');
    expect(button('console').textContent).toBe(DICTIONARIES['pt-BR'].get('panel.console'));
  });

  it('closes the console window from its × and when the menu closes', () => {
    const { panel, store, click } = setup();
    store.focus('a');
    click('console');
    const close = panel.console.querySelector<HTMLButtonElement>('.console-window__close');
    expect(close?.getAttribute('aria-label')).toBe('Close console');
    close?.click();
    expect(panel.console.hidden).toBe(true);
    expect(panel.element.hidden).toBe(false);
    click('console');
    store.focus(null);
    expect(panel.console.hidden).toBe(true);
    store.focus('a');
    expect(panel.console.hidden).toBe(true);
  });

  it('closes the console on Esc unless the key goes to the terminal', () => {
    const keys = new EventTarget();
    const { panel, store, terminal, click } = setup({ keys });
    store.focus('a');
    const escape = (target: EventTarget) => {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, 'target', { value: target });
      keys.dispatchEvent(event);
      return event;
    };
    expect(escape(document.body).defaultPrevented).toBe(false);
    click('console');
    const inside = document.createElement('textarea');
    terminal.element.append(inside);
    expect(escape(inside).defaultPrevented).toBe(false);
    expect(panel.console.hidden).toBe(false);
    keys.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(panel.console.hidden).toBe(false);
    expect(escape(document.body).defaultPrevented).toBe(true);
    expect(panel.console.hidden).toBe(true);
    expect(panel.element.hidden).toBe(false);
    panel.destroy();
    click('console');
    escape(document.body);
    expect(panel.console.hidden).toBe(false);
  });

  it('closes from its own button', () => {
    const { panel, store, query } = setup();
    store.focus('a');
    expect(query('.panel__close').getAttribute('aria-label')).toBe('Close');
    query('.panel__close').click();
    expect(store.getState().focused).toBeNull();
    expect(panel.element.hidden).toBe(true);
  });

  it('shows the tool and the waiting reason and hides empty rows', () => {
    const tool = { name: 'Bash', detail: 'npm test' };
    const { store, row, value } = setup({
      agents: [
        agent('a', { status: 'tool', tool }),
        agent('b', { status: 'waiting', waitingFor: 'permission' }),
      ],
    });
    store.focus('a');
    expect(value('now')?.textContent).toBe('npm test');
    expect(value('now')?.title).toBe('npm test');
    expect(row('tool').hidden).toBe(false);
    expect(value('tool')?.textContent).toBe('Bash');
    expect(row('waiting').hidden).toBe(true);
    store.focus('b');
    expect(value('now')?.textContent).toBe('Waiting for you');
    expect(row('tool').hidden).toBe(true);
    expect(row('waiting').hidden).toBe(false);
    expect(value('waiting')?.textContent).toBe('Your approval for a tool');
  });

  it('follows the idle activity while it is shown', () => {
    const { store, value, ticks, stop, setDoing } = setup({ doing: 'nap' });
    expect(ticks).toHaveLength(0);
    store.focus('a');
    expect(value('now')?.textContent).toBe('Taking a nap');
    expect(ticks).toHaveLength(1);
    setDoing('chat');
    ticks[0]?.();
    expect(value('now')?.textContent).toBe('Chatting with a friend');
    store.focus('b');
    expect(ticks).toHaveLength(1);
    store.focus(null);
    expect(stop).toHaveBeenCalledOnce();
    ticks[0]?.();
    expect(value('now')?.textContent).toBe('Chatting with a friend');
  });

  it('draws the portrait of the focused character', () => {
    const { store, query } = setup({ assets: fakeAssets({ mortis: SIDE_CHARACTER }) });
    const canvas = query('.panel__portrait');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing portrait');
    const drawImage = vi.fn();
    const context = { clearRect: vi.fn(), drawImage } as unknown as CanvasRenderingContext2D;
    vi.spyOn(canvas, 'getContext').mockReturnValue(context);
    store.focus('a');
    expect(drawImage).toHaveBeenCalledOnce();
  });

  it('draws the portrait once the manifest arrives after the menu opens', () => {
    let loaded = false;
    const ready = fakeAssets({ mortis: SIDE_CHARACTER });
    const assets: Assets = {
      ...ready,
      character: (skin) => (loaded ? ready.character(skin) : null),
    };
    const { store, query, nextFrame, frames, cancelled } = setup({ assets });
    const canvas = query('.panel__portrait');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing portrait');
    const drawImage = vi.fn();
    const context = { clearRect: vi.fn(), drawImage } as unknown as CanvasRenderingContext2D;
    vi.spyOn(canvas, 'getContext').mockReturnValue(context);
    expect(frames).toHaveLength(0);
    store.focus('a');
    nextFrame(16);
    expect(drawImage).not.toHaveBeenCalled();
    loaded = true;
    nextFrame(32);
    expect(drawImage).toHaveBeenCalledOnce();
    nextFrame(48);
    expect(drawImage).toHaveBeenCalledTimes(2);
    store.focus(null);
    expect(cancelled).toHaveLength(1);
  });

  it('shows the model and effort once the agent reports them', () => {
    const { store, row, value } = setup({
      agents: [agent('a'), agent('b', { model: 'claude-opus-5-5', effort: 'high' })],
    });
    store.focus('a');
    expect(row('model').hidden).toBe(true);
    expect(row('effort').hidden).toBe(true);
    store.focus('b');
    expect(value('model')?.textContent).toBe('Opus 5.5');
    expect(value('effort')?.textContent).toBe('High');
    setLocale('pt-BR');
    expect(value('effort')?.textContent).toBe(DICTIONARIES['pt-BR'].get('effort.high'));
  });

  it('renders the focused agent header', () => {
    const { store, query } = setup({ agents: [agent('a', { status: 'waiting', queued: 2 })] });
    store.focus('a');
    expect(query('.panel__name').textContent).toBe('Agent a');
    expect(query('.panel__status').dataset.status).toBe('waiting');
    expect(query('.panel__status').textContent).toBe('Waiting for you');
    expect(query('.panel__queue').hidden).toBe(false);
    expect(query('.panel__queue').textContent).toBe('2 queued');
    expect(query('.panel__cwd').textContent).toBe('/projects/a');
    expect(query('.panel__cwd').title).toBe('/projects/a');
  });

  it('follows updates of the focused agent', () => {
    const { store, query, button } = setup();
    store.focus('a');
    expect(query('.panel__queue').hidden).toBe(true);
    store.apply({ type: 'agent:updated', agent: agent('a', { status: 'offline' }) });
    expect(query('.panel__status').textContent).toBe('Offline');
    expect(button('interrupt').disabled).toBe(true);
    store.apply({ type: 'agent:removed', agentId: 'a' });
    expect(query('.panel__name').textContent).toBe('Agent a');
  });

  it('hides when the focused agent is removed', () => {
    const { store, panel } = setup();
    store.focus('a');
    store.apply({ type: 'agent:removed', agentId: 'a' });
    expect(panel.element.hidden).toBe(true);
  });

  it('lists skins and sends agent:setSkin on change', () => {
    const { store, sent, select: skinSelect } = setup();
    store.focus('b');
    const select = skinSelect();
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Mortis · In use',
      'Corvin',
      'Lyra',
    ]);
    expect([...select.options].map((option) => option.disabled)).toEqual([true, false, false]);
    expect(select.value).toBe('lyra');
    expect(select.disabled).toBe(false);
    select.value = 'lyra';
    select.dispatchEvent(new Event('change'));
    expect(sent).toEqual([]);
    select.value = 'corvin';
    select.dispatchEvent(new Event('change'));
    expect(sent).toEqual([{ type: 'agent:setSkin', agentId: 'b', skin: 'corvin' }]);
  });

  it('disables looks other agents wear and follows their changes', () => {
    const { store, select } = setup({ skins: ['mortis', 'lyra'] });
    store.focus('a');
    expect(select().disabled).toBe(true);
    expect(select().options[0]?.disabled).toBe(false);
    store.apply({ type: 'agent:updated', agent: agent('b', { skin: 'corvin' }) });
    expect(select().disabled).toBe(false);
    expect([...select().options].map((option) => option.disabled)).toEqual([false, false]);
    setLocale('pt-BR');
    store.apply({ type: 'agent:updated', agent: agent('b', { skin: 'lyra' }) });
    expect(select().options[1]?.textContent).toBe(
      `Lyra · ${DICTIONARIES['pt-BR'].get('recruit.inUse') ?? ''}`,
    );
  });

  it('refreshes the skin list when the server sends new skins', () => {
    const { store, select } = setup({ skins: ['mortis'] });
    store.focus('a');
    expect(select().disabled).toBe(true);
    store.apply({
      type: 'session:init',
      agents: [agent('a')],
      events: [],
      skins: ['mortis', 'corvin'],
      permissions: [],
      activities: [],
    });
    expect(select().options).toHaveLength(2);
  });

  it('interrupts and restarts the focused agent', () => {
    const { store, sent, terminal, click } = setup();
    click('interrupt');
    expect(sent).toEqual([]);
    store.focus('a');
    click('interrupt');
    click('restart');
    expect(sent).toEqual([
      { type: 'agent:interrupt', agentId: 'a' },
      { type: 'agent:restart', agentId: 'a' },
    ]);
    expect(terminal.focus).not.toHaveBeenCalled();
    click('console');
    click('interrupt');
    expect(terminal.focus).toHaveBeenCalledTimes(2);
  });

  it('copies and pastes through the console', async () => {
    const { store, terminal, click } = setup();
    store.focus('a');
    click('copy');
    click('paste');
    await flush();
    expect(terminal.copy).toHaveBeenCalledOnce();
    expect(terminal.paste).toHaveBeenCalledOnce();
    expect(terminal.focus).toHaveBeenCalledOnce();
  });

  it('removes an agent only after confirmation', async () => {
    const answers = [false, true];
    const { store, sent, confirm, click } = setup({ confirm: () => answers.shift() ?? false });
    store.focus('a');
    click('remove');
    await flush();
    expect(sent).toEqual([]);
    click('remove');
    await flush();
    expect(confirm).toHaveBeenCalledWith('Remove Agent a? The agent will be stopped.');
    expect(sent).toEqual([{ type: 'agent:remove', agentId: 'a' }]);
  });

  it('removes everyone only after confirmation', async () => {
    const { store, sent, confirm, click } = setup({ confirm: () => Promise.resolve(true) });
    store.focus('a');
    click('remove-all');
    await flush();
    expect(confirm).toHaveBeenCalledWith('Remove all adventurers? Every agent will be stopped.');
    expect(sent).toEqual([{ type: 'agent:removeAll' }]);
  });

  it('treats a failing confirmation as a no', async () => {
    const { store, sent, click } = setup({ confirm: () => Promise.reject(new Error('closed')) });
    store.focus('a');
    click('remove');
    await flush();
    expect(sent).toEqual([]);
  });

  it('translates labels when the locale changes', () => {
    const { store, query } = setup();
    store.focus('a');
    expect(query('.panel__action--restart').textContent).toBe('Restart');
    setLocale('pt-BR');
    expect(query('.panel__action--restart').textContent).toBe(
      DICTIONARIES['pt-BR'].get('panel.restart'),
    );
    expect(query('.panel__status').textContent).toBe(DICTIONARIES['pt-BR'].get('status.idle'));
  });

  it('stops listening on destroy', () => {
    const { store, panel, query, stop } = setup();
    document.body.append(panel.element);
    store.focus('a');
    panel.destroy();
    expect(stop).toHaveBeenCalledOnce();
    expect(panel.element.isConnected).toBe(false);
    store.focus(null);
    expect(panel.element.hidden).toBe(false);
    setLocale('pt-BR');
    expect(query('.panel__action--restart').textContent).toBe('Restart');
  });
});
