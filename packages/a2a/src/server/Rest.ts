/**
 * The HTTP+JSON binding (specification §11): one route for each operation,
 * each also under a `/{tenant}` prefix, with the paths and status codes of
 * `@a2a-js/sdk` 1.3.0.
 *
 * @since 0.1.0
 */
import {
  DateTime,
  Effect,
  Layer,
  Option,
  Predicate,
  Result,
  Schema,
  Stream,
} from 'effect';
import type { Scope } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import {
  A2A_CONTENT_TYPE,
  HTTP_EXTENSION_HEADER,
  TransportProtocol,
} from '../Constants.js';
import {
  HTTP_STATUS,
  RequestMalformedError,
  type ServerError,
  restStatusFor,
  toRestErrorBody,
} from '../errors/index.js';
import { formatSSEErrorEvent, formatSSEEvent } from '../Sse.js';
import {
  AgentCard,
  ListTaskPushNotificationConfigsResponse,
  ListTasksResponse,
  SendMessageRequest,
  SendMessageResponse,
  StreamResponse,
  Task,
  TaskPushNotificationConfig,
  TaskStateNames,
  type ListTasksRequest,
  type TaskState,
} from '../Types.js';
import {
  type HttpBindingOptions,
  buildContext,
  catchDefects,
  catchStreamDefects,
  decodeParams,
  encodeJson,
  extensionHeaders,
  isJsonObject,
  jsonResponse,
  peelFirst,
  readJsonBody,
  requireJsonContentType,
  sseResponse,
} from './internal/http.js';
import { isMessage } from './internal/utils.js';
import type { LegacyCompat } from './LegacyCompat.js';
import { A2ARequestHandler } from './RequestHandler.js';
import type { ServerCallContext } from './ServerCallContext.js';

/**
 * The options of the HTTP+JSON routes.
 *
 * @since 0.1.0
 */
export interface RestRoutesOptions extends HttpBindingOptions {
  /** The path prefix of every route, such as `/a2a/rest`. The default is none. */
  readonly prefix?: string;
  /**
   * Serves the v0.3 routes (`/v1/...`) too. Use `legacyCompat` of
   * `@jambudipa/a2a/compat/v0_3/server`.
   */
  readonly legacyCompat?: LegacyCompat;
}

/**
 * The input of one REST operation.
 *
 * @since 0.1.0
 */
export interface RestInput {
  readonly request: HttpServerRequest.HttpServerRequest;
  readonly params: { readonly [name: string]: string | undefined };
  readonly query: { readonly [name: string]: string };
  /** The tenant of the path, when the route has one. */
  readonly tenant: Option.Option<string>;
  readonly context: ServerCallContext;
}

/**
 * A response of the HTTP+JSON binding: a JSON body with its status, no
 * content, or an SSE stream of JSON events.
 *
 * @since 0.1.0
 */
export type RestReply =
  | {
      readonly kind: 'json';
      readonly status: number;
      readonly body: Schema.Json;
    }
  | { readonly kind: 'empty'; readonly status: number }
  | {
      readonly kind: 'stream';
      readonly events: Stream.Stream<Schema.Json, ServerError>;
    };

const reply = (
  body: Schema.Json,
  status: number,
  headers: Record<string, string> = {}
) => jsonResponse(body, { status, contentType: A2A_CONTENT_TYPE, headers });

/**
 * The error response of a failure.
 *
 * @since 0.1.0
 */
export const errorResponse = (
  error: ServerError,
  headers: Record<string, string> = {}
): HttpServerResponse.HttpServerResponse => {
  const status = restStatusFor(error);
  return reply(toRestErrorBody(error, status), status, headers);
};

const firstValue = (
  value: string | ReadonlyArray<string> | undefined
): string | undefined =>
  Predicate.isString(value) ? value : value === undefined ? value : value[0];

