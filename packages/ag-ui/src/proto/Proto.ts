/**
 * The protobuf binding of AG-UI 1.0: an Effect port of the converters in
 * `@ag-ui/proto` 1.0.4 (`proto.ts`), over the protobuf-es code generated
 * from the vendored `spec/proto/*.proto`.
 *
 * The protobuf messages do not mirror the JSON events. A message is one
 * `ag_ui.Message` whose `content`, `content_parts` and `activity_content`
 * carry the content of different roles; a run outcome is a string beside
 * flat `interrupts` and `pending_tool_call_ids`; a JSON Patch `op` is an
 * enum. The converters below map between the two shapes as the reference
 * does. protobuf-es then handles only the leaf encoding: `fromJson` and
 * `toJson` of the converted ProtoJSON, so `google.protobuf.Value`, `Struct`
 * and `int64` follow the protobuf JSON rules.
 *
 * A decoded event goes through `decodeEvent`, the same tolerant schema
 * decode as the SSE path, so both transports accept and reject alike. An
 * envelope with no arm that this build knows fails: AG-UI 1.0 defines no
 * event beyond the 31 arms.
 *
 * @since 0.1.0
 */
import { fromBinary, fromJson, toBinary, toJson } from '@bufbuild/protobuf';
import type { JsonObject, JsonValue } from '@bufbuild/protobuf';
import { Effect, Option, Predicate, Record, Schema } from 'effect';
import { AgUiDecodeError, AgUiEncodeError } from '../Errors.js';
import { AgUiEvent, decodeEvent, isEventType } from '../Events.js';
import { EventSchema } from '../generated/events_pb.js';
import { formatIssue } from '../internal/issues.js';

/** A JSON object with unknown values, as the converters see it. */
type Loose = { readonly [key: string]: unknown };

/** An empty object, when the value is not an object. */
const asLoose = (value: unknown): Loose =>
  Predicate.isObject(value) ? value : {};

/** An empty array, when the value is not an array. */
const asArray = (value: unknown): ReadonlyArray<unknown> =>
  Array.isArray(value) ? value : [];

/** Drops the keys whose value is `undefined`, so absent stays absent. */
const compact = (record: Loose): Loose =>
  Object.fromEntries(
    Object.entries(record).filter(([, value]) => !Predicate.isUndefined(value))
  );

/** A key holding a list, or no key when the list is empty or absent. */
const nonEmpty = (key: string, list: unknown): Loose =>
  asArray(list).length > 0 ? { [key]: list } : {};

/** `TEXT_MESSAGE_START` to `textMessageStart`, the name of the envelope arm. */
const armOf = (type: string): string =>
  type.toLowerCase().replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** The event type that an envelope arm carries. */
const typeOfArm = (arm: string): string =>
  arm.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();

// ---------------------------------------------------------------------------
// Encode: JSON event to ProtoJSON envelope
// ---------------------------------------------------------------------------

/** A part source to its `InputContentSource` arm. */
const toWireSource = (source: unknown): Loose => {
  const { type, ...fields } = asLoose(source);
  return Predicate.isString(type) ? { [type]: fields } : {};
};

/** A content part to its `InputContent` arm. */
const toWirePart = (part: unknown): Loose => {
  const { type, source, ...fields } = asLoose(part);
  if (!Predicate.isString(type)) return {};
  return type === 'text'
    ? { text: fields }
    : { [type]: { ...fields, source: toWireSource(source) } };
};

/** A message to the one `ag_ui.Message` that carries every role. */
const toWireMessage = (value: unknown): Loose => {
  const { content, ...message } = asLoose(value);
  if (Array.isArray(content)) {
    return { ...message, contentParts: content.map(toWirePart) };
  }
  if (message['role'] === 'activity') {
    return { ...message, activityContent: content };
  }
  return compact({ ...message, content });
};

/** A `RunAgentInput` to `ag_ui.RunAgentInput`. */
const toWireInput = (value: unknown): Loose => {
  const input = asLoose(value);
  return { ...input, messages: asArray(input['messages']).map(toWireMessage) };
};

/** A JSON Patch to `repeated ag_ui.JsonPatchOperation`, `op` as the enum name. */
const toWirePatch = (patch: unknown): ReadonlyArray<Loose> =>
  asArray(patch).map((value) => {
    const operation = asLoose(value);
    return compact({
      op: String(operation['op']).toUpperCase(),
      path: operation['path'],
      from: operation['from'],
      value: operation['value'],
    });
  });

