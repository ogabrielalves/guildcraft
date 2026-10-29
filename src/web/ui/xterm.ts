import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { DEFAULT_TERM_COLS, DEFAULT_TERM_ROWS } from '../../shared/constants.js';
import type { TerminalLike } from './terminal-view.js';

const TERMINAL_FONT = "ui-monospace, 'Cascadia Mono', Consolas, 'Liberation Mono', monospace";
const SCROLLBACK_LINES = 5_000;

export function createXterm(): TerminalLike {
  const terminal = new Terminal({
    cols: DEFAULT_TERM_COLS,
    rows: DEFAULT_TERM_ROWS,
    cursorBlink: true,
    fontFamily: TERMINAL_FONT,
    fontSize: 13,
    scrollback: SCROLLBACK_LINES,
    theme: {
      background: '#120d0a',
      foreground: '#f1e4cf',
      cursor: '#f0a63a',
      selectionBackground: '#4a3626',
    },
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  return {
    get cols() {
      return terminal.cols;
    },
    get rows() {
      return terminal.rows;
    },
    open: (parent) => {
      terminal.open(parent);
    },
    write: (data) => {
      terminal.write(data);
    },
    reset: () => {
      terminal.reset();
    },
    paste: (data) => {
      terminal.paste(data);
    },
    focus: () => {
      terminal.focus();
    },
    fit: () => {
      fitAddon.fit();
    },
    hasSelection: () => terminal.hasSelection(),
    getSelection: () => terminal.getSelection(),
    onData: (listener) => terminal.onData(listener),
    attachCustomKeyEventHandler: (handler) => {
      terminal.attachCustomKeyEventHandler(handler);
    },
    dispose: () => {
      terminal.dispose();
    },
  };
}
