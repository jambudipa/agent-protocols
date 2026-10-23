import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Claude Code worktrees live under `.claude/worktrees/`; their tests are not this checkout's.
    exclude: [...configDefaults.exclude, '.claude/**'],
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
