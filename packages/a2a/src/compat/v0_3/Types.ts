/**
 * The A2A v0.3 data model of the JSON-RPC binding, as Effect Schemas.
 *
 * Each schema mirrors one definition of the vendored
 * `spec/json/v0_3/a2a.json`: the `kind` and `type` discriminators, lowercase
 * task states and roles, and base64 file bytes as strings. The type and the
 * JSON form are the same; decoding validates and drops unknown fields.
 *
 * @since 0.1.0
 */
import { Schema } from 'effect';

/** Field schemas shared by the definitions below. An optional string field. */
const optionalString = Schema.optionalKey(Schema.String);
/** A required id, such as a message, task, context or artifact id. Any string is accepted. */
const Identifier = Schema.String.annotate({ description: 'An identifier.' });
/** An optional list of strings, such as extension URIs or media types. */
const optionalStrings = Schema.optionalKey(Schema.Array(Schema.String));
/** The optional free-form `metadata` object that most v0.3 definitions carry. */
const optionalMetadata = Schema.optionalKey(Schema.JsonObject);
/** A map of OAuth scope names to their descriptions. */
const Scopes = Schema.Record(Schema.String, Schema.String);

/**
 * The v0.3 task states.
 *
 * @since 0.1.0
 */
export const TaskState = Schema.Literals([
  'submitted',
  'working',
  'input-required',
  'completed',
  'canceled',
  'failed',
  'rejected',
  'auth-required',
  'unknown',
]).annotate({ identifier: 'V03TaskState' });

/**
 * @since 0.1.0
 */
export type TaskState = typeof TaskState.Type;

/**
 * The v0.3 roles.
 *
 * @since 0.1.0
 */
export const Role = Schema.Literals(['user', 'agent']).annotate({
  identifier: 'V03Role',
});

/**
 * @since 0.1.0
 */
export type Role = typeof Role.Type;

/**
 * A text part.
 *
 * @since 0.1.0
 */
export const TextPart = Schema.Struct({
  kind: Schema.Literal('text'),
  text: Schema.String,
  metadata: optionalMetadata,
}).annotate({ identifier: 'V03TextPart' });

/**
 * File content as base64 bytes.
 *
 * @since 0.1.0
 */
export const FileWithBytes = Schema.Struct({
  bytes: Schema.String,
  mimeType: optionalString,
  name: optionalString,
}).annotate({ identifier: 'V03FileWithBytes' });

/**
 * File content at a URI.
 *
 * @since 0.1.0
 */
export const FileWithUri = Schema.Struct({
  uri: Schema.String,
  mimeType: optionalString,
  name: optionalString,
}).annotate({ identifier: 'V03FileWithUri' });

/**
 * A file part.
 *
 * @since 0.1.0
 */
export const FilePart = Schema.Struct({
  kind: Schema.Literal('file'),
  file: Schema.Union([FileWithBytes, FileWithUri]),
  metadata: optionalMetadata,
}).annotate({ identifier: 'V03FilePart' });

/**
 * A structured data part.
 *
 * @since 0.1.0
 */
export const DataPart = Schema.Struct({
  kind: Schema.Literal('data'),
  data: Schema.Json,
  metadata: optionalMetadata,
}).annotate({ identifier: 'V03DataPart' });

/**
 * A part of a message or an artifact.
 *
 * @since 0.1.0
 */
export const Part = Schema.Union([TextPart, FilePart, DataPart]).annotate({
  identifier: 'V03Part',
});

/**
 * @since 0.1.0
 */
export type Part = typeof Part.Type;

/**
 * A message. `kind` may be absent in a request, as the reference SDK
 * accepts.
 *
 * @since 0.1.0
 */
export const Message = Schema.Struct({
  kind: Schema.optionalKey(Schema.Literal('message')),
  messageId: Identifier,
  role: Role,
  parts: Schema.Array(Part),
  contextId: optionalString,
  taskId: optionalString,
  metadata: optionalMetadata,
  extensions: optionalStrings,
  referenceTaskIds: optionalStrings,
}).annotate({ identifier: 'V03Message' });

/**
 * @since 0.1.0
 */
export type Message = typeof Message.Type;

/**
 * The status of a task.
 *
 * @since 0.1.0
 */
export const TaskStatus = Schema.Struct({
  state: TaskState,
  message: Schema.optionalKey(Message),
  timestamp: optionalString,
}).annotate({ identifier: 'V03TaskStatus' });

/**
 * @since 0.1.0
 */
