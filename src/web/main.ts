import './styles/base.css';
import './styles/topbar.css';
import '@xterm/xterm/css/xterm.css';
import './styles/terminal.css';
import './styles/panel.css';
import { bindSocket, launchSocketUrl, mountShell } from './app.js';
import { DemoSocket, parseDemoOptions } from './demo/demo.js';
import { initI18n } from './i18n/index.js';
import { GameSocket } from './net/socket.js';
import { Store } from './state/store.js';
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
  const socket = demo
    ? new DemoSocket(demo)
    : new GameSocket({
        url: launchSocketUrl({
          page,
          storage: sessionStore(),
          replaceUrl: (url) => {
            window.history.replaceState(null, '', url);
          },
        }),
      });
  const terminal = createTerminalView({ store, socket, createTerminal: createXterm });
  const panel = createPanel({ store, socket, terminal });
  mountShell(root, store, [panel.element]);
  bindSocket(socket, store);
  socket.connect();
}
