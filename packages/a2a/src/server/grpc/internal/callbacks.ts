/**
 * The two calls of the `@grpc/grpc-js` unary callback contract. grpc-js
 * reads a `null` error as success, so this is the one place of the binding
 * that writes `null`; the lint configuration scopes that exception to this
 * file.
 *
 * @internal
 */
import type { sendUnaryData, StatusObject } from '@grpc/grpc-js';

/**
 * Completes a unary call with its response.
 *
 * @internal
 */
export const respondUnary = <Response>(
  callback: sendUnaryData<Response>,
  value: Response
): void => callback(null, value);

/**
 * Completes a unary call with an error status.
 *
 * @internal
 */
export const failUnary = <Response>(
  callback: sendUnaryData<Response>,
  status: Partial<StatusObject>
): void => callback(status);
