# agent-protocols

Native, installable [Effect v4](https://effect.website/docs/v4/) implementations
of the agent protocols listed at [agentprotocol.ai](https://agentprotocol.ai/),
plus the agent-to-UI presentation format.

| Layer          | Protocol                                                                      | Package                                                                | Status                      |
| -------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------- |
| Agent to tools | MCP                                                                           | none: reuse `effect/ai` (see below)                                    | Available in `effect@4.0.6` |
| Human to agent | [Agent Protocol v1](https://github.com/AI-Engineer-Foundation/agent-protocol) | [`@agent-protocols/agent-protocol`](packages/agent-protocol/README.md) | Server and client           |
| Agent to agent | [A2A v1.0](https://a2a-protocol.org)                                          | `@agent-protocols/a2a`                                                 | Planned                     |
| Agent to UI    | jam-flow presentation wire format                                             | `@agent-protocols/presentation`                                        | Planned                     |

## MCP: reuse `effect/ai`

This workspace has no MCP package on purpose. `effect@4.0.6` ships a complete
MCP implementation under `effect/ai`, on the same version as every package here:

- `McpServer` serves tools, resources and prompts. Use `McpServer.layerStdio`
  or `McpServer.layerHttp`, and register an `effect/ai` `Toolkit` with
  `McpServer.toolkit`.
- `McpClient` connects to an MCP server over stdio (`McpClient.layerStdio`) or
  HTTP (`McpClient.layerHttp`), and `McpClient.toolkit` exposes the remote tools
  as an `effect/ai` `Toolkit`.

```ts
import { McpClient, McpServer } from 'effect/ai';
```

`effect/ai` is an unstable sub-path, so pin `effect` to a patch range
(`~4.0.6`), as this workspace does.

## Workspace

One npm workspace. Each package lives in `packages/<name>/`, builds to `dist/`
with type declarations, and declares an `exports` map.

- Effect `~4.0.6`, with every `@effect/*` package on the same range.
- ESM, `moduleResolution` `NodeNext`, `strict`, TypeScript `~6.0.3`.
- Tests use `@effect/vitest`.

| Command             | What it does                                                      |
| ------------------- | ----------------------------------------------------------------- |
| `npm install`       | Installs the workspace.                                           |
| `npm run build`     | Builds every package to `dist/`.                                  |
| `npm run typecheck` | Type-checks the source and the tests of every package.            |
| `npm test`          | Runs every test once.                                             |
| `npm run lint`      | Runs ESLint and the Effect language service, and fails on either. |

### Lint gate

`eslint/effect-rules.mjs` and `eslint/effect-eslint-config.mjs` are
byte-identical copies of the canonical Effect rule bundle. Update both files
together from the canonical bundle; never edit them here. `eslint.config.mjs`
applies the bundle to `packages/*/src` and `packages/*/test`, and ignores inline
disable comments, so an exception must live in scoped configuration.

`npm run lint` also runs `effect-language-service diagnostics --strict` over
`tsconfig.json`, the project that includes the tests. Run
`npm run lint:effect:all` to see the suggestion-level diagnostics too.
