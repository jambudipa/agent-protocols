/**
 * The v0.3 HTTP+JSON client transport: the v1.0 transport contract over the
 * `/v1/...` routes and the v0.3 protobuf JSON bodies, as
 * `LegacyRestTransport` of `@a2a-js/sdk` 1.3.0.
 *
 * @since 0.1.0
 */
import { Effect, Option, Schema, Stream } from 'effect';
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
import type { CallOptions, Transport } from '../../../client/Transport.js';
import {
  A2A_LEGACY_PROTOCOL_VERSION,
  TransportProtocol,
} from '../../../Constants.js';
import {
  type ClientError,
  InvalidAgentResponseError,
  UnsupportedOperationError,
} from '../../../errors/index.js';
import { parseJsonOption } from '../../../internal/json.js';
import type * as V1 from '../../../Types.js';
import { toCoreAgentCard } from '../AgentCard.js';
import { LEGACY_JSON_CONTENT_TYPE } from '../Constants.js';
import { LegacyErrorBody, fromLegacyErrorBody } from '../Errors.js';
import {
  fromProtoAgentCard,
  fromProtoSendMessageResponse,
  fromProtoStreamResponse,
  fromProtoTask,
  fromProtoTaskPushNotificationConfig,
  toProtoSendMessageRequest,
  toProtoTaskPushNotificationConfig,
} from '../proto.js';
import * as P from '../ProtoTypes.js';
import {
  toCompatMessageSendParams,
  toCompatTaskPushNotificationConfig,
  toCoreSendMessageResult,
  toCoreStreamResponse,
  toCoreTask,
  toCoreTaskPushNotificationConfig,
} from '../translate.js';

const PROTOCOL = TransportProtocol.HTTP_JSON;

const decodeErrorBody = Schema.decodeUnknownOption(LegacyErrorBody);

const invalidResponse = (error: { readonly message: string }) =>
  transportError(PROTOCOL, `Invalid response: ${error.message}`);

const errorOf = (status: number, text: string, path: string): ClientError =>
  Option.match(Option.flatMap(parseJsonOption(text), decodeErrorBody), {
    onNone: () =>
      transportError(
        PROTOCOL,
        `HTTP error for ${path}! Status: ${status}. Response: ${text || '(empty or non-JSON response)'}`,
        { code: status }
      ),
    onSome: (body) => fromLegacyErrorBody(body, PROTOCOL, status),
  });

/**
 * The options of a v0.3 HTTP+JSON transport.
 *
 * @since 0.1.0
 */
export interface LegacyRestTransportOptions {
  readonly endpoint: string;
  readonly httpClient: HttpClient.HttpClient;
}

/**
 * A transport that speaks v0.3 HTTP+JSON and presents the v1.0 operations.
 * `listTasks` has no v0.3 route and fails with `UnsupportedOperationError`.
 *
 * @since 0.1.0
 */
