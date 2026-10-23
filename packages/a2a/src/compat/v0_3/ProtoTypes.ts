/**
 * The ProtoJSON form of the A2A v0.3 protobuf messages (package `a2a.v1`),
 * which the v0.3 HTTP+JSON binding carries and the v0.3 gRPC binding
 * converts to and from binary.
 *
 * Every field may be absent, as ProtoJSON omits default values; the
 * converters apply the proto3 defaults. Field names follow `json_name`:
 * `TaskStatus.update` is `message`, `Message.content` is `content`,
 * `SendMessageRequest.request` and the `msg` oneof members are `message`.
 *
 * @since 0.1.0
 */
import { Schema } from 'effect';
import { protoEnum } from '../../internal/proto.js';

const optionalString = Schema.optionalKey(Schema.String);
const optionalStrings = Schema.optionalKey(Schema.Array(Schema.String));
const optionalBoolean = Schema.optionalKey(Schema.Boolean);
const optionalInt = Schema.optionalKey(Schema.Int);
const optionalStruct = Schema.optionalKey(Schema.JsonObject);
const optionalScopes = Schema.optionalKey(
  Schema.Record(Schema.String, Schema.String)
);

/**
 * The v0.3 protobuf task states. Note the `CANCELLED` spelling.
 *
 * @since 0.1.0
 */
export const ProtoTaskState = protoEnum([
  'TASK_STATE_UNSPECIFIED',
  'TASK_STATE_SUBMITTED',
  'TASK_STATE_WORKING',
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELLED',
  'TASK_STATE_INPUT_REQUIRED',
  'TASK_STATE_REJECTED',
  'TASK_STATE_AUTH_REQUIRED',
] as const).annotate({ identifier: 'V03ProtoTaskState' });

/**
 * @since 0.1.0
 */
export type ProtoTaskState = typeof ProtoTaskState.Type;

/**
 * The v0.3 protobuf roles.
 *
 * @since 0.1.0
 */
export const ProtoRole = protoEnum([
  'ROLE_UNSPECIFIED',
  'ROLE_USER',
  'ROLE_AGENT',
] as const).annotate({ identifier: 'V03ProtoRole' });

/**
 * A file: the `file` oneof is a URI or base64 bytes.
 *
 * @since 0.1.0
 */
export const ProtoFilePart = Schema.Struct({
  fileWithUri: optionalString,
  fileWithBytes: optionalString,
  mimeType: optionalString,
}).annotate({ identifier: 'V03ProtoFilePart' });

/**
 * A part: the `part` oneof is text, a file or data.
 *
 * @since 0.1.0
 */
export const ProtoPart = Schema.Struct({
  text: optionalString,
  file: Schema.optionalKey(ProtoFilePart),
  data: Schema.optionalKey(Schema.Struct({ data: optionalStruct })),
}).annotate({ identifier: 'V03ProtoPart' });

/**
 * @since 0.1.0
 */
export type ProtoPart = typeof ProtoPart.Type;

/**
 * A message.
 *
 * @since 0.1.0
 */
export const ProtoMessage = Schema.Struct({
  messageId: optionalString,
  contextId: optionalString,
  taskId: optionalString,
  role: Schema.optionalKey(ProtoRole),
  content: Schema.optionalKey(Schema.Array(ProtoPart)),
  metadata: optionalStruct,
  extensions: optionalStrings,
}).annotate({ identifier: 'V03ProtoMessage' });

/**
 * @since 0.1.0
 */
export type ProtoMessage = typeof ProtoMessage.Type;

/**
 * The status of a task.
 *
 * @since 0.1.0
 */
export const ProtoTaskStatus = Schema.Struct({
  state: Schema.optionalKey(ProtoTaskState),
  message: Schema.optionalKey(ProtoMessage),
  timestamp: optionalString,
}).annotate({ identifier: 'V03ProtoTaskStatus' });

/**
 * @since 0.1.0
 */
export type ProtoTaskStatus = typeof ProtoTaskStatus.Type;

/**
 * An artifact.
 *
 * @since 0.1.0
 */
export const ProtoArtifact = Schema.Struct({
  artifactId: optionalString,
  name: optionalString,
  description: optionalString,
  parts: Schema.optionalKey(Schema.Array(ProtoPart)),
  metadata: optionalStruct,
  extensions: optionalStrings,
}).annotate({ identifier: 'V03ProtoArtifact' });

/**
 * @since 0.1.0
 */
export type ProtoArtifact = typeof ProtoArtifact.Type;

/**
 * A task.
 *
 * @since 0.1.0
 */
export const ProtoTask = Schema.Struct({
  id: optionalString,
  contextId: optionalString,
  status: Schema.optionalKey(ProtoTaskStatus),
  artifacts: Schema.optionalKey(Schema.Array(ProtoArtifact)),
  history: Schema.optionalKey(Schema.Array(ProtoMessage)),
  metadata: optionalStruct,
}).annotate({ identifier: 'V03ProtoTask' });

