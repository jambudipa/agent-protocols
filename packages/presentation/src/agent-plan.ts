/**
 * Agent Plan — the complete, ordered plan a client is shown for one Prompt Turn.
 *
 * Every update is a WHOLE snapshot, never a delta. A client that missed one delta would show
 * a plan that never existed and have no way to know; replacing the snapshot means the worst
 * case is showing an older plan, which is recoverable.
 *
 * The projector is deliberately narrow. Only approved Goals and declared major phases become
 * entries — graph nodes, tool mechanics, and hidden reasoning are not "extra detail" a client
 * might like, they are internals whose shape is not a contract and whose content may be
 * sensitive.
 */

import { Data, HashMap, HashSet, Option, Schema } from 'effect';

import { utf8Bytes } from './utf8.js';

/** How far one plan entry has progressed. */
export type PlanEntryStatus =
  'pending' | 'in-progress' | 'completed' | 'failed' | 'skipped';

/**
 * The moves each status permits, and the authoritative list of statuses.
 *
 * `completed`, `failed` and `skipped` map to nothing: an entry a client has already shown as
 * finished cannot be reopened, because the client has no way to undo what a person read.
 * `validateSnapshot` also uses membership of this table to reject an unrecognised status, so a
 * new status added to `PlanEntryStatus` and not to this table is rejected at runtime.
 */
const LEGAL_ENTRY_TRANSITIONS: Readonly<
  Record<PlanEntryStatus, readonly PlanEntryStatus[]>
> = Object.freeze({
  pending: ['in-progress', 'skipped', 'failed'],
  'in-progress': ['completed', 'failed', 'skipped'],
  completed: [],
  failed: [],
  skipped: [],
});

/** Reports whether an entry status change is one the plan permits. */
export const isLegalEntryTransition = (
  from: PlanEntryStatus,
  to: PlanEntryStatus
): boolean => LEGAL_ENTRY_TRANSITIONS[from].includes(to);

/** How important an entry is, as declared by the plan. */
export type PlanPriority = 'high' | 'medium' | 'low';

/** The priorities a plan may declare. Anything else is a client bug, not a new level. */
export const PLAN_PRIORITIES: readonly PlanPriority[] = Object.freeze([
  'high',
  'medium',
  'low',
]);

/** Largest number of entries in one plan. */
export const MAX_PLAN_ENTRIES = 128;

/** Longest entry title. */
export const MAX_TITLE_BYTES = 512;

/** Largest encoded snapshot. */
export const MAX_SNAPSHOT_BYTES = 64 * 1024;

/** One entry in a plan. */
export interface PlanEntry {
  /**
   * Identity a later snapshot matches this entry by. Unique within one snapshot, and stable
   * across replacements — a client tracks progress by this value alone.
   */
  readonly entryId: string;
  /** What the client renders. Non-empty, and at most `MAX_TITLE_BYTES` UTF-8 bytes. */
  readonly title: string;
  /** As the plan declared it. `projectPlan` writes `medium` when the unit declared nothing. */
  readonly priority: PlanPriority;
  /** Where the entry has reached. A replacement may only move it along a legal transition. */
  readonly status: PlanEntryStatus;
}

/** One complete plan snapshot. */
export interface PlanSnapshot {
  /** Increments with each replacement, so a later snapshot is identifiable as later. */
  readonly revision: number;
  /** The whole plan, in render order. Empty is a legitimate plan, not a missing one. */
  readonly entries: readonly PlanEntry[];
}

/**
 * The encoded shape of one entry, used only to measure a snapshot as it would be published.
 *
 * Nothing here decodes an entry, so the `PlanEntryId` brand never reaches `PlanEntry` — it
 * exists to stop an arbitrary string being written into the encoder by mistake.
 */
const PlanEntrySchema = Schema.Struct({
  entryId: Schema.String.pipe(Schema.brand('PlanEntryId')),
  title: Schema.String,
  priority: Schema.Literals(['high', 'medium', 'low']),
  status: Schema.Literals([
    'pending',
    'in-progress',
    'completed',
    'failed',
    'skipped',
  ]),
}).annotate({ identifier: 'AgentPlanEntry' });

