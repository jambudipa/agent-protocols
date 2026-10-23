/**
 * Constants and method name maps of the A2A v0.3 compatibility layer, with
 * the names that `@a2a-js/sdk/compat/v0_3` 1.3.0 exports.
 *
 * @since 0.1.0
 */
import { Effect, Option, Predicate } from 'effect';
import {
  RequestMalformedError,
  UnsupportedOperationError,
} from '../../errors/index.js';

export { A2A_LEGACY_PROTOCOL_VERSION } from '../../Constants.js';

/**
 * The extensions header of protocol 0.3.
 *
 * @since 0.1.0
 */
export const LEGACY_HTTP_EXTENSION_HEADER = 'X-A2A-Extensions';

/**
 * The media type of v0.3 JSON bodies.
 *
 * @since 0.1.0
 */
export const LEGACY_JSON_CONTENT_TYPE = 'application/json';

/** @since 0.1.0 */
export const LEGACY_METHOD_MESSAGE_SEND = 'message/send';
/** @since 0.1.0 */
export const LEGACY_METHOD_MESSAGE_STREAM = 'message/stream';
/** @since 0.1.0 */
export const LEGACY_METHOD_TASKS_GET = 'tasks/get';
/** @since 0.1.0 */
export const LEGACY_METHOD_TASKS_CANCEL = 'tasks/cancel';
/** @since 0.1.0 */
export const LEGACY_METHOD_TASKS_RESUBSCRIBE = 'tasks/resubscribe';
/** @since 0.1.0 */
export const LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_SET =
  'tasks/pushNotificationConfig/set';
/** @since 0.1.0 */
export const LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_GET =
  'tasks/pushNotificationConfig/get';
/** @since 0.1.0 */
export const LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_LIST =
  'tasks/pushNotificationConfig/list';
/** @since 0.1.0 */
export const LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_DELETE =
  'tasks/pushNotificationConfig/delete';
/** @since 0.1.0 */
export const LEGACY_METHOD_GET_AUTHENTICATED_EXTENDED_CARD =
  'agent/getAuthenticatedExtendedCard';

type Table = { readonly [method: string]: string };

const LEGACY_JSONRPC_TO_V1: Table = {
  [LEGACY_METHOD_MESSAGE_SEND]: 'SendMessage',
  [LEGACY_METHOD_MESSAGE_STREAM]: 'SendStreamingMessage',
  [LEGACY_METHOD_TASKS_GET]: 'GetTask',
  [LEGACY_METHOD_TASKS_CANCEL]: 'CancelTask',
  [LEGACY_METHOD_TASKS_RESUBSCRIBE]: 'SubscribeToTask',
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_SET]:
    'CreateTaskPushNotificationConfig',
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_GET]: 'GetTaskPushNotificationConfig',
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_LIST]:
    'ListTaskPushNotificationConfigs',
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_DELETE]:
    'DeleteTaskPushNotificationConfig',
  [LEGACY_METHOD_GET_AUTHENTICATED_EXTENDED_CARD]: 'GetExtendedAgentCard',
};

const LEGACY_JSONRPC_TO_LEGACY_GRPC: Table = {
  [LEGACY_METHOD_MESSAGE_SEND]: 'SendMessage',
  [LEGACY_METHOD_MESSAGE_STREAM]: 'SendStreamingMessage',
  [LEGACY_METHOD_TASKS_GET]: 'GetTask',
  [LEGACY_METHOD_TASKS_CANCEL]: 'CancelTask',
  [LEGACY_METHOD_TASKS_RESUBSCRIBE]: 'TaskSubscription',
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_SET]:
    'CreateTaskPushNotificationConfig',
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_GET]: 'GetTaskPushNotificationConfig',
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_LIST]:
    'ListTaskPushNotificationConfig',
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_DELETE]:
    'DeleteTaskPushNotificationConfig',
  [LEGACY_METHOD_GET_AUTHENTICATED_EXTENDED_CARD]: 'GetAgentCard',
};

const V1_METHODS_WITHOUT_LEGACY_EQUIVALENT: ReadonlyArray<string> = [
  'ListTasks',
];

const invert = (table: Table): Table =>
  Object.fromEntries(Object.entries(table).map(([from, to]) => [to, from]));

