import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Resolves a source file to an absolute path, so the build entries do not
 * depend on the directory Vite runs from.
 */
const entry = (file: string) =>
  fileURLToPath(new URL(`./src/${file}`, import.meta.url));

/** One entry for each export path; the key is the path under `dist/`. */
const entries = {
  index: entry('index.ts'),
  'server/index': entry('server/index.ts'),
  'proto/index': entry('proto/index.ts'),
};

export default defineConfig({
  build: {
    lib: {
      entry: entries,
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rolldownOptions: {
      // Peer dependencies and Node built-ins stay external: never bundle them.
      // The optional peers load only from the entries that need them.
      external: [
        /^effect(\/|$)/,
        /^@effect\//,
        /^node:/,
        /^@bufbuild\/protobuf(\/|$)/,
      ],
    },
    sourcemap: true,
    target: 'node24',
    minify: false,
    ssr: true,
  },
});
