/**
 * Protocol version negotiation (specification §3.2.6): a request names the
 * version it speaks in `A2A-Version`, and the server rejects a version that
 * no interface of its Agent Card declares.
 *
 * @since 0.1.0
 */
import { Array as Arr, Effect, Option } from 'effect';
import {
  A2A_LEGACY_PROTOCOL_VERSION,
  A2A_PROTOCOL_VERSION,
} from '../Constants.js';
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

interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
}

const parseVersion = (version: string): Option.Option<ParsedVersion> => {
  const trimmed = version.trim();
  if (trimmed === '') return Option.none();
  const [majorText = '', minorText] = trimmed.split('.');
  const major = Number.parseInt(majorText, 10);
  const minor = minorText === undefined ? 0 : Number.parseInt(minorText, 10);
  return Number.isFinite(major) &&
    major >= 0 &&
    Number.isFinite(minor) &&
    minor >= 0
    ? Option.some({ major, minor })
    : Option.none();
};

const compareVersions = (a: ParsedVersion, b: ParsedVersion) =>
  a.major !== b.major ? a.major - b.major : a.minor - b.minor;

/**
 * Tells whether a version is a legacy one: absent or empty, or at least 0.3
 * and below 1.0.
 *
 * @since 0.1.0
 */
export const isLegacyVersion = (version: string | undefined): boolean => {
  if (version === undefined || version.trim() === '') return true;
  const parsed = parseVersion(version);
  const lower = parseVersion(A2A_LEGACY_PROTOCOL_VERSION);
  const upper = parseVersion(A2A_PROTOCOL_VERSION);
  if (Option.isNone(parsed) || Option.isNone(lower) || Option.isNone(upper)) {
    return false;
  }
  return (
    compareVersions(parsed.value, lower.value) >= 0 &&
    compareVersions(parsed.value, upper.value) < 0
  );
};
