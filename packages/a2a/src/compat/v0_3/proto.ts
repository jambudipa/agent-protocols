/**
 * Converters between the v0.3 JSON-RPC data model and the ProtoJSON form of
 * the v0.3 protobuf messages, with the rules of `FromProto` and `ToProto` of
 * `@a2a-js/sdk` 1.3.0 `compat/v0_3`. The v0.3 HTTP+JSON and gRPC bindings
 * carry the protobuf form.
 *
 * @since 0.1.0
 */
import { Effect, Option, Predicate, type Schema } from 'effect';
import { RequestMalformedError } from '../../errors/index.js';
import type * as P from './ProtoTypes.js';
import type * as V03 from './Types.js';

const nonEmpty = (value: string | undefined): Option.Option<string> =>
  value === undefined || value === '' ? Option.none() : Option.some(value);

const optional = <K extends string, A>(
  key: K,
  value: Option.Option<A>
): { readonly [P in K]?: A } =>
  Option.match(value, {
    onNone: () => ({}),
    onSome: (present) => ({ [key]: present }) as { readonly [P in K]: A },
  });

const nonEmptyList = <A>(
  values: ReadonlyArray<A> | undefined
): Option.Option<ReadonlyArray<A>> =>
  values === undefined || values.length === 0
    ? Option.none()
    : Option.some(values);

const trueOnly = (value: boolean | undefined): Option.Option<boolean> =>
  value === true ? Option.some(true) : Option.none();

const isJsonObject = (
  value: Schema.Json
): value is { readonly [key: string]: Schema.Json } =>
  Predicate.isObject(value) && !Array.isArray(value);

const invalidParams = (message: string) =>
  new RequestMalformedError({ message });

// ---------------------------------------------------------------------------
// Resource names
// ---------------------------------------------------------------------------

const CONFIG_NAME = /^tasks\/([^/]+)\/pushNotificationConfigs\/([^/]+)$/;
const TASK_NAME = /^tasks\/([^/]+)(?:\/|$)/;

/**
 * The task id of a resource name `tasks/{id}...`.
 *
 * @since 0.1.0
 */
export const extractTaskId = (
  name: string
): Effect.Effect<string, RequestMalformedError> => {
  const taskId = TASK_NAME.exec(name)?.[1];
  return taskId === undefined
    ? Effect.fail(invalidParams(`Invalid or missing task ID in: "${name}"`))
    : Effect.succeed(taskId);
};

/**
 * The task and config ids of `tasks/{id}/pushNotificationConfigs/{configId}`.
 *
 * @since 0.1.0
 */
export const extractTaskAndPushNotificationConfigId = (
  name: string
): Effect.Effect<
  { readonly taskId: string; readonly configId: string },
  RequestMalformedError
> => {
  const match = CONFIG_NAME.exec(name);
  const taskId = match?.[1];
  const configId = match?.[2];
  return taskId === undefined || configId === undefined
    ? Effect.fail(invalidParams(`Invalid or missing config ID in: "${name}"`))
    : Effect.succeed({ taskId, configId });
};

/** @since 0.1.0 */
export const generateTaskName = (taskId: string): string => `tasks/${taskId}`;

/** @since 0.1.0 */
export const generatePushNotificationConfigName = (
  taskId: string,
  configId: string
): string => `tasks/${taskId}/pushNotificationConfigs/${configId}`;

// ---------------------------------------------------------------------------
// From the protobuf form
// ---------------------------------------------------------------------------

const STATES: ReadonlyArray<readonly [P.ProtoTaskState, V03.TaskState]> = [
  ['TASK_STATE_UNSPECIFIED', 'unknown'],
  ['TASK_STATE_SUBMITTED', 'submitted'],
  ['TASK_STATE_WORKING', 'working'],
  ['TASK_STATE_COMPLETED', 'completed'],
  ['TASK_STATE_FAILED', 'failed'],
  ['TASK_STATE_CANCELLED', 'canceled'],
  ['TASK_STATE_INPUT_REQUIRED', 'input-required'],
  ['TASK_STATE_REJECTED', 'rejected'],
  ['TASK_STATE_AUTH_REQUIRED', 'auth-required'],
];

