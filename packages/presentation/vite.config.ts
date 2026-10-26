import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rolldownOptions: {
      // The peer dependency stays external: never bundle it. The package uses
      // no Node built-in, so it runs in a browser as well as in Node.
      external: [/^effect(\/|$)/],
    },
    sourcemap: true,
    target: 'es2022',
    minify: false,
  },
});
