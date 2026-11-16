/**
 * The AG-UI 1.0 events as Effect Schemas, and their SSE encoding.
 *
 * Every event is a struct with a `type` literal, its own fields, the
 * `Attributable` attribution where the specification composes it, and the
 * `BaseEvent` fields. `AgUiEvent` is the union of all 31, discriminated by
 * `type`. The deprecated `THINKING_*` events and the draft `META_EVENT` are
 * not part of 1.0 and have no schema: a receiver drops them as unknown.
 *
 * The SSE wire matches `@ag-ui/encoder` 1.0.4: one `data: <json>\n\n` frame
 * for each event, no `event:` or `id:` line, and an optional field omitted
 * rather than `null`.
 *
 * @since 0.1.0
 */
import { Effect, Filter, HashMap, Option, Predicate, Schema, Stream } from 'effect';
import { AgUiDecodeError, AgUiEncodeError } from './Errors.js';
import { formatIssue, received } from './internal/issues.js';
import { stripEvent } from './internal/tolerance.js';
import {
  Id,
  JsonPatch,
  JsonValue,
  Message,
  Metadata,
  NonNullJson,
  PartsContent,
  RunAgentInput,
  RunFinishedOutcome,
  SafeInteger,
  State,
  SubagentFinishedOutcome,
  SubagentRunId,
  TextMessageRole,
  TokenUsage,
  attributable,
} from './Types.js';

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

/**
 * Every event `type` of AG-UI 1.0, in the order of the specification.
 *
 * @since 0.1.0
 */
export const EVENT_TYPES = [
  'TEXT_MESSAGE_START',
  'TEXT_MESSAGE_CONTENT',
  'TEXT_MESSAGE_END',
  'TEXT_MESSAGE_CHUNK',
  'TOOL_CALL_START',
  'TOOL_CALL_ARGS',
  'TOOL_CALL_END',
  'TOOL_CALL_CHUNK',
  'TOOL_CALL_RESULT',
  'STATE_SNAPSHOT',
  'STATE_DELTA',
  'MESSAGES_SNAPSHOT',
  'ACTIVITY_SNAPSHOT',
  'ACTIVITY_DELTA',
  'RAW',
  'CUSTOM',
  'RUN_STARTED',
  'RUN_FINISHED',
  'RUN_ERROR',
  'STEP_STARTED',
  'STEP_FINISHED',
  'REASONING_START',
  'REASONING_MESSAGE_START',
  'REASONING_MESSAGE_CONTENT',
  'REASONING_MESSAGE_END',
  'REASONING_MESSAGE_CHUNK',
  'REASONING_END',
  'REASONING_ENCRYPTED_VALUE',
  'SUBAGENT_STARTED',
  'SUBAGENT_FINISHED',
  'SUBAGENT_ERROR',
] as const;

/**
 * The discriminator that every event carries.
 *
 * @since 0.1.0
 */
export const EventType = Schema.Literals(EVENT_TYPES).annotate({
  identifier: 'EventType',
});

/**
 * @since 0.1.0
 */
export type EventType = typeof EventType.Type;

/**
 * Tells whether a string names an AG-UI 1.0 event type.
 *
 * @since 0.1.0
 */
export const isEventType = (value: unknown): value is EventType =>
  (EVENT_TYPES as ReadonlyArray<unknown>).includes(value);

/**
 * The fields of `BaseEvent` that every event carries after its own.
 *
 * @since 0.1.0
 */
export const baseEvent = {
  timestamp: Schema.optionalKey(SafeInteger),
  rawEvent: Schema.optionalKey(NonNullJson),
  metadata: Schema.optionalKey(Metadata),
};

/** Builds one event struct: `type` first, then its fields, then the base. */
const event = <const T extends EventType, F extends Schema.Struct.Fields>(
  type: T,
  fields: F
) =>
  Schema.Struct({ type: Schema.Literal(type), ...fields, ...baseEvent }).annotate(
    { identifier: type }
  );

// ---------------------------------------------------------------------------
// Text messages
// ---------------------------------------------------------------------------

/**
 * Opens a streamed text message. An absent `role` means `assistant`.
 *
 * @since 0.1.0
 */
export const TextMessageStartEvent = event('TEXT_MESSAGE_START', {
  messageId: Id,
  role: Schema.optionalKey(TextMessageRole),
  name: Schema.optionalKey(Schema.String),
  ...attributable,
});

