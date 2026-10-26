import { Effect, Option } from 'effect';
import { describe, expect, it } from '@effect/vitest';

import { expectFailure, expectSuccess } from './effect.js';
import {
  DEDUPLICATION_WINDOW,
  MAX_EXACT,
  UsageError,
  addExact,
  applyConsumption,
  emptyUsage,
  makeUsageAccumulator,
  usagePayload,
  validateConsumption,
  validateContext,
  validateCost,
  type Consumption,
  type UsageSnapshot,
} from '../src/usage.js';

const consumption = (overrides: Partial<Consumption> = {}): Consumption => ({
  consumptionId: 'c1',
  inputTokens: 10,
  outputTokens: 5,
  ...overrides,
});

/** The rejection reason, asserted rather than merely "it refused". */
const rejectionOf = (error: Option.Option<UsageError>): string => {
  expect(Option.isSome(error)).toBe(true);
  if (Option.isNone(error)) return expect.unreachable();
  return error.value.rejection;
};

describe('addExact', () => {
  it('adds two small integers', () => {
    expect(Option.getOrNull(addExact(2, 3))).toBe(5);
  });

  it('adds zero', () => {
    expect(Option.getOrNull(addExact(0, 0))).toBe(0);
  });

  it('refuses a sum past the exact-integer limit', () => {
    expect(Option.isNone(addExact(MAX_EXACT, 1))).toBe(true);
  });

  it('accepts a sum landing exactly on the limit', () => {
    expect(Option.getOrNull(addExact(MAX_EXACT - 1, 1))).toBe(MAX_EXACT);
  });

  it('refuses a sum that is not a safe integer', () => {
    // Beyond MAX_SAFE_INTEGER addition rounds silently, so a total would look
    // plausible and be wrong.
    expect(Option.isNone(addExact(MAX_EXACT, MAX_EXACT))).toBe(true);
  });
});

describe('validateCost', () => {
  it('accepts an ISO 4217 currency with a whole minor amount', () => {
    expect(
      Option.isNone(validateCost({ currency: 'GBP', minorUnits: 250 }))
    ).toBe(true);
  });

  it('rejects a lowercase currency code', () => {
    expect(rejectionOf(validateCost({ currency: 'gbp', minorUnits: 1 }))).toBe(
      'invalid-currency'
    );
  });

  it('rejects a currency code of the wrong length', () => {
    expect(rejectionOf(validateCost({ currency: 'GB', minorUnits: 1 }))).toBe(
      'invalid-currency'
    );
  });

  it('rejects a non-integer amount', () => {
    expect(
      rejectionOf(validateCost({ currency: 'GBP', minorUnits: 1.5 }))
    ).toBe('non-integer');
  });

  it('rejects a negative amount', () => {
    expect(rejectionOf(validateCost({ currency: 'GBP', minorUnits: -1 }))).toBe(
      'negative-value'
    );
  });

  it('rejects an amount past the exact-integer limit', () => {
    expect(
      rejectionOf(validateCost({ currency: 'GBP', minorUnits: MAX_EXACT + 2 }))
    ).toBe('overflow');
  });
});

describe('validateContext', () => {
  it('accepts a plausible window', () => {
    expect(Option.isNone(validateContext({ used: 10, limit: 100 }))).toBe(true);
  });

  it('rejects a limit below one', () => {
    expect(rejectionOf(validateContext({ used: 0, limit: 0 }))).toBe(
      'invalid-context'
    );
  });

  it('rejects a non-integer limit', () => {
    expect(rejectionOf(validateContext({ used: 0, limit: 1.5 }))).toBe(
      'invalid-context'
    );
  });

  it('rejects negative use', () => {
    expect(rejectionOf(validateContext({ used: -1, limit: 10 }))).toBe(
      'invalid-context'
    );
  });

  it('permits use above the limit, because a provider may lower a limit between turns', () => {
    expect(Option.isNone(validateContext({ used: 200, limit: 100 }))).toBe(
      true
    );
  });
});

