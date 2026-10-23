/**
 * The conversion between the Effect schemas of `@jambudipa/a2a` and the
 * protobuf-es messages of the gRPC binding, and the `@grpc/grpc-js` service
 * definition of a protobuf-es service.
 *
 * There is no second hand-written codec: a value encodes to its ProtoJSON
 * form with its schema, and protobuf-es reads that JSON (`fromJson`); a
 * message is written as ProtoJSON by protobuf-es (`toJson`) and the schema
 * decodes it.
 *
 * @since 0.1.0
 */
import {
  type DescMessage,
  type DescService,
  type JsonValue,
  type MessageShape,
  fromBinary,
  fromJson,
  toBinary,
  toJson,
} from '@bufbuild/protobuf';
import type { ServiceDefinition } from '@grpc/grpc-js';
import { Effect, Schema } from 'effect';
import * as pb from '../../generated/v1/a2a_pb.js';
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
} from '../../Types.js';

/**
 * A value did not convert between its schema and its protobuf message.
 *
 * @since 0.1.0
 */
export class GrpcConversionError extends Schema.TaggedError<GrpcConversionError>()(
  'GrpcConversionError',
  { message: Schema.String }
) {}

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Converts a value to the protobuf message of `desc`, through its ProtoJSON
 * form.
 *
 * @since 0.1.0
 */
export const toProto =
  <T, E, Desc extends DescMessage>(schema: Schema.Codec<T, E>, desc: Desc) =>
  (value: T): Effect.Effect<MessageShape<Desc>, GrpcConversionError> =>
    Schema.encodeEffect(schema)(value).pipe(
      Effect.mapError(
        (error) => new GrpcConversionError({ message: error.message })
      ),
      Effect.flatMap((json) =>
        Effect.try({
          // The schemas encode to ProtoJSON, which is a protobuf-es JsonValue.
          try: () =>
            fromJson(desc, json as JsonValue, { ignoreUnknownFields: true }),
          catch: (cause) =>
            new GrpcConversionError({ message: messageOf(cause) }),
        })
      )
    );

/**
 * Converts a protobuf message of `desc` to a value of the schema, through
 * its ProtoJSON form.
 *
 * @since 0.1.0
 */
export const fromProto =
  <T, E, Desc extends DescMessage>(schema: Schema.Codec<T, E>, desc: Desc) =>
  (message: MessageShape<Desc>): Effect.Effect<T, GrpcConversionError> =>
    Effect.try({
      try: () => toJson(desc, message),
      catch: (cause) => new GrpcConversionError({ message: messageOf(cause) }),
    }).pipe(
      Effect.flatMap((json) =>
        Schema.decodeUnknownEffect(schema)(json).pipe(
          Effect.mapError(
            (error) => new GrpcConversionError({ message: error.message })
          )
        )
      )
    );

const toBuffer = (bytes: Uint8Array): Buffer =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/**
 * The `@grpc/grpc-js` service definition of a protobuf-es service. Each
 * method is keyed by its lower camel case name and (de)serializes the
 * protobuf-es messages of the service.
 *
 * @since 0.1.0
 */
export const makeServiceDefinition = (
  service: DescService
): ServiceDefinition =>
  Object.fromEntries(
    service.methods.map((method) => [
      method.localName,
      {
        path: `/${service.typeName}/${method.name}`,
        requestStream:
          method.methodKind === 'client_streaming' ||
          method.methodKind === 'bidi_streaming',
        responseStream:
          method.methodKind === 'server_streaming' ||
          method.methodKind === 'bidi_streaming',
        requestSerialize: (value: MessageShape<DescMessage>) =>
          toBuffer(toBinary(method.input, value)),
        requestDeserialize: (bytes: Buffer) => fromBinary(method.input, bytes),
        responseSerialize: (value: MessageShape<DescMessage>) =>
          toBuffer(toBinary(method.output, value)),
        responseDeserialize: (bytes: Buffer) =>
          fromBinary(method.output, bytes),
        originalName: method.localName,
      },
    ])
  );

/**
 * The empty message, `google.protobuf.Empty`.
 *
 * @since 0.1.0
 */
export const Empty = Schema.Struct({}).annotate({ identifier: 'Empty' });

/**
 * The schema and the protobuf message of the request and the response of
 * each method of `lf.a2a.v1.A2AService`.
 *
 * @since 0.1.0
 */
export const A2AMethods = {
  sendMessage: {
    request: [SendMessageRequest, pb.SendMessageRequestSchema],
    response: [SendMessageResponse, pb.SendMessageResponseSchema],
  },
  sendStreamingMessage: {
    request: [SendMessageRequest, pb.SendMessageRequestSchema],
    response: [StreamResponse, pb.StreamResponseSchema],
  },
  getTask: {
    request: [GetTaskRequest, pb.GetTaskRequestSchema],
    response: [Task, pb.TaskSchema],
  },
  listTasks: {
    request: [ListTasksRequest, pb.ListTasksRequestSchema],
    response: [ListTasksResponse, pb.ListTasksResponseSchema],
  },
  cancelTask: {
    request: [CancelTaskRequest, pb.CancelTaskRequestSchema],
    response: [Task, pb.TaskSchema],
  },
  subscribeToTask: {
    request: [SubscribeToTaskRequest, pb.SubscribeToTaskRequestSchema],
    response: [StreamResponse, pb.StreamResponseSchema],
  },
  createTaskPushNotificationConfig: {
    request: [TaskPushNotificationConfig, pb.TaskPushNotificationConfigSchema],
    response: [TaskPushNotificationConfig, pb.TaskPushNotificationConfigSchema],
  },
  getTaskPushNotificationConfig: {
    request: [
      GetTaskPushNotificationConfigRequest,
      pb.GetTaskPushNotificationConfigRequestSchema,
    ],
    response: [TaskPushNotificationConfig, pb.TaskPushNotificationConfigSchema],
  },
  listTaskPushNotificationConfigs: {
    request: [
      ListTaskPushNotificationConfigsRequest,
      pb.ListTaskPushNotificationConfigsRequestSchema,
    ],
    response: [
      ListTaskPushNotificationConfigsResponse,
      pb.ListTaskPushNotificationConfigsResponseSchema,
    ],
  },
  getExtendedAgentCard: {
    request: [
      GetExtendedAgentCardRequest,
      pb.GetExtendedAgentCardRequestSchema,
    ],
    response: [AgentCard, pb.AgentCardSchema],
  },
  deleteTaskPushNotificationConfig: {
    request: [
      DeleteTaskPushNotificationConfigRequest,
      pb.DeleteTaskPushNotificationConfigRequestSchema,
    ],
    response: [
      Empty,
      pb.A2AService.method.deleteTaskPushNotificationConfig.output,
    ],
  },
} as const;

/**
 * The gRPC path of a method of `lf.a2a.v1.A2AService`.
 *
 * @since 0.1.0
 */
export const methodPath = (method: keyof typeof A2AMethods): string =>
  `/${pb.A2AService.typeName}/${pb.A2AService.method[method].name}`;
