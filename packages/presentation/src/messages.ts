import { Option, Predicate, Schema } from 'effect';
import {
  JsonValueV1Limits,
  isJsonValueV1,
  isOpaqueIdentifierV1,
  isUtf8StringWithin,
  type JsonValueV1,
} from './json-value.js';
import {
  isUserInteractionRequestV1,
  type UserInteractionRequestV1,
} from './interactions.js';

/**
 * The only `version` these guards accept, on a message and on the record that wraps it.
 *
 * A later version is rejected, not read leniently. A renderer that accepted an unknown version
 * would be guessing what its fields mean on behalf of the person reading the screen.
 */
const presentationVersion = '1';

/** Normative V1 limits for presentation messages and records. */
export const PresentationV1Limits = Object.freeze({
  maxMessageTextUtf8Bytes: JsonValueV1Limits.maxUtf8Bytes,
  maxGroupDepth: 16,
  maxGroupChildren: 100,
  maxGroupUtf8Bytes: 64 * 1024,
});
/**
 * Defines the presentation message v1 kinds contract that crosses the public Flow boundary.
 *
 * @remarks Consumers rely on the declared structure and invariants at compile time and at its documented runtime boundaries.
 * @contractSignature b4601e77b5c60488
 */
export const PresentationMessageV1Kinds = Object.freeze([
  'text',
  'status',
  'card',
  'metric',
  'trace',
  'state',
  'group',
  'interaction',
  'result',
] as const);
/**
 * Defines the presentation message kind v1 contract that crosses the public Flow boundary.
 *
 * @remarks Consumers rely on the declared structure and invariants at compile time and at its documented runtime boundaries.
 * @contractSignature 2b1e8452c9e43873
 */
export type PresentationMessageKindV1 =
  (typeof PresentationMessageV1Kinds)[number];
/**
 * Defines the presentation correlation v1 contract that crosses the public Flow boundary.
 *
 * @remarks Consumers rely on the declared structure and invariants at compile time and at its documented runtime boundaries.
 * @contractSignature 2b5493a5b9c1624e
 */
export interface PresentationCorrelationV1 {
  /**
   * The Flow this message came from.
   *
   * Every field here is an opaque identifier: the guard accepts `[A-Za-z0-9_-]{1,128}` and
   * nothing else, so a human-readable name containing a space is refused. An absent field is
   * "not correlated"; there is no empty-string form.
   */
  readonly flowId?: string;
  /** The step within that Flow. */
  readonly stepId?: string;
  /** The Prompt Turn this message belongs to. */
  readonly turnId?: string;
  /** The Session, which outlives any one turn. */
  readonly sessionId?: string;
  /** The branch, when the execution forked. */
  readonly branchId?: string;
}
/**
 * Defines the presentation message v1 contract that crosses the public Flow boundary.
 *
 * @remarks Consumers rely on the declared structure and invariants at compile time and at its documented runtime boundaries.
 * @contractSignature 978dd0e725073300
 */
export type PresentationMessageV1 =
  | { readonly version: '1'; readonly kind: 'text'; readonly text: string }
  | {
      readonly version: '1';
      readonly kind: 'status';
      readonly status:
        | 'queued'
        | 'running'
        | 'waiting'
        | 'completed'
        | 'failed'
        | 'cancelled'
        | 'interrupted';
      readonly detail?: string;
    }
  | {
      readonly version: '1';
      readonly kind: 'card';
      readonly title: string;
      readonly body: string;
    }
  | {
      readonly version: '1';
      readonly kind: 'metric';
      readonly name: string;
      readonly value: number;
      readonly unit?: string;
    }
  | {
      readonly version: '1';
      readonly kind: 'trace';
      readonly name: string;
      readonly depth: number;
      readonly durationMs?: number;
    }
  | {
      readonly version: '1';
      readonly kind: 'state';
      readonly key: string;
      readonly value: JsonValueV1;
    }
  | {
      readonly version: '1';
      readonly kind: 'group';
      readonly label: string;
      readonly children: readonly PresentationMessageV1[];
    }
  | {
      readonly version: '1';
      readonly kind: 'interaction';
      readonly request: UserInteractionRequestV1;
    }
  | {
      readonly version: '1';
      readonly kind: 'result';
      readonly outcome:
        'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'unavailable';
      readonly value?: JsonValueV1;
      readonly summary?: string;
    };
/**
 * Defines the presentation record v1 contract that crosses the public Flow boundary.
 *
 * @remarks Consumers rely on the declared structure and invariants at compile time and at its documented runtime boundaries.
 * @contractSignature 7b613072bb36d8ca
 */
export interface PresentationRecordV1 {
  /** Always `'1'`. A record whose version differs is refused, not upgraded. */
  readonly version: '1';
  /** Opaque identity of this record, unique within its execution. */
  readonly messageId: string;
  /** The execution that produced it. */
  readonly executionId: string;
  /**
   * Position within the execution, ONE-based.
   *
   * Zero is refused, so a client can use "no sequence yet" and "the first record" as
   * distinct states without a sentinel.
   */
  readonly sequence: number;
  /** Epoch milliseconds. Zero is accepted — it is a real instant, not a missing one. */
  readonly atEpochMs: number;
  /** Absent when nothing correlates this record. An empty object is also valid. */
  readonly correlation?: PresentationCorrelationV1;
  /** The message itself, validated in full before the record is accepted. */
  readonly message: PresentationMessageV1;
}