describe('validateConsumption', () => {
  it('accepts a minimal consumption', () => {
    expect(Option.isNone(validateConsumption(consumption()))).toBe(true);
  });

  it('rejects a consumption with no identity, because a retry would be indistinguishable', () => {
    expect(
      rejectionOf(validateConsumption(consumption({ consumptionId: '' })))
    ).toBe('missing-identity');
  });

  it('rejects a negative input count', () => {
    expect(
      rejectionOf(validateConsumption(consumption({ inputTokens: -1 })))
    ).toBe('negative-value');
  });

  it('rejects a non-integer output count', () => {
    expect(
      rejectionOf(validateConsumption(consumption({ outputTokens: 1.5 })))
    ).toBe('non-integer');
  });

  it('rejects a negative cached count', () => {
    expect(
      rejectionOf(validateConsumption(consumption({ cachedTokens: -1 })))
    ).toBe('negative-value');
  });

  it('treats an absent cached count as zero rather than rejecting it', () => {
    expect(Option.isNone(validateConsumption(consumption()))).toBe(true);
  });

  it('rejects an invalid nested cost', () => {
    expect(
      rejectionOf(
        validateConsumption(
          consumption({ cost: { currency: 'gbp', minorUnits: 1 } })
        )
      )
    ).toBe('invalid-currency');
  });

  it('rejects an invalid nested context', () => {
    expect(
      rejectionOf(
        validateConsumption(consumption({ context: { used: 0, limit: 0 } }))
      )
    ).toBe('invalid-context');
  });
});

describe('applyConsumption', () => {
  it('adds the token counts to the running snapshot', () => {
    const { snapshot } = applyConsumption(emptyUsage, consumption());
    expect(snapshot.inputTokens).toBe(10);
    expect(snapshot.outputTokens).toBe(5);
    expect(snapshot.totalTokens).toBe(15);
  });

  it('excludes cached tokens from the total, counting them separately', () => {
    const { snapshot } = applyConsumption(
      emptyUsage,
      consumption({ cachedTokens: 7 })
    );
    expect(snapshot.cachedTokens).toBe(7);
    expect(snapshot.totalTokens).toBe(15);
  });

  it('advances the revision by one', () => {
    const { snapshot } = applyConsumption(emptyUsage, consumption());
    expect(snapshot.revision).toBe(emptyUsage.revision + 1);
  });

  it('returns the prior snapshot untouched when the consumption is refused', () => {
    const { snapshot, error } = applyConsumption(
      emptyUsage,
      consumption({ consumptionId: '' })
    );
    expect(snapshot).toBe(emptyUsage);
    expect(rejectionOf(error)).toBe('missing-identity');
  });

  it('accumulates across two consumptions', () => {
    const first = applyConsumption(emptyUsage, consumption()).snapshot;
    const second = applyConsumption(
      first,
      consumption({ consumptionId: 'c2', inputTokens: 1, outputTokens: 2 })
    ).snapshot;
    expect(second.totalTokens).toBe(18);
    expect(second.revision).toBe(2);
  });

  it('refuses when the token total would exceed exact arithmetic', () => {
    const near: UsageSnapshot = { ...emptyUsage, inputTokens: MAX_EXACT - 1 };
    const { error } = applyConsumption(near, consumption({ inputTokens: 10 }));
    expect(rejectionOf(error)).toBe('overflow');
  });

  describe('cost', () => {
    it('adopts the first cost it is given', () => {
      const { snapshot } = applyConsumption(
        emptyUsage,
        consumption({ cost: { currency: 'GBP', minorUnits: 100 } })
      );
      expect(Option.getOrNull(snapshot.cost)).toEqual({
        currency: 'GBP',
        minorUnits: 100,
      });
    });

    it('adds a second cost in the same currency', () => {
      const first = applyConsumption(
        emptyUsage,
        consumption({ cost: { currency: 'GBP', minorUnits: 100 } })
      ).snapshot;
      const { snapshot } = applyConsumption(
        first,
        consumption({
          consumptionId: 'c2',
          cost: { currency: 'GBP', minorUnits: 50 },
        })
      );
      expect(Option.getOrNull(snapshot.cost)).toEqual({
        currency: 'GBP',
        minorUnits: 150,
      });
    });

    it('refuses to add two different currencies', () => {
      const first = applyConsumption(
        emptyUsage,
        consumption({ cost: { currency: 'GBP', minorUnits: 100 } })
      ).snapshot;
      const { snapshot, error } = applyConsumption(
        first,
        consumption({
          consumptionId: 'c2',
          cost: { currency: 'USD', minorUnits: 50 },
        })
      );
      expect(rejectionOf(error)).toBe('currency-mismatch');
      expect(snapshot).toBe(first);
    });

    it('starts complete and stays complete while every consumption priced itself', () => {
      expect(emptyUsage.costComplete).toBe(true);
      const { snapshot } = applyConsumption(
        emptyUsage,
        consumption({ cost: { currency: 'GBP', minorUnits: 1 } })
      );
      expect(snapshot.costComplete).toBe(true);
    });

    it('marks the cost incomplete when a consumption carried no price', () => {
      // Unknown, not zero: the total becomes a lower bound and says so.
      const { snapshot } = applyConsumption(emptyUsage, consumption());
      expect(snapshot.costComplete).toBe(false);
    });

    it('never becomes complete again once a price was missing', () => {
      const unpriced = applyConsumption(emptyUsage, consumption()).snapshot;
      const { snapshot } = applyConsumption(
        unpriced,
        consumption({
          consumptionId: 'c2',
          cost: { currency: 'GBP', minorUnits: 1 },
        })
      );
      expect(snapshot.costComplete).toBe(false);
    });

    it('refuses when the summed cost would exceed exact arithmetic', () => {
      const first = applyConsumption(
        emptyUsage,
        consumption({ cost: { currency: 'GBP', minorUnits: MAX_EXACT - 1 } })
      ).snapshot;
      const { error } = applyConsumption(
        first,
        consumption({
          consumptionId: 'c2',
          cost: { currency: 'GBP', minorUnits: 10 },
        })
      );
      expect(rejectionOf(error)).toBe('overflow');
    });
  });

  describe('context', () => {
    it('records the context the consumption reported', () => {
      const { snapshot } = applyConsumption(
        emptyUsage,
        consumption({ context: { used: 10, limit: 100 } })
      );
      expect(Option.getOrNull(snapshot.context)).toEqual({
        used: 10,
        limit: 100,
      });
    });

    it('keeps the prior context when a consumption reported none', () => {
      const first = applyConsumption(
        emptyUsage,
        consumption({ context: { used: 10, limit: 100 } })
      ).snapshot;
      const { snapshot } = applyConsumption(
        first,
        consumption({ consumptionId: 'c2' })
      );
      expect(Option.getOrNull(snapshot.context)).toEqual({
        used: 10,
        limit: 100,
      });
    });

    it('replaces rather than accumulates the context', () => {
      const first = applyConsumption(
        emptyUsage,
        consumption({ context: { used: 10, limit: 100 } })
      ).snapshot;
      const { snapshot } = applyConsumption(
        first,
        consumption({
          consumptionId: 'c2',
          context: { used: 20, limit: 200 },
        })
      );
      expect(Option.getOrNull(snapshot.context)).toEqual({
        used: 20,
        limit: 200,
      });
    });
  });
});

