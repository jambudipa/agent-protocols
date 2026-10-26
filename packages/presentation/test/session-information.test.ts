import { Option } from 'effect';
import { describe, expect, it } from '@effect/vitest';

import {
  MAX_FIELD_KEY_BYTES,
  MAX_FIELD_VALUE_BYTES,
  MAX_INFORMATION_FIELDS,
  MAX_SESSION_TITLE_BYTES,
  SessionInformationError,
  applyInformation,
  emptyInformation,
  informationPayload,
  restoreInformation,
  validateInformation,
  type InformationField,
  type InformationSnapshot,
} from '../src/session-information.js';

const snapshot = (
  overrides: Partial<InformationSnapshot> = {}
): InformationSnapshot => ({
  revision: 0,
  title: Option.none(),
  fields: [],
  ...overrides,
});

const field = (key: string, value = 'v'): InformationField => ({ key, value });

const rejectionOf = (error: Option.Option<SessionInformationError>): string => {
  expect(Option.isSome(error)).toBe(true);
  if (Option.isNone(error)) return expect.unreachable();
  return error.value.rejection;
};

describe('emptyInformation', () => {
  it('starts at revision zero with no title and no fields', () => {
    expect(emptyInformation.revision).toBe(0);
    expect(Option.isNone(emptyInformation.title)).toBe(true);
    expect(emptyInformation.fields).toEqual([]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(emptyInformation)).toBe(true);
  });
});

describe('validateInformation', () => {
  it('accepts the empty snapshot', () => {
    expect(Option.isNone(validateInformation(emptyInformation))).toBe(true);
  });

  it('accepts a title within the byte limit', () => {
    expect(
      Option.isNone(
        validateInformation(snapshot({ title: Option.some('A session') }))
      )
    ).toBe(true);
  });

  it('rejects a title past the byte limit', () => {
    expect(
      rejectionOf(
        validateInformation(
          snapshot({
            title: Option.some('x'.repeat(MAX_SESSION_TITLE_BYTES + 1)),
          })
        )
      )
    ).toBe('title-too-long');
  });

  it('measures the title in bytes, not characters', () => {
    // Each '名' is three UTF-8 bytes, so a third of the limit in characters
    // still fits and one more than that does not.
    const justOver = '名'.repeat(Math.ceil(MAX_SESSION_TITLE_BYTES / 3) + 1);
    expect(
      rejectionOf(
        validateInformation(snapshot({ title: Option.some(justOver) }))
      )
    ).toBe('title-too-long');
  });

  it('rejects more fields than the limit allows', () => {
    const many = Array.from({ length: MAX_INFORMATION_FIELDS + 1 }, (_, i) =>
      field(`k${String(i)}`)
    );
    expect(rejectionOf(validateInformation(snapshot({ fields: many })))).toBe(
      'too-many-fields'
    );
  });

  it('accepts exactly the field limit', () => {
    const many = Array.from({ length: MAX_INFORMATION_FIELDS }, (_, i) =>
      field(`k${String(i)}`)
    );
    expect(Option.isNone(validateInformation(snapshot({ fields: many })))).toBe(
      true
    );
  });

  it('rejects a field with an empty key', () => {
    expect(
      rejectionOf(validateInformation(snapshot({ fields: [field('')] })))
    ).toBe('missing-key');
  });

  it('rejects a field whose key is only whitespace', () => {
    expect(
      rejectionOf(validateInformation(snapshot({ fields: [field('   ')] })))
    ).toBe('missing-key');
  });

  it('rejects two fields sharing one key, which makes the later read ambiguous', () => {
    expect(
      rejectionOf(
        validateInformation(
          snapshot({ fields: [field('k', 'a'), field('k', 'b')] })
        )
      )
    ).toBe('duplicate-key');
  });

  it('names the offending key on a duplicate', () => {
    const error = validateInformation(
      snapshot({ fields: [field('dup'), field('dup')] })
    );
    expect(Option.isSome(error)).toBe(true);
    if (Option.isSome(error)) {
      expect(Option.getOrNull(error.value.key)).toBe('dup');
    }
  });

  it('rejects a key past the byte limit', () => {
    expect(
      rejectionOf(
        validateInformation(
          snapshot({ fields: [field('x'.repeat(MAX_FIELD_KEY_BYTES + 1))] })
        )
      )
    ).toBe('key-too-long');
  });

  it('rejects a value past the byte limit', () => {
    expect(
      rejectionOf(
        validateInformation(
          snapshot({
            fields: [field('k', 'x'.repeat(MAX_FIELD_VALUE_BYTES + 1))],
          })
        )
      )
    ).toBe('value-too-long');
  });
});

