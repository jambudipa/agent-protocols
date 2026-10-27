/**
 * The A2A v1.0 data model as Effect Schemas, in ProtoJSON form.
 *
 * Each schema mirrors one message of the vendored `spec/proto/v1/a2a.proto`
 * (package `lf.a2a.v1`). The encoded side is the JSON that every A2A JSON
 * binding carries: lowerCamelCase field names, enum value names, a `oneof` as
 * the key of its set member, base64 `bytes` and RFC 3339 timestamps. Unknown
 * fields are dropped when decoding.
 *
 * ProtoJSON omits a field that holds its default value. A field that the
 * specification marks REQUIRED therefore decodes a missing key to its proto3
 * default and is always present in the decoded type. Every other field is an
 * optional key. A `oneof` is a union of one struct for each member, so
 * `"text" in part` tells the members apart.
 *
 * @since 0.1.0
 */
import { Schema } from 'effect';
import {
  Int32,
  Struct,
  StringMap,
  Timestamp,
  optionalBoolean,
  optionalInt32,
  optionalString,
  optionalStrings,
  optionalStruct,
  protoEnum,
  required,
  requiredString,
  requiredStrings,
} from './internal/proto.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * The value names of `TaskState`, in protobuf number order.
 *
 * @since 0.1.0
 */
export const TaskStateNames = [
  'TASK_STATE_UNSPECIFIED',
  'TASK_STATE_SUBMITTED',
  'TASK_STATE_WORKING',
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_INPUT_REQUIRED',
  'TASK_STATE_REJECTED',
  'TASK_STATE_AUTH_REQUIRED',
] as const;

/**
 * The lifecycle state of a task. It decodes the value name or its number and
 * encodes the value name.
 *
 * @since 0.1.0
 */
export const TaskState = protoEnum(TaskStateNames).annotate({
  identifier: 'TaskState',
});

/**
 * @since 0.1.0
 */
export type TaskState = typeof TaskState.Type;

/**
 * The value names of `Role`, in protobuf number order.
 *
 * @since 0.1.0
 */
export const RoleNames = [
  'ROLE_UNSPECIFIED',
  'ROLE_USER',
  'ROLE_AGENT',
] as const;

/**
 * The sender of a message.
 *
 * @since 0.1.0
 */
export const Role = protoEnum(RoleNames).annotate({ identifier: 'Role' });

/**
 * @since 0.1.0
 */
export type Role = typeof Role.Type;

// ---------------------------------------------------------------------------
// Parts, messages and artifacts
// ---------------------------------------------------------------------------

/**
 * The fields that every part kind carries beside its content, spread into each
 * part schema so that the four kinds stay in step.
 */
const PartFields = {
  metadata: optionalStruct,
  filename: optionalString,
  mediaType: optionalString,
};

/**
 * A part whose content is text.
 *
 * @since 0.1.0
 */
export const TextPart = Schema.Struct({
  text: Schema.String,
  ...PartFields,
}).annotate({ identifier: 'TextPart' });

/**
 * @since 0.1.0
 */
export type TextPart = typeof TextPart.Type;

/**
 * A part whose content is raw bytes, base64 on the wire.
 *
 * @since 0.1.0
 */
export const RawPart = Schema.Struct({
  raw: Schema.Uint8ArrayFromBase64,
  ...PartFields,
}).annotate({ identifier: 'RawPart' });

/**
 * @since 0.1.0
 */
export type RawPart = typeof RawPart.Type;

/**
 * A part whose content is a URL that points to the file.
 *
 * @since 0.1.0
 */
export const UrlPart = Schema.Struct({
  url: Schema.String,
  ...PartFields,
}).annotate({ identifier: 'UrlPart' });

/**
 * @since 0.1.0
 */
export type UrlPart = typeof UrlPart.Type;

/**
 * A part whose content is a JSON value.
 *
 * @since 0.1.0
 */
export const DataPart = Schema.Struct({
  data: Schema.Json,
  ...PartFields,
}).annotate({ identifier: 'DataPart' });

/**
 * @since 0.1.0
 */
export type DataPart = typeof DataPart.Type;

/**
 * A section of message or artifact content: the `content` oneof is text, raw
 * bytes, a URL or a JSON value.
 *
 * @since 0.1.0
 */
export const Part = Schema.Union([
  TextPart,
  RawPart,
  UrlPart,
  DataPart,
]).annotate({ identifier: 'Part' });

/**
 * @since 0.1.0
 */
export type Part = typeof Part.Type;