const fromProtoState = (state: P.ProtoTaskState | undefined): V03.TaskState =>
  STATES.find(
    ([proto]) => proto === (state ?? 'TASK_STATE_UNSPECIFIED')
  )?.[1] ?? 'unknown';

const toProtoState = (state: V03.TaskState): P.ProtoTaskState =>
  STATES.find(([, compat]) => compat === state)?.[0] ??
  'TASK_STATE_UNSPECIFIED';

/** @since 0.1.0 */
export const fromProtoPart = (
  part: P.ProtoPart
): Effect.Effect<V03.Part, RequestMalformedError> => {
  if (part.text !== undefined) {
    return Effect.succeed({ kind: 'text', text: part.text });
  }
  if (part.file !== undefined) {
    const file = part.file;
    const mimeType = optional('mimeType', nonEmpty(file.mimeType));
    if (file.fileWithUri !== undefined) {
      return Effect.succeed({
        kind: 'file',
        file: { uri: file.fileWithUri, ...mimeType },
      });
    }
    if (file.fileWithBytes !== undefined) {
      return Effect.succeed({
        kind: 'file',
        file: { bytes: file.fileWithBytes, ...mimeType },
      });
    }
    return Effect.fail(invalidParams('Invalid file part type'));
  }
  if (part.data !== undefined) {
    return Effect.succeed({ kind: 'data', data: part.data.data ?? {} });
  }
  return Effect.fail(invalidParams('Invalid part type'));
};

/** @since 0.1.0 */
export const fromProtoMessage = (
  message: P.ProtoMessage
): Effect.Effect<V03.Message, RequestMalformedError> =>
  Effect.gen(function* () {
    const role = message.role;
    if (role !== 'ROLE_AGENT' && role !== 'ROLE_USER') {
      return yield* invalidParams(
        `Invalid role: ${role ?? 'ROLE_UNSPECIFIED'}`
      );
    }
    return {
      kind: 'message' as const,
      messageId: message.messageId ?? '',
      role: role === 'ROLE_AGENT' ? ('agent' as const) : ('user' as const),
      parts: yield* Effect.forEach(message.content ?? [], fromProtoPart),
      ...optional('contextId', nonEmpty(message.contextId)),
      ...optional('taskId', nonEmpty(message.taskId)),
      ...optional('metadata', Option.fromUndefinedOr(message.metadata)),
      ...optional('extensions', nonEmptyList(message.extensions)),
    };
  });

/** @since 0.1.0 */
export const fromProtoTaskStatus = (
  status: P.ProtoTaskStatus
): Effect.Effect<V03.TaskStatus, RequestMalformedError> =>
  Effect.gen(function* () {
    const message =
      status.message === undefined
        ? Option.none<V03.Message>()
        : Option.some(yield* fromProtoMessage(status.message));
    return {
      state: fromProtoState(status.state),
      ...optional('message', message),
      ...optional('timestamp', nonEmpty(status.timestamp)),
    };
  });

/** @since 0.1.0 */
export const fromProtoArtifact = (
  artifact: P.ProtoArtifact
): Effect.Effect<V03.Artifact, RequestMalformedError> =>
  Effect.map(Effect.forEach(artifact.parts ?? [], fromProtoPart), (parts) => ({
    artifactId: artifact.artifactId ?? '',
    parts,
    ...optional('name', nonEmpty(artifact.name)),
    ...optional('description', nonEmpty(artifact.description)),
    ...optional('metadata', Option.fromUndefinedOr(artifact.metadata)),
    ...optional('extensions', nonEmptyList(artifact.extensions)),
  }));