const queryOf = (
  search: HttpServerRequest.ParsedSearchParams['Service']
): { readonly [name: string]: string } =>
  Object.fromEntries(
    Object.entries(search).flatMap(([name, value]) => {
      const first = firstValue(value);
      return first === undefined ? [] : [[name, first]];
    })
  );

/**
 * Reads a JSON object body. An empty body is `{}`; a body with a content
 * type other than JSON, or that is not JSON, fails.
 *
 * @since 0.1.0
 */
export const readObjectBody = (
  request: HttpServerRequest.HttpServerRequest
): Effect.Effect<{ readonly [key: string]: Schema.Json }, ServerError> =>
  Effect.gen(function* () {
    yield* requireJsonContentType(request);
    const body = yield* readJsonBody(request);
    if (Option.isNone(body)) return {};
    if (!isJsonObject(body.value)) {
      return yield* new RequestMalformedError({
        message: 'The request body must be a JSON object.',
      });
    }
    return body.value;
  });

/**
 * Puts the path tenant into a request body, as the reference SDK does; a
 * different body tenant is logged and replaced.
 *
 * @since 0.1.0
 */
export const withPathTenant = (
  body: { readonly [key: string]: Schema.Json },
  tenant: Option.Option<string>
): Effect.Effect<{ readonly [key: string]: Schema.Json }> =>
  Option.match(tenant, {
    onNone: () => Effect.succeed(body),
    onSome: (pathTenant) => {
      const bodyTenant = body['tenant'];
      const warn =
        Predicate.isString(bodyTenant) &&
        bodyTenant !== '' &&
        bodyTenant !== pathTenant
          ? Effect.logWarning(
              `Tenant mismatch: URL path tenant "${pathTenant}" differs from request body tenant "${bodyTenant}". Using path tenant as the canonical value.`
            )
          : Effect.void;
      return Effect.as(warn, { ...body, tenant: pathTenant });
    },
  });

/**
 * Parses the `historyLength` query parameter.
 *
 * @since 0.1.0
 */
export const parseHistoryLength = (
  value: string
): Effect.Effect<number, RequestMalformedError> => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return Effect.fail(
      new RequestMalformedError({
        message: 'historyLength must be a valid integer',
      })
    );
  }
  return parsed < 0
    ? Effect.fail(
        new RequestMalformedError({
          message: 'historyLength must be non-negative',
        })
      )
    : Effect.succeed(parsed);
};

/**
 * Parses the `pageSize` query parameter.
 *
 * @since 0.1.0
 */
export const parsePageSize = (
  value: string
): Effect.Effect<number, RequestMalformedError> => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || String(parsed) !== value.trim()) {
    return Effect.fail(
      new RequestMalformedError({ message: 'pageSize must be a valid integer' })
    );
  }
  return parsed < 1 || parsed > 100
    ? Effect.fail(
        new RequestMalformedError({
          message: 'pageSize must be between 1 and 100',
        })
      )
    : Effect.succeed(parsed);
};

const parseStatus = (
  value: string
): Effect.Effect<TaskState, RequestMalformedError> => {
  const state = TaskStateNames.find(
    (name, index) => name === value || String(index) === value
  );
  return state === undefined
    ? Effect.fail(
        new RequestMalformedError({
          message: `Invalid status filter: ${value}`,
        })
      )
    : Effect.succeed(state);
};

const parseTimestamp = (
  value: string
): Effect.Effect<string, RequestMalformedError> =>
  Option.match(DateTime.make(value), {
    onNone: () =>
      Effect.fail(
        new RequestMalformedError({
          message: 'statusTimestampAfter must be a valid ISO 8601 date string',
        })
      ),
    onSome: (dateTime) => Effect.succeed(DateTime.formatIso(dateTime)),
  });

/**
 * Builds a `ListTasks` request from query parameters.
 *
 * @since 0.1.0
 */
