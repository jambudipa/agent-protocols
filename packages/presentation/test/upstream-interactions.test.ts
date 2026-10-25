/** Port of jam-flow V1. See PROVENANCE.md for source hashes and deviations. */
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  UserInteractionRequestV1Schema,
  UserInteractionResponseV1Schema,
  UserInteractionV1Limits,
  isUserInteractionRequestV1,
  isUserInteractionResponseV1,
  validateInteractionResponseV1,
  type UserInteractionRequestV1,
  type UserInteractionResponseV1,
} from '../src/index.js';

const base = {
  version: '1' as const,
  requestId: 'req-1',
  executionId: 'exec-1',
  turnId: 'turn-1',
  revision: 0,
  createdAtEpochMs: 1_000,
  expiresAtEpochMs: 1_000 + UserInteractionV1Limits.defaultLifetimeMs,
};

const textRequest = (
  overrides: Record<string, unknown> = {}
): UserInteractionRequestV1 =>
  ({ ...base, kind: 'text', ...overrides }) as UserInteractionRequestV1;

const choiceRequest = (
  overrides: Record<string, unknown> = {}
): UserInteractionRequestV1 =>
  ({
    ...base,
    kind: 'choice',
    selection: 'single',
    options: [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ],
    allowCustomText: false,
    ...overrides,
  }) as UserInteractionRequestV1;

const confirmRequest = (): UserInteractionRequestV1 =>
  ({ ...base, kind: 'confirm' }) as UserInteractionRequestV1;

const jsonRequest = (
  overrides: Record<string, unknown> = {}
): UserInteractionRequestV1 =>
  ({ ...base, kind: 'json', ...overrides }) as UserInteractionRequestV1;

const responseBase = {
  version: '1' as const,
  requestId: 'req-1',
  executionId: 'exec-1',
  turnId: 'turn-1',
  revision: 0,
};

const response = (
  overrides: Record<string, unknown>
): UserInteractionResponseV1 =>
  ({ ...responseBase, ...overrides }) as UserInteractionResponseV1;

describe('isUserInteractionRequestV1 — text', () => {
  it('accepts a minimal text request', () => {
    expect(isUserInteractionRequestV1(textRequest())).toBe(true);
  });

  it('accepts a text request with both bounds', () => {
    expect(
      isUserInteractionRequestV1(textRequest({ minLength: 1, maxLength: 10 }))
    ).toBe(true);
  });

  it('accepts equal bounds', () => {
    expect(
      isUserInteractionRequestV1(textRequest({ minLength: 5, maxLength: 5 }))
    ).toBe(true);
  });

  it('rejects a minimum above the maximum', () => {
    expect(
      isUserInteractionRequestV1(textRequest({ minLength: 10, maxLength: 1 }))
    ).toBe(false);
  });

  it('rejects a negative minimum', () => {
    expect(isUserInteractionRequestV1(textRequest({ minLength: -1 }))).toBe(
      false
    );
  });

  it('rejects a non-integer bound', () => {
    expect(isUserInteractionRequestV1(textRequest({ maxLength: 1.5 }))).toBe(
      false
    );
  });

  it('rejects a maximum past the text byte limit', () => {
    expect(
      isUserInteractionRequestV1(
        textRequest({ maxLength: UserInteractionV1Limits.maxTextBytes + 1 })
      )
    ).toBe(false);
  });

  it('rejects an unexpected extra key', () => {
    expect(isUserInteractionRequestV1(textRequest({ extra: 1 }))).toBe(false);
  });
});

