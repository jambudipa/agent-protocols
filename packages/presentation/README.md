# @jambudipa/presentation

The agent-to-UI wire format for Effect v4. It defines what an agent run _looks
like_ to something outside the agent — messages, rich content, the agent plan,
session information, usage totals, interaction requests and responses, bounded
JSON, and the browser projection — and nothing about what a run _means_.

It is a port of the presentation layer of jam-flow
(`packages/flow/src/presentation/` at commit `4f8dafdf`), moved from Effect
`4.0.0-rc.112` to `4.0.6`. The port keeps every behaviour and every public name.
It leaves out the terminal renderers and the hosts.

Nothing here performs I/O, and the package uses no Node built-in, so it runs in
a browser as well as in Node.

## Install

```sh
npm install @jambudipa/presentation effect@~4.0.6
```

`effect` is the only peer dependency.

## Use

Guard an untrusted message before a renderer draws it, then fit it to what the
browser can render:

```ts
import { Option } from 'effect';
import {
  downgradePresentationMessageV1,
  isPresentationMessageV1,
} from '@jambudipa/presentation';

const incoming: unknown = JSON.parse(frame);

if (isPresentationMessageV1(incoming)) {
  // `None` when the browser cannot render the message at all.
  const shown = downgradePresentationMessageV1(incoming, {
    version: '1',
    messageKinds: ['text', 'card', 'group'],
  });
  Option.match(shown, {
    onNone: () => {},
    onSome: (message) => render(message),
  });
}
```

Replace a whole plan snapshot, and keep the previous one on a refusal:

```ts
import { Option } from 'effect';
import { replaceSnapshot, type PlanSnapshot } from '@jambudipa/presentation';

const { snapshot, error } = replaceSnapshot(current, next);
// `snapshot` is `next` when it validated, and `current` when it did not.
if (Option.isSome(error)) {
  log(error.value.rejection); // for example 'stale-revision'
}
```

The projections take the host's event type as a type parameter.
`projectBrowserPresentation(projection, event)` runs a host projection and
admits its output only when it satisfies the V1 contract.

## Two contracts, deliberately side by side

The **V1** modules — `json-value`, `interactions`, `messages`,
`presentation-projection` — describe what a _renderer_ receives. They are
hand-written structural guards over `unknown`, they accept only `version: '1'`,
and they are strict about shape because the input is untrusted.

The **T5** modules — `rich-content`, `agent-plan`, `session-information`,
`usage` — describe what a _host_ exchanges with a peer and what a session
publishes. They take typed values, return `Option.Option<…Error>` from
validators, and refuse with a `Data.TaggedError`.

The two overlap in subject and not in job. Do not unify them; add to whichever
side the new value belongs on.

## Contract rules

**Whole snapshots, never deltas.** The plan, the session information and the
usage totals each replace the entire value and carry a `revision`. A client that
missed one delta would show state that never existed and have no way to detect
it. A refused update returns the _previous_ snapshot alongside the error, so a
caller that ignores the error still holds something that once validated.

**A refusal is a value.** `Option.none()` means valid; `Option.some(error)`
means refused. No validator throws. The two decoders in
`presentation-projection.ts` are wrapped in `Result.try` at every call site, so
a failure surfaces as `None`. `snapshotBytes` assumes an entry that has been
through `validateSnapshot`, which is why `validateSnapshot` calls it last.
Validate, then measure.

**Absent is not empty.** `Option.none()` stands for an unstated title, an
unreported cost, an undeclared MIME type. Never substitute a default a person
would read as a fact — "£0.12" and "£0.12 of an unknown larger amount" are
different claims, and `costComplete` exists to keep them apart.

**A guard must not run foreign code.** Anything reading untrusted input reads
property _descriptors_, not properties, so a getter is refused rather than
invoked, and a symbol-keyed or non-enumerable property is refused rather than
smuggled past `Object.keys`. Cycle detection uses a native identity `Set`,
because `HashSet` computes a structural hash that enumerates the value. A scoped
exception in the root `eslint.config.mjs` records this.

**An unexpected key is refused, not ignored.** Dropping it would let a field
nobody validated travel onward as though it had been checked.

**Every limit is UTF-8 bytes**, never `String.length`. Every module measures
with `TextEncoder`.

## Known defect D7

`JsonValueV1Schema` and `isJsonValueV1` disagree. The guard rejects a `Date`, a
`Map` and a `Set`; the schema built from that guard accepts all three and
decodes each to `{}`. Its union's `Schema.Record(Schema.String, …)` member
matches any object, and those three have no own enumerable string keys, so the
trailing check runs against an already-decoded `{}` and never sees the original
value. A timestamp crossing this boundary silently becomes an empty object.

The port keeps the defect unchanged. Three `DEFECT:` tests in
`test/json-value.test.ts` fence it. Fix it alone, and rewrite those tests in the
same commit.

## Differences from jam-flow

- `json-value.ts` is the module itself, not a re-export of
  `@jambudipa/flow-events/json-value`.
- `BrowserPresentationProjection` and `CustomBrowserPresentationProjection` take
  the event type as a type parameter (default `unknown`), in place of jam-flow's
  `EventEnvelope`. `projectBrowserPresentation` infers it.
- The T5 modules count bytes with `TextEncoder`, not `Buffer.byteLength`. The
  counts are the same.
- The exhaustive check in `validateBlock` ends in `absurd` from `effect`, not in
  jam-flow's `failUnclassified`. The branch stays unreachable and a forged kind
  stays a defect.

## License

MIT
