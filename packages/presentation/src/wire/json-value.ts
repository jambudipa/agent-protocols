/** Bounded JSON vocabulary ported from jam-flow; see PROVENANCE.md. */
import { measureInertJson } from './safety.js';

export const JsonValueV1Limits = Object.freeze({
  maxDepth: 16,
  maxEntries: 1_000,
  maxUtf8Bytes: 64 * 1024,
});
export type JsonPrimitiveV1 = null | boolean | number | string;
export type JsonArrayV1 = readonly JsonValueV1[];
export interface JsonObjectV1 {
  readonly [key: string]: JsonValueV1;
}
export type JsonValueV1 = JsonPrimitiveV1 | JsonArrayV1 | JsonObjectV1;

/** Validate the exact source JSON budget before a consumer reads values. */
export const isJsonValueV1 = (value: unknown): value is JsonValueV1 =>
  Number.isFinite(measureInertJson(value, JsonValueV1Limits, true));

/** Measure admissible JSON. Invalid or over-budget values return Infinity. */
export const jsonValueV1Utf8Bytes = (value: JsonValueV1): number =>
  measureInertJson(value, JsonValueV1Limits, true);

/** Count raw text UTF-8 bytes, as the source wire grammar requires. */
export const isUtf8StringWithin = (
  value: unknown,
  maximumBytes: number
): value is string =>
  typeof value === 'string' &&
  value.length <= maximumBytes &&
  new TextEncoder().encode(value).byteLength <= maximumBytes;

export const isOpaqueIdentifierV1 = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