/**
 * @since 0.1.0
 */
export type ProtoTask = typeof ProtoTask.Type;

/**
 * A status update.
 *
 * @since 0.1.0
 */
export const ProtoTaskStatusUpdateEvent = Schema.Struct({
  taskId: optionalString,
  contextId: optionalString,
  status: Schema.optionalKey(ProtoTaskStatus),
  final: optionalBoolean,
  metadata: optionalStruct,
}).annotate({ identifier: 'V03ProtoTaskStatusUpdateEvent' });

/**
 * An artifact update.
 *
 * @since 0.1.0
 */
export const ProtoTaskArtifactUpdateEvent = Schema.Struct({
  taskId: optionalString,
  contextId: optionalString,
  artifact: Schema.optionalKey(ProtoArtifact),
  append: optionalBoolean,
  lastChunk: optionalBoolean,
  metadata: optionalStruct,
}).annotate({ identifier: 'V03ProtoTaskArtifactUpdateEvent' });

/**
 * The credentials of a push notification.
 *
 * @since 0.1.0
 */
export const ProtoAuthenticationInfo = Schema.Struct({
  schemes: optionalStrings,
  credentials: optionalString,
}).annotate({ identifier: 'V03ProtoAuthenticationInfo' });

/**
 * A push notification webhook.
 *
 * @since 0.1.0
 */
export const ProtoPushNotificationConfig = Schema.Struct({
  id: optionalString,
  url: optionalString,
  token: optionalString,
  authentication: Schema.optionalKey(ProtoAuthenticationInfo),
}).annotate({ identifier: 'V03ProtoPushNotificationConfig' });

/**
 * @since 0.1.0
 */
export type ProtoPushNotificationConfig =
  typeof ProtoPushNotificationConfig.Type;

/**
 * A push notification webhook of a task; `name` is
 * `tasks/{taskId}/pushNotificationConfigs/{configId}`.
 *
 * @since 0.1.0
 */
export const ProtoTaskPushNotificationConfig = Schema.Struct({
  name: optionalString,
  pushNotificationConfig: Schema.optionalKey(ProtoPushNotificationConfig),
}).annotate({ identifier: 'V03ProtoTaskPushNotificationConfig' });

/**
 * @since 0.1.0
 */
export type ProtoTaskPushNotificationConfig =
  typeof ProtoTaskPushNotificationConfig.Type;

/**
 * The configuration of a send message request.
 *
 * @since 0.1.0
 */
export const ProtoSendMessageConfiguration = Schema.Struct({
  acceptedOutputModes: optionalStrings,
  pushNotification: Schema.optionalKey(ProtoPushNotificationConfig),
  historyLength: optionalInt,
  blocking: optionalBoolean,
}).annotate({ identifier: 'V03ProtoSendMessageConfiguration' });

/**
 * A send message request.
 *
 * @since 0.1.0
 */
export const ProtoSendMessageRequest = Schema.Struct({
  message: Schema.optionalKey(ProtoMessage),
  configuration: Schema.optionalKey(ProtoSendMessageConfiguration),
  metadata: optionalStruct,
}).annotate({ identifier: 'V03ProtoSendMessageRequest' });

/**
 * @since 0.1.0
 */
export type ProtoSendMessageRequest = typeof ProtoSendMessageRequest.Type;

/**
 * A send message response: the `payload` oneof.
 *
 * @since 0.1.0
 */
export const ProtoSendMessageResponse = Schema.Struct({
  task: Schema.optionalKey(ProtoTask),
  message: Schema.optionalKey(ProtoMessage),
}).annotate({ identifier: 'V03ProtoSendMessageResponse' });

/**
 * @since 0.1.0
 */
export type ProtoSendMessageResponse = typeof ProtoSendMessageResponse.Type;

/**
 * A stream event: the `payload` oneof.
 *
 * @since 0.1.0
 */
export const ProtoStreamResponse = Schema.Struct({
  task: Schema.optionalKey(ProtoTask),
  message: Schema.optionalKey(ProtoMessage),
  statusUpdate: Schema.optionalKey(ProtoTaskStatusUpdateEvent),
  artifactUpdate: Schema.optionalKey(ProtoTaskArtifactUpdateEvent),
}).annotate({ identifier: 'V03ProtoStreamResponse' });

/**
 * @since 0.1.0
 */
export type ProtoStreamResponse = typeof ProtoStreamResponse.Type;

/**
 * The push notification webhooks of a task.
 *
 * @since 0.1.0
 */
export const ProtoListTaskPushNotificationConfigResponse = Schema.Struct({
  configs: Schema.optionalKey(Schema.Array(ProtoTaskPushNotificationConfig)),
  nextPageToken: optionalString,
}).annotate({ identifier: 'V03ProtoListTaskPushNotificationConfigResponse' });

/**
 * A request that names a task or a config.
 *
 * @since 0.1.0
 */
export const ProtoNameRequest = Schema.Struct({
  name: optionalString,
}).annotate({ identifier: 'V03ProtoNameRequest' });

