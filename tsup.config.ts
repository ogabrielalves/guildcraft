import { existsSync } from 'node:fs';
import { defineConfig } from 'tsup';

const ENTRIES = {
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
          clean: true,
          sourcemap: true,
          splitting: false,
        },
      ],
);