export type TaskStatus = typeof TaskStatus.Type;

/**
 * An output of a task.
 *
 * @since 0.1.0
 */
export const Artifact = Schema.Struct({
  artifactId: Identifier,
  parts: Schema.Array(Part),
  name: optionalString,
  description: optionalString,
  metadata: optionalMetadata,
  extensions: optionalStrings,
}).annotate({ identifier: 'V03Artifact' });

/**
 * @since 0.1.0
 */
export type Artifact = typeof Artifact.Type;

/**
 * A task.
 *
 * @since 0.1.0
 */
export const Task = Schema.Struct({
  kind: Schema.Literal('task'),
  id: Identifier,
  contextId: Identifier,
  status: TaskStatus,
  history: Schema.optionalKey(Schema.Array(Message)),
  artifacts: Schema.optionalKey(Schema.Array(Artifact)),
  metadata: optionalMetadata,
}).annotate({ identifier: 'V03Task' });

/**
 * @since 0.1.0
 */
export type Task = typeof Task.Type;

/**
 * A status update of a task.
 *
 * @since 0.1.0
 */
export const TaskStatusUpdateEvent = Schema.Struct({
  kind: Schema.Literal('status-update'),
  taskId: Identifier,
  contextId: Identifier,
  status: TaskStatus,
  final: Schema.Boolean,
  metadata: optionalMetadata,
}).annotate({ identifier: 'V03TaskStatusUpdateEvent' });

/**
 * @since 0.1.0
 */
export type TaskStatusUpdateEvent = typeof TaskStatusUpdateEvent.Type;

/**
 * An artifact update of a task.
 *
 * @since 0.1.0
 */
export const TaskArtifactUpdateEvent = Schema.Struct({
  kind: Schema.Literal('artifact-update'),
  taskId: Identifier,
  contextId: Identifier,
  artifact: Artifact,
  append: Schema.optionalKey(Schema.Boolean),
  lastChunk: Schema.optionalKey(Schema.Boolean),
  metadata: optionalMetadata,
}).annotate({ identifier: 'V03TaskArtifactUpdateEvent' });

/**
 * @since 0.1.0
 */
export type TaskArtifactUpdateEvent = typeof TaskArtifactUpdateEvent.Type;

/**
 * The result of a send message call.
 *
 * @since 0.1.0
 */
export const SendMessageResult = Schema.Union([Task, Message]).annotate({
  identifier: 'V03SendMessageResult',
});

/**
 * @since 0.1.0
 */
export type SendMessageResult = typeof SendMessageResult.Type;

/**
 * One event of a v0.3 stream.
 *
 * @since 0.1.0
 */
export const StreamEvent = Schema.Union([
  Task,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  Message,
]).annotate({ identifier: 'V03StreamEvent' });

/**
 * @since 0.1.0
 */
export type StreamEvent = typeof StreamEvent.Type;

/**
 * The credentials of push notifications.
 *
 * @since 0.1.0
 */
export const PushNotificationAuthenticationInfo = Schema.Struct({
  schemes: Schema.Array(Schema.String),
  credentials: optionalString,
}).annotate({ identifier: 'V03PushNotificationAuthenticationInfo' });

/**
 * A push notification webhook.
 *
 * @since 0.1.0
 */
export const PushNotificationConfig = Schema.Struct({
  url: Schema.String,
  id: optionalString,
  token: optionalString,
  authentication: Schema.optionalKey(PushNotificationAuthenticationInfo),
}).annotate({ identifier: 'V03PushNotificationConfig' });

/**
 * @since 0.1.0
 */
export type PushNotificationConfig = typeof PushNotificationConfig.Type;

/**
 * The push notification webhook of a task.
 *
 * @since 0.1.0
 */
export const TaskPushNotificationConfig = Schema.Struct({
  taskId: Identifier,
  pushNotificationConfig: PushNotificationConfig,
}).annotate({ identifier: 'V03TaskPushNotificationConfig' });

/**
 * @since 0.1.0
 */
export type TaskPushNotificationConfig = typeof TaskPushNotificationConfig.Type;

/**
 * The configuration of a send message call.
 *
 * @since 0.1.0
 */
export const MessageSendConfiguration = Schema.Struct({
  acceptedOutputModes: optionalStrings,
  blocking: Schema.optionalKey(Schema.Boolean),
  historyLength: Schema.optionalKey(Schema.Int),
  pushNotificationConfig: Schema.optionalKey(PushNotificationConfig),
}).annotate({ identifier: 'V03MessageSendConfiguration' });

