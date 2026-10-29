import './styles/base.css';
import './styles/topbar.css';
import '@xterm/xterm/css/xterm.css';
import './styles/terminal.css';
import { bindSocket, launchSocketUrl, mountShell } from './app.js';
import { DemoSocket, parseDemoOptions } from './demo/demo.js';
import { initI18n } from './i18n/index.js';
import { GameSocket } from './net/socket.js';
import { Store } from './state/store.js';

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
  mountShell(root, store);
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
  bindSocket(socket, store);
  socket.connect();
}
