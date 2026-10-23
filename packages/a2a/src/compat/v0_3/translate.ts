/**
 * Translators between the v0.3 JSON-RPC data model and the v1.0 data model,
 * with the rules of `@a2a-js/sdk` 1.3.0 `compat/v0_3/translate`.
 *
 * @since 0.1.0
 */
import { Effect, Option, Predicate, Result, Struct } from 'effect';
import { Base64 } from 'effect/encoding';
import { RequestMalformedError } from '../../errors/index.js';
import type * as V1 from '../../Types.js';
import type * as V03 from './Types.js';

/**
 * The metadata flag that marks a v0.3 data part whose value the translator
 * wrapped as `{ value }`, because v0.3 data parts must be objects.
 *
 * @since 0.1.0
 */
export const DATA_PART_COMPAT_FLAG = 'data_part_compat';

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

const isPlainObject = (
  value: V1.DataPart['data']
): value is { readonly [key: string]: V1.DataPart['data'] } =>
  Predicate.isObject(value) && !Array.isArray(value);

const invalidParams = (message: string) =>
  new RequestMalformedError({ message });

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

const STATES: ReadonlyArray<readonly [V03.TaskState, V1.TaskState]> = [
  ['unknown', 'TASK_STATE_UNSPECIFIED'],
  ['submitted', 'TASK_STATE_SUBMITTED'],
  ['working', 'TASK_STATE_WORKING'],
  ['completed', 'TASK_STATE_COMPLETED'],
  ['failed', 'TASK_STATE_FAILED'],
  ['canceled', 'TASK_STATE_CANCELED'],
  ['input-required', 'TASK_STATE_INPUT_REQUIRED'],
  ['rejected', 'TASK_STATE_REJECTED'],
  ['auth-required', 'TASK_STATE_AUTH_REQUIRED'],
];

/** @since 0.1.0 */
export const toCompatTaskState = (state: V1.TaskState): V03.TaskState =>
  STATES.find(([, core]) => core === state)?.[0] ?? 'unknown';

/** @since 0.1.0 */
export const toCoreTaskState = (state: V03.TaskState): V1.TaskState =>
  STATES.find(([compat]) => compat === state)?.[1] ?? 'TASK_STATE_UNSPECIFIED';

/** @since 0.1.0 */
export const toCoreRole = (role: V03.Role): V1.Role =>
  role === 'user' ? 'ROLE_USER' : 'ROLE_AGENT';

/** @since 0.1.0 */
export const toCompatRole = (role: V1.Role): V03.Role =>
  role === 'ROLE_USER' ? 'user' : 'agent';

/**
 * The v0.3 states after which a task does not change.
 *
 * @since 0.1.0
 */
export const FINAL_LEGACY_STATES: ReadonlyArray<V03.TaskState> = [
  'completed',
  'canceled',
  'failed',
  'rejected',
];

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

/**
 * A v0.3 part as a v1.0 part. File bytes must be base64.
 *
 * @since 0.1.0
 */
export const toCorePart = (
  part: V03.Part
): Effect.Effect<V1.Part, RequestMalformedError> => {
  const metadata = optional('metadata', Option.fromUndefinedOr(part.metadata));
  switch (part.kind) {
    case 'text':
      return Effect.succeed({ text: part.text, ...metadata });
    case 'file': {
      const file = part.file;
      const common = {
        ...metadata,
        ...optional('filename', nonEmpty(file.name)),
        ...optional('mediaType', nonEmpty(file.mimeType)),
      };
      if ('bytes' in file) {
        const raw = Base64.decode(file.bytes);
        return Result.isFailure(raw)
          ? Effect.fail(
              invalidParams('Invalid file part: `bytes` is not base64')
            )
          : Effect.succeed({ raw: raw.success, ...common });
      }
      return Effect.succeed({ url: file.uri, ...common });
    }
    case 'data': {
      const flagged = part.metadata?.[DATA_PART_COMPAT_FLAG] === true;
      if (!flagged) return Effect.succeed({ data: part.data, ...metadata });
      const data =
        isPlainObject(part.data) && 'value' in part.data
          ? (part.data['value'] ?? part.data)
          : part.data;
      const rest = Struct.omit(part.metadata ?? {}, [DATA_PART_COMPAT_FLAG]);
      return Effect.succeed({
        data,
        ...(Object.keys(rest).length > 0 ? { metadata: rest } : {}),
      });
    }
  }
};

