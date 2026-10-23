/**
 * The typed Agent Protocol client, derived from `AgentProtocolApi`.
 *
 * The npm `agent-protocol` 1.0.5 package has no client. This one calls any
 * server that implements the specification. Each method is named after its
 * `operationId`, for example `client.createAgentTask({ payload })`.
 *
 * @since 0.1.0
 */
import { Context, Layer } from 'effect';
import { HttpApiClient } from 'effect/http-api';
import { AgentProtocolApi } from './Api.js';

/**
 * Options of the client.
 *
 * @since 0.1.0
 */
export interface Options {
  /**
   * The URL of the agent, for example `http://localhost:8000`. Omit it when
   * the `HttpClient` already prepends the URL.
   */
  readonly baseUrl?: string | URL;
}

/**
 * The typed client of an Agent Protocol server.
 *
 * @since 0.1.0
 */
export class AgentProtocolClient extends Context.Service<
  AgentProtocolClient,
  HttpApiClient.ForApi<typeof AgentProtocolApi>
>()('@jambudipa/agent-protocol/AgentProtocolClient') {
  /**
   * Builds the client on the `HttpClient` in the context.
   *
   * @since 0.1.0
   */
  static readonly layer = (options: Options = {}) =>
    Layer.effect(
      AgentProtocolClient,
      HttpApiClient.make(AgentProtocolApi, options)
    );
}
