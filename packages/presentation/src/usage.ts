/**
 * Usage — cumulative token and cost totals for one Session, plus the current context window.
 *
 * Every value is an exact integer: tokens are counts, and cost is in minor currency units.
 * Accumulating money or token counts in floating point drifts, and a total that is wrong in
 * the last place is a total nobody can reconcile against a provider's bill.
 */

import { Data, Effect, HashSet, Option } from 'effect';

/** The largest exact integer arithmetic here may produce. */
export const MAX_EXACT = Number.MAX_SAFE_INTEGER;

/**
 * How many consumption ids the accumulator remembers for deduplication.
 *
 * A bounded window rather than every id ever seen: the set would otherwise grow without limit
 * for the life of a Session. A duplicate older than the window is counted twice, which is the
 * ceiling this design accepts — retries arrive close behind their original.
 */
export const DEDUPLICATION_WINDOW = 1024;

/** Why a usage update was refused. */
export type UsageRejection =
  | 'negative-value'
  | 'non-integer'
  | 'invalid-currency'
  | 'currency-mismatch'
  | 'invalid-context'
  | 'overflow'
  | 'revision-conflict'
  | 'missing-identity';

/** A typed usage refusal. */
export class UsageError extends Data.TaggedError('UsageError')<{
  readonly rejection: UsageRejection;
  readonly detail: Option.Option<string>;
}> {
  /** Carries the offending number or currency in the detail, so a log line is actionable. */
  override get message(): string {
    return `usage update refused: ${this.rejection}${Option.match(this.detail, {
      onNone: () => '',
      onSome: (detail) => ` (${detail})`,
    })}`;
  }
}

/** An amount of money as an exact count of minor units. */
export interface MinorCost {
  /** ISO 4217, three uppercase letters. */
  readonly currency: string;
  /** Minor units, so 1234 in GBP is £12.34. Never a fraction. */
  readonly minorUnits: number;
}

/** The current conversation window. Stated, not accumulated. */
export interface ContextWindow {
  /** Tokens currently in the window. May legitimately exceed `limit` — see `validateContext`. */
  readonly used: number;
  /** The provider's window size, at least 1. Providers change it between turns. */
  readonly limit: number;
}

/** One reported consumption. The id is what makes a retry idempotent. */
export interface Consumption {
  /**
   * Non-empty, and the SAME id on a retry as on the original attempt. A generated-per-attempt
   * id defeats the deduplication and doubles the totals, which no later reconciliation can
   * detect.
   */
  readonly consumptionId: string;
  /** Counted into `totalTokens`. A non-negative integer. */
  readonly inputTokens: number;
  /** Counted into `totalTokens`. A non-negative integer. */
  readonly outputTokens: number;
  /**
   * Accumulated separately and deliberately EXCLUDED from `totalTokens`, so a cache hit does
   * not inflate a figure a person reads as work done. Absent is treated as zero.
   */
  readonly cachedTokens?: number;
  /** Absent when the provider did not report a cost. Absent is not zero. */
  readonly cost?: MinorCost;
  /** The window after this consumption, when the provider stated one. */
  readonly context?: ContextWindow;
}

/** The cumulative totals at one revision. */
export interface UsageSnapshot {
  /**
   * Rises by one per counted consumption, and never on a refused or deduplicated one. A caller
   * fences `count` with the revision it believes is current.
   */
  readonly revision: number;
  /** Cumulative input tokens. */
  readonly inputTokens: number;
  /** Cumulative output tokens. */
  readonly outputTokens: number;
  /** Cumulative cached tokens, reported alongside the total rather than inside it. */
  readonly cachedTokens: number;
  /** `inputTokens + outputTokens`. Cached tokens are NOT part of it. */
  readonly totalTokens: number;
  /** `None` until some counted consumption reported a cost. */
  readonly cost: Option.Option<MinorCost>;
  /**
   * False when a counted consumption reported no cost, so the total is a lower bound.
   *
   * Without this a client cannot tell "£0.12 so far" from "£0.12 of an unknown larger
   * amount", and only one of those is safe to show a person as the cost.
   */
  readonly costComplete: boolean;
  /** The most recent stated window. Replaced, not accumulated — compaction shrinks it. */
  readonly context: Option.Option<ContextWindow>;
}

/** An accumulator over one Session's usage. */
export interface UsageAccumulator {
  /**
   * Reads the current totals. An Effect rather than a field because the value changes as
   * consumptions are counted — a plain property would hand out a figure that quietly ages.
   */
  readonly snapshot: Effect.Effect<UsageSnapshot>;
  /**
   * Counts one consumption, fenced by the revision the caller believes is current.
   *
   * A consumption already counted returns the current snapshot unchanged, so a retry and its
   * original produce one total rather than two.
   */
  readonly count: (
    consumption: Consumption,
    expectedRevision: number
  ) => Effect.Effect<UsageSnapshot, UsageError>;
}

