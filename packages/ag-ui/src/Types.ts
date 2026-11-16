/**
 * The AG-UI 1.0 data model, apart from the events: messages, content parts,
 * tools, interrupts, token usage, JSON Patch operations, agent capabilities
 * and `RunAgentInput`.
 *
 * Each schema follows one `$defs` entry of the vendored
 * `spec/1.0/schema.json`. The encoded side is the JSON that AG-UI carries:
 * camelCase keys, and an optional field omitted rather than `null`. Decoding
 * rejects an explicit `null` on an optional field and drops a key that the
 * schema does not describe, so a newer producer does not break this reader.
 * Where the specification leaves an object open by meaning (metadata,
 * activity content, a JSON Patch operation), the extra keys are kept.
 *
 * @since 0.1.0
 */
import { Predicate, Schema } from 'effect';

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/**
 * The largest integer that a JSON number carries without loss, the bound the
 * specification puts on `timestamp` and on every token count.
 *
 * @since 0.1.0
 */
export const MAX_SAFE_INTEGER = 9007199254740991;

/**
 * An integer inside the JSON safe range, as `BaseEvent.timestamp` requires.
 *
 * @since 0.1.0
 */
export const SafeInteger = Schema.Int.check(
  Schema.isBetween({ minimum: -MAX_SAFE_INTEGER, maximum: MAX_SAFE_INTEGER })
).annotate({ identifier: 'SafeInteger' });

/**
 * A non-negative integer inside the JSON safe range, as every token count
 * and execution limit requires.
 *
 * @since 0.1.0
 */
export const NonNegativeSafeInteger = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: MAX_SAFE_INTEGER })
).annotate({ identifier: 'NonNegativeSafeInteger' });

/**
 * Any JSON value, `null` included.
 *
 * @since 0.1.0
 */
export const JsonValue = Schema.Json;

/**
 * Any JSON value except `null`. The specification uses it for an optional
 * field whose value is arbitrary JSON (`rawEvent`, `result`, `payload`,
 * `forwardedProps`, a tool's `parameters`), where `null` would be an absent
 * value spelled wrongly.
 *
 * @since 0.1.0
 */
export const NonNullJson = Schema.Json.check(
  Schema.makeFilter((value: Schema.Json) => Predicate.isNotNull(value), {
    expected: 'a JSON value other than null',
  })
).annotate({ identifier: 'NonNullJson' });

/**
 * A JSON object, open by key: any JSON value is allowed under a key. It
 * types `metadata`, activity `content` and `AgentCapabilities.custom`.
 *
 * @since 0.1.0
 */
export const Metadata = Schema.JsonObject.annotate({ identifier: 'Metadata' });

/**
 * @since 0.1.0
 */
export type Metadata = typeof Metadata.Type;

/**
 * Agent state: any JSON value, `null` included. The protocol carries state
 * without reading it.
 *
 * @since 0.1.0
 */
export const State = Schema.Json.annotate({ identifier: 'State' });

/**
 * An opaque handle for one subagent invocation.
 *
 * @since 0.1.0
 */
export const SubagentRunId = Schema.String.annotate({
  identifier: 'SubagentRunId',
});

/**
 * An opaque identifier: a thread, run, message, tool call or interrupt id.
 * The protocol gives ids no format, so it is a plain string. It is not
 * branded, because every id arrives from another process as text.
 *
 * @since 0.1.0
 */
export const Id = Schema.String.annotate({ identifier: 'Id' });

/** An optional `string` field. */
const optionalString = Schema.optionalKey(Schema.String);

/** An optional `boolean` field. */
const optionalBoolean = Schema.optionalKey(Schema.Boolean);

/** An optional `metadata` field. */
const optionalMetadata = Schema.optionalKey(Metadata);

/**
 * The `subagentRunId` attribution that the `Attributable` fragment adds.
 * Absent means that the parent agent produced the value.
 *
 * @since 0.1.0
 */
export const attributable = {
  subagentRunId: Schema.optionalKey(SubagentRunId),
};

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/**
 * The roles that a streamed text message may take.
 *
 * @since 0.1.0
 */
export const TextMessageRole = Schema.Literals([
  'developer',
  'system',
  'assistant',
  'user',
]).annotate({ identifier: 'TextMessageRole' });

/**
 * @since 0.1.0
 */
export type TextMessageRole = typeof TextMessageRole.Type;

/**
 * Every role that a materialised message may have.
 *
 * @since 0.1.0
 */