export const listTasksRequestFromQuery = (
  query: { readonly [name: string]: string },
  tenant: Option.Option<string>
): Effect.Effect<ListTasksRequest, RequestMalformedError> =>
  Effect.gen(function* () {
    const present = (name: string) =>
      query[name] === undefined || query[name] === ''
        ? Option.none<string>()
        : Option.some(query[name]);
    const tenantValue = Option.orElse(tenant, () => present('tenant'));
    const contextId = present('contextId');
    const status = present('status');
    const pageSize = present('pageSize');
    const pageToken = present('pageToken');
    const historyLength = present('historyLength');
    const after = present('statusTimestampAfter');
    return {
      ...(Option.isSome(tenantValue) ? { tenant: tenantValue.value } : {}),
      ...(Option.isSome(contextId) ? { contextId: contextId.value } : {}),
      ...(Option.isSome(status)
        ? { status: yield* parseStatus(status.value) }
        : {}),
      ...(Option.isSome(pageSize)
        ? { pageSize: yield* parsePageSize(pageSize.value) }
        : {}),
      ...(Option.isSome(pageToken) ? { pageToken: pageToken.value } : {}),
      ...(Option.isSome(historyLength)
        ? { historyLength: yield* parseHistoryLength(historyLength.value) }
        : {}),
      ...(Option.isSome(after)
        ? { statusTimestampAfter: yield* parseTimestamp(after.value) }
        : {}),
      includeArtifacts: query['includeArtifacts'] === 'true',
    };
  });

/**
 * Sends a reply, with the activated extensions, and turns a failure into an
 * error response. A stream waits for its first event, so a failure before it
 * is an ordinary error response and a later one is an `event: error` SSE
 * event.
 *
 * @since 0.1.0
 */
export const sendReply = (
  result: Effect.Effect<RestReply, ServerError>,
  context: ServerCallContext,
  extensionHeader: string = HTTP_EXTENSION_HEADER
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, Scope.Scope> =>
  Effect.gen(function* () {
    const outcome = yield* Effect.result(catchDefects(result));
    if (Result.isFailure(outcome)) {
      return errorResponse(
        outcome.failure,
        yield* extensionHeaders(context, extensionHeader)
      );
    }
    const value = outcome.success;
    if (value.kind === 'json') {
      return reply(
        value.body,
        value.status,
        yield* extensionHeaders(context, extensionHeader)
      );
    }
    if (value.kind === 'empty') {
      return HttpServerResponse.empty({
        status: value.status,
        headers: yield* extensionHeaders(context, extensionHeader),
      });
    }
    const peeled = yield* Effect.result(
      peelFirst(catchStreamDefects(value.events))
    );
    if (Result.isFailure(peeled)) {
      return errorResponse(
        peeled.failure,
        yield* extensionHeaders(context, extensionHeader)
      );
    }
    const [first, rest] = peeled.success;
    const all = Option.match(first, {
      onNone: () => rest,
      onSome: (event) => Stream.concat(Stream.succeed(event), rest),
    });
    return sseResponse(
      all.pipe(
        Stream.map(formatSSEEvent),
        Stream.catch((error) =>
          Stream.succeed(
            formatSSEErrorEvent(toRestErrorBody(error, restStatusFor(error)))
          )
        )
      ),
      yield* extensionHeaders(context, extensionHeader)
    );
  });

/**
 * Builds the routes of one operation, without and with the `/:tenant`
 * prefix.
 *
 * @since 0.1.0
 */
export const restRoute = (
  handler: A2ARequestHandler['Service'],
  options: HttpBindingOptions & {
    readonly prefix: string;
    readonly protocolBinding: string;
    readonly extensionHeader: string;
  },
  method: 'GET' | 'POST' | 'DELETE',
  path: `/${string}`,
  run: (input: RestInput) => Effect.Effect<RestReply, ServerError>
): ReadonlyArray<HttpRouter.Route<never, never>> => {
  const handle = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const query = queryOf(yield* HttpServerRequest.ParsedSearchParams);
    const tenant = Option.fromUndefinedOr(params['tenant']).pipe(
      Option.filter((value) => value !== '')
    );
    const context = yield* Effect.result(
      catchDefects(
        buildContext(request, handler, {
          ...options,
          ...(Option.isSome(tenant) ? { tenant: tenant.value } : {}),
        })
      )
    );
    if (Result.isFailure(context)) return errorResponse(context.failure);
    return yield* sendReply(
      run({ request, params, query, tenant, context: context.success }),
      context.success,
      options.extensionHeader
    );
  });
  return [
    HttpRouter.route(
      method,
      `${options.prefix}${path}` as HttpRouter.PathInput,
      handle
    ),
    HttpRouter.route(
      method,
      `${options.prefix}/:tenant${path}` as HttpRouter.PathInput,
      handle
    ),
  ];
};

