import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const entry = (file: string) =>
  fileURLToPath(new URL(`./src/${file}`, import.meta.url));

/** One entry for each export path; the key is the path under `dist/`. */
const entries = {
  index: entry('index.ts'),
  'errors/index': entry('errors/index.ts'),
  'server/index': entry('server/index.ts'),
  'client/index': entry('client/index.ts'),
  node: entry('node.ts'),
  'errors/grpc/index': entry('errors/grpc/index.ts'),
  'server/grpc/index': entry('server/grpc/index.ts'),
  'client/grpc/index': entry('client/grpc/index.ts'),
  'server/sql/index': entry('server/sql/index.ts'),
  'bin/a2a-db': entry('bin/a2a-db.ts'),
  'compat/v0_3/index': entry('compat/v0_3/index.ts'),
  'compat/v0_3/server/index': entry('compat/v0_3/server/index.ts'),
  'compat/v0_3/server/grpc/index': entry('compat/v0_3/server/grpc/index.ts'),
  'compat/v0_3/client/index': entry('compat/v0_3/client/index.ts'),
  'compat/v0_3/client/grpc/index': entry('compat/v0_3/client/grpc/index.ts'),
};

export default defineConfig({
  build: {
    lib: {
      entry: entries,
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rolldownOptions: {
      // Peer and runtime dependencies and Node built-ins stay external: never
      // bundle them. Optional peers are loaded only by the entries that need
      // them.
      external: [
        /^effect(\/|$)/,
        /^@effect\//,
        /^node:/,
        /^jose(\/|$)/,
        /^@grpc\/grpc-js(\/|$)/,
        /^@bufbuild\/protobuf(\/|$)/,
      ],
    },
    sourcemap: true,
    target: 'node24',
    minify: false,
    ssr: true,
  },
});