export const Role = Schema.Literals([
  'developer',
  'system',
  'assistant',
  'user',
  'tool',
  'activity',
  'reasoning',
]).annotate({ identifier: 'Role' });

/**
 * @since 0.1.0
 */
export type Role = typeof Role.Type;

// ---------------------------------------------------------------------------
// Content parts
// ---------------------------------------------------------------------------

/**
 * Bytes carried inline, base64-encoded.
 *
 * @since 0.1.0
 */
export const DataSource = Schema.Struct({
  type: Schema.Literal('data'),
  value: Schema.String,
  mimeType: Schema.String,
}).annotate({ identifier: 'DataSource' });

/**
 * Bytes referenced by URL.
 *
 * @since 0.1.0
 */
export const UrlSource = Schema.Struct({
  type: Schema.Literal('url'),
  value: Schema.String,
  mimeType: optionalString,
}).annotate({ identifier: 'UrlSource' });

/**
 * Bytes already at the provider, named by a handle that it issued.
 *
 * @since 0.1.0
 */
export const FileSource = Schema.Struct({
  type: Schema.Literal('file'),
  value: Schema.String,
  provider: optionalString,
  mimeType: optionalString,
}).annotate({ identifier: 'FileSource' });

/**
 * Where a media part's bytes come from, discriminated by `type`.
 *
 * @since 0.1.0
 */
export const PartSource = Schema.Union([
  DataSource,
  UrlSource,
  FileSource,
]).annotate({ identifier: 'PartSource' });

/**
 * @since 0.1.0
 */
export type PartSource = typeof PartSource.Type;

/**
 * A text part.
 *
 * @since 0.1.0
 */
export const TextPart = Schema.Struct({
  type: Schema.Literal('text'),
  id: optionalString,
  text: Schema.String,
  metadata: Schema.optionalKey(NonNullJson),
}).annotate({ identifier: 'TextPart' });

/** The fields of a media part, whose `type` names the medium. */
const mediaPart = <const T extends string>(type: T) =>
  Schema.Struct({
    type: Schema.Literal(type),
    id: optionalString,
    source: PartSource,
    metadata: Schema.optionalKey(NonNullJson),
  });

/**
 * An image part.
 *
 * @since 0.1.0
 */
export const ImagePart = mediaPart('image').annotate({
  identifier: 'ImagePart',
});

/**
 * An audio part.
 *
 * @since 0.1.0
 */
export const AudioPart = mediaPart('audio').annotate({
  identifier: 'AudioPart',
});

/**
 * A video part.
 *
 * @since 0.1.0
 */
export const VideoPart = mediaPart('video').annotate({
  identifier: 'VideoPart',
});

/**
 * A document part.
 *
 * @since 0.1.0
 */
export const DocumentPart = mediaPart('document').annotate({
  identifier: 'DocumentPart',
});

/**
 * One part of a user message or a tool result, discriminated by `type`.
 *
 * @since 0.1.0
 */
export const ContentPart = Schema.Union([
  TextPart,
  ImagePart,
  AudioPart,
  VideoPart,
  DocumentPart,
]).annotate({ identifier: 'ContentPart' });

/**
 * @since 0.1.0
 */
export type ContentPart = typeof ContentPart.Type;

/**
 * Plain text, or an ordered list of parts: the content of a user message, a
 * tool message and `TOOL_CALL_RESULT`.
 *
 * @since 0.1.0
 */
export const PartsContent = Schema.Union([
  Schema.String,
  Schema.Array(ContentPart),
]).annotate({ identifier: 'PartsContent' });

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * The name and arguments of a tool call. `arguments` is JSON text, kept as
 * written.
 *
 * @since 0.1.0
 */
export const FunctionCall = Schema.Struct({
  name: Schema.String,
  arguments: Schema.String,
}).annotate({ identifier: 'FunctionCall' });

/**
 * A call that an assistant message made.
 *
 * @since 0.1.0
 */
export const ToolCall = Schema.Struct({
  id: Id,
  type: Schema.Literal('function'),
  function: FunctionCall,
  encryptedValue: optionalString,
  metadata: optionalMetadata,
}).annotate({ identifier: 'ToolCall' });

/**
 * @since 0.1.0
 */
export type ToolCall = typeof ToolCall.Type;

/** The fields that `BaseMessage` gives the developer, system, assistant and user messages. */
const baseMessage = {
  id: Id,
  name: optionalString,
  encryptedValue: optionalString,
  metadata: optionalMetadata,
  ...attributable,
};

/**
 * Instructions from the application developer.
 *
 * @since 0.1.0
 */
