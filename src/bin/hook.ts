import { readStream, relayHook } from '../server/hooks/hook-relay.js';

void relayHook({
  args: process.argv.slice(2),
  env: process.env,
  readStdin: () => readStream(process.stdin),
  fetch,
}).finally(() => {
  process.exit(0);
});
