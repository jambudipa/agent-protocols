export {
  JsonValueV1Limits,
  JsonValueV1Schema,
  isJsonValueV1,
  isOpaqueIdentifierV1,
  isUtf8StringWithin,
  jsonValueV1Utf8Bytes,
} from './json-value.js';
export type {
  JsonArrayV1,
  JsonObjectV1,
  JsonPrimitiveV1,
  JsonValueV1,
} from './json-value.js';

export {
  UserInteractionV1Limits,
  UserInteractionRequestV1Schema,
  UserInteractionResponseV1Schema,
  isUserInteractionRequestV1,
  isUserInteractionResponseV1,
  validateInteractionResponseV1,
} from './interactions.js';
export type {
  InteractionResponseConstraintResultV1,
  UserInteractionRequestV1,
  UserInteractionResponseV1,
} from './interactions.js';

export {
  PresentationMessageV1Kinds,
  PresentationMessageV1Schema,
  PresentationRecordV1Schema,
  PresentationV1Limits,
  isPresentationMessageV1,
  isPresentationRecordV1,
} from './messages.js';
export type {
  PresentationCorrelationV1,
  PresentationMessageKindV1,
  PresentationMessageV1,
  PresentationRecordV1,
} from './messages.js';

export {
  BrowserPresentationProjection,
  PresentationCapabilitiesV1Schema,
  downgradePresentationMessageV1,
  projectBrowserPresentation,
} from './presentation-projection.js';
export type {
  BrowserPresentationProjection as BrowserPresentationProjectionFunction,
  CustomBrowserPresentationProjection,
  PresentationCapabilitiesV1,
} from './presentation-projection.js';

// T5.1 — role-aware rich content for the host boundary. Sits beside the V1 contract above
// rather than reshaping it: V1 describes what a renderer receives, this describes what a
// host exchanges with a peer.
export {
  MAX_BLOCK_BYTES,
  MAX_REQUEST_BYTES,
  RichContentError,
  assembleChunks,
  blockBytes,
  downgradeMessage,
  messageBytes,
  replaceMessage,
  validateBlock,
  validateMessage,
} from './rich-content.js';
export type {
  ContentAnnotation,
  ContentBlock,
  ContentBlockKind,
  ContentChunk,
  ContentRejection,
  ContentRole,
  PresentationCapability,
  RichMessage,
} from './rich-content.js';

// T5.3 — the complete Agent Plan a client is shown. Every update replaces the whole
// snapshot: a client that missed one delta would show a plan that never existed.
export {
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
} from './agent-plan.js';
export type {
  PlanEntry,
  PlanEntryStatus,
  PlanPriority,
  PlanRejection,
  PlanSnapshot,
  PlannableUnit,
} from './agent-plan.js';

// T5.6 — the Session title and information fields a client is shown, and the snapshot a
// later connection restores. Whole snapshots, so there is no partial state to reconcile.
export {
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
} from './session-information.js';
export type {
  InformationField,
  InformationRejection,
  InformationSnapshot,
  InformationUpdate,
} from './session-information.js';

// T5.6 — cumulative token and cost totals in exact integers. Money accumulated in floating
// point drifts, and a total wrong in the last place is one nobody can reconcile.
export {
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
} from './usage.js';
export type {
  Consumption,
  ContextWindow,
  MinorCost,
  UsageAccumulator,
  UsageRejection,
  UsageSnapshot,
} from './usage.js';