export const makeLegacyRestTransport = (
  options: LegacyRestTransportOptions
): Transport => {
  const endpoint = options.endpoint.replace(/\/+$/, '');
  const { httpClient } = options;

  const encode =
    <T, E extends Schema.Json>(schema: Schema.Codec<T, E>) =>
    (value: T): Effect.Effect<Schema.Json, ClientError> =>
      Schema.encodeEffect(schema)(value).pipe(
        Effect.mapError((error) =>
          transportError(PROTOCOL, `Invalid request: ${error.message}`)
        )
      );

  const request = (
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body: Option.Option<Schema.Json>,
    callOptions: CallOptions | undefined
  ): Effect.Effect<Schema.Json, ClientError> =>
    Effect.gen(function* () {
      const base = withHeaders(
        HttpClientRequest.make(method)(`${endpoint}${path}`),
        callOptions,
        {
          'Content-Type': LEGACY_JSON_CONTENT_TYPE,
          Accept: LEGACY_JSON_CONTENT_TYPE,
        }
      );
      const response = yield* executeText(
        httpClient,
        Option.match(body, {
          onNone: () => base,
          onSome: (json) => withJsonBody(base, json, LEGACY_JSON_CONTENT_TYPE),
        }),
        PROTOCOL
      );
      if (!isOk(response.status)) {
        return yield* Effect.fail(
          errorOf(response.status, response.text, path)
        );
      }
      if (response.status === 204 || response.text.trim() === '') return {};
      return yield* parseBody(response.text, PROTOCOL, 'response body');
    });

  const stream = (
    method: 'GET' | 'POST',
    path: string,
    body: Effect.Effect<Option.Option<Schema.Json>, ClientError>,
    callOptions: CallOptions | undefined
  ): Stream.Stream<V1.StreamResponse, ClientError> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const json = yield* body;
        const base = withHeaders(
          HttpClientRequest.make(method)(`${endpoint}${path}`),
          callOptions,
          {
            'Content-Type': LEGACY_JSON_CONTENT_TYPE,
            Accept: 'text/event-stream',
          }
        );
        const response = yield* executeStream(
          httpClient,
          Option.match(json, {
            onNone: () => base,
            onSome: (value) =>
              withJsonBody(base, value, LEGACY_JSON_CONTENT_TYPE),
          }),
          PROTOCOL
        );
        if (!isOk(response.status)) {
          const text = yield* response.text.pipe(
            Effect.orElseSucceed(() => '')
          );
          return yield* Effect.fail(errorOf(response.status, text, path));
        }
        const contentType = response.headers['content-type'] ?? '';
        if (!contentType.startsWith('text/event-stream')) {
          return yield* transportError(
            PROTOCOL,
            `Invalid response Content-Type for SSE stream. Expected 'text/event-stream', got '${contentType}'.`
          );
        }
        return sseEvents(response, PROTOCOL).pipe(
          Stream.mapEffect(
            (event): Effect.Effect<V1.StreamResponse, ClientError> =>
              Effect.gen(function* () {
                if (event.type === 'error') {
                  return yield* Effect.fail(
                    Option.match(
                      Option.flatMap(
                        parseJsonOption(event.data),
                        decodeErrorBody
                      ),
                      {
                        onNone: (): ClientError =>
                          transportError(
                            PROTOCOL,
                            `SSE error event: ${event.data}`
                          ),
                        onSome: (errorBody) =>
                          fromLegacyErrorBody(errorBody, PROTOCOL),
                      }
                    )
                  );
                }
                const data = yield* parseBody(
                  event.data,
                  PROTOCOL,
                  'SSE event data'
                );
                const proto = yield* decodeResponse(
                  P.ProtoStreamResponse,
                  PROTOCOL
                )(data);
                const compat = yield* fromProtoStreamResponse(proto).pipe(
                  Effect.mapError(
                    (error) =>
                      new InvalidAgentResponseError({ message: error.message })
                  )
                );
                return yield* toCoreStreamResponse(compat).pipe(
                  Effect.mapError(invalidResponse)
                );
              })
          )
        );
      })
    );

  const sendBody = (params: V1.SendMessageRequest) =>
    Effect.map(
      encode(P.ProtoSendMessageRequest)(
        toProtoSendMessageRequest(toCompatMessageSendParams(params))
      ),
      Option.some
    );

  const taskOf = (json: Schema.Json) =>
    decodeResponse(
      P.ProtoTask,
      PROTOCOL
    )(json).pipe(
      Effect.flatMap((proto) =>
        fromProtoTask(proto).pipe(Effect.mapError(invalidResponse))
      ),
      Effect.flatMap((task) =>
        toCoreTask(task).pipe(Effect.mapError(invalidResponse))
      )
    );

  const configOf = (json: Schema.Json) =>
    decodeResponse(
      P.ProtoTaskPushNotificationConfig,
      PROTOCOL
    )(json).pipe(
      Effect.flatMap((proto) =>
        fromProtoTaskPushNotificationConfig(proto).pipe(
          Effect.mapError(invalidResponse)
        )
      ),
      Effect.flatMap((config) => toCoreTaskPushNotificationConfig(config))
    );

  const configPath = (taskId: string) =>
    `/v1/tasks/${encodeURIComponent(taskId)}/pushNotificationConfigs`;

  return {
    protocolName: PROTOCOL,
    protocolVersion: A2A_LEGACY_PROTOCOL_VERSION,
    getExtendedAgentCard: (_params, callOptions) =>
      request('GET', '/v1/card', Option.none(), callOptions).pipe(
        Effect.flatMap(decodeResponse(P.ProtoAgentCard, PROTOCOL)),
        Effect.flatMap((proto) =>
          fromProtoAgentCard(proto).pipe(Effect.mapError(invalidResponse))
        ),
        Effect.flatMap((card) =>
          toCoreAgentCard(card).pipe(Effect.mapError(invalidResponse))
        )
      ),
    sendMessage: (params, callOptions) =>
      sendBody(params).pipe(
        Effect.flatMap((body) =>
          request('POST', '/v1/message:send', body, callOptions)
        ),
        Effect.flatMap(decodeResponse(P.ProtoSendMessageResponse, PROTOCOL)),
        Effect.flatMap((proto) =>
          fromProtoSendMessageResponse(proto).pipe(
            Effect.mapError(
              (error) =>
                new InvalidAgentResponseError({ message: error.message })
            )
          )
        ),
        Effect.flatMap((result) =>
          toCoreSendMessageResult(result).pipe(Effect.mapError(invalidResponse))
        )
      ),
    sendMessageStream: (params, callOptions) =>
      stream('POST', '/v1/message:stream', sendBody(params), callOptions),
    createTaskPushNotificationConfig: (params, callOptions) =>
      encode(P.ProtoTaskPushNotificationConfig)(
        toProtoTaskPushNotificationConfig(
          toCompatTaskPushNotificationConfig(params)
        )
      ).pipe(
        Effect.flatMap((body) =>
          request(
            'POST',
            configPath(params.taskId ?? ''),
            Option.some(body),
            callOptions
          )
        ),
        Effect.flatMap(configOf)
      ),
    getTaskPushNotificationConfig: (params, callOptions) =>
      request(
        'GET',
        `${configPath(params.taskId)}/${encodeURIComponent(params.id)}`,
        Option.none(),
        callOptions
      ).pipe(Effect.flatMap(configOf)),
    listTaskPushNotificationConfig: (params, callOptions) =>
      request(
        'GET',
        configPath(params.taskId),
        Option.none(),
        callOptions
      ).pipe(
        Effect.flatMap(
          decodeResponse(
            P.ProtoListTaskPushNotificationConfigResponse,
            PROTOCOL
          )
        ),
        Effect.flatMap((response) =>
          Effect.forEach(response.configs ?? [], (config) =>
            fromProtoTaskPushNotificationConfig(config).pipe(
              Effect.mapError(invalidResponse),
              Effect.flatMap((compat) =>
                toCoreTaskPushNotificationConfig(compat)
              )
            )
          )
        ),
        Effect.map((configs) => ({ configs, nextPageToken: '' }))
      ),
    deleteTaskPushNotificationConfig: (params, callOptions) =>
      request(
        'DELETE',
        `${configPath(params.taskId)}/${encodeURIComponent(params.id)}`,
        Option.none(),
        callOptions
      ).pipe(Effect.asVoid),
    getTask: (params, callOptions) =>
      request(
        'GET',
        `/v1/tasks/${encodeURIComponent(params.id)}${
          params.historyLength === undefined
            ? ''
            : `?${new URLSearchParams({ historyLength: String(params.historyLength) }).toString()}`
        }`,
        Option.none(),
        callOptions
      ).pipe(Effect.flatMap(taskOf)),
    cancelTask: (params, callOptions) =>
      request(
        'POST',
        `/v1/tasks/${encodeURIComponent(params.id)}:cancel`,
        Option.none(),
        callOptions
      ).pipe(Effect.flatMap(taskOf)),
    listTasks: () =>
      Effect.fail(
        new UnsupportedOperationError({
          message: 'tasks/list has no equivalent in v0.3 HTTP+JSON',
        })
      ),
    resubscribeTask: (params, callOptions) =>
      stream(
        'GET',
        `/v1/tasks/${encodeURIComponent(params.id)}:subscribe`,
        Effect.succeed(Option.none()),
        callOptions
      ),
  };
};

/**
 * The v0.3 HTTP+JSON transport as the `legacy` constructor of
 * `RestTransportFactory`.
 *
 * @since 0.1.0
 */
export const legacyRestTransport = (
  url: string,
  httpClient: HttpClient.HttpClient
): Transport => makeLegacyRestTransport({ endpoint: url, httpClient });
