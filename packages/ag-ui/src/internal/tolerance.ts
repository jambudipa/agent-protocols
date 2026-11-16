/**
 * The tolerance pass that runs on raw JSON before a schema decodes it.
 *
 * AG-UI asks a receiver to tolerate what a newer protocol adds. An unknown
 * key is dropped by the schema itself. An unknown member of a discriminated
 * union cannot be: the schema would reject it. So this pass removes such a
 * member first, as the reference client's enforcement stage does:
 *
 * - an element of a list whose tag is unknown leaves the list (a message with
 *   a new role, a content part of a new kind, a JSON Patch operation with a
 *   new `op`), and a media part whose source is of a new kind goes with it;
 * - an optional `outcome` whose `type` is unknown is removed.
 *
 * A wrong-typed value is never touched: the schema rejects it, which is
 * fatal by design. An array where an object belongs stays an error.
 *
 * @internal
 */
import { Predicate, Record } from 'effect';

/** A JSON object with unknown values. */
type Loose = { readonly [key: string]: unknown };

/** The roles of the `Message` union. */
const MESSAGE_ROLES: ReadonlyArray<unknown> = [
  'developer',
  'system',
  'assistant',
  'user',
  'tool',
  'activity',
  'reasoning',
];

/** The kinds of the `ContentPart` union. */
const PART_TYPES: ReadonlyArray<unknown> = [
  'text',
  'image',
  'audio',
  'video',
  'document',
];

/** The kinds of the `PartSource` union. */
const SOURCE_TYPES: ReadonlyArray<unknown> = ['data', 'url', 'file'];

/** The operations of RFC 6902. */
const PATCH_OPS: ReadonlyArray<unknown> = [
  'add',
  'remove',
  'replace',
  'move',
  'copy',
  'test',
];

/** The members of `RunFinishedOutcome`. */
const RUN_OUTCOMES: ReadonlyArray<unknown> = [
  'success',
  'interrupt',
  'cancelled',
];

/** The members of `SubagentFinishedOutcome`. */
const SUBAGENT_OUTCOMES: ReadonlyArray<unknown> = ['success', 'suspended'];

/**
 * Whether a list element is a known member of its union. A value that is not
 * an object is kept, for the schema to reject.
 */
const isKnown = (value: unknown, key: string, tags: ReadonlyArray<unknown>) =>
  !Predicate.isObject(value) || tags.includes(value[key]);

/** Whether a content part, and its source, are of known kinds. */
const isKnownPart = (part: unknown): boolean =>
  isKnown(part, 'type', PART_TYPES) &&
  (!Predicate.isObject(part) ||
    part['type'] === 'text' ||
    isKnown(part['source'], 'type', SOURCE_TYPES));

/** Filters an array, or leaves a value that is not an array alone. */
const keep = (value: unknown, predicate: (element: unknown) => boolean) =>
  Array.isArray(value) ? value.filter(predicate) : value;

/** Applies `f` to the value under `key` when the key is present. */
const update = (record: Loose, key: string, f: (value: unknown) => unknown) =>
  key in record ? { ...record, [key]: f(record[key]) } : record;

/** Strips content parts of unknown kinds from a `string | ContentPart[]`. */
const stripParts = (content: unknown) => keep(content, isKnownPart);

/** Strips one message: the parts of a user or tool message. */
const stripMessage = (message: unknown): unknown =>
  Predicate.isObject(message) &&
  (message['role'] === 'user' || message['role'] === 'tool')
    ? update(message, 'content', stripParts)
    : message;

/** Strips a message list: unknown roles leave, the rest are stripped. */
const stripMessages = (messages: unknown): unknown =>
  Array.isArray(messages)
    ? messages
        .filter((message) => isKnown(message, 'role', MESSAGE_ROLES))
        .map(stripMessage)
    : messages;

/** Strips a JSON Patch: operations with an unknown `op` leave. */
const stripPatch = (patch: unknown) =>
  keep(patch, (operation) => isKnown(operation, 'op', PATCH_OPS));

/** Removes an optional `outcome` whose `type` is unknown. */
const stripOutcome = (record: Loose, tags: ReadonlyArray<unknown>): Loose => {
  const outcome = record['outcome'];
  return Predicate.isObject(outcome) && !tags.includes(outcome['type'])
    ? Record.remove(record, 'outcome')
    : record;
};

/**
 * Strips a raw `RunAgentInput`.
 *
 * @internal
 */
export const stripRunAgentInput = (input: unknown): unknown =>
  Predicate.isObject(input) ? update(input, 'messages', stripMessages) : input;

/**
 * Strips a raw event of a known `type`.
 *
 * @internal
 */
export const stripEvent = (event: Loose): Loose => {
  switch (event['type']) {
    case 'MESSAGES_SNAPSHOT':
      return update(event, 'messages', stripMessages);
    case 'RUN_STARTED':
      return update(event, 'input', stripRunAgentInput);
    case 'TOOL_CALL_RESULT':
      return update(event, 'content', stripParts);
    case 'STATE_DELTA':
      return update(event, 'delta', stripPatch);
    case 'ACTIVITY_DELTA':
      return update(event, 'patch', stripPatch);
    case 'RUN_FINISHED':
      return stripOutcome(event, RUN_OUTCOMES);
    case 'SUBAGENT_FINISHED':
      return stripOutcome(event, SUBAGENT_OUTCOMES);
    default:
      return event;
  }
};
