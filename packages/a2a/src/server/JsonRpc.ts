/**
 * The JSON-RPC 2.0 binding (specification §9): one POST route that
 * dispatches by `method`, answers with JSON-RPC envelopes and streams
 * `SendStreamingMessage` and `SubscribeToTask` as Server-Sent Events.
 *
 * The dispatcher is written by hand on `HttpRouter`: the A2A envelopes, error
 * codes and HTTP statuses follow `@a2a-js/sdk` 1.3.0, which `effect/rpc`
 * cannot produce.
 *
 * @since 0.1.0
 */
import {
  Data,
  Effect,
  Layer,
  Option,
  Predicate,
  Result,
  Schema,
  Stream,
} from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/http';
import {
  A2A_LEGACY_PROTOCOL_VERSION,
  A2A_VERSION_HEADER,
  HTTP_EXTENSION_HEADER,
  JSON_CONTENT_TYPE,
  TransportProtocol,
} from '../Constants.js';
import {
  A2A_ERROR_CODE,
  InternalError,
  JsonRpcErrorObject,
  RequestMalformedError,
  type ServerError,
  toJsonRpcError,
} from '../errors/index.js';
import { formatSSEErrorEvent, formatSSEEvent } from '../Sse.js';
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
  type HttpBindingOptions,
  buildContext,
  catchDefects,
  catchStreamDefects,
  decodeParams,
  encodeJson,
  extensionHeaders,
  headerValue,
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
 * The `id` of a JSON-RPC request: a string, a number, or `null`
 * (`Option.none()`).
 *
 * @since 0.1.0
 */
export const JsonRpcId = Schema.OptionFromNullOr(
  Schema.Union([Schema.String, Schema.Number])
);

/**
 * @since 0.1.0
 */
export type JsonRpcId = typeof JsonRpcId.Type;

/**
 * A JSON-RPC success response.
 *
 * @since 0.1.0
 */
export const JsonRpcSuccessResponse = Schema.Struct({
  jsonrpc: Schema.Literal('2.0'),
  id: JsonRpcId,
  result: Schema.OptionFromNullOr(Schema.Json),
}).annotate({ identifier: 'JsonRpcSuccessResponse' });

/**
 * A JSON-RPC error response.
 *
 * @since 0.1.0
 */
export const JsonRpcErrorResponse = Schema.Struct({
  jsonrpc: Schema.Literal('2.0'),
  id: JsonRpcId,
  error: JsonRpcErrorObject,
}).annotate({ identifier: 'JsonRpcErrorResponse' });

/** Encodes a success envelope; it throws only on a schema bug. */
const encodeSuccess = Schema.encodeSync(JsonRpcSuccessResponse);
/** Encodes an error envelope; it throws only on a schema bug. */
const encodeFailure = Schema.encodeSync(JsonRpcErrorResponse);

/**
 * The JSON of a success response.
 *
 * @since 0.1.0
 */
export const successEnvelope = (
  id: JsonRpcId,
  result: Option.Option<Schema.Json>
): Schema.Json => encodeSuccess({ jsonrpc: '2.0', id, result });

/**
 * The JSON of an error response.
 *
 * @since 0.1.0
 */
export const errorEnvelope = (
  id: JsonRpcId,
  error: JsonRpcErrorObject
): Schema.Json => encodeFailure({ jsonrpc: '2.0', id, error });

/**
 * The outcome of a dispatch: one response, or a stream of results.
 *
 * @since 0.1.0
 */
export type JsonRpcOutcome = Data.TaggedEnum<{
  /** A response envelope, sent with HTTP 200. */
  Response: { readonly body: Schema.Json };
  /**
   * A stream of `result` values. With `eager`, the SSE headers go out at
   * once; otherwise the binding waits for the first result, so a failure
   * before it is an ordinary error response.
   */
  Stream: {
    readonly id: JsonRpcId;
    readonly results: Stream.Stream<Schema.Json, ServerError>;
    readonly eager: boolean;
  };
}>;

/**
 * Constructors of {@link JsonRpcOutcome}.
 *
 * @since 0.1.0
 */