/**
 * Appends a fragment to a streamed text message. `delta` may be empty.
 *
 * @since 0.1.0
 */
export const TextMessageContentEvent = event('TEXT_MESSAGE_CONTENT', {
  messageId: Id,
  delta: Schema.String,
  ...attributable,
});

/**
 * Closes a streamed text message.
 *
 * @since 0.1.0
 */
export const TextMessageEndEvent = event('TEXT_MESSAGE_END', {
  messageId: Id,
  ...attributable,
});

/**
 * A shorthand for a start, content and end sequence. `AgUiClient` expands it.
 *
 * @since 0.1.0
 */
export const TextMessageChunkEvent = event('TEXT_MESSAGE_CHUNK', {
  messageId: Schema.optionalKey(Schema.String),
  role: Schema.optionalKey(TextMessageRole),
  delta: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  ...attributable,
});

// ---------------------------------------------------------------------------
// Tool calls
// ---------------------------------------------------------------------------

/**
 * Opens a tool call.
 *
 * @since 0.1.0
 */
export const ToolCallStartEvent = event('TOOL_CALL_START', {
  toolCallId: Id,
  toolCallName: Schema.String,
  parentMessageId: Schema.optionalKey(Schema.String),
  ...attributable,
});

/**
 * Appends a fragment of a tool call's arguments.
 *
 * @since 0.1.0
 */
export const ToolCallArgsEvent = event('TOOL_CALL_ARGS', {
  toolCallId: Id,
  delta: Schema.String,
  ...attributable,
});

/**
 * Closes a tool call: its arguments are complete.
 *
 * @since 0.1.0
 */
export const ToolCallEndEvent = event('TOOL_CALL_END', {
  toolCallId: Id,
  ...attributable,
});

/**
 * A shorthand for a tool call's start, args and end sequence. `AgUiClient`
 * expands it.
 *
 * @since 0.1.0
 */
export const ToolCallChunkEvent = event('TOOL_CALL_CHUNK', {
  toolCallId: Schema.optionalKey(Schema.String),
  toolCallName: Schema.optionalKey(Schema.String),
  parentMessageId: Schema.optionalKey(Schema.String),
  delta: Schema.optionalKey(Schema.String),
  ...attributable,
});

/**
 * Carries what a tool returned. It mints a tool message with its own id.
 *
 * @since 0.1.0
 */
export const ToolCallResultEvent = event('TOOL_CALL_RESULT', {
  messageId: Id,
  toolCallId: Id,
  content: PartsContent,
  role: Schema.optionalKey(Schema.Literal('tool')),
  ...attributable,
});

// ---------------------------------------------------------------------------
// State, messages and activity
// ---------------------------------------------------------------------------

/**
 * Replaces the agent state wholesale. The snapshot may be any JSON value.
 *
 * @since 0.1.0
 */
export const StateSnapshotEvent = event('STATE_SNAPSHOT', {
  snapshot: State,
  ...attributable,
});

/**
 * Changes the agent state with an RFC 6902 patch.
 *
 * @since 0.1.0
 */
export const StateDeltaEvent = event('STATE_DELTA', {
  delta: JsonPatch,
  ...attributable,
});

/**
 * The complete, ordered set of messages that the producer owns.
 *
 * @since 0.1.0
 */
export const MessagesSnapshotEvent = event('MESSAGES_SNAPSHOT', {
  messages: Schema.Array(Message),
});

/**
 * Reports structured progress for an activity message. An absent `replace`
 * means `true`.
 *
 * @since 0.1.0
 */
export const ActivitySnapshotEvent = event('ACTIVITY_SNAPSHOT', {
  messageId: Id,
  activityType: Schema.String,
  content: Metadata,
  replace: Schema.optionalKey(Schema.Boolean),
  ...attributable,
});

/**
 * Changes an activity message's content with an RFC 6902 patch.
 *
 * @since 0.1.0
 */
export const ActivityDeltaEvent = event('ACTIVITY_DELTA', {
  messageId: Id,
  activityType: Schema.String,
  patch: JsonPatch,
  ...attributable,
});

// ---------------------------------------------------------------------------
// Pass-through
// ---------------------------------------------------------------------------

/**
 * Passes a provider-native event through untranslated.
 *
 * @since 0.1.0
 */