describe('isUserInteractionRequestV1 — choice', () => {
  it('accepts a single-selection choice request', () => {
    expect(isUserInteractionRequestV1(choiceRequest())).toBe(true);
  });

  it('accepts a multiple-selection choice request', () => {
    expect(
      isUserInteractionRequestV1(choiceRequest({ selection: 'multiple' }))
    ).toBe(true);
  });

  it('rejects an unknown selection mode', () => {
    expect(
      isUserInteractionRequestV1(choiceRequest({ selection: 'some' }))
    ).toBe(false);
  });

  it('rejects an empty option list', () => {
    expect(isUserInteractionRequestV1(choiceRequest({ options: [] }))).toBe(
      false
    );
  });

  it('rejects two options sharing one value', () => {
    expect(
      isUserInteractionRequestV1(
        choiceRequest({
          options: [
            { value: 'a', label: 'Alpha' },
            { value: 'a', label: 'Again' },
          ],
        })
      )
    ).toBe(false);
  });

  it('rejects an option carrying an extra key', () => {
    expect(
      isUserInteractionRequestV1(
        choiceRequest({ options: [{ value: 'a', label: 'A', extra: 1 }] })
      )
    ).toBe(false);
  });

  it('rejects an option value past its byte limit', () => {
    expect(
      isUserInteractionRequestV1(
        choiceRequest({
          options: [
            {
              value: 'x'.repeat(
                UserInteractionV1Limits.maxChoiceValueBytes + 1
              ),
              label: 'A',
            },
          ],
        })
      )
    ).toBe(false);
  });

  it('rejects a non-boolean allowCustomText', () => {
    expect(
      isUserInteractionRequestV1(choiceRequest({ allowCustomText: 'yes' }))
    ).toBe(false);
  });

  it('rejects a single selection whose bounds are not exactly one', () => {
    expect(
      isUserInteractionRequestV1(
        choiceRequest({ minSelections: 0, maxSelections: 2 })
      )
    ).toBe(false);
  });

  it('accepts a single selection with bounds of exactly one', () => {
    expect(
      isUserInteractionRequestV1(
        choiceRequest({ minSelections: 1, maxSelections: 1 })
      )
    ).toBe(true);
  });

  it('rejects a maximum above the number of options', () => {
    expect(
      isUserInteractionRequestV1(
        choiceRequest({ selection: 'multiple', maxSelections: 5 })
      )
    ).toBe(false);
  });

  it('rejects a minimum above the maximum', () => {
    expect(
      isUserInteractionRequestV1(
        choiceRequest({
          selection: 'multiple',
          minSelections: 2,
          maxSelections: 1,
        })
      )
    ).toBe(false);
  });

  it('rejects more options than the limit allows', () => {
    const many = Array.from(
      { length: UserInteractionV1Limits.maxChoiceOptions + 1 },
      (_, index) => ({ value: `v${String(index)}`, label: 'L' })
    );
    expect(
      isUserInteractionRequestV1(
        choiceRequest({ selection: 'multiple', options: many })
      )
    ).toBe(false);
  });
});

describe('isUserInteractionRequestV1 — confirm and json', () => {
  it('accepts a confirm request', () => {
    expect(isUserInteractionRequestV1(confirmRequest())).toBe(true);
  });

  it('rejects a confirm request carrying an extra key', () => {
    expect(isUserInteractionRequestV1({ ...confirmRequest(), extra: 1 })).toBe(
      false
    );
  });

  it('accepts a json request with no guidance', () => {
    expect(isUserInteractionRequestV1(jsonRequest())).toBe(true);
  });

  it('accepts a json request with guidance', () => {
    expect(
      isUserInteractionRequestV1(jsonRequest({ guidance: 'an object please' }))
    ).toBe(true);
  });

  it('rejects guidance past its byte limit', () => {
    expect(
      isUserInteractionRequestV1(
        jsonRequest({
          guidance: 'x'.repeat(
            UserInteractionV1Limits.maxJsonGuidanceBytes + 1
          ),
        })
      )
    ).toBe(false);
  });
});

describe('isUserInteractionRequestV1 — shape', () => {
  it('rejects a non-object', () => {
    expect(isUserInteractionRequestV1('not a request')).toBe(false);
  });

  it('rejects null', () => {
    expect(isUserInteractionRequestV1(null)).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(isUserInteractionRequestV1({ ...base, kind: 'wizard' })).toBe(false);
  });

  it('rejects a request with no kind at all', () => {
    expect(isUserInteractionRequestV1(base)).toBe(false);
  });

  it('rejects a request with the wrong version', () => {
    expect(isUserInteractionRequestV1(textRequest({ version: '2' }))).toBe(
      false
    );
  });

  it('rejects a request whose identity is not an opaque identifier', () => {
    expect(
      isUserInteractionRequestV1(textRequest({ requestId: 'has space' }))
    ).toBe(false);
  });

  it('rejects a lifetime shorter than the minimum', () => {
    expect(
      isUserInteractionRequestV1(
        textRequest({
          createdAtEpochMs: 1_000,
          expiresAtEpochMs: 1_000 + UserInteractionV1Limits.minLifetimeMs - 1,
        })
      )
    ).toBe(false);
  });

  it('rejects a lifetime longer than the maximum', () => {
    expect(
      isUserInteractionRequestV1(
        textRequest({
          createdAtEpochMs: 1_000,
          expiresAtEpochMs: 1_000 + UserInteractionV1Limits.maxLifetimeMs + 1,
        })
      )
    ).toBe(false);
  });

  it('rejects a label past its byte limit', () => {
    expect(
      isUserInteractionRequestV1(
        textRequest({
          label: 'x'.repeat(UserInteractionV1Limits.maxLabelBytes + 1),
        })
      )
    ).toBe(false);
  });

  it('accepts a label within its byte limit', () => {
    expect(isUserInteractionRequestV1(textRequest({ label: 'Name?' }))).toBe(
      true
    );
  });
});