export const JsonRpcOutcome = Data.taggedEnum<JsonRpcOutcome>();

/**
 * Dispatches the JSON-RPC requests of one protocol version.
 *
 * @since 0.1.0
 */
export interface JsonRpcDispatcher {
  /** The header that carries the requested and activated extensions. */
  readonly extensionHeader: string;
  /** Answers a parsed request body. It never fails. */
  readonly dispatch: (
    body: Schema.Json,
    context: ServerCallContext
  ) => Effect.Effect<JsonRpcOutcome>;
  /** The error object of a failure. */
  readonly errorObject: (error: ServerError) => JsonRpcErrorObject;
}

/**
 * A parsed JSON-RPC request envelope.
 *
 * @since 0.1.0
 */
export interface JsonRpcRequestEnvelope {
  /** The request id; none for a notification or a `null` id. */
  readonly id: JsonRpcId;
  /** The method name; never empty. */
  readonly method: string;
  /** The `params` member; none when it is absent or `null`. */
  readonly params: Option.Option<Schema.Json>;
}

/**
 * The `id` of a request body, when it has a valid one.
 *
 * @since 0.1.0
 */
export const requestIdOf = (body: Schema.Json): JsonRpcId => {
  if (!isJsonObject(body)) return Option.none();
  const id = body['id'];
  return Predicate.isString(id) ||
    (Predicate.isNumber(id) && Number.isInteger(id))
    ? Option.some(id)
    : Option.none();
};

/**
 * Validates a JSON-RPC 2.0 request envelope: `jsonrpc` is `"2.0"`, `id` is a
 * string, an integer or `null` when present, and `method` is a non-empty
 * string. An invalid envelope is a `RequestMalformedError`, as in the
 * reference SDK.
 *
 * @since 0.1.0
 */
export const parseEnvelope = (
  body: Schema.Json
): Effect.Effect<JsonRpcRequestEnvelope, RequestMalformedError> => {
  const invalid = Effect.fail(
    new RequestMalformedError({ message: 'Invalid JSON-RPC Request.' })
  );
  if (!isJsonObject(body) || body['jsonrpc'] !== '2.0') return invalid;
  if ('id' in body) {
    const id = body['id'];
    const valid =
      Predicate.isString(id) ||
      Predicate.isNull(id) ||
      (Predicate.isNumber(id) && Number.isInteger(id));
    if (!valid) return invalid;
  }
  const method = body['method'];
  if (!Predicate.isString(method) || method === '') return invalid;
  return Effect.succeed({
    id: requestIdOf(body),
    method,
    params:
      'params' in body ? Option.fromNullishOr(body['params']) : Option.none(),
  });
};

/**
 * Tells whether `params` is a JSON object without an empty key.
 *
 * @since 0.1.0
 */
export const paramsAreValid = (
  params: Option.Option<Schema.Json>
): params is Option.Some<{ readonly [key: string]: Schema.Json }> =>
  Option.isSome(params) &&
  isJsonObject(params.value) &&
  !Object.keys(params.value).includes('');

/**
 * Moves a non-empty `tenant` in `params` onto the call context, so
 * that the stores scope the call by it. Other params leave the context
 * as it is.
 */
const withTenant = (
  context: ServerCallContext,
  params: Option.Option<Schema.Json>
): ServerCallContext => {
  if (Option.isNone(params) || !isJsonObject(params.value)) return context;
  const tenant = params.value['tenant'];
  return Predicate.isString(tenant) && tenant !== ''
    ? { ...context, tenant }
    : context;
};

/** The v1.0 JSON-RPC methods. */
const METHODS: ReadonlyArray<string> = [
  'SendMessage',
  'SendStreamingMessage',
  'SubscribeToTask',
  'GetTask',
  'ListTasks',
  'CancelTask',
  'CreateTaskPushNotificationConfig',
  'GetTaskPushNotificationConfig',
  'ListTaskPushNotificationConfigs',
  'DeleteTaskPushNotificationConfig',
  'GetExtendedAgentCard',
];

