import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Resolves a source file to an absolute path, so the build entries do not
 * depend on the directory Vite runs from.
 */
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