/** A run outcome to the flat `outcome`, `interrupts` and pending ids. */
const toWireRunOutcome = (outcome: unknown): Loose => {
  const record = asLoose(outcome);
  const type = Predicate.isString(record['type']) ? record['type'] : '';
  return {
    outcome: type,
    pendingToolCallIds:
      type === 'success' ? asArray(record['pendingToolCallIds']) : [],
    interrupts: type === 'interrupt' ? asArray(record['interrupts']) : [],
  };
};

/** A subagent outcome to the flat `outcome` and `interruptIds`. */
const toWireSubagentOutcome = (outcome: unknown): Loose => {
  const record = asLoose(outcome);
  const type = Predicate.isString(record['type']) ? record['type'] : '';
  return {
    outcome: type,
    interruptIds: type === 'suspended' ? asArray(record['interruptIds']) : [],
  };
};

/** The event-specific fields of an event, in their protobuf shape. */
const toWireFields = (type: string, fields: Loose): Loose => {
  switch (type) {
    case 'MESSAGES_SNAPSHOT':
      return { ...fields, messages: asArray(fields['messages']).map(toWireMessage) };
    case 'RUN_STARTED':
      return 'input' in fields
        ? { ...fields, input: toWireInput(fields['input']) }
        : fields;
    case 'RUN_FINISHED': {
      const { outcome, ...rest } = fields;
      return { ...rest, ...toWireRunOutcome(outcome) };
    }
    case 'SUBAGENT_FINISHED': {
      const { outcome, ...rest } = fields;
      return { ...rest, ...toWireSubagentOutcome(outcome) };
    }
    case 'STATE_DELTA':
      return { ...fields, delta: toWirePatch(fields['delta']) };
    case 'ACTIVITY_DELTA':
      return { ...fields, patch: toWirePatch(fields['patch']) };
    case 'TOOL_CALL_RESULT': {
      const { content, ...rest } = fields;
      return Array.isArray(content)
        ? { ...rest, contentParts: content.map(toWirePart) }
        : { ...rest, content };
    }
    default:
      return fields;
  }
};

/** A JSON event to its ProtoJSON `ag_ui.Event` envelope. */
const toWireEvent = (json: Loose): JsonObject => {
  const { type, timestamp, rawEvent, metadata, ...fields } = json;
  const name = String(type);
  return {
    [armOf(name)]: {
      baseEvent: compact({ type: name, timestamp, rawEvent, metadata }),
      ...toWireFields(name, fields),
    },
  } as JsonObject;
};

/** The JSON form of an event, checked against its schema. */
const encodeJson = Schema.encodeEffect(AgUiEvent);

/**
 * Encodes an event as the bytes of one `ag_ui.Event`, as `encode` of
 * `@ag-ui/proto` does. It fails when the event does not match its schema.
 *
 * @since 0.1.0
 */
export const encodeEvent = (
  event: AgUiEvent
): Effect.Effect<Uint8Array, AgUiEncodeError> =>
  encodeJson(event).pipe(
    Effect.mapError(
      (error) =>
        new AgUiEncodeError({
          message: `Cannot encode ${event.type}: ${formatIssue(error.issue, event)}`,
        })
    ),
    Effect.flatMap((json) =>
      Effect.try({
        try: () =>
          toBinary(
            EventSchema,
            fromJson(EventSchema, toWireEvent(asLoose(json)), {
              ignoreUnknownFields: true,
            })
          ),
        catch: (cause) =>
          new AgUiEncodeError({
            message: `Cannot encode ${event.type} as protobuf: ${String(cause)}`,
          }),
      })
    )
  );

// ---------------------------------------------------------------------------
// Decode: ProtoJSON envelope to JSON event
// ---------------------------------------------------------------------------

/** A decode failure. */
const invalid = (message: string) => new AgUiDecodeError({ message });

/** The roles whose content is a string or a list of parts. */
const PARTS_ROLES: ReadonlyArray<unknown> = ['user', 'tool'];

/** Every role of the `Message` union. */
const KNOWN_ROLES: ReadonlyArray<unknown> = [
  'developer',
  'system',
  'assistant',
  'user',
  'tool',
  'activity',
  'reasoning',
];

/** An `InputContentSource` arm to a part source; none when no arm is set. */
const fromWireSource = (
  value: unknown
): Effect.Effect<Option.Option<Loose>, AgUiDecodeError> => {
  const arms = Object.entries(asLoose(value));
  if (arms.length > 1) {
    return Effect.fail(invalid('Invalid event: source carries more than one arm'));
  }
  return Effect.succeed(
    Option.map(Option.fromUndefinedOr(arms[0]), ([type, fields]) => ({
      type,
      ...asLoose(fields),
    }))
  );
};

/**
 * An `InputContent` arm to a content part. A part with no arm, or with a
 * source of no arm, is dropped, as the reference does: it names a kind that
 * a newer protocol added.
 */
