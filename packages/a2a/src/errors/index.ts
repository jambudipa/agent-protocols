/**
 * The A2A errors and their mappings to the JSON-RPC and HTTP+JSON bindings.
 *
 * Each A2A error of the specification (§5.4) is a `Schema.TaggedError` with a
 * `message` and an optional `metadata` map, the `metadata` of the
 * `google.rpc.ErrorInfo` detail. The tables below give each error its
 * `ErrorInfo.reason`, JSON-RPC code, HTTP status and REST status name, with
 * the values of `@a2a-js/sdk` 1.3.0. The gRPC mapping lives in
 * `@jambudipa/a2a/errors/grpc`, so this module loads no gRPC code.
 *
 * @since 0.1.0
 */
import { Array as Arr, Effect, Option, Predicate, Schema } from 'effect';

/**
 * The `ErrorInfo.domain` of every A2A error.
 *
 * @since 0.1.0
 */
export const A2A_ERROR_DOMAIN = 'a2a-protocol.org';

/**
 * The `@type` of a `google.rpc.ErrorInfo` detail.
 *
 * @since 0.1.0
 */
export const ERROR_INFO_TYPE = 'type.googleapis.com/google.rpc.ErrorInfo';

const errorFields = (defaultMessage: string) => ({
  message: Schema.String.pipe(
    Schema.withConstructorDefault(Effect.succeed(defaultMessage))
  ),
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

/**
 * The task does not exist, or the caller may not see it.
 *
 * @since 0.1.0
 */
export class TaskNotFoundError extends Schema.TaggedError<TaskNotFoundError>()(
  'TaskNotFoundError',
  errorFields('Task not found')
) {}

/**
 * The task is in a state that does not allow cancellation.
 *
 * @since 0.1.0
 */
export class TaskNotCancelableError extends Schema.TaggedError<TaskNotCancelableError>()(
  'TaskNotCancelableError',
  errorFields('Task cannot be canceled')
) {}

/**
 * The agent does not support push notifications.
 *
 * @since 0.1.0
 */
export class PushNotificationNotSupportedError extends Schema.TaggedError<PushNotificationNotSupportedError>()(
  'PushNotificationNotSupportedError',
  errorFields('Push Notification is not supported')
) {}

/**
 * The operation is not supported, or not in the current state of the task.
 *
 * @since 0.1.0
 */
export class UnsupportedOperationError extends Schema.TaggedError<UnsupportedOperationError>()(
  'UnsupportedOperationError',
  errorFields('This operation is not supported')
) {}

/**
 * A media type of the request is not supported.
 *
 * @since 0.1.0
 */
export class ContentTypeNotSupportedError extends Schema.TaggedError<ContentTypeNotSupportedError>()(
  'ContentTypeNotSupportedError',
  errorFields('Incompatible content types')
) {}

/**
 * The agent produced a response that does not conform to the specification.
 *
 * @since 0.1.0
 */
export class InvalidAgentResponseError extends Schema.TaggedError<InvalidAgentResponseError>()(
  'InvalidAgentResponseError',
  errorFields('Invalid agent response type')
) {}

/**
 * The agent has no extended Agent Card configured.
 *
 * @since 0.1.0
 */
export class ExtendedAgentCardNotConfiguredError extends Schema.TaggedError<ExtendedAgentCardNotConfiguredError>()(
  'ExtendedAgentCardNotConfiguredError',
  errorFields('Extended Agent Card not configured')
) {}

/**
 * The client did not declare an extension that the agent requires.
 *
 * @since 0.1.0
 */
export class ExtensionSupportRequiredError extends Schema.TaggedError<ExtensionSupportRequiredError>()(
  'ExtensionSupportRequiredError',
  errorFields('Extension support required')
) {}

/**
 * The agent does not support the requested protocol version.
 *
 * @since 0.1.0
 */
export class VersionNotSupportedError extends Schema.TaggedError<VersionNotSupportedError>()(
  'VersionNotSupportedError',
  errorFields('Version not supported')
) {}

/**
 * The request is malformed: invalid JSON, a missing field or a bad value.
 *
 * @since 0.1.0
 */
export class RequestMalformedError extends Schema.TaggedError<RequestMalformedError>()(
  'RequestMalformedError',
  errorFields('Request malformed')
) {}

/**
 * An A2A error of the specification.
 *
 * @since 0.1.0
 */
export type A2AError =
  | TaskNotFoundError
  | TaskNotCancelableError
  | PushNotificationNotSupportedError
  | UnsupportedOperationError
  | ContentTypeNotSupportedError
  | InvalidAgentResponseError
  | ExtendedAgentCardNotConfiguredError
  | ExtensionSupportRequiredError
  | VersionNotSupportedError
  | RequestMalformedError;

/**
 * The schema of every A2A error.
 *
 * @since 0.1.0
 */
export const A2AError = Schema.Union([
  TaskNotFoundError,
  TaskNotCancelableError,
  PushNotificationNotSupportedError,
  UnsupportedOperationError,
  ContentTypeNotSupportedError,
  InvalidAgentResponseError,
  ExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError,
  VersionNotSupportedError,
  RequestMalformedError,
]);

/**
 * The tag of an A2A error.
 *
 * @since 0.1.0
 */
export type A2AErrorName = A2AError['_tag'];

/**
 * A failure that is not an A2A error: an executor, store or encoding failure.
 * It maps to JSON-RPC `-32603`, HTTP 500 and gRPC `UNKNOWN`, as a plain
 * `Error` does in the reference SDK.
 *
 * @since 0.1.0
 */
export class InternalError extends Schema.TaggedError<InternalError>()(
  'InternalError',
  {
    message: Schema.String.pipe(
      Schema.withConstructorDefault(
        Effect.succeed('An unexpected error occurred.')
      )
    ),
  }
) {}

/**
 * A server-side failure that a binding turns into an error response.
 *
 * @since 0.1.0
 */
export type ServerError = A2AError | InternalError;

const A2AErrorTags: ReadonlyArray<string> = [
  'TaskNotFoundError',
  'TaskNotCancelableError',
  'PushNotificationNotSupportedError',
  'UnsupportedOperationError',
  'ContentTypeNotSupportedError',
  'InvalidAgentResponseError',
  'ExtendedAgentCardNotConfiguredError',
  'ExtensionSupportRequiredError',
  'VersionNotSupportedError',
  'RequestMalformedError',
];

/**
 * Tells whether a value is an A2A error.
 *
 * @since 0.1.0
 */
export const isA2AError = (value: unknown): value is A2AError =>
  Predicate.hasProperty(value, '_tag') &&
  Predicate.isString(value._tag) &&
  A2AErrorTags.includes(value._tag);

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * The JSON-RPC error codes of the specification (§9.5).
 *
 * @since 0.1.0
 */
export const A2A_ERROR_CODE = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  PUSH_NOTIFICATION_NOT_SUPPORTED: -32003,
  UNSUPPORTED_OPERATION: -32004,
  CONTENT_TYPE_NOT_SUPPORTED: -32005,
  INVALID_AGENT_RESPONSE: -32006,
  EXTENDED_CARD_NOT_CONFIGURED: -32007,
  EXTENSION_SUPPORT_REQUIRED: -32008,
  VERSION_NOT_SUPPORTED: -32009,
} as const;

/**
 * The HTTP status codes of the HTTP+JSON binding.
 *
 * @since 0.1.0
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
} as const;

/**
 * The `google.rpc.Code` names that an HTTP+JSON error body carries in
 * `error.status`.
 *
 * @since 0.1.0
 */
export const REST_STATUS_NAME = {
  OK: 'OK',
  CANCELLED: 'CANCELLED',
  UNKNOWN: 'UNKNOWN',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  DEADLINE_EXCEEDED: 'DEADLINE_EXCEEDED',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  RESOURCE_EXHAUSTED: 'RESOURCE_EXHAUSTED',
  FAILED_PRECONDITION: 'FAILED_PRECONDITION',
  ABORTED: 'ABORTED',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  UNIMPLEMENTED: 'UNIMPLEMENTED',
  INTERNAL: 'INTERNAL',
  UNAVAILABLE: 'UNAVAILABLE',
  DATA_LOSS: 'DATA_LOSS',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
} as const;

/**
 * The binding values of one A2A error.
 *
 * @since 0.1.0
 */
export interface A2AErrorSpec {
  readonly name: A2AErrorName;
  /** The `ErrorInfo.reason`, UPPER_SNAKE_CASE. */
  readonly reason: string;
  readonly defaultMessage: string;
  readonly jsonRpcCode: number;
  readonly httpStatus: number;
  readonly restStatus: string;
}

/**
 * The binding values of every A2A error, by tag.
 *
 * @since 0.1.0
 */
export const A2A_ERROR_SPECS: { readonly [K in A2AErrorName]: A2AErrorSpec } = {
  TaskNotFoundError: {
    name: 'TaskNotFoundError',
    reason: 'TASK_NOT_FOUND',
    defaultMessage: 'Task not found',
    jsonRpcCode: A2A_ERROR_CODE.TASK_NOT_FOUND,
    httpStatus: HTTP_STATUS.NOT_FOUND,
    restStatus: REST_STATUS_NAME.NOT_FOUND,
  },
  TaskNotCancelableError: {
    name: 'TaskNotCancelableError',
    reason: 'TASK_NOT_CANCELABLE',
    defaultMessage: 'Task cannot be canceled',
    jsonRpcCode: A2A_ERROR_CODE.TASK_NOT_CANCELABLE,
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    restStatus: REST_STATUS_NAME.FAILED_PRECONDITION,
  },
  PushNotificationNotSupportedError: {
    name: 'PushNotificationNotSupportedError',
    reason: 'PUSH_NOTIFICATION_NOT_SUPPORTED',
    defaultMessage: 'Push Notification is not supported',
    jsonRpcCode: A2A_ERROR_CODE.PUSH_NOTIFICATION_NOT_SUPPORTED,
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    restStatus: REST_STATUS_NAME.FAILED_PRECONDITION,
  },
  UnsupportedOperationError: {
    name: 'UnsupportedOperationError',
    reason: 'UNSUPPORTED_OPERATION',
    defaultMessage: 'This operation is not supported',
    jsonRpcCode: A2A_ERROR_CODE.UNSUPPORTED_OPERATION,
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    restStatus: REST_STATUS_NAME.FAILED_PRECONDITION,
  },
  ContentTypeNotSupportedError: {
    name: 'ContentTypeNotSupportedError',
    reason: 'CONTENT_TYPE_NOT_SUPPORTED',
    defaultMessage: 'Incompatible content types',
    jsonRpcCode: A2A_ERROR_CODE.CONTENT_TYPE_NOT_SUPPORTED,
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    restStatus: REST_STATUS_NAME.INVALID_ARGUMENT,
  },
  InvalidAgentResponseError: {
    name: 'InvalidAgentResponseError',
    reason: 'INVALID_AGENT_RESPONSE',
    defaultMessage: 'Invalid agent response type',
    jsonRpcCode: A2A_ERROR_CODE.INVALID_AGENT_RESPONSE,
    httpStatus: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    restStatus: REST_STATUS_NAME.INTERNAL,
  },
  ExtendedAgentCardNotConfiguredError: {
    name: 'ExtendedAgentCardNotConfiguredError',
    reason: 'EXTENDED_AGENT_CARD_NOT_CONFIGURED',
    defaultMessage: 'Extended Agent Card not configured',
    jsonRpcCode: A2A_ERROR_CODE.EXTENDED_CARD_NOT_CONFIGURED,
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    restStatus: REST_STATUS_NAME.FAILED_PRECONDITION,
  },
  ExtensionSupportRequiredError: {
    name: 'ExtensionSupportRequiredError',
    reason: 'EXTENSION_SUPPORT_REQUIRED',
    defaultMessage: 'Extension support required',
    jsonRpcCode: A2A_ERROR_CODE.EXTENSION_SUPPORT_REQUIRED,
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    restStatus: REST_STATUS_NAME.FAILED_PRECONDITION,
  },
  VersionNotSupportedError: {
    name: 'VersionNotSupportedError',
    reason: 'VERSION_NOT_SUPPORTED',
    defaultMessage: 'Version not supported',
    jsonRpcCode: A2A_ERROR_CODE.VERSION_NOT_SUPPORTED,
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    restStatus: REST_STATUS_NAME.FAILED_PRECONDITION,
  },
  RequestMalformedError: {
    name: 'RequestMalformedError',
    reason: 'INVALID_PARAMS',
    defaultMessage: 'Request malformed',
    jsonRpcCode: A2A_ERROR_CODE.INVALID_PARAMS,
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    restStatus: REST_STATUS_NAME.INVALID_ARGUMENT,
  },
};

const specList: ReadonlyArray<A2AErrorSpec> = Object.values(A2A_ERROR_SPECS);

/**
 * Looks up the error spec of an `ErrorInfo.reason`.
 *
 * @since 0.1.0
 */
export const specByReason = (reason: string): Option.Option<A2AErrorSpec> =>
  Arr.findFirst(specList, (spec) => spec.reason === reason);

/**
 * Looks up the error spec of a JSON-RPC code. The JSON-RPC parse error,
 * invalid request and method not found codes map to `RequestMalformedError`,
 * as in the reference client.
 *
 * @since 0.1.0
 */
export const specByJsonRpcCode = (code: number): Option.Option<A2AErrorSpec> =>
  Arr.findFirst(specList, (spec) => spec.jsonRpcCode === code).pipe(
    Option.orElse(() =>
      code === A2A_ERROR_CODE.PARSE_ERROR ||
      code === A2A_ERROR_CODE.INVALID_REQUEST ||
      code === A2A_ERROR_CODE.METHOD_NOT_FOUND
        ? Option.some(A2A_ERROR_SPECS.RequestMalformedError)
        : Option.none()
    )
  );

/**
 * Builds the A2A error of a spec.
 *
 * @since 0.1.0
 */
export const makeA2AError = (
  name: A2AErrorName,
  message: string,
  metadata?: { readonly [key: string]: string }
): A2AError => {
  const fields = metadata === undefined ? { message } : { message, metadata };
  switch (name) {
    case 'TaskNotFoundError':
      return new TaskNotFoundError(fields);
    case 'TaskNotCancelableError':
      return new TaskNotCancelableError(fields);
    case 'PushNotificationNotSupportedError':
      return new PushNotificationNotSupportedError(fields);
    case 'UnsupportedOperationError':
      return new UnsupportedOperationError(fields);
    case 'ContentTypeNotSupportedError':
      return new ContentTypeNotSupportedError(fields);
    case 'InvalidAgentResponseError':
      return new InvalidAgentResponseError(fields);
    case 'ExtendedAgentCardNotConfiguredError':
      return new ExtendedAgentCardNotConfiguredError(fields);
    case 'ExtensionSupportRequiredError':
      return new ExtensionSupportRequiredError(fields);
    case 'VersionNotSupportedError':
      return new VersionNotSupportedError(fields);
    case 'RequestMalformedError':
      return new RequestMalformedError(fields);
  }
};

// ---------------------------------------------------------------------------
// ErrorInfo
// ---------------------------------------------------------------------------

/**
 * The ProtoJSON form of a `google.rpc.ErrorInfo` detail.
 *
 * @since 0.1.0
 */
export const ErrorInfo = Schema.Struct({
  '@type': Schema.String,
  reason: Schema.String,
  domain: Schema.String,
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
}).annotate({ identifier: 'ErrorInfo' });

/**
 * @since 0.1.0
 */
export type ErrorInfo = typeof ErrorInfo.Type;

/**
 * The `ErrorInfo` detail of an A2A error.
 *
 * @since 0.1.0
 */
export const toErrorInfo = (error: A2AError): ErrorInfo => {
  const base = {
    '@type': ERROR_INFO_TYPE,
    reason: A2A_ERROR_SPECS[error._tag].reason,
    domain: A2A_ERROR_DOMAIN,
  };
  return error.metadata !== undefined && Object.keys(error.metadata).length > 0
    ? { ...base, metadata: error.metadata }
    : base;
};

const decodeErrorInfo = Schema.decodeUnknownOption(ErrorInfo);

/**
 * Finds the A2A error that an array of error details names, through the first
 * `ErrorInfo` whose reason is an A2A reason.
 *
 * @since 0.1.0
 */
export const fromErrorDetails = (
  details: unknown,
  message: string
): Option.Option<A2AError> =>
  Array.isArray(details)
    ? Arr.findFirst(details, (detail: unknown) =>
        Option.flatMap(decodeErrorInfo(detail), (info) =>
          info['@type'] === ERROR_INFO_TYPE
            ? Option.map(specByReason(info.reason), (spec) =>
                info.domain === A2A_ERROR_DOMAIN && info.metadata !== undefined
                  ? makeA2AError(spec.name, message, info.metadata)
                  : makeA2AError(spec.name, message)
              )
            : Option.none()
        )
      )
    : Option.none();

// ---------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------

/**
 * A JSON-RPC 2.0 error object.
 *
 * @since 0.1.0
 */
export const JsonRpcErrorObject = Schema.Struct({
  code: Schema.Int,
  message: Schema.String,
  data: Schema.optionalKey(Schema.Json),
}).annotate({ identifier: 'JsonRpcErrorObject' });

/**
 * @since 0.1.0
 */
export type JsonRpcErrorObject = typeof JsonRpcErrorObject.Type;

/**
 * The JSON-RPC error object of a server failure. An A2A error carries its
 * code and an `ErrorInfo` in `data`; any other failure is `-32603`.
 *
 * @since 0.1.0
 */
export const toJsonRpcError = (error: ServerError): JsonRpcErrorObject =>
  error._tag === 'InternalError'
    ? { code: A2A_ERROR_CODE.INTERNAL_ERROR, message: error.message }
    : {
        code: A2A_ERROR_SPECS[error._tag].jsonRpcCode,
        message: error.message,
        data: [toErrorInfo(error)],
      };

/**
 * The A2A error of a JSON-RPC error object, or `Option.none()` for a code
 * that names no A2A error.
 *
 * @since 0.1.0
 */
export const fromJsonRpcError = (
  error: JsonRpcErrorObject
): Option.Option<A2AError> =>
  Option.map(specByJsonRpcCode(error.code), (spec) =>
    fromErrorDetails(error.data, error.message).pipe(
      Option.filter((fromDetails) => fromDetails._tag === spec.name),
      Option.getOrElse(() => makeA2AError(spec.name, error.message))
    )
  );

// ---------------------------------------------------------------------------
// HTTP+JSON
// ---------------------------------------------------------------------------

/**
 * The HTTP+JSON error body: a `google.rpc.Status` in an `error` field.
 *
 * @since 0.1.0
 */
export const RestErrorBody = Schema.Struct({
  error: Schema.Struct({
    code: Schema.Int,
    status: Schema.String,
    message: Schema.String,
    details: Schema.Array(Schema.Json),
  }),
}).annotate({ identifier: 'RestErrorBody' });

/**
 * @since 0.1.0
 */
export type RestErrorBody = typeof RestErrorBody.Type;

/**
 * The HTTP status of a server failure.
 *
 * @since 0.1.0
 */
export const restStatusFor = (error: ServerError): number =>
  error._tag === 'InternalError'
    ? HTTP_STATUS.INTERNAL_SERVER_ERROR
    : A2A_ERROR_SPECS[error._tag].httpStatus;

/**
 * The HTTP+JSON error body of a server failure.
 *
 * @since 0.1.0
 */
export const toRestErrorBody = (
  error: ServerError,
  httpStatus: number = restStatusFor(error)
): RestErrorBody => {
  if (error._tag !== 'InternalError') {
    return {
      error: {
        code: httpStatus,
        status: A2A_ERROR_SPECS[error._tag].restStatus,
        message: error.message,
        details: [toErrorInfo(error)],
      },
    };
  }
  const status =
    httpStatus === HTTP_STATUS.NOT_FOUND
      ? REST_STATUS_NAME.NOT_FOUND
      : httpStatus === HTTP_STATUS.INTERNAL_SERVER_ERROR
        ? REST_STATUS_NAME.INTERNAL
        : httpStatus === HTTP_STATUS.BAD_REQUEST
          ? REST_STATUS_NAME.INVALID_ARGUMENT
          : REST_STATUS_NAME.UNKNOWN;
  return {
    error: { code: httpStatus, status, message: error.message, details: [] },
  };
};

/**
 * The A2A error of an HTTP+JSON error body, or `Option.none()` when its
 * details name no A2A error.
 *
 * @since 0.1.0
 */
export const fromRestErrorBody = (
  body: RestErrorBody['error']
): Option.Option<A2AError> => fromErrorDetails(body.details, body.message);

// ---------------------------------------------------------------------------
// Client-side failures
// ---------------------------------------------------------------------------

/**
 * A client call failed outside the A2A error model: the connection failed,
 * the server answered a status or body that names no A2A error, or the
 * response did not decode. `code` is the JSON-RPC code, HTTP status or gRPC
 * status, when there is one.
 *
 * @since 0.1.0
 */
export class A2ATransportError extends Schema.TaggedError<A2ATransportError>()(
  'A2ATransportError',
  {
    message: Schema.String,
    protocol: Schema.String,
    code: Schema.optionalKey(Schema.Number),
    data: Schema.optionalKey(Schema.Json),
    cause: Schema.optionalKey(Schema.Defect()),
  }
) {}

/**
 * A failure of a client call.
 *
 * @since 0.1.0
 */
export type ClientError = A2AError | A2ATransportError;

/**
 * The message of an unknown failure value.
 *
 * @since 0.1.0
 */
export const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (Predicate.isString(error)) return error;
  if (Predicate.isNullish(error)) return String(error);
  return String(error);
};
