import { HashSet, Option, Predicate, Schema } from 'effect';
import {
  isJsonValueV1,
  isOpaqueIdentifierV1,
  isUtf8StringWithin,
  type JsonValueV1,
} from './json-value.js';

/**
 * The interaction kind vocabulary, inlined from jam-flow's
 * `@jambudipa/flow-events/interaction` so this package depends on `effect` alone.
 */
type InteractionKindV1 = 'text' | 'choice' | 'confirm' | 'json';

/**
 * The only `version` these guards accept.
 *
 * A wire value carrying any other version is rejected rather than read leniently: this module
 * has no idea what a V2 field means, and guessing would admit a shape the rest of Flow trusts.
 */
const interactionVersion = '1';

/** Fixed V1 limits for request and response validation. */
export const UserInteractionV1Limits = Object.freeze({
  minLifetimeMs: 1_000,
  maxLifetimeMs: 3_600_000,
  defaultLifetimeMs: 15 * 60 * 1_000,
  maxLabelBytes: 256,
  maxDescriptionBytes: 2_048,
  maxChoiceValueBytes: 128,
  maxChoiceLabelBytes: 256,
  maxChoiceOptions: 100,
  maxTextBytes: 4_096,
  maxJsonGuidanceBytes: 4 * 1024,
});

/**
 * The fields every request kind carries, whatever it asks for.
 *
 * The four identity fields plus `revision` are what a response is correlated against: a reply
 * that matches all five answers this request and no other, so a stale reply to a superseded
 * revision cannot be mistaken for a live one. `expiresAtEpochMs - createdAtEpochMs` must fall
 * between the minimum and maximum lifetimes, so a request cannot be made to hang forever or to
 * expire before a person can read it.
 */
type InteractionBaseV1 = {
  readonly version: '1';
  readonly requestId: string;
  readonly executionId: string;
  readonly turnId: string;
  readonly revision: number;
  readonly createdAtEpochMs: number;
  readonly expiresAtEpochMs: number;
  readonly label?: string;
  readonly description?: string;
};
/**
 * Defines the user interaction request v1 contract that crosses the public Flow boundary.
 *
 * @remarks Consumers rely on the declared structure and invariants at compile time and at its documented runtime boundaries.
 * @contractSignature 36e5272d27b8ee3c
 */
export type UserInteractionRequestV1 =
  | (InteractionBaseV1 & {
      readonly kind: Extract<UserInteractionKindV1, 'text'>;
      readonly minLength?: number;
      readonly maxLength?: number;
    })
  | (InteractionBaseV1 & {
      readonly kind: Extract<UserInteractionKindV1, 'choice'>;
      readonly selection: 'single' | 'multiple';
      readonly options: readonly {
        readonly value: string;
        readonly label: string;
      }[];
      readonly minSelections?: number;
      readonly maxSelections?: number;
      readonly allowCustomText: boolean;
    })
  | (InteractionBaseV1 & {
      readonly kind: Extract<UserInteractionKindV1, 'confirm'>;
    })
  | (InteractionBaseV1 & {
      readonly kind: Extract<UserInteractionKindV1, 'json'>;
      readonly guidance?: string;
    });
/**
 * The four kinds of question the interaction surface can ask.
 *
 * Written down once because several sites classify a request by its kind — the tool picks a
 * response schema, the host picks a prompt, the registry counts by it — and each of them
 * spelled the set out again before it had a name.
 *
 * In jam-flow the set is declared one package lower, in the event vocabulary, and this is the
 * name the interaction surface knows it by. This standalone package carries its own copy of that
 * vocabulary as `InteractionKindV1` below, with the same four members. It used to read `UserInteractionRequestV1['kind']`, and
 * it cannot any more: the derivation ran the wrong way. A word added to the vocabulary would
 * have left this name at four members, the request union would have stayed closed around the
 * old four, and the exhaustive `switch` in `ask-user-tool.ts` — the one that picks the schema
 * an answer is decoded through — would have kept compiling while a kind of question went
 * unhandled. Reading the vocabulary directly is what makes that a build failure.
 *
 * The request union above is built on the same declaration, so the two cannot part company in
 * the other direction either: drop a word from the vocabulary and the member that carried it
 * has a `never` discriminant, which no construction site can satisfy.
 */
