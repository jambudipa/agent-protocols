# @jambudipa/presentation

A selected, immutable V1 presentation prerequisite for the Vadz Story Agent.
This package ports the actual jam-flow records. It does not implement all T5
surfaces or qualify an agent host, model, backend, browser renderer or storage.

## Exports

| Export                           | Runtime                                   | Surface                                                        |
| -------------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| `@jambudipa/presentation/wire`   | Pure ESM; no Effect, Node or host imports | V1 types, limits, guards, constraints and capability downgrade |
| `@jambudipa/presentation/schema` | Effect `~4.0.6`                           | Six codecs backed by the same strict guards                    |
| `@jambudipa/presentation`        | Effect `~4.0.6`                           | The combined wire and schema surface                           |

Effect is an optional peer because pure consumers do not need it. Install Effect
4.0.6 explicitly when you use the root or `/schema` export. Types and exports
resolve only to built package files, never to a mutable source checkout.

```ts
import {
  isPresentationRecordV1,
  downgradePresentationMessageV1,
} from '@jambudipa/presentation/wire';

if (isPresentationRecordV1(input)) {
  const visible = downgradePresentationMessageV1(input.message, {
    version: '1',
    messageKinds: ['text', 'status', 'group', 'result'],
  });
  // Render visible as inert data. undefined means the message is unavailable.
}
```

```ts
import { Schema } from 'effect';
import { PresentationRecordV1Schema } from '@jambudipa/presentation/schema';

const record = Schema.decodeUnknownSync(PresentationRecordV1Schema)(input);
```

## V1 contract

The nine message kinds are `text`, `status`, `card`, `metric`, `trace`, `state`,
`group`, `interaction` and `result`. Records wrap messages with opaque identifiers,
a one-based sequence, an epoch timestamp and optional correlation identifiers.
The interaction vocabulary is `text`, `choice`, `confirm` and `json`.

All guards reject unknown versions, unknown fields and unknown kinds. Normative
limits match the source: JSON depth 16, 1,000 members and 64 KiB encoded size;
message text 64 KiB raw UTF-8; group depth 16, 100 direct children and 64 KiB
encoded size. Interaction text uses UTF-8 byte counts. The exported limit objects
state the exact source budgets, including interaction lifetimes and choices.

The source capability fallback **silences** unsupported kinds. It filters the
children of a supported group recursively. It drops a group whose children all
become unsupported. It preserves a group that arrived empty. It drops an
unsupported group even when that group contains supported children. It never
converts a card to text or flattens an unsupported group. Producers must provide
supported readable messages when they need text fallback.

The pure downgrade result uses `undefined` for absence. The source used Effect
`Option`; the wire result carries the same availability decision without loading
Effect. Invalid inputs also return `undefined`.

## Inert consumer policy

Guards accept ordinary JSON data. They reject accessors without invoking them,
class/custom prototypes, sparse arrays, array metadata, hidden/symbol keys,
cycles and out-of-budget values. Null-prototype records and shared acyclic
children remain valid. A separate traversal budget limits 64 data levels,
20,000 members and 1 MiB encoded size before grammar validation. This budget
bounds rejection work, including a compact object graph with exponential JSON
expansion. These rules strengthen the source message/capability object policy;
they do not add wire fields or change supported fallback semantics.

The validator measures JSON through descriptors. It never calls an input
object's `toJSON`. It uses native JSON encoding only for primitive strings.
JavaScript Proxies can execute reflection traps; they are not wire data. The
boundary catches throwing/revoked Proxies but cannot stop arbitrary Proxy code.
Deserialize transport JSON before passing values across a trust boundary.

Schema codecs declare the pure guard directly. They validate the original value
before any transformation. In particular, a `Date`, `Map` or `Set` cannot become
an accepted empty JSON object. See the explicit source deviations in
[PROVENANCE.md](PROVENANCE.md).

## Authority and unavailable surfaces

All exports handle data only. A `confirm` response, a result, a status or a
correlation identifier cannot approve work, save content, dispatch a tool or grant
permission. `validateInteractionResponseV1` checks shape, correlation and visible
constraints only. It does not check current expiry, principal identity, consent,
financial authority or a domain schema. The application must enforce those
separate conditions at its action boundary.

Event-envelope projections, projection callbacks, interaction registries,
renderer implementations, rich-content/agent-plan/session/usage views, T5
orchestration and AP/A2A transports are unavailable in this package. The package
does not invent substitutes. Full upstream completion remains M2.

## Development

From the workspace root:

```sh
npx vitest run packages/presentation/test
npx tsc -p packages/presentation/tsconfig.dev.json --noEmit
npm run build -w @jambudipa/presentation
npx eslint packages/presentation/src packages/presentation/test --max-warnings=0
npx effect-language-service diagnostics --project packages/presentation/tsconfig.dev.json --format text --severity error,warning --strict
npx prettier --check packages/presentation eslint.config.mjs
```

The tarball qualification uses isolated installed consumers, including a wire
consumer with no Effect installation. Qualification metadata records the exact
source commit, packed file list, runtime versions and SHA512 integrity. It proves
only the selected installed exports, not real host or model qualification.