/** @since 0.1.0 */
export const fromProtoTask = (
  task: P.ProtoTask
): Effect.Effect<V03.Task, RequestMalformedError> =>
  Effect.gen(function* () {
    if (task.status === undefined) {
      return yield* invalidParams('Task missing status');
    }
    return {
      kind: 'task' as const,
      id: task.id ?? '',
      contextId: task.contextId ?? '',
      status: yield* fromProtoTaskStatus(task.status),
      ...optional(
        'artifacts',
        Option.some(
          yield* Effect.forEach(task.artifacts ?? [], fromProtoArtifact)
        )
      ),
      ...optional(
        'history',
        Option.some(yield* Effect.forEach(task.history ?? [], fromProtoMessage))
      ),
      ...optional('metadata', Option.fromUndefinedOr(task.metadata)),
    };
  });

/** @since 0.1.0 */
export const fromProtoStreamResponse = (
  response: P.ProtoStreamResponse
): Effect.Effect<V03.StreamEvent, RequestMalformedError> => {
  if (response.message !== undefined) return fromProtoMessage(response.message);
  if (response.task !== undefined) return fromProtoTask(response.task);
  if (response.statusUpdate !== undefined) {
    const event = response.statusUpdate;
    if (event.status === undefined) {
      return Effect.fail(
        invalidParams('Invalid TaskStatusUpdateEvent: missing status')
      );
    }
    return Effect.map(fromProtoTaskStatus(event.status), (status) => ({
      kind: 'status-update' as const,
      taskId: event.taskId ?? '',
      contextId: event.contextId ?? '',
      status,
      final: event.final ?? false,
      ...optional('metadata', Option.fromUndefinedOr(event.metadata)),
    }));
  }
  if (response.artifactUpdate !== undefined) {
    const event = response.artifactUpdate;
    if (event.artifact === undefined) {
      return Effect.fail(
        invalidParams('Invalid TaskArtifactUpdateEvent: missing artifact')
      );
    }
    return Effect.map(fromProtoArtifact(event.artifact), (artifact) => ({
      kind: 'artifact-update' as const,
      taskId: event.taskId ?? '',
      contextId: event.contextId ?? '',
      artifact,
      ...optional('append', Option.fromUndefinedOr(event.append)),
      ...optional('lastChunk', Option.fromUndefinedOr(event.lastChunk)),
      ...optional('metadata', Option.fromUndefinedOr(event.metadata)),
    }));
  }
  return Effect.fail(invalidParams('Invalid event type in StreamResponse'));
};

/** @since 0.1.0 */
export const fromProtoSendMessageResponse = (
  response: P.ProtoSendMessageResponse
): Effect.Effect<V03.SendMessageResult, RequestMalformedError> => {
  if (response.task !== undefined) return fromProtoTask(response.task);
  if (response.message !== undefined) return fromProtoMessage(response.message);
  return Effect.fail(
    invalidParams('Invalid SendMessageResponse: missing result')
  );
};

/** @since 0.1.0 */
export const fromProtoPushNotificationConfig = (
  config: P.ProtoPushNotificationConfig
): V03.PushNotificationConfig => ({
  url: config.url ?? '',
  ...optional('id', nonEmpty(config.id)),
  ...optional('token', nonEmpty(config.token)),
  ...optional(
    'authentication',
    Option.map(Option.fromUndefinedOr(config.authentication), (auth) => ({
      schemes: auth.schemes ?? [],
      ...optional('credentials', nonEmpty(auth.credentials)),
    }))
  ),
});

/** @since 0.1.0 */
export const fromProtoTaskPushNotificationConfig = (
  config: P.ProtoTaskPushNotificationConfig
): Effect.Effect<V03.TaskPushNotificationConfig, RequestMalformedError> =>
  config.pushNotificationConfig === undefined
    ? Effect.fail(
        invalidParams(
          'TaskPushNotificationConfig missing pushNotificationConfig'
        )
      )
    : Effect.map(extractTaskId(config.name ?? ''), (taskId) => ({
        taskId,
        pushNotificationConfig: fromProtoPushNotificationConfig(
          config.pushNotificationConfig ?? {}
        ),
      }));

