/**
 * The v0.3 gRPC service `a2a.v1.A2AService` over the v1.0 request handler,
 * with the behaviour of `legacyGrpcService` of `@a2a-js/sdk` 1.3.0.
 *
 * Serve it beside the v1.0 service:
 *
 * ```ts
 * A2AGrpcServer.layer({ additionalServices: [legacyGrpcService()] })
 * ```
 *
 * The Agent Card must declare a `GRPC` interface with protocol version 0.3.
 * This entry point loads `@grpc/grpc-js` and `@bufbuild/protobuf`.
 *
 * @since 0.1.0
 */
import * as grpc from '@grpc/grpc-js';
import type { DescMessage, MessageShape } from '@bufbuild/protobuf';
import {
  Cause,
  type Context,
  Effect,
  Exit,
  Option,
  Predicate,
  Ref,
  type Schema,
  Stream,
} from 'effect';
import { Headers } from 'effect/http';
import {
  A2A_VERSION_HEADER,
  HTTP_EXTENSION_HEADER,
  TransportProtocol,
} from '../../../../Constants.js';
import {
  InternalError,
  RequestMalformedError,
  type ServerError,
  isA2AError,
} from '../../../../errors/index.js';
import * as Extensions from '../../../../Extensions.js';
import * as pb from '../../../../generated/v0_3/a2a_pb.js';
import {
  type GrpcServerCall,
  type GrpcServiceOptions,
  type GrpcServiceRegistration,
  fromProto,
  makeServiceDefinition,
  toProto,
  toServiceError,
} from '../../../../server/grpc/index.js';
import {
  failUnary,
  respondUnary,
} from '../../../../server/grpc/internal/callbacks.js';
import {
  catchDefects,
  catchStreamDefects,
} from '../../../../server/internal/http.js';
import { A2ARequestHandler } from '../../../../server/RequestHandler.js';
import * as ServerCallContext from '../../../../server/ServerCallContext.js';
import { UnauthenticatedUser } from '../../../../server/User.js';
import { validateVersion } from '../../../../server/Version.js';
import type { StreamResponse } from '../../../../Types.js';
import { toCompatAgentCard } from '../../AgentCard.js';
import { LEGACY_HTTP_EXTENSION_HEADER } from '../../Constants.js';
import {
  extractTaskAndPushNotificationConfigId,
  extractTaskId,
  fromProtoPushNotificationConfig,
  fromProtoSendMessageRequest,
  toProtoAgentCard,
  toProtoSendMessageResponse,
  toProtoStreamResponse,
  toProtoTask,
  toProtoTaskPushNotificationConfig,
} from '../../proto.js';
import * as P from '../../ProtoTypes.js';
import {
  toCompatSendMessageResult,
  toCompatStreamEvent,
  toCompatTask,
  toCompatTaskPushNotificationConfig,
  toCoreSendMessageRequest,
  toCoreTaskPushNotificationConfig,
} from '../../translate.js';

/**
 * The `@grpc/grpc-js` service definition of the v0.3 `a2a.v1.A2AService`.
 *
 * @since 0.1.0
 */
export const LegacyA2AService: grpc.ServiceDefinition = makeServiceDefinition(
  pb.A2AService
);

type Spec<T, E, Desc extends DescMessage> = readonly [Schema.Codec<T, E>, Desc];

const isServerError = (value: unknown): value is ServerError =>
  isA2AError(value) || Predicate.isTagged(value, 'InternalError');

const serverErrorOf = (cause: Cause.Cause<unknown>): ServerError => {
  const error = Cause.squash(cause);
  return isServerError(error)
    ? error
    : new InternalError({
        message: error instanceof Error ? error.message : String(error),
      });
};

const metadataText = (value: grpc.MetadataValue): string =>
  Predicate.isString(value) ? value : value.toString();

