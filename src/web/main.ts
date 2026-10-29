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
import { createGame } from './game/game.js';
import { parseWorkshopMap } from './game/map.js';
import { provisionalWorkshop } from './game/provisional-workshop.js';
import { SpriteLibrary, loadImage } from './game/sprite-sheet.js';
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
  const dialog = createAddAgentDialog({
    store,
    socket,
    listFolders: demo ? demoListFolders : (path) => api.listFolders(path),
  });
  const recruit = createRecruitButton(store, () => {
    dialog.open();
  });
  const toasts = createToasts();
  const terminal = createTerminalView({ store, socket, createTerminal: createXterm });
  const panel = createPanel({
    store,
    socket: reportFailedSends(socket, () => {
      toasts.show(t('connection.lost'), 'error');
    }),
    terminal,
  });
  const compose = createCompose({ store, socket });
  const hud = document.createElement('div');
  hud.className = 'hud';
  hud.append(recruit.element, createStats(store).element, createFeed(store).element);
  const tooltip = createTooltip();
  const game = createGame({
    store,
    map: parseWorkshopMap(provisionalWorkshop()),
    sprites: new SpriteLibrary(loadImage),
    onRecruit: () => {
      dialog.open();
    },
    onHover: (hover, clientX, clientY) => {
      const agent = hover?.kind === 'villager' ? store.agent(hover.id) : undefined;
      const text =
        hover?.kind === 'bay'
          ? t('workshop.recruit')
          : agent
            ? `${agent.name} · ${agent.tool !== null && agent.tool.detail !== '' ? agent.tool.detail : t(statusKey(agent.status))}`
            : null;
      const bounds = game.element.getBoundingClientRect();
      if (text === null) tooltip.hide();
      else tooltip.show(text, clientX - bounds.left, clientY - bounds.top);
    },
  });
  mountShell(root, store, [
    game.element,
    hud,
    panel.element,
    compose.element,
    toasts.element,
    tooltip.element,
  ]);
  game.start();
  createNotifications({ store, socket, toasts, isHandled: () => dialog.isAwaiting() });
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