/**
 * The v0.3 send parameters of a protobuf send request. A configuration
 * without `blocking` reads as `blocking: false`, the proto3 default, and its
 * `historyLength` is not read, as in the reference SDK.
 *
 * @since 0.1.0
 */
export const fromProtoSendMessageRequest = (
  request: P.ProtoSendMessageRequest
): Effect.Effect<V03.MessageSendParams, RequestMalformedError> =>
  Effect.gen(function* () {
    if (request.message === undefined) {
      return yield* invalidParams('SendMessageRequest missing message');
    }
    const configuration = request.configuration;
    return {
      message: yield* fromProtoMessage(request.message),
      ...optional(
        'configuration',
        Option.map(Option.fromUndefinedOr(configuration), (core) => ({
          blocking: core.blocking ?? false,
          acceptedOutputModes: core.acceptedOutputModes ?? [],
          ...optional(
            'pushNotificationConfig',
            Option.map(
              Option.fromUndefinedOr(core.pushNotification),
              fromProtoPushNotificationConfig
            )
          ),
        }))
      ),
      ...optional('metadata', Option.fromUndefinedOr(request.metadata)),
    };
  });

const fromProtoSecurity = (
  security: P.ProtoAgentCard['security'] extends
    ReadonlyArray<infer S> | undefined
    ? S
    : never
): V03.SecurityRequirement =>
  Object.fromEntries(
    Object.entries(security.schemes ?? {}).map(([name, value]) => [
      name,
      value.list ?? [],
    ])
  );

type ProtoFlow = NonNullable<P.ProtoAgentCard['securitySchemes']>[string];

const fromProtoSecurityScheme = (
  scheme: ProtoFlow
): Effect.Effect<V03.SecurityScheme, RequestMalformedError> => {
  if (scheme.apiKeySecurityScheme !== undefined) {
    const value = scheme.apiKeySecurityScheme;
    return Effect.succeed({
      type: 'apiKey',
      name: value.name ?? '',
      in: value.location ?? '',
      ...optional('description', nonEmpty(value.description)),
    });
  }
  if (scheme.httpAuthSecurityScheme !== undefined) {
    const value = scheme.httpAuthSecurityScheme;
    return Effect.succeed({
      type: 'http',
      scheme: value.scheme ?? '',
      ...optional('bearerFormat', nonEmpty(value.bearerFormat)),
      ...optional('description', nonEmpty(value.description)),
    });
  }
  if (scheme.mtlsSecurityScheme !== undefined) {
    return Effect.succeed({
      type: 'mutualTLS',
      ...optional(
        'description',
        nonEmpty(scheme.mtlsSecurityScheme.description)
      ),
    });
  }
  if (scheme.oauth2SecurityScheme !== undefined) {
    const value = scheme.oauth2SecurityScheme;
    const flows = value.flows ?? {};
    const pick = (flow: NonNullable<typeof flows.implicit> | undefined) => ({
      scopes: flow?.scopes ?? {},
      ...optional('refreshUrl', nonEmpty(flow?.refreshUrl)),
    });
    const compatFlows: V03.OAuthFlows =
      flows.implicit !== undefined
        ? {
            implicit: {
              authorizationUrl: flows.implicit.authorizationUrl ?? '',
              ...pick(flows.implicit),
            },
          }
        : flows.password !== undefined
          ? {
              password: {
                tokenUrl: flows.password.tokenUrl ?? '',
                ...pick(flows.password),
              },
            }
          : flows.authorizationCode !== undefined
            ? {
                authorizationCode: {
                  authorizationUrl:
                    flows.authorizationCode.authorizationUrl ?? '',
                  tokenUrl: flows.authorizationCode.tokenUrl ?? '',
                  ...pick(flows.authorizationCode),
                },
              }
            : flows.clientCredentials !== undefined
              ? {
                  clientCredentials: {
                    tokenUrl: flows.clientCredentials.tokenUrl ?? '',
                    ...pick(flows.clientCredentials),
                  },
                }
              : {};
    return Effect.succeed({
      type: 'oauth2',
      flows: compatFlows,
      ...optional('description', nonEmpty(value.description)),
      ...optional('oauth2MetadataUrl', nonEmpty(value.oauth2MetadataUrl)),
    });
  }
  if (scheme.openIdConnectSecurityScheme !== undefined) {
    const value = scheme.openIdConnectSecurityScheme;
    return Effect.succeed({
      type: 'openIdConnect',
      openIdConnectUrl: value.openIdConnectUrl ?? '',
      ...optional('description', nonEmpty(value.description)),
    });
  }
  return Effect.fail(invalidParams('Unsupported security scheme type'));
};