describe('applyInformation', () => {
  it('advances the revision', () => {
    const { snapshot: next } = applyInformation(emptyInformation, {});
    expect(next.revision).toBe(1);
  });

  it('sets a title that was not there', () => {
    const { snapshot: next } = applyInformation(emptyInformation, {
      title: 'A run',
    });
    expect(Option.getOrNull(next.title)).toBe('A run');
  });

  it('keeps the existing title when the update states none', () => {
    const first = applyInformation(emptyInformation, {
      title: 'A run',
    }).snapshot;
    const { snapshot: next } = applyInformation(first, {});
    expect(Option.getOrNull(next.title)).toBe('A run');
  });

  it('replaces an existing title when the update states one', () => {
    const first = applyInformation(emptyInformation, {
      title: 'A run',
    }).snapshot;
    const { snapshot: next } = applyInformation(first, { title: 'Another' });
    expect(Option.getOrNull(next.title)).toBe('Another');
  });

  it('appends a field that was not there', () => {
    const { snapshot: next } = applyInformation(emptyInformation, {
      fields: [field('model', 'opus')],
    });
    expect(next.fields).toEqual([{ key: 'model', value: 'opus' }]);
  });

  it('keeps a restated field in its original position', () => {
    // The order a client renders is the order the Session first stated each
    // field, so a routine value refresh must not shuffle the list.
    const first = applyInformation(emptyInformation, {
      fields: [field('a', '1'), field('b', '2'), field('c', '3')],
    }).snapshot;
    const { snapshot: next } = applyInformation(first, {
      fields: [field('a', 'updated')],
    });
    expect(next.fields.map((entry) => entry.key)).toEqual(['a', 'b', 'c']);
    expect(next.fields[0]?.value).toBe('updated');
  });

  it('applies several field statements in one update', () => {
    const { snapshot: next } = applyInformation(emptyInformation, {
      fields: [field('a'), field('b')],
    });
    expect(next.fields).toHaveLength(2);
  });

  it('leaves the last good snapshot in place when the update is invalid', () => {
    // A client showing stale information is better off than one showing
    // information that never validated.
    const { snapshot: next, error } = applyInformation(emptyInformation, {
      fields: [field('')],
    });
    expect(rejectionOf(error)).toBe('missing-key');
    expect(next).toBe(emptyInformation);
  });

  it('does not advance the revision when the update is refused', () => {
    const { snapshot: next } = applyInformation(emptyInformation, {
      title: 'x'.repeat(MAX_SESSION_TITLE_BYTES + 1),
    });
    expect(next.revision).toBe(0);
  });

  it('freezes the snapshot it produces', () => {
    const { snapshot: next } = applyInformation(emptyInformation, {});
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.fields)).toBe(true);
  });
});

describe('restoreInformation', () => {
  it('accepts a restore at a later revision', () => {
    const { snapshot: next, error } = restoreInformation(
      emptyInformation,
      snapshot({ revision: 5, fields: [field('a')] })
    );
    expect(Option.isNone(error)).toBe(true);
    expect(next.revision).toBe(5);
  });

  it('accepts a restore at the same revision', () => {
    const { error } = restoreInformation(
      snapshot({ revision: 3 }),
      snapshot({ revision: 3 })
    );
    expect(Option.isNone(error)).toBe(true);
  });

  it('refuses a restore behind the live snapshot, so a later connection cannot roll it back', () => {
    const current = snapshot({ revision: 5 });
    const { snapshot: next, error } = restoreInformation(
      current,
      snapshot({ revision: 2 })
    );
    expect(rejectionOf(error)).toBe('stale-revision');
    expect(next).toBe(current);
  });

  it('refuses a restore that does not validate', () => {
    const current = snapshot({ revision: 1 });
    const { snapshot: next, error } = restoreInformation(
      current,
      snapshot({ revision: 2, fields: [field('dup'), field('dup')] })
    );
    expect(rejectionOf(error)).toBe('duplicate-key');
    expect(next).toBe(current);
  });

  it('freezes the restored snapshot and its field list', () => {
    const { snapshot: next } = restoreInformation(
      emptyInformation,
      snapshot({ revision: 2, fields: [field('a')] })
    );
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.fields)).toBe(true);
  });
});

describe('informationPayload', () => {
  it('names itself session-information', () => {
    expect(informationPayload(emptyInformation)['kind']).toBe(
      'session-information'
    );
  });

  it('leaves the title undefined when none is set', () => {
    expect(informationPayload(emptyInformation)['title']).toBeUndefined();
  });

  it('carries a set title', () => {
    const next = applyInformation(emptyInformation, {
      title: 'A run',
    }).snapshot;
    expect(informationPayload(next)['title']).toBe('A run');
  });

  it('carries the fields as plain key and value pairs', () => {
    const next = applyInformation(emptyInformation, {
      fields: [field('model', 'opus')],
    }).snapshot;
    expect(informationPayload(next)['fields']).toEqual([
      { key: 'model', value: 'opus' },
    ]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(informationPayload(emptyInformation))).toBe(true);
  });
});
