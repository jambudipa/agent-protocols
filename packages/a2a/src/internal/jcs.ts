/**
 * The JSON Canonicalization Scheme (RFC 8785) for JSON values, written by hand
 * so that the card signature payload is the same bytes on every platform.
 *
 * @internal
 */
import { Predicate, type Schema } from 'effect';

const escapes: { readonly [char: string]: string } = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};

const hex4 = (code: number) => code.toString(16).padStart(4, '0');

/**
 * Serializes a string as RFC 8785 §3.2.2.2 requires: the ECMAScript
 * `JSON.stringify` escapes, with lone surrogates as `\u` escapes.
 */
const serializeString = (value: string): string => {
  let out = '"';
  for (let index = 0; index < value.length; index++) {
    const char = value.charAt(index);
    const code = value.charCodeAt(index);
    const escaped = escapes[char];
    if (escaped !== undefined) {
      out += escaped;
    } else if (code < 0x20) {
      out += `\\u${hex4(code)}`;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += char + value.charAt(index + 1);
        index++;
      } else {
        out += `\\u${hex4(code)}`;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      out += `\\u${hex4(code)}`;
    } else {
      out += char;
    }
  }
  return out + '"';
};

/**
 * Orders property names by their UTF-16 code units (RFC 8785 §3.2.3).
 */
const compareKeys = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/**
 * The RFC 8785 canonical form of a JSON value. An `undefined` member of an
 * object is left out, as `JSON.stringify` leaves it out.
 *
 * @internal
 */
export const canonicalize = (value: Schema.Json): string =>
  canonicalizeUnknown(value);

const canonicalizeUnknown = (value: unknown): string => {
  if (Predicate.isNull(value)) return 'null';
  if (Predicate.isBoolean(value)) return value ? 'true' : 'false';
  if (Predicate.isNumber(value)) {
    // The ECMAScript Number-to-String conversion is the JCS number format.
    return Number.isFinite(value) ? String(value) : 'null';
  }
  if (Predicate.isString(value)) return serializeString(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeUnknown).join(',')}]`;
  }
  if (!Predicate.isObject(value)) return 'null';
  const members = Object.entries(value)
    .filter(([, member]) => member !== undefined)
    .sort(([a], [b]) => compareKeys(a, b))
    .map(
      ([key, member]) =>
        `${serializeString(key)}:${canonicalizeUnknown(member)}`
    );
  return `{${members.join(',')}}`;
};
