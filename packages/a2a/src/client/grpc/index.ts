/**
 * The gRPC transport of the A2A client: `lf.a2a.v1.A2AService` over
 * `@grpc/grpc-js`, behind the client `Transport` contract.
 *
 * gRPC is opt-in: add the factory of {@link GrpcTransportFactory} to the
 * transports of the client factory. This entry point is the only one that
 * loads `@grpc/grpc-js`, an optional peer dependency, on the client side.
 *
 * @since 0.1.0
 */
import * as grpc from '@grpc/grpc-js';
import {
  type DescMessage,
  type MessageShape,
  fromBinary,
  toBinary,
} from '@bufbuild/protobuf';
import {
  Cause,
  Effect,
  Option,
  Predicate,
  Queue,
  Ref,
  Schema,
  Stream,
} from 'effect';
import type { Scope } from 'effect';
import {
  A2A_PROTOCOL_VERSION,
  A2A_VERSION_HEADER,
  TransportProtocol,
} from '../../Constants.js';
import { fromGrpcError } from '../../errors/grpc/index.js';
import { A2ATransportError, type ClientError } from '../../errors/index.js';
import {
  A2AMethods,
  fromProto,
  methodPath,
  toProto,
} from '../../server/grpc/codec.js';
import { isLegacyVersion } from '../../server/Version.js';
import type { AgentCard } from '../../Types.js';
import {
  type CallOptions,
  type ServiceParameters,
  type Transport,
  type TransportFactory,
  pickMatchingInterface,
} from '../Transport.js';

/**
 * The options of a gRPC transport.
 *
 * @since 0.1.0
 */
export interface GrpcTransportOptions {
  /** The gRPC target, such as `localhost:50051`: the interface URL. */
  readonly endpoint: string;
  /** The channel credentials. The default is insecure. */
  readonly channelCredentials?: grpc.ChannelCredentials;
  /** Options of every call, such as a deadline. */
  readonly callOptions?: Partial<grpc.CallOptions>;
  /** Options of the channel. */
  readonly channelOptions?: grpc.ChannelOptions;
}

const toBuffer = (bytes: Uint8Array): Buffer =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/**
 * The gRPC metadata of service parameters. `A2A-Version` defaults to
 * `protocolVersion` when the parameters do not name it.
 *
 * @since 0.1.0
 */
export const buildMetadata = (
  serviceParameters: ServiceParameters | undefined,
  protocolVersion: string
): grpc.Metadata => {
  const metadata = new grpc.Metadata();
  const entries = Object.entries(serviceParameters ?? {});
  for (const [key, value] of entries) metadata.set(key, value);
  const hasVersion = entries.some(
    ([key]) => key.toLowerCase() === A2A_VERSION_HEADER.toLowerCase()
  );
  if (!hasVersion) metadata.set(A2A_VERSION_HEADER, protocolVersion);
  return metadata;
};

/**
 * One gRPC method as the client calls it: its path and the protobuf-es
 * messages of its request and response.
 *
 * @since 0.1.0
 */
export interface GrpcMethod<
  ReqDesc extends DescMessage,
  ResDesc extends DescMessage,
> {
  readonly path: string;
  readonly input: ReqDesc;
  readonly output: ResDesc;
}

/**
 * A unary call. Interruption cancels the call.
 *
 * @since 0.1.0
 */
export const callUnary = <
  ReqDesc extends DescMessage,
  ResDesc extends DescMessage,
>(
  client: grpc.Client,
  method: GrpcMethod<ReqDesc, ResDesc>,
  request: MessageShape<ReqDesc>,
  metadata: grpc.Metadata,
  callOptions: Partial<grpc.CallOptions> = {}
): Effect.Effect<MessageShape<ResDesc>, ClientError> =>
  Effect.callback<MessageShape<ResDesc>, ClientError>((resume) => {
    const call = client.makeUnaryRequest(
      method.path,
      (value: MessageShape<ReqDesc>) => toBuffer(toBinary(method.input, value)),
      (bytes: Buffer) => fromBinary(method.output, bytes),
      request,
      metadata,
      callOptions,
      (error, value) => {
        if (Predicate.isNotNullish(error)) {
          resume(Effect.fail(fromGrpcError(error, method.path)));
        } else if (value === undefined) {
          resume(
            Effect.fail(
              new A2ATransportError({
                message: `gRPC call ${method.path} returned no response.`,
                protocol: TransportProtocol.GRPC,
              })
            )
          );
        } else {
          resume(Effect.succeed(value));
        }
      }
    );
    return Effect.sync(() => call.cancel());
  });

/**
 * A server-streaming call. The stream ends with the call; interruption, or
 * the end of the consumer, cancels it.
 *
 * @since 0.1.0
 */
