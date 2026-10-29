import { exec, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

const settingsPath = process.argv[process.argv.indexOf('--settings') + 1];
const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));

function runHook(event, payload = {}) {
  const command = settings.hooks[event]?.[0]?.hooks[0]?.command;
  if (!command) return Promise.resolve();
  return new Promise((resolve) => {
    const child = exec(command, () => {
      resolve();
    });
    child.stdin.end(JSON.stringify({ hook_event_name: event, ...payload }));
  });
}

let turns = Promise.resolve();

function submit(text) {
  turns = turns.then(async () => {
    await runHook('UserPromptSubmit', { prompt: text });
    process.stdout.write(`\r\nreply: ${text}\r\n> `);
    await runHook('Stop');
  });
}

let buffer = '';
let input = '';

function consume() {
  while (buffer.length > 0) {
    if (buffer.startsWith(PASTE_START)) {
      const end = buffer.indexOf(PASTE_END);
      if (end < 0) return;
      input += buffer.slice(PASTE_START.length, end);
      buffer = buffer.slice(end + PASTE_END.length);
      continue;
    }
    if (PASTE_START.startsWith(buffer)) return;
    const char = buffer[0];
    buffer = buffer.slice(1);
    if (char === '\r') {
      if (input.trim() !== '') submit(input);
      input = '';
    } else if (char !== '\x1b') {
      input += char;
    }
  }
}

const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
  windowsHide: true,
});

process.stdin.setRawMode?.(true);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
  buffer += data;
  consume();
});
process.stdout.write(`pids ${process.pid} ${helper.pid}\r\n> `);
await runHook('SessionStart', { source: 'startup' });
