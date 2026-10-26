import { Option } from 'effect';
import { describe, expect, it } from '@effect/vitest';

import { outOfBand } from './effect.js';
import {
  AgentPlanError,
  MAX_PLAN_ENTRIES,
  MAX_SNAPSHOT_BYTES,
  MAX_TITLE_BYTES,
  PLAN_PRIORITIES,
  isLegalEntryTransition,
  projectPlan,
  replaceSnapshot,
  snapshotBytes,
  validateProgress,
  validateSnapshot,
  type PlanEntry,
  type PlanEntryStatus,
  type PlanPriority,
  type PlanSnapshot,
  type PlannableUnit,
} from '../src/agent-plan.js';

const entry = (overrides: Partial<PlanEntry> = {}): PlanEntry => ({
  entryId: 'e1',
  title: 'Do the thing',
  priority: 'medium',
  status: 'pending',
  ...overrides,
});

const snapshot = (overrides: Partial<PlanSnapshot> = {}): PlanSnapshot => ({
  revision: 1,
  entries: [entry()],
  ...overrides,
});

const unit = (overrides: Partial<PlannableUnit> = {}): PlannableUnit => ({
  id: 'u1',
  title: 'A unit',
  plannable: true,
  ...overrides,
});

const rejectionOf = (error: Option.Option<AgentPlanError>): string => {
  expect(Option.isSome(error)).toBe(true);
  if (Option.isNone(error)) return expect.unreachable();
  return error.value.rejection;
};

const ALL_STATUSES: readonly PlanEntryStatus[] = [
  'pending',
  'in-progress',
  'completed',
  'failed',
  'skipped',
];

describe('isLegalEntryTransition', () => {
  it.each([
    ['pending', 'in-progress'],
    ['pending', 'skipped'],
    ['pending', 'failed'],
    ['in-progress', 'completed'],
    ['in-progress', 'failed'],
    ['in-progress', 'skipped'],
  ] as const)('allows %s to %s', (from, to) => {
    expect(isLegalEntryTransition(from, to)).toBe(true);
  });

  it('does not allow pending straight to completed', () => {
    expect(isLegalEntryTransition('pending', 'completed')).toBe(false);
  });

  it.each(['completed', 'failed', 'skipped'] as const)(
    'treats %s as terminal',
    (from) => {
      for (const to of ALL_STATUSES) {
        expect(isLegalEntryTransition(from, to)).toBe(false);
      }
    }
  );

  it('does not allow a status to transition to itself', () => {
    for (const status of ALL_STATUSES) {
      expect(isLegalEntryTransition(status, status)).toBe(false);
    }
  });
});

describe('snapshotBytes', () => {
  it('measures a snapshot by its encoded entries', () => {
    expect(snapshotBytes(snapshot())).toBeGreaterThan(0);
  });

  it('measures an empty snapshot as the encoded empty list', () => {
    expect(snapshotBytes(snapshot({ entries: [] }))).toBe(2);
  });

  it('grows with the number of entries', () => {
    const one = snapshotBytes(snapshot());
    const two = snapshotBytes(
      snapshot({ entries: [entry(), entry({ entryId: 'e2' })] })
    );
    expect(two).toBeGreaterThan(one);
  });

  it('ignores the revision, measuring only the entries', () => {
    expect(snapshotBytes(snapshot({ revision: 1 }))).toBe(
      snapshotBytes(snapshot({ revision: 999 }))
    );
  });
});