/** @since 0.1.0 */
export const fromProtoAgentCard = (
  card: P.ProtoAgentCard
): Effect.Effect<V03.AgentCard, RequestMalformedError> =>
  Effect.gen(function* () {
    const schemes = yield* Effect.forEach(
      Object.entries(card.securitySchemes ?? {}),
      ([name, scheme]) =>
        Effect.map(
          fromProtoSecurityScheme(scheme),
          (compat) => [name, compat] as const
        )
    );
    const capabilities = card.capabilities ?? {};
    return {
      name: card.name ?? '',
      description: card.description ?? '',
      version: card.version ?? '',
      url: card.url ?? '',
      protocolVersion: card.protocolVersion ?? '',
      ...optional('preferredTransport', nonEmpty(card.preferredTransport)),
      ...optional(
        'additionalInterfaces',
        Option.map(nonEmptyList(card.additionalInterfaces), (interfaces) =>
          interfaces.map((agentInterface) => ({
            url: agentInterface.url ?? '',
            transport: agentInterface.transport ?? '',
          }))
        )
      ),
      capabilities: {
        ...optional(
          'streaming',
          Option.fromUndefinedOr(capabilities.streaming)
        ),
        ...optional(
          'pushNotifications',
          Option.fromUndefinedOr(capabilities.pushNotifications)
        ),
        ...optional(
          'extensions',
          Option.map(nonEmptyList(capabilities.extensions), (extensions) =>
            extensions.map((extension) => ({
              uri: extension.uri ?? '',
              ...optional('description', nonEmpty(extension.description)),
              ...optional(
                'required',
                Option.fromUndefinedOr(extension.required)
              ),
              ...optional('params', Option.fromUndefinedOr(extension.params)),
            }))
          )
        ),
      },
      defaultInputModes: card.defaultInputModes ?? [],
      defaultOutputModes: card.defaultOutputModes ?? [],
      skills: (card.skills ?? []).map((skill) => ({
        id: skill.id ?? '',
        name: skill.name ?? '',
        description: skill.description ?? '',
        tags: skill.tags ?? [],
        ...optional('examples', nonEmptyList(skill.examples)),
        ...optional('inputModes', nonEmptyList(skill.inputModes)),
        ...optional('outputModes', nonEmptyList(skill.outputModes)),
        ...optional(
          'security',
          Option.map(nonEmptyList(skill.security), (security) =>
            security.map(fromProtoSecurity)
          )
        ),
      })),
      ...optional(
        'provider',
        Option.map(Option.fromUndefinedOr(card.provider), (provider) => ({
          url: provider.url ?? '',
          organization: provider.organization ?? '',
        }))
      ),
      ...optional('documentationUrl', nonEmpty(card.documentationUrl)),
      ...optional(
        'supportsAuthenticatedExtendedCard',
        Option.fromUndefinedOr(card.supportsAuthenticatedExtendedCard)
      ),
      ...(schemes.length > 0
        ? { securitySchemes: Object.fromEntries(schemes) }
        : {}),
      ...optional(
        'security',
        Option.map(nonEmptyList(card.security), (security) =>
          security.map(fromProtoSecurity)
        )
      ),
      ...optional(
        'signatures',
        Option.map(nonEmptyList(card.signatures), (signatures) =>
          signatures.map((signature) => ({
            protected: signature.protected ?? '',
            signature: signature.signature ?? '',
            ...optional('header', Option.fromUndefinedOr(signature.header)),
          }))
        )
      ),
    };
  });

