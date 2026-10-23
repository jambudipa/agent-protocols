/**
 * The v0.3 HTTP+JSON routes (`/v1/...`) over the v1.0 request handler, with
 * the paths, status codes and protobuf JSON bodies of `legacyRestRouter` of
 * `@a2a-js/sdk` 1.3.0.
 *
 * @since 0.1.0
 */
import {
  Effect,
  Option,
  Predicate,
  Result,
  Schema,
  type Scope,
  Stream,
} from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import {
  A2A_LEGACY_PROTOCOL_VERSION,
  A2A_VERSION_HEADER,
  HTTP_EXTENSION_HEADER,
  TransportProtocol,
} from '../../../Constants.js';
import {
  A2A_ERROR_CODE,
  PushNotificationNotSupportedError,
  RequestMalformedError,
  type ServerError,
  UnsupportedOperationError,
} from '../../../errors/index.js';
import { isLegacyVersion } from '../../../internal/version.js';
import { formatSSEErrorEvent, formatSSEEvent } from '../../../Sse.js';
import {
  type HttpBindingOptions,
  buildContext,
  catchDefects,
  catchStreamDefects,
  decodeParams,
  encodeJson,
  extensionHeaders,
  headerValue,
  jsonResponse,
  peelFirst,
  readJsonBody,
  sseResponse,
} from '../../../server/internal/http.js';
import type { A2ARequestHandler } from '../../../server/RequestHandler.js';
import { parseHistoryLength } from '../../../server/Rest.js';
import type { ServerCallContext } from '../../../server/ServerCallContext.js';
import type { StreamResponse } from '../../../Types.js';
import { toCompatAgentCard } from '../AgentCard.js';
import {
  LEGACY_HTTP_EXTENSION_HEADER,
  LEGACY_JSON_CONTENT_TYPE,
} from '../Constants.js';
import { legacyHttpStatusFor, toLegacyErrorBody } from '../Errors.js';
import {
  fromProtoSendMessageRequest,
  fromProtoTaskPushNotificationConfig,
  toProtoAgentCard,
  toProtoSendMessageResponse,
  toProtoStreamResponse,
  toProtoTask,
  toProtoTaskPushNotificationConfig,
} from '../proto.js';
import * as P from '../ProtoTypes.js';
import {
  toCompatSendMessageResult,
  toCompatStreamEvent,
  toCompatTask,
  toCompatTaskPushNotificationConfig,
  toCoreSendMessageRequest,
  toCoreTaskPushNotificationConfig,
} from '../translate.js';

type Body = { readonly [key: string]: Schema.Json };

/**
 * A reply of a v0.3 route.
 *
 * @since 0.1.0
 */
export type LegacyRestReply =
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

interface LegacyRestInput {
  readonly request: HttpServerRequest.HttpServerRequest;
  /** The body, for a route that reads one; else `{}`. */
  readonly body: Body;
  readonly taskId: string;
  readonly configId: string;
  readonly query: { readonly [name: string]: string };
  readonly context: ServerCallContext;
}

const reply = (
  body: Schema.Json,
  status: number,
  headers: Record<string, string> = {}
) =>
  jsonResponse(body, {
    status,
    contentType: LEGACY_JSON_CONTENT_TYPE,
    headers,
  });

const errorResponse = (
  error: ServerError,
  headers: Record<string, string> = {}
) => reply(toLegacyErrorBody(error), legacyHttpStatusFor(error), headers);

const parseErrorResponse = () =>
  reply(
    {
      code: A2A_ERROR_CODE.PARSE_ERROR,
      message: 'Invalid JSON payload.',
    },
    400
  );

const queryOf = (
  search: HttpServerRequest.ParsedSearchParams['Service']
): { readonly [name: string]: string } =>
  Object.fromEntries(
    Object.entries(search).flatMap(([name, value]) => {
      const first = Predicate.isString(value) ? value : value[0];
      return first === undefined ? [] : [[name, first]];
    })
  );

const respond = (
  result: Effect.Effect<LegacyRestReply, ServerError>,
  context: ServerCallContext
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, Scope.Scope> =>
  Effect.gen(function* () {
    const headers = () =>
      extensionHeaders(context, LEGACY_HTTP_EXTENSION_HEADER);
    const outcome = yield* Effect.result(catchDefects(result));
    if (Result.isFailure(outcome)) {
      return errorResponse(outcome.failure, yield* headers());
    }
    const value = outcome.success;
    if (value.kind === 'json') {
      return reply(value.body, value.status, yield* headers());
    }
    if (value.kind === 'empty') {
      return HttpServerResponse.empty({
        status: value.status,
        headers: yield* headers(),
      });
    }
    const peeled = yield* Effect.result(
      peelFirst(catchStreamDefects(value.events))
    );
    if (Result.isFailure(peeled)) {
      return errorResponse(peeled.failure, yield* headers());
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
          Stream.succeed(formatSSEErrorEvent(toLegacyErrorBody(error)))
        )
      ),
      yield* headers()
    );
  });