describe('isUserInteractionResponseV1', () => {
  it('accepts a text response', () => {
    expect(
      isUserInteractionResponseV1(response({ kind: 'text', value: 'hi' }))
    ).toBe(true);
  });

  it('accepts a choice response', () => {
    expect(
      isUserInteractionResponseV1(response({ kind: 'choice', values: ['a'] }))
    ).toBe(true);
  });

  it('accepts a confirm response', () => {
    expect(
      isUserInteractionResponseV1(
        response({ kind: 'confirm', confirmed: true })
      )
    ).toBe(true);
  });

  it('accepts a json response carrying a bounded JSON value', () => {
    expect(
      isUserInteractionResponseV1(response({ kind: 'json', value: { a: 1 } }))
    ).toBe(true);
  });

  it('rejects a json response carrying a Date', () => {
    expect(
      isUserInteractionResponseV1(
        response({ kind: 'json', value: new Date(0) })
      )
    ).toBe(false);
  });

  it('rejects a response with an unknown kind', () => {
    expect(isUserInteractionResponseV1(response({ kind: 'wizard' }))).toBe(
      false
    );
  });

  it('rejects a non-object', () => {
    expect(isUserInteractionResponseV1(42)).toBe(false);
  });

  it('rejects a confirm response whose value is not boolean', () => {
    expect(
      isUserInteractionResponseV1(
        response({ kind: 'confirm', confirmed: 'yes' })
      )
    ).toBe(false);
  });
});

describe('validateInteractionResponseV1 — correlation', () => {
  it('accepts a response that matches its request', () => {
    expect(
      validateInteractionResponseV1(
        textRequest(),
        response({ kind: 'text', value: 'hi' })
      )
    ).toEqual({ valid: true, value: 'hi' });
  });

  it.each([
    ['requestId', { requestId: 'other' }],
    ['executionId', { executionId: 'other' }],
    ['turnId', { turnId: 'other' }],
    ['revision', { revision: 9 }],
  ])('refuses a response whose %s differs', (_name, overrides) => {
    expect(
      validateInteractionResponseV1(
        textRequest(),
        response({ kind: 'text', value: 'hi', ...overrides })
      )
    ).toEqual({ valid: false, code: 'interaction-mismatch' });
  });

  it('refuses a response of a different kind', () => {
    expect(
      validateInteractionResponseV1(
        textRequest(),
        response({ kind: 'confirm', confirmed: true })
      )
    ).toEqual({ valid: false, code: 'interaction-mismatch' });
  });
});

describe('validateInteractionResponseV1 — text constraints', () => {
  it('accepts a value inside the declared bounds', () => {
    expect(
      validateInteractionResponseV1(
        textRequest({ minLength: 1, maxLength: 4 }),
        response({ kind: 'text', value: 'abc' })
      ).valid
    ).toBe(true);
  });

  it('refuses a value shorter than the minimum', () => {
    expect(
      validateInteractionResponseV1(
        textRequest({ minLength: 3 }),
        response({ kind: 'text', value: 'ab' })
      )
    ).toEqual({ valid: false, code: 'interaction-constraint' });
  });

  it('refuses a value longer than the maximum', () => {
    expect(
      validateInteractionResponseV1(
        textRequest({ maxLength: 2 }),
        response({ kind: 'text', value: 'abc' })
      )
    ).toEqual({ valid: false, code: 'interaction-constraint' });
  });

  it('measures the value in bytes, not characters', () => {
    // '名' is one character and three UTF-8 bytes.
    expect(
      validateInteractionResponseV1(
        textRequest({ maxLength: 2 }),
        response({ kind: 'text', value: '名' })
      ).valid
    ).toBe(false);
  });

  it('accepts an empty value when no minimum was declared', () => {
    expect(
      validateInteractionResponseV1(
        textRequest(),
        response({ kind: 'text', value: '' })
      ).valid
    ).toBe(true);
  });
});

