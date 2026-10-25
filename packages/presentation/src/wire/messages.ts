/** Port of jam-flow V1. See PROVENANCE.md for source hashes and deviations. */
import {
  JsonValueV1Limits,
  isJsonValueV1,
  isOpaqueIdentifierV1,
  isUtf8StringWithin,
  type JsonValueV1,
} from './json-value.js';
import {
  isUserInteractionRequestV1,
  type UserInteractionRequestV1,
} from './interactions.js';
import {
  isDataRecord as isRecord,
  hasExactKeys,
  hasOptionalField,
  isNonNegativeSafeInteger,
  isInertPresentationValue,
  inertJsonUtf8Bytes,
} from './safety.js';
const presentationVersion = '1';

export const PresentationV1Limits = Object.freeze({
  maxMessageTextUtf8Bytes: JsonValueV1Limits.maxUtf8Bytes,
  maxGroupDepth: 16,
  maxGroupChildren: 100,
  maxGroupUtf8Bytes: 64 * 1024,
});
export const PresentationMessageV1Kinds = Object.freeze([
  'text',
  'status',
  'card',
  'metric',
  'trace',
  'state',
  'group',
  'interaction',
  'result',
] as const);
export type PresentationMessageKindV1 =
  (typeof PresentationMessageV1Kinds)[number];
export interface PresentationCorrelationV1 {
  readonly flowId?: string;
  readonly stepId?: string;
  readonly turnId?: string;
  readonly sessionId?: string;
  readonly branchId?: string;
}
export type PresentationMessageV1 =
  | { readonly version: '1'; readonly kind: 'text'; readonly text: string }
  | {
      readonly version: '1';
      readonly kind: 'status';
      readonly status:
        | 'queued'
        | 'running'
        | 'waiting'
        | 'completed'
        | 'failed'
        | 'cancelled'
        | 'interrupted';
      readonly detail?: string;
    }
  | {
      readonly version: '1';
      readonly kind: 'card';
      readonly title: string;
      readonly body: string;
    }
  | {
      readonly version: '1';
      readonly kind: 'metric';
      readonly name: string;
      readonly value: number;
      readonly unit?: string;
    }
  | {
      readonly version: '1';
      readonly kind: 'trace';
      readonly name: string;
      readonly depth: number;
      readonly durationMs?: number;
    }
  | {
      readonly version: '1';
      readonly kind: 'state';
      readonly key: string;
      readonly value: JsonValueV1;
    }
  | {
      readonly version: '1';
      readonly kind: 'group';
      readonly label: string;
      readonly children: readonly PresentationMessageV1[];
    }
  | {
      readonly version: '1';
      readonly kind: 'interaction';
      readonly request: UserInteractionRequestV1;
    }
  | {
      readonly version: '1';
      readonly kind: 'result';
      readonly outcome:
        'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'unavailable';
      readonly value?: JsonValueV1;
      readonly summary?: string;
    };
export interface PresentationRecordV1 {
  readonly version: '1';
  readonly messageId: string;
  readonly executionId: string;
  readonly sequence: number;
  readonly atEpochMs: number;
  readonly correlation?: PresentationCorrelationV1;
  readonly message: PresentationMessageV1;
}

const isCorrelation = (value: unknown): value is PresentationCorrelationV1 =>
  hasExactKeys(
    value,
    [],
    ['flowId', 'stepId', 'turnId', 'sessionId', 'branchId']
  ) && Object.values(value).every(isOpaqueIdentifierV1);