export const callServerStream = <
  ReqDesc extends DescMessage,
  ResDesc extends DescMessage,
>(
  client: grpc.Client,
  method: GrpcMethod<ReqDesc, ResDesc>,
  request: MessageShape<ReqDesc>,
  metadata: grpc.Metadata,
  callOptions: Partial<grpc.CallOptions> = {}
): Stream.Stream<MessageShape<ResDesc>, ClientError> =>
  Stream.callback<MessageShape<ResDesc>, ClientError>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const call = client.makeServerStreamRequest(
          method.path,
          (value: MessageShape<ReqDesc>) =>
            toBuffer(toBinary(method.input, value)),
          (bytes: Buffer) => fromBinary(method.output, bytes),
          request,
          metadata,
          callOptions
        );
        call.on('data', (message: MessageShape<ResDesc>) => {
          Queue.offerUnsafe(queue, message);
        });
        call.on('error', (error: grpc.ServiceError) => {
          Queue.failCauseUnsafe(
            queue,
            Cause.fail(fromGrpcError(error, method.path))
          );
        });
        call.on('end', () => {
          Queue.endUnsafe(queue);
        });
        return call;
      }),
      (call) => Effect.sync(() => call.cancel())
    )
  );

const conversionError = (error: { readonly message: string }) =>
  new A2ATransportError({
    message: `gRPC conversion failed: ${error.message}`,
    protocol: TransportProtocol.GRPC,
  });

type MethodName = keyof typeof A2AMethods;

type MethodSpec<T, E, Desc extends DescMessage> = readonly [
  Schema.Codec<T, E>,
  Desc,
];

/**
 * A transport of protocol 1.0 over an open gRPC client.
 *
 * @since 0.1.0
 */
export const makeGrpcTransport = (
  client: grpc.Client,
  options: Pick<GrpcTransportOptions, 'callOptions'> = {}
): Transport => {
  const metadataOf = (callOptions?: CallOptions) =>
    buildMetadata(callOptions?.serviceParameters, A2A_PROTOCOL_VERSION);

  const prepare = <
    Req,
    ReqE,
    ReqDesc extends DescMessage,
    Res,
    ResE,
    ResDesc extends DescMessage,
  >(
    name: MethodName,
    spec: {
      readonly request: MethodSpec<Req, ReqE, ReqDesc>;
      readonly response: MethodSpec<Res, ResE, ResDesc>;
    },
    params: Req
  ) =>
    Effect.map(
      toProto(
        spec.request[0],
        spec.request[1]
      )(params).pipe(Effect.mapError(conversionError)),
      (message) => ({
        method: {
          path: methodPath(name),
          input: spec.request[1],
          output: spec.response[1],
        },
        message,
        decode: (reply: MessageShape<ResDesc>) =>
          fromProto(
            spec.response[0],
            spec.response[1]
          )(reply).pipe(Effect.mapError(conversionError)),
      })
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
      name: MethodName,
      spec: {
        readonly request: MethodSpec<Req, ReqE, ReqDesc>;
        readonly response: MethodSpec<Res, ResE, ResDesc>;
      }
    ) =>
    (params: Req, callOptions?: CallOptions): Effect.Effect<Res, ClientError> =>
      Effect.gen(function* () {
        const call = yield* prepare(name, spec, params);
        const reply = yield* callUnary(
          client,
          call.method,
          call.message,
          metadataOf(callOptions),
          options.callOptions
        );
        return yield* call.decode(reply);
      });

  const streaming =
    <Req, ReqE, ReqDesc extends DescMessage>(
      name: 'sendStreamingMessage' | 'subscribeToTask',
      spec: {
        readonly request: MethodSpec<Req, ReqE, ReqDesc>;
        readonly response: typeof A2AMethods.sendStreamingMessage.response;
      }
    ) =>
    (params: Req, callOptions?: CallOptions) =>
      Stream.unwrap(
        Effect.map(prepare(name, spec, params), (call) =>
          callServerStream(
            client,
            call.method,
            call.message,
            metadataOf(callOptions),
            options.callOptions
          ).pipe(Stream.mapEffect(call.decode))
        )
      );

  const m = A2AMethods;
  return {
    protocolName: TransportProtocol.GRPC,
    protocolVersion: A2A_PROTOCOL_VERSION,
    getExtendedAgentCard: unary('getExtendedAgentCard', m.getExtendedAgentCard),
    sendMessage: (params, callOptions) =>
      Effect.map(
        unary('sendMessage', m.sendMessage)(params, callOptions),
        (response) => ('task' in response ? response.task : response.message)
      ),
    sendMessageStream: streaming(
      'sendStreamingMessage',
      m.sendStreamingMessage
    ),
    getTask: unary('getTask', m.getTask),
    cancelTask: unary('cancelTask', m.cancelTask),
    listTasks: unary('listTasks', m.listTasks),
    createTaskPushNotificationConfig: unary(
      'createTaskPushNotificationConfig',
      m.createTaskPushNotificationConfig
    ),
    getTaskPushNotificationConfig: unary(
      'getTaskPushNotificationConfig',
      m.getTaskPushNotificationConfig
    ),
    listTaskPushNotificationConfig: unary(
      'listTaskPushNotificationConfigs',
      m.listTaskPushNotificationConfigs
    ),
    deleteTaskPushNotificationConfig: (params, callOptions) =>
      Effect.asVoid(
        unary(
          'deleteTaskPushNotificationConfig',
          m.deleteTaskPushNotificationConfig
        )(params, callOptions)
      ),
    resubscribeTask: streaming('subscribeToTask', m.subscribeToTask),
  };
};

