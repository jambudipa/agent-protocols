/**
 * The Agent Card route: `GET /.well-known/agent-card.json`, with a weak
 * ETag and a cache lifetime, as the reference SDK serves it.
 *
 * @since 0.1.0
 */
import { Crypto, Effect, Layer, Option, Result } from 'effect';
import { Hex } from 'effect/encoding';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import {
  AGENT_CARD_PATH,
  A2A_VERSION_HEADER,
  JSON_CONTENT_TYPE,
} from '../Constants.js';
import { catchDefects, encodeJson, headerValue } from './internal/http.js';
import { stringifyJson } from '../internal/json.js';
import { AgentCard } from '../Types.js';
import type { LegacyCompat } from './LegacyCompat.js';
import { A2ARequestHandler } from './RequestHandler.js';
import { isLegacyVersion } from './Version.js';

/**
 * The options of the Agent Card route.
 *
 * @since 0.1.0
 */
export interface AgentCardRouteOptions {
  /** The path of the card. The default is `/.well-known/agent-card.json`. */
  readonly path?: HttpRouter.PathInput;
  /**
   * The `max-age` of `Cache-Control`, in seconds. The default is 3600; zero
   * sends `no-cache`.
   */
  readonly maxAge?: number;
  /**
   * Serves the v0.3 card to a request whose `A2A-Version` is absent or a
   * 0.x version. Use `legacyCompat` of `@jambudipa/a2a/compat/v0_3/server`.
   */
  readonly legacyCompat?: LegacyCompat;
}

/**
 * The weak ETag of a body: the first 16 hex digits of its SHA-256.
 *
 * @since 0.1.0
 */
export const computeETag = (
  body: string
): Effect.Effect<string, never, Crypto.Crypto> =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const digest = yield* crypto
      .digest('SHA-256', new TextEncoder().encode(body))
      .pipe(Effect.orDie);
    return `W/"${Hex.encode(digest).slice(0, 16)}"`;
  });

/** Strips the weak prefix, so that `If-None-Match` compares weakly. */
const opaque = (tag: string) => tag.trim().replace(/^W\//, '');

/**
 * Tells whether the request's `If-None-Match` matches the ETag, so that a
 * 304 may answer it. `Cache-Control: no-cache` in the request disables it.
 *
 * @since 0.1.0
 */
export const isFresh = (
  request: HttpServerRequest.HttpServerRequest,
  etag: string
): boolean => {
  const cacheControl = Option.getOrElse(
    headerValue(request, 'cache-control'),
    () => ''
  );
  if (/(?:^|,)\s*no-cache\s*(?:,|$)/.test(cacheControl)) return false;
  return Option.match(headerValue(request, 'if-none-match'), {
    onNone: () => false,
    onSome: (header) =>
      header.trim() === '*' ||
      header.split(',').some((tag) => opaque(tag) === opaque(etag)),
  });
};

/** Encodes the current card to its v1.0 JSON body. */
const encodeCard = encodeJson(AgentCard);

/**
 * Builds the card response: the v0.3 card for a legacy caller when
 * `legacyCompat` is set, else the current card, with an ETag and a 304
 * when the caller's copy is fresh. A failure to build the card is
 * logged and answered with a 500, never a defect. A non-200 legacy
 * response carries no ETag and no cache headers.
 */
const respond = (
  request: HttpServerRequest.HttpServerRequest,
  handler: A2ARequestHandler['Service'],
  options: AgentCardRouteOptions
) =>
  Effect.gen(function* () {
    const maxAge = options.maxAge ?? 3600;
    const legacy = Option.fromUndefinedOr(options.legacyCompat);
    const vary: Record<string, string> = Option.isSome(legacy)
      ? { Vary: A2A_VERSION_HEADER }
      : {};
    const useLegacy =
      Option.isSome(legacy) &&
      isLegacyVersion(
        Option.getOrUndefined(headerValue(request, A2A_VERSION_HEADER))
      );
    const card = yield* Effect.result(
      catchDefects(
        Effect.gen(function* () {
          const current = yield* handler.getAgentCard;
          if (useLegacy && Option.isSome(legacy)) {
            return yield* legacy.value.agentCard(current);
          }
          return {
            status: 200,
            contentType: JSON_CONTENT_TYPE,
            body: yield* encodeCard(current),
          };
        })
      )
    );
    if (Result.isFailure(card)) {
      yield* Effect.logError('Error fetching agent card', card.failure);
      return HttpServerResponse.text(
        stringifyJson({ error: 'Failed to retrieve agent card' }),
        { status: 500, contentType: JSON_CONTENT_TYPE, headers: vary }
      );
    }
    const { status, contentType, body } = card.success;
    const text = stringifyJson(body);
    if (status !== 200) {
      return HttpServerResponse.text(text, {
        status,
        contentType,
        headers: vary,
      });
    }
    const etag = yield* computeETag(text);
    const headers = {
      ETag: etag,
      'Cache-Control': maxAge > 0 ? `public, max-age=${maxAge}` : 'no-cache',
      ...vary,
    };
    return isFresh(request, etag)
      ? HttpServerResponse.empty({ status: 304, headers })
      : HttpServerResponse.text(text, { status: 200, contentType, headers });
  });

/**
 * The Agent Card route on the `HttpRouter`. It requires the
 * `A2ARequestHandler` and `Crypto` (for the ETag).
 *
 * @since 0.1.0
 */
export const AgentCardRoute = {
  layer: (
    options: AgentCardRouteOptions = {}
  ): Layer.Layer<
    never,
    never,
    HttpRouter.HttpRouter | A2ARequestHandler | Crypto.Crypto
  > =>
    HttpRouter.use((router) =>
      Effect.gen(function* () {
        const handler = yield* A2ARequestHandler;
        const crypto = yield* Crypto.Crypto;
        yield* router.add(
          'GET',
          options.path ?? `/${AGENT_CARD_PATH}`,
          Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
            respond(request, handler, options).pipe(
              Effect.provideService(Crypto.Crypto, crypto)
            )
          )
        );
      })
    ),
};