/**
 * The encoder `snapshotBytes` measures with: the entries array as JSON.
 *
 * The revision is not part of it, so `MAX_SNAPSHOT_BYTES` bounds the content a client must
 * hold, not the bookkeeping around it.
 */
const PlanEntriesJson = Schema.fromJsonString(Schema.Array(PlanEntrySchema));

/** Why a plan was refused. */
export type PlanRejection =
  | 'duplicate-entry'
  | 'missing-identity'
  | 'missing-title'
  | 'invalid-priority'
  | 'illegal-status'
  | 'too-many-entries'
  | 'title-too-long'
  | 'snapshot-too-large'
  | 'stale-revision';

/** A typed plan refusal naming the entry, when one is at fault. */
export class AgentPlanError extends Data.TaggedError('AgentPlanError')<{
  readonly rejection: PlanRejection;
  readonly entryId: Option.Option<string>;
  readonly detail: Option.Option<string>;
}> {
  /** Names the offending entry, or the plan when no single entry is at fault. */
  override get message(): string {
    const where = Option.match(this.entryId, {
      onNone: () => 'the plan',
      onSome: (id) => `plan entry '${id}'`,
    });
    return `${where} refused: ${this.rejection}${Option.match(this.detail, {
      onNone: () => '',
      onSome: (detail) => ` (${detail})`,
    })}`;
  }
}

/**
 * The single constructor for every refusal in this module.
 *
 * It exists so the `Option` wrapping of an optional detail lives in one place: a call site
 * passes a plain string or nothing, and cannot accidentally build an error whose detail is the
 * string `"undefined"`.
 */
const fail = (
  rejection: PlanRejection,
  entryId: Option.Option<string>,
  detail?: string
): AgentPlanError =>
  new AgentPlanError({
    rejection,
    entryId,
    detail: Option.fromNullishOr(detail),
  });

/** Encoded size of a snapshot, measured as it would be published. */
export const snapshotBytes = (snapshot: PlanSnapshot): number =>
  utf8Bytes(Schema.encodeUnknownSync(PlanEntriesJson)(snapshot.entries));

/**
 * Validates one complete snapshot.
 *
 * An EMPTY plan is explicitly permitted. "This turn needs no plan" is a real answer, and
 * forcing a placeholder entry would make every client render a step that does not exist.
 */
export const validateSnapshot = (
  snapshot: PlanSnapshot
): Option.Option<AgentPlanError> => {
  if (snapshot.entries.length > MAX_PLAN_ENTRIES) {
    return Option.some(
      fail(
        'too-many-entries',
        Option.none(),
        `${snapshot.entries.length} exceeds ${MAX_PLAN_ENTRIES}`
      )
    );
  }

  let seen = HashSet.empty<string>();
  for (const entry of snapshot.entries) {
    if (entry.entryId.length === 0) {
      return Option.some(
        fail('missing-identity', Option.none(), 'an entry has no identity')
      );
    }
    if (HashSet.has(seen, entry.entryId)) {
      // Two entries with one identity make progress ambiguous: an update naming that id
      // could mean either.
      return Option.some(fail('duplicate-entry', Option.some(entry.entryId)));
    }
    seen = HashSet.add(seen, entry.entryId);

    if (entry.title.length === 0) {
      return Option.some(fail('missing-title', Option.some(entry.entryId)));
    }
    if (utf8Bytes(entry.title) > MAX_TITLE_BYTES) {
      return Option.some(
        fail(
          'title-too-long',
          Option.some(entry.entryId),
          `exceeds ${MAX_TITLE_BYTES} bytes`
        )
      );
    }
    if (!PLAN_PRIORITIES.includes(entry.priority)) {
      return Option.some(
        fail(
          'invalid-priority',
          Option.some(entry.entryId),
          `'${String(entry.priority)}'`
        )
      );
    }
    if (!(entry.status in LEGAL_ENTRY_TRANSITIONS)) {
      return Option.some(
        fail(
          'illegal-status',
          Option.some(entry.entryId),
          `'${String(entry.status)}'`
        )
      );
    }
  }

  const size = snapshotBytes(snapshot);
  if (size > MAX_SNAPSHOT_BYTES) {
    return Option.some(
      fail(
        'snapshot-too-large',
        Option.none(),
        `${size} bytes exceeds ${MAX_SNAPSHOT_BYTES}`
      )
    );
  }

  return Option.none();
};