/** Encodes a task result to its v1.0 JSON. */
const encodeTask = encodeJson(Task);
/** Encodes one stream event to its v1.0 JSON. */
const encodeStreamResponse = encodeJson(StreamResponse);

/**
 * The v1.0 dispatcher over a request handler.
 *
 * @since 0.1.0
 */
export const makeJsonRpcDispatcher = (
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
      Effect.catch((error) =>
        Effect.succeed(
          JsonRpcOutcome.Response({
            body: errorEnvelope(id, toJsonRpcError(error)),
          })
        )
      )
    );

  const call = <P, E, A>(
    schema: Schema.Codec<P, E>,
    params: unknown,
    run: (decoded: P) => Effect.Effect<A, ServerError>,
    encode: (value: A) => Effect.Effect<Schema.Json, InternalError>
  ): Effect.Effect<Option.Option<Schema.Json>, ServerError> =>
    decodeParams(schema)(params).pipe(
      Effect.flatMap(run),
      Effect.flatMap(encode),
      Effect.map(Option.some)
    );

  const streaming = (
    id: JsonRpcId,
    stream: Effect.Effect<
      Stream.Stream<StreamResponse, ServerError>,
      ServerError
    >
  ): Effect.Effect<JsonRpcOutcome> =>
    stream.pipe(
      Effect.map((results) =>
        JsonRpcOutcome.Stream({
          id,
          results: Stream.mapEffect(results, encodeStreamResponse),
          eager: false,
        })
      ),
      Effect.catch((error) =>
        Effect.succeed(
          JsonRpcOutcome.Response({
            body: errorEnvelope(id, toJsonRpcError(error)),
          })
        )
      )
    );

  const dispatch = (
    body: Schema.Json,
    callContext: ServerCallContext
  ): Effect.Effect<JsonRpcOutcome> =>
    Effect.gen(function* () {
      const envelope = yield* Effect.result(parseEnvelope(body));
      if (Result.isFailure(envelope)) {
        return JsonRpcOutcome.Response({
          body: errorEnvelope(
            requestIdOf(body),
            toJsonRpcError(envelope.failure)
          ),
        });
      }
      const { id, method, params } = envelope.success;
      if (!METHODS.includes(method)) {
        return JsonRpcOutcome.Response({
          body: errorEnvelope(id, {
            code: A2A_ERROR_CODE.METHOD_NOT_FOUND,
            message: 'Invalid method.',
          }),
        });
      }
      if (method !== 'GetExtendedAgentCard' && !paramsAreValid(params)) {
        return JsonRpcOutcome.Response({
          body: errorEnvelope(
            id,
            toJsonRpcError(
              new RequestMalformedError({
                message: 'Invalid method parameters.',
              })
            )
          ),
        });
      }
      const context = withTenant(callContext, params);
      const input = Option.getOrElse(params, (): Schema.Json => ({}));
      switch (method) {
        case 'SendMessage':
          return yield* unary(
            id,
            call(
              SendMessageRequest,
              input,
              (request) => handler.sendMessage(request, context),
              (result) =>
                encodeJson(SendMessageResponse)(
                  isMessage(result) ? { message: result } : { task: result }
                )
            )
          );
        case 'SendStreamingMessage':
          return yield* streaming(
            id,
            Effect.map(decodeParams(SendMessageRequest)(input), (request) =>
              handler.sendMessageStream(request, context)
            )
          );
        case 'SubscribeToTask':
          return yield* streaming(
            id,
            Effect.map(decodeParams(SubscribeToTaskRequest)(input), (request) =>
              handler.resubscribe(request, context)
            )
          );
        case 'GetTask':
          return yield* unary(
            id,
            call(
              GetTaskRequest,
              input,
              (request) => handler.getTask(request, context),
              encodeTask
            )
          );
        case 'ListTasks':
          return yield* unary(
            id,
            call(
              ListTasksRequest,
              input,
              (request) => handler.listTasks(request, context),
              encodeJson(ListTasksResponse)
            )
          );
        case 'CancelTask':
          return yield* unary(
            id,
            call(
              CancelTaskRequest,
              input,
              (request) => handler.cancelTask(request, context),
              encodeTask
            )
          );
        case 'CreateTaskPushNotificationConfig':
          return yield* unary(
            id,
            call(
              TaskPushNotificationConfig,
              input,
              (request) =>
                handler.createTaskPushNotificationConfig(request, context),
              encodeJson(TaskPushNotificationConfig)
            )
          );
        case 'GetTaskPushNotificationConfig':
          return yield* unary(
            id,
            call(
              GetTaskPushNotificationConfigRequest,
              input,
              (request) =>
                handler.getTaskPushNotificationConfig(request, context),
              encodeJson(TaskPushNotificationConfig)
            )
          );
        case 'ListTaskPushNotificationConfigs':
          return yield* unary(
            id,
            call(
              ListTaskPushNotificationConfigsRequest,
              input,
              (request) =>
                handler.listTaskPushNotificationConfigs(request, context),
              encodeJson(ListTaskPushNotificationConfigsResponse)
            )
          );
        case 'DeleteTaskPushNotificationConfig':
          return yield* unary(
            id,
            decodeParams(DeleteTaskPushNotificationConfigRequest)(input).pipe(
              Effect.flatMap((request) =>
                handler.deleteTaskPushNotificationConfig(request, context)
              ),
              Effect.as(Option.none<Schema.Json>())
            )
          );
        case 'GetExtendedAgentCard':
          return yield* unary(
            id,
            call(
              GetExtendedAgentCardRequest,
              input,
              (request) =>
                handler.getAuthenticatedExtendedAgentCard(request, context),
              encodeJson(AgentCard)
            )
          );
        default:
          return JsonRpcOutcome.Response({
            body: errorEnvelope(id, {
              code: A2A_ERROR_CODE.METHOD_NOT_FOUND,
              message: 'Invalid method.',
            }),
          });
      }
    });

  return {
    extensionHeader: HTTP_EXTENSION_HEADER,
    dispatch,
    errorObject: toJsonRpcError,
  };
};

