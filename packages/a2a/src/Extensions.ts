/**
 * Helpers for the `A2A-Extensions` service parameter: a comma separated list
 * of extension URIs.
 *
 * @since 0.1.0
 */
import { Array as Arr, String as Str } from 'effect';

/**
 * A list of extension URIs.
 *
 * @since 0.1.0
 */
export type Extensions = ReadonlyArray<string>;

/**
 * Parses the comma separated `A2A-Extensions` value. Blank entries are
 * dropped and repeated entries kept once, in first-seen order.
 *
 * @since 0.1.0
 */
export const parseServiceParameter = (value: string | undefined): Extensions =>
  value === undefined
    ? []
    : Arr.dedupe(
        value
          .split(',')
          .map(Str.trim)
          .filter((uri) => uri.length > 0)
      );

/**
 * Renders extension URIs as an `A2A-Extensions` value.
 *
 * @since 0.1.0
 */
export const toServiceParameter = (extensions: Extensions): string =>
  extensions.join(',');

/**
 * Adds `uri` to `current` unless it is already present.
 *
 * @since 0.1.0
 */
export const createFrom = (current: Extensions, uri: string): Extensions =>
  current.includes(uri) ? current : [...current, uri];