/** One shared encoder, so every byte count in this module agrees with every other. */
const encoder = new TextEncoder();
/** `JSON.stringify` behind a Schema, used only to measure a group's encoded size. */
const encodeJson = Schema.encodeUnknownSync(
  Schema.fromJsonString(Schema.Unknown)
);

/**
 * Any non-null object.
 *
 * Deliberately looser than the `isRecord` in `json-value.ts`, which rejects class instances
 * and accessor properties. It can be: nothing here reads an arbitrary key. `hasExactKeys` is
 * the guard that constrains shape, and it compares `Reflect.ownKeys` against `Object.keys`, so
 * a symbol-keyed or non-enumerable property is still refused. Values that need the strict
 * treatment — anything reaching `isJsonValueV1` — get it from that module.
 */
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Predicate.isObject(value);

/**
 * True when the key is absent, or present as a data property whose value is valid.
 *
 * Reads the property descriptor rather than the property, so an optional field defined as a
 * getter is refused instead of invoked.
 */
const hasOptionalField = (
  value: Readonly<Record<string, unknown>>,
  key: string,
  isValid: (candidate: unknown) => boolean
): boolean =>
  Option.match(
    Option.fromNullishOr(Object.getOwnPropertyDescriptor(value, key)),
    {
      onNone: () => true,
      onSome: (descriptor) =>
        Object.hasOwn(descriptor, 'value') && isValid(descriptor.value),
    }
  );

/**
 * Exactly the declared keys, and only own enumerable string ones.
 *
 * The `Reflect.ownKeys` comparison is what rejects a symbol-keyed or non-enumerable property:
 * such a key is invisible to `Object.keys`, so without this test it would ride along unchecked
 * into whatever a host does with the message.
 *
 * An unexpected key is refused rather than dropped. This layer is the wire format, and
 * accepting a field nobody validated would let it reach a renderer as though it had been.
 */
const hasExactKeys = (
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): value is Readonly<Record<string, unknown>> => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (Reflect.ownKeys(value).length !== keys.length) return false;
  if (!required.every((key) => Object.hasOwn(value, key))) return false;
  return keys.every((key) => required.includes(key) || optional.includes(key));
};

/** A count or epoch value that is exact and not negative — a depth, a sequence, a timestamp. */
const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * Every correlation field is optional, so an empty object is valid — but any field that IS
 * present must be an opaque identifier.
 *
 * `Object.values` covers whatever keys survived `hasExactKeys`, so an explicitly-set
 * `undefined` fails: state a correlation or omit the key, never both.
 */
const isCorrelation = (value: unknown): value is PresentationCorrelationV1 =>
  hasExactKeys(
    value,
    [],
    ['flowId', 'stepId', 'turnId', 'sessionId', 'branchId']
  ) && Object.values(value).every(isOpaqueIdentifierV1);

/**
 * Validates any message kind, carrying the nesting depth a `group` needs.
 *
 * Named for the only case that uses `depth`: every other kind ignores it. A caller starts at
 * depth 0; `isPresentationMessageV1` is that caller.
 *
 * A group is bounded three ways — depth, child count, and its own encoded byte size, measured
 * AFTER its children validate. The byte check is what stops many small legal groups combining
 * into one payload no client can hold.
 */