/**
 * Opens a gRPC client for a target. Close it with `client.close()`.
 *
 * @since 0.1.0
 */
export const openGrpcClient = (options: GrpcTransportOptions): grpc.Client =>
  new grpc.Client(
    options.endpoint,
    options.channelCredentials ?? grpc.credentials.createInsecure(),
    options.channelOptions
  );

/**
 * A gRPC transport whose client closes with the scope.
 *
 * @since 0.1.0
 */
export const GrpcTransport = {
  make: (
    options: GrpcTransportOptions
  ): Effect.Effect<Transport, never, Scope.Scope> =>
    Effect.map(
      Effect.acquireRelease(
        Effect.sync(() => openGrpcClient(options)),
        (client) => Effect.sync(() => client.close())
      ),
      (client) => makeGrpcTransport(client, options)
    ),
};

/**
 * Builds the transport of a legacy protocol version over an open gRPC
 * client, such as the v0.3 transport of
 * `@jambudipa/a2a/compat/v0_3/client/grpc`.
 *
 * @since 0.1.0
 */
export interface GrpcLegacyTransport {
  readonly make: (
    client: grpc.Client,
    options: GrpcTransportOptions
  ) => Transport;
}

/**
 * The options of {@link GrpcTransportFactory}.
 *
 * @since 0.1.0
 */
export interface GrpcTransportFactoryOptions {
  readonly channelCredentials?: grpc.ChannelCredentials;
  readonly callOptions?: Partial<grpc.CallOptions>;
  readonly channelOptions?: grpc.ChannelOptions;
  /**
   * Serves interfaces of a legacy protocol version (`[0.3, 1.0)`) with this
   * transport instead of the 1.0 one.
   */
  readonly legacyCompat?: GrpcLegacyTransport;
}

/**
 * The factory of gRPC transports (binding `GRPC`). Each transport opens its
 * own client; every client closes when the scope of the factory closes.
 *
 * ```ts
 * const grpcFactory = yield* GrpcTransportFactory.make()
 * const factory = yield* ClientFactory.make({ transports: [grpcFactory] })
 * ```
 *
 * @since 0.1.0
 */
export const GrpcTransportFactory = {
  protocolName: TransportProtocol.GRPC,
  make: (
    options: GrpcTransportFactoryOptions = {}
  ): Effect.Effect<TransportFactory, never, Scope.Scope> =>
    Effect.gen(function* () {
      // A Ref, not a hashed collection: Effect hashing walks a grpc.Client
      // structurally and trips over its HTTP/2 socket.
      const clients = yield* Ref.make<ReadonlyArray<grpc.Client>>([]);
      yield* Effect.addFinalizer(() =>
        Effect.flatMap(Ref.get(clients), (open) =>
          Effect.sync(() => {
            for (const client of open) client.close();
          })
        )
      );
      return {
        protocolName: TransportProtocol.GRPC,
        create: (url: string, agentCard: AgentCard) =>
          Effect.gen(function* () {
            const transportOptions: GrpcTransportOptions = {
              ...options,
              endpoint: url,
            };
            const client = openGrpcClient(transportOptions);
            yield* Ref.update(clients, (open) => [...open, client]);
            const legacy = Option.fromUndefinedOr(options.legacyCompat).pipe(
              Option.filter(() =>
                Option.exists(
                  pickMatchingInterface(agentCard, TransportProtocol.GRPC, url),
                  (agentInterface) =>
                    isLegacyVersion(agentInterface.protocolVersion)
                )
              )
            );
            return Option.isSome(legacy)
              ? legacy.value.make(client, transportOptions)
              : makeGrpcTransport(client, transportOptions);
          }),
      };
    }),
};
