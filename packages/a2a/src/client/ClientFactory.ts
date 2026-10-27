/**
 * The client factory: picks a transport from the Agent Card and builds a
 * client over it.
 *
 * @since 0.1.0
 */
import { Effect, Option } from 'effect';
import type { HttpClient } from 'effect/http';
import type { TransportProtocolName } from '../Constants.js';
import { A2ATransportError, type ClientError } from '../errors/index.js';
import type { AgentCard, AgentInterface } from '../Types.js';
import {
  type AgentCardResolver,
  DefaultAgentCardResolver,
} from './AgentCardResolver.js';
import { type Client, type ClientConfig, makeClient } from './Client.js';
import { JsonRpcTransportFactory } from './JsonRpcTransport.js';
import { RestTransportFactory } from './RestTransport.js';
import { TenantTransportDecorator } from './TenantTransport.js';
import type { TransportFactory } from './Transport.js';

/**
 * The options of a client factory.
 *
 * @since 0.1.0
 */
export interface ClientFactoryOptions {
  /**
   * The transport factories. The default is JSON-RPC and HTTP+JSON; add
   * `GrpcTransportFactory` of `@jambudipa/a2a/client/grpc` for gRPC.
   */
  readonly transports?: ReadonlyArray<TransportFactory>;
  /** The configuration of every client that the factory builds. */
  readonly clientConfig?: ClientConfig;
  /** Bindings to try before the order of the card. */
  readonly preferredTransports?: ReadonlyArray<TransportProtocolName>;
  /**
   * The resolver of `createFromUrl`. The default is
   * `DefaultAgentCardResolver` on the `HttpClient` of the context.
   */
  readonly cardResolver?: AgentCardResolver;
}

/**
 * Builds clients for agents.
 *
 * @since 0.1.0
 */
export interface ClientFactory {
  /**
   * The options that the factory was made with, as given: the defaults are
   * not filled in. Pass them to `mergeClientFactoryOptions` to derive a
   * factory.
   */
  readonly options: ClientFactoryOptions;
  /**
   * Builds a client from a card: the first binding of the preferred
   * transports, then of the card, that a factory serves; for each binding
   * the interface with protocol version 1.0 wins. An interface with a
   * tenant gets a tenant decorator.
   */
  readonly createFromAgentCard: (
    agentCard: AgentCard
  ) => Effect.Effect<Client, ClientError>;
  /** Fetches the card with the resolver, then builds a client from it. */
  readonly createFromUrl: (
    baseUrl: string,
    path?: string
  ) => Effect.Effect<Client, ClientError>;
}

/**
 * A configuration fault of the factory, such as no transports or an unknown
 * preferred transport. It is a transport error with protocol `client`.
 */
const configError = (message: string) =>
  new A2ATransportError({ message, protocol: 'client' });

/**
 * Indexes the factories by upper-case protocol name, because bindings match
 * case-insensitively. Fails when two factories claim the same name.
 */
const byName = (
  transports: ReadonlyArray<TransportFactory>
): Effect.Effect<
  { readonly [name: string]: TransportFactory },
  A2ATransportError
> => {
  const entries = transports.map(
    (factory) => [factory.protocolName.toUpperCase(), factory] as const
  );
  const names = entries.map(([name]) => name);
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  return duplicate === undefined
    ? Effect.succeed(Object.fromEntries(entries))
    : Effect.fail(configError(`Duplicate protocol name: ${duplicate}`));
};

/**
 * Merges factory options: transports by protocol name, interceptors in
 * order; other fields of `overrides` win.
 *
 * @since 0.1.0
 */
export const mergeClientFactoryOptions = (
  original: ClientFactoryOptions,
  overrides: ClientFactoryOptions
): ClientFactoryOptions => {
  const transports = Object.fromEntries(
    [...(original.transports ?? []), ...(overrides.transports ?? [])].map(
      (factory) => [factory.protocolName.toUpperCase(), factory] as const
    )
  );
  const interceptors = [
    ...(original.clientConfig?.interceptors ?? []),
    ...(overrides.clientConfig?.interceptors ?? []),
  ];
  return {
    ...original,
    ...overrides,
    transports: Object.values(transports),
    clientConfig: {
      ...original.clientConfig,
      ...overrides.clientConfig,
      interceptors,
    },
  };
};

