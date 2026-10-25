/** Port of jam-flow V1. See PROVENANCE.md for source hashes and deviations. */
import {
  isJsonValueV1,
  isOpaqueIdentifierV1,
  isUtf8StringWithin,
  type JsonValueV1,
} from './json-value.js';
import {
  isDataRecord,
  hasExactKeys,
  hasOptionalField,
  isNonNegativeSafeInteger,
  isInertPresentationValue,
} from './safety.js';
const interactionVersion = '1';

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
export type UserInteractionKindV1 = 'text' | 'choice' | 'confirm' | 'json';

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

const baseKeys = [
  'version',
  'requestId',
  'executionId',
  'turnId',
  'revision',
  'kind',
] as const;
const requestKeys = [...baseKeys, 'createdAtEpochMs', 'expiresAtEpochMs'];
const optionalRequestKeys = ['label', 'description'];
const validIdentity = (value: Readonly<Record<string, unknown>>): boolean =>
  baseKeys.every((key) => Object.hasOwn(value, key)) &&
  value.version === interactionVersion &&
  isOpaqueIdentifierV1(value.requestId) &&
  isOpaqueIdentifierV1(value.executionId) &&
  isOpaqueIdentifierV1(value.turnId) &&
  isNonNegativeSafeInteger(value.revision);
const requestBase = (
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean =>
  hasExactKeys(
    value,
    [...requestKeys, ...required],
    [...optionalRequestKeys, ...optional]
  ) &&
  validIdentity(value) &&
  isNonNegativeSafeInteger(value.createdAtEpochMs) &&
  isNonNegativeSafeInteger(value.expiresAtEpochMs) &&
  Number.isSafeInteger(value.expiresAtEpochMs - value.createdAtEpochMs) &&
  value.expiresAtEpochMs - value.createdAtEpochMs >=
    UserInteractionV1Limits.minLifetimeMs &&
  value.expiresAtEpochMs - value.createdAtEpochMs <=
    UserInteractionV1Limits.maxLifetimeMs &&
  hasOptionalField(value, 'label', (v) =>
    isUtf8StringWithin(v, UserInteractionV1Limits.maxLabelBytes)
  ) &&
  hasOptionalField(value, 'description', (v) =>
    isUtf8StringWithin(v, UserInteractionV1Limits.maxDescriptionBytes)
  );

/** Validate the four source request kinds; validation grants no authority. */
export const isUserInteractionRequestV1 = (
  value: unknown
): value is UserInteractionRequestV1 => {
  if (
    !isInertPresentationValue(value) ||
    !isDataRecord(value) ||
    !Object.hasOwn(value, 'kind')
  )
    return false;
  switch (value.kind) {
    case 'text':
      return (
        requestBase(value, [], ['minLength', 'maxLength']) &&
        hasOptionalField(
          value,
          'minLength',
          (v) =>
            isNonNegativeSafeInteger(v) &&
            v <= UserInteractionV1Limits.maxTextBytes
        ) &&
        hasOptionalField(
          value,
          'maxLength',
          (v) =>
            isNonNegativeSafeInteger(v) &&
            v <= UserInteractionV1Limits.maxTextBytes
        ) &&
        Number(value.minLength ?? 0) <=
          Number(value.maxLength ?? UserInteractionV1Limits.maxTextBytes)
      );
    case 'choice': {
      if (
        !requestBase(
          value,
          ['selection', 'options', 'allowCustomText'],
          ['minSelections', 'maxSelections']
        ) ||
        (value.selection !== 'single' && value.selection !== 'multiple') ||
        !Array.isArray(value.options) ||
        value.options.length < 1 ||
        value.options.length > UserInteractionV1Limits.maxChoiceOptions ||
        typeof value.allowCustomText !== 'boolean'
      )
        return false;
      const values = new Set<string>();
      for (const option of value.options) {
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
          values.has(option.value)
        )
          return false;
        values.add(option.value);
      }
      const minimum =
        value.minSelections ?? (value.selection === 'single' ? 1 : 0);
      const maximum =
        value.maxSelections ??
        (value.selection === 'single' ? 1 : value.options.length);
      return (
        isNonNegativeSafeInteger(minimum) &&
        isNonNegativeSafeInteger(maximum) &&
        minimum <= maximum &&
        maximum <= value.options.length &&
        maximum <= UserInteractionV1Limits.maxChoiceOptions &&
        (value.selection !== 'single' || (minimum === 1 && maximum === 1))
      );
    }
    case 'confirm':
      return requestBase(value, []);
    case 'json':
      return (
        requestBase(value, [], ['guidance']) &&
        hasOptionalField(value, 'guidance', (v) =>
          isUtf8StringWithin(v, UserInteractionV1Limits.maxJsonGuidanceBytes)
        )
      );
    default:
      return false;
  }
};