export type UserInteractionKindV1 = InteractionKindV1;

/**
 * Defines the user interaction response v1 contract that crosses the public Flow boundary.
 *
 * @remarks Consumers rely on the declared structure and invariants at compile time and at its documented runtime boundaries.
 * @contractSignature 1d0fc662c4406ef6
 */
export type UserInteractionResponseV1 =
  | {
      readonly version: '1';
      readonly requestId: string;
      readonly executionId: string;
      readonly turnId: string;
      readonly revision: number;
      readonly kind: 'text';
      readonly value: string;
    }
  | {
      readonly version: '1';
      readonly requestId: string;
      readonly executionId: string;
      readonly turnId: string;
      readonly revision: number;
      readonly kind: 'choice';
      readonly values: readonly string[];
      readonly customText?: string;
    }
  | {
      readonly version: '1';
      readonly requestId: string;
      readonly executionId: string;
      readonly turnId: string;
      readonly revision: number;
      readonly kind: 'confirm';
      readonly confirmed: boolean;
    }
  | {
      readonly version: '1';
      readonly requestId: string;
      readonly executionId: string;
      readonly turnId: string;
      readonly revision: number;
      readonly kind: 'json';
      readonly value: JsonValueV1;
    };

/**
 * A plain object whose every own property is a data property this code may read safely.
 *
 * Stricter than "is an object" on purpose. A subclass, a symbol key, a non-enumerable key or a
 * getter all fail here, so the guards below never invoke foreign code while deciding whether
 * untrusted input is admissible. A null-prototype object passes: it carries no inherited
 * surface at all.
 */
const isRecord = (
  value: unknown
): value is Readonly<Record<string, unknown>> => {
  if (!Predicate.isObject(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (
    prototype !== Object.prototype &&
    Option.isSome(Option.fromNullishOr(prototype))
  ) {
    return false;
  }
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
    );
  });
};

/**
 * True when the key is absent, or present and valid.
 *
 * An absent optional field is not a failure — every optional field in the V1 contract means
 * "not stated", never "stated as nothing". The caller has already established through
 * `hasExactKeys` that the key is one the contract permits.
 */
const hasOptionalField = (
  value: Readonly<Record<string, unknown>>,
  key: string,
  isValid: (candidate: unknown) => boolean
): boolean => !Object.hasOwn(value, key) || isValid(value[key]);

/**
 * The values of a plain, own-property array, if the value is one.
 *
 * `None` means it is not — a proxy, a subclass, a sparse array, or one carrying extra keys.
 * The caller has one question to ask rather than a sentinel to remember.
 */
const safeArrayValues = (
  value: unknown,
  maximumEntries: number
): Option.Option<readonly unknown[]> => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return Option.none();
  const ownKeys = Reflect.ownKeys(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  const length = lengthDescriptor?.value;
  if (
    ownKeys.some((key) => typeof key !== 'string') ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > maximumEntries ||
    ownKeys.length !== length + 1
  ) {
    return Option.none();
  }
  let values: readonly unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor?.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      return Option.none();
    }
    values = [...values, descriptor.value];
  }
  return Option.some(values);
};

/**
 * Exactly the declared keys: every required one present, and nothing beyond required plus
 * optional.
 *
 * Extra keys are rejected rather than ignored. A request that carries a field this version
 * does not understand may mean something the guard cannot honour, and admitting it would let
 * an unread field travel onward as though it had been checked.
 */
const hasExactKeys = (
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): value is Readonly<Record<string, unknown>> => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (Reflect.ownKeys(value).length !== keys.length) return false;
  if (!required.every((key) => Object.hasOwn(value, key))) return false;
  return keys.every((key) => required.includes(key) || optional.includes(key));
};

