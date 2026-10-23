import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const entry = (file: string) =>
  fileURLToPath(new URL(`./src/${file}`, import.meta.url));

export default defineConfig({
  build: {
    lib: {
      entry: { index: entry('index.ts'), node: entry('node.ts') },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rolldownOptions: {
      // Peer dependencies and Node built-ins stay external: never bundle them.
      external: [/^effect(\/|$)/, /^@effect\//, /^node:/],
    },
    sourcemap: true,
    target: 'node24',
    minify: false,
    ssr: true,
  },
});