/**
 * The options of the JSON-RPC route.
 *
 * @since 0.1.0
 */
export interface JsonRpcRouteOptions extends HttpBindingOptions {
  /** The path of the POST route. The default is `/`. */
  readonly path?: HttpRouter.PathInput;
  /**
   * Serves protocol 0.3 too: a request whose `A2A-Version` is absent or
   * `0.3` goes to the legacy dispatcher. Use `legacyCompat` of
   * `@jambudipa/a2a/compat/v0_3/server`.
   */
  readonly legacyCompat?: LegacyCompat;
}

/**
 * The HTTP status of a rejected request: 500 for an internal error,
 * else 200, because JSON-RPC carries other errors in the body.
 */
const errorStatus = (error: ServerError) =>
  error._tag === 'InternalError' ? 500 : 200;

/**
 * Renders a stream of results as SSE event text. A failure becomes a final
 * `error` event.
 *
 * @since 0.1.0
 */
export const resultEvents = (
  dispatcher: JsonRpcDispatcher,
  id: JsonRpcId,
  results: Stream.Stream<Schema.Json, ServerError>
): Stream.Stream<string> =>
  catchStreamDefects(results).pipe(
    Stream.map((result) =>
      formatSSEEvent(successEnvelope(id, Option.some(result)))
    ),
    Stream.catch((error) =>
      Stream.succeed(
        formatSSEErrorEvent(errorEnvelope(id, dispatcher.errorObject(error)))
      )
    )
  );

/**
 * Answers one JSON-RPC HTTP request.
 */
