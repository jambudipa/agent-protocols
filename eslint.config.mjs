/**
 * Workspace-wide ESLint configuration.
 *
 * One config at the root covers every package. The canonical Effect rule
 * bundle is vendored under `eslint/`, byte-identical to the user-wide bundle,
 * so every machine and CI runner lints with the same implementation. Update
 * both vendored files together from the canonical bundle.
 */
import tseslint from 'typescript-eslint';
import { effectLintConfig } from './eslint/effect-eslint-config.mjs';

/** Package source and tests. The canonical rules apply to both in full. */
const SOURCES = ['packages/*/src/**/*.ts', 'packages/*/test/**/*.ts'];

export default [
  {
    // Build output, dependencies, vendored rules and tool folders are not source.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'eslint/**',
      '_bmad/**',
      '_bmad-output/**',
      '.claude/**',
      '.idea/**',
      '.serena/**',
    ],
  },

  {
    // No inline disables: an exception belongs in scoped configuration here.
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
    },
  },

  // The canonical config sets no parser, so typescript-eslint supplies it.
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: SOURCES,
  })),

  effectLintConfig(SOURCES),
];
