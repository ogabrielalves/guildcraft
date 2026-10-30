// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentView } from '../../shared/agent.js';
import { MAX_AGENTS, MAX_NAME_LENGTH } from '../../shared/constants.js';
import type { ClientMessage, ServerMessage } from '../../shared/protocol.js';
import { demoListFolders } from '../demo/demo.js';
import { SIDE_CHARACTER, fakeAssets } from '../game/fake-assets.js';
import { DICTIONARIES, initI18n, setLocale } from '../i18n/index.js';
import type { MessageListener } from '../net/socket.js';
import { Store } from '../state/store.js';
import {
  createAddAgentDialog,
  createRecruitButton,
  defaultSkin,
  folderName,
  isFull,
  sameName,
  suggestName,
} from './add-agent-dialog.js';

afterEach(() => {
  initI18n({ storage: null, languages: [] });
  document.body.replaceChildren();
});

function agent(id: string, overrides: Partial<AgentView> = {}): AgentView {
  return {
    id,
    name: id,
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

const crew = (count: number) => Array.from({ length: count }, (_, i) => agent(`a${i}`));

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function setup(agents: AgentView[] = [], connected = true) {
  const store = new Store();
  store.apply({
    type: 'session:init',
    agents,
    events: [],
    skins: ['mortis', 'corvin', 'lyra'],
    permissions: [],
  });
  const listeners = new Set<MessageListener>();
  const sent: ClientMessage[] = [];
  const link = { connected };
  const dialog = createAddAgentDialog({
    store,
    socket: {
      send: (message) => {
        if (link.connected) sent.push(message);
        return link.connected;
      },
      onMessage: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    listFolders: demoListFolders,
    assets: fakeAssets({ mortis: SIDE_CHARACTER }),
  });
  const emit = (message: ServerMessage) => {
    for (const listener of listeners) listener(message);
  };
  const one = (selector: string) => {
    const found = dialog.element.querySelector<HTMLElement>(selector);
    if (!found) throw new Error(`missing ${selector}`);
    return found;
  };
  const typed = <T extends Element>(selector: string, type: new () => T): T => {
    const found = one(selector);
    if (!(found instanceof type)) throw new Error(`${selector} has the wrong type`);
    return found;
  };
  const buttonByText = (text: string) => {
    const found = [...dialog.element.querySelectorAll('button')].find(
      (node) => node.textContent === text,
    );
    if (!found) throw new Error(`missing button ${text}`);
    return found;
  };
  const mode = () => typed('.recruit__mode', HTMLSelectElement);
  const picker = () => typed('.folder-picker', HTMLDialogElement);
  const characters = () => [...dialog.element.querySelectorAll<HTMLElement>('.recruit__character')];
  return {
    store,
    dialog,
    sent,
    link,
    emit,
    one,
    mode,
    picker,
    characters,
    buttonByText,
  };
}

async function openAt(ctx: ReturnType<typeof setup>, folder: string) {
  ctx.dialog.open();
  ctx.one('.recruit__folder').click();
  await flush();
  const entry = [...ctx.dialog.element.querySelectorAll<HTMLElement>('.folder-browser__entry')];
  entry.find((node) => node.textContent === 'projects')?.click();
  await flush();
  [...ctx.dialog.element.querySelectorAll<HTMLElement>('.folder-browser__entry')]
    .find((node) => node.textContent === folder)
    ?.click();
  await flush();
  ctx.one('.folder-browser__select').click();
}

describe('helpers', () => {
  it('takes the last folder name on any platform', () => {
    expect(folderName('/home/me/web')).toBe('web');
    expect(folderName('C:\\Users\\me\\api\\')).toBe('api');
    expect(folderName('/')).toBe('');
  });

  it('compares names like the server', () => {
    expect(sameName(' Web ', 'web')).toBe(true);
    expect(sameName('web', 'api')).toBe(false);
  });

  it('suggests a valid name from a label', () => {
    expect(suggestName('Mortis', [])).toBe('Mortis');
    expect(suggestName('.config', [])).toBe('config');
    expect(suggestName('a+b (old)', [])).toBe('a-b -old-');
    expect(suggestName('', [])).toBe('');
    expect(suggestName('n'.repeat(50), [])).toHaveLength(MAX_NAME_LENGTH);
  });

  it('suggests a free name when the label is taken', () => {
    expect(suggestName('Lyra', [{ name: 'lyra' }])).toBe('Lyra 2');
    expect(suggestName('Lyra', [{ name: 'Lyra' }, { name: 'Lyra 2' }])).toBe('Lyra 3');
    const long = 'n'.repeat(MAX_NAME_LENGTH);
    expect(suggestName(long, [{ name: long }])).toBe(`${'n'.repeat(MAX_NAME_LENGTH - 2)} 2`);
  });

  it('gives up on suffixes when every candidate is taken', () => {
    const taken = [{ name: 'web' }, ...crew(MAX_AGENTS).map((_, i) => ({ name: `web ${i + 2}` }))];
    expect(suggestName('web', taken)).toBe('web');
  });

  it('prefers a skin nobody is using', () => {
    expect(defaultSkin(['mortis', 'corvin'], [{ skin: 'mortis' }])).toBe('corvin');
    expect(defaultSkin(['mortis'], [{ skin: 'mortis' }])).toBe('mortis');
    expect(defaultSkin([], [])).toBeNull();
  });

  it('knows when the workshop is full', () => {
    expect(isFull(crew(MAX_AGENTS - 1))).toBe(false);
    expect(isFull(crew(MAX_AGENTS))).toBe(true);
  });
});

describe('createRecruitButton', () => {
  it('opens the dialog and disables itself when the workshop is full', () => {
    const store = new Store();
    const onClick = vi.fn();
    const button = createRecruitButton(store, onClick);
    expect(button.element.textContent).toBe('+ RECRUIT');
    button.element.click();
    expect(onClick).toHaveBeenCalledOnce();
    store.apply({
      type: 'session:init',
      agents: crew(MAX_AGENTS),
      events: [],
      skins: [],
      permissions: [],
    });
    expect(button.element.disabled).toBe(true);
    expect(button.element.title).toBe(`The workshop is full (${MAX_AGENTS} adventurers)`);
    setLocale('pt-BR');
    expect(button.element.textContent).toBe(DICTIONARIES['pt-BR'].get('workshop.recruit'));
    button.destroy();
    store.apply({ type: 'session:init', agents: [], events: [], skins: [], permissions: [] });
    expect(button.element.disabled).toBe(true);
  });
});

describe('createAddAgentDialog', () => {
  it('opens with a fresh form and the folder picker closed', () => {
    const ctx = setup();
    ctx.dialog.open();
    expect(ctx.dialog.element.open).toBe(true);
    expect(ctx.dialog.element.isConnected).toBe(true);
    expect(ctx.picker().open).toBe(false);
    expect(ctx.dialog.element.querySelector('.folder-browser')).toBeNull();
    expect(ctx.one('.recruit__folder-name').textContent).toBe('Choose a folder…');
    expect(ctx.one('.recruit__folder-path').hidden).toBe(true);
    expect(ctx.one('.dialog__title').textContent).toBe('Recruit an adventurer');
    expect(ctx.buttonByText('Next').hidden).toBe(false);
    expect(ctx.buttonByText('Next').disabled).toBe(true);
    expect(ctx.buttonByText('Recruit').hidden).toBe(true);
  });

  it('picks the folder in its own window, starting at home', async () => {
    const ctx = setup();
    ctx.dialog.open();
    ctx.one('.recruit__folder').click();
    ctx.one('.recruit__folder').click();
    expect(ctx.picker().open).toBe(true);
    expect(ctx.dialog.element.querySelectorAll('.folder-browser')).toHaveLength(1);
    await flush();
    expect(ctx.one('.folder-browser__path').textContent).toBe('/home/demo');
    ctx.one('.folder-browser__select').click();
    expect(ctx.picker().open).toBe(false);
    expect(ctx.dialog.element.querySelector('.folder-browser')).toBeNull();
    expect(document.activeElement).toBe(ctx.one('.recruit__folder'));
    expect(ctx.one('.recruit__folder-name').textContent).toBe('demo');
    expect(ctx.one('.recruit__folder-path').textContent).toBe('/home/demo');
    expect(ctx.buttonByText('Next').disabled).toBe(false);
  });

  it('closes only the picker on its close button or Escape', async () => {
    const ctx = setup();
    ctx.dialog.open();
    ctx.one('.recruit__folder').click();
    await flush();
    ctx.one('.dialog__close').click();
    expect(ctx.picker().open).toBe(false);
    expect(ctx.dialog.element.open).toBe(true);
    ctx.one('.recruit__folder').click();
    const event = new Event('cancel', { cancelable: true });
    ctx.picker().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(ctx.picker().open).toBe(false);
    expect(ctx.dialog.element.open).toBe(true);
    expect(ctx.one('.recruit__folder-name').textContent).toBe('Choose a folder…');
  });

  it('names the agent after the character, with a suffix when taken', async () => {
    const ctx = setup([agent('x', { name: 'Mortis', skin: 'mortis' })]);
    await openAt(ctx, 'web');
    ctx.characters()[0]?.click();
    ctx.buttonByText('Next').click();
    expect(ctx.one('.recruit__warning').textContent).toBe(
      'Mortis 2 will read, edit and run commands in /home/demo/projects/web.',
    );
    ctx.buttonByText('Recruit').click();
    expect(ctx.sent).toMatchObject([{ type: 'agent:create', name: 'Mortis 2', skin: 'mortis' }]);
  });

  it('shows each character with a portrait and the name from its manifest', () => {
    const ctx = setup();
    ctx.dialog.open();
    const [mortis, corvin] = ctx.characters();
    expect(mortis?.querySelector('canvas.recruit__portrait')).not.toBeNull();
    expect(mortis?.querySelector('.recruit__character-name')?.textContent).toBe('Mortis');
    expect(corvin?.querySelector('.recruit__character-name')?.textContent).toBe('Corvin');
  });

  it('marks characters in use and preselects a free one', async () => {
    const ctx = setup([agent('x', { skin: 'mortis' })]);
    ctx.dialog.open();
    await flush();
    const [mortis, corvin, lyra] = ctx.characters();
    expect(mortis?.querySelector('.recruit__in-use')?.textContent).toBe('In use');
    expect(corvin?.querySelector('.recruit__in-use')).toBeNull();
    expect(corvin?.getAttribute('aria-checked')).toBe('true');
    lyra?.click();
    expect(ctx.characters()[2]?.getAttribute('aria-checked')).toBe('true');
    expect(ctx.characters()[0]?.textContent).toBe('MortisIn use');
  });

  it('requires a folder and a character to continue', async () => {
    const ctx = setup();
    ctx.dialog.open();
    ctx.buttonByText('Next').click();
    expect(ctx.buttonByText('Next').hidden).toBe(false);
    await openAt(ctx, 'web');
    expect(ctx.buttonByText('Next').disabled).toBe(false);
  });

  it('cannot continue without characters', async () => {
    const ctx = setup();
    ctx.store.apply({ type: 'session:init', agents: [], events: [], skins: [], permissions: [] });
    await openAt(ctx, 'web');
    expect(ctx.characters()).toHaveLength(0);
    expect(ctx.buttonByText('Next').disabled).toBe(true);
  });

  it('warns and blocks when the workshop is full', async () => {
    const ctx = setup(crew(MAX_AGENTS));
    ctx.dialog.open();
    await flush();
    expect(ctx.one('.recruit__full').hidden).toBe(false);
    expect(ctx.one('.recruit__full').textContent).toBe(
      `The workshop is full (${MAX_AGENTS} adventurers)`,
    );
    expect(ctx.buttonByText('Next').disabled).toBe(true);
  });

  it('asks for trust and permission mode, then recruits', async () => {
    const ctx = setup();
    await openAt(ctx, 'api');
    ctx.buttonByText('Next').click();
    expect(ctx.one('.dialog__title').textContent).toBe('Trust this folder?');
    expect(ctx.one('.recruit__warning').textContent).toBe(
      'Mortis will read, edit and run commands in /home/demo/projects/api.',
    );
    expect([...ctx.mode().options].map((option) => option.textContent)).toEqual([
      'Ask before every action',
      'Accept file edits',
      'Plan only',
    ]);
    ctx.mode().value = 'acceptEdits';
    ctx.buttonByText('Recruit').click();
    expect(ctx.sent).toEqual([
      {
        type: 'agent:create',
        name: 'Mortis',
        cwd: '/home/demo/projects/api',
        skin: 'mortis',
        permissionMode: 'acceptEdits',
      },
    ]);
    expect(ctx.buttonByText('Recruit').disabled).toBe(true);
    ctx.buttonByText('Recruit').click();
    expect(ctx.sent).toHaveLength(1);
  });

  it('closes and focuses the new agent once the server creates it', async () => {
    const ctx = setup();
    await openAt(ctx, 'web');
    ctx.buttonByText('Next').click();
    ctx.buttonByText('Recruit').click();
    ctx.store.apply({ type: 'agent:updated', agent: agent('other', { name: 'other' }) });
    expect(ctx.dialog.element.open).toBe(true);
    ctx.store.apply({ type: 'agent:updated', agent: agent('new', { name: 'mortis' }) });
    expect(ctx.dialog.element.open).toBe(false);
    expect(ctx.store.getState().focused).toBe('new');
    expect(ctx.dialog.element.querySelector('.folder-browser')).toBeNull();
  });

  it('shows server errors and lets the user try again', async () => {
    const ctx = setup();
    await openAt(ctx, 'web');
    ctx.buttonByText('Next').click();
    ctx.emit({ type: 'error', code: 'SPAWN_FAILED', source: 'agent:create' });
    expect(ctx.one('.recruit__error').hidden).toBe(true);
    ctx.buttonByText('Recruit').click();
    ctx.emit({ type: 'event', event: { kind: 'joined', agentId: 'x', at: 0 } });
    ctx.emit({
      type: 'error',
      code: 'AGENT_NAME_TAKEN',
      source: 'agent:create',
      params: { name: 'Web' },
    });
    expect(ctx.one('.recruit__error').hidden).toBe(false);
    expect(ctx.one('.recruit__error').textContent).toBe('There is already an adventurer named Web');
    expect(ctx.buttonByText('Recruit').disabled).toBe(false);
    ctx.buttonByText('Back').click();
    expect(ctx.one('.recruit__error').hidden).toBe(true);
    expect(ctx.buttonByText('Next').hidden).toBe(false);
  });

  it('fills the name the dialog sent when the server omits params', async () => {
    const ctx = setup();
    await openAt(ctx, 'web');
    ctx.buttonByText('Next').click();
    ctx.buttonByText('Recruit').click();
    ctx.emit({ type: 'error', code: 'AGENT_NAME_TAKEN', source: 'agent:create' });
    expect(ctx.one('.recruit__error').textContent).toBe(
      'There is already an adventurer named Mortis',
    );
  });

  it('ignores errors from other requests while waiting', async () => {
    const ctx = setup();
    await openAt(ctx, 'web');
    ctx.buttonByText('Next').click();
    ctx.buttonByText('Recruit').click();
    const other = { type: 'error', code: 'AGENT_NOT_FOUND', source: 'agent:remove' } as const;
    const untagged = { type: 'error', code: 'SPAWN_FAILED' } as const;
    ctx.emit(other);
    ctx.emit(untagged);
    expect(ctx.one('.recruit__error').hidden).toBe(true);
    expect(ctx.dialog.handles(other)).toBe(false);
    expect(ctx.dialog.handles(untagged)).toBe(false);
    expect(
      ctx.dialog.handles({ type: 'error', code: 'SPAWN_FAILED', source: 'agent:create' }),
    ).toBe(true);
    expect(ctx.dialog.handles({ type: 'agent:removed', agentId: 'x' })).toBe(false);
  });

  it('reports a lost connection when the message cannot be sent', async () => {
    const ctx = setup([], false);
    await openAt(ctx, 'web');
    ctx.buttonByText('Next').click();
    ctx.buttonByText('Recruit').click();
    expect(ctx.one('.recruit__error').textContent).toBe('Connection lost. Reconnecting...');
    expect(ctx.buttonByText('Recruit').disabled).toBe(false);
  });

  it('reopens with a clean form and the picker at the last folder', async () => {
    const ctx = setup();
    await openAt(ctx, 'docs');
    ctx.buttonByText('Next').click();
    ctx.buttonByText('Cancel').click();
    expect(ctx.dialog.element.open).toBe(false);
    ctx.dialog.open();
    expect(ctx.one('.recruit__folder-name').textContent).toBe('Choose a folder…');
    expect(ctx.buttonByText('Next').hidden).toBe(false);
    ctx.one('.recruit__folder').click();
    await flush();
    expect(ctx.one('.folder-browser__path').textContent).toBe('/home/demo/projects/docs');
  });

  it('closes on Escape, picker included', async () => {
    const ctx = setup();
    ctx.dialog.open();
    ctx.one('.recruit__folder').click();
    await flush();
    const event = new Event('cancel', { cancelable: true });
    ctx.dialog.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(ctx.dialog.element.open).toBe(false);
    expect(ctx.picker().open).toBe(false);
  });

  it('follows store changes while open', async () => {
    const ctx = setup();
    ctx.dialog.open();
    await flush();
    ctx.store.apply({ type: 'agent:updated', agent: agent('x', { skin: 'mortis' }) });
    expect(ctx.characters()[0]?.querySelector('.recruit__in-use')).not.toBeNull();
    ctx.dialog.close();
    ctx.store.apply({ type: 'agent:updated', agent: agent('y', { skin: 'corvin' }) });
    expect(ctx.characters()[1]?.querySelector('.recruit__in-use')).toBeNull();
  });

  it('translates texts when the locale changes', async () => {
    const ctx = setup();
    ctx.dialog.open();
    await flush();
    setLocale('pt-BR');
    const pt = DICTIONARIES['pt-BR'];
    expect(ctx.one('.dialog__title').textContent).toBe(pt.get('recruit.title'));
    expect(ctx.buttonByText(pt.get('recruit.next') ?? '').hidden).toBe(false);
  });

  it('releases everything on destroy', async () => {
    const ctx = setup();
    ctx.dialog.open();
    await flush();
    ctx.dialog.destroy();
    expect(ctx.dialog.element.isConnected).toBe(false);
    expect(ctx.dialog.element.open).toBe(false);
    ctx.store.apply({ type: 'agent:updated', agent: agent('x', { skin: 'corvin' }) });
    expect(ctx.characters()[1]?.querySelector('.recruit__in-use')).toBeNull();
  });
});
