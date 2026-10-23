/**
 * The gRPC binding of the A2A server (specification §10): the service
 * `lf.a2a.v1.A2AService` on `@grpc/grpc-js`, over the `A2ARequestHandler`.
 *
 * Use {@link A2AGrpcServer} for a ready server, or add {@link A2AService}
 * with the implementation of {@link grpcService} to your own `grpc.Server`.
 * This entry point is the only one that loads `@grpc/grpc-js`, an optional
 * peer dependency, on the server side.
 *
 * @since 0.1.0
 */
import * as grpc from '@grpc/grpc-js';
import type { DescMessage, MessageShape } from '@bufbuild/protobuf';
import {
  Cause,
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Predicate,
  Ref,
  Schema,
  Stream,
} from 'effect';
import { Headers } from 'effect/http';
import {
  A2A_VERSION_HEADER,
  HTTP_EXTENSION_HEADER,
  TransportProtocol,
} from '../../Constants.js';
import {
  GRPC_STATUS_DETAILS_BIN,
  grpcStatusFor,
  statusDetailsFor,
} from '../../errors/grpc/index.js';
import {
  InternalError,
  RequestMalformedError,
  type ServerError,
  isA2AError,
} from '../../errors/index.js';
import * as Extensions from '../../Extensions.js';
import * as pb from '../../generated/v1/a2a_pb.js';
import type { StreamResponse } from '../../Types.js';
import { catchDefects, catchStreamDefects } from '../internal/http.js';
import { isMessage } from '../internal/utils.js';
import { A2ARequestHandler } from '../RequestHandler.js';
import * as ServerCallContext from '../ServerCallContext.js';
import { UnauthenticatedUser, type User } from '../User.js';
import { validateVersion } from '../Version.js';
import {
  A2AMethods,
  fromProto,
  makeServiceDefinition,
  toProto,
} from './codec.js';
import { failUnary, respondUnary } from './internal/callbacks.js';

export {
  A2AMethods,
  Empty,
  GrpcConversionError,
  fromProto,
  makeServiceDefinition,
  methodPath,
  toProto,
} from './codec.js';

/**
 * The `@grpc/grpc-js` service definition of `lf.a2a.v1.A2AService`. Its
 * methods (de)serialize protobuf-es messages.
 *
 * @since 0.1.0
 */
export const A2AService: grpc.ServiceDefinition = makeServiceDefinition(
  pb.A2AService
);

/**
 * A server call of the gRPC binding.
 *
 * @since 0.1.0
 */
export type GrpcServerCall =
  | grpc.ServerUnaryCall<unknown, unknown>
  | grpc.ServerWritableStream<unknown, unknown>;

/**
 * Finds the caller of a gRPC call, for example from its metadata.
 *
 * @since 0.1.0
 */
export type GrpcUserBuilder = (
  call: GrpcServerCall
) => Effect.Effect<User, ServerError>;

/**
 * The user builders of the reference SDK.
 *
 * @since 0.1.0
 */
export const UserBuilder = {
  /** Every caller is the unauthenticated user. */
  noAuthentication: (() =>
    Effect.succeed(UnauthenticatedUser)) satisfies GrpcUserBuilder,
};

/**
 * The options of {@link grpcService}.
 *
 * @since 0.1.0
 */
export interface GrpcServiceOptions {
  /** Finds the caller of a call. The default is no authentication. */
  readonly userBuilder?: GrpcUserBuilder;
}

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

/**
 * The gRPC status of a server failure, with the `grpc-status-details-bin`
 * trailer of an A2A error.
 *
 * @since 0.1.0
 */
export const toServiceError = (
  error: ServerError
): Partial<grpc.StatusObject> => {
  const details = statusDetailsFor(error);
  if (Option.isNone(details)) {
    return { code: grpcStatusFor(error), details: error.message };
  }
  const metadata = new grpc.Metadata();
  metadata.set(
    GRPC_STATUS_DETAILS_BIN,
    Buffer.from(
      details.value.buffer,
      details.value.byteOffset,
      details.value.byteLength
    )
  );
  return { code: grpcStatusFor(error), details: error.message, metadata };
};

const metadataText = (value: grpc.MetadataValue): string =>
  Predicate.isString(value) ? value : value.toString();

const tenantOf = (request: unknown): string =>
  Predicate.hasProperty(request, 'tenant') && Predicate.isString(request.tenant)
    ? request.tenant
    : '';