export const DeveloperMessage = Schema.Struct({
  ...baseMessage,
  role: Schema.Literal('developer'),
  content: Schema.String,
}).annotate({ identifier: 'DeveloperMessage' });

/**
 * Instructions from the system.
 *
 * @since 0.1.0
 */
export const SystemMessage = Schema.Struct({
  ...baseMessage,
  role: Schema.Literal('system'),
  content: Schema.String,
}).annotate({ identifier: 'SystemMessage' });

/**
 * A message from the agent. `content` is optional because a turn may hold
 * only tool calls.
 *
 * @since 0.1.0
 */
export const AssistantMessage = Schema.Struct({
  ...baseMessage,
  role: Schema.Literal('assistant'),
  content: optionalString,
  toolCalls: Schema.optionalKey(Schema.Array(ToolCall)),
}).annotate({ identifier: 'AssistantMessage' });

/**
 * A message from the person who uses the application.
 *
 * @since 0.1.0
 */
export const UserMessage = Schema.Struct({
  ...baseMessage,
  role: Schema.Literal('user'),
  content: PartsContent,
}).annotate({ identifier: 'UserMessage' });

/**
 * What a tool returned, as a message in the conversation.
 *
 * @since 0.1.0
 */
export const ToolMessage = Schema.Struct({
  id: Id,
  role: Schema.Literal('tool'),
  content: PartsContent,
  toolCallId: Id,
  error: optionalString,
  encryptedValue: optionalString,
  metadata: optionalMetadata,
  ...attributable,
}).annotate({ identifier: 'ToolMessage' });

/**
 * Structured progress, materialised as a message.
 *
 * @since 0.1.0
 */
export const ActivityMessage = Schema.Struct({
  id: Id,
  role: Schema.Literal('activity'),
  activityType: Schema.String,
  content: Metadata,
  metadata: optionalMetadata,
  ...attributable,
}).annotate({ identifier: 'ActivityMessage' });

/**
 * A span of the agent's reasoning, materialised as a message.
 *
 * @since 0.1.0
 */
export const ReasoningMessage = Schema.Struct({
  id: Id,
  role: Schema.Literal('reasoning'),
  content: Schema.String,
  encryptedValue: optionalString,
  metadata: optionalMetadata,
  ...attributable,
}).annotate({ identifier: 'ReasoningMessage' });

/**
 * Any message in a conversation, discriminated by `role`.
 *
 * @since 0.1.0
 */
export const Message = Schema.Union([
  DeveloperMessage,
  SystemMessage,
  AssistantMessage,
  UserMessage,
  ToolMessage,
  ActivityMessage,
  ReasoningMessage,
]).annotate({ identifier: 'Message' });

/**
 * @since 0.1.0
 */
export type Message = typeof Message.Type;

// ---------------------------------------------------------------------------
// Run input
// ---------------------------------------------------------------------------

/**
 * A named piece of ambient information given to the agent for the run.
 *
 * @since 0.1.0
 */
export const Context = Schema.Struct({
  description: Schema.String,
  value: Schema.String,
}).annotate({ identifier: 'Context' });

/**
 * A tool that the agent may call. `parameters` is a JSON Schema, carried
 * opaquely.
 *
 * @since 0.1.0
 */
export const Tool = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  parameters: Schema.optionalKey(NonNullJson),
  metadata: optionalMetadata,
}).annotate({ identifier: 'Tool' });

/**
 * @since 0.1.0
 */
export type Tool = typeof Tool.Type;

/**
 * An answer to one interrupt, sent on the run that continues from it.
 *
 * @since 0.1.0
 */
export const ResumeEntry = Schema.Struct({
  interruptId: Id,
  status: Schema.Literals(['resolved', 'cancelled']),
  payload: Schema.optionalKey(NonNullJson),
  metadata: optionalMetadata,
}).annotate({ identifier: 'ResumeEntry' });

/**
 * A request to run an agent: the body of the HTTP POST, and the echo in
 * `RUN_STARTED.input`.
 *
 * @since 0.1.0
 */
export const RunAgentInput = Schema.Struct({
  threadId: Id,
  runId: Id,
  protocolVersion: optionalString,
  parentRunId: optionalString,
  state: Schema.optionalKey(NonNullJson),
  messages: Schema.Array(Message),
  tools: Schema.optionalKey(Schema.Array(Tool)),
  context: Schema.optionalKey(Schema.Array(Context)),
  forwardedProps: Schema.optionalKey(NonNullJson),
  resume: Schema.optionalKey(Schema.Array(ResumeEntry)),
}).annotate({ identifier: 'RunAgentInput' });