/** Validate a response as data. This does not test expiry or grant permission. */
export const isUserInteractionResponseV1 = (
  value: unknown
): value is UserInteractionResponseV1 => {
  if (
    !isInertPresentationValue(value) ||
    !isDataRecord(value) ||
    !validIdentity(value)
  )
    return false;
  switch (value.kind) {
    case 'text':
      return (
        hasExactKeys(value, [...baseKeys, 'value']) &&
        isUtf8StringWithin(value.value, UserInteractionV1Limits.maxTextBytes)
      );
    case 'choice':
      return (
        hasExactKeys(value, [...baseKeys, 'values'], ['customText']) &&
        Array.isArray(value.values) &&
        value.values.length <= UserInteractionV1Limits.maxChoiceOptions &&
        value.values.every((v) =>
          isUtf8StringWithin(v, UserInteractionV1Limits.maxChoiceValueBytes)
        ) &&
        hasOptionalField(value, 'customText', (v) =>
          isUtf8StringWithin(v, UserInteractionV1Limits.maxTextBytes)
        )
      );
    case 'confirm':
      return (
        hasExactKeys(value, [...baseKeys, 'confirmed']) &&
        typeof value.confirmed === 'boolean'
      );
    case 'json':
      return (
        hasExactKeys(value, [...baseKeys, 'value']) &&
        isJsonValueV1(value.value)
      );
    default:
      return false;
  }
};

export type InteractionResponseConstraintResultV1 =
  | { readonly valid: true; readonly value: unknown }
  | {
      readonly valid: false;
      readonly code: 'interaction-mismatch' | 'interaction-constraint';
    };

/** Check source correlation and visible constraints. Never perform an action. */
export const validateInteractionResponseV1 = (
  request: UserInteractionRequestV1,
  response: UserInteractionResponseV1
): InteractionResponseConstraintResultV1 => {
  if (
    !isUserInteractionRequestV1(request) ||
    !isUserInteractionResponseV1(response)
  )
    return { valid: false, code: 'interaction-constraint' };
  if (
    request.requestId !== response.requestId ||
    request.executionId !== response.executionId ||
    request.turnId !== response.turnId ||
    request.revision !== response.revision ||
    request.kind !== response.kind
  )
    return { valid: false, code: 'interaction-mismatch' };
  switch (request.kind) {
    case 'text': {
      if (response.kind !== 'text')
        return { valid: false, code: 'interaction-mismatch' };
      const length = new TextEncoder().encode(response.value).byteLength;
      return length < (request.minLength ?? 0) ||
        length > (request.maxLength ?? UserInteractionV1Limits.maxTextBytes)
        ? { valid: false, code: 'interaction-constraint' }
        : { valid: true, value: response.value };
    }
    case 'choice': {
      if (response.kind !== 'choice')
        return { valid: false, code: 'interaction-mismatch' };
      const minimum =
        request.minSelections ?? (request.selection === 'single' ? 1 : 0);
      const maximum =
        request.maxSelections ??
        (request.selection === 'single' ? 1 : request.options.length);
      const allowed = request.options.map((v) => v.value);
      if (
        new Set(response.values).size !== response.values.length ||
        !response.values.every((v) => allowed.includes(v)) ||
        response.values.length < minimum ||
        response.values.length > maximum ||
        (response.customText !== undefined && !request.allowCustomText)
      )
        return { valid: false, code: 'interaction-constraint' };
      return {
        valid: true,
        value:
          response.customText === undefined
            ? { values: response.values }
            : { values: response.values, customText: response.customText },
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