/**
 * A v1.0 part as a v0.3 part. A data value that is not an object is wrapped
 * as `{ value }` and flagged with `data_part_compat`.
 *
 * @since 0.1.0
 */
export const toCompatPart = (part: V1.Part): V03.Part => {
  const metadata = optional('metadata', Option.fromUndefinedOr(part.metadata));
  if ('text' in part) return { kind: 'text', text: part.text, ...metadata };
  if ('raw' in part || 'url' in part) {
    const common = {
      ...optional('mimeType', nonEmpty(part.mediaType)),
      ...optional('name', nonEmpty(part.filename)),
    };
    return {
      kind: 'file',
      file:
        'raw' in part
          ? { bytes: Base64.encode(part.raw), ...common }
          : { uri: part.url, ...common },
      ...metadata,
    };
  }
  if (isPlainObject(part.data)) {
    return { kind: 'data', data: part.data, ...metadata };
  }
  return {
    kind: 'data',
    data: { value: part.data },
    metadata: { ...(part.metadata ?? {}), [DATA_PART_COMPAT_FLAG]: true },
  };
};

// ---------------------------------------------------------------------------
// Messages, artifacts and tasks
// ---------------------------------------------------------------------------

/**
 * A v0.3 message as a v1.0 message.
 *
 * @since 0.1.0
 */
export const toCoreMessage = (
  message: V03.Message
): Effect.Effect<V1.Message, RequestMalformedError> =>
  Effect.gen(function* () {
    if (message.messageId === '') {
      return yield* invalidParams('message.messageId is required');
    }
    const parts = yield* Effect.forEach(message.parts, toCorePart);
    return {
      messageId: message.messageId,
      role: toCoreRole(message.role),
      parts,
      ...optional('contextId', nonEmpty(message.contextId)),
      ...optional('taskId', nonEmpty(message.taskId)),
      ...optional('metadata', Option.fromUndefinedOr(message.metadata)),
      ...optional('extensions', nonEmptyList(message.extensions)),
      ...optional('referenceTaskIds', nonEmptyList(message.referenceTaskIds)),
    };
  });

/**
 * A v1.0 message as a v0.3 message.
 *
 * @since 0.1.0
 */
export const toCompatMessage = (message: V1.Message): V03.Message => ({
  kind: 'message',
  messageId: message.messageId,
  role: toCompatRole(message.role),
  parts: message.parts.map(toCompatPart),
  ...optional('contextId', nonEmpty(message.contextId)),
  ...optional('taskId', nonEmpty(message.taskId)),
  ...optional('metadata', Option.fromUndefinedOr(message.metadata)),
  ...optional('extensions', nonEmptyList(message.extensions)),
  ...optional('referenceTaskIds', nonEmptyList(message.referenceTaskIds)),
});

/** @since 0.1.0 */
export const toCompatArtifact = (artifact: V1.Artifact): V03.Artifact => ({
  artifactId: artifact.artifactId,
  parts: artifact.parts.map(toCompatPart),
  ...optional('name', nonEmpty(artifact.name)),
  ...optional('description', nonEmpty(artifact.description)),
  ...optional('metadata', Option.fromUndefinedOr(artifact.metadata)),
  ...optional('extensions', nonEmptyList(artifact.extensions)),
});