/**
 * @since 0.1.0
 */
export type RunAgentInput = typeof RunAgentInput.Type;

// ---------------------------------------------------------------------------
// Run outcomes
// ---------------------------------------------------------------------------

/**
 * Something that a run needs from outside before it can continue.
 *
 * @since 0.1.0
 */
export const Interrupt = Schema.Struct({
  id: Id,
  reason: Schema.String,
  message: optionalString,
  toolCallId: optionalString,
  responseSchema: Schema.optionalKey(Schema.JsonObject),
  expiresAt: optionalString,
  metadata: optionalMetadata,
  ...attributable,
}).annotate({ identifier: 'Interrupt' });

/**
 * @since 0.1.0
 */
export type Interrupt = typeof Interrupt.Type;

/**
 * Token counts for one provider and model.
 *
 * @since 0.1.0
 */
export const TokenUsage = Schema.Struct({
  provider: optionalString,
  model: optionalString,
  inputTokens: Schema.optionalKey(NonNegativeSafeInteger),
  outputTokens: Schema.optionalKey(NonNegativeSafeInteger),
  totalTokens: Schema.optionalKey(NonNegativeSafeInteger),
  reasoningTokens: Schema.optionalKey(NonNegativeSafeInteger),
  cachedInputTokens: Schema.optionalKey(NonNegativeSafeInteger),
  cacheWriteInputTokens: Schema.optionalKey(NonNegativeSafeInteger),
}).annotate({ identifier: 'TokenUsage' });

/**
 * @since 0.1.0
 */
export type TokenUsage = typeof TokenUsage.Type;

/**
 * The run completed. Equivalent to an absent outcome.
 *
 * @since 0.1.0
 */
export const RunFinishedSuccessOutcome = Schema.Struct({
  type: Schema.Literal('success'),
  pendingToolCallIds: Schema.optionalKey(Schema.Array(Schema.String)),
}).annotate({ identifier: 'RunFinishedSuccessOutcome' });

/**
 * The run is paused, waiting for the interrupts to be answered.
 *
 * @since 0.1.0
 */
export const RunFinishedInterruptOutcome = Schema.Struct({
  type: Schema.Literal('interrupt'),
  interrupts: Schema.NonEmptyArray(Interrupt),
}).annotate({ identifier: 'RunFinishedInterruptOutcome' });

/**
 * The run was stopped before it completed, and did not fail.
 *
 * @since 0.1.0
 */
export const RunFinishedCancelledOutcome = Schema.Struct({
  type: Schema.Literal('cancelled'),
}).annotate({ identifier: 'RunFinishedCancelledOutcome' });

/**
 * Why a run ended, discriminated by `type`.
 *
 * @since 0.1.0
 */
export const RunFinishedOutcome = Schema.Union([
  RunFinishedSuccessOutcome,
  RunFinishedInterruptOutcome,
  RunFinishedCancelledOutcome,
]).annotate({ identifier: 'RunFinishedOutcome' });

/**
 * @since 0.1.0
 */
export type RunFinishedOutcome = typeof RunFinishedOutcome.Type;

/**
 * The subagent completed its work. Equivalent to an absent outcome.
 *
 * @since 0.1.0
 */
export const SubagentFinishedSuccessOutcome = Schema.Struct({
  type: Schema.Literal('success'),
}).annotate({ identifier: 'SubagentFinishedSuccessOutcome' });

/**
 * The subagent is paused, awaiting outside input.
 *
 * @since 0.1.0
 */
export const SubagentFinishedSuspendedOutcome = Schema.Struct({
  type: Schema.Literal('suspended'),
  interruptIds: Schema.optionalKey(Schema.Array(Schema.String)),
}).annotate({ identifier: 'SubagentFinishedSuspendedOutcome' });

/**
 * Why a subagent's segment of a run ended, discriminated by `type`.
 *
 * @since 0.1.0
 */
export const SubagentFinishedOutcome = Schema.Union([
  SubagentFinishedSuccessOutcome,
  SubagentFinishedSuspendedOutcome,
]).annotate({ identifier: 'SubagentFinishedOutcome' });

/**
 * @since 0.1.0
 */
export type SubagentFinishedOutcome = typeof SubagentFinishedOutcome.Type;

// ---------------------------------------------------------------------------
// JSON Patch
// ---------------------------------------------------------------------------