/**
 * The parameters of `message/send` and `message/stream`.
 *
 * @since 0.1.0
 */
export const MessageSendParams = Schema.Struct({
  message: Message,
  configuration: Schema.optionalKey(MessageSendConfiguration),
  metadata: optionalMetadata,
}).annotate({ identifier: 'V03MessageSendParams' });

/**
 * @since 0.1.0
 */
export type MessageSendParams = typeof MessageSendParams.Type;

/**
 * The parameters of `tasks/get`.
 *
 * @since 0.1.0
 */
export const TaskQueryParams = Schema.Struct({
  id: Identifier,
  historyLength: Schema.optionalKey(Schema.Int),
  metadata: optionalMetadata,
}).annotate({ identifier: 'V03TaskQueryParams' });

/**
 * The parameters of `tasks/cancel` and `tasks/resubscribe`.
 *
 * @since 0.1.0
 */
export const TaskIdParams = Schema.Struct({
  id: Identifier,
  metadata: optionalMetadata,
}).annotate({ identifier: 'V03TaskIdParams' });

/**
 * The parameters of `tasks/pushNotificationConfig/get`.
 *
 * @since 0.1.0
 */
export const GetTaskPushNotificationConfigParams = Schema.Struct({
  id: Identifier,
  pushNotificationConfigId: optionalString,
  metadata: optionalMetadata,
}).annotate({ identifier: 'V03GetTaskPushNotificationConfigParams' });

/**
 * The parameters of `tasks/pushNotificationConfig/delete`.
 *
 * @since 0.1.0
 */
export const DeleteTaskPushNotificationConfigParams = Schema.Struct({
  id: Identifier,
  pushNotificationConfigId: Identifier,
  metadata: optionalMetadata,
}).annotate({ identifier: 'V03DeleteTaskPushNotificationConfigParams' });

/**
 * The parameters of `tasks/pushNotificationConfig/list`.
 *
 * @since 0.1.0
 */
export const ListTaskPushNotificationConfigParams = Schema.Struct({
  id: Identifier,
  metadata: optionalMetadata,
}).annotate({ identifier: 'V03ListTaskPushNotificationConfigParams' });

// ---------------------------------------------------------------------------
// Agent Card
// ---------------------------------------------------------------------------

/**
 * A security requirement: scheme name to scopes.
 *
 * @since 0.1.0
 */
export const SecurityRequirement = Schema.Record(
  Schema.String,
  Schema.Array(Schema.String)
).annotate({ identifier: 'V03SecurityRequirement' });

/**
 * @since 0.1.0
 */
export type SecurityRequirement = typeof SecurityRequirement.Type;

/** @since 0.1.0 */
export const AuthorizationCodeOAuthFlow = Schema.Struct({
  authorizationUrl: Schema.String,
  tokenUrl: Schema.String,
  scopes: Scopes,
  refreshUrl: optionalString,
}).annotate({ identifier: 'V03AuthorizationCodeOAuthFlow' });

/** @since 0.1.0 */
export const ClientCredentialsOAuthFlow = Schema.Struct({
  tokenUrl: Schema.String,
  scopes: Scopes,
  refreshUrl: optionalString,
}).annotate({ identifier: 'V03ClientCredentialsOAuthFlow' });

/** @since 0.1.0 */
export const ImplicitOAuthFlow = Schema.Struct({
  authorizationUrl: Schema.String,
  scopes: Scopes,
  refreshUrl: optionalString,
}).annotate({ identifier: 'V03ImplicitOAuthFlow' });

/** @since 0.1.0 */
export const PasswordOAuthFlow = Schema.Struct({
  tokenUrl: Schema.String,
  scopes: Scopes,
  refreshUrl: optionalString,
}).annotate({ identifier: 'V03PasswordOAuthFlow' });

/**
 * The OAuth 2.0 flows of a scheme.
 *
 * @since 0.1.0
 */
export const OAuthFlows = Schema.Struct({
  authorizationCode: Schema.optionalKey(AuthorizationCodeOAuthFlow),
  clientCredentials: Schema.optionalKey(ClientCredentialsOAuthFlow),
  implicit: Schema.optionalKey(ImplicitOAuthFlow),
  password: Schema.optionalKey(PasswordOAuthFlow),
}).annotate({ identifier: 'V03OAuthFlows' });

/**
 * @since 0.1.0
 */
export type OAuthFlows = typeof OAuthFlows.Type;