/**
 * One unit of communication between a client and an agent.
 *
 * @since 0.1.0
 */
export const Message = Schema.Struct({
  messageId: requiredString,
  contextId: optionalString,
  taskId: optionalString,
  role: required(Role, 'ROLE_UNSPECIFIED'),
  parts: required(Schema.Array(Part), []),
  metadata: optionalStruct,
  extensions: optionalStrings,
  referenceTaskIds: optionalStrings,
}).annotate({ identifier: 'Message' });

/**
 * @since 0.1.0
 */
export type Message = typeof Message.Type;

/**
 * An output of a task.
 *
 * @since 0.1.0
 */
export const Artifact = Schema.Struct({
  artifactId: requiredString,
  name: optionalString,
  description: optionalString,
  parts: required(Schema.Array(Part), []),
  metadata: optionalStruct,
  extensions: optionalStrings,
}).annotate({ identifier: 'Artifact' });

/**
 * @since 0.1.0
 */
export type Artifact = typeof Artifact.Type;

// ---------------------------------------------------------------------------
// Tasks and events
// ---------------------------------------------------------------------------

/**
 * The status of a task.
 *
 * @since 0.1.0
 */
export const TaskStatus = Schema.Struct({
  state: required(TaskState, 'TASK_STATE_UNSPECIFIED'),
  message: Schema.optionalKey(Message),
  timestamp: Schema.optionalKey(Timestamp),
}).annotate({ identifier: 'TaskStatus' });

/**
 * @since 0.1.0
 */
export type TaskStatus = typeof TaskStatus.Type;

/**
 * The core unit of work of A2A.
 *
 * @since 0.1.0
 */
export const Task = Schema.Struct({
  id: requiredString,
  contextId: optionalString,
  status: required(TaskStatus, {}),
  artifacts: Schema.optionalKey(Schema.Array(Artifact)),
  history: Schema.optionalKey(Schema.Array(Message)),
  metadata: optionalStruct,
}).annotate({ identifier: 'Task' });

/**
 * @since 0.1.0
 */
export type Task = typeof Task.Type;

/**
 * A change of the status of a task.
 *
 * @since 0.1.0
 */
export const TaskStatusUpdateEvent = Schema.Struct({
  taskId: requiredString,
  contextId: requiredString,
  status: required(TaskStatus, {}),
  metadata: optionalStruct,
}).annotate({ identifier: 'TaskStatusUpdateEvent' });

/**
 * @since 0.1.0
 */
export type TaskStatusUpdateEvent = typeof TaskStatusUpdateEvent.Type;

/**
 * A new or updated artifact of a task.
 *
 * @since 0.1.0
 */
export const TaskArtifactUpdateEvent = Schema.Struct({
  taskId: requiredString,
  contextId: requiredString,
  artifact: required(Artifact, {}),
  append: optionalBoolean,
  lastChunk: optionalBoolean,
  metadata: optionalStruct,
}).annotate({ identifier: 'TaskArtifactUpdateEvent' });

/**
 * @since 0.1.0
 */
export type TaskArtifactUpdateEvent = typeof TaskArtifactUpdateEvent.Type;

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------

/**
 * The credentials that a push notification carries.
 *
 * @since 0.1.0
 */
export const AuthenticationInfo = Schema.Struct({
  scheme: requiredString,
  credentials: optionalString,
}).annotate({ identifier: 'AuthenticationInfo' });

/**
 * @since 0.1.0
 */
export type AuthenticationInfo = typeof AuthenticationInfo.Type;

/**
 * A webhook that receives the updates of a task.
 *
 * @since 0.1.0
 */
export const TaskPushNotificationConfig = Schema.Struct({
  tenant: optionalString,
  id: optionalString,
  taskId: optionalString,
  url: requiredString,
  token: optionalString,
  authentication: Schema.optionalKey(AuthenticationInfo),
}).annotate({ identifier: 'TaskPushNotificationConfig' });

/**
 * @since 0.1.0
 */
export type TaskPushNotificationConfig = typeof TaskPushNotificationConfig.Type;

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

/**
 * A list of strings, the value type of a security requirement.
 *
 * @since 0.1.0
 */
export const StringList = Schema.Struct({ list: optionalStrings }).annotate({
  identifier: 'StringList',
});

/**
 * @since 0.1.0
 */
export type StringList = typeof StringList.Type;

/**
 * The security schemes, with their scopes, that a request must satisfy.
 *
 * @since 0.1.0
 */
