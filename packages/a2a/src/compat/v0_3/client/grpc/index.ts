/**
 * The v0.3 gRPC client transport: the v1.0 transport contract over the v0.3
 * service `a2a.v1.A2AService`, as `LegacyGrpcTransport` of `@a2a-js/sdk`
 * 1.3.0.
 *
 * ```ts
 * const grpcFactory = yield* LegacyGrpcTransportFactory.make()
 * const factory = yield* LegacyCompatClient.clientFactory({ transports: [grpcFactory] })
 * ```
 *
 * This entry point loads `@grpc/grpc-js` and `@bufbuild/protobuf`.
 *
 * @since 0.1.0
 */
import type * as grpc from '@grpc/grpc-js';
import type { DescMessage } from '@bufbuild/protobuf';
import { Effect, type Schema, type Scope, Stream } from 'effect';
import {
  type GrpcLegacyTransport,
  type GrpcMethod,
  type GrpcTransportFactoryOptions,
  type GrpcTransportOptions,
  GrpcTransportFactory,
  buildMetadata,
  callServerStream,
  callUnary,
} from '../../../../client/grpc/index.js';
import type {
  CallOptions,
  Transport,
  TransportFactory,
} from '../../../../client/Transport.js';
import {
  A2A_LEGACY_PROTOCOL_VERSION,
  TransportProtocol,
} from '../../../../Constants.js';
import {
  A2ATransportError,
  type ClientError,
  InvalidAgentResponseError,
  UnsupportedOperationError,
} from '../../../../errors/index.js';
import * as pb from '../../../../generated/v0_3/a2a_pb.js';
import { fromProto, toProto } from '../../../../server/grpc/codec.js';
import type * as V1 from '../../../../Types.js';
import { toCoreAgentCard } from '../../AgentCard.js';
import {
  fromProtoAgentCard,
  fromProtoSendMessageResponse,
  fromProtoStreamResponse,
  fromProtoTask,
  fromProtoTaskPushNotificationConfig,
  generatePushNotificationConfigName,
  generateTaskName,
  toProtoSendMessageRequest,
  toProtoTaskPushNotificationConfig,
} from '../../proto.js';
import * as P from '../../ProtoTypes.js';
import {
  toCompatMessageSendParams,
  toCompatTaskPushNotificationConfig,
  toCoreSendMessageResult,
  toCoreStreamResponse,
  toCoreTask,
  toCoreTaskPushNotificationConfig,
} from '../../translate.js';

const PROTOCOL = TransportProtocol.GRPC;

const invalid = (error: { readonly message: string }) =>
  new A2ATransportError({
    message: `Invalid response: ${error.message}`,
    protocol: PROTOCOL,
  });

interface MethodDesc<ReqDesc extends DescMessage, ResDesc extends DescMessage> {
  readonly name: string;
  readonly input: ReqDesc;
  readonly output: ResDesc;
}

const methodOf = <ReqDesc extends DescMessage, ResDesc extends DescMessage>(
  method: MethodDesc<ReqDesc, ResDesc>
): GrpcMethod<ReqDesc, ResDesc> => ({
  path: `/${pb.A2AService.typeName}/${method.name}`,
  input: method.input,
  output: method.output,
});

const m = pb.A2AService.method;

/**
 * A transport of protocol 0.3 over an open gRPC client.
 *
 * @since 0.1.0
 */