describe('usagePayload', () => {
  it('names itself session-usage', () => {
    expect(usagePayload(emptyUsage)['kind']).toBe('session-usage');
  });

  it('leaves the cost fields undefined when no cost is known', () => {
    const payload = usagePayload(emptyUsage);
    expect(payload['costMinorUnits']).toBeUndefined();
    expect(payload['costCurrency']).toBeUndefined();
  });

  it('flattens a known cost into its two fields', () => {
    const snapshot = applyConsumption(
      emptyUsage,
      consumption({ cost: { currency: 'GBP', minorUnits: 100 } })
    ).snapshot;
    const payload = usagePayload(snapshot);
    expect(payload['costMinorUnits']).toBe(100);
    expect(payload['costCurrency']).toBe('GBP');
  });

  it('flattens a known context into its two fields', () => {
    const snapshot = applyConsumption(
      emptyUsage,
      consumption({ context: { used: 10, limit: 100 } })
    ).snapshot;
    const payload = usagePayload(snapshot);
    expect(payload['contextUsed']).toBe(10);
    expect(payload['contextLimit']).toBe(100);
  });

  it('carries no field for a provider response or a key, so neither can travel', () => {
    const payload = usagePayload(emptyUsage);
    expect(Object.keys(payload).sort()).toEqual([
      'cachedTokens',
      'contextLimit',
      'contextUsed',
      'costComplete',
      'costCurrency',
      'costMinorUnits',
      'inputTokens',
      'kind',
      'outputTokens',
      'revision',
      'totalTokens',
    ]);
  });

  it('is frozen, so a caller cannot edit a committed payload', () => {
    expect(Object.isFrozen(usagePayload(emptyUsage))).toBe(true);
  });
});