/**
 * A count or an epoch millisecond value the arithmetic below can trust.
 *
 * Safe-integer, so the lifetime subtraction cannot silently round; non-negative, so a negative
 * revision or timestamp never reaches a comparison that would read as ordering.
 */
const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * Checks the fields shared by every request kind, including the lifetime bounds.
 *
 * Keys are NOT checked here — the caller states which keys its kind permits. Narrowing only to
 * a record, because the union member a kind belongs to is decided by the caller's switch.
 */
const isInteractionBase = (
  value: unknown
): value is Readonly<Record<string, unknown>> =>
  isRecord(value) &&
  value.version === interactionVersion &&
  isOpaqueIdentifierV1(value.requestId) &&
  isOpaqueIdentifierV1(value.executionId) &&
  isOpaqueIdentifierV1(value.turnId) &&
  isNonNegativeSafeInteger(value.revision) &&
  isNonNegativeSafeInteger(value.createdAtEpochMs) &&
  isNonNegativeSafeInteger(value.expiresAtEpochMs) &&
  Number.isSafeInteger(value.expiresAtEpochMs - value.createdAtEpochMs) &&
  value.expiresAtEpochMs - value.createdAtEpochMs >=
    UserInteractionV1Limits.minLifetimeMs &&
  value.expiresAtEpochMs - value.createdAtEpochMs <=
    UserInteractionV1Limits.maxLifetimeMs &&
  hasOptionalField(value, 'label', (label) =>
    isUtf8StringWithin(label, UserInteractionV1Limits.maxLabelBytes)
  ) &&
  hasOptionalField(value, 'description', (description) =>
    isUtf8StringWithin(description, UserInteractionV1Limits.maxDescriptionBytes)
  );

/**
 * The key check plus the base check for one request kind.
 *
 * `fields` and `optional` are the keys that kind adds on top of the shared base. Order
 * matters: the exact-key test runs first, so a hostile input is rejected on shape before any
 * of its values are read.
 */
const hasRequestBaseKeys = (
  value: unknown,
  fields: readonly string[],
  optional: readonly string[] = []
): boolean =>
  hasExactKeys(
    value,
    [
      'version',
      'requestId',
      'executionId',
      'turnId',
      'revision',
      'createdAtEpochMs',
      'expiresAtEpochMs',
      'kind',
      ...fields,
    ],
    ['label', 'description', ...optional]
  ) && isInteractionBase(value);
/**
 * Checks whether an input satisfies the is user interaction request v1 contract.
 *
 * @remarks The implementation preserves its declared result, expected failure, and service requirement types.
 * @param value - The declared value input.
 * @returns The declared public result, including precise Effect channels when the result is effectful.
 * @contractSignature 57cda8519e2509ae
 */