const makeLegacyImplementation = (
  handler: A2ARequestHandler['Service'],
  services: Context.Context<never>,
  options: GrpcServiceOptions
): grpc.UntypedServiceImplementation => {
  const run = Effect.runCallbackWith(services);

  const buildContext = (call: GrpcServerCall) =>
    Effect.gen(function* () {
      const user =
        options.userBuilder === undefined
          ? UnauthenticatedUser
          : yield* options.userBuilder(call);
      const version = Option.fromUndefinedOr(
        call.metadata.get(A2A_VERSION_HEADER.toLowerCase())[0]
      ).pipe(Option.map(metadataText));
      const extensions = [
        ...call.metadata.get(HTTP_EXTENSION_HEADER.toLowerCase()),
        ...call.metadata.get(LEGACY_HTTP_EXTENSION_HEADER.toLowerCase()),
      ]
        .map(metadataText)
        .join(',');
      const context = yield* ServerCallContext.make({
        user,
        headers: Headers.fromInput(
          Object.fromEntries(
            Object.entries(call.metadata.getMap()).map(([key, value]) => [
              key,
              metadataText(value),
            ])
          )
        ),
        extensions: Extensions.parseServiceParameter(extensions),
        ...(Option.isSome(version) ? { requestedVersion: version.value } : {}),
      });
      const card = yield* handler.getAgentCard;
      yield* validateVersion(
        context.requestedVersion,
        card,
        TransportProtocol.GRPC
      );
      return context;
    });

  const responseMetadata = (context: ServerCallContext.ServerCallContext) =>
    Effect.map(Ref.get(context.activatedExtensions), (activated) => {
      const metadata = new grpc.Metadata();
      if (activated.length > 0) {
        metadata.set(
          HTTP_EXTENSION_HEADER,
          Extensions.toServiceParameter(activated)
        );
      }
      return metadata;
    });

  const decode = <T, E, Desc extends DescMessage>(
    [schema, desc]: Spec<T, E, Desc>,
    message: MessageShape<Desc>
  ) =>
    fromProto(
      schema,
      desc
    )(message).pipe(
      Effect.mapError(
        (error) => new RequestMalformedError({ message: error.message })
      )
    );

  const encode = <T, E, Desc extends DescMessage>(
    [schema, desc]: Spec<T, E, Desc>,
    value: T
  ) =>
    toProto(
      schema,
      desc
    )(value).pipe(
      Effect.mapError(
        (error) =>
          new InternalError({
            message: `Cannot encode the response: ${error.message}`,
          })
      )
    );

  const unary =
    <
      Req,
      ReqE,
      ReqDesc extends DescMessage,
      Res,
      ResE,
      ResDesc extends DescMessage,
    >(
      request: Spec<Req, ReqE, ReqDesc>,
      response: Spec<Res, ResE, ResDesc>,
      invoke: (
        request: Req,
        context: ServerCallContext.ServerCallContext
      ) => Effect.Effect<Res, ServerError>
    ) =>
    (
      call: grpc.ServerUnaryCall<MessageShape<ReqDesc>, MessageShape<ResDesc>>,
      callback: grpc.sendUnaryData<MessageShape<ResDesc>>
    ): void => {
      const effect = Effect.gen(function* () {
        const context = yield* buildContext(call);
        const decoded = yield* decode(request, call.request);
        const result = yield* invoke(decoded, context);
        const message = yield* encode(response, result);
        call.sendMetadata(yield* responseMetadata(context));
        return message;
      });
      const interrupt = run(catchDefects(effect), {
        onExit: (exit) => {
          if (Exit.isSuccess(exit)) {
            respondUnary(callback, exit.value);
          } else if (!Cause.hasInterruptsOnly(exit.cause)) {
            failUnary(callback, toServiceError(serverErrorOf(exit.cause)));
          }
        },
      });
      call.on('cancelled', () => interrupt());
    };

  const streaming =
    <Req, ReqE, ReqDesc extends DescMessage>(
      request: Spec<Req, ReqE, ReqDesc>,
      invoke: (
        request: Req,
        context: ServerCallContext.ServerCallContext
      ) => Stream.Stream<StreamResponse, ServerError>
    ) =>
    (
      call: grpc.ServerWritableStream<
        MessageShape<ReqDesc>,
        MessageShape<typeof pb.StreamResponseSchema>
      >
    ): void => {
      const effect = Effect.gen(function* () {
        const context = yield* buildContext(call);
        const decoded = yield* decode(request, call.request);
        const events = invoke(decoded, context);
        call.sendMetadata(yield* responseMetadata(context));
        yield* Stream.runForEach(catchStreamDefects(events), (event) =>
          Effect.map(
            encode(
              [P.ProtoStreamResponse, pb.StreamResponseSchema],
              toProtoStreamResponse(toCompatStreamEvent(event))
            ),
            (message) => {
              call.write(message);
            }
          )
        );
      });
      const interrupt = run(catchDefects(effect), {
        onExit: (exit) => {
          if (Exit.isSuccess(exit)) {
            call.end();
          } else if (!Cause.hasInterruptsOnly(exit.cause)) {
            call.emit('error', toServiceError(serverErrorOf(exit.cause)));
          }
        },
      });
      call.on('cancelled', () => interrupt());
    };

  const sendRequest = (request: P.ProtoSendMessageRequest) =>
    fromProtoSendMessageRequest(request).pipe(
      Effect.flatMap((params) => toCoreSendMessageRequest(params))
    );

  const configResponse = [
    P.ProtoTaskPushNotificationConfig,
    pb.TaskPushNotificationConfigSchema,
  ] as const;

  return {
    sendMessage: unary(
      [P.ProtoSendMessageRequest, pb.SendMessageRequestSchema],
      [P.ProtoSendMessageResponse, pb.SendMessageResponseSchema],
      (request, context) =>
        sendRequest(request).pipe(
          Effect.flatMap((core) => handler.sendMessage(core, context)),
          Effect.map((result) =>
            toProtoSendMessageResponse(toCompatSendMessageResult(result))
          )
        )
    ),
    sendStreamingMessage: streaming(
      [P.ProtoSendMessageRequest, pb.SendMessageRequestSchema],
      (request, context) =>
        Stream.unwrap(
          Effect.map(sendRequest(request), (core) =>
            handler.sendMessageStream(core, context)
          )
        )
    ),
    taskSubscription: streaming(
      [P.ProtoNameRequest, pb.TaskSubscriptionRequestSchema],
      (request, context) =>
        Stream.unwrap(
          Effect.map(extractTaskId(request.name ?? ''), (id) =>
            handler.resubscribe({ id }, context)
          )
        )
    ),
    getTask: unary(
      [P.ProtoGetTaskRequest, pb.GetTaskRequestSchema],
      [P.ProtoTask, pb.TaskSchema],
      (request, context) =>
        extractTaskId(request.name ?? '').pipe(
          // As in the reference, an absent history length reads as 0.
          Effect.flatMap((id) =>
            handler.getTask(
              { id, historyLength: request.historyLength ?? 0 },
              context
            )
          ),
          Effect.map((task) => toProtoTask(toCompatTask(task)))
        )
    ),
    cancelTask: unary(
      [P.ProtoNameRequest, pb.CancelTaskRequestSchema],
      [P.ProtoTask, pb.TaskSchema],
      (request, context) =>
        extractTaskId(request.name ?? '').pipe(
          Effect.flatMap((id) => handler.cancelTask({ id }, context)),
          Effect.map((task) => toProtoTask(toCompatTask(task)))
        )
    ),
    createTaskPushNotificationConfig: unary(
      [
        P.ProtoCreateTaskPushNotificationConfigRequest,
        pb.CreateTaskPushNotificationConfigRequestSchema,
      ],
      configResponse,
      (request, context) =>
        Effect.gen(function* () {
          const config = request.config?.pushNotificationConfig;
          if (config === undefined) {
            return yield* new RequestMalformedError({
              message:
                'Request must include a `config` object with a `pushNotificationConfig`',
            });
          }
          const taskId = yield* extractTaskId(request.parent ?? '');
          const core = yield* toCoreTaskPushNotificationConfig({
            taskId,
            pushNotificationConfig: fromProtoPushNotificationConfig(config),
          });
          const created = yield* handler.createTaskPushNotificationConfig(
            core,
            context
          );
          return toProtoTaskPushNotificationConfig(
            toCompatTaskPushNotificationConfig(created)
          );
        })
    ),
    getTaskPushNotificationConfig: unary(
      [P.ProtoNameRequest, pb.GetTaskPushNotificationConfigRequestSchema],
      configResponse,
      (request, context) =>
        extractTaskAndPushNotificationConfigId(request.name ?? '').pipe(
          Effect.flatMap(({ taskId, configId }) =>
            handler.getTaskPushNotificationConfig(
              { taskId, id: configId },
              context
            )
          ),
          Effect.map((config) =>
            toProtoTaskPushNotificationConfig(
              toCompatTaskPushNotificationConfig(config)
            )
          )
        )
    ),
    listTaskPushNotificationConfig: unary(
      [
        P.ProtoListTaskPushNotificationConfigRequest,
        pb.ListTaskPushNotificationConfigRequestSchema,
      ],
      [
        P.ProtoListTaskPushNotificationConfigResponse,
        pb.ListTaskPushNotificationConfigResponseSchema,
      ],
      (request, context) =>
        extractTaskId(request.parent ?? '').pipe(
          Effect.flatMap((taskId) =>
            handler.listTaskPushNotificationConfigs({ taskId }, context)
          ),
          Effect.map((response) => ({
            configs: (response.configs ?? []).map((config) =>
              toProtoTaskPushNotificationConfig(
                toCompatTaskPushNotificationConfig(config)
              )
            ),
          }))
        )
    ),
    deleteTaskPushNotificationConfig: unary(
      [P.ProtoNameRequest, pb.DeleteTaskPushNotificationConfigRequestSchema],
      [
        P.ProtoEmpty,
        pb.A2AService.method.deleteTaskPushNotificationConfig.output,
      ],
      (request, context) =>
        extractTaskAndPushNotificationConfigId(request.name ?? '').pipe(
          Effect.flatMap(({ taskId, configId }) =>
            handler.deleteTaskPushNotificationConfig(
              { taskId, id: configId },
              context
            )
          ),
          Effect.as({})
        )
    ),
    getAgentCard: unary(
      [P.ProtoEmpty, pb.GetAgentCardRequestSchema],
      [P.ProtoAgentCard, pb.AgentCardSchema],
      (_request, context) =>
        handler.getAuthenticatedExtendedAgentCard({}, context).pipe(
          Effect.flatMap((card) => toCompatAgentCard(card)),
          Effect.map(toProtoAgentCard)
        )
    ),
  };
};

/**
 * The v0.3 service with its implementation over the `A2ARequestHandler`,
 * ready for `additionalServices` of `A2AGrpcServer`, or for
 * `server.addService` of your own `grpc.Server`.
 *
 * @since 0.1.0
 */
export const legacyGrpcService = (
  options: GrpcServiceOptions = {}
): Effect.Effect<GrpcServiceRegistration, never, A2ARequestHandler> =>
  Effect.gen(function* () {
    const handler = yield* A2ARequestHandler;
    const services = yield* Effect.context<never>();
    return {
      definition: LegacyA2AService,
      implementation: makeLegacyImplementation(handler, services, options),
    };
  });
