// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentAction, AgentActivity } from '../../shared/activity.js';
import { ACTION_STATES } from '../../shared/activity.js';
import type { AgentView } from '../../shared/agent.js';
import { AGENT_STATUSES, WAITING_REASONS } from '../../shared/agent.js';
import type { PermissionRequestView } from '../../shared/permission.js';
import type { ClientMessage, ServerMessage } from '../../shared/protocol.js';
import type { IdlePlan } from '../game/activity.js';
import { IDLE_PLANS } from '../game/activity.js';
import type { Assets } from '../game/assets.js';
import { SIDE_CHARACTER, fakeAssets } from '../game/fake-assets.js';
import { DICTIONARIES, initI18n, setLocale } from '../i18n/index.js';
import { Store } from '../state/store.js';
import type { Confirm, PanelTerminal } from './panel.js';
import {
  ACTION_ICONS,
  DETAIL_ROWS,
  RECENT_ACTIONS,
  REFRESH_MS,
  createPanel,
  effortLabel,
  modelLabel,
  newestFirst,
  nowText,
  skinLabel,
  statusKey,
  timeAgo,
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
  activities?: AgentActivity[];
  now?: () => number;
}

function setup(options: SetupOptions = {}) {
  const store = new Store();
  store.apply({
    type: 'session:init',
    agents: options.agents ?? [agent('a'), agent('b', { skin: 'lyra' })],
    events: [],
    skins: options.skins ?? ['mortis', 'corvin', 'lyra'],
    permissions: [],
    activities: options.activities ?? [],
  });
  const sent: ClientMessage[] = [];
  const listeners = new Set<(message: ServerMessage) => void>();
  const receive = (message: ServerMessage) => {
    for (const listener of listeners) listener(message);
  };
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
      onMessage: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    terminal,
    confirm,
    ...(options.assets ? { assets: options.assets } : {}),
    ...(options.keys ? { keys: options.keys } : {}),
    ...(options.now ? { now: options.now } : {}),
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
  const click = (modifier: string) => {
    button(modifier).click();
  };
  const row = (id: string): HTMLElement => query(`.panel__row[data-row='${id}']`);
  const value = (id: string) => row(id).querySelector('dd');
  return {
    store,
    panel,
    sent,
    receive,
    listeners,
    terminal,
    confirm,
    query,
    button,
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

  it('has no look picker or remove-all button anymore', () => {
    const { panel, store } = setup();
    store.focus('a');
    expect(panel.element.querySelector('select')).toBeNull();
    expect(panel.element.querySelector('.panel__action--remove-all')).toBeNull();
    expect(panel.element.querySelector('.panel__action--remove')).not.toBeNull();
  });

  it('stays usable with agents from an older server that lack newer fields', () => {
    const older = {
      id: 'a',
      name: 'Old',
      cwd: '/old',
      skin: 'mortis',
      status: 'idle',
      permissionMode: 'default',
      tool: null,
      queued: 0,
    } as unknown as AgentView;
    const { panel, store, row, query, nextFrame } = setup({
      agents: [older],
      assets: fakeAssets({ mortis: SIDE_CHARACTER }),
    });
    const canvas = query('.panel__portrait');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing portrait');
    const drawImage = vi.fn();
    const context = { clearRect: vi.fn(), drawImage } as unknown as CanvasRenderingContext2D;
    vi.spyOn(canvas, 'getContext').mockReturnValue(context);
    store.focus('a');
    nextFrame(16);
    expect(drawImage).toHaveBeenCalled();
    expect(row('waiting').hidden).toBe(true);
    expect(row('model').hidden).toBe(true);
    expect(row('effort').hidden).toBe(true);
    query('.panel__close').click();
    expect(panel.element.hidden).toBe(true);
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

function action(id: string, overrides: Partial<AgentAction> = {}): AgentAction {
  return {
    id,
    tool: 'Bash',
    detail: `run ${id}`,
    state: 'done',
    result: null,
    startedAt: 1_000,
    endedAt: null,
    ...overrides,
  };
}

function activity(agentId: string, overrides: Partial<AgentActivity> = {}): AgentActivity {
  return { agentId, title: null, actions: [], tasks: [], ...overrides };
}

describe('history helpers', () => {
  it.each([
    [0, 'just now'],
    [4_999, 'just now'],
    [12_000, '12s ago'],
    [125_000, '2m ago'],
    [2 * 3_600_000, '2h ago'],
    [3 * 86_400_000, '3d ago'],
    [-5_000, 'just now'],
  ])('formats %d ms as %s', (ms, text) => {
    expect(timeAgo(ms)).toBe(text);
  });

  it('sorts actions newest first without mutating', () => {
    const actions = [
      action('1', { startedAt: 1 }),
      action('2', { startedAt: 3 }),
      action('3', { startedAt: 2 }),
    ];
    expect(newestFirst(actions).map((a) => a.id)).toEqual(['2', '3', '1']);
    expect(actions.map((a) => a.id)).toEqual(['1', '2', '3']);
  });

  it.each([
    ...ACTION_STATES.map((state) => `action.${state}`),
    ...['pending', 'inProgress', 'completed'].map((status) => `task.${status}`),
    ...['title', 'empty', 'session', 'tasks', 'justNow', 'seconds', 'minutes', 'hours', 'days'].map(
      (key) => `history.${key}`,
    ),
  ])('has the %s translation in every locale', (key) => {
    expect(DICTIONARIES.en.has(key)).toBe(true);
    expect(DICTIONARIES['pt-BR'].has(key)).toBe(true);
  });
});

describe('history', () => {
  const entries = (panel: { element: HTMLElement }) => [
    ...panel.element.querySelectorAll<HTMLElement>('.panel__entry'),
  ];

  it('shows an empty state without activity', () => {
    const { store, panel, query } = setup();
    store.focus('a');
    expect(entries(panel)).toHaveLength(0);
    expect(query('.panel__empty').hidden).toBe(false);
    expect(query('.panel__empty').textContent).toBe('No actions yet');
    expect(query('.panel__session').hidden).toBe(true);
    expect(query('.panel__tasks-block').hidden).toBe(true);
    expect(query('.panel__heading').textContent).toBe('Recent commands');
  });

  it('lists actions newest first with state, detail, result and time', () => {
    const { store, panel, query } = setup({
      now: () => 61_000,
      activities: [
        activity('a', {
          title: 'Fix the login',
          actions: [
            action('1', { state: 'error', result: 'exit 1', startedAt: 1_000 }),
            action('2', { tool: 'Read', detail: '', state: 'running', startedAt: 50_000 }),
          ],
        }),
      ],
    });
    store.focus('a');
    const [first, second] = entries(panel);
    expect(first?.dataset.state).toBe('running');
    expect(first?.querySelector('.panel__entry-tool')?.textContent).toBe('Read');
    expect(first?.querySelector('.panel__entry-detail')).toBeNull();
    expect(first?.querySelector('.panel__entry-result')).toBeNull();
    expect(first?.querySelector('.panel__entry-time')?.textContent).toBe('11s ago');
    expect(first?.querySelector('.panel__entry-icon')?.getAttribute('aria-label')).toBe('Running');
    expect(second?.dataset.state).toBe('error');
    expect(second?.querySelector('.panel__entry-icon')?.textContent).toBe(ACTION_ICONS.error);
    expect(second?.querySelector('.panel__entry-detail')?.textContent).toBe('run 1');
    expect(second?.querySelector('.panel__entry-result')?.textContent).toBe('exit 1');
    expect(second?.querySelector('.panel__entry-time')?.textContent).toBe('1m ago');
    expect(query('.panel__empty').hidden).toBe(true);
    expect(query('.panel__session').hidden).toBe(false);
    expect(query('.panel__session-title').textContent).toBe('Fix the login');
  });

  it('keeps only the most recent actions', () => {
    const actions = Array.from({ length: RECENT_ACTIONS + 3 }, (_, index) =>
      action(String(index), { startedAt: index }),
    );
    const { store, panel } = setup({ activities: [activity('a', { actions })] });
    store.focus('a');
    const details = entries(panel).map(
      (entry) => entry.querySelector('.panel__entry-detail')?.textContent,
    );
    expect(details).toEqual(['run 7', 'run 6', 'run 5', 'run 4', 'run 3']);
  });

  it('shows tasks when present', () => {
    const { store, panel, query } = setup({
      activities: [
        activity('a', {
          tasks: [
            { id: '1', title: 'Write tests', status: 'completed' },
            { id: '2', title: 'Ship it', status: 'in_progress' },
          ],
        }),
      ],
    });
    store.focus('a');
    expect(query('.panel__tasks-block').hidden).toBe(false);
    const tasks = [...panel.element.querySelectorAll<HTMLElement>('.panel__task')];
    expect(tasks.map((task) => task.textContent)).toEqual(['Write tests', 'Ship it']);
    expect(tasks.map((task) => task.dataset.status)).toEqual(['completed', 'in_progress']);
    expect(tasks[1]?.title).toBe('In progress');
  });

  it('updates live and only for the focused agent', () => {
    const { store, panel } = setup();
    store.focus('a');
    store.apply({ type: 'agent:activity', activity: activity('b', { actions: [action('x')] }) });
    expect(entries(panel)).toHaveLength(0);
    store.apply({ type: 'agent:activity', activity: activity('a', { actions: [action('1')] }) });
    expect(entries(panel)).toHaveLength(1);
    store.apply({
      type: 'agent:activity',
      activity: activity('a', { actions: [action('1'), action('2', { startedAt: 2_000 })] }),
    });
    expect(entries(panel)).toHaveLength(2);
    store.focus('b');
    expect(entries(panel)).toHaveLength(1);
    expect(entries(panel)[0]?.querySelector('.panel__entry-detail')?.textContent).toBe('run x');
  });

  it('refreshes relative times on each tick', () => {
    let clock = 1_000;
    const { store, panel, ticks } = setup({
      now: () => clock,
      activities: [activity('a', { actions: [action('1')] })],
    });
    store.focus('a');
    const time = () => panel.element.querySelector('.panel__entry-time')?.textContent;
    expect(time()).toBe('just now');
    clock = 31_000;
    ticks.at(-1)?.();
    expect(time()).toBe('30s ago');
  });

  it('translates the history when the locale changes', () => {
    const { store, query } = setup({ activities: [activity('a', { actions: [action('1')] })] });
    store.focus('a');
    setLocale('pt-BR');
    expect(query('.panel__heading').textContent).toBe(DICTIONARIES['pt-BR'].get('history.title'));
    expect(query('.panel__entry-icon').title).toBe(DICTIONARIES['pt-BR'].get('action.done'));
  });
});

function request(id: string, agentId: string, createdAt: number): PermissionRequestView {
  return {
    id,
    agentId,
    toolName: 'Bash',
    detail: `cmd ${id}`,
    input: null,
    subagent: null,
    suggestions: [],
    questions: null,
    createdAt,
    expiresAt: createdAt + 1_000,
  };
}

describe('permission requests', () => {
  const card = (panel: { element: HTMLElement }) => {
    const found = panel.element.querySelector<HTMLElement>('.request');
    if (!found) throw new Error('missing card');
    return found;
  };

  it('shows the oldest request of the focused agent and sends the decision', () => {
    const { store, panel, sent } = setup();
    store.apply({ type: 'permission:request', request: request('r2', 'a', 20) });
    store.apply({ type: 'permission:request', request: request('r1', 'a', 10) });
    store.apply({ type: 'permission:request', request: request('rb', 'b', 5) });
    expect(card(panel).hidden).toBe(true);
    store.focus('a');
    expect(card(panel).hidden).toBe(false);
    expect(card(panel).querySelector('.request__detail')?.textContent).toBe('cmd r1');
    expect(card(panel).querySelector('.request__more')?.textContent).toBe('+1 more');
    card(panel).querySelector<HTMLButtonElement>('.request__button--allow')?.click();
    expect(sent).toEqual([
      { type: 'permission:decide', requestId: 'r1', decision: { behavior: 'allow' } },
    ]);
    store.apply({ type: 'permission:resolved', requestId: 'r1', agentId: 'a', outcome: 'allowed' });
    expect(card(panel).querySelector('.request__detail')?.textContent).toBe('cmd r2');
    store.apply({ type: 'permission:resolved', requestId: 'r2', agentId: 'a', outcome: 'denied' });
    expect(card(panel).hidden).toBe(true);
    store.focus('b');
    expect(card(panel).querySelector('.request__detail')?.textContent).toBe('cmd rb');
  });

  it('opens the console when answering there', () => {
    const { store, panel, terminal } = setup();
    store.apply({ type: 'permission:request', request: request('r1', 'a', 10) });
    store.focus('a');
    card(panel).querySelector<HTMLButtonElement>('.request__button--terminal')?.click();
    expect(panel.console.hidden).toBe(false);
    expect(terminal.focus).toHaveBeenCalled();
  });

  it('drops a request the server no longer knows', () => {
    const { store, panel, receive } = setup();
    store.apply({ type: 'permission:request', request: request('r1', 'a', 10) });
    store.focus('a');
    card(panel).querySelector<HTMLButtonElement>('.request__button--deny')?.click();
    receive({ type: 'error', code: 'PERMISSION_NOT_FOUND', source: 'agent:create' });
    expect(store.getState().permissions).toHaveLength(1);
    receive({ type: 'error', code: 'PERMISSION_NOT_FOUND', source: 'permission:decide' });
    expect(store.getState().permissions).toHaveLength(0);
    expect(card(panel).hidden).toBe(true);
  });

  it('unlocks the buttons after another decide error', () => {
    const { store, panel, receive } = setup();
    receive({ type: 'error', code: 'INVALID_MESSAGE', source: 'permission:decide' });
    store.apply({ type: 'permission:request', request: request('r1', 'a', 10) });
    store.focus('a');
    const deny = () => card(panel).querySelector<HTMLButtonElement>('.request__button--deny');
    deny()?.click();
    expect(deny()?.disabled).toBe(true);
    receive({ type: 'event', event: { kind: 'joined', agentId: 'a', at: 1 } });
    receive({ type: 'error', code: 'INVALID_MESSAGE', source: 'permission:decide' });
    expect(deny()?.disabled).toBe(false);
    expect(store.getState().permissions).toHaveLength(1);
  });

  it('stops listening to the socket on destroy', () => {
    const { panel, listeners } = setup();
    expect(listeners.size).toBe(1);
    panel.destroy();
    expect(listeners.size).toBe(0);
  });
});