export const RawEvent = event('RAW', {
  event: JsonValue,
  source: Schema.optionalKey(Schema.String),
  ...attributable,
});

/**
 * An application's own event, outside the protocol.
 *
 * @since 0.1.0
 */
export const CustomEvent = event('CUSTOM', {
  name: Schema.String,
  value: JsonValue,
  ...attributable,
});

// ---------------------------------------------------------------------------
// Runs and steps
// ---------------------------------------------------------------------------

/**
 * Opens a run. `protocolVersion` is the producer's own version, such as
 * `"1.0"`.
 *
 * @since 0.1.0
 */
export const RunStartedEvent = event('RUN_STARTED', {
  threadId: Id,
  runId: Id,
  protocolVersion: Schema.optionalKey(Schema.String),
  parentRunId: Schema.optionalKey(Schema.String),
  input: Schema.optionalKey(RunAgentInput),
});

/**
 * Closes a run that did not fail. An absent `outcome` means success.
 *
 * @since 0.1.0
 */
export const RunFinishedEvent = event('RUN_FINISHED', {
  threadId: Id,
  runId: Id,
  result: Schema.optionalKey(NonNullJson),
  outcome: Schema.optionalKey(RunFinishedOutcome),
  usage: Schema.optionalKey(Schema.Array(TokenUsage)),
});

/**
 * Ends a run that failed.
 *
 * @since 0.1.0
 */
export const RunErrorEvent = event('RUN_ERROR', {
  message: Schema.String,
  code: Schema.optionalKey(Schema.String),
  usage: Schema.optionalKey(Schema.Array(TokenUsage)),
});

/**
 * Opens a named step within a run.
 *
 * @since 0.1.0
 */
export const StepStartedEvent = event('STEP_STARTED', {
  stepName: Schema.String,
  ...attributable,
});

/**
 * Closes a named step.
 *
 * @since 0.1.0
 */
export const StepFinishedEvent = event('STEP_FINISHED', {
  stepName: Schema.String,
  ...attributable,
});

// ---------------------------------------------------------------------------
// Reasoning
// ---------------------------------------------------------------------------

/**
 * Opens a span of reasoning.
 *
 * @since 0.1.0
 */
export const ReasoningStartEvent = event('REASONING_START', {
  messageId: Id,
  ...attributable,
});

/**
 * Opens a streamed reasoning message. `role` is required and fixed.
 *
 * @since 0.1.0
 */
export const ReasoningMessageStartEvent = event('REASONING_MESSAGE_START', {
  messageId: Id,
  role: Schema.Literal('reasoning'),
  ...attributable,
});

/**
 * Appends a fragment to a streamed reasoning message.
 *
 * @since 0.1.0
 */
export const ReasoningMessageContentEvent = event('REASONING_MESSAGE_CONTENT', {
  messageId: Id,
  delta: Schema.String,
  ...attributable,
});

/**
 * Closes a streamed reasoning message.
 *
 * @since 0.1.0
 */
export const ReasoningMessageEndEvent = event('REASONING_MESSAGE_END', {
  messageId: Id,
  ...attributable,
});

/**
 * A shorthand for a reasoning message's start, content and end sequence.
 * `AgUiClient` expands it.
 *
 * @since 0.1.0
 */
export const ReasoningMessageChunkEvent = event('REASONING_MESSAGE_CHUNK', {
  messageId: Schema.optionalKey(Schema.String),
  delta: Schema.optionalKey(Schema.String),
  ...attributable,
});

/**
 * Closes a span of reasoning.
 *
 * @since 0.1.0
 */
export const ReasoningEndEvent = event('REASONING_END', {
  messageId: Id,
  ...attributable,
});

/**
 * Whether a `REASONING_ENCRYPTED_VALUE` belongs to a message or a tool call.
 *
 * @since 0.1.0
 */
export const ReasoningEncryptedValueSubtype = Schema.Literals([
  'tool-call',
  'message',
]).annotate({ identifier: 'ReasoningEncryptedValueSubtype' });

/**
 * Carries a provider's opaque, encrypted reasoning artefact.
 *
 * @since 0.1.0
 */
export const ReasoningEncryptedValueEvent = event('REASONING_ENCRYPTED_VALUE', {
  subtype: ReasoningEncryptedValueSubtype,
  entityId: Id,
  encryptedValue: Schema.String,
  ...attributable,
});

