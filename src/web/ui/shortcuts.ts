import { MAX_AGENTS } from '../../shared/constants.js';
import type { Store } from '../state/store.js';

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const INTERACTIVE = 'button, a[href], summary, [role="button"], [role="radio"]';
const DIGIT_CODE = /^(?:Digit|Numpad)([1-9])$/;

export type ShortcutKey = Pick<
  KeyboardEvent,
  'key' | 'code' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'
>;

export type Shortcut =
  { type: 'select'; index: number; mode: 'replace' | 'toggle' } | { type: 'clear' };

export interface ShortcutsOptions {
  store: Store;
  isBlocked?: () => boolean;
  target?: Pick<Document, 'addEventListener' | 'removeEventListener'>;
}

export interface Shortcuts {
  destroy(): void;
}

export function isEditable(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE) !== null;
}

export function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE) !== null;
}

export function shortcutFor(event: ShortcutKey): Shortcut | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const digit = DIGIT_CODE.exec(event.code)?.[1];
  if (digit !== undefined) {
    const index = Number(digit) - 1;
    if (index >= MAX_AGENTS) return null;
    return { type: 'select', index, mode: event.shiftKey ? 'toggle' : 'replace' };
  }
  if (event.key === 'Escape') return { type: 'clear' };
  return null;
}

export function createShortcuts(options: ShortcutsOptions): Shortcuts {
  const { store } = options;
  const target = options.target ?? document;

  const run = (shortcut: Shortcut): boolean => {
    const state = store.getState();
    switch (shortcut.type) {
      case 'select': {
        const agent = state.agents[shortcut.index];
        if (!agent) return false;
        store.select(agent.id, shortcut.mode);
        return true;
      }
      case 'clear':
        if (state.selected.length === 0 && state.focused === null) return false;
        store.clearSelection();
        return true;
    }
  };

  const onKeyDown = (event: Event) => {
    if (!(event instanceof KeyboardEvent) || event.defaultPrevented || event.isComposing) return;
    if (isEditable(event.target) || options.isBlocked?.()) return;
    const shortcut = shortcutFor(event);
    if (!shortcut) return;
    if (run(shortcut)) event.preventDefault();
  };

  target.addEventListener('keydown', onKeyDown);
  return {
    destroy() {
      target.removeEventListener('keydown', onKeyDown);
    },
  };
}
