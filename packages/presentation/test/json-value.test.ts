import { Schema } from 'effect';
import { describe, expect, it } from '@effect/vitest';

import {
  JsonValueV1Limits,
  JsonValueV1Schema,
  isJsonValueV1,
  isOpaqueIdentifierV1,
  isUtf8StringWithin,
  jsonValueV1Utf8Bytes,
} from '../src/json-value.js';

describe('isJsonValueV1 — accepted values', () => {
  it.each([
    ['null', null],
    ['a boolean', true],
    ['a finite number', 42],
    ['a negative number', -1.5],
    ['zero', 0],
    ['a string', 'hello'],
    ['the empty string', ''],
    ['an empty array', []],
    ['an empty object', {}],
    ['a flat array', [1, 'two', false, null]],
    ['a flat object', { a: 1, b: 'two' }],
    ['a nested structure', { a: [{ b: [1, 2] }] }],
  ])('accepts %s', (_name, value) => {
    expect(isJsonValueV1(value)).toBe(true);
  });
});

describe('isJsonValueV1 — rejected values', () => {
  it.each([
    ['undefined', undefined],
    ['a function', () => 1],
    ['a symbol', Symbol('s')],
    ['a bigint', 1n],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['a Date', new Date(0)],
    ['a Map', new Map()],
    ['a Set', new Set()],
    ['a RegExp', /x/],
  ])('rejects %s', (_name, value) => {
    expect(isJsonValueV1(value)).toBe(false);
  });

  it('rejects an object with a class prototype', () => {
    class Thing {
      readonly a = 1;
    }
    expect(isJsonValueV1(new Thing())).toBe(false);
  });

  it('accepts a null-prototype object, which has no inherited surface at all', () => {
    const value = Object.create(null) as Record<string, unknown>;
    value['a'] = 1;
    expect(isJsonValueV1(value)).toBe(true);
  });

  it('rejects a value nested past the depth limit', () => {
    let deep: unknown = 'leaf';
    for (let index = 0; index <= JsonValueV1Limits.maxDepth; index += 1) {
      deep = { nested: deep };
    }
    expect(isJsonValueV1(deep)).toBe(false);
  });

  it('accepts a value nested exactly to the depth limit', () => {
    let deep: unknown = 'leaf';
    for (let index = 0; index < JsonValueV1Limits.maxDepth - 1; index += 1) {
      deep = { nested: deep };
    }
    expect(isJsonValueV1(deep)).toBe(true);
  });

  it('rejects a value with more entries than the limit allows', () => {
    const many = Object.fromEntries(
      Array.from({ length: JsonValueV1Limits.maxEntries + 1 }, (_, i) => [
        `k${i}`,
        i,
      ])
    );
    expect(isJsonValueV1(many)).toBe(false);
  });

  it('rejects an array longer than the entry limit', () => {
    const many = Array.from(
      { length: JsonValueV1Limits.maxEntries + 1 },
      (_, i) => i
    );
    expect(isJsonValueV1(many)).toBe(false);
  });

  it('rejects a value larger than the byte limit', () => {
    const big = { text: 'x'.repeat(JsonValueV1Limits.maxUtf8Bytes + 1) };
    expect(isJsonValueV1(big)).toBe(false);
  });
});

describe('isJsonValueV1 — hostile input', () => {
  it('rejects a self-referencing object rather than recursing forever', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(isJsonValueV1(cyclic)).toBe(false);
  });

  it('rejects a self-referencing array', () => {
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    expect(isJsonValueV1(cyclic)).toBe(false);
  });

  it('accepts the same object appearing twice on different paths', () => {
    // Shared, not cyclic: the guard tracks the active path, not every object
    // it has ever seen, so a diamond is legitimate JSON.
    const shared = { a: 1 };
    expect(isJsonValueV1({ left: shared, right: shared })).toBe(true);
  });

  it.each(['__proto__', 'prototype', 'constructor'])(
    'rejects an object carrying an own %s key',
    (key) => {
      const value = Object.create(null) as Record<string, unknown>;
      value[key] = 'payload';
      expect(isJsonValueV1(value)).toBe(false);
    }
  );

  it('rejects an object whose property is a getter, without invoking it', () => {
    let invoked = false;
    const value = {
      get trap(): string {
        invoked = true;
        return 'x';
      },
    };
    expect(isJsonValueV1(value)).toBe(false);
    expect(invoked).toBe(false);
  });

  it('rejects an array whose index is a getter, without invoking it', () => {
    let invoked = false;
    const value: unknown[] = [];
    Object.defineProperty(value, '0', {
      enumerable: true,
      get: () => {
        invoked = true;
        return 'x';
      },
    });
    Object.defineProperty(value, 'length', { value: 1 });
    expect(isJsonValueV1(value)).toBe(false);
    expect(invoked).toBe(false);
  });

  it('rejects an array carrying an extra own string key', () => {
    const value: unknown[] = [1, 2];
    Object.defineProperty(value, 'extra', { value: 'x', enumerable: true });
    expect(isJsonValueV1(value)).toBe(false);
  });

  it('rejects an array subclass, whose prototype is not Array.prototype', () => {
    class Sneaky extends Array {}
    const value = new Sneaky();
    value.push(1);
    expect(isJsonValueV1(value)).toBe(false);
  });

  it('rejects an object with a non-enumerable own property', () => {
    const value = {};
    Object.defineProperty(value, 'hidden', { value: 1, enumerable: false });
    expect(isJsonValueV1(value)).toBe(false);
  });

  it('rejects an object with a symbol-keyed own property', () => {
    const value: Record<string | symbol, unknown> = { a: 1 };
    value[Symbol('s')] = 2;
    expect(isJsonValueV1(value)).toBe(false);
  });
});

