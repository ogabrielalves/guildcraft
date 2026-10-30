import '@fontsource/pixelify-sans/400.css';
import './styles/base.css';
import './styles/topbar.css';
import '@xterm/xterm/css/xterm.css';
import './styles/terminal.css';
import './styles/panel.css';
import './styles/compose.css';
import './styles/folder-browser.css';
import './styles/dialog.css';
import './styles/feedback.css';
import './styles/game.css';
import { bindSocket, launchToken, mountShell } from './app.js';
import type { Game } from './game/game.js';
import { createGame } from './game/game.js';
import { AssetLibrary } from './game/assets.js';
import type { WorkshopMap } from './game/map.js';
import { loadWorkshopMap, parseWorkshopMap } from './game/map.js';
import { provisionalWorkshop } from './game/provisional-workshop.js';
import { loadImage } from './game/sprite-sheet.js';
import { DemoSocket, demoListFolders, parseDemoOptions } from './demo/demo.js';
import { initI18n, t } from './i18n/index.js';
import { createApi } from './net/api.js';
import { GameSocket, socketUrl } from './net/socket.js';
import { Store } from './state/store.js';
import { createAddAgentDialog, createRecruitButton } from './ui/add-agent-dialog.js';
import { createCompose } from './ui/compose.js';
import { createFeed } from './ui/feed.js';
import { createNotifications, reportFailedSends } from './ui/notifications.js';
import { createPanel, statusKey } from './ui/panel.js';
import { createRemoveAllButton } from './ui/remove-all.js';
import { createRoster } from './ui/roster.js';
import { createShortcuts } from './ui/shortcuts.js';
import { createStats } from './ui/stats.js';
import { createTerminalView } from './ui/terminal-view.js';
import { createToasts } from './ui/toasts.js';
import { createTooltip } from './ui/tooltip.js';
import { createXterm } from './ui/xterm.js';

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const root = document.getElementById('app');
if (root) {
  initI18n();
  const store = new Store();
  const page = new URL(window.location.href);
  const demo = parseDemoOptions(page);
  const token = launchToken({
    page,
    storage: sessionStore(),
    replaceUrl: (url) => {
      window.history.replaceState(null, '', url);
    },
  });
  const socket = demo ? new DemoSocket(demo) : new GameSocket({ url: socketUrl(page, token) });
  const api = createApi({ token });
  const request = (input: string, init?: RequestInit) => globalThis.fetch(input, init);
  const assets = new AssetLibrary({
    loadImage,
    request,
    onError: (url, error) => {
      console.warn(`guildcraft: could not load ${url}`, error);
    },
  });
  const dialog = createAddAgentDialog({
    store,
    socket,
    listFolders: demo ? demoListFolders : (path) => api.listFolders(path),
    assets,
  });
  const recruit = createRecruitButton(store, () => {
    dialog.open();
  });
  const toasts = createToasts();
  const terminal = createTerminalView({ store, socket, createTerminal: createXterm });
  let game: Game | null = null;
  const panel = createPanel({
    store,
    socket: reportFailedSends(socket, () => {
      toasts.show(t('connection.lost'), 'error');
    }),
    terminal,
    assets,
    doing: (agentId) => game?.world.villager(agentId)?.doing ?? null,
  });
  const compose = createCompose({ store, socket });
  const hud = document.createElement('div');
  hud.className = 'hud';
  const removeAll = createRemoveAllButton({ store, socket });
  const roster = createRoster({
    store,
    assets,
    onPick: (agentId) => {
      store.select(agentId);
      game?.focusVillager(agentId);
    },
  });
  hud.append(
    recruit.element,
    removeAll.element,
    roster.element,
    createStats(store).element,
    createFeed(store).element,
  );
  const tooltip = createTooltip();
  mountShell(root, store, [
    hud,
    panel.element,
    panel.console,
    compose.element,
    toasts.element,
    tooltip.element,
  ]);
  const startGame = (map: WorkshopMap) => {
    const started = createGame({
      store,
      socket,
      map,
      assets,
      onHover: (hover, clientX, clientY) => {
        const agent = hover?.kind === 'villager' ? store.agent(hover.id) : undefined;
        const text = agent
          ? `${agent.name} · ${agent.tool !== null && agent.tool.detail !== '' ? agent.tool.detail : t(statusKey(agent.status))}`
          : null;
        const bounds = started.element.getBoundingClientRect();
        if (text === null) tooltip.hide();
        else tooltip.show(text, clientX - bounds.left, clientY - bounds.top);
      },
    });
    root.querySelector('.stage')?.prepend(started.element);
    started.start();
    game = started;
  };
  loadWorkshopMap(assets.url('maps/workshop.json'), request).then(startGame, (error: unknown) => {
    console.warn('guildcraft: using the provisional workshop', error);
    startGame(parseWorkshopMap(provisionalWorkshop()));
  });
  createNotifications({ store, socket, toasts, isHandled: (message) => dialog.handles(message) });
  createShortcuts({
    store,
    focusCompose: () => {
      compose.focus();
    },
    isBlocked: () => document.querySelector('dialog[open]') !== null,
  });
  bindSocket(socket, store);
  socket.connect();
}