// ---------------------------------------------------------------------------
// To the protobuf form
// ---------------------------------------------------------------------------

/** @since 0.1.0 */
export const toProtoPart = (part: V03.Part): P.ProtoPart => {
  switch (part.kind) {
    case 'text':
      return { text: part.text };
    case 'file': {
      const mimeType = optional('mimeType', nonEmpty(part.file.mimeType));
      return 'uri' in part.file
        ? { file: { fileWithUri: part.file.uri, ...mimeType } }
        : { file: { fileWithBytes: part.file.bytes, ...mimeType } };
    }
    case 'data':
      return {
        data: {
          data: isJsonObject(part.data) ? part.data : { value: part.data },
        },
      };
  }
};

/** @since 0.1.0 */
export const toProtoMessage = (message: V03.Message): P.ProtoMessage => ({
  messageId: message.messageId,
  role: message.role === 'agent' ? 'ROLE_AGENT' : 'ROLE_USER',
  content: message.parts.map(toProtoPart),
  ...optional('contextId', nonEmpty(message.contextId)),
  ...optional('taskId', nonEmpty(message.taskId)),
  ...optional('metadata', Option.fromUndefinedOr(message.metadata)),
  ...optional('extensions', nonEmptyList(message.extensions)),
});

/** @since 0.1.0 */
export const toProtoTaskStatus = (
  status: V03.TaskStatus
): P.ProtoTaskStatus => ({
  state: toProtoState(status.state),
  ...optional(
    'message',
    Option.map(Option.fromUndefinedOr(status.message), toProtoMessage)
  ),
  ...optional('timestamp', nonEmpty(status.timestamp)),
});

/** @since 0.1.0 */
export const toProtoArtifact = (artifact: V03.Artifact): P.ProtoArtifact => ({
  artifactId: artifact.artifactId,
  parts: artifact.parts.map(toProtoPart),
  ...optional('name', nonEmpty(artifact.name)),
  ...optional('description', nonEmpty(artifact.description)),
  ...optional('metadata', Option.fromUndefinedOr(artifact.metadata)),
  ...optional('extensions', nonEmptyList(artifact.extensions)),
});

/** @since 0.1.0 */
export const toProtoTask = (task: V03.Task): P.ProtoTask => ({
  id: task.id,
  contextId: task.contextId,
  status: toProtoTaskStatus(task.status),
  ...optional(
    'artifacts',
    Option.map(nonEmptyList(task.artifacts), (artifacts) =>
      artifacts.map(toProtoArtifact)
    )
  ),
  ...optional(
    'history',
    Option.map(nonEmptyList(task.history), (history) =>
      history.map(toProtoMessage)
    )
  ),
  ...optional('metadata', Option.fromUndefinedOr(task.metadata)),
});

/** @since 0.1.0 */
export const toProtoStreamResponse = (
  event: V03.StreamEvent
): P.ProtoStreamResponse => {
  switch (event.kind) {
    case 'task':
      return { task: toProtoTask(event) };
    case 'status-update':
      return {
        statusUpdate: {
          taskId: event.taskId,
          contextId: event.contextId,
          status: toProtoTaskStatus(event.status),
          ...optional('final', trueOnly(event.final)),
          ...optional('metadata', Option.fromUndefinedOr(event.metadata)),
        },
      };
    case 'artifact-update':
      return {
        artifactUpdate: {
          taskId: event.taskId,
          contextId: event.contextId,
          artifact: toProtoArtifact(event.artifact),
          ...optional('append', trueOnly(event.append)),
          ...optional('lastChunk', trueOnly(event.lastChunk)),
          ...optional('metadata', Option.fromUndefinedOr(event.metadata)),
        },
      };
    default:
      return { message: toProtoMessage(event) };
  }
};

