# presentation source

The agent-to-UI presentation wire format: the guards, schemas and limits that
decide whether a value from an untrusted peer may reach a renderer or a host.
The package depends on `effect` alone and must run in a browser.

## Two contract families

- The V1 contracts describe what a browser renderer receives:
  `json-value.ts` (the bounded JSON value), `interactions.ts`, `messages.ts`
  and `presentation-projection.ts`.
- The T5 contracts describe what a host exchanges with a peer:
  `rich-content.ts`, `agent-plan.ts`, `session-information.ts` and `usage.ts`.

Start with `index.ts`. It is the only public surface; a module it does not
re-export, such as `utf8.ts`, is internal.

## Constraints

- Every limit counts UTF-8 bytes, through `TextEncoder`. Do not use
  `String.length` or Node's `Buffer`: the first under-counts non-ASCII text and
  the second does not exist in a browser.
- Each guard accepts exactly one `version` and rejects any other. Do not read
  an unknown version leniently.
- Plans, session information and usage publish whole snapshots, never deltas.
- Several modules are ports from jam-flow. Their header comments record the
  source; keep their behaviour unchanged unless the contract changes.