describe('JsonValueV1Schema', () => {
  it('decodes a value within the bounds', () => {
    expect(
      Schema.decodeUnknownSync(JsonValueV1Schema)({ a: [1, 'two'] })
    ).toEqual({ a: [1, 'two'] });
  });

  it('decodes a bare primitive', () => {
    expect(Schema.decodeUnknownSync(JsonValueV1Schema)('hello')).toBe('hello');
  });

  // ---------------------------------------------------------------------
  // DEFECT D7 — the schema and the guard it is built from disagree.
  //
  // `isJsonValueV1` rejects a Date, a Map and a Set. `JsonValueV1Schema`
  // accepts all three and decodes them to `{}`.
  //
  // The union's `Schema.Record(Schema.String, …)` member matches any object.
  // A Date, Map or Set has no own enumerable string keys, so it decodes to an
  // empty record — and the trailing `Schema.check(isJsonValueV1)` then runs
  // against that already-decoded `{}`, which is perfectly valid JSON. The
  // guard never sees the original value.
  //
  // This module exists to bound "JSON values that may cross a presentation
  // boundary". The schema is what runs at that boundary, so a timestamp
  // crossing it silently becomes an empty object rather than an error.
  // ---------------------------------------------------------------------
  it('DEFECT: decodes a Date to an empty object instead of rejecting it', () => {
    expect(isJsonValueV1(new Date(0))).toBe(false);
    expect(Schema.decodeUnknownSync(JsonValueV1Schema)(new Date(0))).toEqual(
      {}
    );
  });

  it('DEFECT: decodes a Map to an empty object, losing every entry', () => {
    expect(
      Schema.decodeUnknownSync(JsonValueV1Schema)(new Map([['a', 1]]))
    ).toEqual({});
  });

  it('DEFECT: decodes a Set to an empty object, losing every member', () => {
    expect(Schema.decodeUnknownSync(JsonValueV1Schema)(new Set([1]))).toEqual(
      {}
    );
  });

  it('rejects a non-finite number', () => {
    expect(() =>
      Schema.decodeUnknownSync(JsonValueV1Schema)(Number.NaN)
    ).toThrow();
  });

  it('rejects a value past the byte limit', () => {
    expect(() =>
      Schema.decodeUnknownSync(JsonValueV1Schema)({
        text: 'x'.repeat(JsonValueV1Limits.maxUtf8Bytes + 1),
      })
    ).toThrow();
  });
});

describe('jsonValueV1Utf8Bytes', () => {
  it('measures a short string including its JSON quotes', () => {
    expect(jsonValueV1Utf8Bytes('ab')).toBe(4);
  });

  it('measures multi-byte characters by byte, not by character', () => {
    expect(jsonValueV1Utf8Bytes('é')).toBeGreaterThan(3);
  });

  it('measures an empty object as two bytes', () => {
    expect(jsonValueV1Utf8Bytes({})).toBe(2);
  });

  it('measures null as four bytes', () => {
    expect(jsonValueV1Utf8Bytes(null)).toBe(4);
  });
});

describe('isUtf8StringWithin', () => {
  it('accepts a string inside the budget', () => {
    expect(isUtf8StringWithin('abc', 3)).toBe(true);
  });

  it('rejects a string over the budget', () => {
    expect(isUtf8StringWithin('abcd', 3)).toBe(false);
  });

  it('counts bytes rather than characters', () => {
    // '名' is one character but three UTF-8 bytes.
    expect(isUtf8StringWithin('名', 2)).toBe(false);
    expect(isUtf8StringWithin('名', 3)).toBe(true);
  });

  it('rejects a non-string', () => {
    expect(isUtf8StringWithin(42, 100)).toBe(false);
  });

  it('accepts the empty string at a zero budget', () => {
    expect(isUtf8StringWithin('', 0)).toBe(true);
  });
});

describe('isOpaqueIdentifierV1', () => {
  it.each(['a', 'A1', 'a-b', 'a_b', 'x'.repeat(128)])('accepts %s', (value) => {
    expect(isOpaqueIdentifierV1(value)).toBe(true);
  });

  it.each([
    ['the empty string', ''],
    ['a string over 128 characters', 'x'.repeat(129)],
    ['a string with a space', 'a b'],
    ['a string with a dot', 'a.b'],
    ['a string with a slash', 'a/b'],
    ['a non-ASCII string', '名'],
    ['a newline', 'a\nb'],
  ])('rejects %s', (_name, value) => {
    expect(isOpaqueIdentifierV1(value)).toBe(false);
  });

  it('rejects a non-string', () => {
    expect(isOpaqueIdentifierV1(42)).toBe(false);
  });
});