/** @since 0.1.0 */
export const toProtoSendMessageResponse = (
  result: V03.SendMessageResult
): P.ProtoSendMessageResponse =>
  result.kind === 'task'
    ? { task: toProtoTask(result) }
    : { message: toProtoMessage(result) };

/** @since 0.1.0 */
export const toProtoPushNotificationConfig = (
  config: V03.PushNotificationConfig
): P.ProtoPushNotificationConfig => ({
  url: config.url,
  ...optional('id', nonEmpty(config.id)),
  ...optional('token', nonEmpty(config.token)),
  ...optional(
    'authentication',
    Option.map(Option.fromUndefinedOr(config.authentication), (auth) => ({
      ...optional('schemes', nonEmptyList(auth.schemes)),
      ...optional('credentials', nonEmpty(auth.credentials)),
    }))
  ),
});

/** @since 0.1.0 */
export const toProtoTaskPushNotificationConfig = (
  config: V03.TaskPushNotificationConfig
): P.ProtoTaskPushNotificationConfig => ({
  name: generatePushNotificationConfigName(
    config.taskId,
    config.pushNotificationConfig.id ?? ''
  ),
  pushNotificationConfig: toProtoPushNotificationConfig(
    config.pushNotificationConfig
  ),
});

/** @since 0.1.0 */
export const toProtoSendMessageRequest = (
  params: V03.MessageSendParams
): P.ProtoSendMessageRequest => ({
  message: toProtoMessage(params.message),
  ...optional(
    'configuration',
    Option.map(
      Option.fromUndefinedOr(params.configuration),
      (configuration) => ({
        ...optional('blocking', trueOnly(configuration.blocking)),
        ...optional(
          'acceptedOutputModes',
          nonEmptyList(configuration.acceptedOutputModes)
        ),
        ...optional(
          'pushNotification',
          Option.map(
            Option.fromUndefinedOr(configuration.pushNotificationConfig),
            toProtoPushNotificationConfig
          )
        ),
        ...optional(
          'historyLength',
          Option.filter(
            Option.fromUndefinedOr(configuration.historyLength),
            (length) => length !== 0
          )
        ),
      })
    )
  ),
  ...optional('metadata', Option.fromUndefinedOr(params.metadata)),
});

const toProtoSecurity = (requirement: V03.SecurityRequirement) => ({
  schemes: Object.fromEntries(
    Object.entries(requirement).map(([name, scopes]) => [
      name,
      { list: scopes },
    ])
  ),
});

