import { readStream, runHook } from '../server/hooks/hook-relay.js';

function write(text: string | null): Promise<void> {
  return new Promise((resolve) => {
    if (text)
      process.stdout.write(text, () => {
        resolve();
      });
    else resolve();
  });
}

void runHook({
  args: process.argv.slice(2),
  env: process.env,
  readStdin: () => readStream(process.stdin),
  fetch,
})
  .catch(() => null)
  .then(write)
  .finally(() => {
    process.exit(0);
  });