/**
 * Reads the body as protobuf JSON. An empty, `null` or non-object body is
 * `{}`, as the reference SDK reads it.
 */
const readBody = (
  request: HttpServerRequest.HttpServerRequest
): Effect.Effect<Body, RequestMalformedError> =>
  Effect.map(readJsonBody(request), (body) =>
    Option.match(body, {
      onNone: (): Body => ({}),
      onSome: (value): Body => (isBody(value) ? value : {}),
    })
  );

const isBody = (value: Schema.Json): value is Body =>
  Predicate.isObject(value) && !Array.isArray(value);

const json = (status: number) =>
  Effect.map((body: Schema.Json): LegacyRestReply => ({
    kind: 'json',
    status,
    body,
  }));

const TASK = '/v1/tasks/:taskId(^[^/:]+)';

/**
 * The v0.3 routes over a request handler. A request whose `A2A-Version` is
 * not a legacy version gets 404 from them.
 *
 * @since 0.1.0
 */
export const makeLegacyRestRoutes = (
  handler: A2ARequestHandler['Service'],
  options: HttpBindingOptions & { readonly prefix: string }
): ReadonlyArray<HttpRouter.Route<never, never>> => {
  const requireCapability = (capability: 'streaming' | 'pushNotifications') =>
    Effect.flatMap(handler.getAgentCard, (card) =>
      card.capabilities[capability] === true
        ? Effect.void
        : Effect.fail<ServerError>(
            capability === 'streaming'
              ? new UnsupportedOperationError({
                  message:
                    'Unsupported operation: Agent does not support streaming',
                })
              : new PushNotificationNotSupportedError({})
          )
    );

  const route = (
    method: 'GET' | 'POST' | 'DELETE',
    path: `/${string}`,
    run: (
      input: LegacyRestInput
    ) => Effect.Effect<LegacyRestReply, ServerError>,
    parsesBody = false
  ): HttpRouter.Route<never, never> =>
    HttpRouter.route(
      method,
      `${options.prefix}${path}` as HttpRouter.PathInput,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const version = Option.getOrElse(
          headerValue(request, A2A_VERSION_HEADER),
          () => A2A_LEGACY_PROTOCOL_VERSION
        );
        if (!isLegacyVersion(version)) {
          return HttpServerResponse.empty({ status: 404 });
        }
        const body = parsesBody
          ? yield* Effect.result(readBody(request))
          : Result.succeed<Body>({});
        if (Result.isFailure(body)) return parseErrorResponse();
        const params = yield* HttpRouter.params;
        const query = queryOf(yield* HttpServerRequest.ParsedSearchParams);
        const extensionHeader = Option.isSome(
          headerValue(request, LEGACY_HTTP_EXTENSION_HEADER)
        )
          ? LEGACY_HTTP_EXTENSION_HEADER
          : HTTP_EXTENSION_HEADER;
        const context = yield* Effect.result(
          catchDefects(
            buildContext(request, handler, {
              ...options,
              protocolBinding: TransportProtocol.HTTP_JSON,
              extensionHeader,
            })
          )
        );
        if (Result.isFailure(context)) return errorResponse(context.failure);
        return yield* respond(
          run({
            request,
            body: body.success,
            taskId: params['taskId'] ?? '',
            configId: params['configId'] ?? '',
            query,
            context: context.success,
          }),
          context.success
        );
      })
    );

  const sendParams = (input: LegacyRestInput) =>
    decodeParams(P.ProtoSendMessageRequest)(input.body).pipe(
      Effect.flatMap(fromProtoSendMessageRequest),
      Effect.flatMap((params) =>
        params.message.messageId === ''
          ? Effect.fail(
              new RequestMalformedError({
                message: 'message.messageId is required',
              })
            )
          : toCoreSendMessageRequest(params)
      )
    );

  const streamOf = (
    events: Stream.Stream<StreamResponse, ServerError>
  ): LegacyRestReply => ({
    kind: 'stream',
    events: Stream.mapEffect(events, (event) =>
      encodeJson(P.ProtoStreamResponse)(
        toProtoStreamResponse(toCompatStreamEvent(event))
      )
    ),
  });

  const subscribe = (
    input: LegacyRestInput
  ): Effect.Effect<LegacyRestReply, ServerError> =>
    Effect.map(requireCapability('streaming'), () =>
      streamOf(handler.resubscribe({ id: input.taskId }, input.context))
    );

  return [
    route('GET', '/v1/card', (input) =>
      handler.getAuthenticatedExtendedAgentCard({}, input.context).pipe(
        Effect.flatMap((card) => toCompatAgentCard(card)),
        Effect.flatMap((card) =>
          encodeJson(P.ProtoAgentCard)(toProtoAgentCard(card))
        ),
        json(200)
      )
    ),
    route(
      'POST',
      '/v1/message::send',
      (input) =>
        sendParams(input).pipe(
          Effect.flatMap((request) =>
            handler.sendMessage(request, input.context)
          ),
          Effect.flatMap((result) =>
            encodeJson(P.ProtoSendMessageResponse)(
              toProtoSendMessageResponse(toCompatSendMessageResult(result))
            )
          ),
          json(201)
        ),
      true
    ),
    route(
      'POST',
      '/v1/message::stream',
      (input) =>
        requireCapability('streaming').pipe(
          Effect.andThen(() => sendParams(input)),
          Effect.map((request) =>
            streamOf(handler.sendMessageStream(request, input.context))
          )
        ),
      true
    ),
    route('POST', `${TASK}::cancel`, (input) =>
      handler
        .cancelTask({ id: input.taskId, metadata: {} }, input.context)
        .pipe(
          Effect.flatMap((task) =>
            encodeJson(P.ProtoTask)(toProtoTask(toCompatTask(task)))
          ),
          json(200)
        )
    ),
    route('GET', `${TASK}::subscribe`, subscribe),
    route('POST', `${TASK}::subscribe`, subscribe),
    route('GET', TASK, (input) =>
      Effect.gen(function* () {
        const historyLength =
          input.query['historyLength'] ?? input.query['history_length'];
        const task = yield* handler.getTask(
          historyLength === undefined
            ? { id: input.taskId }
            : {
                id: input.taskId,
                historyLength: yield* parseHistoryLength(historyLength),
              },
          input.context
        );
        return yield* json(200)(
          encodeJson(P.ProtoTask)(toProtoTask(toCompatTask(task)))
        );
      })
    ),
    route(
      'POST',
      `${TASK}/pushNotificationConfigs`,
      (input) =>
        requireCapability('pushNotifications').pipe(
          Effect.andThen(() =>
            decodeParams(P.ProtoTaskPushNotificationConfig)(input.body)
          ),
          Effect.flatMap(fromProtoTaskPushNotificationConfig),
          Effect.flatMap((compat) => toCoreTaskPushNotificationConfig(compat)),
          Effect.flatMap((config) =>
            handler.createTaskPushNotificationConfig(config, input.context)
          ),
          Effect.flatMap((config) =>
            encodeJson(P.ProtoTaskPushNotificationConfig)(
              toProtoTaskPushNotificationConfig(
                toCompatTaskPushNotificationConfig(config)
              )
            )
          ),
          json(201)
        ),
      true
    ),
    route('GET', `${TASK}/pushNotificationConfigs`, (input) =>
      handler
        .listTaskPushNotificationConfigs(
          { taskId: input.taskId, pageSize: 0, pageToken: '' },
          input.context
        )
        .pipe(
          Effect.flatMap((response) =>
            encodeJson(P.ProtoListTaskPushNotificationConfigResponse)({
              configs: (response.configs ?? []).map((config) =>
                toProtoTaskPushNotificationConfig(
                  toCompatTaskPushNotificationConfig(config)
                )
              ),
            })
          ),
          json(200)
        )
    ),
    route('GET', `${TASK}/pushNotificationConfigs/:configId`, (input) =>
      handler
        .getTaskPushNotificationConfig(
          { taskId: input.taskId, id: input.configId },
          input.context
        )
        .pipe(
          Effect.flatMap((config) =>
            encodeJson(P.ProtoTaskPushNotificationConfig)(
              toProtoTaskPushNotificationConfig(
                toCompatTaskPushNotificationConfig(config)
              )
            )
          ),
          json(200)
        )
    ),
    route('DELETE', `${TASK}/pushNotificationConfigs/:configId`, (input) =>
      handler
        .deleteTaskPushNotificationConfig(
          { taskId: input.taskId, id: input.configId },
          input.context
        )
        .pipe(Effect.as<LegacyRestReply>({ kind: 'empty', status: 204 }))
    ),
  ];
};
