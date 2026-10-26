/**
 * Session Information — the title and the ordered information fields a Session publishes, and
 * the snapshot a later connection restores.
 *
 * Whole snapshots, as everywhere else in this presentation layer. A restored Session shows the
 * last committed snapshot exactly; there is no partial state to reconcile because there is no
 * partial state.
 */

import { Data, HashSet, Option } from 'effect';

import { utf8Bytes } from './utf8.js';

/** The longest Session title, in UTF-8 bytes. */
export const MAX_SESSION_TITLE_BYTES = 512;

/** The most information fields one Session may publish. */
export const MAX_INFORMATION_FIELDS = 64;

/** The longest field key, in UTF-8 bytes. */
export const MAX_FIELD_KEY_BYTES = 128;

/** The longest field value, in UTF-8 bytes. */
export const MAX_FIELD_VALUE_BYTES = 4 * 1024;

/** Why an information update was refused. */
export type InformationRejection =
  | 'missing-key'
  | 'duplicate-key'
  | 'title-too-long'
  | 'key-too-long'
  | 'value-too-long'
  | 'too-many-fields'
  | 'stale-revision';

/** A typed information refusal. */
export class SessionInformationError extends Data.TaggedError(
  'SessionInformationError'
)<{
  readonly rejection: InformationRejection;
  readonly key: Option.Option<string>;
  readonly detail: Option.Option<string>;
}> {
  /** Names the offending field, or nothing when the whole snapshot is at fault. */
  override get message(): string {
    const where = Option.match(this.key, {
      onNone: () => '',
      onSome: (key) => ` field '${key}'`,
    });
    return `session information${where} refused: ${this.rejection}${Option.match(
      this.detail,
      { onNone: () => '', onSome: (detail) => ` (${detail})` }
    )}`;
  }
}

/** One information field. */
export interface InformationField {
  /**
   * The field's identity as well as its label. Non-empty once trimmed, unique within the
   * snapshot, and at most `MAX_FIELD_KEY_BYTES`. Restating this key updates the field in
   * place; a changed key adds a second field rather than renaming the first.
   */
  readonly key: string;
  /** At most `MAX_FIELD_VALUE_BYTES`. Empty is allowed — a stated blank is a real value. */
  readonly value: string;
}

/** The complete information snapshot at one revision. */
export interface InformationSnapshot {
  /**
   * Rises by one per applied update, and never on a refused one. `restoreInformation` compares
   * against it to refuse a restore that would roll a live Session backwards.
   */
  readonly revision: number;
  /** `None` until the Session states a title. Absent is not an empty string. */
  readonly title: Option.Option<string>;
  /** In the order the Session first stated each key, which is the order a client renders. */
  readonly fields: readonly InformationField[];
}

/** The snapshot a Session starts from. */
export const emptyInformation: InformationSnapshot = Object.freeze({
  revision: 0,
  title: Option.none(),
  fields: Object.freeze([]),
});

/** What one update states. An absent part leaves that part of the snapshot alone. */
export interface InformationUpdate {
  /**
   * Absent leaves the current title. There is no way to clear a title once stated — the best
   * a caller can do is state an empty one, which is a visible choice rather than a reversal.
   */
  readonly title?: string;
  /**
   * Merged by key into the existing fields: a known key is overwritten in place, an unknown
   * key is appended. An update never removes a field, so a key once published stays published.
   */
  readonly fields?: readonly InformationField[];
}

/** Builds a refusal that names one field. Use when a single field is at fault. */
const refuse = (
  rejection: InformationRejection,
  key?: string,
  detail?: string
): SessionInformationError =>
  new SessionInformationError({
    rejection,
    key: Option.fromNullishOr(key),
    detail: Option.fromNullishOr(detail),
  });

/**
 * Builds a refusal about the snapshot as a whole — a title, a count, a stale revision.
 *
 * The detail is required rather than optional: with no field to name, the detail is the only
 * thing that tells a reader which bound was crossed.
 */
const refuseWithoutKey = (
  rejection: InformationRejection,
  detail: string
): SessionInformationError =>
  new SessionInformationError({
    rejection,
    key: Option.none(),
    detail: Option.some(detail),
  });