const fromWirePart = (
  value: unknown
): Effect.Effect<Option.Option<Loose>, AgUiDecodeError> => {
  const arms = Object.entries(asLoose(value));
  if (arms.length > 1) {
    return Effect.fail(invalid('Invalid event: content part carries more than one arm'));
  }
  const arm = arms[0];
  if (arm === undefined) return Effect.succeed(Option.none());
  const [type, fields] = arm;
  const part = asLoose(fields);
  if (type === 'text') return Effect.succeed(Option.some({ type, ...part }));
  return Effect.map(fromWireSource(part['source']), (source) =>
    Option.map(source, (present) => ({ type, ...part, source: present }))
  );
};

/** A list of `InputContent` to content parts. */
const fromWireParts = (parts: unknown) =>
  Effect.map(Effect.forEach(asArray(parts), fromWirePart), (decoded) =>
    decoded.flatMap(Option.toArray)
  );

/** Counts the content carriers that a wire message sets. */
const carriers = (wire: Loose): number =>
  (wire['content'] !== undefined ? 1 : 0) +
  (asArray(wire['contentParts']).length > 0 ? 1 : 0) +
  (wire['activityContent'] !== undefined ? 1 : 0);

/** One `ag_ui.Message` to the message of its role. */
const fromWireMessage = (
  value: unknown
): Effect.Effect<Loose, AgUiDecodeError> =>
  Effect.gen(function* () {
    const { content, contentParts, activityContent, toolCalls, ...rest } =
      asLoose(value);
    const wire = asLoose(value);
    const role = rest['role'];
    const known = KNOWN_ROLES.includes(role);
    const parts = asArray(contentParts);
    if (!known && carriers(wire) > 1) {
      return yield* invalid('Invalid event: message carries more than one content form');
    }
    const usesParts = known ? PARTS_ROLES.includes(role) : parts.length > 0;
    const usesMap = known
      ? role === 'activity'
      : !usesParts && activityContent !== undefined;
    if (known) {
      if (!usesParts && parts.length > 0) {
        return yield* invalid('Invalid event: message carries content parts for a role that has none');
      }
      if (activityContent !== undefined && !usesMap) {
        return yield* invalid('Invalid event: message carries activity content for a non-activity role');
      }
      if (usesMap && content !== undefined) {
        return yield* invalid('Invalid event: activity content cannot ride with other content forms');
      }
      if (usesParts && content !== undefined && parts.length > 0) {
        return yield* invalid('Invalid event: message carries both string content and content parts');
      }
    }
    const body =
      usesParts && content === undefined
        ? yield* fromWireParts(parts)
        : usesMap && activityContent !== undefined
          ? activityContent
          : content;
    return compact({
      ...rest,
      content: body,
      ...nonEmpty('toolCalls', toolCalls),
    });
  });

/** An `ag_ui.RunAgentInput` to a `RunAgentInput`. */
const fromWireInput = (
  value: unknown
): Effect.Effect<Loose, AgUiDecodeError> =>
  Effect.map(
    Effect.forEach(asArray(asLoose(value)['messages']), fromWireMessage),
    (messages) => {
      const input = asLoose(value);
      return compact({
        ...input,
        messages,
        tools: asArray(input['tools']),
        context: asArray(input['context']),
        resume: asArray(input['resume']),
      });
    }
  );

/** An `int64` from ProtoJSON (a decimal string) to a number. */
const fromInt64 = (value: unknown): unknown =>
  Predicate.isString(value) ? Number(value) : value;

/** `repeated ag_ui.Usage` to a `usage` key, absent when the list is empty. */
const fromWireUsage = (usage: unknown): Loose =>
  nonEmpty(
    'usage',
    asArray(usage).map((entry) =>
      Object.fromEntries(
        Object.entries(asLoose(entry)).map(([key, count]) => [
          key,
          key.endsWith('Tokens') ? fromInt64(count) : count,
        ])
      )
    )
  );

/** `repeated ag_ui.JsonPatchOperation` to a JSON Patch, `op` in lower case. */
const fromWirePatch = (patch: unknown) =>
  asArray(patch).map((value) => {
    const operation = asLoose(value);
    return compact({ ...operation, op: String(operation['op']).toLowerCase() });
  });

/** The flat run outcome fields to an `outcome`, or none when it is empty. */
const fromWireRunOutcome = (fields: Loose): Loose => {
  const { outcome, interrupts, pendingToolCallIds, ...rest } = fields;
  const type = Predicate.isString(outcome) ? outcome : '';
  const pending = asArray(pendingToolCallIds);
  const waiting = asArray(interrupts);
  if (type === '') return rest;
  return {
    ...rest,
    outcome: {
      type,
      ...(type === 'interrupt' ? { interrupts: waiting } : nonEmpty('interrupts', waiting)),
      ...nonEmpty('pendingToolCallIds', pending),
    },
  };
};

