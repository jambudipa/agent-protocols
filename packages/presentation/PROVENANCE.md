# Source provenance and port decisions

Source: the local jam-flow Git repository, full commit
`4f8dafdfdc571fbd811b1685e329ae1d96e26b3e`.

The machine-readable [upstream-sources.json](upstream-sources.json) records SHA256
hashes for every inspected source module, representative fixture file and source
package manifest. The immutable tarball qualification records the full protocol
source commit separately because embedding a commit's own hash in its content
would create a circular identity.

| Upstream module                                             | Port                                                                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| `packages/flow/src/presentation/messages.ts`                | `src/wire/messages.ts`                                                  |
| `packages/flow/src/presentation/interactions.ts`            | `src/wire/interactions.ts`                                              |
| `packages/flow/src/presentation/presentation-projection.ts` | `src/wire/presentation-projection.ts` (capabilities and downgrade only) |
| `packages/events/src/json-value/index.ts`                   | `src/wire/json-value.ts` and `src/wire/safety.ts`                       |
| `packages/events/src/interaction/index.ts`                  | Local literal type in `src/wire/interactions.ts`                        |

The port preserves the source's V1 field names, discriminants, limits,
one-based sequence, epoch behavior, lifetime arithmetic, visible interaction
constraints, duplicate-choice behavior and recursive capability fallback.
The package replaces the source rc.112/flow-events dependencies with a pure data
boundary and a separate stable Effect 4.0.6 codec boundary.

## Deliberate deviations

1. Message and capability guards require inert plain records and dense plain
   arrays before reading fields. Some upstream message/capability guards read
   required properties directly and accept class instances. The stricter rule
   prevents accessor execution, prototype behavior, hidden fields and sparse
   group/capability arrays. Interaction/JSON source guards already used a similar
   policy. The port adds a bounded preflight traversal and incremental byte
   measurement to stop cycles and expansion work before grammar recursion.
2. The pure downgrade result is a message or `undefined`, rather than Effect
   `Option`. Its support/removal decisions match the inspected upstream tests.
   No callback projection or event-envelope API is exported.
3. The JSON schema uses `Schema.declare` over the original-value guard. Upstream
   `Schema.Record` transformed foreign objects into `{}` before checking them;
   its own tests label this as defect D7. The stable port rejects those objects.
4. A choice response's present `customText` must be a bounded string. Upstream's
   `Option.fromNullishOr` accepted present `null`/`undefined` despite its declared
   string type. The stricter inert-consumer policy rejects these values. The
   constraint function now validates both inputs before reading their fields.
5. The byte helper returns `Infinity` for inadmissible input instead of measuring
   arbitrary unchecked objects. General custom-budget schemas and JSON helpers
   outside the selected normative V1 surface are not exported.

The source message/interaction tests are ported as independent expectations,
with package import paths adapted and one unused destructured variable removed.
The additional test file ports representative source JSON and projection
fixtures and adds hardening cases. Tests for upstream defect D7 assert rejection
in this port. Unsupported host-event projection fixtures are not claimed.

## License provenance

The inspected flow and flow-events package manifests declare **ISC**. The source
root contains no LICENSE file at this commit. No source copyright notice was
present in the inspected modules. The port preserves that declaration and source
attribution. It makes no MIT ownership claim and invents no upstream copyright
holder. [LICENSE](LICENSE) records this qualification and the ISC permission text.
