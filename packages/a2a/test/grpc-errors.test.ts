/**
 * The gRPC mapping of the A2A errors.
 */
import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import {
  GRPC_STATUS_CODE,
  GRPC_STATUS_DETAILS_BIN,
  decodeErrorInfo,
  decodeStatus,
  fromGrpcError,
  grpcStatusFor,
  statusDetailsFor,
} from '../src/errors/grpc/index.js';
import {
  A2ATransportError,
  ContentTypeNotSupportedError,
  InternalError,
  InvalidAgentResponseError,
  RequestMalformedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  VersionNotSupportedError,
} from '../src/errors/index.js';

const metadataWith = (bytes: Uint8Array) => ({
  get: (key: string) => (key === GRPC_STATUS_DETAILS_BIN ? [bytes] : []),
});

describe('gRPC error mapping', () => {
  it('maps each error to the status of the reference SDK', () => {
    expect(grpcStatusFor(new TaskNotFoundError({}))).toBe(
      GRPC_STATUS_CODE.NOT_FOUND
    );
    expect(grpcStatusFor(new ContentTypeNotSupportedError({}))).toBe(
      GRPC_STATUS_CODE.INVALID_ARGUMENT
    );
    expect(grpcStatusFor(new RequestMalformedError({}))).toBe(
      GRPC_STATUS_CODE.INVALID_ARGUMENT
    );
    expect(grpcStatusFor(new InvalidAgentResponseError({}))).toBe(
      GRPC_STATUS_CODE.INTERNAL
    );
    expect(grpcStatusFor(new TaskNotCancelableError({}))).toBe(
      GRPC_STATUS_CODE.FAILED_PRECONDITION
    );
    expect(grpcStatusFor(new VersionNotSupportedError({}))).toBe(
      GRPC_STATUS_CODE.FAILED_PRECONDITION
    );
    expect(grpcStatusFor(new InternalError({}))).toBe(GRPC_STATUS_CODE.UNKNOWN);
  });

  it('encodes a google.rpc.Status with an ErrorInfo detail', () => {
    const details = statusDetailsFor(
      new TaskNotFoundError({ message: 'gone', metadata: { taskId: 't-1' } })
    );
    expect(Option.isSome(details)).toBe(true);
    if (Option.isNone(details)) return;
    const status = decodeStatus(details.value);
    expect(status.code).toBe(GRPC_STATUS_CODE.NOT_FOUND);
    expect(status.message).toBe('gone');
    expect(status.details[0]?.typeUrl).toBe(
      'type.googleapis.com/google.rpc.ErrorInfo'
    );
    const info = decodeErrorInfo(status.details[0]?.value ?? new Uint8Array());
    expect(info.reason).toBe('TASK_NOT_FOUND');
    expect(info.domain).toBe('a2a-protocol.org');
    expect(info.metadata).toEqual({ taskId: 't-1' });
    expect(Option.isNone(statusDetailsFor(new InternalError({})))).toBe(true);
  });

  it('decodes the trailer back into the A2A error', () => {
    const bytes = Option.getOrThrow(
      statusDetailsFor(
        new TaskNotFoundError({ message: 'gone', metadata: { taskId: 't-1' } })
      )
    );
    const error = fromGrpcError({
      code: GRPC_STATUS_CODE.NOT_FOUND,
      details: 'gone',
      metadata: metadataWith(bytes),
    });
    expect(error).toBeInstanceOf(TaskNotFoundError);
    expect(error.message).toBe('gone');
    if (error instanceof TaskNotFoundError) {
      expect(error.metadata).toEqual({ taskId: 't-1' });
    }
  });

  it('keeps a status without details as a transport error', () => {
    const error = fromGrpcError(
      { code: GRPC_STATUS_CODE.UNAVAILABLE, details: 'down' },
      'GetTask'
    );
    expect(error).toBeInstanceOf(A2ATransportError);
    if (error instanceof A2ATransportError) {
      expect(error.code).toBe(GRPC_STATUS_CODE.UNAVAILABLE);
    }
    expect(error.message).toBe('gRPC error for GetTask: 14 down');
  });
});
