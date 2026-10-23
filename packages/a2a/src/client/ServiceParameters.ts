/**
 * Service parameters: the headers (or gRPC metadata) of a client call.
 *
 * @since 0.1.0
 */
import { A2A_VERSION_HEADER, HTTP_EXTENSION_HEADER } from '../Constants.js';
import * as Extensions from '../Extensions.js';
import type { ServiceParameters as Parameters } from './Transport.js';

/**
 * A change to service parameters.
 *
 * @since 0.1.0
 */
export type ServiceParametersUpdate = (parameters: Parameters) => Parameters;

/**
 * Service parameters: the headers of a call.
 *
 * @since 0.1.0
 */
export type ServiceParameters = Parameters;

/**
 * Builders of service parameters.
 *
 * @since 0.1.0
 */
export const ServiceParameters = {
  /** Builds parameters from updates. */
  create: (...updates: ReadonlyArray<ServiceParametersUpdate>): Parameters =>
    ServiceParameters.createFrom({}, ...updates),
  /** Builds parameters from existing ones and updates. */
  createFrom: (
    parameters: Parameters | undefined,
    ...updates: ReadonlyArray<ServiceParametersUpdate>
  ): Parameters =>
    updates.reduce(
      (current, update) => update(current),
      parameters ?? ({} as Parameters)
    ),
};

/**
 * Requests extensions, in `A2A-Extensions`.
 *
 * @since 0.1.0
 */
export const withA2AExtensions =
  (...extensions: Extensions.Extensions): ServiceParametersUpdate =>
  (parameters) => ({
    ...parameters,
    [HTTP_EXTENSION_HEADER]: Extensions.toServiceParameter(extensions),
  });

/**
 * Sets the protocol version, in `A2A-Version`.
 *
 * @since 0.1.0
 */
export const withA2AVersion =
  (version: string): ServiceParametersUpdate =>
  (parameters) => ({ ...parameters, [A2A_VERSION_HEADER]: version });