export const makeLegacyGrpcTransport = (
  client: grpc.Client,
  options: Pick<GrpcTransportOptions, 'callOptions'> = {}
): Transport => {
  const metadataOf = (callOptions?: CallOptions) =>
    buildMetadata(callOptions?.serviceParameters, A2A_LEGACY_PROTOCOL_VERSION);

  const unary = <
    ReqDesc extends DescMessage,
    ResDesc extends DescMessage,
    Req,
    ReqE,
    Res,
    ResE,
  >(
    method: MethodDesc<ReqDesc, ResDesc>,
    request: Schema.Codec<Req, ReqE>,
    response: Schema.Codec<Res, ResE>,
    value: Req,
    callOptions: CallOptions | undefined
  ): Effect.Effect<Res, ClientError> =>
    Effect.gen(function* () {
      const message = yield* toProto(
        request,
        method.input
      )(value).pipe(Effect.mapError(invalid));
      const reply = yield* callUnary(
        client,
        methodOf(method),
        message,
        metadataOf(callOptions),
        options.callOptions
      );
      return yield* fromProto(
        response,
        method.output
      )(reply).pipe(Effect.mapError(invalid));
    });

  const streaming = <ReqDesc extends DescMessage, Req, ReqE>(
    method: MethodDesc<ReqDesc, typeof pb.StreamResponseSchema>,
    request: Schema.Codec<Req, ReqE>,
    value: Req,
    callOptions: CallOptions | undefined
  ): Stream.Stream<V1.StreamResponse, ClientError> =>
    Stream.unwrap(
      Effect.map(
        toProto(request, method.input)(value).pipe(Effect.mapError(invalid)),
        (message) =>
          callServerStream(
            client,
            methodOf(method),
            message,
            metadataOf(callOptions),
            options.callOptions
          ).pipe(
            Stream.mapEffect((reply) =>
              fromProto(
                P.ProtoStreamResponse,
                pb.StreamResponseSchema
              )(reply).pipe(
                Effect.mapError(invalid),
                Effect.flatMap((proto) =>
                  fromProtoStreamResponse(proto).pipe(
                    Effect.mapError(
                      (error) =>
                        new InvalidAgentResponseError({
                          message: error.message,
                        })
                    )
                  )
                ),
                Effect.flatMap((compat) =>
                  toCoreStreamResponse(compat).pipe(Effect.mapError(invalid))
                )
              )
            )
          )
      )
    );

  const taskOf = (proto: P.ProtoTask) =>
    fromProtoTask(proto).pipe(
      Effect.flatMap(toCoreTask),
      Effect.mapError(invalid)
    );

  const configOf = (proto: P.ProtoTaskPushNotificationConfig) =>
    fromProtoTaskPushNotificationConfig(proto).pipe(
      Effect.mapError(invalid),
      Effect.flatMap((compat) => toCoreTaskPushNotificationConfig(compat))
    );

  return {
    protocolName: PROTOCOL,
    protocolVersion: A2A_LEGACY_PROTOCOL_VERSION,
    getExtendedAgentCard: (_params, callOptions) =>
      unary(
        m.getAgentCard,
        P.ProtoEmpty,
        P.ProtoAgentCard,
        {},
        callOptions
      ).pipe(
        Effect.flatMap((proto) =>
          fromProtoAgentCard(proto).pipe(
            Effect.flatMap(toCoreAgentCard),
            Effect.mapError(invalid)
          )
        )
      ),
    sendMessage: (params, callOptions) =>
      unary(
        m.sendMessage,
        P.ProtoSendMessageRequest,
        P.ProtoSendMessageResponse,
        toProtoSendMessageRequest(toCompatMessageSendParams(params)),
        callOptions
      ).pipe(
        Effect.flatMap((proto) =>
          fromProtoSendMessageResponse(proto).pipe(
            Effect.flatMap(toCoreSendMessageResult),
            Effect.mapError(invalid)
          )
        )
      ),
    sendMessageStream: (params, callOptions) =>
      streaming(
        m.sendStreamingMessage,
        P.ProtoSendMessageRequest,
        toProtoSendMessageRequest(toCompatMessageSendParams(params)),
        callOptions
      ),
    createTaskPushNotificationConfig: (params, callOptions) => {
      const compat = toCompatTaskPushNotificationConfig(params);
      return unary(
        m.createTaskPushNotificationConfig,
        P.ProtoCreateTaskPushNotificationConfigRequest,
        P.ProtoTaskPushNotificationConfig,
        {
          parent: generateTaskName(compat.taskId),
          configId: compat.pushNotificationConfig.id ?? '',
          config: toProtoTaskPushNotificationConfig(compat),
        },
        callOptions
      ).pipe(Effect.flatMap(configOf));
    },
    getTaskPushNotificationConfig: (params, callOptions) =>
      unary(
        m.getTaskPushNotificationConfig,
        P.ProtoNameRequest,
        P.ProtoTaskPushNotificationConfig,
        { name: generatePushNotificationConfigName(params.taskId, params.id) },
        callOptions
      ).pipe(Effect.flatMap(configOf)),
    listTaskPushNotificationConfig: (params, callOptions) =>
      unary(
        m.listTaskPushNotificationConfig,
        P.ProtoListTaskPushNotificationConfigRequest,
        P.ProtoListTaskPushNotificationConfigResponse,
        { parent: generateTaskName(params.taskId) },
        callOptions
      ).pipe(
        Effect.flatMap((response) =>
          Effect.forEach(response.configs ?? [], configOf)
        ),
        Effect.map((configs) => ({ configs, nextPageToken: '' }))
      ),
    deleteTaskPushNotificationConfig: (params, callOptions) =>
      unary(
        m.deleteTaskPushNotificationConfig,
        P.ProtoNameRequest,
        P.ProtoEmpty,
        { name: generatePushNotificationConfigName(params.taskId, params.id) },
        callOptions
      ).pipe(Effect.asVoid),
    getTask: (params, callOptions) =>
      unary(
        m.getTask,
        P.ProtoGetTaskRequest,
        P.ProtoTask,
        {
          name: generateTaskName(params.id),
          ...(params.historyLength === undefined
            ? {}
            : { historyLength: params.historyLength }),
        },
        callOptions
      ).pipe(Effect.flatMap(taskOf)),
    cancelTask: (params, callOptions) =>
      unary(
        m.cancelTask,
        P.ProtoNameRequest,
        P.ProtoTask,
        { name: generateTaskName(params.id) },
        callOptions
      ).pipe(Effect.flatMap(taskOf)),
    listTasks: () =>
      Effect.fail(
        new UnsupportedOperationError({
          message: 'tasks/list has no equivalent in v0.3 gRPC',
        })
      ),
    resubscribeTask: (params, callOptions) =>
      streaming(
        m.taskSubscription,
        P.ProtoNameRequest,
        { name: generateTaskName(params.id) },
        callOptions
      ),
  };
};

/**
 * The v0.3 transport as the `legacyCompat` of `GrpcTransportFactory`.
 *
 * @since 0.1.0
 */
export const LegacyGrpcTransport: GrpcLegacyTransport = {
  make: (client, options) => makeLegacyGrpcTransport(client, options),
};

/**
 * The gRPC transport factory that serves a `GRPC` interface of protocol
 * version 0.3 with the v0.3 transport, and other interfaces with the v1.0
 * one.
 *
 * @since 0.1.0
 */
export const LegacyGrpcTransportFactory = {
  make: (
    options: Omit<GrpcTransportFactoryOptions, 'legacyCompat'> = {}
  ): Effect.Effect<TransportFactory, never, Scope.Scope> =>
    GrpcTransportFactory.make({
      ...options,
      legacyCompat: LegacyGrpcTransport,
    }),
};
