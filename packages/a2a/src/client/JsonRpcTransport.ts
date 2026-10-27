/**
 * The JSON-RPC client transport, on the Effect `HttpClient`.
 *
 * @since 0.1.0
 */
import { Effect, Option, Predicate, Schema, Stream } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import {
  A2A_PROTOCOL_VERSION,
  JSON_CONTENT_TYPE,
  TransportProtocol,
} from '../Constants.js';
import {
  type A2AError,
  type A2ATransportError,
  type ClientError,
  JsonRpcErrorObject,
  fromJsonRpcError,
} from '../errors/index.js';
import { stringifyJson } from '../internal/json.js';
import {
  AgentCard,
  CancelTaskRequest,
  DeleteTaskPushNotificationConfigRequest,
  GetExtendedAgentCardRequest,
  GetTaskPushNotificationConfigRequest,
  GetTaskRequest,
  ListTaskPushNotificationConfigsRequest,
  ListTaskPushNotificationConfigsResponse,
  ListTasksRequest,
  ListTasksResponse,
  SendMessageRequest,
  SendMessageResponse,
  StreamResponse,
  SubscribeToTaskRequest,
  Task,
  TaskPushNotificationConfig,
} from '../Types.js';
import {
  decodeResponse,
  encodeRequest,
  executeStream,
  executeText,
  isOk,
  parseBody,
  sseEvents,
  transportError,
  withHeaders,
  withJsonBody,
} from './internal/http.js';
import {
  type CallOptions,
  type Transport,
  type TransportFactory,
  pickMatchingInterface,
} from './Transport.js';

/** The protocol name in the transport errors of this file. */
const PROTOCOL = TransportProtocol.JSONRPC;

/** Narrows JSON to an object, excluding arrays, before a field read. */
const isObject = (
  value: Schema.Json
): value is { readonly [key: string]: Schema.Json } =>
  Predicate.isObject(value) && !Array.isArray(value);

/** Decodes a JSON-RPC error object; `Option.none()` when it is malformed. */
const decodeErrorObject = Schema.decodeUnknownOption(JsonRpcErrorObject);

/**
 * The client error of a JSON-RPC error object: the A2A error that its code
 * names, else a transport error that keeps the code and data.
 *
 * @since 0.1.0
 */
export const fromJsonRpcErrorResponse = (
  error: unknown,
  protocol: string = PROTOCOL
): ClientError =>
  Option.match(decodeErrorObject(error), {
    onNone: () => transportError(protocol, 'Invalid JSON-RPC error object.'),
    onSome: (object) =>
      Option.match(fromJsonRpcError(object), {
        onNone: (): ClientError =>
          transportError(protocol, object.message, {
            code: object.code,
            ...(object.data === undefined ? {} : { data: object.data }),
          }),
        onSome: (a2a: A2AError): ClientError => a2a,
      }),
  });

/**
 * Rejects a response envelope that is not an object with `jsonrpc` exactly
 * `2.0`. `context` names the method in the error message.
 */
const requireVersion = (
  value: Schema.Json,
  context: string
): Effect.Effect<{ readonly [key: string]: Schema.Json }, A2ATransportError> =>
  isObject(value) && value['jsonrpc'] === '2.0'
    ? Effect.succeed(value)
    : Effect.fail(
        transportError(
          PROTOCOL,
          `Invalid JSON-RPC response for ${context}: expected 'jsonrpc' to be exactly '2.0', got ${
            isObject(value) && 'jsonrpc' in value
              ? stringifyJson(value['jsonrpc'] ?? '')
              : 'undefined'
          }.`
        )
      );

/**
 * The options of a JSON-RPC transport.
 *
 * @since 0.1.0
 */
export interface JsonRpcTransportOptions {
  /** The URL of the JSON-RPC endpoint. */
  readonly endpoint: string;
  /**
   * The client that sends the requests. Wrap it with `withAuthentication`
   * to add credentials.
   */
  readonly httpClient: HttpClient.HttpClient;
  /** The protocol version to announce. The default is `1.0`. */
  readonly protocolVersion?: string;
}

/**
 * Sends JSON-RPC requests over an HTTP client. The methods and envelopes are
 * the v1.0 ones; the v0.3 compatibility layer has its own transport.
 *
 * @since 0.1.0
 */
