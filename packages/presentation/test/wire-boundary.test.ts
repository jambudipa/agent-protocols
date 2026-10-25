import { describe, expect, it } from 'vitest';
import { Schema } from 'effect';
import {
  isJsonValueV1,
  jsonValueV1Utf8Bytes,
  JsonValueV1Limits,
  isPresentationMessageV1,
  isPresentationRecordV1,
  isUserInteractionRequestV1,
  isUserInteractionResponseV1,
  isPresentationCapabilitiesV1,
  downgradePresentationMessageV1,
  PresentationMessageV1Kinds,
  UserInteractionV1Limits,
} from '../src/wire/index.js';
import {
  JsonValueV1Schema,
  PresentationMessageV1Schema,
  PresentationRecordV1Schema,
  UserInteractionRequestV1Schema,
  UserInteractionResponseV1Schema,
  PresentationCapabilitiesV1Schema,
} from '../src/schema.js';

const text = { version: '1', kind: 'text', text: 'hello' } as const;
const card = { version: '1', kind: 'card', title: 't', body: 'b' } as const;
const group = (children: readonly unknown[]): unknown => ({
  version: '1',
  kind: 'group',
  label: 'g',
  children,
});
const capabilities = (messageKinds: readonly string[]): unknown => ({
  version: '1',
  messageKinds,
});
const request = {
  version: '1',
  requestId: 'req-1',
  executionId: 'exec-1',
  turnId: 'turn-1',
  revision: 0,
  createdAtEpochMs: 1_000,
  expiresAtEpochMs: 1_000 + UserInteractionV1Limits.defaultLifetimeMs,
  kind: 'text',
} as const;
const response = {
  version: '1',
  requestId: 'req-1',
  executionId: 'exec-1',
  turnId: 'turn-1',
  revision: 0,
  kind: 'text',
  value: 'hello',
} as const;
const record = {
  version: '1',
  messageId: 'msg-1',
  executionId: 'exec-1',
  sequence: 1,
  atEpochMs: 0,
  message: text,
} as const;

// Independent source fixtures: upstream presentation-projection.test.ts.
describe('source capability fallback', () => {
  it('preserves supported readable content recursively', () => {
    expect(
      downgradePresentationMessageV1(
        group([group([text, card])]),
        capabilities(['group', 'text'])
      )
    ).toEqual(group([group([text])]));
  });
  it('silences unsupported messages and unsupported group containers', () => {
    expect(
      downgradePresentationMessageV1(card, capabilities(['text']))
    ).toBeUndefined();
    expect(
      downgradePresentationMessageV1(group([text]), capabilities(['text']))
    ).toBeUndefined();
  });
  it('silences newly empty groups and preserves originally empty groups', () => {
    expect(
      downgradePresentationMessageV1(group([card]), capabilities(['group']))
    ).toBeUndefined();
    expect(
      downgradePresentationMessageV1(group([]), capabilities(['group']))
    ).toEqual(group([]));
  });
  it.each([
    capabilities(['wizard']),
    capabilities(['text', 'text']),
    { version: '2', messageKinds: ['text'] },
    { version: '1', messageKinds: ['text'], extra: true },
  ])('rejects invalid declarations %j', (value) => {
    expect(isPresentationCapabilitiesV1(value)).toBe(false);
    expect(downgradePresentationMessageV1(text, value)).toBeUndefined();
  });
  it('accepts empty and complete declarations', () => {
    expect(isPresentationCapabilitiesV1(capabilities([]))).toBe(true);
    expect(
      isPresentationCapabilitiesV1(capabilities(PresentationMessageV1Kinds))
    ).toBe(true);
  });
});

