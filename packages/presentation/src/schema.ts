/** Stable Effect 4 codecs use the same guards before any structural transformation. */
import { Schema } from 'effect';
import {
  isJsonValueV1,
  isPresentationMessageV1,
  isPresentationRecordV1,
  isUserInteractionRequestV1,
  isUserInteractionResponseV1,
  isPresentationCapabilitiesV1,
  type JsonValueV1,
  type PresentationMessageV1,
  type PresentationRecordV1,
  type UserInteractionRequestV1,
  type UserInteractionResponseV1,
  type PresentationCapabilitiesV1,
} from './wire/index.js';

export const JsonValueV1Schema: Schema.Codec<JsonValueV1> =
  Schema.declare<JsonValueV1>(isJsonValueV1);
export const PresentationMessageV1Schema: Schema.Codec<PresentationMessageV1> =
  Schema.declare<PresentationMessageV1>(isPresentationMessageV1);
export const PresentationRecordV1Schema: Schema.Codec<PresentationRecordV1> =
  Schema.declare<PresentationRecordV1>(isPresentationRecordV1);
export const UserInteractionRequestV1Schema: Schema.Codec<UserInteractionRequestV1> =
  Schema.declare<UserInteractionRequestV1>(isUserInteractionRequestV1);
export const UserInteractionResponseV1Schema: Schema.Codec<UserInteractionResponseV1> =
  Schema.declare<UserInteractionResponseV1>(isUserInteractionResponseV1);
export const PresentationCapabilitiesV1Schema: Schema.Codec<PresentationCapabilitiesV1> =
  Schema.declare<PresentationCapabilitiesV1>(isPresentationCapabilitiesV1);