/**
 * An RFC 6901 JSON Pointer: the empty string, or slash-prefixed reference
 * tokens with `~0` and `~1` escapes.
 *
 * @since 0.1.0
 */
export const JsonPointer = Schema.String.check(
  Schema.isPattern(/^(\/([^/~]|~[01])*)*$/, { expected: 'a JSON Pointer' })
).annotate({ identifier: 'JsonPointer' });

/**
 * One RFC 6902 operation shape. RFC 6902 requires a member that an operation
 * does not define to be ignored rather than rejected, so the extra keys are
 * kept rather than dropped.
 */
const patchOperation = <const Op extends string, F extends Schema.Struct.Fields>(
  op: Op,
  fields: F
) =>
  Schema.StructWithRest(
    Schema.Struct({ op: Schema.Literal(op), ...fields }),
    [Schema.Record(Schema.String, Schema.Json)]
  );

/**
 * Inserts `value` at `path`.
 *
 * @since 0.1.0
 */
export const AddOperation = patchOperation('add', {
  path: JsonPointer,
  value: Schema.Json,
}).annotate({ identifier: 'AddOperation' });

/**
 * Removes the value at `path`.
 *
 * @since 0.1.0
 */
export const RemoveOperation = patchOperation('remove', {
  path: JsonPointer,
}).annotate({ identifier: 'RemoveOperation' });

/**
 * Replaces the value at `path`.
 *
 * @since 0.1.0
 */
export const ReplaceOperation = patchOperation('replace', {
  path: JsonPointer,
  value: Schema.Json,
}).annotate({ identifier: 'ReplaceOperation' });

/**
 * Moves the value at `from` to `path`.
 *
 * @since 0.1.0
 */
export const MoveOperation = patchOperation('move', {
  from: JsonPointer,
  path: JsonPointer,
}).annotate({ identifier: 'MoveOperation' });

/**
 * Copies the value at `from` to `path`.
 *
 * @since 0.1.0
 */
export const CopyOperation = patchOperation('copy', {
  from: JsonPointer,
  path: JsonPointer,
}).annotate({ identifier: 'CopyOperation' });

/**
 * Asserts that the value at `path` equals `value`.
 *
 * @since 0.1.0
 */
export const TestOperation = patchOperation('test', {
  path: JsonPointer,
  value: Schema.Json,
}).annotate({ identifier: 'TestOperation' });

/**
 * One RFC 6902 operation, discriminated by `op`.
 *
 * @since 0.1.0
 */
export const JsonPatchOperation = Schema.Union([
  AddOperation,
  RemoveOperation,
  ReplaceOperation,
  MoveOperation,
  CopyOperation,
  TestOperation,
]).annotate({ identifier: 'JsonPatchOperation' });

/**
 * @since 0.1.0
 */
export type JsonPatchOperation = typeof JsonPatchOperation.Type;

/**
 * An RFC 6902 JSON Patch document. An empty array is a valid no-op.
 *
 * @since 0.1.0
 */
export const JsonPatch = Schema.Array(JsonPatchOperation).annotate({
  identifier: 'JsonPatch',
});

/**
 * @since 0.1.0
 */
export type JsonPatch = typeof JsonPatch.Type;

// ---------------------------------------------------------------------------
// Agent capabilities
// ---------------------------------------------------------------------------

/**
 * A subagent that a parent agent can invoke.
 *
 * @since 0.1.0
 */
export const SubagentInfo = Schema.Struct({
  name: Schema.String,
  description: optionalString,
}).annotate({ identifier: 'SubagentInfo' });

/**
 * Basic metadata about the agent.
 *
 * @since 0.1.0
 */
export const IdentityCapabilities = Schema.Struct({
  name: optionalString,
  type: optionalString,
  description: optionalString,
  version: optionalString,
  provider: optionalString,
  documentationUrl: optionalString,
  metadata: optionalMetadata,
}).annotate({ identifier: 'IdentityCapabilities' });

/**
 * The transports that the agent supports.
 *
 * @since 0.1.0
 */
export const TransportCapabilities = Schema.Struct({
  streaming: optionalBoolean,
  websocket: optionalBoolean,
  httpBinary: optionalBoolean,
  pushNotifications: optionalBoolean,
  resumable: optionalBoolean,
}).annotate({ identifier: 'TransportCapabilities' });

/**
 * Tool calling capabilities.
 *
 * @since 0.1.0
 */
export const ToolsCapabilities = Schema.Struct({
  supported: optionalBoolean,
  items: Schema.optionalKey(Schema.Array(Tool)),
  parallelCalls: optionalBoolean,
  clientProvided: optionalBoolean,
}).annotate({ identifier: 'ToolsCapabilities' });

