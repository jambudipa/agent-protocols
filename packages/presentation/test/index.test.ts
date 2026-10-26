/**
 * The public surface, by name. The two lists below are every name that
 * jam-flow's `packages/flow/src/presentation/index.ts` exports at commit
 * `4f8dafdf`, minus `export * from './terminal/index.js'`. A missing, renamed
 * or extra runtime export fails the first test; a missing or renamed type
 * export fails the type check of this file.
 */
import { describe, expect, expectTypeOf, it } from '@effect/vitest';

import * as Presentation from '../src/index.js';

const runtimeNames = [
  'AgentPlanError',
  'BrowserPresentationProjection',
  'DEDUPLICATION_WINDOW',
  'JsonValueV1Limits',
  'JsonValueV1Schema',
  'MAX_BLOCK_BYTES',
  'MAX_EXACT',
  'MAX_FIELD_KEY_BYTES',
  'MAX_FIELD_VALUE_BYTES',
  'MAX_INFORMATION_FIELDS',
  'MAX_PLAN_ENTRIES',
  'MAX_REQUEST_BYTES',
  'MAX_SESSION_TITLE_BYTES',
  'MAX_SNAPSHOT_BYTES',
  'MAX_TITLE_BYTES',
  'PLAN_PRIORITIES',
  'PresentationCapabilitiesV1Schema',
  'PresentationMessageV1Kinds',
  'PresentationMessageV1Schema',
  'PresentationRecordV1Schema',
  'PresentationV1Limits',
  'RichContentError',
  'SessionInformationError',
  'UsageError',
  'UserInteractionRequestV1Schema',
  'UserInteractionResponseV1Schema',
  'UserInteractionV1Limits',
  'addExact',
  'applyConsumption',
  'applyInformation',
  'assembleChunks',
  'blockBytes',
  'downgradeMessage',
  'downgradePresentationMessageV1',
  'emptyInformation',
  'emptyUsage',
  'informationPayload',
  'isJsonValueV1',
  'isLegalEntryTransition',
  'isOpaqueIdentifierV1',
  'isPresentationMessageV1',
  'isPresentationRecordV1',
  'isUserInteractionRequestV1',
  'isUserInteractionResponseV1',
  'isUtf8StringWithin',
  'jsonValueV1Utf8Bytes',
  'makeUsageAccumulator',
  'messageBytes',
  'projectBrowserPresentation',
  'projectPlan',
  'replaceMessage',
  'replaceSnapshot',
  'restoreInformation',
  'snapshotBytes',
  'usagePayload',
  'validateBlock',
  'validateConsumption',
  'validateContext',
  'validateCost',
  'validateInformation',
  'validateInteractionResponseV1',
  'validateMessage',
  'validateProgress',
  'validateSnapshot',
];

describe('index', () => {
  it('exports exactly the runtime names of the jam-flow presentation barrel', () => {
    expect(Object.keys(Presentation).sort()).toEqual([...runtimeNames].sort());
  });

  it('exports every type name of the jam-flow presentation barrel', () => {
    expectTypeOf<Presentation.BrowserPresentationProjectionFunction>().not.toBeNever();
    expectTypeOf<Presentation.Consumption>().not.toBeNever();
    expectTypeOf<Presentation.ContentAnnotation>().not.toBeNever();
    expectTypeOf<Presentation.ContentBlock>().not.toBeNever();
    expectTypeOf<Presentation.ContentBlockKind>().not.toBeNever();
    expectTypeOf<Presentation.ContentChunk>().not.toBeNever();
    expectTypeOf<Presentation.ContentRejection>().not.toBeNever();
    expectTypeOf<Presentation.ContentRole>().not.toBeNever();
    expectTypeOf<Presentation.ContextWindow>().not.toBeNever();
    expectTypeOf<Presentation.CustomBrowserPresentationProjection>().not.toBeNever();
    expectTypeOf<Presentation.InformationField>().not.toBeNever();
    expectTypeOf<Presentation.InformationRejection>().not.toBeNever();
    expectTypeOf<Presentation.InformationSnapshot>().not.toBeNever();
    expectTypeOf<Presentation.InformationUpdate>().not.toBeNever();
    expectTypeOf<Presentation.InteractionResponseConstraintResultV1>().not.toBeNever();
    expectTypeOf<Presentation.JsonArrayV1>().not.toBeNever();
    expectTypeOf<Presentation.JsonObjectV1>().not.toBeNever();
    expectTypeOf<Presentation.JsonPrimitiveV1>().not.toBeNever();
    expectTypeOf<Presentation.JsonValueV1>().not.toBeNever();
    expectTypeOf<Presentation.MinorCost>().not.toBeNever();
    expectTypeOf<Presentation.PlanEntry>().not.toBeNever();
    expectTypeOf<Presentation.PlanEntryStatus>().not.toBeNever();
    expectTypeOf<Presentation.PlanPriority>().not.toBeNever();
    expectTypeOf<Presentation.PlanRejection>().not.toBeNever();
    expectTypeOf<Presentation.PlanSnapshot>().not.toBeNever();
    expectTypeOf<Presentation.PlannableUnit>().not.toBeNever();
    expectTypeOf<Presentation.PresentationCapabilitiesV1>().not.toBeNever();
    expectTypeOf<Presentation.PresentationCapability>().not.toBeNever();
    expectTypeOf<Presentation.PresentationCorrelationV1>().not.toBeNever();
    expectTypeOf<Presentation.PresentationMessageKindV1>().not.toBeNever();
    expectTypeOf<Presentation.PresentationMessageV1>().not.toBeNever();
    expectTypeOf<Presentation.PresentationRecordV1>().not.toBeNever();
    expectTypeOf<Presentation.RichMessage>().not.toBeNever();
    expectTypeOf<Presentation.UsageAccumulator>().not.toBeNever();
    expectTypeOf<Presentation.UsageRejection>().not.toBeNever();
    expectTypeOf<Presentation.UsageSnapshot>().not.toBeNever();
    expectTypeOf<Presentation.UserInteractionRequestV1>().not.toBeNever();
    expectTypeOf<Presentation.UserInteractionResponseV1>().not.toBeNever();
  });
});