describe('shared pure and stable Effect boundary', () => {
  it('round-trips every declared surface through JSON and the exported codecs', () => {
    const messages = [
      text,
      { version: '1', kind: 'status', status: 'running' },
      card,
      { version: '1', kind: 'metric', name: 'latency', value: 12, unit: 'ms' },
      { version: '1', kind: 'trace', name: 'step', depth: 0, durationMs: 0.5 },
      { version: '1', kind: 'state', key: 'k', value: { a: [1, null] } },
      group([text]),
      { version: '1', kind: 'interaction', request },
      {
        version: '1',
        kind: 'result',
        outcome: 'unavailable',
        value: null,
        summary: 'No result',
      },
    ];
    for (const message of messages) {
      const transported: unknown = JSON.parse(JSON.stringify(message));
      expect(isPresentationMessageV1(transported)).toBe(true);
      expect(
        Schema.decodeUnknownSync(PresentationMessageV1Schema)(transported)
      ).toEqual(message);
      expect(
        Schema.encodeSync(PresentationMessageV1Schema)(
          Schema.decodeUnknownSync(PresentationMessageV1Schema)(transported)
        )
      ).toEqual(message);
    }
    for (const [codec, value] of [
      [JsonValueV1Schema, { a: [null, 'é'] }],
      [PresentationRecordV1Schema, record],
      [UserInteractionRequestV1Schema, request],
      [UserInteractionResponseV1Schema, response],
      [PresentationCapabilitiesV1Schema, capabilities(['text'])],
    ] as const) {
      expect(
        Schema.decodeUnknownSync(codec)(JSON.parse(JSON.stringify(value)))
      ).toEqual(value);
    }
  });
  it.each([new Date(0), new Map([['a', 1]]), new Set([1])])(
    'rejects foreign JSON objects before schema transformation',
    (value) => {
      expect(isJsonValueV1(value)).toBe(false);
      expect(Schema.is(JsonValueV1Schema)(value)).toBe(false);
    }
  );
  it('checks every top-level guard without invoking a required-field getter', () => {
    for (const [guard, valid, key] of [
      [isPresentationMessageV1, text, 'version'],
      [isPresentationRecordV1, record, 'messageId'],
      [isUserInteractionRequestV1, request, 'kind'],
      [isUserInteractionResponseV1, response, 'value'],
      [
        isPresentationCapabilitiesV1,
        { version: '1', messageKinds: ['text'] },
        'messageKinds',
      ],
    ] as const) {
      let calls = 0;
      const hostile = { ...valid };
      Object.defineProperty(hostile, key, {
        enumerable: true,
        get: () => {
          calls += 1;
          return '1';
        },
      });
      expect(guard(hostile)).toBe(false);
      expect(calls).toBe(0);
    }
  });
  it('rejects hostile nested getters, arrays and prototypes without invoking hooks', () => {
    let calls = 0;
    const getter = {
      get text() {
        calls += 1;
        return 'hello';
      },
    };
    const array: unknown[] = [text];
    Object.defineProperty(array, '0', {
      enumerable: true,
      get: () => {
        calls += 1;
        return text;
      },
    });
    expect(isPresentationMessageV1(group(array))).toBe(false);
    const nested = { version: '1', kind: 'text' };
    Object.defineProperty(
      nested,
      'text',
      Object.getOwnPropertyDescriptor(getter, 'text')!
    );
    expect(isPresentationMessageV1(group([nested]))).toBe(false);
    expect(isJsonValueV1(getter)).toBe(false);
    expect(
      isPresentationMessageV1(
        Object.create({
          get version() {
            calls += 1;
            return '1';
          },
        })
      )
    ).toBe(false);
    expect(calls).toBe(0);
  });
  it('rejects sparse arrays, array metadata, symbol keys and hidden fields', () => {
    expect(isPresentationMessageV1(group(new Array(1)))).toBe(false);
    const array = [text];
    Object.defineProperty(array, 'extra', { value: true, enumerable: true });
    expect(isPresentationMessageV1(group(array))).toBe(false);
    expect(
      isPresentationCapabilitiesV1({
        version: '1',
        messageKinds: ['text'],
        [Symbol('x')]: 1,
      })
    ).toBe(false);
    const hidden = { ...record };
    Object.defineProperty(hidden, 'hidden', { value: true });
    expect(isPresentationRecordV1(hidden)).toBe(false);
  });
  it('rejects prototype instances and accepts null-prototype data', () => {
    const inherited = Object.create({ marker: true }) as Record<
      string,
      unknown
    >;
    Object.assign(inherited, text);
    expect(isPresentationMessageV1(inherited)).toBe(false);
    const plain = Object.assign(
      Object.create(null) as Record<string, unknown>,
      text
    );
    expect(isPresentationMessageV1(plain)).toBe(true);
  });
});

