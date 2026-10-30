import type { AgentView } from '../../shared/agent.js';
import type { Assets } from '../game/assets.js';
import { onLocaleChange, t } from '../i18n/index.js';
import type { Store, StoreState } from '../state/store.js';
import { pendingFor } from '../state/store.js';
import { statusKey } from './panel.js';
import { PORTRAIT, drawPortrait } from './portrait.js';

export const FACE = 20;
export const ROSTER_REFRESH_MS = 500;

export type DrawFace = (target: HTMLCanvasElement, skin: string) => boolean;

export interface RosterOptions {
  store: Store;
  assets: Assets;
  onPick: (agentId: string) => void;
  drawFace?: DrawFace;
  every?: (callback: () => void, ms: number) => () => void;
}

export interface Roster {
  readonly element: HTMLElement;
  destroy(): void;
}

export function faceOrigin(alpha: ArrayLike<number>, width: number, height: number) {
  let top = -1;
  let left = width;
  let right = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((alpha[(y * width + x) * 4 + 3] ?? 0) === 0) continue;
      if (top === -1) top = y;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  if (top === -1) return null;
  const center = Math.round((left + right + 1) / 2);
  return {
    x: Math.min(width - FACE, Math.max(0, center - FACE / 2)),
    y: Math.min(height - FACE, Math.max(0, top - 1)),
  };
}

export function portraitFace(assets: Assets): DrawFace {
  const scratch = document.createElement('canvas');
  scratch.width = PORTRAIT.width;
  scratch.height = PORTRAIT.height;
  return (target, skin) => {
    const source = scratch.getContext('2d', { willReadFrequently: true });
    const ctx = target.getContext('2d');
    if (!source || !ctx) return false;
    drawPortrait(source, assets, skin, 0);
    const origin = faceOrigin(
      source.getImageData(0, 0, PORTRAIT.width, PORTRAIT.height).data,
      PORTRAIT.width,
      PORTRAIT.height,
    );
    if (origin === null) return false;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, FACE, FACE);
    ctx.drawImage(scratch, origin.x, origin.y, FACE, FACE, 0, 0, FACE, FACE);
    return true;
  };
}

function defaultEvery(callback: () => void, ms: number): () => void {
  const handle = setInterval(callback, ms);
  return () => {
    clearInterval(handle);
  };
}

export function createRoster(options: RosterOptions): Roster {
  const { store, onPick } = options;
  const drawFace = options.drawFace ?? portraitFace(options.assets);
  const element = document.createElement('nav');
  element.className = 'roster';
  const pending = new Map<HTMLCanvasElement, string>();

  const avatar = (agent: AgentView, focused: boolean, alert: boolean) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'roster__avatar';
    button.dataset.agent = agent.id;
    button.dataset.status = agent.status;
    button.setAttribute('aria-pressed', String(focused));
    const state = alert ? t('request.pending') : t(statusKey(agent.status));
    const label = `${agent.name} · ${state}`;
    button.title = label;
    button.setAttribute('aria-label', label);
    const face = document.createElement('canvas');
    face.className = 'roster__face';
    face.width = FACE;
    face.height = FACE;
    button.append(face);
    if (alert) {
      button.dataset.alert = 'true';
      const badge = document.createElement('span');
      badge.className = 'roster__alert';
      badge.textContent = '!';
      button.append(badge);
    }
    button.addEventListener('click', () => {
      onPick(agent.id);
    });
    if (!drawFace(face, agent.skin)) pending.set(face, agent.skin);
    return button;
  };

  const render = (state: StoreState) => {
    pending.clear();
    element.hidden = state.agents.length === 0;
    element.replaceChildren(
      ...state.agents.map((agent) =>
        avatar(agent, agent.id === state.focused, pendingFor(state, agent.id).length > 0),
      ),
    );
  };

  const retry = () => {
    for (const [face, skin] of pending) {
      if (drawFace(face, skin)) pending.delete(face);
    }
  };

  render(store.getState());
  const stop = (options.every ?? defaultEvery)(retry, ROSTER_REFRESH_MS);
  const unsubscribeStore = store.subscribe((state, previous) => {
    if (
      state.agents !== previous.agents ||
      state.focused !== previous.focused ||
      state.permissions !== previous.permissions
    ) {
      render(state);
    }
  });
  const unsubscribeLocale = onLocaleChange(() => {
    render(store.getState());
  });

  return {
    element,
    destroy() {
      stop();
      unsubscribeStore();
      unsubscribeLocale();
      element.remove();
    },
  };
}
