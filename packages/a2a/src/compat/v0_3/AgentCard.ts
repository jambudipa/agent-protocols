/**
 * The Agent Card across protocol versions: the v0.3 card that a v1.0 server
 * serves to a v0.3 client, and the v1.0 card that a v1.0 client builds from
 * a v0.3 card.
 *
 * @since 0.1.0
 */
import { Effect, Option, Predicate, Schema } from 'effect';
import { A2A_LEGACY_PROTOCOL_VERSION } from '../../Constants.js';
import {
  RequestMalformedError,
  VersionNotSupportedError,
} from '../../errors/index.js';
import { isLegacyVersion } from '../../internal/version.js';
import type * as V1 from '../../Types.js';
import * as V03 from './Types.js';

/** Treats `undefined` and the empty string alike as absent, as protobuf defaults do. */
const nonEmpty = (value: string | undefined): Option.Option<string> =>
  value === undefined || value === '' ? Option.none() : Option.some(value);

/** Spreads `{ [key]: value }` when the value is present and `{}` otherwise, so absent fields are omitted rather than set to `undefined`. */
const optional = <K extends string, A>(
  key: K,
  value: Option.Option<A>
): { readonly [P in K]?: A } =>
  Option.match(value, {
    onNone: () => ({}),
    onSome: (present) => ({ [key]: present }) as { readonly [P in K]: A },
  });

/** Treats `undefined` and the empty list alike as absent, so empty arrays are omitted from the output. */
const nonEmptyList = <A>(
  values: ReadonlyArray<A> | undefined
): Option.Option<ReadonlyArray<A>> =>
  values === undefined || values.length === 0
    ? Option.none()
    : Option.some(values);

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

/** @since 0.1.0 */
export const toCompatSecurityRequirement = (
  requirement: V1.SecurityRequirement
): V03.SecurityRequirement =>
  Object.fromEntries(
    Object.entries(requirement.schemes ?? {}).map(([scheme, scopes]) => [
      scheme,
      scopes.list ?? [],
    ])
  );

/** @since 0.1.0 */
export const toCoreSecurityRequirement = (
  requirement: V03.SecurityRequirement
): V1.SecurityRequirement => ({
  schemes: Object.fromEntries(
    Object.entries(requirement).map(([scheme, scopes]) => [
      scheme,
      { list: scopes },
    ])
  ),
});

/**
 * A v1.0 OAuth flow set as v0.3 flows. Only the first flow present is kept.
 * A flow v0.3 cannot express, such as `deviceCode`, yields `{}`; missing
 * implicit and password fields fall back to empty values.
 */
const toCompatOAuthFlows = (flows: V1.OAuthFlows): V03.OAuthFlows => {
  if ('authorizationCode' in flows) {
    const flow = flows.authorizationCode;
    return {
      authorizationCode: {
        authorizationUrl: flow.authorizationUrl,
        tokenUrl: flow.tokenUrl,
        scopes: flow.scopes,
        ...optional('refreshUrl', nonEmpty(flow.refreshUrl)),
      },
    };
  }
  if ('clientCredentials' in flows) {
    const flow = flows.clientCredentials;
    return {
      clientCredentials: {
        tokenUrl: flow.tokenUrl,
        scopes: flow.scopes,
        ...optional('refreshUrl', nonEmpty(flow.refreshUrl)),
      },
    };
  }
  if ('implicit' in flows) {
    const flow = flows.implicit;
    return {
      implicit: {
        authorizationUrl: flow.authorizationUrl ?? '',
        scopes: flow.scopes ?? {},
        ...optional('refreshUrl', nonEmpty(flow.refreshUrl)),
      },
    };
  }
  if ('password' in flows) {
    const flow = flows.password;
    return {
      password: {
        tokenUrl: flow.tokenUrl ?? '',
        scopes: flow.scopes ?? {},
        ...optional('refreshUrl', nonEmpty(flow.refreshUrl)),
      },
    };
  }
  return {};
};

/**
 * A v1.0 security scheme as a v0.3 scheme. An API key location other than
 * `cookie` or `query` becomes `header`.
 *
 * @since 0.1.0
 */