/**
 * ISO 4217: three UPPERCASE letters, with no case folding.
 *
 * `'gbp'` is refused rather than normalised. Currencies are compared for equality when costs
 * are added, and a validator that quietly rewrote its input would make two spellings of one
 * currency behave as two currencies at the point of comparison.
 */
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * The single constructor for every refusal in this module.
 *
 * It keeps the `Option` wrapping of an optional detail in one place, so no call site can build
 * an error whose detail is the string `"undefined"`.
 */
const refuse = (rejection: UsageRejection, detail?: string): UsageError =>
  new UsageError({ rejection, detail: Option.fromNullishOr(detail) });

/** The empty snapshot a Session starts from. */
export const emptyUsage: UsageSnapshot = Object.freeze({
  revision: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  totalTokens: 0,
  cost: Option.none(),
  costComplete: true,
  context: Option.none(),
});

/** Adds two exact integers, refusing a result the number type cannot hold exactly. */
export const addExact = (
  left: number,
  right: number
): Option.Option<number> => {
  const sum = left + right;
  // Beyond MAX_SAFE_INTEGER addition silently rounds, so a total would look plausible and be
  // wrong. Refusing is the only honest answer.
  return sum > MAX_EXACT || !Number.isSafeInteger(sum)
    ? Option.none()
    : Option.some(sum);
};

/**
 * The one bounds check every count in this module passes: an integer, not negative, within
 * exact arithmetic.
 *
 * `label` is the noun phrase that appears in the error detail — "the input tokens", "the
 * cost". Write it so `${label} is ${value}` reads as a sentence, since that is the only clue a
 * reader gets about which of several counts failed.
 *
 * `Number.isInteger`, not `isSafeInteger`: an unsafe integer is reported as an overflow rather
 * than as a non-integer, which is the more useful of the two answers.
 */
const checkCount = (
  value: number,
  label: string
): Option.Option<UsageError> => {
  if (!Number.isInteger(value)) {
    return Option.some(refuse('non-integer', `${label} is ${value}`));
  }
  if (value < 0) {
    return Option.some(refuse('negative-value', `${label} is ${value}`));
  }
  if (value > MAX_EXACT) {
    return Option.some(refuse('overflow', `${label} is ${value}`));
  }
  return Option.none();
};

/** Rejects a cost whose currency or amount is unusable. */
export const validateCost = (cost: MinorCost): Option.Option<UsageError> => {
  if (
    typeof cost.currency !== 'string' ||
    !CURRENCY_PATTERN.test(cost.currency)
  ) {
    return Option.some(
      refuse('invalid-currency', `'${String(cost.currency)}' is not ISO 4217`)
    );
  }
  return checkCount(cost.minorUnits, 'the cost');
};

/** Rejects a context window that cannot describe a real conversation. */
export const validateContext = (
  context: ContextWindow
): Option.Option<UsageError> => {
  if (!Number.isInteger(context.limit) || context.limit < 1) {
    return Option.some(
      refuse('invalid-context', `the limit is ${context.limit}`)
    );
  }
  if (!Number.isInteger(context.used) || context.used < 0) {
    return Option.some(refuse('invalid-context', `the use is ${context.used}`));
  }
  // `used` above `limit` is permitted: a provider can raise or lower a limit between turns,
  // and refusing would discard a true measurement to defend a stale bound.
  return Option.none();
};

/** Rejects a consumption before any total moves. */
export const validateConsumption = (
  consumption: Consumption
): Option.Option<UsageError> => {
  if (
    typeof consumption.consumptionId !== 'string' ||
    consumption.consumptionId.length === 0
  ) {
    // Without an id a retry is indistinguishable from a second consumption.
    return Option.some(refuse('missing-identity'));
  }
  for (const [value, label] of [
    [consumption.inputTokens, 'the input tokens'],
    [consumption.outputTokens, 'the output tokens'],
    [consumption.cachedTokens ?? 0, 'the cached tokens'],
  ] as const) {
    const invalid = checkCount(value, label);
    if (Option.isSome(invalid)) return invalid;
  }
  const consumptionCost = Option.fromNullishOr(consumption.cost);
  if (Option.isSome(consumptionCost)) {
    const invalid = validateCost(consumptionCost.value);
    if (Option.isSome(invalid)) return invalid;
  }
  const consumptionContext = Option.fromNullishOr(consumption.context);
  if (Option.isSome(consumptionContext)) {
    const invalid = validateContext(consumptionContext.value);
    if (Option.isSome(invalid)) return invalid;
  }
  return Option.none();
};

/**
 * Adds one consumption to a snapshot.
 *
 * Pure, so the same arithmetic is testable without a Session. Returns the prior snapshot
 * untouched alongside the error when anything refuses.
 */
