/**
 * The gRPC mapping of the A2A errors (specification §10.6): the status code
 * of each error and the `grpc-status-details-bin` trailer, a binary
 * `google.rpc.Status` whose details hold a `google.rpc.ErrorInfo`.
 *
 * The status codes follow `@a2a-js/sdk` 1.3.0. This module loads
 * `@bufbuild/protobuf` but not `@grpc/grpc-js`: it reads and writes gRPC
 * metadata through a structural type.
 *
 * @since 0.1.0
 */
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { anyPack, anyUnpack } from '@bufbuild/protobuf/wkt';
import { Option, Predicate } from 'effect';
import {
  type ErrorInfo as ErrorInfoMessage,
  ErrorInfoSchema,
} from '../../generated/google/rpc/error_details_pb.js';
import {
  type Status,
  StatusSchema,
} from '../../generated/google/rpc/status_pb.js';
import {
  A2A_ERROR_DOMAIN,
  A2A_ERROR_SPECS,
  type A2AError,
  type A2AErrorName,
  A2ATransportError,
  type ServerError,
  makeA2AError,
  specByReason,
} from '../index.js';

/**
 * The gRPC metadata key of the binary `google.rpc.Status`.
 *
 * @since 0.1.0
 */
export const GRPC_STATUS_DETAILS_BIN = 'grpc-status-details-bin';

/**
 * The gRPC status codes.
 *
 * @since 0.1.0
 */
export const GRPC_STATUS_CODE = {
  OK: 0,
  CANCELLED: 1,
  UNKNOWN: 2,
  INVALID_ARGUMENT: 3,
  DEADLINE_EXCEEDED: 4,
  NOT_FOUND: 5,
  ALREADY_EXISTS: 6,
  PERMISSION_DENIED: 7,
  RESOURCE_EXHAUSTED: 8,
  FAILED_PRECONDITION: 9,
  ABORTED: 10,
  OUT_OF_RANGE: 11,
  UNIMPLEMENTED: 12,
  INTERNAL: 13,
  UNAVAILABLE: 14,
  DATA_LOSS: 15,
  UNAUTHENTICATED: 16,
} as const;

/**
 * The gRPC status of each A2A error.
 *
 * @since 0.1.0
 */
export const GRPC_ERROR_STATUS: { readonly [K in A2AErrorName]: number } = {
  TaskNotFoundError: GRPC_STATUS_CODE.NOT_FOUND,
  TaskNotCancelableError: GRPC_STATUS_CODE.FAILED_PRECONDITION,
  PushNotificationNotSupportedError: GRPC_STATUS_CODE.FAILED_PRECONDITION,
  UnsupportedOperationError: GRPC_STATUS_CODE.FAILED_PRECONDITION,
  ContentTypeNotSupportedError: GRPC_STATUS_CODE.INVALID_ARGUMENT,
  InvalidAgentResponseError: GRPC_STATUS_CODE.INTERNAL,
  ExtendedAgentCardNotConfiguredError: GRPC_STATUS_CODE.FAILED_PRECONDITION,
  ExtensionSupportRequiredError: GRPC_STATUS_CODE.FAILED_PRECONDITION,
  VersionNotSupportedError: GRPC_STATUS_CODE.FAILED_PRECONDITION,
  RequestMalformedError: GRPC_STATUS_CODE.INVALID_ARGUMENT,
};

/**
 * The gRPC status of a server failure: the table value of an A2A error, and
 * `UNKNOWN` for any other failure.
 *
 * @since 0.1.0
 */
export const grpcStatusFor = (error: ServerError): number =>
  error._tag === 'InternalError'
    ? GRPC_STATUS_CODE.UNKNOWN
    : GRPC_ERROR_STATUS[error._tag];

/**
 * Encodes the binary `google.rpc.Status` of an A2A error: the status code,
 * the message and one `ErrorInfo` detail.
 *
 * @since 0.1.0
 */
