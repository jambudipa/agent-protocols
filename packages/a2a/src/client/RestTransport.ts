/**
 * The HTTP+JSON client transport, on the Effect `HttpClient`.
 *
 * @since 0.1.0
 */
import { Effect, Option, Schema, Stream } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import {
  A2A_CONTENT_TYPE,
  A2A_PROTOCOL_VERSION,
  JSON_CONTENT_TYPE,
  TransportProtocol,
} from '../Constants.js';
import {
  type A2AError,
  type ClientError,
  RestErrorBody,
  fromRestErrorBody,
} from '../errors/index.js';
import { parseJsonOption } from '../internal/json.js';
import {
  AgentCard,
  ListTaskPushNotificationConfigsResponse,
  ListTasksResponse,
  SendMessageRequest,
  SendMessageResponse,
  StreamResponse,
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
import type { LegacyTransportConstructor } from './JsonRpcTransport.js';
import {
  type CallOptions,
  type Transport,
  type TransportFactory,
  pickMatchingInterface,
} from './Transport.js';

/** The protocol name in the transport errors of this file. */
const PROTOCOL = TransportProtocol.HTTP_JSON;

/** Decodes an HTTP+JSON error body; `Option.none()` when it is malformed. */
const decodeErrorBody = Schema.decodeUnknownOption(RestErrorBody);

/**
 * The client error of an HTTP+JSON error response: the A2A error that its
 * `ErrorInfo` names, else a transport error with the HTTP status.
 *
 * @since 0.1.0
 */
export const fromRestErrorResponse = (
  status: number,
  text: string,
  path: string,
  protocol: string = PROTOCOL
): ClientError =>
  Option.match(Option.flatMap(parseJsonOption(text), decodeErrorBody), {
    onNone: (): ClientError =>
      transportError(protocol, `HTTP error for ${path}: ${status}`, {
        code: status,
      }),
    onSome: ({ error }) =>
      Option.match(fromRestErrorBody(error), {
        onNone: (): ClientError =>
          transportError(protocol, error.message || 'Unknown error', {
            code: status,
          }),
        onSome: (a2a: A2AError): ClientError => a2a,
      }),
  });

/**
 * The options of an HTTP+JSON transport.
 *
 * @since 0.1.0
 */
export interface RestTransportOptions {
  /** The base URL of the routes. A trailing slash is ignored. */
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
 * Prefixes a route with the URL-encoded tenant. An absent or empty tenant
 * leaves the route unchanged.
 */
const tenantPath = (path: string, tenant: string | undefined) =>
  tenant === undefined || tenant === ''
    ? path
    : `/${encodeURIComponent(tenant)}${path}`;

/**
 * Sends HTTP+JSON requests over an HTTP client, with the paths of the
 * reference SDK.
 *
 * @since 0.1.0
 */
export const makeRestTransport = (options: RestTransportOptions): Transport => {
  const endpoint = options.endpoint.replace(/\/+$/, '');
  const { httpClient } = options;
  const accept = `${A2A_CONTENT_TYPE}, ${JSON_CONTENT_TYPE}`;

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
        { 'Content-Type': JSON_CONTENT_TYPE, Accept: accept }
      );
      const response = yield* executeText(
        httpClient,
        Option.match(body, {
          onNone: () => base,
          onSome: (json) => withJsonBody(base, json, JSON_CONTENT_TYPE),
        }),
        PROTOCOL
      );
      if (!isOk(response.status)) {
        return yield* fromRestErrorResponse(
          response.status,
          response.text,
          path
        );
      }
      if (response.status === 204 || response.text.trim() === '') return {};
      return yield* parseBody(response.text, PROTOCOL, 'response body');
    });

  const stream = (
    path: string,
    body: Option.Option<Schema.Json>,
    callOptions: CallOptions | undefined
  ): Stream.Stream<StreamResponse, ClientError> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const base = withHeaders(
          HttpClientRequest.post(`${endpoint}${path}`),
          callOptions,
          { 'Content-Type': JSON_CONTENT_TYPE, Accept: 'text/event-stream' }
        );
        const response = yield* executeStream(
          httpClient,
          Option.match(body, {
            onNone: () => base,
            onSome: (json) => withJsonBody(base, json, JSON_CONTENT_TYPE),
          }),
          PROTOCOL
        );
        if (!isOk(response.status)) {
          const text = yield* response.text.pipe(
            Effect.orElseSucceed(() => '')
          );
          return yield* fromRestErrorResponse(response.status, text, path);
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
            (event): Effect.Effect<StreamResponse, ClientError> =>
              Effect.gen(function* () {
                if (event.data.trim() === '') {
                  return yield* transportError(
                    PROTOCOL,
                    'Attempted to process empty SSE event data.'
                  );
                }
                const data = yield* parseBody(
                  event.data,
                  PROTOCOL,
                  'SSE event data'
                );
                if (event.type === 'error') {
                  return yield* Option.isSome(decodeErrorBody(data))
                    ? fromRestErrorResponse(response.status, event.data, path)
                    : transportError(
                        PROTOCOL,
                        `SSE error event: ${event.data}`
                      );
                }
                return yield* decodeResponse(StreamResponse, PROTOCOL)(data);
              })
          )
        );
      })
    );

  const json =
    <T, E>(schema: Schema.Codec<T, E>) =>
    (value: unknown) =>
      decodeResponse(schema, PROTOCOL)(value);

  return {
    protocolName: PROTOCOL,
    protocolVersion: options.protocolVersion ?? A2A_PROTOCOL_VERSION,
    getExtendedAgentCard: (params, callOptions) =>
      request(
        'GET',
        tenantPath('/extendedAgentCard', params.tenant),
        Option.none(),
        callOptions
      ).pipe(Effect.flatMap(json(AgentCard))),
    sendMessage: (params, callOptions) =>
      encodeRequest(
        SendMessageRequest,
        PROTOCOL
      )(params).pipe(
        Effect.flatMap((body) =>
          request(
            'POST',
            tenantPath('/message:send', params.tenant),
            Option.some(body),
            callOptions
          )
        ),
        Effect.flatMap(json(SendMessageResponse)),
        Effect.map((response) =>
          'task' in response ? response.task : response.message
        )
      ),
    sendMessageStream: (params, callOptions) =>
      Stream.unwrap(
        Effect.map(
          encodeRequest(SendMessageRequest, PROTOCOL)(params),
          (body) =>
            stream(
              tenantPath('/message:stream', params.tenant),
              Option.some(body),
              callOptions
            )
        )
      ),
    getTask: (params, callOptions) => {
      const query =
        params.historyLength === undefined
          ? ''
          : `?${new URLSearchParams({ historyLength: String(params.historyLength) }).toString()}`;
      return request(
        'GET',
        tenantPath(
          `/tasks/${encodeURIComponent(params.id)}${query}`,
          params.tenant
        ),
        Option.none(),
        callOptions
      ).pipe(Effect.flatMap(json(Task)));
    },
    cancelTask: (params, callOptions) =>
      request(
        'POST',
        tenantPath(
          `/tasks/${encodeURIComponent(params.id)}:cancel`,
          params.tenant
        ),
        Option.none(),
        callOptions
      ).pipe(Effect.flatMap(json(Task))),
    listTasks: (params, callOptions) => {
      const query = new URLSearchParams();
      if (params.contextId !== undefined && params.contextId !== '') {
        query.set('contextId', params.contextId);
      }
      if (
        params.status !== undefined &&
        params.status !== 'TASK_STATE_UNSPECIFIED'
      ) {
        query.set('status', params.status);
      }
      if (params.pageSize !== undefined) {
        query.set('pageSize', String(params.pageSize));
      }
      if (params.pageToken !== undefined && params.pageToken !== '') {
        query.set('pageToken', params.pageToken);
      }
      if (params.historyLength !== undefined) {
        query.set('historyLength', String(params.historyLength));
      }
      if (params.statusTimestampAfter !== undefined) {
        query.set('statusTimestampAfter', params.statusTimestampAfter);
      }
      if (params.includeArtifacts !== undefined) {
        query.set('includeArtifacts', String(params.includeArtifacts));
      }
      const search = query.toString();
      return request(
        'GET',
        tenantPath(`/tasks${search === '' ? '' : `?${search}`}`, params.tenant),
        Option.none(),
        callOptions
      ).pipe(Effect.flatMap(json(ListTasksResponse)));
    },
    createTaskPushNotificationConfig: (params, callOptions) =>
      encodeRequest(
        TaskPushNotificationConfig,
        PROTOCOL
      )(params).pipe(
        Effect.flatMap((body) =>
          request(
            'POST',
            tenantPath(
              `/tasks/${encodeURIComponent(params.taskId ?? '')}/pushNotificationConfigs`,
              params.tenant
            ),
            Option.some(body),
            callOptions
          )
        ),
        Effect.flatMap(json(TaskPushNotificationConfig))
      ),
    getTaskPushNotificationConfig: (params, callOptions) =>
      request(
        'GET',
        tenantPath(
          `/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs/${encodeURIComponent(params.id)}`,
          params.tenant
        ),
        Option.none(),
        callOptions
      ).pipe(Effect.flatMap(json(TaskPushNotificationConfig))),
    listTaskPushNotificationConfig: (params, callOptions) =>
      request(
        'GET',
        tenantPath(
          `/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs`,
          params.tenant
        ),
        Option.none(),
        callOptions
      ).pipe(Effect.flatMap(json(ListTaskPushNotificationConfigsResponse))),
    deleteTaskPushNotificationConfig: (params, callOptions) =>
      request(
        'DELETE',
        tenantPath(
          `/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs/${encodeURIComponent(params.id)}`,
          params.tenant
        ),
        Option.none(),
        callOptions
      ).pipe(Effect.asVoid),
    resubscribeTask: (params, callOptions) =>
      stream(
        tenantPath(
          `/tasks/${encodeURIComponent(params.id)}:subscribe`,
          params.tenant
        ),
        Option.none(),
        callOptions
      ),
  };
};

/**
 * The options of an HTTP+JSON transport factory.
 *
 * @since 0.1.0
 */
export interface RestTransportFactoryOptions {
  /**
   * The v0.3 transport, for an interface that declares protocol version
   * 0.3. Use `legacyRestTransport` of `@jambudipa/a2a/compat/v0_3/client`.
   */
  readonly legacy?: LegacyTransportConstructor;
  /** Tells whether a protocol version is a legacy one. */
  readonly isLegacyVersion?: (version: string) => boolean;
}

/**
 * The HTTP+JSON transport factory on the `HttpClient` of the context.
 *
 * @since 0.1.0
 */
export const RestTransportFactory = {
  make: (
    options: RestTransportFactoryOptions = {}
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
            : makeRestTransport({ endpoint: url, httpClient });
        }),
    })),
};
