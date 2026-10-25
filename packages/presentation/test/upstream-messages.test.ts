/** Port of jam-flow V1. See PROVENANCE.md for source hashes and deviations. */
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  PresentationMessageV1Kinds,
  PresentationMessageV1Schema,
  PresentationRecordV1Schema,
  PresentationV1Limits,
  isPresentationMessageV1,
  isPresentationRecordV1,
} from '../src/index.js';

const v = { version: '1' as const };

const text = { ...v, kind: 'text', text: 'hello' };

const record = (overrides: Record<string, unknown> = {}): unknown => ({
  ...v,
  messageId: 'msg-1',
  executionId: 'exec-1',
  sequence: 1,
  atEpochMs: 1_000,
  message: text,
  ...overrides,
});

/** Nests `depth` groups, each holding the next. */
const nested = (depth: number): unknown => {
  let inner: unknown = text;
  for (let index = 0; index < depth; index += 1) {
    inner = { ...v, kind: 'group', label: 'g', children: [inner] };
  }
  return inner;
};

describe('isPresentationMessageV1 — the declared kinds', () => {
  it('declares nine kinds', () => {
    expect(PresentationMessageV1Kinds).toHaveLength(9);
  });

  it('accepts a text message', () => {
    expect(isPresentationMessageV1(text)).toBe(true);
  });

  it('accepts a status message with no detail', () => {
    expect(
      isPresentationMessageV1({ ...v, kind: 'status', status: 'running' })
    ).toBe(true);
  });

  it('accepts a status message with a detail', () => {
    expect(
      isPresentationMessageV1({
        ...v,
        kind: 'status',
        status: 'failed',
        detail: 'the tool refused',
      })
    ).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(
      isPresentationMessageV1({ ...v, kind: 'status', status: 'thinking' })
    ).toBe(false);
  });

  it('accepts a card', () => {
    expect(
      isPresentationMessageV1({ ...v, kind: 'card', title: 't', body: 'b' })
    ).toBe(true);
  });

  it('rejects a card missing its body', () => {
    expect(isPresentationMessageV1({ ...v, kind: 'card', title: 't' })).toBe(
      false
    );
  });

  it('accepts a metric with a unit', () => {
    expect(
      isPresentationMessageV1({
        ...v,
        kind: 'metric',
        name: 'latency',
        value: 12,
        unit: 'ms',
      })
    ).toBe(true);
  });

  it('accepts a metric with no unit', () => {
    expect(
      isPresentationMessageV1({
        ...v,
        kind: 'metric',
        name: 'latency',
        value: 12,
      })
    ).toBe(true);
  });

  it('rejects a metric whose value is not a number', () => {
    expect(
      isPresentationMessageV1({
        ...v,
        kind: 'metric',
        name: 'latency',
        value: 'fast',
      })
    ).toBe(false);
  });

  it('accepts a trace', () => {
    expect(
      isPresentationMessageV1({ ...v, kind: 'trace', name: 'step', depth: 0 })
    ).toBe(true);
  });

  it('accepts a trace with a duration', () => {
    expect(
      isPresentationMessageV1({
        ...v,
        kind: 'trace',
        name: 'step',
        depth: 1,
        durationMs: 12.5,
      })
    ).toBe(true);
  });

  it('rejects a trace with a negative duration', () => {
    expect(
      isPresentationMessageV1({
        ...v,
        kind: 'trace',
        name: 'step',
        depth: 0,
        durationMs: -1,
      })
    ).toBe(false);
  });

  it('rejects a trace with a non-finite duration', () => {
    expect(
      isPresentationMessageV1({
        ...v,
        kind: 'trace',
        name: 'step',
        depth: 0,
        durationMs: Number.POSITIVE_INFINITY,
      })
    ).toBe(false);
  });

  it('rejects a trace with a negative depth', () => {
    expect(
      isPresentationMessageV1({ ...v, kind: 'trace', name: 'step', depth: -1 })
    ).toBe(false);
  });

  it('accepts a state message carrying a bounded JSON value', () => {
    expect(
      isPresentationMessageV1({
        ...v,
        kind: 'state',
        key: 'k',
        value: { a: [1, 2] },
      })
    ).toBe(true);
  });

  it('rejects a state message carrying a Date', () => {
    expect(
      isPresentationMessageV1({
        ...v,
        kind: 'state',
        key: 'k',
        value: new Date(0),
      })
    ).toBe(false);
  });
});

describe('isPresentationMessageV1 — groups', () => {
  it('accepts a group holding one child', () => {
    expect(isPresentationMessageV1(nested(1))).toBe(true);
  });

  it('accepts a group with no children', () => {
    expect(
      isPresentationMessageV1({
        ...v,
        kind: 'group',
        label: 'g',
        children: [],
      })
    ).toBe(true);
  });

  it('accepts nesting one level below the depth limit', () => {
    expect(
      isPresentationMessageV1(nested(PresentationV1Limits.maxGroupDepth - 1))
    ).toBe(true);
  });

  it('rejects nesting past the depth limit', () => {
    expect(
      isPresentationMessageV1(nested(PresentationV1Limits.maxGroupDepth + 1))
    ).toBe(false);
  });

  it('rejects more children than the limit allows', () => {
    const many = Array.from(
      { length: PresentationV1Limits.maxGroupChildren + 1 },
      () => text
    );
    expect(
      isPresentationMessageV1({
        ...v,
        kind: 'group',
        label: 'g',
        children: many,
      })
    ).toBe(false);
  });

  it('rejects a group whose children are not an array', () => {
    expect(
      isPresentationMessageV1({
        ...v,
        kind: 'group',
        label: 'g',
        children: 'not a list',
      })
    ).toBe(false);
  });

  it('rejects a group holding an invalid child', () => {
    expect(
      isPresentationMessageV1({
        ...v,
        kind: 'group',
        label: 'g',
        children: [{ ...v, kind: 'wizard' }],
      })
    ).toBe(false);
  });

  it('rejects a group past the encoded byte limit', () => {
    const bulky = Array.from({ length: 20 }, () => ({
      ...v,
      kind: 'text',
      text: 'x'.repeat(4_000),
    }));
    expect(
      isPresentationMessageV1({
        ...v,
        kind: 'group',
        label: 'g',
        children: bulky,
      })
    ).toBe(false);
  });
});