describe('validateSnapshot', () => {
  it('accepts a well-formed snapshot', () => {
    expect(Option.isNone(validateSnapshot(snapshot()))).toBe(true);
  });

  it('accepts an empty snapshot', () => {
    expect(Option.isNone(validateSnapshot(snapshot({ entries: [] })))).toBe(
      true
    );
  });

  it('rejects more entries than the limit allows', () => {
    const many = Array.from({ length: MAX_PLAN_ENTRIES + 1 }, (_, index) =>
      entry({ entryId: `e${String(index)}` })
    );
    expect(rejectionOf(validateSnapshot(snapshot({ entries: many })))).toBe(
      'too-many-entries'
    );
  });

  it('rejects an entry with no identity', () => {
    expect(
      rejectionOf(
        validateSnapshot(snapshot({ entries: [entry({ entryId: '' })] }))
      )
    ).toBe('missing-identity');
  });

  it('rejects two entries sharing one identity, which makes progress ambiguous', () => {
    expect(
      rejectionOf(validateSnapshot(snapshot({ entries: [entry(), entry()] })))
    ).toBe('duplicate-entry');
  });

  it('names the duplicated identity', () => {
    const error = validateSnapshot(
      snapshot({
        entries: [entry({ entryId: 'dup' }), entry({ entryId: 'dup' })],
      })
    );
    expect(Option.isSome(error)).toBe(true);
    if (Option.isSome(error)) {
      expect(Option.getOrNull(error.value.entryId)).toBe('dup');
    }
  });

  it('rejects an entry with no title', () => {
    expect(
      rejectionOf(
        validateSnapshot(snapshot({ entries: [entry({ title: '' })] }))
      )
    ).toBe('missing-title');
  });

  it('rejects a title past its byte limit', () => {
    expect(
      rejectionOf(
        validateSnapshot(
          snapshot({
            entries: [entry({ title: 'x'.repeat(MAX_TITLE_BYTES + 1) })],
          })
        )
      )
    ).toBe('title-too-long');
  });

  it.each(PLAN_PRIORITIES)('accepts the %s priority', (priority) => {
    expect(
      Option.isNone(
        validateSnapshot(snapshot({ entries: [entry({ priority })] }))
      )
    ).toBe(true);
  });

  it('rejects an unknown priority', () => {
    expect(
      rejectionOf(
        validateSnapshot(
          snapshot({
            entries: [entry({ priority: outOfBand<PlanPriority>() })],
          })
        )
      )
    ).toBe('invalid-priority');
  });

  it.each(ALL_STATUSES)('accepts the %s status', (status) => {
    expect(
      Option.isNone(
        validateSnapshot(snapshot({ entries: [entry({ status })] }))
      )
    ).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(
      rejectionOf(
        validateSnapshot(
          snapshot({
            entries: [entry({ status: outOfBand<PlanEntryStatus>() })],
          })
        )
      )
    ).toBe('illegal-status');
  });

  it('rejects a snapshot past the encoded byte limit', () => {
    // The entry-count limit is checked first, so the byte limit is only
    // reachable with at most MAX_PLAN_ENTRIES entries carrying long titles.
    const big = Array.from({ length: MAX_PLAN_ENTRIES }, (_, index) =>
      entry({
        entryId: `e${String(index)}`,
        title: 'x'.repeat(MAX_TITLE_BYTES),
      })
    );
    const error = validateSnapshot(snapshot({ entries: big }));
    expect(snapshotBytes(snapshot({ entries: big }))).toBeGreaterThan(
      MAX_SNAPSHOT_BYTES
    );
    expect(rejectionOf(error)).toBe('snapshot-too-large');
  });
});

describe('projectPlan', () => {
  it('projects every plannable unit as a pending entry', () => {
    const { snapshot: result } = projectPlan([unit(), unit({ id: 'u2' })]);
    expect(Option.getOrNull(result)?.entries).toHaveLength(2);
    expect(Option.getOrNull(result)?.entries[0]?.status).toBe('pending');
  });

  it('leaves out a unit that is not plannable', () => {
    const { snapshot: result } = projectPlan([
      unit(),
      unit({ id: 'u2', plannable: false }),
    ]);
    expect(Option.getOrNull(result)?.entries.map((e) => e.entryId)).toEqual([
      'u1',
    ]);
  });

  it('defaults an unstated priority to medium', () => {
    const { snapshot: result } = projectPlan([unit()]);
    expect(Option.getOrNull(result)?.entries[0]?.priority).toBe('medium');
  });

  it('keeps a stated priority', () => {
    const { snapshot: result } = projectPlan([unit({ priority: 'high' })]);
    expect(Option.getOrNull(result)?.entries[0]?.priority).toBe('high');
  });

  it('starts at revision one by default', () => {
    expect(Option.getOrNull(projectPlan([unit()]).snapshot)?.revision).toBe(1);
  });

  it('honours an explicit revision', () => {
    expect(Option.getOrNull(projectPlan([unit()], 7).snapshot)?.revision).toBe(
      7
    );
  });

  it('projects an empty plan from no units', () => {
    const { snapshot: result, error } = projectPlan([]);
    expect(Option.isNone(error)).toBe(true);
    expect(Option.getOrNull(result)?.entries).toEqual([]);
  });

  it('refuses a projection that would not validate', () => {
    const { snapshot: result, error } = projectPlan([
      unit({ id: 'dup' }),
      unit({ id: 'dup' }),
    ]);
    expect(rejectionOf(error)).toBe('duplicate-entry');
    expect(Option.isNone(result)).toBe(true);
  });
});