/** What the projector is allowed to see. Anything not on this list is internal. */
export interface PlannableUnit {
  /**
   * Becomes the entry's `entryId`. Unique among the plannable units of one projection —
   * `projectPlan` refuses the whole plan when two units share an id.
   */
  readonly id: string;
  /** Becomes the entry title, and is bounded by `MAX_TITLE_BYTES` like any other. */
  readonly title: string;
  /** Absent means "not stated", not "low". `projectPlan` writes `medium` in that case. */
  readonly priority?: PlanPriority;
  /** True for an approved Goal or a declared major phase. Everything else is internal. */
  readonly plannable: boolean;
}

/**
 * Projects executable structure into a client plan.
 *
 * Units are filtered by `plannable`, not by guessing from their shape. A projector that tried
 * to infer which internals were "safe enough" would leak the first time an internal happened
 * to look like a phase.
 */
export const projectPlan = (
  units: readonly PlannableUnit[],
  revision = 1
): {
  readonly snapshot: Option.Option<PlanSnapshot>;
  readonly error: Option.Option<AgentPlanError>;
} => {
  const snapshot: PlanSnapshot = {
    revision,
    entries: units
      .filter((unit) => unit.plannable)
      .map((unit) => ({
        entryId: unit.id,
        title: unit.title,
        priority: unit.priority ?? 'medium',
        status: 'pending' as const,
      })),
  };

  const invalid = validateSnapshot(snapshot);
  return Option.isSome(invalid)
    ? { snapshot: Option.none(), error: invalid }
    : { snapshot: Option.some(snapshot), error: Option.none() };
};

/**
 * Replaces a plan with a later complete snapshot.
 *
 * The replacement must be whole and must carry a higher revision. An invalid adaptation
 * leaves the prior snapshot in place: a client showing the last good plan is in a better
 * position than one showing a partially applied change.
 */
export const replaceSnapshot = (
  current: PlanSnapshot,
  next: PlanSnapshot
): {
  readonly snapshot: PlanSnapshot;
  readonly error: Option.Option<AgentPlanError>;
} => {
  if (next.revision <= current.revision) {
    return {
      snapshot: current,
      error: Option.some(
        fail(
          'stale-revision',
          Option.none(),
          `revision ${next.revision} does not follow ${current.revision}`
        )
      ),
    };
  }

  const invalid = validateSnapshot(next);
  if (Option.isSome(invalid)) return { snapshot: current, error: invalid };

  return { snapshot: next, error: Option.none() };
};

/**
 * Validates a status change for one entry against the previous snapshot.
 *
 * Entries absent from the previous snapshot are new, and start wherever the new snapshot puts
 * them — a structural adaptation may legitimately introduce an entry mid-flight.
 */
export const validateProgress = (
  previous: PlanSnapshot,
  next: PlanSnapshot
): Option.Option<AgentPlanError> => {
  const before = HashMap.fromIterable(
    previous.entries.map((entry) => [entry.entryId, entry])
  );

  for (const entry of next.entries) {
    const prior = HashMap.get(before, entry.entryId);
    if (Option.isNone(prior)) continue;
    if (prior.value.status === entry.status) continue;

    if (!isLegalEntryTransition(prior.value.status, entry.status)) {
      return Option.some(
        fail(
          'illegal-status',
          Option.some(entry.entryId),
          `cannot move from '${prior.value.status}' to '${entry.status}'`
        )
      );
    }
  }

  return Option.none();
};