export const SecurityRequirement = Schema.Struct({
  schemes: Schema.optionalKey(Schema.Record(Schema.String, StringList)),
}).annotate({ identifier: 'SecurityRequirement' });

/**
 * @since 0.1.0
 */
export type SecurityRequirement = typeof SecurityRequirement.Type;

/**
 * An API key security scheme.
 *
 * @since 0.1.0
 */
export const APIKeySecurityScheme = Schema.Struct({
  description: optionalString,
  location: requiredString,
  name: requiredString,
}).annotate({ identifier: 'APIKeySecurityScheme' });

/**
 * @since 0.1.0
 */
export type APIKeySecurityScheme = typeof APIKeySecurityScheme.Type;

/**
 * An HTTP authentication security scheme.
 *
 * @since 0.1.0
 */
export const HTTPAuthSecurityScheme = Schema.Struct({
  description: optionalString,
  scheme: requiredString,
  bearerFormat: optionalString,
}).annotate({ identifier: 'HTTPAuthSecurityScheme' });

/**
 * @since 0.1.0
 */
export type HTTPAuthSecurityScheme = typeof HTTPAuthSecurityScheme.Type;

/**
 * The authorization code OAuth 2.0 flow.
 *
 * @since 0.1.0
 */
export const AuthorizationCodeOAuthFlow = Schema.Struct({
  authorizationUrl: requiredString,
  tokenUrl: requiredString,
  refreshUrl: optionalString,
  scopes: required(StringMap, {}),
  pkceRequired: optionalBoolean,
}).annotate({ identifier: 'AuthorizationCodeOAuthFlow' });

/**
 * @since 0.1.0
 */
export type AuthorizationCodeOAuthFlow = typeof AuthorizationCodeOAuthFlow.Type;

/**
 * The client credentials OAuth 2.0 flow.
 *
 * @since 0.1.0
 */
export const ClientCredentialsOAuthFlow = Schema.Struct({
  tokenUrl: requiredString,
  refreshUrl: optionalString,
  scopes: required(StringMap, {}),
}).annotate({ identifier: 'ClientCredentialsOAuthFlow' });

/**
 * @since 0.1.0
 */
export type ClientCredentialsOAuthFlow = typeof ClientCredentialsOAuthFlow.Type;

/**
 * The implicit OAuth 2.0 flow. Deprecated by the specification.
 *
 * @since 0.1.0
 */
export const ImplicitOAuthFlow = Schema.Struct({
  authorizationUrl: optionalString,
  refreshUrl: optionalString,
  scopes: Schema.optionalKey(StringMap),
}).annotate({ identifier: 'ImplicitOAuthFlow' });

/**
 * @since 0.1.0
 */
export type ImplicitOAuthFlow = typeof ImplicitOAuthFlow.Type;

/**
 * The password OAuth 2.0 flow. Deprecated by the specification.
 *
 * @since 0.1.0
 */
export const PasswordOAuthFlow = Schema.Struct({
  tokenUrl: optionalString,
  refreshUrl: optionalString,
  scopes: Schema.optionalKey(StringMap),
}).annotate({ identifier: 'PasswordOAuthFlow' });

/**
 * @since 0.1.0
 */
export type PasswordOAuthFlow = typeof PasswordOAuthFlow.Type;

/**
 * The device code OAuth 2.0 flow (RFC 8628).
 *
 * @since 0.1.0
 */
export const DeviceCodeOAuthFlow = Schema.Struct({
  deviceAuthorizationUrl: requiredString,
  tokenUrl: requiredString,
  refreshUrl: optionalString,
  scopes: required(StringMap, {}),
}).annotate({ identifier: 'DeviceCodeOAuthFlow' });

/**
 * @since 0.1.0
 */
export type DeviceCodeOAuthFlow = typeof DeviceCodeOAuthFlow.Type;

/**
 * The OAuth 2.0 flow of an OAuth 2.0 security scheme: the `flow` oneof.
 *
 * @since 0.1.0
 */
export const OAuthFlows = Schema.Union([
  Schema.Struct({ authorizationCode: AuthorizationCodeOAuthFlow }),
  Schema.Struct({ clientCredentials: ClientCredentialsOAuthFlow }),
  Schema.Struct({ implicit: ImplicitOAuthFlow }),
  Schema.Struct({ password: PasswordOAuthFlow }),
  Schema.Struct({ deviceCode: DeviceCodeOAuthFlow }),
]).annotate({ identifier: 'OAuthFlows' });

/**
 * @since 0.1.0
 */