// ---------------------------------------------------------------------------
// Subagents
// ---------------------------------------------------------------------------

/**
 * Announces a subagent invocation. Here `subagentRunId` identifies the
 * subagent; it is not an attribution.
 *
 * @since 0.1.0
 */
export const SubagentStartedEvent = event('SUBAGENT_STARTED', {
  subagentRunId: SubagentRunId,
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  parentSubagentRunId: Schema.optionalKey(SubagentRunId),
  parentToolCallId: Schema.optionalKey(Schema.String),
  parentMessageId: Schema.optionalKey(Schema.String),
});

/**
 * Ends a subagent invocation's segment of the run.
 *
 * @since 0.1.0
 */
export const SubagentFinishedEvent = event('SUBAGENT_FINISHED', {
  subagentRunId: SubagentRunId,
  result: Schema.optionalKey(NonNullJson),
  outcome: Schema.optionalKey(SubagentFinishedOutcome),
});

/**
 * Reports that a subagent invocation failed. The run may continue.
 *
 * @since 0.1.0
 */
export const SubagentErrorEvent = event('SUBAGENT_ERROR', {
  subagentRunId: SubagentRunId,
  message: Schema.String,
  code: Schema.optionalKey(Schema.String),
});

// ---------------------------------------------------------------------------
// The union
// ---------------------------------------------------------------------------

/**
 * Any AG-UI 1.0 event, discriminated by `type`.
 *
 * @since 0.1.0
 */
export const AgUiEvent = Schema.Union([
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  TextMessageChunkEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallChunkEvent,
  ToolCallResultEvent,
  StateSnapshotEvent,
  StateDeltaEvent,
  MessagesSnapshotEvent,
  ActivitySnapshotEvent,
  ActivityDeltaEvent,
  RawEvent,
  CustomEvent,
  RunStartedEvent,
  RunFinishedEvent,
  RunErrorEvent,
  StepStartedEvent,
  StepFinishedEvent,
  ReasoningStartEvent,
  ReasoningMessageStartEvent,
  ReasoningMessageContentEvent,
  ReasoningMessageEndEvent,
  ReasoningMessageChunkEvent,
  ReasoningEndEvent,
  ReasoningEncryptedValueEvent,
  SubagentStartedEvent,
  SubagentFinishedEvent,
  SubagentErrorEvent,
]).annotate({ identifier: 'AgUiEvent' });

/**
 * @since 0.1.0
 */
export type AgUiEvent = typeof AgUiEvent.Type;

/**
 * The schema of each event, by its `type`. Decoding through the member that
 * the `type` names gives a precise error, where the union could only say
 * that no member matched.
 */
const memberByType = HashMap.fromIterable(
  AgUiEvent.members.map(
    (member): readonly [string, Schema.Decoder<AgUiEvent>] => [
      member.fields.type.literal,
      member,
    ]
  )
);

/**
 * The event of one `type`.
 *
 * @since 0.1.0
 */
export type AgUiEventOf<T extends EventType> = Extract<AgUiEvent, { readonly type: T }>;

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/** The codec between an event and its JSON text. */
const EventJson = Schema.fromJsonString(AgUiEvent);

/** The codec between JSON text and a JSON value. */
const JsonText = Schema.fromJsonString(Schema.Json);

/**
 * Renders an event as its JSON text, the payload of one SSE frame. It fails
 * when the event does not match its schema, for example a `null` where the
 * schema wants an absent field.
 *
 * @since 0.1.0
 */
export const encodeEventJson = (
  event: AgUiEvent
): Effect.Effect<string, AgUiEncodeError> =>
  Schema.encodeEffect(EventJson)(event).pipe(
    Effect.mapError(
      (error) =>
        new AgUiEncodeError({
          message: `Cannot encode ${event.type}: ${formatIssue(error.issue, event)}`,
        })
    )
  );

/**
 * Decodes one raw event, tolerating what a newer producer may add: unknown
 * keys are dropped, unknown list members and outcomes are stripped, and an
 * event of an unknown `type` gives `Option.none()` with a logged warning.
 * A malformed known field fails with `AgUiDecodeError`.
 *
 * @since 0.1.0
 */
