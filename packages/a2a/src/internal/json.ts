/**
 * JSON text codecs. Every JSON text that this package reads or writes goes
 * through a schema, never through `JSON.parse` or `JSON.stringify`.
 *
 * @internal
 */
import { Schema } from 'effect';

const JsonText = Schema.fromJsonString(Schema.Json);

/**
 * Renders a JSON value as JSON text. It cannot fail.
 *
 * @internal
 */
export const stringifyJson: (value: Schema.Json) => string =
  Schema.encodeSync(JsonText);

/**
 * Parses JSON text into a JSON value.
 *
 * @internal
 */
export const parseJson = Schema.decodeUnknownEffect(JsonText);

/**
 * Parses JSON text into a JSON value, or `Option.none()` when it is not JSON.
 *
 * @internal
 */
export const parseJsonOption = Schema.decodeUnknownOption(JsonText);
