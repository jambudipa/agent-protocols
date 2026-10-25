import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        'wire/index': resolve(import.meta.dirname, 'src/wire/index.ts'),
        schema: resolve(import.meta.dirname, 'src/schema.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rolldownOptions: { external: [/^effect(\/|$)/] },
    sourcemap: true,
    target: 'es2022',
    minify: false,
  },
});