const V1_TO_LEGACY_JSONRPC = invert(LEGACY_JSONRPC_TO_V1);
const LEGACY_GRPC_TO_LEGACY_JSONRPC = invert(LEGACY_JSONRPC_TO_LEGACY_GRPC);
const LEGACY_GRPC_TO_V1: Table = Object.fromEntries(
  Object.entries(LEGACY_JSONRPC_TO_LEGACY_GRPC).map(([jsonRpc, grpc]) => [
    grpc,
    LEGACY_JSONRPC_TO_V1[jsonRpc] ?? '',
  ])
);
const V1_TO_LEGACY_GRPC = invert(LEGACY_GRPC_TO_V1);

const entry = (table: Table, method: string): Option.Option<string> =>
  Object.prototype.hasOwnProperty.call(table, method)
    ? Option.fromUndefinedOr(table[method])
    : Option.none();

const lookup = (table: Table, method: string, direction: string) =>
  Option.match(entry(table, method), {
    onNone: () =>
      Effect.fail(
        new RequestMalformedError({
          message: `Unknown ${direction} method: "${method}"`,
        })
      ),
    onSome: (mapped) => Effect.succeed(mapped),
  });

const lookupFromV1 = (
  table: Table,
  method: string,
  legacyTransport: string
): Effect.Effect<string, RequestMalformedError | UnsupportedOperationError> =>
  Option.match(entry(table, method), {
    onSome: (mapped) => Effect.succeed(mapped),
    onNone: () =>
      V1_METHODS_WITHOUT_LEGACY_EQUIVALENT.includes(method)
        ? Effect.fail(
            new UnsupportedOperationError({
              message: `Unsupported operation: v1.0 method "${method}" has no equivalent in v0.3 ${legacyTransport}`,
            })
          )
        : Effect.fail(
            new RequestMalformedError({
              message: `Unknown v1.0 method: "${method}"`,
            })
          ),
  });

/**
 * The v1.0 method of a v0.3 JSON-RPC method.
 *
 * @since 0.1.0
 */
export const legacyJsonRpcToV1Method = (method: string) =>
  lookup(LEGACY_JSONRPC_TO_V1, method, 'legacy JSON-RPC');

/**
 * Tells whether a value is a v0.3 JSON-RPC method name.
 *
 * @since 0.1.0
 */
export const isLegacyJsonRpcMethod = (method: unknown): boolean =>
  Predicate.isString(method) &&
  Option.isSome(entry(LEGACY_JSONRPC_TO_V1, method));

/**
 * Tells whether a value is a v1.0 JSON-RPC method name.
 *
 * @since 0.1.0
 */
export const isV1JsonRpcMethod = (method: unknown): boolean =>
  Predicate.isString(method) &&
  (Option.isSome(entry(V1_TO_LEGACY_JSONRPC, method)) ||
    V1_METHODS_WITHOUT_LEGACY_EQUIVALENT.includes(method));

/**
 * The v0.3 JSON-RPC method of a v1.0 method.
 *
 * @since 0.1.0
 */
export const v1MethodToLegacyJsonRpc = (method: string) =>
  lookupFromV1(V1_TO_LEGACY_JSONRPC, method, 'JSON-RPC');

/**
 * The v0.3 gRPC method of a v0.3 JSON-RPC method.
 *
 * @since 0.1.0
 */
export const legacyJsonRpcToLegacyGrpcMethod = (method: string) =>
  lookup(LEGACY_JSONRPC_TO_LEGACY_GRPC, method, 'legacy JSON-RPC');

/**
 * The v0.3 JSON-RPC method of a v0.3 gRPC method.
 *
 * @since 0.1.0
 */
export const legacyGrpcToLegacyJsonRpcMethod = (method: string) =>
  lookup(LEGACY_GRPC_TO_LEGACY_JSONRPC, method, 'legacy gRPC');

/**
 * The v1.0 method of a v0.3 gRPC method.
 *
 * @since 0.1.0
 */
export const legacyGrpcToV1Method = (method: string) =>
  lookup(LEGACY_GRPC_TO_V1, method, 'legacy gRPC');

/**
 * The v0.3 gRPC method of a v1.0 method.
 *
 * @since 0.1.0
 */
export const v1MethodToLegacyGrpc = (method: string) =>
  lookupFromV1(V1_TO_LEGACY_GRPC, method, 'gRPC');