/** @since 0.1.0 */
export const toCoreArtifact = (
  artifact: V03.Artifact
): Effect.Effect<V1.Artifact, RequestMalformedError> =>
  Effect.map(Effect.forEach(artifact.parts, toCorePart), (parts) => ({
    artifactId: artifact.artifactId,
    parts,
    ...optional('name', nonEmpty(artifact.name)),
    ...optional('description', nonEmpty(artifact.description)),
    ...optional('metadata', Option.fromUndefinedOr(artifact.metadata)),
    ...optional('extensions', nonEmptyList(artifact.extensions)),
  }));

/** @since 0.1.0 */
export const toCompatTaskStatus = (status: V1.TaskStatus): V03.TaskStatus => ({
  state: toCompatTaskState(status.state),
  ...optional(
    'message',
    Option.map(Option.fromUndefinedOr(status.message), toCompatMessage)
  ),
  ...optional('timestamp', nonEmpty(status.timestamp)),
});

/** @since 0.1.0 */
export const toCoreTaskStatus = (
  status: V03.TaskStatus
): Effect.Effect<V1.TaskStatus, RequestMalformedError> =>
  Effect.gen(function* () {
    const message =
      status.message === undefined
        ? Option.none<V1.Message>()
        : Option.some(yield* toCoreMessage(status.message));
    return {
      state: toCoreTaskState(status.state),
      ...optional('message', message),
      ...optional('timestamp', nonEmpty(status.timestamp)),
    };
  });

/** @since 0.1.0 */
export const toCompatTask = (task: V1.Task): V03.Task => ({
  kind: 'task',
  id: task.id,
  contextId: task.contextId ?? '',
  status: toCompatTaskStatus(task.status),
  ...optional(
    'history',
    Option.map(nonEmptyList(task.history), (history) =>
      history.map(toCompatMessage)
    )
  ),
  ...optional(
    'artifacts',
    Option.map(nonEmptyList(task.artifacts), (artifacts) =>
      artifacts.map(toCompatArtifact)
    )
  ),
  ...optional('metadata', Option.fromUndefinedOr(task.metadata)),
});

/** @since 0.1.0 */
export const toCoreTask = (
  task: V03.Task
): Effect.Effect<V1.Task, RequestMalformedError> =>
  Effect.gen(function* () {
    return {
      id: task.id,
      contextId: task.contextId,
      status: yield* toCoreTaskStatus(task.status),
      artifacts: yield* Effect.forEach(task.artifacts ?? [], toCoreArtifact),
      history: yield* Effect.forEach(task.history ?? [], toCoreMessage),
      ...optional('metadata', Option.fromUndefinedOr(task.metadata)),
    };
  });

/** @since 0.1.0 */
export const toCompatTaskStatusUpdateEvent = (
  event: V1.TaskStatusUpdateEvent
): V03.TaskStatusUpdateEvent => {
  const status = toCompatTaskStatus(event.status);
  return {
    kind: 'status-update',
    taskId: event.taskId,
    contextId: event.contextId,
    status,
    final: FINAL_LEGACY_STATES.includes(status.state),
    ...optional('metadata', Option.fromUndefinedOr(event.metadata)),
  };
};

/** @since 0.1.0 */
export const toCoreTaskStatusUpdateEvent = (
  event: V03.TaskStatusUpdateEvent
): Effect.Effect<V1.TaskStatusUpdateEvent, RequestMalformedError> =>
  Effect.map(toCoreTaskStatus(event.status), (status) => ({
    taskId: event.taskId,
    contextId: event.contextId,
    status,
    ...optional('metadata', Option.fromUndefinedOr(event.metadata)),
  }));

/** @since 0.1.0 */
export const toCompatTaskArtifactUpdateEvent = (
  event: V1.TaskArtifactUpdateEvent
): V03.TaskArtifactUpdateEvent => ({
  kind: 'artifact-update',
  taskId: event.taskId,
  contextId: event.contextId,
  artifact: toCompatArtifact(event.artifact),
  append: event.append ?? false,
  lastChunk: event.lastChunk ?? false,
  ...optional('metadata', Option.fromUndefinedOr(event.metadata)),
});