/** Rejects a snapshot whose title, keys, values, or count exceed their bounds. */
export const validateInformation = (
  snapshot: InformationSnapshot
): Option.Option<SessionInformationError> => {
  if (
    Option.isSome(snapshot.title) &&
    utf8Bytes(snapshot.title.value) > MAX_SESSION_TITLE_BYTES
  ) {
    return Option.some(
      refuseWithoutKey(
        'title-too-long',
        `${utf8Bytes(snapshot.title.value)} bytes exceeds ${MAX_SESSION_TITLE_BYTES}`
      )
    );
  }
  if (snapshot.fields.length > MAX_INFORMATION_FIELDS) {
    return Option.some(
      refuseWithoutKey(
        'too-many-fields',
        `${snapshot.fields.length} exceeds ${MAX_INFORMATION_FIELDS}`
      )
    );
  }

  let seen = HashSet.empty<string>();
  for (const field of snapshot.fields) {
    if (typeof field.key !== 'string' || field.key.trim().length === 0) {
      return Option.some(refuse('missing-key'));
    }
    if (HashSet.has(seen, field.key)) {
      // Two fields with one key make the later read ambiguous.
      return Option.some(refuse('duplicate-key', field.key));
    }
    if (utf8Bytes(field.key) > MAX_FIELD_KEY_BYTES) {
      return Option.some(refuse('key-too-long', field.key));
    }
    if (utf8Bytes(field.value) > MAX_FIELD_VALUE_BYTES) {
      return Option.some(refuse('value-too-long', field.key));
    }
    seen = HashSet.add(seen, field.key);
  }
  return Option.none();
};

/**
 * Apply one update, producing the next complete snapshot.
 *
 * A field stated again keeps its position rather than moving to the end. The order a client
 * renders is the order the Session first stated each field, so a routine value refresh does
 * not shuffle the list under the reader.
 */
export const applyInformation = (
  current: InformationSnapshot,
  update: InformationUpdate
): {
  readonly snapshot: InformationSnapshot;
  readonly error: Option.Option<SessionInformationError>;
} => {
  let fields = [...current.fields];

  for (const stated of update.fields ?? []) {
    const at = fields.findIndex((field) => field.key === stated.key);
    if (at === -1) {
      fields = [...fields, { key: stated.key, value: stated.value }];
    } else {
      fields[at] = { key: stated.key, value: stated.value };
    }
  }

  const next: InformationSnapshot = Object.freeze({
    revision: current.revision + 1,
    title: Option.match(Option.fromNullishOr(update.title), {
      onNone: () => current.title,
      onSome: Option.some,
    }),
    fields: Object.freeze(fields),
  });

  const invalid = validateInformation(next);
  // An invalid update leaves the last good snapshot in place; a client showing stale
  // information is better off than one showing information that never validated.
  return Option.isSome(invalid)
    ? { snapshot: current, error: invalid }
    : { snapshot: next, error: Option.none() };
};

/**
 * Accept a restored snapshot as the Session's current information.
 *
 * A restore that arrives behind the snapshot already held is refused rather than applied: a
 * later connection must not roll a live Session backwards.
 */
export const restoreInformation = (
  current: InformationSnapshot,
  committed: InformationSnapshot
): {
  readonly snapshot: InformationSnapshot;
  readonly error: Option.Option<SessionInformationError>;
} => {
  if (committed.revision < current.revision) {
    return {
      snapshot: current,
      error: Option.some(
        refuseWithoutKey(
          'stale-revision',
          `restored ${committed.revision} behind ${current.revision}`
        )
      ),
    };
  }
  const invalid = validateInformation(committed);
  return Option.isSome(invalid)
    ? { snapshot: current, error: invalid }
    : {
        snapshot: Object.freeze({
          revision: committed.revision,
          title: committed.title,
          fields: Object.freeze([...committed.fields]),
        }),
        error: invalid,
      };
};

/** The payload one committed information update carries. */
export const informationPayload = (
  snapshot: InformationSnapshot
): Readonly<Record<string, unknown>> =>
  Object.freeze({
    kind: 'session-information',
    revision: snapshot.revision,
    title: Option.getOrUndefined(snapshot.title),
    fields: snapshot.fields.map((field) => ({
      key: field.key,
      value: field.value,
    })),
  });
