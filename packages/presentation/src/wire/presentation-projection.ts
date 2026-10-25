/** Source capability downgrade, with an Effect-free absence result. See PROVENANCE.md. */
import {
  PresentationMessageV1Kinds,
  isPresentationMessageV1,
  type PresentationMessageV1,
  type PresentationMessageKindV1,
} from './messages.js';
import { hasExactKeys, isInertPresentationValue } from './safety.js';

export interface PresentationCapabilitiesV1 {
  readonly version: '1';
  readonly messageKinds: readonly PresentationMessageKindV1[];
}

/** Reject unknown versions, kinds, duplicate kinds and executable object shapes. */
export const isPresentationCapabilitiesV1 = (
  value: unknown
): value is PresentationCapabilitiesV1 =>
  isInertPresentationValue(value) &&
  hasExactKeys(value, ['version', 'messageKinds']) &&
  value.version === '1' &&
  Array.isArray(value.messageKinds) &&
  value.messageKinds.length <= PresentationMessageV1Kinds.length &&
  value.messageKinds.every((kind) =>
    PresentationMessageV1Kinds.some((known) => known === kind)
  ) &&
  new Set(value.messageKinds).size === value.messageKinds.length;

/** Preserve source semantics: drop unsupported groups, never flatten or invent text. */
const downgrade = (
  message: PresentationMessageV1,
  kinds: readonly PresentationMessageKindV1[]
): PresentationMessageV1 | undefined => {
  if (!kinds.includes(message.kind)) return undefined;
  if (message.kind !== 'group') return message;
  const children = message.children.flatMap((child) => {
    const result = downgrade(child, kinds);
    return result === undefined ? [] : [result];
  });
  return message.children.length > 0 && children.length === 0
    ? undefined
    : { ...message, children };
};

/** Return undefined when validation fails or the capabilities silence the message. */
export const downgradePresentationMessageV1 = (
  message: unknown,
  capabilities: unknown
): PresentationMessageV1 | undefined => {
  if (
    !isPresentationMessageV1(message) ||
    !isPresentationCapabilitiesV1(capabilities)
  )
    return undefined;
  const result = downgrade(message, capabilities.messageKinds);
  return isPresentationMessageV1(result) ? result : undefined;
};