/** @since 0.1.0 */
export const toCoreTaskArtifactUpdateEvent = (
  event: V03.TaskArtifactUpdateEvent
): Effect.Effect<V1.TaskArtifactUpdateEvent, RequestMalformedError> =>
  Effect.map(toCoreArtifact(event.artifact), (artifact) => ({
    taskId: event.taskId,
    contextId: event.contextId,
    artifact,
    append: event.append ?? false,
    lastChunk: event.lastChunk ?? false,
    ...optional('metadata', Option.fromUndefinedOr(event.metadata)),
  }));

/**
 * A v1.0 stream event as a v0.3 stream event.
 *
 * @since 0.1.0
 */
export const toCompatStreamEvent = (
  event: V1.StreamResponse
): V03.StreamEvent =>
  'task' in event
    ? toCompatTask(event.task)
    : 'message' in event
      ? toCompatMessage(event.message)
      : 'statusUpdate' in event
        ? toCompatTaskStatusUpdateEvent(event.statusUpdate)
        : toCompatTaskArtifactUpdateEvent(event.artifactUpdate);

/**
 * A v0.3 stream event as a v1.0 stream event.
 *
 * @since 0.1.0
 */
export const toCoreStreamResponse = (
  event: V03.StreamEvent
): Effect.Effect<V1.StreamResponse, RequestMalformedError> => {
  switch (event.kind) {
    case 'task':
      return Effect.map(toCoreTask(event), (task) => ({ task }));
    case 'status-update':
      return Effect.map(toCoreTaskStatusUpdateEvent(event), (statusUpdate) => ({
        statusUpdate,
      }));
    case 'artifact-update':
      return Effect.map(
        toCoreTaskArtifactUpdateEvent(event),
        (artifactUpdate) => ({ artifactUpdate })
      );
    default:
      return Effect.map(toCoreMessage(event), (message) => ({ message }));
  }
};

/**
 * A v0.3 send message result as a v1.0 result.
 *
 * @since 0.1.0
 */
export const toCoreSendMessageResult = (
  result: V03.SendMessageResult
): Effect.Effect<V1.SendMessageResult, RequestMalformedError> =>
  result.kind === 'task' ? toCoreTask(result) : toCoreMessage(result);

/**
 * A v1.0 send message result as a v0.3 result.
 *
 * @since 0.1.0
 */
export const toCompatSendMessageResult = (
  result: V1.SendMessageResult
): V03.SendMessageResult =>
  'messageId' in result ? toCompatMessage(result) : toCompatTask(result);

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------

const toCoreAuthentication = (
  authentication: NonNullable<V03.PushNotificationConfig['authentication']>
): Effect.Effect<V1.AuthenticationInfo> =>
  Effect.as(
    authentication.schemes.length > 1
      ? Effect.logWarning(
          `toCoreAuthenticationInfo: Lossy conversion from v0.3 PushNotificationAuthenticationInfo to v1.0 AuthenticationInfo. Multiple schemes declared (${authentication.schemes.join(', ')}), but only the first one ('${authentication.schemes[0] ?? ''}') will be kept.`
        )
      : Effect.void,
    {
      scheme: authentication.schemes[0] ?? '',
      ...optional('credentials', nonEmpty(authentication.credentials)),
    }
  );

/**
 * A v0.3 push config (without a task) as a v1.0 config.
 *
 * @since 0.1.0
 */
export const toCorePushNotificationConfig = (
  config: V03.PushNotificationConfig,
  taskId: string = '',
  tenant: string = ''
): Effect.Effect<V1.TaskPushNotificationConfig> =>
  Effect.gen(function* () {
    const authentication =
      config.authentication === undefined
        ? Option.none<V1.AuthenticationInfo>()
        : Option.some(yield* toCoreAuthentication(config.authentication));
    return {
      url: config.url,
      ...optional('tenant', nonEmpty(tenant)),
      ...optional('taskId', nonEmpty(taskId)),
      ...optional('id', nonEmpty(config.id)),
      ...optional('token', nonEmpty(config.token)),
      ...optional('authentication', authentication),
    };
  });