/**
 * A `GetTask` request.
 *
 * @since 0.1.0
 */
export const ProtoGetTaskRequest = Schema.Struct({
  name: optionalString,
  historyLength: optionalInt,
}).annotate({ identifier: 'V03ProtoGetTaskRequest' });

/**
 * A `CreateTaskPushNotificationConfig` request.
 *
 * @since 0.1.0
 */
export const ProtoCreateTaskPushNotificationConfigRequest = Schema.Struct({
  parent: optionalString,
  configId: optionalString,
  config: Schema.optionalKey(ProtoTaskPushNotificationConfig),
}).annotate({ identifier: 'V03ProtoCreateTaskPushNotificationConfigRequest' });

/**
 * A `ListTaskPushNotificationConfig` request.
 *
 * @since 0.1.0
 */
export const ProtoListTaskPushNotificationConfigRequest = Schema.Struct({
  parent: optionalString,
  pageSize: optionalInt,
  pageToken: optionalString,
}).annotate({ identifier: 'V03ProtoListTaskPushNotificationConfigRequest' });

// ---------------------------------------------------------------------------
// Agent Card
// ---------------------------------------------------------------------------

const ProtoStringList = Schema.Struct({ list: optionalStrings }).annotate({
  identifier: 'V03ProtoStringList',
});

/** @since 0.1.0 */
export const ProtoSecurity = Schema.Struct({
  schemes: Schema.optionalKey(Schema.Record(Schema.String, ProtoStringList)),
}).annotate({ identifier: 'V03ProtoSecurity' });

const flow = {
  authorizationUrl: optionalString,
  tokenUrl: optionalString,
  refreshUrl: optionalString,
  scopes: optionalScopes,
};

/** @since 0.1.0 */
export const ProtoOAuthFlows = Schema.Struct({
  authorizationCode: Schema.optionalKey(Schema.Struct(flow)),
  clientCredentials: Schema.optionalKey(Schema.Struct(flow)),
  implicit: Schema.optionalKey(Schema.Struct(flow)),
  password: Schema.optionalKey(Schema.Struct(flow)),
}).annotate({ identifier: 'V03ProtoOAuthFlows' });

/** @since 0.1.0 */
export const ProtoSecurityScheme = Schema.Struct({
  apiKeySecurityScheme: Schema.optionalKey(
    Schema.Struct({
      description: optionalString,
      location: optionalString,
      name: optionalString,
    })
  ),
  httpAuthSecurityScheme: Schema.optionalKey(
    Schema.Struct({
      description: optionalString,
      scheme: optionalString,
      bearerFormat: optionalString,
    })
  ),
  oauth2SecurityScheme: Schema.optionalKey(
    Schema.Struct({
      description: optionalString,
      flows: Schema.optionalKey(ProtoOAuthFlows),
      oauth2MetadataUrl: optionalString,
    })
  ),
  openIdConnectSecurityScheme: Schema.optionalKey(
    Schema.Struct({
      description: optionalString,
      openIdConnectUrl: optionalString,
    })
  ),
  mtlsSecurityScheme: Schema.optionalKey(
    Schema.Struct({ description: optionalString })
  ),
}).annotate({ identifier: 'V03ProtoSecurityScheme' });

/** @since 0.1.0 */
export const ProtoAgentCard = Schema.Struct({
  protocolVersion: optionalString,
  name: optionalString,
  description: optionalString,
  url: optionalString,
  preferredTransport: optionalString,
  additionalInterfaces: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({ url: optionalString, transport: optionalString })
    )
  ),
  provider: Schema.optionalKey(
    Schema.Struct({ url: optionalString, organization: optionalString })
  ),
  version: optionalString,
  documentationUrl: optionalString,
  capabilities: Schema.optionalKey(
    Schema.Struct({
      streaming: optionalBoolean,
      pushNotifications: optionalBoolean,
      extensions: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            uri: optionalString,
            description: optionalString,
            required: optionalBoolean,
            params: optionalStruct,
          })
        )
      ),
    })
  ),
  securitySchemes: Schema.optionalKey(
    Schema.Record(Schema.String, ProtoSecurityScheme)
  ),
  security: Schema.optionalKey(Schema.Array(ProtoSecurity)),
  defaultInputModes: optionalStrings,
  defaultOutputModes: optionalStrings,
  skills: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        id: optionalString,
        name: optionalString,
        description: optionalString,
        tags: optionalStrings,
        examples: optionalStrings,
        inputModes: optionalStrings,
        outputModes: optionalStrings,
        security: Schema.optionalKey(Schema.Array(ProtoSecurity)),
      })
    )
  ),
  supportsAuthenticatedExtendedCard: optionalBoolean,
  signatures: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        protected: optionalString,
        signature: optionalString,
        header: optionalStruct,
      })
    )
  ),
}).annotate({ identifier: 'V03ProtoAgentCard' });

/**
 * @since 0.1.0
 */
export type ProtoAgentCard = typeof ProtoAgentCard.Type;