// Independent source fixtures: upstream json-value.test.ts, plus port hardening.
describe('bounded data traversal', () => {
  it('rejects cycles and accepts a shared child on separate paths', () => {
    const cycle: unknown[] = [];
    cycle.push(cycle);
    expect(isJsonValueV1(cycle)).toBe(false);
    const cyclicGroup: Record<string, unknown> = {
      version: '1',
      kind: 'group',
      label: 'g',
    };
    cyclicGroup.children = [cyclicGroup];
    expect(isPresentationMessageV1(cyclicGroup)).toBe(false);
    const shared = { a: 1 };
    expect(isJsonValueV1({ left: shared, right: shared })).toBe(true);
  });
  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects the own prototype key %s',
    (key) => {
      expect(isJsonValueV1({ [key]: 'payload' })).toBe(false);
    }
  );
  it('enforces entry budgets across nested arrays', () => {
    expect(isJsonValueV1([Array.from({ length: 999 }, () => 0)])).toBe(true);
    expect(isJsonValueV1([Array.from({ length: 999 }, () => 0), 0])).toBe(
      false
    );
  });
  it('enforces the exact depth boundary', () => {
    let value: unknown = 0;
    for (let index = 0; index < JsonValueV1Limits.maxDepth; index += 1)
      value = [value];
    expect(isJsonValueV1(value)).toBe(true);
    expect(isJsonValueV1([value])).toBe(false);
  });
  it('enforces encoded JSON bytes and raw message text bytes separately', () => {
    expect(isJsonValueV1('x'.repeat(65534))).toBe(true);
    expect(isJsonValueV1('x'.repeat(65535))).toBe(false);
    expect(
      isPresentationMessageV1({ ...text, text: '\u0000'.repeat(65536) })
    ).toBe(true);
    expect(isPresentationMessageV1({ ...text, text: '名'.repeat(21846) })).toBe(
      false
    );
    expect(jsonValueV1Utf8Bytes({ a: ['é', '\n', -0, 1e21] })).toBe(
      new TextEncoder().encode(JSON.stringify({ a: ['é', '\n', -0, 1e21] }))
        .byteLength
    );
  });
  it('rejects expansion attacks within the consumer traversal budget', () => {
    let value: unknown = text;
    for (let index = 0; index < 16; index += 1) value = group([value, value]);
    expect(isPresentationMessageV1(value)).toBe(false);
  });
  it('rejects executable toJSON values without running them', () => {
    let calls = 0;
    const value = {
      toJSON: () => {
        calls += 1;
        return {};
      },
    };
    expect(isJsonValueV1(value)).toBe(false);
    expect(isPresentationMessageV1(group([value]))).toBe(false);
    expect(calls).toBe(0);
  });
  it('rejects explicit absent custom text, separately from the source grammar', () => {
    expect(
      isUserInteractionResponseV1({
        version: '1',
        requestId: 'req-1',
        executionId: 'exec-1',
        turnId: 'turn-1',
        revision: 0,
        kind: 'choice',
        values: [],
        customText: null,
      })
    ).toBe(false);
    expect(
      isUserInteractionResponseV1({
        version: '1',
        requestId: 'req-1',
        executionId: 'exec-1',
        turnId: 'turn-1',
        revision: 0,
        kind: 'choice',
        values: [],
        customText: undefined,
      })
    ).toBe(false);
  });
});