const toProtoSecurityScheme = (scheme: V03.SecurityScheme) => {
  const description = optional('description', nonEmpty(scheme.description));
  switch (scheme.type) {
    case 'apiKey':
      return {
        apiKeySecurityScheme: {
          name: scheme.name,
          location: scheme.in,
          ...description,
        },
      };
    case 'http':
      return {
        httpAuthSecurityScheme: {
          scheme: scheme.scheme,
          ...optional('bearerFormat', nonEmpty(scheme.bearerFormat)),
          ...description,
        },
      };
    case 'mutualTLS':
      return { mtlsSecurityScheme: { ...description } };
    case 'oauth2': {
      const flows = scheme.flows;
      const refresh = (url: string | undefined) =>
        optional('refreshUrl', nonEmpty(url));
      const protoFlows =
        flows.implicit !== undefined
          ? {
              implicit: {
                authorizationUrl: flows.implicit.authorizationUrl,
                scopes: flows.implicit.scopes,
                ...refresh(flows.implicit.refreshUrl),
              },
            }
          : flows.password !== undefined
            ? {
                password: {
                  tokenUrl: flows.password.tokenUrl,
                  scopes: flows.password.scopes,
                  ...refresh(flows.password.refreshUrl),
                },
              }
            : flows.clientCredentials !== undefined
              ? {
                  clientCredentials: {
                    tokenUrl: flows.clientCredentials.tokenUrl,
                    scopes: flows.clientCredentials.scopes,
                    ...refresh(flows.clientCredentials.refreshUrl),
                  },
                }
              : flows.authorizationCode !== undefined
                ? {
                    authorizationCode: {
                      authorizationUrl:
                        flows.authorizationCode.authorizationUrl,
                      tokenUrl: flows.authorizationCode.tokenUrl,
                      scopes: flows.authorizationCode.scopes,
                      ...refresh(flows.authorizationCode.refreshUrl),
                    },
                  }
                : {};
      return {
        oauth2SecurityScheme: {
          flows: protoFlows,
          ...optional('oauth2MetadataUrl', nonEmpty(scheme.oauth2MetadataUrl)),
          ...description,
        },
      };
    }
    case 'openIdConnect':
      return {
        openIdConnectSecurityScheme: {
          openIdConnectUrl: scheme.openIdConnectUrl,
          ...description,
        },
      };
  }
};

/** @since 0.1.0 */
export const toProtoAgentCard = (card: V03.AgentCard): P.ProtoAgentCard => ({
  protocolVersion: card.protocolVersion,
  name: card.name,
  description: card.description,
  url: card.url,
  version: card.version,
  ...optional('preferredTransport', nonEmpty(card.preferredTransport)),
  ...optional('additionalInterfaces', nonEmptyList(card.additionalInterfaces)),
  ...optional('provider', Option.fromUndefinedOr(card.provider)),
  ...optional('documentationUrl', nonEmpty(card.documentationUrl)),
  capabilities: {
    ...optional('streaming', trueOnly(card.capabilities.streaming)),
    ...optional(
      'pushNotifications',
      trueOnly(card.capabilities.pushNotifications)
    ),
    ...optional(
      'extensions',
      Option.map(nonEmptyList(card.capabilities.extensions), (extensions) =>
        extensions.map((extension) => ({
          uri: extension.uri,
          ...optional('description', nonEmpty(extension.description)),
          ...optional('required', trueOnly(extension.required)),
          ...optional('params', Option.fromUndefinedOr(extension.params)),
        }))
      )
    ),
  },
  ...(card.securitySchemes === undefined ||
  Object.keys(card.securitySchemes).length === 0
    ? {}
    : {
        securitySchemes: Object.fromEntries(
          Object.entries(card.securitySchemes).map(([name, scheme]) => [
            name,
            toProtoSecurityScheme(scheme),
          ])
        ),
      }),
  ...optional(
    'security',
    Option.map(nonEmptyList(card.security), (security) =>
      security.map(toProtoSecurity)
    )
  ),
  ...optional('defaultInputModes', nonEmptyList(card.defaultInputModes)),
  ...optional('defaultOutputModes', nonEmptyList(card.defaultOutputModes)),
  ...optional(
    'skills',
    Option.map(nonEmptyList(card.skills), (skills) =>
      skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        ...optional('tags', nonEmptyList(skill.tags)),
        ...optional('examples', nonEmptyList(skill.examples)),
        ...optional('inputModes', nonEmptyList(skill.inputModes)),
        ...optional('outputModes', nonEmptyList(skill.outputModes)),
        ...optional(
          'security',
          Option.map(nonEmptyList(skill.security), (security) =>
            security.map(toProtoSecurity)
          )
        ),
      }))
    )
  ),
  ...optional(
    'supportsAuthenticatedExtendedCard',
    trueOnly(card.supportsAuthenticatedExtendedCard)
  ),
  ...optional('signatures', nonEmptyList(card.signatures)),
});