export const decodeEvent = (
  raw: unknown
): Effect.Effect<Option.Option<AgUiEvent>, AgUiDecodeError> => {
  if (!Predicate.isObject(raw)) {
    return Effect.fail(
      new AgUiDecodeError({
        message: `Invalid event: expected object, received ${received(raw)}`,
      })
    );
  }
  const type = raw['type'];
  if (!isEventType(type)) {
    return Effect.as(
      Effect.logWarning(
        `Dropping an event of unknown type '${String(type)}': AG-UI 1.0 does not describe it.`
      ),
      Option.none()
    );
  }
  const stripped = stripEvent(raw);
  const member = Option.getOrElse(
    HashMap.get(memberByType, type),
    (): Schema.Decoder<AgUiEvent> => AgUiEvent
  );
  return Schema.decodeUnknownEffect(member)(stripped).pipe(
    Effect.map(Option.some),
    Effect.mapError(
      (error) =>
        new AgUiDecodeError({
          message: `Invalid ${type} event: ${formatIssue(error.issue, stripped)}`,
        })
    )
  );
};

/**
 * Decodes the JSON text of one event, as `decodeEvent` does.
 *
 * @since 0.1.0
 */
export const decodeEventJson = (
  text: string
): Effect.Effect<Option.Option<AgUiEvent>, AgUiDecodeError> =>
  Schema.decodeUnknownEffect(JsonText)(text).pipe(
    Effect.mapError(
      () =>
        new AgUiDecodeError({
          message: `Invalid JSON in an event: ${text.slice(0, 100)}`,
        })
    ),
    Effect.flatMap(decodeEvent)
  );

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

/**
 * The media type of an SSE response.
 *
 * @since 0.1.0
 */
export const SSE_CONTENT_TYPE = 'text/event-stream';

/**
 * The headers of an SSE response. `X-Accel-Buffering: no` keeps a proxy from
 * holding the stream back.
 *
 * @since 0.1.0
 */
export const SSE_HEADERS = {
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

/**
 * The largest SSE frame that a reader buffers, 10 MiB as in the reference
 * client. A stream that never ends a frame fails rather than grow without
 * bound.
 *
 * @since 0.1.0
 */
export const MAX_SSE_FRAME_SIZE = 10 * 1024 * 1024;

/**
 * Renders an event as one SSE frame: `data: <json>\n\n`.
 *
 * @since 0.1.0
 */
export const encodeSse = (
  event: AgUiEvent
): Effect.Effect<string, AgUiEncodeError> =>
  Effect.map(encodeEventJson(event), (json) => `data: ${json}\n\n`);

/** The JSON payload of one SSE frame, or none when it has no `data:` line. */
const frameData = (frame: string): Option.Option<string> => {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''));
  return data.length === 0 ? Option.none() : Option.some(data.join('\n'));
};

/** Splits buffered text into complete frames and the incomplete tail. */
const splitFrames = (
  buffer: string
): readonly [tail: string, frames: ReadonlyArray<string>] => {
  const parts = buffer.split('\n\n');
  return [parts[parts.length - 1] ?? '', parts.slice(0, -1)];
};

/**
 * Parses an SSE byte stream into events. It reads the `data:` lines of each
 * frame as one JSON event and ignores every other field, as the reference
 * client does. A frame larger than `MAX_SSE_FRAME_SIZE`, text that is not
 * JSON and an invalid event fail the stream with `AgUiDecodeError`; an event
 * of an unknown type is dropped.
 *
 * @since 0.1.0
 */
export const decodeSse = <E, R>(
  body: Stream.Stream<Uint8Array, E, R>
): Stream.Stream<AgUiEvent, E | AgUiDecodeError, R> =>
  body.pipe(
    Stream.decodeText(),
    Stream.map((text) => text.replace(/\r\n?/g, '\n')),
    Stream.mapAccumEffect(
      () => '',
      (buffer: string, text: string) => {
        const [tail, frames] = splitFrames(buffer + text);
        return tail.length > MAX_SSE_FRAME_SIZE
          ? Effect.fail(
              new AgUiDecodeError({
                message: `An SSE frame exceeds ${MAX_SSE_FRAME_SIZE} characters.`,
              })
            )
          : Effect.succeed([tail, frames] as const);
      },
      { onHalt: (tail) => (tail.length > 0 ? [tail] : []) }
    ),
    Stream.filterMap(Filter.fromPredicateOption(frameData)),
    Stream.mapEffect(decodeEventJson),
    Stream.filterMap(Filter.fromPredicateOption((event) => event))
  );
