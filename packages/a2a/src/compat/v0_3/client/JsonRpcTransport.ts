/**
 * The v0.3 JSON-RPC client transport: the v1.0 transport contract over the
 * v0.3 methods and data model, as `LegacyJsonRpcTransport` of
 * `@a2a-js/sdk` 1.3.0.
 *
 * @since 0.1.0
 */
import { Effect, Option, Predicate, Schema, Stream } from 'effect';
import { HttpClientRequest, type HttpClient } from 'effect/http';
import {
  decodeResponse,
  executeStream,
  executeText,
  isOk,
  parseBody,
  sseEvents,
  transportError,
  withHeaders,
  withJsonBody,
} from '../../../client/internal/http.js';
import { fromJsonRpcErrorResponse } from '../../../client/JsonRpcTransport.js';
import type { CallOptions, Transport } from '../../../client/Transport.js';
import {
  A2A_ERROR_CODE,
  A2ATransportError,
  type ClientError,
  InvalidAgentResponseError,
} from '../../../errors/index.js';
import { stringifyJson } from '../../../internal/json.js';
import {
  A2A_LEGACY_PROTOCOL_VERSION,
  JSON_CONTENT_TYPE,
  TransportProtocol,
} from '../../../Constants.js';
import type * as V1 from '../../../Types.js';
import { toCoreAgentCard } from '../AgentCard.js';
import {
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
import {
  toCompatMessageSendParams,
  toCompatTaskPushNotificationConfig,
  toCoreSendMessageResult,
  toCoreStreamResponse,
  toCoreTask,
  toCoreTaskPushNotificationConfig,
} from '../translate.js';
import * as V03 from '../Types.js';

const PROTOCOL = TransportProtocol.JSONRPC;

type Envelope = { readonly [key: string]: Schema.Json };

const isEnvelope = (value: Schema.Json): value is Envelope =>
  Predicate.isObject(value) && !Array.isArray(value);

const invalidResponse = (error: { readonly message: string }) =>
  transportError(PROTOCOL, `Invalid response: ${error.message}`);

const TaskPushNotificationConfigs = Schema.Array(
  V03.TaskPushNotificationConfig
).annotate({ identifier: 'V03TaskPushNotificationConfigs' });

/**
 * The options of a v0.3 JSON-RPC transport.
 *
 * @since 0.1.0
 */
export interface LegacyJsonRpcTransportOptions {
  readonly endpoint: string;
  readonly httpClient: HttpClient.HttpClient;
}

/**
 * A transport that speaks v0.3 JSON-RPC and presents the v1.0 operations.
 * `listTasks` has no v0.3 method and fails with JSON-RPC code -32601.
 *
 * @since 0.1.0
 */
export const makeLegacyJsonRpcTransport = (
  options: LegacyJsonRpcTransportOptions
): Transport => {
  const { endpoint, httpClient } = options;
  let requestIdCounter = 1;
  const nextId = Effect.sync(() => requestIdCounter++);

  const post = (
    method: string,
    params: Option.Option<Schema.Json>,
    id: number,
    accept: string,
    callOptions: CallOptions | undefined
  ) =>
    withJsonBody(
      withHeaders(HttpClientRequest.post(endpoint), callOptions, {
        'Content-Type': JSON_CONTENT_TYPE,
        Accept: accept,
      }),
      Option.match(params, {
        onNone: (): Schema.Json => ({ jsonrpc: '2.0', id, method }),
        onSome: (value): Schema.Json => ({
          jsonrpc: '2.0',
          id,
          method,
          params: value,
        }),
      }),
      JSON_CONTENT_TYPE
    );

  const call = (
    method: string,
    params: Option.Option<Schema.Json>,
    callOptions: CallOptions | undefined
  ): Effect.Effect<Schema.Json, ClientError> =>
    Effect.gen(function* () {
      const id = yield* nextId;
      const response = yield* executeText(
        httpClient,
        post(method, params, id, JSON_CONTENT_TYPE, callOptions),
        PROTOCOL
      );
      const body = yield* parseBody(response.text, PROTOCOL, 'response').pipe(
        Effect.mapError(() =>
          transportError(
            PROTOCOL,
            `HTTP error for ${method}! Status: ${response.status}. Response: ${response.text || '(empty or non-JSON response)'}`,
            { code: response.status }
          )
        )
      );
      if (!isEnvelope(body)) {
        return yield* transportError(
          PROTOCOL,
          `Invalid response for ${method}.`
        );
      }
      if ('error' in body) {
        return yield* Effect.fail(fromJsonRpcErrorResponse(body['error']));
      }
      if (!isOk(response.status)) {
        return yield* transportError(
          PROTOCOL,
          `HTTP error for ${method}! Status: ${response.status}. Response: ${response.text}`,
          { code: response.status }
        );
      }
      if (body['id'] !== id) {
        return yield* transportError(
          PROTOCOL,
          `JSON-RPC response ID mismatch for method ${method}. Expected ${id}, got ${stringifyJson(body['id'] ?? '')}.`
        );
      }
      return body['result'] ?? {};
    });

  const encode =
    <T, E extends Schema.Json>(schema: Schema.Codec<T, E>) =>
    (value: T): Effect.Effect<Option.Option<Schema.Json>, ClientError> =>
      Schema.encodeEffect(schema)(value).pipe(
        Effect.map(Option.some),
        Effect.mapError((error) =>
          transportError(PROTOCOL, `Invalid request: ${error.message}`)
        )
      );

  const stream = (
    method: string,
    params: Effect.Effect<Option.Option<Schema.Json>, ClientError>,
    callOptions: CallOptions | undefined
  ): Stream.Stream<V1.StreamResponse, ClientError> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const encoded = yield* params;
        const id = yield* nextId;
        const response = yield* executeStream(
          httpClient,
          post(method, encoded, id, 'text/event-stream', callOptions),
          PROTOCOL
        );
        const contentType = response.headers['content-type'] ?? '';
        if (
          !isOk(response.status) ||
          !contentType.startsWith('text/event-stream')
        ) {
          const text = yield* response.text.pipe(
            Effect.orElseSucceed(() => '')
          );
          const parsed = yield* Effect.option(
            parseBody(text, PROTOCOL, 'error body')
          );
          if (
            Option.isSome(parsed) &&
            isEnvelope(parsed.value) &&
            'error' in parsed.value
          ) {
            return yield* Effect.fail(
              fromJsonRpcErrorResponse(parsed.value['error'])
            );
          }
          return yield* transportError(
            PROTOCOL,
            `HTTP error establishing stream for ${method}: ${response.status}. Response: ${text || '(empty)'}`,
            { code: response.status }
          );
        }
        return sseEvents(response, PROTOCOL).pipe(
          Stream.mapEffect(
            (event): Effect.Effect<V1.StreamResponse, ClientError> =>
              Effect.gen(function* () {
                const envelope = yield* parseBody(
                  event.data,
                  PROTOCOL,
                  'SSE event data'
                );
                if (!isEnvelope(envelope)) {
                  return yield* transportError(
                    PROTOCOL,
                    `Invalid SSE event: ${event.data}`
                  );
                }
                if (envelope['id'] !== id) {
                  return yield* transportError(
                    PROTOCOL,
                    `JSON-RPC response ID mismatch in SSE event. Expected ${id}, got ${stringifyJson(envelope['id'] ?? '')}.`
                  );
                }
                if ('error' in envelope) {
                  return yield* Effect.fail(
                    fromJsonRpcErrorResponse(envelope['error'])
                  );
                }
                const result = envelope['result'];
                if (result === undefined) {
                  return yield* transportError(
                    PROTOCOL,
                    `SSE event JSON-RPC response is missing 'result' field. Data: ${event.data}`
                  );
                }
                const compat = yield* decodeResponse(
                  V03.StreamEvent,
                  PROTOCOL
                )(result);
                return yield* toCoreStreamResponse(compat).pipe(
                  Effect.mapError(invalidResponse)
                );
              })
          )
        );
      })
    );

  const sendParams = (params: V1.SendMessageRequest) =>
    encode(V03.MessageSendParams)(toCompatMessageSendParams(params));

  return {
    protocolName: PROTOCOL,
    protocolVersion: A2A_LEGACY_PROTOCOL_VERSION,
    getExtendedAgentCard: (_params, callOptions) =>
      call(
        LEGACY_METHOD_GET_AUTHENTICATED_EXTENDED_CARD,
        Option.none(),
        callOptions
      ).pipe(
        Effect.flatMap(decodeResponse(V03.AgentCard, PROTOCOL)),
        Effect.flatMap((card) =>
          toCoreAgentCard(card).pipe(Effect.mapError(invalidResponse))
        )
      ),
    sendMessage: (params, callOptions) =>
      sendParams(params).pipe(
        Effect.flatMap((encoded) =>
          call(LEGACY_METHOD_MESSAGE_SEND, encoded, callOptions)
        ),
        Effect.flatMap((result) =>
          decodeResponse(
            V03.SendMessageResult,
            PROTOCOL
          )(result).pipe(
            Effect.mapError(
              () =>
                new InvalidAgentResponseError({
                  message:
                    'Invalid response: v0.3 message/send result is invalid.',
                })
            )
          )
        ),
        Effect.flatMap((result) =>
          toCoreSendMessageResult(result).pipe(Effect.mapError(invalidResponse))
        )
      ),
    sendMessageStream: (params, callOptions) =>
      stream(LEGACY_METHOD_MESSAGE_STREAM, sendParams(params), callOptions),
    createTaskPushNotificationConfig: (params, callOptions) =>
      encode(V03.TaskPushNotificationConfig)(
        toCompatTaskPushNotificationConfig(params)
      ).pipe(
        Effect.flatMap((encoded) =>
          call(LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_SET, encoded, callOptions)
        ),
        Effect.flatMap(
          decodeResponse(V03.TaskPushNotificationConfig, PROTOCOL)
        ),
        Effect.flatMap((config) => toCoreTaskPushNotificationConfig(config))
      ),
    getTaskPushNotificationConfig: (params, callOptions) =>
      call(
        LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_GET,
        Option.some(
          params.id === ''
            ? { id: params.taskId }
            : { id: params.taskId, pushNotificationConfigId: params.id }
        ),
        callOptions
      ).pipe(
        Effect.flatMap(
          decodeResponse(V03.TaskPushNotificationConfig, PROTOCOL)
        ),
        Effect.flatMap((config) => toCoreTaskPushNotificationConfig(config))
      ),
    listTaskPushNotificationConfig: (params, callOptions) =>
      call(
        LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_LIST,
        Option.some({ id: params.taskId }),
        callOptions
      ).pipe(
        Effect.flatMap(decodeResponse(TaskPushNotificationConfigs, PROTOCOL)),
        Effect.flatMap((configs) =>
          Effect.forEach(configs, (config) =>
            toCoreTaskPushNotificationConfig(config)
          )
        ),
        Effect.map((configs) => ({ configs, nextPageToken: '' }))
      ),
    deleteTaskPushNotificationConfig: (params, callOptions) =>
      call(
        LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_DELETE,
        Option.some({ id: params.taskId, pushNotificationConfigId: params.id }),
        callOptions
      ).pipe(Effect.asVoid),
    getTask: (params, callOptions) =>
      call(
        LEGACY_METHOD_TASKS_GET,
        Option.some(
          params.historyLength === undefined
            ? { id: params.id }
            : { id: params.id, historyLength: params.historyLength }
        ),
        callOptions
      ).pipe(
        Effect.flatMap(decodeResponse(V03.Task, PROTOCOL)),
        Effect.flatMap((task) =>
          toCoreTask(task).pipe(Effect.mapError(invalidResponse))
        )
      ),
    cancelTask: (params, callOptions) =>
      call(
        LEGACY_METHOD_TASKS_CANCEL,
        Option.some(
          params.metadata === undefined
            ? { id: params.id }
            : { id: params.id, metadata: params.metadata }
        ),
        callOptions
      ).pipe(
        Effect.flatMap(decodeResponse(V03.Task, PROTOCOL)),
        Effect.flatMap((task) =>
          toCoreTask(task).pipe(Effect.mapError(invalidResponse))
        )
      ),
    listTasks: () =>
      Effect.fail(
        new A2ATransportError({
          message: 'Method not found: tasks/list',
          protocol: PROTOCOL,
          code: A2A_ERROR_CODE.METHOD_NOT_FOUND,
        })
      ),
    resubscribeTask: (params, callOptions) =>
      stream(
        LEGACY_METHOD_TASKS_RESUBSCRIBE,
        Effect.succeed(Option.some({ id: params.id })),
        callOptions
      ),
  };
};

/**
 * The v0.3 JSON-RPC transport as the `legacy` constructor of
 * `JsonRpcTransportFactory`.
 *
 * @since 0.1.0
 */
export const legacyJsonRpcTransport = (
  url: string,
  httpClient: HttpClient.HttpClient
): Transport => makeLegacyJsonRpcTransport({ endpoint: url, httpClient });