export type OAuthFlows = typeof OAuthFlows.Type;

/**
 * An OAuth 2.0 security scheme.
 *
 * @since 0.1.0
 */
export const OAuth2SecurityScheme = Schema.Struct({
  description: optionalString,
  flows: OAuthFlows,
  oauth2MetadataUrl: optionalString,
}).annotate({ identifier: 'OAuth2SecurityScheme' });

/**
 * @since 0.1.0
 */
export type OAuth2SecurityScheme = typeof OAuth2SecurityScheme.Type;

/**
 * An OpenID Connect security scheme.
 *
 * @since 0.1.0
 */
export const OpenIdConnectSecurityScheme = Schema.Struct({
  description: optionalString,
  openIdConnectUrl: requiredString,
}).annotate({ identifier: 'OpenIdConnectSecurityScheme' });

/**
 * @since 0.1.0
 */
export type OpenIdConnectSecurityScheme =
  typeof OpenIdConnectSecurityScheme.Type;

/**
 * A mutual TLS security scheme.
 *
 * @since 0.1.0
 */
export const MutualTlsSecurityScheme = Schema.Struct({
  description: optionalString,
}).annotate({ identifier: 'MutualTlsSecurityScheme' });

/**
 * @since 0.1.0
 */
export type MutualTlsSecurityScheme = typeof MutualTlsSecurityScheme.Type;

/**
 * A security scheme of an agent: the `scheme` oneof.
 *
 * @since 0.1.0
 */
export const SecurityScheme = Schema.Union([
  Schema.Struct({ apiKeySecurityScheme: APIKeySecurityScheme }),
  Schema.Struct({ httpAuthSecurityScheme: HTTPAuthSecurityScheme }),
  Schema.Struct({ oauth2SecurityScheme: OAuth2SecurityScheme }),
  Schema.Struct({ openIdConnectSecurityScheme: OpenIdConnectSecurityScheme }),
  Schema.Struct({ mtlsSecurityScheme: MutualTlsSecurityScheme }),
]).annotate({ identifier: 'SecurityScheme' });

/**
 * @since 0.1.0
 */
export type SecurityScheme = typeof SecurityScheme.Type;

// ---------------------------------------------------------------------------
// Agent Card
// ---------------------------------------------------------------------------

/**
 * A URL, protocol binding and protocol version at which the agent is
 * available.
 *
 * @since 0.1.0
 */
export const AgentInterface = Schema.Struct({
  url: requiredString,
  protocolBinding: requiredString,
  tenant: optionalString,
  protocolVersion: requiredString,
}).annotate({ identifier: 'AgentInterface' });

/**
 * @since 0.1.0
 */
export type AgentInterface = typeof AgentInterface.Type;

/**
 * The service provider of an agent.
 *
 * @since 0.1.0
 */
export const AgentProvider = Schema.Struct({
  url: requiredString,
  organization: requiredString,
}).annotate({ identifier: 'AgentProvider' });

/**
 * @since 0.1.0
 */
export type AgentProvider = typeof AgentProvider.Type;

/**
 * A protocol extension that the agent supports.
 *
 * @since 0.1.0
 */
export const AgentExtension = Schema.Struct({
  uri: optionalString,
  description: optionalString,
  required: optionalBoolean,
  params: optionalStruct,
}).annotate({ identifier: 'AgentExtension' });

/**
 * @since 0.1.0
 */
export type AgentExtension = typeof AgentExtension.Type;

/**
 * The optional capabilities of an agent.
 *
 * @since 0.1.0
 */
export const AgentCapabilities = Schema.Struct({
  streaming: optionalBoolean,
  pushNotifications: optionalBoolean,
  extensions: Schema.optionalKey(Schema.Array(AgentExtension)),
  extendedAgentCard: optionalBoolean,
}).annotate({ identifier: 'AgentCapabilities' });

/**
 * @since 0.1.0
 */
export type AgentCapabilities = typeof AgentCapabilities.Type;

/**
 * A distinct capability that an agent can perform.
 *
 * @since 0.1.0
 */
export const AgentSkill = Schema.Struct({
  id: requiredString,
  name: requiredString,
  description: requiredString,
  tags: requiredStrings,
  examples: optionalStrings,
  inputModes: optionalStrings,
  outputModes: optionalStrings,
  securityRequirements: Schema.optionalKey(Schema.Array(SecurityRequirement)),
}).annotate({ identifier: 'AgentSkill' });

/**
 * @since 0.1.0
 */
export type AgentSkill = typeof AgentSkill.Type;