/**
 * A v1.0 push config as a v0.3 config.
 *
 * @since 0.1.0
 */
export const toCompatPushNotificationConfig = (
  config: V1.TaskPushNotificationConfig
): V03.PushNotificationConfig => ({
  url: config.url,
  ...optional('id', nonEmpty(config.id)),
  ...optional('token', nonEmpty(config.token)),
  ...optional(
    'authentication',
    Option.map(Option.fromUndefinedOr(config.authentication), (auth) => ({
      schemes: auth.scheme === '' ? [] : [auth.scheme],
      ...optional('credentials', nonEmpty(auth.credentials)),
    }))
  ),
});

/** @since 0.1.0 */
export const toCoreTaskPushNotificationConfig = (
  config: V03.TaskPushNotificationConfig,
  tenant: string = ''
): Effect.Effect<V1.TaskPushNotificationConfig> =>
  toCorePushNotificationConfig(
    config.pushNotificationConfig,
    config.taskId,
    tenant
  );

/** @since 0.1.0 */
export const toCompatTaskPushNotificationConfig = (
  config: V1.TaskPushNotificationConfig
): V03.TaskPushNotificationConfig => ({
  taskId: config.taskId ?? '',
  pushNotificationConfig: toCompatPushNotificationConfig(config),
});

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * The v0.3 send parameters as a v1.0 request. A configuration without
 * `blocking` is non-blocking, as in the reference SDK.
 *
 * @since 0.1.0
 */
export const toCoreSendMessageRequest = (
  params: V03.MessageSendParams,
  tenant: string = ''
): Effect.Effect<V1.SendMessageRequest, RequestMalformedError> =>
  Effect.gen(function* () {
    const message = yield* toCoreMessage(params.message);
    const compat = params.configuration;
    let configuration = Option.none<V1.SendMessageConfiguration>();
    if (compat !== undefined) {
      const push =
        compat.pushNotificationConfig === undefined
          ? Option.none<V1.TaskPushNotificationConfig>()
          : Option.some(
              yield* toCorePushNotificationConfig(compat.pushNotificationConfig)
            );
      configuration = Option.some({
        acceptedOutputModes: compat.acceptedOutputModes ?? [],
        returnImmediately:
          compat.blocking === undefined ? true : !compat.blocking,
        ...optional(
          'historyLength',
          Option.fromUndefinedOr(compat.historyLength)
        ),
        ...optional('taskPushNotificationConfig', push),
      });
    }
    return {
      message,
      ...optional('tenant', nonEmpty(tenant)),
      ...optional('configuration', configuration),
      ...optional('metadata', Option.fromUndefinedOr(params.metadata)),
    };
  });

/**
 * A v1.0 send request as v0.3 send parameters.
 *
 * @since 0.1.0
 */
export const toCompatMessageSendParams = (
  request: V1.SendMessageRequest
): V03.MessageSendParams => ({
  message: toCompatMessage(request.message),
  ...optional(
    'configuration',
    Option.map(Option.fromUndefinedOr(request.configuration), (core) => ({
      blocking: core.returnImmediately !== true,
      acceptedOutputModes: core.acceptedOutputModes ?? [],
      ...optional('historyLength', Option.fromUndefinedOr(core.historyLength)),
      ...optional(
        'pushNotificationConfig',
        Option.map(
          Option.fromUndefinedOr(core.taskPushNotificationConfig),
          toCompatPushNotificationConfig
        )
      ),
    }))
  ),
  ...optional('metadata', Option.fromUndefinedOr(request.metadata)),
});
