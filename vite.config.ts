import preact from '@preact/preset-vite';
import {viteSingleFile} from 'vite-plugin-singlefile';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  plugins: [preact(), viteSingleFile()],
  build: {
    assetsInlineLimit: Number.POSITIVE_INFINITY,
    cssCodeSplit: false,
    sourcemap: false,
  },
  server: {
    port: 9000,
    proxy: {
      '/token': 'http://localhost:7681',
      '/ws': {
        target: 'ws://localhost:7681',
        ws: true,
      },
    },
  },
  test: {
    environment: 'node',
  },
});