export const makeJsonRpcTransport = (
  options: JsonRpcTransportOptions
): Transport => {
  const { endpoint, httpClient } = options;
  let requestIdCounter = 1;
  const nextId = Effect.sync(() => requestIdCounter++);

  const post = (
    method: string,
    params: Schema.Json,
    id: number,
    accept: string,
    callOptions: CallOptions | undefined
  ) =>
    withJsonBody(
      withHeaders(HttpClientRequest.post(endpoint), callOptions, {
        'Content-Type': JSON_CONTENT_TYPE,
        Accept: accept,
      }),
      { jsonrpc: '2.0', method, params, id },
      JSON_CONTENT_TYPE
    );

  const call = (
    method: string,
    params: Schema.Json,
    callOptions: CallOptions | undefined
  ): Effect.Effect<Schema.Json, ClientError> =>
    Effect.gen(function* () {
      const id = yield* nextId;
      const response = yield* executeText(
        httpClient,
        post(method, params, id, JSON_CONTENT_TYPE, callOptions),
        PROTOCOL
      );
      if (!isOk(response.status)) {
        const body = yield* parseBody(
          response.text,
          PROTOCOL,
          'error body'
        ).pipe(
          Effect.mapError(() =>
            transportError(
              PROTOCOL,
              `HTTP error for ${method}! Status: ${response.status}. Response: ${response.text || '(empty or non-JSON response)'}`,
              { code: response.status }
            )
          )
        );
        if (isObject(body) && 'jsonrpc' in body && 'error' in body) {
          return yield* fromJsonRpcErrorResponse(body['error']);
        }
        return yield* transportError(
          PROTOCOL,
          `HTTP error for ${method}! Status: ${response.status}. Response: ${response.text}`,
          { code: response.status }
        );
      }
      const envelope = yield* requireVersion(
        yield* parseBody(response.text, PROTOCOL, 'JSON-RPC response'),
        method
      );
      if ('error' in envelope) {
        return yield* fromJsonRpcErrorResponse(envelope['error']);
      }
      if (envelope['id'] !== id) {
        return yield* transportError(
          PROTOCOL,
          `JSON-RPC response ID mismatch for method ${method}. Expected ${id}, got ${stringifyJson(envelope['id'] ?? '')}.`
        );
      }
      return Option.getOrElse(
        Option.fromUndefinedOr(envelope['result']),
        (): Schema.Json => ({})
      );
    });

  const callWith =
    <P, PE extends Schema.Json, R, RE>(
      method: string,
      requestSchema: Schema.Codec<P, PE>,
      responseSchema: Schema.Codec<R, RE>
    ) =>
    (params: P, callOptions?: CallOptions): Effect.Effect<R, ClientError> =>
      encodeRequest(
        requestSchema,
        PROTOCOL
      )(params).pipe(
        Effect.flatMap((encoded) => call(method, encoded, callOptions)),
        Effect.flatMap(decodeResponse(responseSchema, PROTOCOL))
      );

  const stream =
    <P, PE extends Schema.Json>(
      method: string,
      requestSchema: Schema.Codec<P, PE>
    ) =>
    (
      params: P,
      callOptions?: CallOptions
    ): Stream.Stream<StreamResponse, ClientError> =>
      Stream.unwrap(
        Effect.gen(function* () {
          const encoded = yield* encodeRequest(requestSchema, PROTOCOL)(params);
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
            const body = parseBody(text, PROTOCOL, 'error body').pipe(
              Effect.option
            );
            const parsed = yield* body;
            if (
              Option.isSome(parsed) &&
              isObject(parsed.value) &&
              'error' in parsed.value
            ) {
              return yield* fromJsonRpcErrorResponse(parsed.value['error']);
            }
            return yield* transportError(
              PROTOCOL,
              isOk(response.status)
                ? `Invalid response Content-Type for SSE stream for ${method}. Expected 'text/event-stream'.`
                : `HTTP error establishing stream for ${method}: ${response.status}. Response: ${text || '(empty)'}`,
              { code: response.status }
            );
          }
          return sseEvents(response, PROTOCOL).pipe(
            Stream.mapEffect(
              (event): Effect.Effect<StreamResponse, ClientError> =>
                Effect.gen(function* () {
                  if (event.data.trim() === '') {
                    return yield* transportError(
                      PROTOCOL,
                      'Attempted to process empty SSE event data.'
                    );
                  }
                  const envelope = yield* requireVersion(
                    yield* parseBody(event.data, PROTOCOL, 'SSE event data'),
                    'SSE event'
                  );
                  if (envelope['id'] !== id) {
                    return yield* transportError(
                      PROTOCOL,
                      `JSON-RPC response ID mismatch in SSE event. Expected ${id}, got ${stringifyJson(envelope['id'] ?? '')}.`
                    );
                  }
                  if ('error' in envelope) {
                    return yield* fromJsonRpcErrorResponse(envelope['error']);
                  }
                  if (!('result' in envelope)) {
                    return yield* transportError(
                      PROTOCOL,
                      `SSE event JSON-RPC response is missing 'result' field. Data: ${event.data}`
                    );
                  }
                  return yield* decodeResponse(
                    StreamResponse,
                    PROTOCOL
                  )(envelope['result']);
                })
            )
          );
        })
      );

  const sendMessage = (params: SendMessageRequest, callOptions?: CallOptions) =>
    callWith(
      'SendMessage',
      SendMessageRequest,
      SendMessageResponse
    )(params, callOptions).pipe(
      Effect.map((response) =>
        'task' in response ? response.task : response.message
      )
    );

  return {
    protocolName: PROTOCOL,
    protocolVersion: options.protocolVersion ?? A2A_PROTOCOL_VERSION,
    getExtendedAgentCard: callWith(
      'GetExtendedAgentCard',
      GetExtendedAgentCardRequest,
      AgentCard
    ),
    sendMessage,
    sendMessageStream: stream('SendStreamingMessage', SendMessageRequest),
    getTask: callWith('GetTask', GetTaskRequest, Task),
    cancelTask: callWith('CancelTask', CancelTaskRequest, Task),
    listTasks: callWith('ListTasks', ListTasksRequest, ListTasksResponse),
    createTaskPushNotificationConfig: callWith(
      'CreateTaskPushNotificationConfig',
      TaskPushNotificationConfig,
      TaskPushNotificationConfig
    ),
    getTaskPushNotificationConfig: callWith(
      'GetTaskPushNotificationConfig',
      GetTaskPushNotificationConfigRequest,
      TaskPushNotificationConfig
    ),
    listTaskPushNotificationConfig: callWith(
      'ListTaskPushNotificationConfigs',
      ListTaskPushNotificationConfigsRequest,
      ListTaskPushNotificationConfigsResponse
    ),
    deleteTaskPushNotificationConfig: (params, callOptions) =>
      encodeRequest(
        DeleteTaskPushNotificationConfigRequest,
        PROTOCOL
      )(params).pipe(
        Effect.flatMap((encoded) =>
          call('DeleteTaskPushNotificationConfig', encoded, callOptions)
        ),
        Effect.asVoid
      ),
    resubscribeTask: stream('SubscribeToTask', SubscribeToTaskRequest),
  };
};