export const toCompatSecurityScheme = (
  scheme: V1.SecurityScheme
): V03.SecurityScheme => {
  if ('apiKeySecurityScheme' in scheme) {
    const value = scheme.apiKeySecurityScheme;
    return {
      type: 'apiKey',
      name: value.name,
      in:
        value.location === 'cookie' || value.location === 'query'
          ? value.location
          : 'header',
      ...optional('description', nonEmpty(value.description)),
    };
  }
  if ('httpAuthSecurityScheme' in scheme) {
    const value = scheme.httpAuthSecurityScheme;
    return {
      type: 'http',
      scheme: value.scheme,
      ...optional('description', nonEmpty(value.description)),
      ...optional('bearerFormat', nonEmpty(value.bearerFormat)),
    };
  }
  if ('oauth2SecurityScheme' in scheme) {
    const value = scheme.oauth2SecurityScheme;
    return {
      type: 'oauth2',
      flows: toCompatOAuthFlows(value.flows),
      ...optional('description', nonEmpty(value.description)),
      ...optional('oauth2MetadataUrl', nonEmpty(value.oauth2MetadataUrl)),
    };
  }
  if ('openIdConnectSecurityScheme' in scheme) {
    const value = scheme.openIdConnectSecurityScheme;
    return {
      type: 'openIdConnect',
      openIdConnectUrl: value.openIdConnectUrl,
      ...optional('description', nonEmpty(value.description)),
    };
  }
  return {
    type: 'mutualTLS',
    ...optional('description', nonEmpty(scheme.mtlsSecurityScheme.description)),
  };
};

/**
 * v0.3 OAuth flows as a v1.0 flow set. Only the first flow present is kept,
 * in the order authorization code, client credentials, implicit, password.
 * Fails with `RequestMalformedError` when no flow is declared.
 */
const toCoreOAuthFlows = (
  flows: V03.OAuthFlows
): Effect.Effect<V1.OAuthFlows, RequestMalformedError> => {
  if (flows.authorizationCode !== undefined) {
    const flow = flows.authorizationCode;
    return Effect.succeed({
      authorizationCode: {
        authorizationUrl: flow.authorizationUrl,
        tokenUrl: flow.tokenUrl,
        scopes: flow.scopes,
        ...optional('refreshUrl', nonEmpty(flow.refreshUrl)),
      },
    });
  }
  if (flows.clientCredentials !== undefined) {
    const flow = flows.clientCredentials;
    return Effect.succeed({
      clientCredentials: {
        tokenUrl: flow.tokenUrl,
        scopes: flow.scopes,
        ...optional('refreshUrl', nonEmpty(flow.refreshUrl)),
      },
    });
  }
  if (flows.implicit !== undefined) {
    const flow = flows.implicit;
    return Effect.succeed({
      implicit: {
        authorizationUrl: flow.authorizationUrl,
        scopes: flow.scopes,
        ...optional('refreshUrl', nonEmpty(flow.refreshUrl)),
      },
    });
  }
  if (flows.password !== undefined) {
    const flow = flows.password;
    return Effect.succeed({
      password: {
        tokenUrl: flow.tokenUrl,
        scopes: flow.scopes,
        ...optional('refreshUrl', nonEmpty(flow.refreshUrl)),
      },
    });
  }
  return Effect.fail(
    new RequestMalformedError({
      message: 'OAuthFlows must declare at least one flow',
    })
  );
};

/**
 * A v0.3 security scheme as a v1.0 scheme.
 *
 * @since 0.1.0
 */
export const toCoreSecurityScheme = (
  scheme: V03.SecurityScheme
): Effect.Effect<V1.SecurityScheme, RequestMalformedError> => {
  switch (scheme.type) {
    case 'apiKey':
      return Effect.succeed({
        apiKeySecurityScheme: {
          location: scheme.in,
          name: scheme.name,
          ...optional('description', nonEmpty(scheme.description)),
        },
      });
    case 'http':
      return Effect.succeed({
        httpAuthSecurityScheme: {
          scheme: scheme.scheme,
          ...optional('description', nonEmpty(scheme.description)),
          ...optional('bearerFormat', nonEmpty(scheme.bearerFormat)),
        },
      });
    case 'oauth2':
      return Effect.map(toCoreOAuthFlows(scheme.flows), (flows) => ({
        oauth2SecurityScheme: {
          flows,
          ...optional('description', nonEmpty(scheme.description)),
          ...optional('oauth2MetadataUrl', nonEmpty(scheme.oauth2MetadataUrl)),
        },
      }));
    case 'openIdConnect':
      return Effect.succeed({
        openIdConnectSecurityScheme: {
          openIdConnectUrl: scheme.openIdConnectUrl,
          ...optional('description', nonEmpty(scheme.description)),
        },
      });
    case 'mutualTLS':
      return Effect.succeed({
        mtlsSecurityScheme: {
          ...optional('description', nonEmpty(scheme.description)),
        },
      });
  }
};

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

/**
 * The options of {@link toCompatAgentCard}.
 *
 * @since 0.1.0
 */
export interface ToCompatAgentCardOptions {
  /**
   * Copies every v1.0 interface into `supportedInterfaces`, so that a v1.0
   * client that reads the v0.3 card finds them.
   */
  readonly embedV1Interfaces?: boolean;
}

