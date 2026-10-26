/**
 * The bounded JSON value — how untrusted JSON becomes trusted state.
 *
 * Ported unchanged from jam-flow's `packages/events/src/json-value/index.ts`
 * at commit `4f8dafdf`, where it is `@jambudipa/flow-events/json-value`. In this
 * package it is the module's own declaration, not a re-export. The history
 * below describes its place in jam-flow.
 *
 * `JsonValueV1Schema` is the one schema an arbitrary value is decoded through
 * before anything downstream treats it as data. Everything else in this module
 * exists to serve it: the recorded bounds, the recursive guard that enforces
 * them, and the structural union the guard is attached to as a check.
 *
 * The whole module moved as one unit, unchanged. `JsonValueV1Schema` is four
 * lines that cannot be lifted on their own — they name a module-private union
 * that names itself twice through `Schema.suspend`, and that union is checked
 * by a guard that reads the recorded limits and returns the exported type. Any
 * smaller cut would have left half the definition behind and duplicated the
 * other half, and a second copy of a security boundary is the failure mode this
 * repository has already paid for once, in redaction.
 *
 * ## Why it is here and not above
 *
 * It was declared in the presentation layer, layer 5 of the package above. Two
 * kinds of consumer reached upwards for it. The event envelope types its
 * payload with it and the projection presets type three fields with it, and
 * both now sit below that package. And `core/types/core.ts` — layer 1, the
 * lowest layer there is — imported it from layer 5, which is the layer order
 * running backwards. The move settles both: the schema is declared beneath
 * every one of its consumers, and the presentation file that used to declare it
 * re-exports it, so all forty-odd consumers above keep the import they have.
 *
 * TSN-01 — this is a security boundary, so the move had to be behaviour-exact
 * rather than merely equivalent. The bounds keep their values, the guard
 * refuses what it refused, `null`, `{}` and `[]` decode as they did, and a
 * failure carries the message it carried. `verify-spec-S3.spec.ts` pins each of
 * those against the recorded before-state rather than against a re-reading of
 * this file.
 *
 * ## One guard, more than one budget
 *
 * The guard now reads its three numbers from a `JsonValueBoundsV1` passed down
 * the traversal, rather than from `JsonValueV1Limits` directly, and
 * `makeBoundedJsonValueSchema` builds a schema for any such budget.
 * `JsonValueV1Limits` and `JsonValueV1Schema` are unchanged in value and in
 * behaviour: they are simply the presentation boundary's call to the general
 * form. The event envelope is the second caller, with a budget sized for a run
 * directory rather than for a screen — measured, because one real prompt is
 * about 50 KB and the presentation bound is 64 KiB, so a prompt AND its result
 * did not fit. Raising the presentation bound to make room would have widened a
 * security contract as a side effect; a second copy of the guard would have
 * duplicated a security boundary, which this repository has already paid for
 * once, in redaction. Parameterising it costs neither.
 *
 * ## Naming the packages above
 *
 * Nothing under this package's `src` may name either package above it, and the
 * sweep in `verify-spec-S1.spec.ts` reads every file here as text — so a
 * mention inside a comment fails it exactly as an import would. That is why the
 * prose above says "the package above" and names folders rather than published
 * specifiers. The sweep being that blunt is what makes it worth having.
 */

import { Chunk, HashSet, Option, Predicate, Schema } from 'effect';

/**
 * The three numbers a bounded JSON check reads: the SHAPE of a budget, not a budget.
 *
 * Declared so that more than one boundary can state its own bounds and still be checked by
 * the one guard below. `JsonValueV1Limits` is the presentation boundary's set; a value on its
 * way to a file in a run directory is not a presentation value and carries a different one.
 * The alternative — raising these numbers so that every boundary shares the largest — widens
 * a security contract as a side effect of an unrelated change, and a second copy of the guard
 * duplicates a security boundary, which is the failure mode this repository has already paid
 * for once, in redaction.
 */
export interface JsonValueBoundsV1 {
  /** The deepest nesting level admitted. A value nested past it is refused, not truncated. */
  readonly maxDepth: number;
  /** The total number of members admitted across the whole value, not per level. */
  readonly maxEntries: number;
  /** The largest encoded size admitted, in UTF-8 bytes. */
  readonly maxUtf8Bytes: number;
}