/**
 * A security scheme, discriminated by `type`.
 *
 * @since 0.1.0
 */
export const SecurityScheme = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('apiKey'),
    name: Schema.String,
    in: Schema.String,
    description: optionalString,
  }),
  Schema.Struct({
    type: Schema.Literal('http'),
    scheme: Schema.String,
    bearerFormat: optionalString,
    description: optionalString,
  }),
  Schema.Struct({
    type: Schema.Literal('oauth2'),
    flows: OAuthFlows,
    oauth2MetadataUrl: optionalString,
    description: optionalString,
  }),
  Schema.Struct({
    type: Schema.Literal('openIdConnect'),
    openIdConnectUrl: Schema.String,
    description: optionalString,
  }),
  Schema.Struct({
    type: Schema.Literal('mutualTLS'),
    description: optionalString,
  }),
]).annotate({ identifier: 'V03SecurityScheme' });

/**
 * @since 0.1.0
 */
export type SecurityScheme = typeof SecurityScheme.Type;

/** @since 0.1.0 */
export const AgentInterface = Schema.Struct({
  url: Schema.String,
  transport: Schema.String,
}).annotate({ identifier: 'V03AgentInterface' });

/** @since 0.1.0 */
export const AgentProvider = Schema.Struct({
  url: Schema.String,
  organization: Schema.String,
}).annotate({ identifier: 'V03AgentProvider' });

/** @since 0.1.0 */
export const AgentExtension = Schema.Struct({
  uri: Schema.String,
  description: optionalString,
  required: Schema.optionalKey(Schema.Boolean),
  params: optionalMetadata,
}).annotate({ identifier: 'V03AgentExtension' });

/** @since 0.1.0 */
export const AgentCapabilities = Schema.Struct({
  streaming: Schema.optionalKey(Schema.Boolean),
  pushNotifications: Schema.optionalKey(Schema.Boolean),
  stateTransitionHistory: Schema.optionalKey(Schema.Boolean),
  extensions: Schema.optionalKey(Schema.Array(AgentExtension)),
}).annotate({ identifier: 'V03AgentCapabilities' });

/** @since 0.1.0 */
export const AgentSkill = Schema.Struct({
  id: Identifier,
  name: Schema.String,
  description: Schema.String,
  tags: Schema.Array(Schema.String),
  examples: optionalStrings,
  inputModes: optionalStrings,
  outputModes: optionalStrings,
  security: Schema.optionalKey(Schema.Array(SecurityRequirement)),
}).annotate({ identifier: 'V03AgentSkill' });

/** @since 0.1.0 */
export const AgentCardSignature = Schema.Struct({
  protected: Schema.String,
  signature: Schema.String,
  header: optionalMetadata,
}).annotate({ identifier: 'V03AgentCardSignature' });

/**
 * A v1.0 agent interface, embedded in a v0.3 card by a v1.0 server so that
 * a v1.0 client can find its v1.0 interfaces.
 *
 * @since 0.1.0
 */
export const EmbeddedAgentInterface = Schema.Struct({
  url: Schema.String,
  protocolBinding: Schema.String,
  tenant: optionalString,
  protocolVersion: optionalString,
}).annotate({ identifier: 'V03EmbeddedAgentInterface' });

/**
 * A v0.3 Agent Card.
 *
 * @since 0.1.0
 */
export const AgentCard = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  version: Schema.String,
  url: Schema.String,
  protocolVersion: Schema.String,
  preferredTransport: optionalString,
  additionalInterfaces: Schema.optionalKey(Schema.Array(AgentInterface)),
  capabilities: AgentCapabilities,
  defaultInputModes: Schema.Array(Schema.String),
  defaultOutputModes: Schema.Array(Schema.String),
  skills: Schema.Array(AgentSkill),
  provider: Schema.optionalKey(AgentProvider),
  documentationUrl: optionalString,
  iconUrl: optionalString,
  supportsAuthenticatedExtendedCard: Schema.optionalKey(Schema.Boolean),
  securitySchemes: Schema.optionalKey(
    Schema.Record(Schema.String, SecurityScheme)
  ),
  security: Schema.optionalKey(Schema.Array(SecurityRequirement)),
  signatures: Schema.optionalKey(Schema.Array(AgentCardSignature)),
  supportedInterfaces: Schema.optionalKey(Schema.Array(EmbeddedAgentInterface)),
}).annotate({ identifier: 'V03AgentCard' });

/**
 * @since 0.1.0
 */
export type AgentCard = typeof AgentCard.Type;