/** True for an interface a v0.3 client can use: an empty (unstated) version or one in [0.3, 1.0). */
const isCompatInterface = (agentInterface: V1.AgentInterface) =>
  agentInterface.protocolVersion === '' ||
  isLegacyVersion(agentInterface.protocolVersion);

/**
 * The v0.3 form of a v1.0 card. The first interface with a version in
 * [0.3, 1.0) is the primary `url`; the others are `additionalInterfaces`.
 * A card without such an interface cannot be expressed in v0.3.
 *
 * @since 0.1.0
 */
export const toCompatAgentCard = (
  card: V1.AgentCard,
  options: ToCompatAgentCardOptions = {}
): Effect.Effect<V03.AgentCard, VersionNotSupportedError> => {
  const compatInterfaces = card.supportedInterfaces.filter(isCompatInterface);
  const [primary, ...additional] = compatInterfaces;
  if (primary === undefined) {
    return Effect.fail(
      new VersionNotSupportedError({
        message:
          'AgentCard must have at least one interface with a protocol version in [0.3, 1.0).',
      })
    );
  }
  const capabilities = card.capabilities;
  const securitySchemes = card.securitySchemes ?? {};
  return Effect.succeed({
    name: card.name,
    description: card.description,
    version: card.version,
    url: primary.url,
    preferredTransport: primary.protocolBinding,
    protocolVersion:
      primary.protocolVersion === ''
        ? A2A_LEGACY_PROTOCOL_VERSION
        : primary.protocolVersion,
    capabilities: {
      ...optional('streaming', Option.fromUndefinedOr(capabilities.streaming)),
      ...optional(
        'pushNotifications',
        Option.fromUndefinedOr(capabilities.pushNotifications)
      ),
      ...optional(
        'extensions',
        Option.map(nonEmptyList(capabilities.extensions), (extensions) =>
          extensions.map((extension) => ({
            uri: extension.uri ?? '',
            required: extension.required ?? false,
            ...optional('description', nonEmpty(extension.description)),
            ...optional('params', Option.fromUndefinedOr(extension.params)),
          }))
        )
      ),
    },
    defaultInputModes: card.defaultInputModes,
    defaultOutputModes: card.defaultOutputModes,
    skills: card.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: skill.tags,
      ...optional('examples', nonEmptyList(skill.examples)),
      ...optional('inputModes', nonEmptyList(skill.inputModes)),
      ...optional('outputModes', nonEmptyList(skill.outputModes)),
      ...optional(
        'security',
        Option.map(nonEmptyList(skill.securityRequirements), (requirements) =>
          requirements.map(toCompatSecurityRequirement)
        )
      ),
    })),
    ...optional(
      'additionalInterfaces',
      Option.map(nonEmptyList(additional), (interfaces) =>
        interfaces.map((agentInterface) => ({
          url: agentInterface.url,
          transport: agentInterface.protocolBinding,
        }))
      )
    ),
    ...optional('provider', Option.fromUndefinedOr(card.provider)),
    ...optional('documentationUrl', nonEmpty(card.documentationUrl)),
    ...optional('iconUrl', nonEmpty(card.iconUrl)),
    ...optional(
      'supportsAuthenticatedExtendedCard',
      Option.fromUndefinedOr(capabilities.extendedAgentCard)
    ),
    ...(Object.keys(securitySchemes).length > 0
      ? {
          securitySchemes: Object.fromEntries(
            Object.entries(securitySchemes).map(([name, scheme]) => [
              name,
              toCompatSecurityScheme(scheme),
            ])
          ),
        }
      : {}),
    ...optional(
      'security',
      Option.map(nonEmptyList(card.securityRequirements), (requirements) =>
        requirements.map(toCompatSecurityRequirement)
      )
    ),
    ...optional('signatures', nonEmptyList(card.signatures)),
    ...(options.embedV1Interfaces === true &&
    card.supportedInterfaces.length > 0
      ? { supportedInterfaces: card.supportedInterfaces }
      : {}),
  });
};

/**
 * The v1.0 form of a v0.3 card. The primary `url` becomes the first
 * interface, with the card's binding and version; the additional
 * interfaces declare version 0.3.
 *
 * @since 0.1.0
 */