export const encodeGrpcStatusDetails = (
  status: number,
  message: string,
  reason: string,
  metadata?: { readonly [key: string]: string }
): Uint8Array => {
  const info = create(ErrorInfoSchema, {
    reason,
    domain: A2A_ERROR_DOMAIN,
    metadata: { ...metadata },
  });
  return toBinary(
    StatusSchema,
    create(StatusSchema, {
      code: status,
      message,
      details: [anyPack(ErrorInfoSchema, info)],
    })
  );
};

/**
 * Decodes a binary `google.rpc.Status`.
 *
 * @since 0.1.0
 */
export const decodeStatus = (bytes: Uint8Array): Status =>
  fromBinary(StatusSchema, bytes);

/**
 * Decodes a binary `google.rpc.ErrorInfo`.
 *
 * @since 0.1.0
 */
export const decodeErrorInfo = (bytes: Uint8Array): ErrorInfoMessage =>
  fromBinary(ErrorInfoSchema, bytes);

/**
 * The trailer value of an A2A error, or `Option.none()` for a failure that
 * is not an A2A error.
 *
 * @since 0.1.0
 */
export const statusDetailsFor = (
  error: ServerError
): Option.Option<Uint8Array> =>
  error._tag === 'InternalError'
    ? Option.none()
    : Option.some(
        encodeGrpcStatusDetails(
          grpcStatusFor(error),
          error.message,
          A2A_ERROR_SPECS[error._tag].reason,
          error.metadata
        )
      );

/**
 * The metadata of a gRPC call, as `@grpc/grpc-js` exposes it.
 *
 * @since 0.1.0
 */
export interface GrpcMetadataLike {
  readonly get: (key: string) => ReadonlyArray<string | Uint8Array>;
}

/**
 * A failed gRPC call, as `@grpc/grpc-js` reports it.
 *
 * @since 0.1.0
 */
export interface GrpcServiceErrorLike {
  readonly code?: number | undefined;
  readonly details?: string | undefined;
  readonly metadata?: GrpcMetadataLike | undefined;
}

/** A binary metadata value that arrives as a string holds one byte per char. */
const toBytes = (value: string | Uint8Array): Uint8Array =>
  Predicate.isString(value)
    ? Uint8Array.from(value, (char) => char.charCodeAt(0))
    : value;

const a2aErrorOfDetails = (
  bytes: Uint8Array,
  message: string
): Option.Option<A2AError> => {
  const status = Option.liftThrowable(decodeStatus)(bytes);
  if (Option.isNone(status)) return Option.none();
  for (const detail of status.value.details) {
    const info = Option.liftThrowable(() =>
      anyUnpack(detail, ErrorInfoSchema)
    )().pipe(Option.flatMap(Option.fromUndefinedOr));
    if (Option.isNone(info)) continue;
    const spec = specByReason(info.value.reason);
    if (Option.isNone(spec)) continue;
    const text = message === '' ? status.value.message : message;
    return Option.some(
      info.value.domain === A2A_ERROR_DOMAIN &&
        Object.keys(info.value.metadata).length > 0
        ? makeA2AError(spec.value.name, text, info.value.metadata)
        : makeA2AError(spec.value.name, text)
    );
  }
  return Option.none();
};

/**
 * The client-side error of a failed gRPC call: the A2A error that its
 * `grpc-status-details-bin` trailer names, else an `A2ATransportError` with
 * the gRPC status as `code`.
 *
 * @since 0.1.0
 */
export const fromGrpcError = (
  error: GrpcServiceErrorLike,
  method?: string
): A2AError | A2ATransportError => {
  const message = error.details ?? '';
  const trailer = Option.fromUndefinedOr(
    error.metadata?.get(GRPC_STATUS_DETAILS_BIN)[0]
  );
  const known = Option.flatMap(trailer, (value) =>
    a2aErrorOfDetails(toBytes(value), message)
  );
  if (Option.isSome(known)) return known.value;
  const code = error.code ?? GRPC_STATUS_CODE.UNKNOWN;
  const suffix = method === undefined ? '' : ` for ${method}`;
  return new A2ATransportError({
    message: `gRPC error${suffix}: ${code} ${message}`.trim(),
    protocol: 'GRPC',
    code,
  });
};
