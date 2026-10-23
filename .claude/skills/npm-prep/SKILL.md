---
name: npm-prep
description: Set up or audit a modern npm package — TypeScript strict config, Vite build, ESM-first exports, Vitest, Prettier, Changesets, GitHub Actions CI/release. Based on the Total TypeScript approach. Use whenever the user says "create an npm package", "scaffold a package", "set up Vite for a library", "configure publishing", "add Changesets", "modernize this package", or invokes /npm-prep.
---

# NPM Package Setup Reference

Modern npm package scaffold using TypeScript + Vite + Vitest + Changesets, following the [Total TypeScript approach](https://www.totaltypescript.com/how-to-create-an-npm-package).

## Core principles

1. **Modern TypeScript** — latest version, strict mode, declaration files, source maps.
2. **Vite build** — ES modules first, Node 18+ target, tree-shakeable output.
3. **Quality automation** — Vitest, Prettier, GitHub Actions, Changesets.

## Phase 1 — Repository init

```bash
git init
npm init -y
```

Create `.gitignore`, `README.md`, `LICENSE` (MIT recommended), `.npmignore`.

## Phase 2 — TypeScript

```bash
npm install --save-dev typescript @types/node
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "removeComments": false,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

## Phase 3 — Vite build

```bash
npm install --save-dev vite
```

`vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'YourPackageName',
      formats: ['es'],
      fileName: 'index'
    },
    rollupOptions: {
      external: [
        // runtime deps and Node built-ins
        'fs', 'path', 'url',
        'node:fs', 'node:path', 'node:url'
      ]
    },
    sourcemap: true,
    target: 'node18',
    minify: false,
    ssr: true
  }
});
```

Externalize all `dependencies` and `peerDependencies` — never bundle them.

## Phase 4 — package.json

Essential fields:

```json
{
  "name": "@your-scope/package-name",
  "version": "1.0.0",
  "description": "Clear, concise description",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": ["dist", "README.md", "LICENSE"],
  "engines": { "node": ">=18.0.0" },
  "scripts": {
    "build": "vite build && tsc --emitDeclarationOnly --outDir dist",
    "dev": "vite build --watch",
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest --coverage",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist",
    "prepublishOnly": "npm run clean && npm run build && npm run typecheck",
    "prepack": "npm run build"
  },
  "publishConfig": { "access": "public" }
}
```

Key points:
- `exports` field is the modern resolution mechanism — get the conditions right or downstream imports break.
- `files` is an allowlist — only ship what consumers need.
- For scoped public packages, `publishConfig.access` must be `public`.

## Phase 5 — Testing (Vitest)

```bash
npm install --save-dev vitest @vitest/coverage-v8
```

`vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      reporter: ['text', 'html', 'lcov'],
      exclude: ['node_modules/**', 'dist/**', '**/*.test.ts', '**/*.spec.ts']
    }
  }
});
```

Structure:

```
src/
├── index.ts
├── lib/
└── __tests__/
```

## Phase 6 — Code quality

```bash
npm install --save-dev prettier
```

`.prettierrc`:

```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 80,
  "tabWidth": 2,
  "useTabs": false
}
```

Add ESLint only if the project actually needs lint rules beyond formatting — otherwise Prettier + `tsc --noEmit` covers most needs.

## Phase 7 — Documentation

README sections: title + description, install, quick-start, API reference, configuration, examples, contributing, license.

Use JSDoc on every public export.

## Phase 8 — Pre-publish validation

```bash
npm run build
npm pack
tar -tzf your-package-1.0.0.tgz   # verify contents
npm install ./your-package-1.0.0.tgz   # local install smoke test
```

## Phase 9 — CI (GitHub Actions)

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18.x, 20.x]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - run: npm run test:run
      - run: npm run typecheck
```

Automated release workflow uses `NODE_AUTH_TOKEN` from `secrets.NPM_TOKEN` — no interactive OTP needed in CI.

## Phase 10 — Versioning (Changesets)

```bash
npm install --save-dev @changesets/cli
npx changeset init
```

Semver:
- **Patch**: bug fixes.
- **Minor**: new features, backward compatible.
- **Major**: breaking changes.

For the actual release flow, use the npm-publish skill.

## Common pitfalls

- Missing `"type": "module"` for ESM packages.
- Wrong `exports` field — breaks downstream resolution silently.
- Bundling runtime deps instead of externalizing them.
- Publishing source instead of dist.
- Missing source maps — makes downstream debugging painful.
- Not testing the packed tarball locally before publish.

## Monorepo / migration notes

When migrating from Nx or similar:
1. Identify runtime + peer dependencies.
2. Replace existing build tooling with Vite.
3. Fix all relative imports for the new structure.
4. Test full functionality before cutting over.
5. Update docs to reflect standalone usage.