/** The flat subagent outcome fields to an `outcome`, or none when empty. */
const fromWireSubagentOutcome = (fields: Loose): Loose => {
  const { outcome, interruptIds, ...rest } = fields;
  const type = Predicate.isString(outcome) ? outcome : '';
  const ids = asArray(interruptIds);
  if (type === '') return rest;
  return {
    ...rest,
    outcome: { type, ...nonEmpty('interruptIds', ids) },
  };
};

/** The event-specific fields of an envelope arm, in their JSON shape. */
const fromWireFields = (
  type: string,
  fields: Loose
): Effect.Effect<Loose, AgUiDecodeError> => {
  switch (type) {
    case 'MESSAGES_SNAPSHOT':
      return Effect.map(
        Effect.forEach(asArray(fields['messages']), fromWireMessage),
        (messages) => ({ ...fields, messages })
      );
    case 'RUN_STARTED':
      return 'input' in fields
        ? Effect.map(fromWireInput(fields['input']), (input) => ({ ...fields, input }))
        : Effect.succeed(fields);
    case 'RUN_FINISHED':
      return Effect.succeed({
        ...Record.remove(fromWireRunOutcome(fields), 'usage'),
        ...fromWireUsage(fields['usage']),
      });
    case 'RUN_ERROR':
      return Effect.succeed({
        ...Record.remove(fields, 'usage'),
        ...fromWireUsage(fields['usage']),
      });
    case 'SUBAGENT_FINISHED':
      return Effect.succeed(fromWireSubagentOutcome(fields));
    case 'STATE_DELTA':
      return Effect.succeed({ ...fields, delta: fromWirePatch(fields['delta']) });
    case 'ACTIVITY_DELTA':
      return Effect.succeed({ ...fields, patch: fromWirePatch(fields['patch']) });
    case 'TOOL_CALL_RESULT': {
      const { content, contentParts, ...rest } = fields;
      const parts = asArray(contentParts);
      if (content !== undefined && parts.length > 0) {
        return Effect.fail(
          invalid('Invalid event: content carries both string content and content parts')
        );
      }
      return content !== undefined
        ? Effect.succeed({ ...rest, content })
        : Effect.map(fromWireParts(parts), (decoded) => ({ ...rest, content: decoded }));
    }
    default:
      return Effect.succeed(fields);
  }
};

/** The ProtoJSON of a decoded envelope, with every implicit field present. */
const envelopeJson = (bytes: Uint8Array): Effect.Effect<Loose, AgUiDecodeError> =>
  Effect.try({
    try: () => {
      const envelope = fromBinary(EventSchema, bytes);
      if (envelope.event.case === undefined) {
        return {};
      }
      return asLoose(
        toJson(EventSchema, envelope, { alwaysEmitImplicit: true }) as JsonValue
      );
    },
    catch: (cause) =>
      invalid(`Failed to decode protocol buffer message: ${String(cause)}`),
  });

/**
 * Decodes the bytes of one `ag_ui.Event` into an event, as `decode` of
 * `@ag-ui/proto` does, then checks it with the same tolerant schema decode
 * as the SSE path. An envelope with no known arm, or whose arm disagrees
 * with `base_event.type`, fails.
 *
 * @since 0.1.0
 */
export const decodeEventBytes = (
  bytes: Uint8Array
): Effect.Effect<AgUiEvent, AgUiDecodeError> =>
  Effect.gen(function* () {
    const envelope = yield* envelopeJson(bytes);
    const arms = Object.entries(envelope);
    const arm = arms[0];
    if (arm === undefined || arms.length !== 1) {
      return yield* invalid(
        'Invalid event: the envelope carries no event arm that AG-UI 1.0 defines'
      );
    }
    const [name, value] = arm;
    const type = typeOfArm(name);
    const { baseEvent, ...fields } = asLoose(value);
    const base = asLoose(baseEvent);
    if (!isEventType(type) || baseEvent === undefined) {
      return yield* invalid('Invalid event');
    }
    if (base['type'] !== type) {
      return yield* invalid(
        `Invalid event: envelope carries ${type} but the base event declares ${String(base['type'])}`
      );
    }
    const converted = yield* fromWireFields(type, fields);
    const event = compact({
      type,
      ...converted,
      timestamp: fromInt64(base['timestamp']),
      rawEvent: base['rawEvent'],
      metadata: base['metadata'],
    });
    const decoded = yield* decodeEvent(event);
    return yield* Option.match(decoded, {
      onNone: () => Effect.fail(invalid(`Invalid event: unknown type ${type}`)),
      onSome: Effect.succeed,
    });
  });