/**
 * Output format support.
 *
 * @since 0.1.0
 */
export const OutputCapabilities = Schema.Struct({
  structuredOutput: optionalBoolean,
  supportedMimeTypes: Schema.optionalKey(Schema.Array(Schema.String)),
}).annotate({ identifier: 'OutputCapabilities' });

/**
 * State and memory capabilities.
 *
 * @since 0.1.0
 */
export const StateCapabilities = Schema.Struct({
  snapshots: optionalBoolean,
  deltas: optionalBoolean,
  memory: optionalBoolean,
  persistentState: optionalBoolean,
}).annotate({ identifier: 'StateCapabilities' });

/**
 * Multi-agent coordination capabilities.
 *
 * @since 0.1.0
 */
export const MultiAgentCapabilities = Schema.Struct({
  supported: optionalBoolean,
  delegation: optionalBoolean,
  handoffs: optionalBoolean,
  subagents: Schema.optionalKey(Schema.Array(SubagentInfo)),
}).annotate({ identifier: 'MultiAgentCapabilities' });

/**
 * Reasoning capabilities.
 *
 * @since 0.1.0
 */
export const ReasoningCapabilities = Schema.Struct({
  supported: optionalBoolean,
  streaming: optionalBoolean,
  encrypted: optionalBoolean,
}).annotate({ identifier: 'ReasoningCapabilities' });

/**
 * The modalities that the agent accepts as input.
 *
 * @since 0.1.0
 */
export const MultimodalInputCapabilities = Schema.Struct({
  image: optionalBoolean,
  audio: optionalBoolean,
  video: optionalBoolean,
  pdf: optionalBoolean,
  file: optionalBoolean,
}).annotate({ identifier: 'MultimodalInputCapabilities' });

/**
 * The modalities that the agent produces as output.
 *
 * @since 0.1.0
 */
export const MultimodalOutputCapabilities = Schema.Struct({
  image: optionalBoolean,
  audio: optionalBoolean,
}).annotate({ identifier: 'MultimodalOutputCapabilities' });

/**
 * Multimodal input and output support.
 *
 * @since 0.1.0
 */
export const MultimodalCapabilities = Schema.Struct({
  input: Schema.optionalKey(MultimodalInputCapabilities),
  output: Schema.optionalKey(MultimodalOutputCapabilities),
}).annotate({ identifier: 'MultimodalCapabilities' });

/**
 * Execution control and limits.
 *
 * @since 0.1.0
 */
export const ExecutionCapabilities = Schema.Struct({
  codeExecution: optionalBoolean,
  sandboxed: optionalBoolean,
  maxIterations: Schema.optionalKey(NonNegativeSafeInteger),
  maxExecutionTime: Schema.optionalKey(NonNegativeSafeInteger),
}).annotate({ identifier: 'ExecutionCapabilities' });

/**
 * Human-in-the-loop support.
 *
 * @since 0.1.0
 */
export const HumanInTheLoopCapabilities = Schema.Struct({
  supported: optionalBoolean,
  approvals: optionalBoolean,
  interventions: optionalBoolean,
  feedback: optionalBoolean,
  interrupts: optionalBoolean,
  approveWithEdits: optionalBoolean,
}).annotate({ identifier: 'HumanInTheLoopCapabilities' });

/**
 * A typed snapshot of an agent's capabilities. An omitted field means that
 * the capability is not declared, not that it is unsupported.
 *
 * @since 0.1.0
 */
export const AgentCapabilities = Schema.Struct({
  identity: Schema.optionalKey(IdentityCapabilities),
  transport: Schema.optionalKey(TransportCapabilities),
  tools: Schema.optionalKey(ToolsCapabilities),
  output: Schema.optionalKey(OutputCapabilities),
  state: Schema.optionalKey(StateCapabilities),
  multiAgent: Schema.optionalKey(MultiAgentCapabilities),
  reasoning: Schema.optionalKey(ReasoningCapabilities),
  multimodal: Schema.optionalKey(MultimodalCapabilities),
  execution: Schema.optionalKey(ExecutionCapabilities),
  humanInTheLoop: Schema.optionalKey(HumanInTheLoopCapabilities),
  custom: optionalMetadata,
}).annotate({ identifier: 'AgentCapabilities' });

/**
 * @since 0.1.0
 */
export type AgentCapabilities = typeof AgentCapabilities.Type;
