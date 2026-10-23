/**
 * The server side of the A2A v0.3 compatibility layer: the v0.3 JSON-RPC
 * dispatcher, the v0.3 HTTP+JSON routes, the v0.3 Agent Card and the v0.3
 * push notification serializer, all over the v1.0 request handler.
 *
 * Enable it on the HTTP bindings with `legacyCompat`:
 *
 * ```ts
 * import { legacyCompat } from '@jambudipa/a2a/compat/v0_3/server'
 *
 * HttpRouter.serve(A2AHttpRoutes.layer({ legacyCompat }))
 * ```
 *
 * The Agent Card must declare interfaces with protocol version 0.3 (see
 * `duplicateInterfacesForLegacy`), or every v0.3 request fails the version
 * check. This entry point loads no gRPC or protobuf code.
 *
 * @since 0.1.0
 */
import { Effect } from 'effect';
import type { LegacyCompat } from '../../../server/LegacyCompat.js';
import { encodeJson } from '../../../server/internal/http.js';
import type { AgentCard as V1AgentCard } from '../../../Types.js';
import { toCompatAgentCard } from '../AgentCard.js';
import { LEGACY_JSON_CONTENT_TYPE } from '../Constants.js';
import { toLegacyErrorBody } from '../Errors.js';
import { AgentCard } from '../Types.js';
import { makeLegacyJsonRpcDispatcher } from './JsonRpc.js';
import { makeLegacyRestRoutes } from './Rest.js';

export * from './JsonRpc.js';
export * from './PushNotification.js';
export * from './Rest.js';

/**
 * The Agent Card response for a v0.3 request: the v0.3 card with the v1.0
 * interfaces embedded, or 400 with a v0.3 error body when the card declares
 * no v0.3 interface.
 *
 * @since 0.1.0
 */
export const legacyAgentCardResponse = (card: V1AgentCard) =>
  toCompatAgentCard(card, { embedV1Interfaces: true }).pipe(
    Effect.flatMap(encodeJson(AgentCard)),
    Effect.map((body) => ({
      status: 200,
      contentType: LEGACY_JSON_CONTENT_TYPE,
      body,
    })),
    Effect.catch((error) =>
      Effect.succeed({
        status: 400,
        contentType: LEGACY_JSON_CONTENT_TYPE,
        body: toLegacyErrorBody(error),
      })
    )
  );

/**
 * The v0.3 support of the JSON-RPC, HTTP+JSON and Agent Card bindings.
 *
 * @since 0.1.0
 */
export const legacyCompat: LegacyCompat = {
  jsonRpcDispatcher: makeLegacyJsonRpcDispatcher,
  restRoutes: makeLegacyRestRoutes,
  agentCard: legacyAgentCardResponse,
};