/**
 * A JSON Web Signature (RFC 7515, flattened JSON form) of an Agent Card.
 *
 * @since 0.1.0
 */
export const AgentCardSignature = Schema.Struct({
  protected: requiredString,
  signature: requiredString,
  header: optionalStruct,
}).annotate({ identifier: 'AgentCardSignature' });

/**
 * @since 0.1.0
 */
export type AgentCardSignature = typeof AgentCardSignature.Type;

/**
 * The self-describing manifest of an agent.
 *
 * @since 0.1.0
 */
export const AgentCard = Schema.Struct({
  name: requiredString,
  description: requiredString,
  supportedInterfaces: required(Schema.Array(AgentInterface), []),
  provider: Schema.optionalKey(AgentProvider),
  version: requiredString,
  documentationUrl: optionalString,
  capabilities: required(AgentCapabilities, {}),
  securitySchemes: Schema.optionalKey(
    Schema.Record(Schema.String, SecurityScheme)
  ),
  securityRequirements: Schema.optionalKey(Schema.Array(SecurityRequirement)),
  defaultInputModes: requiredStrings,
  defaultOutputModes: requiredStrings,
  skills: required(Schema.Array(AgentSkill), []),
  signatures: Schema.optionalKey(Schema.Array(AgentCardSignature)),
  iconUrl: optionalString,
}).annotate({ identifier: 'AgentCard' });

/**
 * @since 0.1.0
 */
export type AgentCard = typeof AgentCard.Type;

// ---------------------------------------------------------------------------
// Requests and responses
// ---------------------------------------------------------------------------

/**
 * The configuration of a send message request.
 *
 * @since 0.1.0
 */
export const SendMessageConfiguration = Schema.Struct({
  acceptedOutputModes: optionalStrings,
  taskPushNotificationConfig: Schema.optionalKey(TaskPushNotificationConfig),
  historyLength: optionalInt32,
  returnImmediately: optionalBoolean,
}).annotate({ identifier: 'SendMessageConfiguration' });

/**
 * @since 0.1.0
 */
export type SendMessageConfiguration = typeof SendMessageConfiguration.Type;

/**
 * The request of `SendMessage` and `SendStreamingMessage`. `message` is the
 * one field without a decoding default: a request without it is malformed.
 *
 * @since 0.1.0
 */
export const SendMessageRequest = Schema.Struct({
  tenant: optionalString,
  message: Message,
  configuration: Schema.optionalKey(SendMessageConfiguration),
  metadata: optionalStruct,
}).annotate({ identifier: 'SendMessageRequest' });

/**
 * @since 0.1.0
 */
export type SendMessageRequest = typeof SendMessageRequest.Type;

/**
 * The request of `GetTask`.
 *
 * @since 0.1.0
 */
export const GetTaskRequest = Schema.Struct({
  tenant: optionalString,
  id: requiredString,
  historyLength: optionalInt32,
}).annotate({ identifier: 'GetTaskRequest' });

/**
 * @since 0.1.0
 */
export type GetTaskRequest = typeof GetTaskRequest.Type;

/**
 * The request of `ListTasks`.
 *
 * @since 0.1.0
 */
export const ListTasksRequest = Schema.Struct({
  tenant: optionalString,
  contextId: optionalString,
  status: Schema.optionalKey(TaskState),
  pageSize: optionalInt32,
  pageToken: optionalString,
  historyLength: optionalInt32,
  statusTimestampAfter: Schema.optionalKey(Timestamp),
  includeArtifacts: optionalBoolean,
}).annotate({ identifier: 'ListTasksRequest' });

/**
 * @since 0.1.0
 */
export type ListTasksRequest = typeof ListTasksRequest.Type;

/**
 * The response of `ListTasks`. All four fields are REQUIRED, so they always
 * encode, as in the reference SDK.
 *
 * @since 0.1.0
 */
export const ListTasksResponse = Schema.Struct({
  tasks: required(Schema.Array(Task), []),
  nextPageToken: requiredString,
  pageSize: required(Int32, 0),
  totalSize: required(Int32, 0),
}).annotate({ identifier: 'ListTasksResponse' });

/**
 * @since 0.1.0
 */
export type ListTasksResponse = typeof ListTasksResponse.Type;

/**
 * The request of `CancelTask`.
 *
 * @since 0.1.0
 */
export const CancelTaskRequest = Schema.Struct({
  tenant: optionalString,
  id: requiredString,
  metadata: optionalStruct,
}).annotate({ identifier: 'CancelTaskRequest' });

