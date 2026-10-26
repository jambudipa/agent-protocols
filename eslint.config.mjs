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
    // protobuf-es output of `npm run generate -w @jambudipa/a2a`. It is never
    // edited by hand, and `git diff` after a regeneration proves it is current.
    ignores: ['packages/a2a/src/generated/**'],
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

  {
    // gRPC boundary (@jambudipa/a2a): the @grpc/grpc-js unary callback reads
    // a `null` error as success, so this one adapter file writes `null`.
    files: ['packages/a2a/src/server/grpc/internal/callbacks.ts'],
    rules: { 'effect/no-null-use-option': 'off' },
  },

  {
    // @jambudipa/presentation: the JSON guard detects cycles by object
    // identity. `HashSet` hashes structurally, which enumerates the value and
    // would invoke the getters that the guard exists to avoid.
    files: ['packages/presentation/src/json-value.ts'],
    rules: { 'effect/no-set-use-hashset': 'off' },
  },

  {
    // @jambudipa/presentation: the guard tests feed hostile wire values. JSON
    // `null`, a missing `undefined` field, and a `Date`, `Map` or `Set` that
    // must be refused (and that fence defect D7) are the input under test.
    files: [
      'packages/presentation/test/interactions.test.ts',
      'packages/presentation/test/json-value.test.ts',
      'packages/presentation/test/messages.test.ts',
      'packages/presentation/test/presentation-projection.test.ts',
    ],
    rules: {
      'effect/no-null-use-option': 'off',
      'effect/no-undefined-use-option': 'off',
      'effect/no-new-date-use-datetime': 'off',
      'effect/no-map-use-hashmap': 'off',
      'effect/no-set-use-hashset': 'off',
    },
  },

  {
    // @jambudipa/presentation: one test proves that a host projection which
    // throws a native `Error` is silenced. The throw is the input under test.
    files: ['packages/presentation/test/presentation-projection.test.ts'],
    rules: {
      'effect/no-throw-use-effect': 'off',
      'effect/no-error-constructor': 'off',
    },
  },

  {
    // @jambudipa/presentation: a test drops one key from a wire record with a
    // rest destructure, so the dropped binding is unused on purpose.
    files: ['packages/presentation/test/messages.test.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true },
      ],
    },
  },
];