export const isUserInteractionRequestV1 = (
  value: unknown
): value is UserInteractionRequestV1 => {
  if (!isRecord(value)) return false;

  switch (value.kind) {
    case 'text':
      if (
        !hasRequestBaseKeys(value, [], ['minLength', 'maxLength']) ||
        !hasOptionalField(
          value,
          'minLength',
          (minLength) =>
            isNonNegativeSafeInteger(minLength) &&
            minLength <= UserInteractionV1Limits.maxTextBytes
        ) ||
        !hasOptionalField(
          value,
          'maxLength',
          (maxLength) =>
            isNonNegativeSafeInteger(maxLength) &&
            maxLength <= UserInteractionV1Limits.maxTextBytes
        )
      ) {
        return false;
      }
      return (
        (value.minLength ?? 0) <=
        (value.maxLength ?? UserInteractionV1Limits.maxTextBytes)
      );
    case 'choice': {
      const options = safeArrayValues(
        value.options,
        UserInteractionV1Limits.maxChoiceOptions
      );
      if (
        !hasRequestBaseKeys(
          value,
          ['selection', 'options', 'allowCustomText'],
          ['minSelections', 'maxSelections']
        ) ||
        (value.selection !== 'single' && value.selection !== 'multiple') ||
        Option.isNone(options) ||
        options.value.length < 1 ||
        typeof value.allowCustomText !== 'boolean'
      ) {
        return false;
      }

      let optionValues = HashSet.empty<string>();
      for (const option of options.value) {
        if (
          !hasExactKeys(option, ['value', 'label']) ||
          !isUtf8StringWithin(
            option.value,
            UserInteractionV1Limits.maxChoiceValueBytes
          ) ||
          !isUtf8StringWithin(
            option.label,
            UserInteractionV1Limits.maxChoiceLabelBytes
          ) ||
          HashSet.has(optionValues, option.value)
        ) {
          return false;
        }
        optionValues = HashSet.add(optionValues, option.value);
      }

      const minSelections =
        value.minSelections ?? (value.selection === 'single' ? 1 : 0);
      const maxSelections =
        value.maxSelections ??
        (value.selection === 'single' ? 1 : options.value.length);
      return (
        isNonNegativeSafeInteger(minSelections) &&
        isNonNegativeSafeInteger(maxSelections) &&
        minSelections <= maxSelections &&
        maxSelections <= options.value.length &&
        maxSelections <= UserInteractionV1Limits.maxChoiceOptions &&
        (value.selection !== 'single' ||
          (minSelections === 1 && maxSelections === 1))
      );
    }
    case 'confirm':
      return hasRequestBaseKeys(value, []);
    case 'json':
      return (
        hasRequestBaseKeys(value, [], ['guidance']) &&
        hasOptionalField(value, 'guidance', (guidance) =>
          isUtf8StringWithin(
            guidance,
            UserInteractionV1Limits.maxJsonGuidanceBytes
          )
        )
      );
    default:
      return false;
  }
};

/**
 * The request-side counterpart for a response.
 *
 * A response carries no lifetime, so there are no timestamps to check — expiry is the sending
 * side's concern, and `validateInteractionResponseV1` decides correlation separately.
 */
const hasResponseBaseKeys = (
  value: unknown,
  fields: readonly string[],
  optional: readonly string[] = []
): boolean =>
  hasExactKeys(
    value,
    [
      'version',
      'requestId',
      'executionId',
      'turnId',
      'revision',
      'kind',
      ...fields,
    ],
    optional
  ) &&
  isRecord(value) &&
  value.version === interactionVersion &&
  isOpaqueIdentifierV1(value.requestId) &&
  isOpaqueIdentifierV1(value.executionId) &&
  isOpaqueIdentifierV1(value.turnId) &&
  isNonNegativeSafeInteger(value.revision);
/**
 * Checks whether an input satisfies the is user interaction response v1 contract.
 *
 * @remarks The implementation preserves its declared result, expected failure, and service requirement types.
 * @param value - The declared value input.
 * @returns The declared public result, including precise Effect channels when the result is effectful.
 * @contractSignature ceef3bd5056088ba
 */
export const isUserInteractionResponseV1 = (
  value: unknown
): value is UserInteractionResponseV1 => {
  if (!isRecord(value)) return false;

  switch (value.kind) {
    case 'text':
      return (
        hasResponseBaseKeys(value, ['value']) &&
        isUtf8StringWithin(value.value, UserInteractionV1Limits.maxTextBytes)
      );
    case 'choice': {
      const values = safeArrayValues(
        value.values,
        UserInteractionV1Limits.maxChoiceOptions
      );
      return (
        hasResponseBaseKeys(value, ['values'], ['customText']) &&
        Option.isSome(values) &&
        values.value.every((item) =>
          isUtf8StringWithin(item, UserInteractionV1Limits.maxChoiceValueBytes)
        ) &&
        Option.match(Option.fromNullishOr(value.customText), {
          onNone: () => true,
          onSome: (customText) =>
            isUtf8StringWithin(
              customText,
              UserInteractionV1Limits.maxTextBytes
            ),
        })
      );
    }
    case 'confirm':
      return (
        hasResponseBaseKeys(value, ['confirmed']) &&
        typeof value.confirmed === 'boolean'
      );
    case 'json':
      return (
        hasResponseBaseKeys(value, ['value']) && isJsonValueV1(value.value)
      );
    default:
      return false;
  }
};
/**
 * Defines the user interaction request v1 schema contract that crosses the public Flow boundary.
 *
 * @remarks Consumers rely on the declared structure and invariants at compile time and at its documented runtime boundaries.
 * @contractSignature 9c64bf8b0d0cf287
 */