/**
 * Creates the transport of an interface whose protocol version is a legacy
 * one. The v0.3 compatibility layer supplies it.
 *
 * @since 0.1.0
 */
export type LegacyTransportConstructor = (
  url: string,
  httpClient: HttpClient.HttpClient
) => Transport;

/**
 * The options of a JSON-RPC transport factory.
 *
 * @since 0.1.0
 */
export interface JsonRpcTransportFactoryOptions {
  /**
   * The v0.3 transport, for an interface that declares protocol version
   * 0.3. Use `legacyJsonRpcTransport` of `@jambudipa/a2a/compat/v0_3/client`.
   */
  readonly legacy?: LegacyTransportConstructor;
  /** Tells whether a protocol version is a legacy one. */
  readonly isLegacyVersion?: (version: string) => boolean;
}

/**
 * The JSON-RPC transport factory on the `HttpClient` of the context.
 *
 * @since 0.1.0
 */
export const JsonRpcTransportFactory = {
  make: (
    options: JsonRpcTransportFactoryOptions = {}
  ): Effect.Effect<TransportFactory, never, HttpClient.HttpClient> =>
    Effect.map(HttpClient.HttpClient, (httpClient) => ({
      protocolName: PROTOCOL,
      create: (url, agentCard) =>
        Effect.sync(() => {
          const legacy = options.legacy;
          const matched = pickMatchingInterface(agentCard, PROTOCOL, url);
          return legacy !== undefined &&
            Option.isSome(matched) &&
            (
              options.isLegacyVersion ?? ((version) => version.startsWith('0.'))
            )(matched.value.protocolVersion)
            ? legacy(url, httpClient)
            : makeJsonRpcTransport({ endpoint: url, httpClient });
        }),
    })),
};