const isGroupAtDepth = (
  value: unknown,
  depth: number
): value is PresentationMessageV1 => {
  if (
    !isRecord(value) ||
    value.version !== presentationVersion ||
    typeof value.kind !== 'string'
  ) {
    return false;
  }

  switch (value.kind) {
    case 'text':
      return (
        hasExactKeys(value, ['version', 'kind', 'text']) &&
        isUtf8StringWithin(
          value.text,
          PresentationV1Limits.maxMessageTextUtf8Bytes
        )
      );
    case 'status':
      return (
        hasExactKeys(value, ['version', 'kind', 'status'], ['detail']) &&
        typeof value.status === 'string' &&
        [
          'queued',
          'running',
          'waiting',
          'completed',
          'failed',
          'cancelled',
          'interrupted',
        ].includes(value.status) &&
        hasOptionalField(value, 'detail', (detail) =>
          isUtf8StringWithin(
            detail,
            PresentationV1Limits.maxMessageTextUtf8Bytes
          )
        )
      );
    case 'card':
      return (
        hasExactKeys(value, ['version', 'kind', 'title', 'body']) &&
        isUtf8StringWithin(
          value.title,
          PresentationV1Limits.maxMessageTextUtf8Bytes
        ) &&
        isUtf8StringWithin(
          value.body,
          PresentationV1Limits.maxMessageTextUtf8Bytes
        )
      );
    case 'metric':
      return (
        hasExactKeys(value, ['version', 'kind', 'name', 'value'], ['unit']) &&
        isUtf8StringWithin(
          value.name,
          PresentationV1Limits.maxMessageTextUtf8Bytes
        ) &&
        typeof value.value === 'number' &&
        Number.isFinite(value.value) &&
        hasOptionalField(value, 'unit', (unit) =>
          isUtf8StringWithin(unit, PresentationV1Limits.maxMessageTextUtf8Bytes)
        )
      );
    case 'trace':
      return (
        hasExactKeys(
          value,
          ['version', 'kind', 'name', 'depth'],
          ['durationMs']
        ) &&
        isUtf8StringWithin(
          value.name,
          PresentationV1Limits.maxMessageTextUtf8Bytes
        ) &&
        isNonNegativeSafeInteger(value.depth) &&
        hasOptionalField(
          value,
          'durationMs',
          (durationMs) =>
            typeof durationMs === 'number' &&
            Number.isFinite(durationMs) &&
            durationMs >= 0
        )
      );
    case 'state':
      return (
        hasExactKeys(value, ['version', 'kind', 'key', 'value']) &&
        isUtf8StringWithin(
          value.key,
          PresentationV1Limits.maxMessageTextUtf8Bytes
        ) &&
        isJsonValueV1(value.value)
      );
    case 'group': {
      if (
        depth >= PresentationV1Limits.maxGroupDepth ||
        !hasExactKeys(value, ['version', 'kind', 'label', 'children']) ||
        !isUtf8StringWithin(
          value.label,
          PresentationV1Limits.maxMessageTextUtf8Bytes
        ) ||
        !Array.isArray(value.children) ||
        value.children.length > PresentationV1Limits.maxGroupChildren ||
        !value.children.every((child) => isGroupAtDepth(child, depth + 1))
      ) {
        return false;
      }
      return (
        encoder.encode(encodeJson(value)).byteLength <=
        PresentationV1Limits.maxGroupUtf8Bytes
      );
    }
    case 'interaction':
      return (
        hasExactKeys(value, ['version', 'kind', 'request']) &&
        isUserInteractionRequestV1(value.request)
      );
    case 'result':
      return (
        hasExactKeys(
          value,
          ['version', 'kind', 'outcome'],
          ['value', 'summary']
        ) &&
        typeof value.outcome === 'string' &&
        [
          'succeeded',
          'failed',
          'cancelled',
          'interrupted',
          'unavailable',
        ].includes(value.outcome) &&
        hasOptionalField(value, 'value', isJsonValueV1) &&
        hasOptionalField(value, 'summary', (summary) =>
          isUtf8StringWithin(
            summary,
            PresentationV1Limits.maxMessageTextUtf8Bytes
          )
        )
      );
    default:
      return false;
  }
};
/**
 * Checks whether an input satisfies the is presentation message v1 contract.
 *
 * @remarks The implementation preserves its declared result, expected failure, and service requirement types.
 * @param value - The declared value input.
 * @returns The declared public result, including precise Effect channels when the result is effectful.
 * @contractSignature b63f405ef4628b2d
 */
export const isPresentationMessageV1 = (
  value: unknown
): value is PresentationMessageV1 => isGroupAtDepth(value, 0);
/**
 * Checks whether an input satisfies the is presentation record v1 contract.
 *
 * @remarks The implementation preserves its declared result, expected failure, and service requirement types.
 * @param value - The declared value input.
 * @returns The declared public result, including precise Effect channels when the result is effectful.
 * @contractSignature 5294c19abf3bb459
 */
export const isPresentationRecordV1 = (
  value: unknown
): value is PresentationRecordV1 =>
  hasExactKeys(
    value,
    ['version', 'messageId', 'executionId', 'sequence', 'atEpochMs', 'message'],
    ['correlation']
  ) &&
  value.version === presentationVersion &&
  isOpaqueIdentifierV1(value.messageId) &&
  isOpaqueIdentifierV1(value.executionId) &&
  isNonNegativeSafeInteger(value.sequence) &&
  value.sequence > 0 &&
  isNonNegativeSafeInteger(value.atEpochMs) &&
  hasOptionalField(value, 'correlation', isCorrelation) &&
  isPresentationMessageV1(value.message);
/**
 * Defines the presentation message v1 schema contract that crosses the public Flow boundary.
 *
 * @remarks Consumers rely on the declared structure and invariants at compile time and at its documented runtime boundaries.
 * @contractSignature d2207306fcb5fd29
 */
export const PresentationMessageV1Schema: Schema.Codec<PresentationMessageV1> =
  Schema.declare<PresentationMessageV1>(isPresentationMessageV1);
/**
 * Defines the presentation record v1 schema contract that crosses the public Flow boundary.
 *
 * @remarks Consumers rely on the declared structure and invariants at compile time and at its documented runtime boundaries.
 * @contractSignature ebee00ca50bcecd7
 */
export const PresentationRecordV1Schema: Schema.Codec<PresentationRecordV1> =
  Schema.declare<PresentationRecordV1>(isPresentationRecordV1);
