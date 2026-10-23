import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Claude Code worktrees live under `.claude/worktrees/`; their tests are not this checkout's.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