export const applyConsumption = (
  current: UsageSnapshot,
  consumption: Consumption
): {
  readonly snapshot: UsageSnapshot;
  readonly error: Option.Option<UsageError>;
} => {
  const invalid = validateConsumption(consumption);
  if (Option.isSome(invalid)) return { snapshot: current, error: invalid };

  const cached = consumption.cachedTokens ?? 0;
  const sums = Option.all({
    inputTokens: addExact(current.inputTokens, consumption.inputTokens),
    outputTokens: addExact(current.outputTokens, consumption.outputTokens),
    cachedTokens: addExact(current.cachedTokens, cached),
  });
  if (Option.isNone(sums)) {
    return { snapshot: current, error: Option.some(refuse('overflow')) };
  }
  const { inputTokens, outputTokens, cachedTokens } = sums.value;

  const total = addExact(inputTokens, outputTokens);
  if (Option.isNone(total)) {
    return { snapshot: current, error: Option.some(refuse('overflow')) };
  }

  let cost = current.cost;
  let costComplete = current.costComplete;

  const consumptionCost = Option.fromNullishOr(consumption.cost);
  if (Option.isNone(consumptionCost)) {
    // Unknown, not zero. The total becomes a lower bound and says so.
    costComplete = false;
  } else if (Option.isNone(cost)) {
    cost = Option.some(consumptionCost.value);
  } else {
    const running = cost.value;
    if (running.currency !== consumptionCost.value.currency) {
      // Adding two currencies would produce a number in neither of them.
      return {
        snapshot: current,
        error: Option.some(
          refuse(
            'currency-mismatch',
            `${running.currency} and ${consumptionCost.value.currency}`
          )
        ),
      };
    }
    const minorUnits = addExact(
      running.minorUnits,
      consumptionCost.value.minorUnits
    );
    if (Option.isNone(minorUnits)) {
      return { snapshot: current, error: Option.some(refuse('overflow')) };
    }
    cost = Option.some({
      currency: running.currency,
      minorUnits: minorUnits.value,
    });
  }

  return {
    snapshot: Object.freeze({
      revision: current.revision + 1,
      inputTokens,
      outputTokens,
      cachedTokens,
      totalTokens: total.value,
      cost,
      costComplete,
      context: Option.match(Option.fromNullishOr(consumption.context), {
        onNone: () => current.context,
        onSome: (context) => Option.some(Object.freeze({ ...context })),
      }),
    }),
    error: Option.none(),
  };
};

/**
 * The payload one committed usage update carries.
 *
 * There is no field for a provider response or an API key, so neither can travel. Excluding
 * them structurally beats filtering them, because a filter has to be kept in step with every
 * provider that adds a field.
 */
export const usagePayload = (
  snapshot: UsageSnapshot
): Readonly<Record<string, unknown>> =>
  Object.freeze({
    kind: 'session-usage',
    revision: snapshot.revision,
    inputTokens: snapshot.inputTokens,
    outputTokens: snapshot.outputTokens,
    cachedTokens: snapshot.cachedTokens,
    totalTokens: snapshot.totalTokens,
    costMinorUnits: Option.getOrUndefined(
      Option.map(snapshot.cost, (cost) => cost.minorUnits)
    ),
    costCurrency: Option.getOrUndefined(
      Option.map(snapshot.cost, (cost) => cost.currency)
    ),
    costComplete: snapshot.costComplete,
    contextUsed: Option.getOrUndefined(
      Option.map(snapshot.context, (context) => context.used)
    ),
    contextLimit: Option.getOrUndefined(
      Option.map(snapshot.context, (context) => context.limit)
    ),
  });

/**
 * Build an accumulator, optionally resuming from a restored snapshot.
 *
 * `countedIds` carries the ids a restored Session already counted, so a consumption in flight
 * across a restart is not counted a second time on resume.
 */
export const makeUsageAccumulator = (
  restored: UsageSnapshot = emptyUsage,
  countedIds: readonly string[] = []
): Effect.Effect<UsageAccumulator> =>
  Effect.sync(() => {
    let snapshot = restored;
    let counted = HashSet.fromIterable(countedIds.slice(-DEDUPLICATION_WINDOW));
    const order: string[] = [...counted];

    const remember = (id: string): void => {
      counted = HashSet.add(counted, id);
      order.push(id);
      while (order.length > DEDUPLICATION_WINDOW) {
        const evicted = order.shift();
        Option.map(Option.fromNullishOr(evicted), (value) => {
          counted = HashSet.remove(counted, value);
        });
      }
    };

    return {
      snapshot: Effect.sync(() => snapshot),

      count: (consumption, expectedRevision) =>
        Effect.suspend(() => {
          if (expectedRevision !== snapshot.revision) {
            return Effect.fail(
              refuse(
                'revision-conflict',
                `expected ${expectedRevision}, found ${snapshot.revision}`
              )
            );
          }
          if (HashSet.has(counted, consumption.consumptionId)) {
            // Already counted. The retry gets the same answer its original produced.
            return Effect.succeed(snapshot);
          }

          const result = applyConsumption(snapshot, consumption);
          if (Option.isSome(result.error)) {
            return Effect.fail(result.error.value);
          }
          snapshot = result.snapshot;
          remember(consumption.consumptionId);
          return Effect.succeed(snapshot);
        }),
    } satisfies UsageAccumulator;
  });