/** The versioned bounds for JSON values that may cross a presentation boundary. */
export const JsonValueV1Limits = Object.freeze({
  maxDepth: 16,
  maxEntries: 1_000,
  maxUtf8Bytes: 64 * 1024,
});
/**
 * Defines the json primitive v1 contract that crosses the public Flow boundary.
 *
 * @remarks Consumers rely on the declared structure and invariants at compile time and at its documented runtime boundaries.
 * @contractSignature 2c5778d36e28be4a
 */
export type JsonPrimitiveV1 = null | boolean | number | string;
/**
 * Defines the json array v1 contract that crosses the public Flow boundary.
 *
 * @remarks Consumers rely on the declared structure and invariants at compile time and at its documented runtime boundaries.
 * @contractSignature 4ba5de7809cf119c
 */
export type JsonArrayV1 = readonly JsonValueV1[];
/**
 * Defines the json object v1 contract that crosses the public Flow boundary.
 *
 * @remarks Consumers rely on the declared structure and invariants at compile time and at its documented runtime boundaries.
 * @contractSignature 65f2a07f761734e0
 */
export interface JsonObjectV1 {
  readonly [key: string]: JsonValueV1;
}
/**
 * Defines the json value v1 contract that crosses the public Flow boundary.
 *
 * @remarks Consumers rely on the declared structure and invariants at compile time and at its documented runtime boundaries.
 * @contractSignature a92b2d260697514f
 */
export type JsonValueV1 = JsonPrimitiveV1 | JsonArrayV1 | JsonObjectV1;

/**
 * Own keys that make a value inadmissible, whatever it holds.
 *
 * These names are rejected on the way IN rather than stripped later. A consumer that rebuilds
 * an object from this JSON — `Object.assign`, a spread into a fresh literal, a merge — would
 * otherwise reattach the prototype chain the guard exists to keep out.
 */
const forbiddenPrototypeKeys = HashSet.fromIterable([
  '__proto__',
  'prototype',
  'constructor',
]);
/** One shared encoder: `TextEncoder` is stateless, and every byte count here must agree. */
const encoder = new TextEncoder();
/**
 * The measurement encoder — `JSON.stringify` behind an Effect Schema.
 *
 * Only ever applied to a value the recursive guard has already accepted, so it cannot throw on
 * a cycle and cannot reach a getter.
 */
const encodeJson = Schema.encodeUnknownSync(
  Schema.fromJsonString(Schema.Unknown)
);

/**
 * The values of an array that is genuinely a plain array, read without invoking anything.
 *
 * `None` means the value is not one: an `Array` subclass, an array carrying an extra own key,
 * a sparse or accessor-backed index, a symbol key, or a length beyond `bounds.maxEntries`.
 * Every index is read through its property descriptor, so an index defined as a getter is
 * refused rather than called — a hostile getter must never run while the guard is still
 * deciding whether to trust the value.
 *
 * @param value - The array-shaped value to read.
 * @param bounds - The budget in force for this traversal.
 */
const safeArrayValues = (
  value: readonly unknown[],
  bounds: JsonValueBoundsV1
): Option.Option<Chunk.Chunk<unknown>> => {
  if (Object.getPrototypeOf(value) !== Array.prototype) return Option.none();

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== 'string')) return Option.none();

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  const length = lengthDescriptor?.value;
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > bounds.maxEntries ||
    ownKeys.length !== length + 1
  ) {
    return Option.none();
  }

  let values = Chunk.empty<unknown>();
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor?.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      return Option.none();
    }
    values = Chunk.append(values, descriptor.value);
  }
  return Option.some(values);
};

/**
 * A `{}` or a null-prototype object whose own properties are all readable data properties.
 *
 * Anything with a class prototype fails, which is what keeps a `Date`, a `Map` and a `Set` out
 * of `isJsonValueV1`. Getters, symbol keys and non-enumerable keys fail too, so no foreign
 * code runs and no hidden property escapes the depth and entry budgets.
 */