describe('validateInteractionResponseV1 — choice constraints', () => {
  it('accepts one declared option for a single selection', () => {
    expect(
      validateInteractionResponseV1(
        choiceRequest(),
        response({ kind: 'choice', values: ['a'] })
      )
    ).toEqual({ valid: true, value: { values: ['a'] } });
  });

  it('refuses a value that was never offered', () => {
    expect(
      validateInteractionResponseV1(
        choiceRequest(),
        response({ kind: 'choice', values: ['z'] })
      )
    ).toEqual({ valid: false, code: 'interaction-constraint' });
  });

  it('refuses the same value selected twice', () => {
    expect(
      validateInteractionResponseV1(
        choiceRequest({ selection: 'multiple' }),
        response({ kind: 'choice', values: ['a', 'a'] })
      )
    ).toEqual({ valid: false, code: 'interaction-constraint' });
  });

  it('refuses two selections for a single-selection request', () => {
    expect(
      validateInteractionResponseV1(
        choiceRequest(),
        response({ kind: 'choice', values: ['a', 'b'] })
      )
    ).toEqual({ valid: false, code: 'interaction-constraint' });
  });

  it('refuses no selection for a single-selection request', () => {
    expect(
      validateInteractionResponseV1(
        choiceRequest(),
        response({ kind: 'choice', values: [] })
      )
    ).toEqual({ valid: false, code: 'interaction-constraint' });
  });

  it('accepts no selection for a multiple-selection request with no minimum', () => {
    expect(
      validateInteractionResponseV1(
        choiceRequest({ selection: 'multiple' }),
        response({ kind: 'choice', values: [] })
      ).valid
    ).toBe(true);
  });

  it('accepts every option for a multiple-selection request', () => {
    expect(
      validateInteractionResponseV1(
        choiceRequest({ selection: 'multiple' }),
        response({ kind: 'choice', values: ['a', 'b'] })
      ).valid
    ).toBe(true);
  });

  it('refuses custom text the request did not allow', () => {
    expect(
      validateInteractionResponseV1(
        choiceRequest({ allowCustomText: false }),
        response({ kind: 'choice', values: ['a'], customText: 'mine' })
      )
    ).toEqual({ valid: false, code: 'interaction-constraint' });
  });

  it('carries custom text through when the request allowed it', () => {
    expect(
      validateInteractionResponseV1(
        choiceRequest({ allowCustomText: true }),
        response({ kind: 'choice', values: ['a'], customText: 'mine' })
      )
    ).toEqual({ valid: true, value: { values: ['a'], customText: 'mine' } });
  });
});

describe('validateInteractionResponseV1 — confirm and json', () => {
  it('returns the confirmed flag', () => {
    expect(
      validateInteractionResponseV1(
        confirmRequest(),
        response({ kind: 'confirm', confirmed: false })
      )
    ).toEqual({ valid: true, value: false });
  });

  it('returns the json value', () => {
    expect(
      validateInteractionResponseV1(
        jsonRequest(),
        response({ kind: 'json', value: { a: 1 } })
      )
    ).toEqual({ valid: true, value: { a: 1 } });
  });
});

describe('the interaction schemas', () => {
  it('decodes a valid request', () => {
    expect(
      Schema.decodeUnknownSync(UserInteractionRequestV1Schema)(textRequest())
    ).toMatchObject({ kind: 'text' });
  });

  it('rejects an invalid request', () => {
    expect(() =>
      Schema.decodeUnknownSync(UserInteractionRequestV1Schema)({
        ...base,
        kind: 'wizard',
      })
    ).toThrow();
  });

  it('decodes a valid response', () => {
    expect(
      Schema.decodeUnknownSync(UserInteractionResponseV1Schema)(
        response({ kind: 'text', value: 'hi' })
      )
    ).toMatchObject({ kind: 'text' });
  });

  it('rejects an invalid response', () => {
    expect(() =>
      Schema.decodeUnknownSync(UserInteractionResponseV1Schema)(
        response({ kind: 'wizard' })
      )
    ).toThrow();
  });
});
