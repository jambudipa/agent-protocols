/**
 * Push notifications for webhooks registered over protocol 0.3: the body is
 * the v0.3 JSON of the event, as `V03PushNotificationSerializer` of
 * `@a2a-js/sdk` 1.3.0 writes it.
 *
 * @since 0.1.0
 */
import { Effect, Layer, Option, Schema } from 'effect';
import type { HttpClient } from 'effect/http';
import { A2A_LEGACY_PROTOCOL_VERSION } from '../../../Constants.js';
import {
  DefaultPushNotificationSender,
  type DefaultPushNotificationSenderOptions,
  type PushNotificationSender,
  type PushNotificationSerializer,
} from '../../../server/PushNotificationSender.js';
import type { PushNotificationStore } from '../../../server/PushNotificationStore.js';
import { LEGACY_JSON_CONTENT_TYPE } from '../Constants.js';
import {
  toCompatMessage,
  toCompatTask,
  toCompatTaskArtifactUpdateEvent,
  toCompatTaskStatusUpdateEvent,
} from '../translate.js';
import { StreamEvent } from '../Types.js';

const encodeEvent = Schema.encodeEffect(Schema.fromJsonString(StreamEvent));

/**
 * The v0.3 serializer: a task event, or a status or artifact update with a
 * known task, is sent as the whole v0.3 task; a message as the v0.3 message;
 * an update without a task as the v0.3 update.
 *
 * @since 0.1.0
 */
export const V03PushNotificationSerializer: PushNotificationSerializer = (
  streamResponse,
  task
) => {
  const event =
    'task' in streamResponse
      ? toCompatTask(Option.getOrElse(task, () => streamResponse.task))
      : 'message' in streamResponse
        ? toCompatMessage(streamResponse.message)
        : Option.isSome(task)
          ? toCompatTask(task.value)
          : 'statusUpdate' in streamResponse
            ? toCompatTaskStatusUpdateEvent(streamResponse.statusUpdate)
            : toCompatTaskArtifactUpdateEvent(streamResponse.artifactUpdate);
  return Effect.map(encodeEvent(event), (body) => ({
    body,
    contentType: LEGACY_JSON_CONTENT_TYPE,
  }));
};

/**
 * The serializers of a sender that serves v0.3 and v1.0 webhooks.
 *
 * @since 0.1.0
 */
export const legacyPushNotificationSerializers: {
  readonly [version: string]: PushNotificationSerializer;
} = { [A2A_LEGACY_PROTOCOL_VERSION]: V03PushNotificationSerializer };

/**
 * The default push sender with the v0.3 serializer added: webhooks saved
 * over protocol 0.3 get v0.3 bodies.
 *
 * @since 0.1.0
 */
export const createLegacyAwarePushNotificationSender = (
  options: DefaultPushNotificationSenderOptions = {}
): Layer.Layer<
  PushNotificationSender,
  never,
  PushNotificationStore | HttpClient.HttpClient
> =>
  DefaultPushNotificationSender.layer({
    ...options,
    serializers: {
      ...legacyPushNotificationSerializers,
      ...options.serializers,
    },
  });

/**
 * The same sender, built as an effect.
 *
 * @since 0.1.0
 */
export const makeLegacyAwarePushNotificationSender = (
  options: DefaultPushNotificationSenderOptions = {}
) =>
  DefaultPushNotificationSender.make({
    ...options,
    serializers: {
      ...legacyPushNotificationSerializers,
      ...options.serializers,
    },
  });
