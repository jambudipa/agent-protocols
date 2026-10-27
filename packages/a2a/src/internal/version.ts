/**
 * Protocol version comparison, shared by the server and the client.
 *
 * @internal
 */
import { Option } from 'effect';
import {
  A2A_LEGACY_PROTOCOL_VERSION,
  A2A_PROTOCOL_VERSION,
} from '../Constants.js';

/**
 * A protocol version reduced to the two components that the legacy check
 * compares. Any patch component is dropped.
 */
interface ParsedVersion {
  /** A non-negative integer. */
  readonly major: number;
  /** A non-negative integer; 0 when the version names no minor component. */
  readonly minor: number;
}

/**
 * Parses `major[.minor[...]]`. It returns `Option.none()` for an empty or
 * negative version. `Number.parseInt` is lenient, so a trailing suffix such as
 * `1.0-rc` still parses as 1.0.
 */
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

/**
 * Orders two versions by major, then minor. The sign of the result is the
 * order; the magnitude carries no meaning.
 */
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