const isPlainRecord = (
  value: unknown
): value is Readonly<Record<string, unknown>> => {
  if (!Predicate.isObject(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  if (
    prototype !== Object.prototype &&
    Option.isSome(Option.fromNullishOr(prototype))
  ) {
    return false;
  }

  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
    );
  });
};

/**
 * The recursive core of `isJsonValueV1`: structure, depth, entry count and cycles in one pass.
 *
 * `entries` is a mutable counter shared across the whole traversal, not per level — the budget
 * is on the total number of members in the value, so a wide-and-shallow value cannot slip past
 * a per-level check. `visiting` holds the objects on the ACTIVE path only, so a cycle is
 * refused while the same object reached twice by different paths is accepted: a diamond is
 * legitimate JSON, an infinite one is not.
 *
 * A caller starts at depth 0 with a zero count and an empty path.
 *
 * `bounds` is passed down rather than read from a module constant, so the same traversal
 * serves every boundary that states its own budget. It is the same value at every level: a
 * budget that changed as the walk descended would be unstatable.
 */
const isJsonValueAtDepth = (
  value: unknown,
  depth: number,
  entries: { count: number },
  bounds: JsonValueBoundsV1,
  // A native (identity-based) Set, not HashSet: HashSet.has/add compute a
  // structural Hash.hash() of the candidate, which for a plain array or
  // object enumerates and reads its own properties — invoking a malicious
  // getter before this guard ever reaches the descriptor-based checks below
  // that are supposed to reject it unread. Cycle detection also only ever
  // needs reference identity, never structural equality, so Set is the
  // semantically correct choice here too.
  visiting: ReadonlySet<object>
): value is JsonValueV1 => {
  if (depth > bounds.maxDepth) return false;

  if (typeof value === 'boolean' || typeof value === 'string') {
    return true;
  }

  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  const presentValue = Option.fromNullishOr(value);
  if (Option.isNone(presentValue)) return true;
  const objectValue = presentValue.value;
  if (visiting.has(objectValue)) return false;

  // A native `Set`, by a scoped exception in `eslint.config.mjs`: identity semantics are required here. HashSet computes a structural hash, which enumerates the value and would invoke exactly the getters these guards exist to avoid.
  const activePath = new Set(visiting).add(objectValue);

  if (Array.isArray(objectValue)) {
    const values = safeArrayValues(objectValue, bounds);
    if (Option.isNone(values)) return false;
    for (const child of values.value) {
      entries.count += 1;
      if (entries.count > bounds.maxEntries) return false;
      if (!isJsonValueAtDepth(child, depth + 1, entries, bounds, activePath))
        return false;
    }
    return true;
  }

  if (!isPlainRecord(objectValue)) return false;

  for (const key of Object.keys(objectValue)) {
    if (HashSet.has(forbiddenPrototypeKeys, key)) return false;
    entries.count += 1;
    if (entries.count > bounds.maxEntries) return false;
    if (
      !isJsonValueAtDepth(
        objectValue[key],
        depth + 1,
        entries,
        bounds,
        activePath
      )
    )
      return false;
  }

  return true;
};

/**
 * Returns whether a value is a JSON value within the GIVEN bounds.
 *
 * The whole of the check, in the order it has always run: the structural and cycle guard
 * first, then the byte measurement, which is only ever applied to a value the guard has
 * already accepted and therefore cannot throw on a cycle or reach a getter.
 *
 * Every boundary that admits untrusted JSON calls this with its own budget.
 * {@link isJsonValueV1} is the presentation boundary's call.
 *
 * @param value - The untrusted value.
 * @param bounds - The budget the value must fit.
 */
export const isJsonValueWithin = (
  value: unknown,
  bounds: JsonValueBoundsV1
): value is JsonValueV1 => {
  if (
    // A native `Set`, by the same scoped exception: identity semantics, as above: this set holds object references for cycle detection, not values to compare structurally.
    !isJsonValueAtDepth(value, 0, { count: 0 }, bounds, new Set())
  )
    return false;

  return encoder.encode(encodeJson(value)).byteLength <= bounds.maxUtf8Bytes;
};