/**
 * Validates the options once, so that a bad transport list or an unknown
 * preferred transport fails at `make` rather than at the first call.
 * `defaults` fill the transports and the resolver that the options omit.
 */
const makeFactory = (
  options: ClientFactoryOptions,
  defaults: {
    readonly transports: ReadonlyArray<TransportFactory>;
    readonly cardResolver: AgentCardResolver;
  }
): Effect.Effect<ClientFactory, A2ATransportError> =>
  Effect.gen(function* () {
    const transports = options.transports ?? defaults.transports;
    if (transports.length === 0) {
      return yield* configError('No transports provided');
    }
    const factories = yield* byName(transports);
    const known = (name: string) =>
      Option.fromUndefinedOr(factories[name.toUpperCase()]);
    for (const preferred of options.preferredTransports ?? []) {
      if (Option.isNone(known(preferred))) {
        return yield* configError(
          `Unknown preferred transport: ${preferred}, available transports: ${transports.map((factory) => factory.protocolName).join()}`
        );
      }
    }
    const cardResolver = options.cardResolver ?? defaults.cardResolver;

    const createFromNormalizedAgentCard = (agentCard: AgentCard) =>
      Effect.gen(function* () {
        const best: Record<string, AgentInterface> = {};
        for (const candidate of agentCard.supportedInterfaces) {
          const key = candidate.protocolBinding.toUpperCase();
          if (best[key] === undefined || candidate.protocolVersion === '1.0') {
            best[key] = candidate;
          }
        }
        const order = [
          ...(options.preferredTransports ?? []),
          ...agentCard.supportedInterfaces.map(
            (candidate) => candidate.protocolBinding
          ),
        ];
        for (const name of order) {
          const selected = Option.fromUndefinedOr(best[name.toUpperCase()]);
          const factory = known(name);
          if (Option.isSome(selected) && Option.isSome(factory)) {
            const base = yield* factory.value.create(
              selected.value.url,
              agentCard
            );
            const tenant = selected.value.tenant ?? '';
            const transport =
              tenant === '' ? base : TenantTransportDecorator(base, tenant);
            return yield* makeClient(
              transport,
              agentCard,
              options.clientConfig
            );
          }
        }
        return yield* configError(
          `No compatible transport found, available transports: ${transports.map((factory) => factory.protocolName).join()}`
        );
      });

    return {
      options,
      createFromAgentCard: (agentCard) =>
        createFromNormalizedAgentCard(agentCard),
      createFromUrl: (baseUrl, path) =>
        Effect.flatMap(
          cardResolver.resolve(baseUrl, path),
          createFromNormalizedAgentCard
        ),
    };
  });

/**
 * The client factory of the reference SDK, on the `HttpClient` of the
 * context: JSON-RPC and HTTP+JSON by default, gRPC when its factory is
 * added.
 *
 * ```ts
 * const factory = yield* ClientFactory.make()
 * const client = yield* factory.createFromUrl('http://localhost:41241')
 * const result = yield* client.sendMessage({ message })
 * ```
 *
 * @since 0.1.0
 */
export const ClientFactory = {
  make: (
    options: ClientFactoryOptions = {}
  ): Effect.Effect<ClientFactory, A2ATransportError, HttpClient.HttpClient> =>
    Effect.gen(function* () {
      const jsonRpc = yield* JsonRpcTransportFactory.make();
      const rest = yield* RestTransportFactory.make();
      const cardResolver = yield* DefaultAgentCardResolver.make();
      return yield* makeFactory(options, {
        transports: [jsonRpc, rest],
        cardResolver,
      });
    }),
};