/**
 * @since 0.1.0
 */
export type CancelTaskRequest = typeof CancelTaskRequest.Type;

/**
 * The request of `GetTaskPushNotificationConfig`.
 *
 * @since 0.1.0
 */
export const GetTaskPushNotificationConfigRequest = Schema.Struct({
  tenant: optionalString,
  taskId: requiredString,
  id: requiredString,
}).annotate({ identifier: 'GetTaskPushNotificationConfigRequest' });

/**
 * @since 0.1.0
 */
export type GetTaskPushNotificationConfigRequest =
  typeof GetTaskPushNotificationConfigRequest.Type;

/**
 * The request of `DeleteTaskPushNotificationConfig`.
 *
 * @since 0.1.0
 */
export const DeleteTaskPushNotificationConfigRequest = Schema.Struct({
  tenant: optionalString,
  taskId: requiredString,
  id: requiredString,
}).annotate({ identifier: 'DeleteTaskPushNotificationConfigRequest' });

/**
 * @since 0.1.0
 */
export type DeleteTaskPushNotificationConfigRequest =
  typeof DeleteTaskPushNotificationConfigRequest.Type;

/**
 * The request of `SubscribeToTask`.
 *
 * @since 0.1.0
 */
export const SubscribeToTaskRequest = Schema.Struct({
  tenant: optionalString,
  id: requiredString,
}).annotate({ identifier: 'SubscribeToTaskRequest' });

/**
 * @since 0.1.0
 */
export type SubscribeToTaskRequest = typeof SubscribeToTaskRequest.Type;

/**
 * The request of `ListTaskPushNotificationConfigs`.
 *
 * @since 0.1.0
 */
export const ListTaskPushNotificationConfigsRequest = Schema.Struct({
  tenant: optionalString,
  taskId: requiredString,
  pageSize: optionalInt32,
  pageToken: optionalString,
}).annotate({ identifier: 'ListTaskPushNotificationConfigsRequest' });

/**
 * @since 0.1.0
 */
export type ListTaskPushNotificationConfigsRequest =
  typeof ListTaskPushNotificationConfigsRequest.Type;

/**
 * The response of `ListTaskPushNotificationConfigs`.
 *
 * @since 0.1.0
 */
export const ListTaskPushNotificationConfigsResponse = Schema.Struct({
  configs: Schema.optionalKey(Schema.Array(TaskPushNotificationConfig)),
  nextPageToken: optionalString,
}).annotate({ identifier: 'ListTaskPushNotificationConfigsResponse' });

/**
 * @since 0.1.0
 */
export type ListTaskPushNotificationConfigsResponse =
  typeof ListTaskPushNotificationConfigsResponse.Type;

/**
 * The request of `GetExtendedAgentCard`.
 *
 * @since 0.1.0
 */
export const GetExtendedAgentCardRequest = Schema.Struct({
  tenant: optionalString,
}).annotate({ identifier: 'GetExtendedAgentCardRequest' });

/**
 * @since 0.1.0
 */
export type GetExtendedAgentCardRequest =
  typeof GetExtendedAgentCardRequest.Type;

/**
 * The response of `SendMessage`: the `payload` oneof is a task or a message.
 *
 * @since 0.1.0
 */
export const SendMessageResponse = Schema.Union([
  Schema.Struct({ task: Task }),
  Schema.Struct({ message: Message }),
]).annotate({ identifier: 'SendMessageResponse' });

/**
 * @since 0.1.0
 */
export type SendMessageResponse = typeof SendMessageResponse.Type;

/**
 * One event of a stream: the `payload` oneof is a task, a message, a status
 * update or an artifact update.
 *
 * @since 0.1.0
 */
export const StreamResponse = Schema.Union([
  Schema.Struct({ task: Task }),
  Schema.Struct({ message: Message }),
  Schema.Struct({ statusUpdate: TaskStatusUpdateEvent }),
  Schema.Struct({ artifactUpdate: TaskArtifactUpdateEvent }),
]).annotate({ identifier: 'StreamResponse' });

/**
 * @since 0.1.0
 */
export type StreamResponse = typeof StreamResponse.Type;

/**
 * The result of a send message call: a task or a message.
 *
 * @since 0.1.0
 */
export type SendMessageResult = Task | Message;

/**
 * The value of a `google.protobuf.Struct` field.
 *
 * @since 0.1.0
 */
export const JsonObject = Struct;

/**
 * @since 0.1.0
 */
export type JsonObject = typeof Struct.Type;
