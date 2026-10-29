import { defineConfig } from 'vite';

const SERVER = `http://127.0.0.1:${process.env.GUILDCRAFT_PORT ?? '7777'}`;

export default defineConfig({
  root: 'src/web',
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    assetsDir: 'static',
  },
  server: {
    proxy: {
      '/api': SERVER,
      '/hook': SERVER,
      '/assets': SERVER,
      '/ws': { target: SERVER, ws: true },
    },
  },
});