export const UserInteractionRequestV1Schema: Schema.Codec<UserInteractionRequestV1> =
  Schema.declare<UserInteractionRequestV1>(isUserInteractionRequestV1);
/**
 * Defines the user interaction response v1 schema contract that crosses the public Flow boundary.
 *
 * @remarks Consumers rely on the declared structure and invariants at compile time and at its documented runtime boundaries.
 * @contractSignature 9e34d268478535b7
 */
export const UserInteractionResponseV1Schema: Schema.Codec<UserInteractionResponseV1> =
  Schema.declare<UserInteractionResponseV1>(isUserInteractionResponseV1);
/**
 * Defines the interaction response constraint result v1 contract that crosses the public Flow boundary.
 *
 * @remarks Consumers rely on the declared structure and invariants at compile time and at its documented runtime boundaries.
 * @contractSignature 0c7fc36c6b4a0286
 */
export type InteractionResponseConstraintResultV1 =
  | { readonly valid: true; readonly value: unknown }
  | {
      readonly valid: false;
      readonly code: 'interaction-mismatch' | 'interaction-constraint';
    };

/**
 * Checks response/request correlation and visible constraints before Flow's
 * original Effect Schema performs the final domain-value validation.
 */
export const validateInteractionResponseV1 = (
  request: UserInteractionRequestV1,
  response: UserInteractionResponseV1
): InteractionResponseConstraintResultV1 => {
  if (
    request.requestId !== response.requestId ||
    request.executionId !== response.executionId ||
    request.turnId !== response.turnId ||
    request.revision !== response.revision ||
    request.kind !== response.kind
  ) {
    return { valid: false, code: 'interaction-mismatch' };
  }

  switch (request.kind) {
    case 'text': {
      if (response.kind !== 'text') {
        return { valid: false, code: 'interaction-mismatch' };
      }
      const length = new TextEncoder().encode(response.value).byteLength;
      if (
        length < (request.minLength ?? 0) ||
        length > (request.maxLength ?? UserInteractionV1Limits.maxTextBytes)
      ) {
        return { valid: false, code: 'interaction-constraint' };
      }
      return { valid: true, value: response.value };
    }
    case 'choice': {
      if (response.kind !== 'choice') {
        return { valid: false, code: 'interaction-mismatch' };
      }
      const minSelections =
        request.minSelections ?? (request.selection === 'single' ? 1 : 0);
      const maxSelections =
        request.maxSelections ??
        (request.selection === 'single' ? 1 : request.options.length);
      const customText = Option.fromNullishOr(response.customText);
      const allowed = HashSet.fromIterable(
        request.options.map((option) => option.value)
      );
      const selectionsAreStable =
        HashSet.size(HashSet.fromIterable(response.values)) ===
          response.values.length &&
        response.values.every((value) => HashSet.has(allowed, value));
      if (
        !selectionsAreStable ||
        response.values.length < minSelections ||
        response.values.length > maxSelections ||
        (Option.isSome(customText) && !request.allowCustomText)
      ) {
        return { valid: false, code: 'interaction-constraint' };
      }
      return {
        valid: true,
        value: Option.match(customText, {
          onNone: () => ({ values: response.values }),
          onSome: (text) => ({ values: response.values, customText: text }),
        }),
      };
    }
    case 'confirm':
      return response.kind === 'confirm'
        ? { valid: true, value: response.confirmed }
        : { valid: false, code: 'interaction-mismatch' };
    case 'json':
      return response.kind === 'json'
        ? { valid: true, value: response.value }
        : { valid: false, code: 'interaction-mismatch' };
  }
};