describe('makeUsageAccumulator', () => {
  it.effect('starts from the empty snapshot', () =>
    Effect.gen(function* () {
      const accumulator = yield* expectSuccess(makeUsageAccumulator());
      expect(yield* expectSuccess(accumulator.snapshot)).toEqual(emptyUsage);
    })
  );

  it.effect('counts a consumption at the expected revision', () =>
    Effect.gen(function* () {
      const accumulator = yield* expectSuccess(makeUsageAccumulator());
      const snapshot = yield* expectSuccess(
        accumulator.count(consumption(), 0)
      );
      expect(snapshot.totalTokens).toBe(15);
      expect(snapshot.revision).toBe(1);
    })
  );

  it.effect('refuses a count at the wrong revision', () =>
    Effect.gen(function* () {
      const accumulator = yield* expectSuccess(makeUsageAccumulator());
      const error = yield* expectFailure(accumulator.count(consumption(), 7));
      expect(error.rejection).toBe('revision-conflict');
    })
  );

  it.effect(
    'gives a retry of the same id the answer its original produced',
    () =>
      Effect.gen(function* () {
        const accumulator = yield* expectSuccess(makeUsageAccumulator());
        const first = yield* expectSuccess(accumulator.count(consumption(), 0));
        const retry = yield* expectSuccess(accumulator.count(consumption(), 1));
        expect(retry).toEqual(first);
        expect(retry.totalTokens).toBe(15);
      })
  );

  it.effect('counts a genuinely different consumption', () =>
    Effect.gen(function* () {
      const accumulator = yield* expectSuccess(makeUsageAccumulator());
      yield* expectSuccess(accumulator.count(consumption(), 0));
      const snapshot = yield* expectSuccess(
        accumulator.count(consumption({ consumptionId: 'c2' }), 1)
      );
      expect(snapshot.totalTokens).toBe(30);
    })
  );

  it.effect('propagates a validation refusal through the error channel', () =>
    Effect.gen(function* () {
      const accumulator = yield* expectSuccess(makeUsageAccumulator());
      const error = yield* expectFailure(
        accumulator.count(consumption({ inputTokens: -1 }), 0)
      );
      expect(error.rejection).toBe('negative-value');
    })
  );

  it.effect('resumes from a restored snapshot', () =>
    Effect.gen(function* () {
      const restored = applyConsumption(emptyUsage, consumption()).snapshot;
      const accumulator = yield* expectSuccess(makeUsageAccumulator(restored));
      expect(yield* expectSuccess(accumulator.snapshot)).toEqual(restored);
    })
  );

  it.effect(
    'does not re-count an id the restored session already counted',
    () =>
      Effect.gen(function* () {
        const restored = applyConsumption(emptyUsage, consumption()).snapshot;
        const accumulator = yield* expectSuccess(
          makeUsageAccumulator(restored, ['c1'])
        );
        const snapshot = yield* expectSuccess(
          accumulator.count(consumption(), 1)
        );
        expect(snapshot).toEqual(restored);
      })
  );

  it.effect('forgets an id once it falls out of the deduplication window', () =>
    Effect.gen(function* () {
      const ids = Array.from(
        { length: DEDUPLICATION_WINDOW },
        (_, index) => `seed-${index}`
      );
      const accumulator = yield* expectSuccess(
        makeUsageAccumulator(emptyUsage, ['old', ...ids])
      );
      // 'old' was pushed past the window by the seeds, so it counts as new.
      const snapshot = yield* expectSuccess(
        accumulator.count(consumption({ consumptionId: 'old' }), 0)
      );
      expect(snapshot.totalTokens).toBe(15);
    })
  );

  it.effect('still remembers the most recent id within the window', () =>
    Effect.gen(function* () {
      const accumulator = yield* expectSuccess(
        makeUsageAccumulator(emptyUsage, ['recent'])
      );
      const snapshot = yield* expectSuccess(
        accumulator.count(consumption({ consumptionId: 'recent' }), 0)
      );
      expect(snapshot).toEqual(emptyUsage);
    })
  );
});