describe('isPresentationMessageV1 — shape', () => {
  it('rejects a non-object', () => {
    expect(isPresentationMessageV1('hello')).toBe(false);
  });

  it('rejects null', () => {
    expect(isPresentationMessageV1(null)).toBe(false);
  });

  it('rejects the wrong version', () => {
    expect(isPresentationMessageV1({ ...text, version: '2' })).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(isPresentationMessageV1({ ...v, kind: 'wizard' })).toBe(false);
  });

  it('rejects a kind that is not a string', () => {
    expect(isPresentationMessageV1({ ...v, kind: 7 })).toBe(false);
  });

  it('rejects an unexpected extra key', () => {
    expect(isPresentationMessageV1({ ...text, extra: 1 })).toBe(false);
  });

  it('rejects text past the byte limit', () => {
    expect(
      isPresentationMessageV1({
        ...v,
        kind: 'text',
        text: 'x'.repeat(PresentationV1Limits.maxMessageTextUtf8Bytes + 1),
      })
    ).toBe(false);
  });

  it('rejects a symbol-keyed own property', () => {
    const value: Record<string | symbol, unknown> = { ...text };
    value[Symbol('s')] = 1;
    expect(isPresentationMessageV1(value)).toBe(false);
  });
});

describe('isPresentationRecordV1', () => {
  it('accepts a well-formed record', () => {
    expect(isPresentationRecordV1(record())).toBe(true);
  });

  it('accepts a record with a correlation', () => {
    expect(
      isPresentationRecordV1(
        record({ correlation: { flowId: 'flow-1', stepId: 'step-1' } })
      )
    ).toBe(true);
  });

  it('accepts an empty correlation object', () => {
    expect(isPresentationRecordV1(record({ correlation: {} }))).toBe(true);
  });

  it('rejects a correlation carrying an unknown key', () => {
    expect(
      isPresentationRecordV1(record({ correlation: { unknownId: 'x' } }))
    ).toBe(false);
  });

  it('rejects a correlation value that is not an opaque identifier', () => {
    expect(
      isPresentationRecordV1(record({ correlation: { flowId: 'has space' } }))
    ).toBe(false);
  });

  it('rejects a sequence of zero, because a record is one-based', () => {
    expect(isPresentationRecordV1(record({ sequence: 0 }))).toBe(false);
  });

  it('rejects a negative sequence', () => {
    expect(isPresentationRecordV1(record({ sequence: -1 }))).toBe(false);
  });

  it('rejects a non-integer sequence', () => {
    expect(isPresentationRecordV1(record({ sequence: 1.5 }))).toBe(false);
  });

  it('accepts a zero timestamp, which is a valid epoch', () => {
    expect(isPresentationRecordV1(record({ atEpochMs: 0 }))).toBe(true);
  });

  it('rejects a negative timestamp', () => {
    expect(isPresentationRecordV1(record({ atEpochMs: -1 }))).toBe(false);
  });

  it('rejects a message identity that is not an opaque identifier', () => {
    expect(isPresentationRecordV1(record({ messageId: 'has space' }))).toBe(
      false
    );
  });

  it('rejects a record whose message does not validate', () => {
    expect(
      isPresentationRecordV1(record({ message: { ...v, kind: 'wizard' } }))
    ).toBe(false);
  });

  it('rejects a record with an unexpected extra key', () => {
    expect(isPresentationRecordV1(record({ extra: 1 }))).toBe(false);
  });

  it('rejects a record missing a required key', () => {
    const rest = { ...(record() as Record<string, unknown>) };
    delete rest.sequence;
    expect(isPresentationRecordV1(rest)).toBe(false);
  });

  it('rejects a non-object', () => {
    expect(isPresentationRecordV1(42)).toBe(false);
  });
});

describe('the presentation schemas', () => {
  it('decodes a valid message', () => {
    expect(Schema.decodeUnknownSync(PresentationMessageV1Schema)(text)).toEqual(
      text
    );
  });

  it('rejects an invalid message', () => {
    expect(() =>
      Schema.decodeUnknownSync(PresentationMessageV1Schema)({
        ...v,
        kind: 'wizard',
      })
    ).toThrow();
  });

  it('decodes a valid record', () => {
    expect(
      Schema.decodeUnknownSync(PresentationRecordV1Schema)(record())
    ).toMatchObject({ messageId: 'msg-1' });
  });

  it('rejects an invalid record', () => {
    expect(() =>
      Schema.decodeUnknownSync(PresentationRecordV1Schema)(
        record({ sequence: 0 })
      )
    ).toThrow();
  });
});