export const toCoreAgentCard = (
  card: V03.AgentCard
): Effect.Effect<V1.AgentCard, RequestMalformedError> =>
  Effect.gen(function* () {
    const securitySchemes = yield* Effect.forEach(
      Object.entries(card.securitySchemes ?? {}),
      ([name, scheme]) =>
        Effect.map(
          toCoreSecurityScheme(scheme),
          (core) => [name, core] as const
        )
    );
    const capabilities = card.capabilities;
    return {
      name: card.name,
      description: card.description,
      version: card.version,
      supportedInterfaces: [
        {
          url: card.url,
          protocolBinding: card.preferredTransport ?? 'JSONRPC',
          protocolVersion:
            card.protocolVersion === ''
              ? A2A_LEGACY_PROTOCOL_VERSION
              : card.protocolVersion,
        },
        ...(card.additionalInterfaces ?? []).map((agentInterface) => ({
          url: agentInterface.url,
          protocolBinding: agentInterface.transport,
          protocolVersion: A2A_LEGACY_PROTOCOL_VERSION,
        })),
      ],
      capabilities: {
        ...optional(
          'streaming',
          Option.fromUndefinedOr(capabilities.streaming)
        ),
        ...optional(
          'pushNotifications',
          Option.fromUndefinedOr(capabilities.pushNotifications)
        ),
        extensions: (capabilities.extensions ?? []).map((extension) => ({
          uri: extension.uri,
          description: extension.description ?? '',
          required: extension.required ?? false,
          ...optional('params', Option.fromUndefinedOr(extension.params)),
        })),
        ...optional(
          'extendedAgentCard',
          Option.fromUndefinedOr(card.supportsAuthenticatedExtendedCard)
        ),
      },
      securitySchemes: Object.fromEntries(securitySchemes),
      securityRequirements: (card.security ?? []).map(
        toCoreSecurityRequirement
      ),
      defaultInputModes: card.defaultInputModes,
      defaultOutputModes: card.defaultOutputModes,
      skills: card.skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        tags: skill.tags,
        examples: skill.examples ?? [],
        inputModes: skill.inputModes ?? [],
        outputModes: skill.outputModes ?? [],
        securityRequirements: (skill.security ?? []).map(
          toCoreSecurityRequirement
        ),
      })),
      signatures: card.signatures ?? [],
      ...optional('provider', Option.fromUndefinedOr(card.provider)),
      ...optional(
        'documentationUrl',
        Option.fromUndefinedOr(card.documentationUrl)
      ),
      ...optional('iconUrl', Option.fromUndefinedOr(card.iconUrl)),
    };
  });

/** Top-level card fields that exist in v0.3 only, so their presence marks a legacy card. */
const LEGACY_ONLY_TOP_LEVEL_FIELDS: ReadonlyArray<string> = [
  'preferredTransport',
  'additionalInterfaces',
  'supportsAuthenticatedExtendedCard',
];

/**
 * Tells whether a fetched card is a v0.3 card: no v1.0 interfaces, and a
 * top-level `url`, a v0.3-only field or a 0.x `protocolVersion`.
 *
 * @since 0.1.0
 */
export const isLegacyAgentCard = (raw: unknown): boolean => {
  if (!Predicate.isObject(raw) || Array.isArray(raw)) return false;
  const interfaces = raw['supportedInterfaces'];
  if (Array.isArray(interfaces) && interfaces.length > 0) return false;
  if (Predicate.isString(raw['url']) && !('supportedInterfaces' in raw)) {
    return true;
  }
  if (LEGACY_ONLY_TOP_LEVEL_FIELDS.some((field) => field in raw)) return true;
  const version = raw['protocolVersion'];
  return Predicate.isString(version) && isLegacyVersion(version);
};

/** Validates an unknown value as a v0.3 card; the caller maps the schema error to `RequestMalformedError`. */
const decodeLegacyCard = Schema.decodeUnknownEffect(V03.AgentCard);

/**
 * Decodes a v0.3 card and translates it to v1.0.
 *
 * @since 0.1.0
 */
export const parseLegacyAgentCard = (
  raw: unknown
): Effect.Effect<V1.AgentCard, RequestMalformedError> =>
  decodeLegacyCard(raw).pipe(
    Effect.mapError(
      (error) =>
        new RequestMalformedError({
          message: `Invalid v0.3 Agent Card: ${error.message}`,
        })
    ),
    Effect.flatMap(toCoreAgentCard)
  );

/**
 * Adds a version 0.3 copy of the first interface of each binding that has
 * no legacy interface yet, so one card advertises both versions.
 *
 * @since 0.1.0
 */
export const duplicateInterfacesForLegacy = (
  interfaces: ReadonlyArray<V1.AgentInterface>,
  bindings: ReadonlyArray<string>
): ReadonlyArray<V1.AgentInterface> =>
  bindings.reduce<ReadonlyArray<V1.AgentInterface>>((result, binding) => {
    const hasLegacy = interfaces.some(
      (candidate) =>
        candidate.protocolBinding === binding && isCompatInterface(candidate)
    );
    const template = interfaces.find(
      (candidate) => candidate.protocolBinding === binding
    );
    return hasLegacy || template === undefined
      ? result
      : [
          ...result,
          { ...template, protocolVersion: A2A_LEGACY_PROTOCOL_VERSION },
        ];
  }, interfaces);
