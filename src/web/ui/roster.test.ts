// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentView } from '../../shared/agent.js';
import { NO_ASSETS } from '../game/assets.js';
import { initI18n, setLocale } from '../i18n/index.js';
import { Store } from '../state/store.js';
import type { DrawFace } from './roster.js';
import { FACE, ROSTER_REFRESH_MS, createRoster, faceOrigin, portraitFace } from './roster.js';

afterEach(() => {
  initI18n({ storage: null, languages: [] });
});

function agent(id: string, overrides: Partial<AgentView> = {}): AgentView {
  return {
    id,
    name: id.toUpperCase(),
    cwd: '/',
    skin: 'brom',
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

function setup(agents: AgentView[], drawFace: DrawFace = () => true) {
  const store = new Store();
  store.apply({
    type: 'session:init',
    agents,
    events: [],
    skins: [],
    permissions: [],
    activities: [],
  });
  const picked: string[] = [];
  const ticks: (() => void)[] = [];
  const stop = vi.fn();
  const roster = createRoster({
    store,
    assets: NO_ASSETS,
    onPick: (id) => {
      picked.push(id);
      store.select(id);
    },
    drawFace,
    every: (callback, ms) => {
      expect(ms).toBe(ROSTER_REFRESH_MS);
      ticks.push(callback);
      return stop;
    },
  });
  const avatars = () => [...roster.element.querySelectorAll<HTMLButtonElement>('.roster__avatar')];
  return { store, roster, picked, ticks, stop, avatars };
}

describe('faceOrigin', () => {
  it('frames the head from the first opaque row, centered', () => {
    const width = 40;
    const alpha = new Uint8ClampedArray(width * width * 4);
    for (let y = 10; y < 38; y++) {
      for (let x = 14; x < 26; x++) alpha[(y * width + x) * 4 + 3] = 255;
    }
    expect(faceOrigin(alpha, width, width)).toEqual({ x: 10, y: 9 });
    expect(faceOrigin(new Uint8ClampedArray(width * width * 4), width, width)).toBeNull();
    const edge = new Uint8ClampedArray(width * width * 4);
    edge[3] = 255;
    expect(faceOrigin(edge, width, width)).toEqual({ x: 0, y: 0 });
  });

  it('draws nothing without a canvas context', () => {
    expect(portraitFace(NO_ASSETS)(document.createElement('canvas'), 'brom')).toBe(false);
  });
});

describe('createRoster', () => {
  it('shows one avatar per agent in shortcut order with status and name', () => {
    const { avatars, roster } = setup([agent('a'), agent('b', { status: 'waiting' })]);
    expect(avatars().map((avatar) => avatar.dataset.agent)).toEqual(['a', 'b']);
    expect(avatars().map((avatar) => avatar.dataset.status)).toEqual(['idle', 'waiting']);
    expect(avatars()[1]?.title).toBe('B · Waiting for you');
    expect(avatars()[1]?.getAttribute('aria-label')).toBe('B · Waiting for you');
    const face = avatars()[0]?.querySelector('canvas');
    expect([face?.width, face?.height]).toEqual([FACE, FACE]);
    expect(roster.element.hidden).toBe(false);
  });

  it('picks the agent on click and marks the focused one', () => {
    const { avatars, picked, store } = setup([agent('a'), agent('b')]);
    avatars()[1]?.click();
    expect(picked).toEqual(['b']);
    expect(store.getState().focused).toBe('b');
    expect(avatars().map((avatar) => avatar.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
    ]);
  });

  it('follows joins, leaves, status changes and the locale', () => {
    const { avatars, store, roster } = setup([agent('a')]);
    store.apply({ type: 'agent:updated', agent: agent('b', { status: 'tool' }) });
    expect(avatars().map((avatar) => avatar.dataset.status)).toEqual(['idle', 'tool']);
    store.apply({ type: 'agent:removed', agentId: 'a' });
    expect(avatars().map((avatar) => avatar.dataset.agent)).toEqual(['b']);
    setLocale('pt-BR');
    expect(avatars()[0]?.title).toBe('B · Trabalhando');
    store.apply({ type: 'agent:removed', agentId: 'b' });
    expect(roster.element.hidden).toBe(true);
  });

  it('retries faces whose art has not loaded yet', () => {
    let ready = false;
    const drawFace = vi.fn(() => ready);
    const { ticks, stop, roster } = setup([agent('a')], drawFace);
    expect(drawFace).toHaveBeenCalledTimes(1);
    ticks[0]?.();
    expect(drawFace).toHaveBeenCalledTimes(2);
    ready = true;
    ticks[0]?.();
    ticks[0]?.();
    expect(drawFace).toHaveBeenCalledTimes(3);
    roster.destroy();
    expect(stop).toHaveBeenCalledOnce();
  });
});

describe('permission alerts', () => {
  it('marks avatars with a pending request until it resolves', () => {
    const { store, avatars } = setup([agent('a'), agent('b')]);
    store.apply({
      type: 'permission:request',
      request: {
        id: 'r1',
        agentId: 'b',
        toolName: 'Bash',
        detail: 'ls',
        input: null,
        subagent: null,
        suggestions: [],
        questions: null,
        createdAt: 1,
        expiresAt: 2,
      },
    });
    const [first, second] = avatars();
    expect(first?.dataset.alert).toBeUndefined();
    expect(first?.querySelector('.roster__alert')).toBeNull();
    expect(second?.dataset.alert).toBe('true');
    expect(second?.querySelector('.roster__alert')?.textContent).toBe('!');
    expect(second?.title).toBe('B · Needs your answer');
    store.apply({ type: 'permission:resolved', requestId: 'r1', agentId: 'b', outcome: 'denied' });
    expect(avatars()[1]?.dataset.alert).toBeUndefined();
  });
});
