/**
 * The v0.3 JSON-RPC dispatcher: the v0.3 methods (`message/send`,
 * `tasks/get`, ...) over the v1.0 request handler, with the envelopes and
 * error codes of `LegacyJsonRpcTransportHandler` of `@a2a-js/sdk` 1.3.0.
 *
 * @since 0.1.0
 */
import { Effect, Option, Result, Schema, Stream } from 'effect';
import {
  A2A_ERROR_CODE,
  type ServerError,
  UnsupportedOperationError,
} from '../../../errors/index.js';
import {
  catchDefects,
  decodeParams,
  encodeJson,
} from '../../../server/internal/http.js';
import {
  type JsonRpcDispatcher,
  type JsonRpcId,
  JsonRpcOutcome,
  errorEnvelope,
  paramsAreValid,
  parseEnvelope,
  requestIdOf,
  successEnvelope,
} from '../../../server/JsonRpc.js';
import type { A2ARequestHandler } from '../../../server/RequestHandler.js';
import type { ServerCallContext } from '../../../server/ServerCallContext.js';
import type { StreamResponse } from '../../../Types.js';
import { toCompatAgentCard } from '../AgentCard.js';
import {
  LEGACY_HTTP_EXTENSION_HEADER,
  LEGACY_METHOD_GET_AUTHENTICATED_EXTENDED_CARD,
  LEGACY_METHOD_MESSAGE_SEND,
  LEGACY_METHOD_MESSAGE_STREAM,
  LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_DELETE,
  LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_GET,
  LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_LIST,
  LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_SET,
  LEGACY_METHOD_TASKS_CANCEL,
  LEGACY_METHOD_TASKS_GET,
  LEGACY_METHOD_TASKS_RESUBSCRIBE,
} from '../Constants.js';
import { toLegacyErrorBody } from '../Errors.js';
import {
  toCompatSendMessageResult,
  toCompatStreamEvent,
  toCompatTask,
  toCompatTaskPushNotificationConfig,
  toCoreSendMessageRequest,
  toCoreTaskPushNotificationConfig,
} from '../translate.js';
import * as V03 from '../Types.js';

/** Encodes a v0.3 task for a result; a failure is an `InternalError`, not a defect. */
const encodeTask = encodeJson(V03.Task);
/** Encodes one v0.3 push notification config for a result. */
const encodeConfig = encodeJson(V03.TaskPushNotificationConfig);
/**
 * The list result of `tasks/pushNotificationConfig/list`. v0.3 returns a bare
 * array, not the v1.0 `{ configs }` object.
 */
const TaskPushNotificationConfigs = Schema.Array(
  V03.TaskPushNotificationConfig
).annotate({ identifier: 'V03TaskPushNotificationConfigs' });
/** Encodes the bare array result of the v0.3 list method. */
const encodeConfigs = encodeJson(TaskPushNotificationConfigs);
/**
 * Encodes one translated stream event. An encoding failure ends the stream
 * with an `InternalError` rather than dropping the event.
 */
const encodeEvent = encodeJson(V03.StreamEvent);

/**
 * The JSON-RPC error envelope for a failure, with the v0.3 error body (no
 * `ErrorInfo` in `data`). Every method failure goes through it, so v0.3
 * clients never see a v1.0 error shape.
 */
const errorResponse = (id: JsonRpcId, error: ServerError) =>
  JsonRpcOutcome.Response({
    body: errorEnvelope(id, toLegacyErrorBody(error)),
  });

/**
 * The v0.3 dispatcher over a v1.0 request handler.
 *
 * @since 0.1.0
 */
