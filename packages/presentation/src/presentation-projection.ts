import { Result, HashSet, Option, Predicate, Schema } from 'effect';
import {
  PresentationMessageV1Kinds,
  PresentationMessageV1Schema,
  type PresentationMessageKindV1,
  type PresentationMessageV1,
} from './messages.js';

/** Strict, versioned declaration of the message kinds a browser can render. */
export interface PresentationCapabilitiesV1 {
  /** Always `'1'`. A declaration at another version is refused, so nothing is assumed. */
  readonly version: '1';
  /**
   * Exactly what this browser renders. A kind that is absent is unsupported, not unknown.
   *
   * Must contain no duplicates and no kind outside `PresentationMessageV1Kinds`; a declaration
   * that names something Flow cannot produce is a client bug, and is refused rather than
   * silently ignored.
   */
  readonly messageKinds: readonly PresentationMessageKindV1[];
}

/** The declared kinds as a set, so capability checking is not a linear scan per message. */
const messageKinds = HashSet.fromIterable(PresentationMessageV1Kinds);

/**
 * Validates a capability declaration arriving from a browser.
 *
 * Strict on shape — exactly two keys, no extras — because this value decides what a person is
 * shown. An over-permissive declaration would let a message through that the renderer cannot
 * draw; an unrecognised key might be the client's real intent, and guessing is not an option
 * at this boundary.
 */
const isCapabilities = (
  value: unknown
): value is PresentationCapabilitiesV1 => {
  if (!Predicate.isObject(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (
    Reflect.ownKeys(value).length !== keys.length ||
    keys.length !== 2 ||
    !Object.hasOwn(value, 'version') ||
    !Object.hasOwn(value, 'messageKinds')
  ) {
    return false;
  }
  const candidate = value;
  if (candidate.version !== '1' || !Array.isArray(candidate.messageKinds)) {
    return false;
  }
  const kinds = candidate.messageKinds;
  return (
    kinds.length <= PresentationMessageV1Kinds.length &&
    kinds.every(
      (kind) => typeof kind === 'string' && HashSet.has(messageKinds, kind)
    ) &&
    HashSet.size(HashSet.fromIterable(kinds)) === kinds.length
  );
};
/**
 * Defines the presentation capabilities v1 schema contract that crosses the public Flow boundary.
 *
 * @remarks Consumers rely on the declared structure and invariants at compile time and at its documented runtime boundaries.
 * @contractSignature 9964916daa73e8e1
 */
export const PresentationCapabilitiesV1Schema: Schema.Codec<PresentationCapabilitiesV1> =
  Schema.declare<PresentationCapabilitiesV1>(isCapabilities);

/**
 * A browser projection may only return a strict presentation message. The
 * built-in projection is intentionally silent because event payloads
 * are generic, untrusted and may contain implementation details.
 *
 * `Event` is the host's event type. This package does not define one: the
 * projections only pass it through, so a host supplies its own envelope.
 */
export type BrowserPresentationProjection<Event = unknown> = (
  event: Event
) => Option.Option<PresentationMessageV1>;

/** Conservative built-in projection: raw Flow events are never browser output. */
export const BrowserPresentationProjection: BrowserPresentationProjection =
  () => Option.none();

/** A host seam whose unknown output is checked before it can be retained or rendered. */
export type CustomBrowserPresentationProjection<Event = unknown> = (
  event: Event
) => unknown;

/**
 * THROWS on invalid input. Every call site wraps it in `Result.try`, which is how a rejection
 * becomes the `None` this module's callers handle.
 */
const decodePresentationMessage = Schema.decodeUnknownSync(
  PresentationMessageV1Schema
);
/** Throws on an invalid declaration, wrapped the same way as the message decoder above. */
const decodeCapabilities = Schema.decodeUnknownSync(
  PresentationCapabilitiesV1Schema
);

/**
 * Applies a capability set recursively to a message that has ALREADY validated.
 *
 * Three outcomes, and the difference between the last two matters: a supported message passes
 * through; an unsupported one is silenced; and a group whose children were ALL silenced is
 * silenced too, rather than sent as an empty group. An empty group reads to a person as "this
 * section is finished and had nothing in it", which would be a lie. A group that arrived empty
 * is kept — it really was empty.
 *
 * A group is also silenced when its OWN kind is unsupported, whatever its children hold.
 */
const downgradeValidatedMessage = (
  message: PresentationMessageV1,
  supportedKinds: HashSet.HashSet<PresentationMessageKindV1>
): Option.Option<PresentationMessageV1> => {
  if (!HashSet.has(supportedKinds, message.kind)) return Option.none();
  if (message.kind !== 'group') return Option.some(message);

  const children = message.children.flatMap((child) => {
    const downgraded = downgradeValidatedMessage(child, supportedKinds);
    return Option.match(downgraded, {
      onNone: () => [],
      onSome: (value) => [value],
    });
  });
  if (message.children.length > 0 && children.length === 0)
    return Option.none();
  return Option.some({ ...message, children });
};

/**
 * Applies a strict capability set recursively. Unsupported messages are
 * silenced; a transformed value is admitted only after full schema validation.
 */
export const downgradePresentationMessageV1 = (
  message: unknown,
  capabilities: unknown
): Option.Option<PresentationMessageV1> =>
  // `None` covers both ways this can decline: the input did not decode, or the capability set
  // silences the message. Neither is an error, and a caller has one case to handle.
  Option.flatMap(
    Result.getSuccess(
      Result.try(() => ({
        decodedMessage: decodePresentationMessage(message),
        decodedCapabilities: decodeCapabilities(capabilities),
      }))
    ),
    ({ decodedMessage, decodedCapabilities }) =>
      Option.flatMap(
        downgradeValidatedMessage(
          decodedMessage,
          HashSet.fromIterable(decodedCapabilities.messageKinds)
        ),
        (downgraded) =>
          Result.getSuccess(
            Result.try(() => decodePresentationMessage(downgraded))
          )
      )
  );

/**
 * Invokes a host projection and returns a presentation message only if its
 * complete output satisfies the strict V1 contract. Projection errors and
 * malformed output are deliberately silent at this boundary.
 */
export const projectBrowserPresentation = <Event>(
  projection: CustomBrowserPresentationProjection<Event>,
  event: Event
): Option.Option<PresentationMessageV1> =>
  // A host projection that throws, or returns something outside the V1 contract, is silenced
  // here by design — `None` says that without a caught exception standing in for it.
  Result.getSuccess(
    Result.try(() => decodePresentationMessage(projection(event)))
  );