type MethodSpec<T, E, Desc extends DescMessage> = readonly [
  Schema.Codec<T, E>,
  Desc,
];

const makeImplementation = (
  handler: A2ARequestHandler['Service'],
  services: Context.Context<never>,
  options: GrpcServiceOptions
): grpc.UntypedServiceImplementation => {
  const run = Effect.runCallbackWith(services);

  const buildContext = (call: GrpcServerCall, tenant: string) =>
    Effect.gen(function* () {
      const user =
        options.userBuilder === undefined
          ? UnauthenticatedUser
          : yield* options.userBuilder(call);
      const version = Option.fromUndefinedOr(
        call.metadata.get(A2A_VERSION_HEADER.toLowerCase())[0]
      ).pipe(Option.map(metadataText));
      const extensions = call.metadata
        .get(HTTP_EXTENSION_HEADER.toLowerCase())
        .map(metadataText)
        .join(',');
      const context = yield* ServerCallContext.make({
        user,
        tenant,
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

  const decodeRequest = <T, E, Desc extends DescMessage>(
    [schema, desc]: MethodSpec<T, E, Desc>,
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

  const encodeResponse = <T, E, Desc extends DescMessage>(
    [schema, desc]: MethodSpec<T, E, Desc>,
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
      spec: {
        readonly request: MethodSpec<Req, ReqE, ReqDesc>;
        readonly response: MethodSpec<Res, ResE, ResDesc>;
      },
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
        const request = yield* decodeRequest(spec.request, call.request);
        const context = yield* buildContext(call, tenantOf(request));
        const result = yield* invoke(request, context);
        const message = yield* encodeResponse(spec.response, result);
        const metadata = yield* responseMetadata(context);
        call.sendMetadata(metadata);
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
      spec: {
        readonly request: MethodSpec<Req, ReqE, ReqDesc>;
        readonly response: typeof A2AMethods.sendStreamingMessage.response;
      },
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
        const request = yield* decodeRequest(spec.request, call.request);
        const context = yield* buildContext(call, tenantOf(request));
        const headersSent = yield* Ref.make(false);
        // The response headers go out with the first event, so that they
        // echo the extensions that the execution activated.
        const sendHeaders = Effect.gen(function* () {
          if (yield* Ref.getAndSet(headersSent, true)) return;
          call.sendMetadata(yield* responseMetadata(context));
        });
        yield* Stream.runForEach(
          catchStreamDefects(invoke(request, context)),
          (event) =>
            Effect.gen(function* () {
              const message = yield* encodeResponse(spec.response, event);
              yield* sendHeaders;
              call.write(message);
            })
        );
        yield* sendHeaders;
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

  return {
    sendMessage: unary(A2AMethods.sendMessage, (request, context) =>
      Effect.map(handler.sendMessage(request, context), (result) =>
        isMessage(result) ? { message: result } : { task: result }
      )
    ),
    sendStreamingMessage: streaming(
      A2AMethods.sendStreamingMessage,
      handler.sendMessageStream
    ),
    getTask: unary(A2AMethods.getTask, handler.getTask),
    listTasks: unary(A2AMethods.listTasks, handler.listTasks),
    cancelTask: unary(A2AMethods.cancelTask, handler.cancelTask),
    subscribeToTask: streaming(A2AMethods.subscribeToTask, handler.resubscribe),
    createTaskPushNotificationConfig: unary(
      A2AMethods.createTaskPushNotificationConfig,
      handler.createTaskPushNotificationConfig
    ),
    getTaskPushNotificationConfig: unary(
      A2AMethods.getTaskPushNotificationConfig,
      handler.getTaskPushNotificationConfig
    ),
    listTaskPushNotificationConfigs: unary(
      A2AMethods.listTaskPushNotificationConfigs,
      handler.listTaskPushNotificationConfigs
    ),
    getExtendedAgentCard: unary(
      A2AMethods.getExtendedAgentCard,
      handler.getAuthenticatedExtendedAgentCard
    ),
    deleteTaskPushNotificationConfig: unary(
      A2AMethods.deleteTaskPushNotificationConfig,
      (request, context) =>
        Effect.as(
          handler.deleteTaskPushNotificationConfig(request, context),
          {}
        )
    ),
  };
};

/**
 * The implementation of {@link A2AService} over the `A2ARequestHandler`. Each
 * call runs as an Effect in the context of this effect; a cancelled call
 * interrupts it.
 *
 * ```ts
 * const implementation = yield* grpcService()
 * server.addService(A2AService, implementation)
 * ```
 *
 * @since 0.1.0
 */
export const grpcService = (
  options: GrpcServiceOptions = {}
): Effect.Effect<grpc.UntypedServiceImplementation, never, A2ARequestHandler> =>
  Effect.gen(function* () {
    const handler = yield* A2ARequestHandler;
    const services = yield* Effect.context<never>();
    return makeImplementation(handler, services, options);
  });

/**
 * A service to add to the gRPC server beside {@link A2AService}, such as the
 * v0.3 service of `@jambudipa/a2a/compat/v0_3/server/grpc`.
 *
 * @since 0.1.0
 */
export interface GrpcServiceRegistration {
  readonly definition: grpc.ServiceDefinition;
  readonly implementation: grpc.UntypedServiceImplementation;
}

/**
 * The options of {@link A2AGrpcServer}.
 *
 * @since 0.1.0
 */
export interface A2AGrpcServerOptions extends GrpcServiceOptions {
  /** The host to bind. The default is `0.0.0.0`. */
  readonly host?: string;
  /** The port to bind; 0 picks a free port. The default is 50051. */
  readonly port?: number;
  /** The server credentials. The default is insecure. */
  readonly credentials?: grpc.ServerCredentials;
  /** Options of the `grpc.Server`. */
  readonly serverOptions?: grpc.ServerOptions;
  /** More services to serve on the same server. */
  readonly additionalServices?: ReadonlyArray<
    Effect.Effect<GrpcServiceRegistration, never, A2ARequestHandler>
  >;
}

/**
 * The gRPC server could not start.
 *
 * @since 0.1.0
 */
export class GrpcServerError extends Schema.TaggedError<GrpcServerError>()(
  'GrpcServerError',
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  }
) {}

const shutdown = (server: grpc.Server) =>
  Effect.callback<void>((resume) => {
    server.tryShutdown(() => resume(Effect.void));
  }).pipe(
    Effect.timeoutOrElse({
      duration: '2 seconds',
      orElse: () => Effect.sync(() => server.forceShutdown()),
    })
  );

const makeServer = (options: A2AGrpcServerOptions) =>
  Effect.gen(function* () {
    const implementation = yield* grpcService(options);
    const additional = yield* Effect.forEach(
      options.additionalServices ?? [],
      (registration) => registration
    );
    const server = new grpc.Server(options.serverOptions);
    server.addService(A2AService, implementation);
    for (const registration of additional) {
      server.addService(registration.definition, registration.implementation);
    }
    const address = `${options.host ?? '0.0.0.0'}:${options.port ?? 50051}`;
    const port = yield* Effect.acquireRelease(
      Effect.callback<number, GrpcServerError>((resume) => {
        server.bindAsync(
          address,
          options.credentials ?? grpc.ServerCredentials.createInsecure(),
          (error, bound) =>
            resume(
              Predicate.isNotNullish(error)
                ? Effect.fail(
                    new GrpcServerError({
                      message: `Cannot bind the gRPC server to ${address}: ${error.message}`,
                      cause: error,
                    })
                  )
                : Effect.succeed(bound)
            )
        );
      }),
      () => shutdown(server)
    );
    return A2AGrpcServer.of({ server, port });
  });

/**
 * A running gRPC server with {@link A2AService}. The server binds when the
 * layer is built and shuts down when its scope closes; a call still running
 * after 2 seconds is cancelled.
 *
 * ```ts
 * A2AGrpcServer.layer({ port: 50051 }).pipe(
 *   Layer.provide(DefaultRequestHandler.layer({ agentCard })),
 *   Layer.provide([InMemoryTaskStore.layer, MyExecutor.layer, NodeCrypto.layer])
 * )
 * ```
 *
 * @since 0.1.0
 */
export class A2AGrpcServer extends Context.Service<
  A2AGrpcServer,
  {
    readonly server: grpc.Server;
    /** The bound port, useful when the options ask for port 0. */
    readonly port: number;
  }
>()('@jambudipa/a2a/server/grpc/A2AGrpcServer') {
  static readonly layer = (
    options: A2AGrpcServerOptions = {}
  ): Layer.Layer<A2AGrpcServer, GrpcServerError, A2ARequestHandler> =>
    Layer.effect(A2AGrpcServer, makeServer(options));
}