const respond = (
  request: HttpServerRequest.HttpServerRequest,
  handler: A2ARequestHandler['Service'],
  dispatchers: {
    readonly current: JsonRpcDispatcher;
    readonly legacy: Option.Option<JsonRpcDispatcher>;
  },
  options: JsonRpcRouteOptions
) =>
  Effect.gen(function* () {
    const reply = (
      body: Schema.Json,
      status: number,
      headers: Record<string, string> = {}
    ) =>
      jsonResponse(body, { status, contentType: JSON_CONTENT_TYPE, headers });

    const contentType = yield* Effect.result(requireJsonContentType(request));
    if (Result.isFailure(contentType)) {
      return reply(
        errorEnvelope(Option.none(), toJsonRpcError(contentType.failure)),
        200
      );
    }
    const parsed = yield* Effect.result(readJsonBody(request));
    if (Result.isFailure(parsed)) {
      return reply(
        errorEnvelope(Option.none(), {
          code: A2A_ERROR_CODE.PARSE_ERROR,
          message: 'Invalid JSON payload.',
        }),
        200
      );
    }
    const body = Option.getOrElse(parsed.success, (): Schema.Json => ({}));
    const version = Option.getOrElse(
      headerValue(request, A2A_VERSION_HEADER),
      () => A2A_LEGACY_PROTOCOL_VERSION
    );
    const dispatcher =
      Option.isSome(dispatchers.legacy) &&
      version === A2A_LEGACY_PROTOCOL_VERSION
        ? dispatchers.legacy.value
        : dispatchers.current;
    const requestId = requestIdOf(body);

    const contextResult = yield* Effect.result(
      catchDefects(
        buildContext(request, handler, {
          ...options,
          protocolBinding: TransportProtocol.JSONRPC,
          extensionHeader: dispatcher.extensionHeader,
        })
      )
    );
    if (Result.isFailure(contextResult)) {
      const error = contextResult.failure;
      yield* Effect.logWarning('JSON-RPC request rejected', error);
      return reply(
        errorEnvelope(requestId, dispatcher.errorObject(error)),
        errorStatus(error)
      );
    }
    const context = contextResult.success;
    const outcome = yield* dispatcher.dispatch(body, context);
    if (outcome._tag === 'Response') {
      return reply(
        outcome.body,
        200,
        yield* extensionHeaders(context, dispatcher.extensionHeader)
      );
    }
    if (outcome.eager) {
      return sseResponse(
        resultEvents(dispatcher, outcome.id, outcome.results),
        yield* extensionHeaders(context, dispatcher.extensionHeader)
      );
    }
    const peeled = yield* Effect.result(
      peelFirst(catchStreamDefects(outcome.results))
    );
    if (Result.isFailure(peeled)) {
      const error = peeled.failure;
      return reply(
        errorEnvelope(outcome.id, dispatcher.errorObject(error)),
        200,
        yield* extensionHeaders(context, dispatcher.extensionHeader)
      );
    }
    const [first, rest] = peeled.success;
    const results = Option.match(first, {
      onNone: () => rest,
      onSome: (value) => Stream.concat(Stream.succeed(value), rest),
    });
    return sseResponse(
      resultEvents(dispatcher, outcome.id, results),
      yield* extensionHeaders(context, dispatcher.extensionHeader)
    );
  });

/**
 * The JSON-RPC route: `POST /` (or `options.path`) on the `HttpRouter`. It
 * requires the `A2ARequestHandler`.
 *
 * Protocol errors answer HTTP 200 with a JSON-RPC error; a failure to build
 * the call context with an internal error answers HTTP 500, as in the
 * reference SDK. A stream waits for its first event before it sends the SSE
 * headers, so an early failure is an ordinary error response; a later one is
 * an `event: error` SSE event.
 *
 * @since 0.1.0
 */
export const JsonRpcRoute = {
  layer: (
    options: JsonRpcRouteOptions = {}
  ): Layer.Layer<never, never, HttpRouter.HttpRouter | A2ARequestHandler> =>
    HttpRouter.use((router) =>
      Effect.gen(function* () {
        const handler = yield* A2ARequestHandler;
        const dispatchers = {
          current: makeJsonRpcDispatcher(handler),
          legacy: Option.map(
            Option.fromUndefinedOr(options.legacyCompat),
            (legacy) => legacy.jsonRpcDispatcher(handler)
          ),
        };
        yield* router.add(
          'POST',
          options.path ?? '/',
          Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
            respond(request, handler, dispatchers, options)
          )
        );
      })
    ),
};
