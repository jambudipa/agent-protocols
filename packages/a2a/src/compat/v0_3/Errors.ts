/**
 * The error shape of the v0.3 bindings: a JSON-RPC error object
 * `{ code, message, data? }`, which the v0.3 HTTP+JSON binding also uses as
 * its error body.
 *
 * @since 0.1.0
 */
import { Option } from 'effect';
import {
  A2A_ERROR_CODE,
  A2A_ERROR_SPECS,
  A2ATransportError,
  type ClientError,
  JsonRpcErrorObject,
  type ServerError,
  makeA2AError,
  restStatusFor,
  specByJsonRpcCode,
} from '../../errors/index.js';

/**
 * The v0.3 error body.
 *
 * @since 0.1.0
 */
export const LegacyErrorBody = JsonRpcErrorObject;

/**
 * @since 0.1.0
 */
export type LegacyErrorBody = JsonRpcErrorObject;

/**
 * The v0.3 error body of a server failure. Unlike v1.0, it carries no
 * `ErrorInfo` in `data`.
 *
 * @since 0.1.0
 */
export const toLegacyErrorBody = (error: ServerError): LegacyErrorBody => ({
  code:
    error._tag === 'InternalError'
      ? A2A_ERROR_CODE.INTERNAL_ERROR
      : A2A_ERROR_SPECS[error._tag].jsonRpcCode,
  message: error.message,
});

/**
 * The HTTP status of a server failure in the v0.3 HTTP+JSON binding.
 *
 * @since 0.1.0
 */
export const legacyHttpStatusFor = (error: ServerError): number =>
  restStatusFor(error);

/**
 * The HTTP statuses of the reserved JSON-RPC codes in the v0.3 HTTP+JSON
 * binding.
 *
 * @since 0.1.0
 */
export const LEGACY_CODE_TO_HTTP_STATUS: { readonly [code: number]: number } = {
  [A2A_ERROR_CODE.PARSE_ERROR]: 400,
  [A2A_ERROR_CODE.INVALID_REQUEST]: 400,
  [A2A_ERROR_CODE.METHOD_NOT_FOUND]: 501,
  [A2A_ERROR_CODE.INVALID_PARAMS]: 400,
  [A2A_ERROR_CODE.INTERNAL_ERROR]: 500,
};

/**
 * The client error of a v0.3 error body: the A2A error that its code names,
 * else a transport error.
 *
 * @since 0.1.0
 */
export const fromLegacyErrorBody = (
  body: LegacyErrorBody,
  protocol: string,
  status?: number
): ClientError =>
  Option.match(specByJsonRpcCode(body.code), {
    onNone: (): ClientError =>
      new A2ATransportError({
        message: `REST error: ${body.message} (Code: ${body.code})`,
        protocol,
        code: status ?? body.code,
        ...(body.data === undefined ? {} : { data: body.data }),
      }),
    onSome: (spec): ClientError => makeA2AError(spec.name, body.message),
  });