const isGroupAtDepth = (
  value: unknown,
  depth: number
): value is PresentationMessageV1 => {
  if (
    !isRecord(value) ||
    !Object.hasOwn(value, 'version') ||
    !Object.hasOwn(value, 'kind') ||
    value.version !== presentationVersion ||
    typeof value.kind !== 'string'
  ) {
    return false;
  }

  switch (value.kind) {
    case 'text':
      return (
        hasExactKeys(value, ['version', 'kind', 'text']) &&
        isUtf8StringWithin(
          value.text,
          PresentationV1Limits.maxMessageTextUtf8Bytes
        )
      );
    case 'status':
      return (
        hasExactKeys(value, ['version', 'kind', 'status'], ['detail']) &&
        typeof value.status === 'string' &&
        [
          'queued',
          'running',
          'waiting',
          'completed',
          'failed',
          'cancelled',
          'interrupted',
        ].includes(value.status) &&
        hasOptionalField(value, 'detail', (detail) =>
          isUtf8StringWithin(
            detail,
            PresentationV1Limits.maxMessageTextUtf8Bytes
          )
        )
      );
    case 'card':
      return (
        hasExactKeys(value, ['version', 'kind', 'title', 'body']) &&
        isUtf8StringWithin(
          value.title,
          PresentationV1Limits.maxMessageTextUtf8Bytes
        ) &&
        isUtf8StringWithin(
          value.body,
          PresentationV1Limits.maxMessageTextUtf8Bytes
        )
      );
    case 'metric':
      return (
        hasExactKeys(value, ['version', 'kind', 'name', 'value'], ['unit']) &&
        isUtf8StringWithin(
          value.name,
          PresentationV1Limits.maxMessageTextUtf8Bytes
        ) &&
        typeof value.value === 'number' &&
        Number.isFinite(value.value) &&
        hasOptionalField(value, 'unit', (unit) =>
          isUtf8StringWithin(unit, PresentationV1Limits.maxMessageTextUtf8Bytes)
        )
      );
    case 'trace':
      return (
        hasExactKeys(
          value,
          ['version', 'kind', 'name', 'depth'],
          ['durationMs']
        ) &&
        isUtf8StringWithin(
          value.name,
          PresentationV1Limits.maxMessageTextUtf8Bytes
        ) &&
        isNonNegativeSafeInteger(value.depth) &&
        hasOptionalField(
          value,
          'durationMs',
          (durationMs) =>
            typeof durationMs === 'number' &&
            Number.isFinite(durationMs) &&
            durationMs >= 0
        )
      );
    case 'state':
      return (
        hasExactKeys(value, ['version', 'kind', 'key', 'value']) &&
        isUtf8StringWithin(
          value.key,
          PresentationV1Limits.maxMessageTextUtf8Bytes
        ) &&
        isJsonValueV1(value.value)
      );
    case 'group': {
      if (
        depth >= PresentationV1Limits.maxGroupDepth ||
        !hasExactKeys(value, ['version', 'kind', 'label', 'children']) ||
        !isUtf8StringWithin(
          value.label,
          PresentationV1Limits.maxMessageTextUtf8Bytes
        ) ||
        !Array.isArray(value.children) ||
        value.children.length > PresentationV1Limits.maxGroupChildren ||
        !value.children.every((child) => isGroupAtDepth(child, depth + 1))
      ) {
        return false;
      }
      return (
        inertJsonUtf8Bytes(value, PresentationV1Limits.maxGroupUtf8Bytes) <=
        PresentationV1Limits.maxGroupUtf8Bytes
      );
    }
    case 'interaction':
      return (
        hasExactKeys(value, ['version', 'kind', 'request']) &&
        isUserInteractionRequestV1(value.request)
      );
    case 'result':
      return (
        hasExactKeys(
          value,
          ['version', 'kind', 'outcome'],
          ['value', 'summary']
        ) &&
        typeof value.outcome === 'string' &&
        [
          'succeeded',
          'failed',
          'cancelled',
          'interrupted',
          'unavailable',
        ].includes(value.outcome) &&
        hasOptionalField(value, 'value', isJsonValueV1) &&
        hasOptionalField(value, 'summary', (summary) =>
          isUtf8StringWithin(
            summary,
            PresentationV1Limits.maxMessageTextUtf8Bytes
          )
        )
      );
    default:
      return false;
  }
};
const isMessageGrammar = (value: unknown): value is PresentationMessageV1 =>
  isGroupAtDepth(value, 0);
const isRecordGrammar = (value: unknown): value is PresentationRecordV1 =>
  hasExactKeys(
    value,
    ['version', 'messageId', 'executionId', 'sequence', 'atEpochMs', 'message'],
    ['correlation']
  ) &&
  value.version === presentationVersion &&
  isOpaqueIdentifierV1(value.messageId) &&
  isOpaqueIdentifierV1(value.executionId) &&
  isNonNegativeSafeInteger(value.sequence) &&
  value.sequence > 0 &&
  isNonNegativeSafeInteger(value.atEpochMs) &&
  hasOptionalField(value, 'correlation', isCorrelation) &&
  isPresentationMessageV1(value.message);

/** Validate inert shape and resource bounds before reading any wire field. */
export const isPresentationMessageV1 = (
  value: unknown
): value is PresentationMessageV1 =>
  isInertPresentationValue(value) && isMessageGrammar(value);
/** Validate the record and its entire message without executing accessors. */
export const isPresentationRecordV1 = (
  value: unknown
): value is PresentationRecordV1 =>
  isInertPresentationValue(value) && isRecordGrammar(value);
