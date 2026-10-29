import './styles/base.css';
import './styles/topbar.css';
import '@xterm/xterm/css/xterm.css';
import './styles/terminal.css';
import './styles/panel.css';
import './styles/compose.css';
import './styles/folder-browser.css';
import './styles/dialog.css';
import { bindSocket, launchToken, mountShell } from './app.js';
import { DemoSocket, demoListFolders, parseDemoOptions } from './demo/demo.js';
import { initI18n } from './i18n/index.js';
import { createApi } from './net/api.js';
import { GameSocket, socketUrl } from './net/socket.js';
import { Store } from './state/store.js';
import { createAddAgentDialog, createRecruitButton } from './ui/add-agent-dialog.js';
import { createCompose } from './ui/compose.js';
import { createPanel } from './ui/panel.js';
import { createTerminalView } from './ui/terminal-view.js';
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
  const terminal = createTerminalView({ store, socket, createTerminal: createXterm });
  const panel = createPanel({ store, socket, terminal });
  const compose = createCompose({ store, socket });
  mountShell(root, store, [recruit.element, panel.element, compose.element]);
  bindSocket(socket, store);
  socket.connect();
}
