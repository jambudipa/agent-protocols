/**
 * Protocol version negotiation (specification §3.2.6): a request names the
 * version it speaks in `A2A-Version`, and the server rejects a version that
 * no interface of its Agent Card declares.
 *
 * @since 0.1.0
 */
import { Array as Arr, Effect } from 'effect';
import { VersionNotSupportedError } from '../errors/index.js';
import type { AgentCard } from '../Types.js';

/**
 * The protocol versions that the card declares, for one binding or for all.
 *
 * @since 0.1.0
 */
export const getSupportedVersions = (
  agentCard: AgentCard,
  protocolBinding?: string
): ReadonlyArray<string> =>
  Arr.dedupe(
    agentCard.supportedInterfaces
      .filter(
        (agentInterface) =>
          protocolBinding === undefined ||
          agentInterface.protocolBinding === protocolBinding
      )
      .map((agentInterface) => agentInterface.protocolVersion)
      .filter((version) => version !== '')
  );

/**
 * Fails with `VersionNotSupportedError` unless the card declares the
 * requested version for the binding.
 *
 * @since 0.1.0
 */
export const validateVersion = (
  requestedVersion: string,
  agentCard: AgentCard,
  protocolBinding?: string
): Effect.Effect<void, VersionNotSupportedError> => {
  const supported = getSupportedVersions(agentCard, protocolBinding);
  return supported.includes(requestedVersion)
    ? Effect.void
    : Effect.fail(
        new VersionNotSupportedError({
          message: `The requested A2A protocol version '${requestedVersion}' is not supported. Supported versions: ${supported.join(', ')}`,
        })
      );
};

export { isLegacyVersion } from '../internal/version.js';
