// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentView } from '../../shared/agent.js';
import { Store } from '../state/store.js';
import type { ShortcutKey, Shortcuts } from './shortcuts.js';
import { createShortcuts, isEditable, isInteractive, shortcutFor } from './shortcuts.js';

const active: Shortcuts[] = [];

afterEach(() => {
  for (const shortcuts of active.splice(0)) shortcuts.destroy();
  document.body.replaceChildren();
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
    model: null,
    effort: null,
    queued: 0,
  };
}

function key(overrides: Partial<ShortcutKey>): ShortcutKey {
  return {
    key: '',
    code: '',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...overrides,
  };
}

function setup(blocked = false) {
  const store = new Store();
  store.apply({
    type: 'session:init',
    agents: [agent('a'), agent('b'), agent('c')],
    events: [],
    skins: [],
    permissions: [],
    activities: [],
  });
  const shortcuts = createShortcuts({ store, isBlocked: () => blocked });
  active.push(shortcuts);
  const press = (init: KeyboardEventInit, target: EventTarget = document.body) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };
  return { store, shortcuts, press };
}

describe('shortcutFor', () => {
  it('maps digits 1-9 to selection', () => {
    expect(shortcutFor(key({ code: 'Digit1' }))).toEqual({
      type: 'select',
      index: 0,
      mode: 'replace',
    });
    expect(shortcutFor(key({ code: 'Numpad8', shiftKey: true }))).toEqual({
      type: 'select',
      index: 7,
      mode: 'toggle',
    });
    expect(shortcutFor(key({ code: 'Digit9' }))).toEqual({
      type: 'select',
      index: 8,
      mode: 'replace',
    });
    expect(shortcutFor(key({ code: 'Digit0' }))).toBeNull();
  });

  it('maps Escape', () => {
    expect(shortcutFor(key({ key: 'Escape' }))).toEqual({ type: 'clear' });
    expect(shortcutFor(key({ key: 'Enter' }))).toBeNull();
  });

  it('leaves browser and system shortcuts alone', () => {
    expect(shortcutFor(key({ code: 'Digit1', ctrlKey: true }))).toBeNull();
    expect(shortcutFor(key({ code: 'Digit1', metaKey: true }))).toBeNull();
    expect(shortcutFor(key({ code: 'Digit1', altKey: true }))).toBeNull();
    expect(shortcutFor(key({ key: 'a', code: 'KeyA' }))).toBeNull();
  });
});

describe('target checks', () => {
  it('detects editable and interactive targets', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    editable.append(inner);
    expect(isEditable(document.createElement('textarea'))).toBe(true);
    expect(isEditable(inner)).toBe(true);
    expect(isEditable(document.body)).toBe(false);
    expect(isEditable(null)).toBe(false);
    expect(isInteractive(document.createElement('button'))).toBe(true);
    expect(isInteractive(document.body)).toBe(false);
  });
});

describe('createShortcuts', () => {
  it('selects agents by number and toggles with Shift', () => {
    const { store, press } = setup();
    expect(press({ code: 'Digit2' }).defaultPrevented).toBe(true);
    expect(store.getState().focused).toBe('b');
    press({ code: 'Digit3', shiftKey: true });
    expect(store.getState().selected).toEqual(['b', 'c']);
    expect(press({ code: 'Digit5' }).defaultPrevented).toBe(false);
  });

  it('clears the selection with Escape', () => {
    const { store, press } = setup();
    expect(press({ key: 'Escape' }).defaultPrevented).toBe(false);
    store.select('a');
    expect(press({ key: 'Escape' }).defaultPrevented).toBe(true);
    expect(store.getState().selected).toEqual([]);
  });

  it('ignores typing, console input, IME and handled events', () => {
    const { store, press } = setup();
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    press({ code: 'Digit1' }, textarea);
    press({ code: 'Digit1', isComposing: true });
    const handled = new KeyboardEvent('keydown', { code: 'Digit1', cancelable: true });
    handled.preventDefault();
    document.dispatchEvent(handled);
    document.dispatchEvent(new Event('keydown'));
    expect(store.getState().selected).toEqual([]);
  });

  it('does nothing while blocked or after destroy', () => {
    const blocked = setup(true);
    blocked.press({ code: 'Digit1' });
    expect(blocked.store.getState().selected).toEqual([]);
    const active = setup();
    active.shortcuts.destroy();
    active.press({ code: 'Digit1' });
    expect(active.store.getState().selected).toEqual([]);
  });
});
