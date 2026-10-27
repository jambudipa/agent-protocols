import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Claude Code worktrees live under `.claude/worktrees/`; their tests are not this checkout's.
    // The vendored docs gate test uses `node:test`, so CI runs it with `node --test` instead.
    exclude: [...configDefaults.exclude, '.claude/**', 'scripts/**'],
    coverage: {
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '.claude/**',
      ],
    },
  },
});