describe('replaceSnapshot', () => {
  it('accepts a snapshot at a later revision', () => {
    const { snapshot: next, error } = replaceSnapshot(
      snapshot({ revision: 1 }),
      snapshot({ revision: 2 })
    );
    expect(Option.isNone(error)).toBe(true);
    expect(next.revision).toBe(2);
  });

  it('refuses a snapshot at the same revision', () => {
    const current = snapshot({ revision: 3 });
    const { snapshot: next, error } = replaceSnapshot(
      current,
      snapshot({ revision: 3 })
    );
    expect(rejectionOf(error)).toBe('stale-revision');
    expect(next).toBe(current);
  });

  it('refuses a snapshot at an earlier revision', () => {
    const current = snapshot({ revision: 5 });
    const { error } = replaceSnapshot(current, snapshot({ revision: 2 }));
    expect(rejectionOf(error)).toBe('stale-revision');
  });

  it('refuses a later snapshot that does not validate', () => {
    const current = snapshot({ revision: 1 });
    const { snapshot: next, error } = replaceSnapshot(
      current,
      snapshot({ revision: 2, entries: [entry({ title: '' })] })
    );
    expect(rejectionOf(error)).toBe('missing-title');
    expect(next).toBe(current);
  });
});

describe('validateProgress', () => {
  it('accepts a legal transition', () => {
    expect(
      Option.isNone(
        validateProgress(
          snapshot({ entries: [entry({ status: 'pending' })] }),
          snapshot({ entries: [entry({ status: 'in-progress' })] })
        )
      )
    ).toBe(true);
  });

  it('accepts an entry whose status did not change', () => {
    expect(Option.isNone(validateProgress(snapshot(), snapshot()))).toBe(true);
  });

  it('refuses an illegal transition', () => {
    expect(
      rejectionOf(
        validateProgress(
          snapshot({ entries: [entry({ status: 'completed' })] }),
          snapshot({ entries: [entry({ status: 'in-progress' })] })
        )
      )
    ).toBe('illegal-status');
  });

  it('refuses a jump from pending straight to completed', () => {
    expect(
      rejectionOf(
        validateProgress(
          snapshot({ entries: [entry({ status: 'pending' })] }),
          snapshot({ entries: [entry({ status: 'completed' })] })
        )
      )
    ).toBe('illegal-status');
  });

  it('accepts an entry that is new in the later snapshot', () => {
    expect(
      Option.isNone(
        validateProgress(
          snapshot({ entries: [] }),
          snapshot({ entries: [entry({ status: 'completed' })] })
        )
      )
    ).toBe(true);
  });

  it('ignores an entry that vanished from the later snapshot', () => {
    expect(
      Option.isNone(
        validateProgress(
          snapshot({ entries: [entry({ status: 'pending' })] }),
          snapshot({ entries: [] })
        )
      )
    ).toBe(true);
  });

  it('names the entry whose transition was refused', () => {
    const error = validateProgress(
      snapshot({ entries: [entry({ entryId: 'bad', status: 'completed' })] }),
      snapshot({ entries: [entry({ entryId: 'bad', status: 'pending' })] })
    );
    expect(Option.isSome(error)).toBe(true);
    if (Option.isSome(error)) {
      expect(Option.getOrNull(error.value.entryId)).toBe('bad');
    }
  });

  it('checks every entry, not only the first', () => {
    expect(
      rejectionOf(
        validateProgress(
          snapshot({
            entries: [
              entry({ entryId: 'a', status: 'pending' }),
              entry({ entryId: 'b', status: 'completed' }),
            ],
          }),
          snapshot({
            entries: [
              entry({ entryId: 'a', status: 'in-progress' }),
              entry({ entryId: 'b', status: 'pending' }),
            ],
          })
        )
      )
    ).toBe('illegal-status');
  });
});