export const makeLegacyJsonRpcDispatcher = (
  handler: A2ARequestHandler['Service']
): JsonRpcDispatcher => {
  const unary = (
    id: JsonRpcId,
    result: Effect.Effect<Option.Option<Schema.Json>, ServerError>
  ): Effect.Effect<JsonRpcOutcome> =>
    catchDefects(result).pipe(
      Effect.map((value) =>
        JsonRpcOutcome.Response({ body: successEnvelope(id, value) })
      ),
      Effect.catch((error) => Effect.succeed(errorResponse(id, error)))
    );

  const requireStreaming = (method: string) =>
    Effect.flatMap(handler.getAgentCard, (card) =>
      card.capabilities.streaming === true
        ? Effect.void
        : Effect.fail(
            new UnsupportedOperationError({
              message: `Unsupported operation: Method ${method} requires streaming capability.`,
            })
          )
    );

  const streaming = (
    id: JsonRpcId,
    method: string,
    events: Effect.Effect<
      Stream.Stream<StreamResponse, ServerError>,
      ServerError
    >,
    eager: boolean
  ): Effect.Effect<JsonRpcOutcome> =>
    catchDefects(Effect.andThen(requireStreaming(method), () => events)).pipe(
      Effect.map((stream) =>
        JsonRpcOutcome.Stream({
          id,
          eager,
          results: Stream.mapEffect(stream, (event) =>
            encodeEvent(toCompatStreamEvent(event))
          ),
        })
      ),
      Effect.catch((error) => Effect.succeed(errorResponse(id, error)))
    );

  const dispatch = (
    body: Schema.Json,
    context: ServerCallContext
  ): Effect.Effect<JsonRpcOutcome> =>
    Effect.gen(function* () {
      const envelope = yield* Effect.result(parseEnvelope(body));
      if (Result.isFailure(envelope)) {
        return JsonRpcOutcome.Response({
          body: errorEnvelope(requestIdOf(body), {
            code: A2A_ERROR_CODE.INVALID_REQUEST,
            message: 'Invalid JSON-RPC Request.',
          }),
        });
      }
      const { id, method, params } = envelope.success;
      if (
        method !== LEGACY_METHOD_GET_AUTHENTICATED_EXTENDED_CARD &&
        !paramsAreValid(params)
      ) {
        return JsonRpcOutcome.Response({
          body: errorEnvelope(id, {
            code: A2A_ERROR_CODE.INVALID_PARAMS,
            message: 'Invalid method parameters.',
          }),
        });
      }
      const input = Option.getOrElse(params, (): Schema.Json => ({}));
      switch (method) {
        case LEGACY_METHOD_MESSAGE_STREAM:
          return yield* streaming(
            id,
            method,
            decodeParams(V03.MessageSendParams)(input).pipe(
              Effect.flatMap((compat) => toCoreSendMessageRequest(compat)),
              Effect.map((request) =>
                handler.sendMessageStream(request, context)
              )
            ),
            false
          );
        case LEGACY_METHOD_TASKS_RESUBSCRIBE:
          return yield* streaming(
            id,
            method,
            Effect.map(decodeParams(V03.TaskIdParams)(input), (request) =>
              handler.resubscribe({ id: request.id }, context)
            ),
            true
          );
        case LEGACY_METHOD_MESSAGE_SEND:
          return yield* unary(
            id,
            decodeParams(V03.MessageSendParams)(input).pipe(
              Effect.flatMap((compat) => toCoreSendMessageRequest(compat)),
              Effect.flatMap((request) =>
                handler.sendMessage(request, context)
              ),
              Effect.flatMap((result) =>
                encodeJson(V03.SendMessageResult)(
                  toCompatSendMessageResult(result)
                )
              ),
              Effect.map(Option.some)
            )
          );
        case LEGACY_METHOD_TASKS_GET:
          return yield* unary(
            id,
            decodeParams(V03.TaskQueryParams)(input).pipe(
              Effect.flatMap((request) =>
                handler.getTask(
                  request.historyLength === undefined
                    ? { id: request.id }
                    : { id: request.id, historyLength: request.historyLength },
                  context
                )
              ),
              Effect.flatMap((task) => encodeTask(toCompatTask(task))),
              Effect.map(Option.some)
            )
          );
        case LEGACY_METHOD_TASKS_CANCEL:
          return yield* unary(
            id,
            decodeParams(V03.TaskIdParams)(input).pipe(
              Effect.flatMap((request) =>
                handler.cancelTask(
                  request.metadata === undefined
                    ? { id: request.id }
                    : { id: request.id, metadata: request.metadata },
                  context
                )
              ),
              Effect.flatMap((task) => encodeTask(toCompatTask(task))),
              Effect.map(Option.some)
            )
          );
        case LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_SET:
          return yield* unary(
            id,
            decodeParams(V03.TaskPushNotificationConfig)(input).pipe(
              Effect.flatMap((compat) =>
                toCoreTaskPushNotificationConfig(compat)
              ),
              Effect.flatMap((config) =>
                handler.createTaskPushNotificationConfig(config, context)
              ),
              Effect.flatMap((config) =>
                encodeConfig(toCompatTaskPushNotificationConfig(config))
              ),
              Effect.map(Option.some)
            )
          );
        case LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_GET:
          return yield* unary(
            id,
            decodeParams(V03.GetTaskPushNotificationConfigParams)(input).pipe(
              Effect.flatMap((request) =>
                handler.getTaskPushNotificationConfig(
                  {
                    taskId: request.id,
                    id: request.pushNotificationConfigId ?? '',
                  },
                  context
                )
              ),
              Effect.flatMap((config) =>
                encodeConfig(toCompatTaskPushNotificationConfig(config))
              ),
              Effect.map(Option.some)
            )
          );
        case LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_LIST:
          return yield* unary(
            id,
            decodeParams(V03.ListTaskPushNotificationConfigParams)(input).pipe(
              Effect.flatMap((request) =>
                handler.listTaskPushNotificationConfigs(
                  { taskId: request.id },
                  context
                )
              ),
              Effect.flatMap((response) =>
                encodeConfigs(
                  (response.configs ?? []).map(
                    toCompatTaskPushNotificationConfig
                  )
                )
              ),
              Effect.map(Option.some)
            )
          );
        case LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_DELETE:
          return yield* unary(
            id,
            decodeParams(V03.DeleteTaskPushNotificationConfigParams)(
              input
            ).pipe(
              Effect.flatMap((request) =>
                handler.deleteTaskPushNotificationConfig(
                  { taskId: request.id, id: request.pushNotificationConfigId },
                  context
                )
              ),
              Effect.as(Option.none<Schema.Json>())
            )
          );
        case LEGACY_METHOD_GET_AUTHENTICATED_EXTENDED_CARD:
          return yield* unary(
            id,
            handler.getAuthenticatedExtendedAgentCard({}, context).pipe(
              Effect.flatMap((card) => toCompatAgentCard(card)),
              Effect.flatMap(encodeJson(V03.AgentCard)),
              Effect.map(Option.some)
            )
          );
        default:
          return JsonRpcOutcome.Response({
            body: errorEnvelope(id, {
              code: A2A_ERROR_CODE.METHOD_NOT_FOUND,
              message: `Method not found: ${method}`,
            }),
          });
      }
    });

  return {
    extensionHeader: LEGACY_HTTP_EXTENSION_HEADER,
    dispatch,
    errorObject: toLegacyErrorBody,
  };
};
