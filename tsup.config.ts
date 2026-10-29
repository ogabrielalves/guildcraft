import { existsSync } from 'node:fs';
import { defineConfig } from 'tsup';

const ENTRIES = {
  'server/index': 'src/server/index.ts',
  'bin/cli': 'src/bin/cli.ts',
  'bin/hook': 'src/bin/hook.ts',
  'bin/mcp': 'src/bin/mcp.ts',
};

const entry = Object.fromEntries(Object.entries(ENTRIES).filter(([, path]) => existsSync(path)));

export default defineConfig(
  Object.keys(entry).length === 0
    ? []
    : [
        {
          entry,
          format: 'esm',
          platform: 'node',
          target: 'node20',
          outDir: 'dist',
          clean: false,
          sourcemap: true,
          splitting: false,
        },
      ],
);
