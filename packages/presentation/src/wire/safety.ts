/** Inert data checks for the browser boundary. No Effect or host imports belong here. */
export interface JsonBounds {
  readonly maxDepth: number;
  readonly maxEntries: number;
  readonly maxUtf8Bytes: number;
}

/** Additional consumer budget, separate from the normative V1 grammar. */
export const InertConsumerLimits = Object.freeze({
  maxDepth: 64,
  maxEntries: 20_000,
  maxUtf8Bytes: 1024 * 1024,
});

const encoder = new TextEncoder();

/** Accept only plain records with enumerable string data properties. */
export const isDataRecord = (
  value: unknown
): value is Readonly<Record<string, unknown>> => {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
    );
  });
};

/** Check keys before callers read fields. */
export const hasExactKeys = (
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): value is Readonly<Record<string, unknown>> =>
  isDataRecord(value) &&
  required.every((key) => Object.hasOwn(value, key)) &&
  Object.keys(value).every(
    (key) => required.includes(key) || optional.includes(key)
  );

/** Optional means absent, never an explicit undefined value. */
export const hasOptionalField = (
  value: Readonly<Record<string, unknown>>,
  key: string,
  check: (value: unknown) => boolean
): boolean => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return (
    descriptor === undefined ||
    (Object.hasOwn(descriptor, 'value') && check(descriptor.value))
  );
};

export const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Measure only primitive strings with JSON.stringify; never invoke object toJSON hooks. */
const stringBytes = (value: string, maximum: number): number =>
  value.length > maximum
    ? Infinity
    : encoder.encode(JSON.stringify(value)).byteLength;

/** Validate shape, depth, entries and bytes in one bounded traversal. */
export const measureInertJson = (
  value: unknown,
  bounds: JsonBounds,
  forbidPrototypeKeys = false
): number => {
  let entries = 0;
  let bytes = 0;
  const active = new Set<object>();
  const add = (count: number): boolean => {
    bytes += count;
    return bytes <= bounds.maxUtf8Bytes;
  };
  const visit = (candidate: unknown, depth: number): boolean => {
    if (depth > bounds.maxDepth) return false;
    if (candidate === null) return add(4);
    if (typeof candidate === 'boolean') return add(candidate ? 4 : 5);
    if (typeof candidate === 'number')
      return Number.isFinite(candidate) && add(String(candidate).length);
    if (typeof candidate === 'string')
      return add(stringBytes(candidate, bounds.maxUtf8Bytes - bytes));
    if (typeof candidate !== 'object' || active.has(candidate)) return false;
    active.add(candidate);
    if (Array.isArray(candidate)) {
      if (Object.getPrototypeOf(candidate) !== Array.prototype) return false;
      const lengthDescriptor = Object.getOwnPropertyDescriptor(
        candidate,
        'length'
      );
      const length: unknown = lengthDescriptor?.value;
      if (
        !isNonNegativeSafeInteger(length) ||
        length > bounds.maxEntries - entries ||
        Reflect.ownKeys(candidate).length !== length + 1 ||
        !add(2 + Math.max(0, length - 1))
      )
        return false;
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          candidate,
          String(index)
        );
        if (
          descriptor?.enumerable !== true ||
          !Object.hasOwn(descriptor, 'value')
        )
          return false;
        entries += 1;
        if (entries > bounds.maxEntries) return false;
        if (!visit(descriptor.value, depth + 1)) return false;
      }
    } else {
      if (!isDataRecord(candidate)) return false;
      const keys = Object.keys(candidate);
      if (
        keys.length > bounds.maxEntries - entries ||
        !add(2 + Math.max(0, keys.length - 1))
      )
        return false;
      for (const key of keys) {
        if (
          forbidPrototypeKeys &&
          ['__proto__', 'prototype', 'constructor'].includes(key)
        )
          return false;
        entries += 1;
        if (
          entries > bounds.maxEntries ||
          !add(stringBytes(key, bounds.maxUtf8Bytes - bytes) + 1) ||
          !visit(
            Object.getOwnPropertyDescriptor(candidate, key)?.value,
            depth + 1
          )
        )
          return false;
      }
    }
    active.delete(candidate);
    return true;
  };
  // A revoked or throwing Proxy declines. Proxy traps are executable JavaScript,
  // not wire data; callers must deserialize JSON before crossing a trust boundary.
  try {
    return visit(value, 0) ? bytes : Infinity;
  } catch {
    return Infinity;
  }
};

export const isInertPresentationValue = (value: unknown): boolean =>
  Number.isFinite(measureInertJson(value, InertConsumerLimits));

/** Return Infinity for invalid or over-budget input. */
export const inertJsonUtf8Bytes = (
  value: unknown,
  maximumBytes: number
): number =>
  measureInertJson(value, {
    ...InertConsumerLimits,
    maxUtf8Bytes: maximumBytes,
  });