const json = (status: number) =>
  Effect.map((body: Schema.Json): RestReply => ({
    kind: 'json',
    status,
    body,
  }));

const TASK = '/tasks/:taskId(^[^/:]+)';

/**
 * The v1.0 routes over a request handler.
 *
 * @since 0.1.0
 */
export const makeRestRoutes = (
  handler: A2ARequestHandler['Service'],
  options: RestRoutesOptions = {}
): ReadonlyArray<HttpRouter.Route<never, never>> => {
  const routeOptions = {
    ...options,
    prefix: options.prefix ?? '',
    protocolBinding: TransportProtocol.HTTP_JSON,
    extensionHeader: HTTP_EXTENSION_HEADER,
  };
  const route = (
    method: 'GET' | 'POST' | 'DELETE',
    path: `/${string}`,
    run: (input: RestInput) => Effect.Effect<RestReply, ServerError>
  ) => restRoute(handler, routeOptions, method, path, run);
  const tenantOf = (input: RestInput) =>
    Option.match(input.tenant, {
      onNone: () => {
        const query = input.query['tenant'];
        return query === undefined || query === '' ? {} : { tenant: query };
      },
      onSome: (tenant) => ({ tenant }),
    });
  const taskId = (input: RestInput) => input.params['taskId'] ?? '';
  const sendRequest = (input: RestInput) =>
    readObjectBody(input.request).pipe(
      Effect.flatMap((body) => withPathTenant(body, input.tenant)),
      Effect.flatMap(decodeParams(SendMessageRequest)),
      Effect.flatMap((request) =>
        request.message.messageId === ''
          ? Effect.fail(
              new RequestMalformedError({
                message: 'message.messageId is required',
              })
            )
          : Effect.succeed(request)
      )
    );
  const subscribe = (input: RestInput) =>
    Effect.succeed<RestReply>({
      kind: 'stream',
      events: Stream.mapEffect(
        handler.resubscribe(
          { ...tenantOf(input), id: taskId(input) },
          input.context
        ),
        encodeJson(StreamResponse)
      ),
    });

  return [
    ...route('GET', '/extendedAgentCard', (input) =>
      handler
        .getAuthenticatedExtendedAgentCard(tenantOf(input), input.context)
        .pipe(Effect.flatMap(encodeJson(AgentCard)), json(HTTP_STATUS.OK))
    ),
    ...route('POST', '/message::send', (input) =>
      sendRequest(input).pipe(
        Effect.flatMap((request) =>
          handler.sendMessage(request, input.context)
        ),
        Effect.flatMap((result) =>
          encodeJson(SendMessageResponse)(
            isMessage(result) ? { message: result } : { task: result }
          )
        ),
        json(HTTP_STATUS.OK)
      )
    ),
    ...route('POST', '/message::stream', (input) =>
      Effect.map(sendRequest(input), (request): RestReply => ({
        kind: 'stream',
        events: Stream.mapEffect(
          handler.sendMessageStream(request, input.context),
          encodeJson(StreamResponse)
        ),
      }))
    ),
    ...route('GET', `${TASK}::subscribe`, subscribe),
    ...route('POST', `${TASK}::subscribe`, subscribe),
    ...route('POST', `${TASK}::cancel`, (input) =>
      handler
        .cancelTask(
          { ...tenantOf(input), id: taskId(input), metadata: {} },
          input.context
        )
        .pipe(Effect.flatMap(encodeJson(Task)), json(HTTP_STATUS.OK))
    ),
    ...route('GET', TASK, (input) =>
      Effect.gen(function* () {
        const historyLength = input.query['historyLength'];
        const task = yield* handler.getTask(
          {
            ...tenantOf(input),
            id: taskId(input),
            ...(historyLength === undefined
              ? {}
              : { historyLength: yield* parseHistoryLength(historyLength) }),
          },
          input.context
        );
        return yield* json(HTTP_STATUS.OK)(encodeJson(Task)(task));
      })
    ),
    ...route('GET', '/tasks', (input) =>
      listTasksRequestFromQuery(input.query, input.tenant).pipe(
        Effect.flatMap((request) => handler.listTasks(request, input.context)),
        Effect.flatMap(encodeJson(ListTasksResponse)),
        json(HTTP_STATUS.OK)
      )
    ),
    ...route('POST', `${TASK}/pushNotificationConfigs`, (input) =>
      readObjectBody(input.request).pipe(
        Effect.flatMap((body) => withPathTenant(body, input.tenant)),
        Effect.map((body) => ({ ...body, taskId: taskId(input) })),
        Effect.flatMap(decodeParams(TaskPushNotificationConfig)),
        Effect.flatMap((config) =>
          handler.createTaskPushNotificationConfig(config, input.context)
        ),
        Effect.flatMap(encodeJson(TaskPushNotificationConfig)),
        json(HTTP_STATUS.CREATED)
      )
    ),
    ...route('GET', `${TASK}/pushNotificationConfigs`, (input) =>
      handler
        .listTaskPushNotificationConfigs(
          {
            ...tenantOf(input),
            taskId: taskId(input),
            pageSize: 0,
            pageToken: '',
          },
          input.context
        )
        .pipe(
          Effect.flatMap(encodeJson(ListTaskPushNotificationConfigsResponse)),
          json(HTTP_STATUS.OK)
        )
    ),
    ...route('GET', `${TASK}/pushNotificationConfigs/:configId`, (input) =>
      handler
        .getTaskPushNotificationConfig(
          {
            ...tenantOf(input),
            taskId: taskId(input),
            id: input.params['configId'] ?? '',
          },
          input.context
        )
        .pipe(
          Effect.flatMap(encodeJson(TaskPushNotificationConfig)),
          json(HTTP_STATUS.OK)
        )
    ),
    ...route('DELETE', `${TASK}/pushNotificationConfigs/:configId`, (input) =>
      handler
        .deleteTaskPushNotificationConfig(
          {
            ...tenantOf(input),
            taskId: taskId(input),
            id: input.params['configId'] ?? '',
          },
          input.context
        )
        .pipe(
          Effect.as<RestReply>({
            kind: 'empty',
            status: HTTP_STATUS.NO_CONTENT,
          })
        )
    ),
  ];
};

/**
 * The HTTP+JSON routes on the `HttpRouter`. They require the
 * `A2ARequestHandler`. Every response has the content type
 * `application/a2a+json`; a create answers 201 and a delete 204.
 *
 * @since 0.1.0
 */
export const RestRoutes = {
  layer: (
    options: RestRoutesOptions = {}
  ): Layer.Layer<never, never, HttpRouter.HttpRouter | A2ARequestHandler> =>
    HttpRouter.use((router) =>
      Effect.gen(function* () {
        const handler = yield* A2ARequestHandler;
        const legacy =
          options.legacyCompat === undefined
            ? []
            : options.legacyCompat.restRoutes(handler, {
                ...options,
                prefix: options.prefix ?? '',
              });
        yield* router.addAll([...legacy, ...makeRestRoutes(handler, options)]);
      })
    ),
};