/**
 * Returns whether a value is a JSON value within the normative V1 bounds.
 *
 * The presentation boundary's call to {@link isJsonValueWithin}, and nothing more. The block
 * body is kept rather than shortened to an expression: `verify-spec-S3.spec.ts` pins this
 * declaration's exact opening line as the proof that the guard is declared HERE and not
 * copied, and a copy of a security boundary is what that pin exists to catch.
 */
export const isJsonValueV1 = (value: unknown): value is JsonValueV1 => {
  return isJsonValueWithin(value, JsonValueV1Limits);
};

// The whole definition used to be wrapped in one outer `Schema.suspend(() => ...)`
// (needed so the self-references below don't run before this const is assigned).
// In v4 that leaves `JsonValueV1BaseSchema`'s own AST as a `Suspend` node, and
// `Schema.check` (below, via JsonValueV1Schema) cannot attach a check to a
// Suspend node — it throws "Cannot add checks to Suspend" at runtime. Suspending
// only the two recursive self-references (inside Array/Record) still breaks the
// TDZ cycle, while leaving this binding's own AST a concrete Union that a check
// can attach to.
/**
 * The structural union `JsonValueV1Schema` attaches its bounds check to.
 *
 * Structure only — it enforces no depth, entry or byte budget, so it must never be exported or
 * used directly at a boundary. Its `Record` member matches ANY object, which is the mechanism
 * behind defect D7: a `Date`, `Map` or `Set` decodes here to `{}` before the check that would
 * have rejected it ever sees the original value.
 */
const JsonValueV1BaseSchema: Schema.Codec<JsonValueV1> = Schema.Union([
  Schema.Null,
  Schema.Boolean,
  Schema.Finite,
  Schema.String,
  Schema.Array(Schema.suspend(() => JsonValueV1BaseSchema)),
  Schema.Record(
    Schema.String,
    Schema.suspend(() => JsonValueV1BaseSchema)
  ),
]);

/**
 * Builds the strict schema for one boundary's budget: the structural union above, with that
 * budget's check attached to it.
 *
 * One base union serves every budget, because the union carries no bounds at all — the bounds
 * live entirely in the check, and a check is what `Schema.check` attaches. So a second
 * boundary costs a call rather than a second copy of the guard.
 *
 * @param bounds - The budget the returned schema admits values within.
 * @returns A codec that decodes a JSON value and refuses one outside `bounds`.
 */
export const makeBoundedJsonValueSchema = (
  bounds: JsonValueBoundsV1
): Schema.Codec<JsonValueV1> =>
  JsonValueV1BaseSchema.pipe(
    Schema.check(
      Schema.makeFilter<JsonValueV1>((value) =>
        isJsonValueWithin(value, bounds)
      )
    )
  );

/** Strict Effect Schema for browser-safe, bounded JSON. */
export const JsonValueV1Schema: Schema.Codec<JsonValueV1> =
  makeBoundedJsonValueSchema(JsonValueV1Limits);

/** Measures JSON after the same validation used at the presentation boundary. */
export const jsonValueV1Utf8Bytes = (value: JsonValueV1): number =>
  encoder.encode(encodeJson(value)).byteLength;
/**
 * Checks whether an input satisfies the is utf8 string within contract.
 *
 * @remarks The implementation preserves its declared result, expected failure, and service requirement types.
 * @param value - The declared value input.
 * @param maximumBytes - The declared maximum bytes input.
 * @returns The declared public result, including precise Effect channels when the result is effectful.
 * @contractSignature 1cc4dfdec4aa4dde
 */
export const isUtf8StringWithin = (
  value: unknown,
  maximumBytes: number
): value is string =>
  typeof value === 'string' && encoder.encode(value).byteLength <= maximumBytes;
/**
 * Checks whether an input satisfies the is opaque identifier v1 contract.
 *
 * @remarks The implementation preserves its declared result, expected failure, and service requirement types.
 * @param value - The declared value input.
 * @returns The declared public result, including precise Effect channels when the result is effectful.
 * @contractSignature 91d1bcc0182b9ffa
 */
export const isOpaqueIdentifierV1 = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
