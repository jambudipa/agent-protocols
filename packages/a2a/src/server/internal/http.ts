/**
 * Plumbing shared by the HTTP bindings (JSON-RPC, HTTP+JSON, the Agent Card
 * route and their v0.3 variants): call contexts, body parsing and SSE
 * responses.
 *
 * @internal
 */
import { Effect, Option, Predicate, Ref, Schema, Sink, Stream } from 'effect';
import { Headers, HttpServerRequest, HttpServerResponse } from 'effect/http';
import {
  A2A_CONTENT_TYPE,
  A2A_VERSION_HEADER,
  JSON_CONTENT_TYPE,
} from '../../Constants.js';
import {
  ContentTypeNotSupportedError,
  InternalError,
  RequestMalformedError,
  type ServerError,
} from '../../errors/index.js';
import * as Extensions from '../../Extensions.js';
import { parseJson, stringifyJson } from '../../internal/json.js';
import { SSE_HEADERS } from '../../Sse.js';
import type { A2ARequestHandler } from '../RequestHandler.js';
import * as ServerCallContext from '../ServerCallContext.js';
import { UnauthenticatedUser, type UserBuilder } from '../User.js';
import { validateVersion } from '../Version.js';

/** @internal */
export const headerValue = (
  request: HttpServerRequest.HttpServerRequest,
  name: string
): Option.Option<string> =>
  Headers.get(request.headers, name.toLowerCase()).pipe(
    Option.filter((value) => value !== '')
  );

/** @internal */
export const mediaTypeOf = (contentType: string): string =>
  (contentType.split(';', 1)[0] ?? '').trim().toLowerCase();

/**
 * Fails when the request names a content type other than JSON.
 *
 * @internal
 */
export const requireJsonContentType = (
  request: HttpServerRequest.HttpServerRequest
): Effect.Effect<void, ContentTypeNotSupportedError> =>
  Option.match(headerValue(request, 'content-type'), {
    onNone: () => Effect.void,
    onSome: (contentType) => {
      const mediaType = mediaTypeOf(contentType);
      return mediaType === JSON_CONTENT_TYPE || mediaType === A2A_CONTENT_TYPE
        ? Effect.void
        : Effect.fail(
            new ContentTypeNotSupportedError({
              message: `Unsupported Content-Type "${contentType}"; expected application/json or application/a2a+json.`,
            })
          );
    },
  });

/**
 * Reads the body as JSON. An empty body is `Option.none()`; a body that is
 * not JSON fails with `RequestMalformedError`.
 *
 * @internal
 */
export const readJsonBody = (
  request: HttpServerRequest.HttpServerRequest
): Effect.Effect<Option.Option<Schema.Json>, RequestMalformedError> =>
  request.text.pipe(
    Effect.mapError(
      (error) => new RequestMalformedError({ message: error.message })
    ),
    Effect.flatMap((text) =>
      text.trim() === ''
        ? Effect.succeed(Option.none<Schema.Json>())
        : parseJson(text).pipe(
            Effect.map(Option.some),
            Effect.mapError(
              () =>
                new RequestMalformedError({ message: 'Invalid JSON payload.' })
            )
          )
    )
  );

/**
 * The options that every HTTP binding takes.
 *
 * @since 0.1.0
 */
export interface HttpBindingOptions {
  /** Finds the caller of a request. The default is no authentication. */
  readonly userBuilder?: UserBuilder<ServerError>;
}

/**
 * Builds the call context of an HTTP request and checks its protocol
 * version against the interfaces of the Agent Card for the binding.
 *
 * @internal
 */
export const buildContext = (
  request: HttpServerRequest.HttpServerRequest,
  handler: A2ARequestHandler['Service'],
  options: HttpBindingOptions & {
    readonly protocolBinding: string;
    readonly tenant?: string;
    readonly extensionHeader: string;
  }
): Effect.Effect<ServerCallContext.ServerCallContext, ServerError> =>
  Effect.gen(function* () {
    const user =
      options.userBuilder === undefined
        ? UnauthenticatedUser
        : yield* options.userBuilder(request);
    const version = headerValue(request, A2A_VERSION_HEADER);
    const context = yield* ServerCallContext.make({
      user,
      tenant: options.tenant ?? '',
      headers: request.headers,
      extensions: Extensions.parseServiceParameter(
        Option.getOrUndefined(headerValue(request, options.extensionHeader))
      ),
      ...(Option.isSome(version) ? { requestedVersion: version.value } : {}),
    });
    const card = yield* handler.getAgentCard;
    yield* validateVersion(
      context.requestedVersion,
      card,
      options.protocolBinding
    );
    return context;
  });

/**
 * The `A2A-Extensions` response header that echoes the activated
 * extensions, when there are any.
 *
 * @internal
 */
export const extensionHeaders = (
  context: ServerCallContext.ServerCallContext,
  headerName: string
): Effect.Effect<Record<string, string>> =>
  Effect.map(Ref.get(context.activatedExtensions), (activated) =>
    activated.length === 0
      ? {}
      : { [headerName]: Extensions.toServiceParameter(activated) }
  );

/**
 * Turns a defect into an `InternalError`, so that every failure of a binding
 * is a `ServerError`.
 *
 * @internal
 */
export const catchDefects = <A, R>(
  effect: Effect.Effect<A, ServerError, R>
): Effect.Effect<A, ServerError, R> =>
  Effect.catchDefect(effect, (defect) =>
    Effect.fail(
      new InternalError({
        message: defect instanceof Error ? defect.message : String(defect),
      })
    )
  );

/**
 * Turns a defect of a stream into an `InternalError` failure.
 *
 * @internal
 */
export const catchStreamDefects = <A>(
  stream: Stream.Stream<A, ServerError>
): Stream.Stream<A, ServerError> =>
  Stream.catchDefect(stream, (defect) =>
    Stream.fail(
      new InternalError({
        message: defect instanceof Error ? defect.message : String(defect),
      })
    )
  );

/**
 * Splits a stream into its first element and the rest, within the request
 * scope. `Option.none()` means the stream was empty.
 *
 * @internal
 */
export const peelFirst = <A, E>(stream: Stream.Stream<A, E>) =>
  Stream.peel(stream, Sink.head<A>());

/**
 * An SSE response of pre-rendered event text.
 *
 * @internal
 */
export const sseResponse = (
  events: Stream.Stream<string>,
  headers: Record<string, string>
): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.stream(Stream.encodeText(events), {
    contentType: SSE_HEADERS['Content-Type'],
    headers: {
      'Cache-Control': SSE_HEADERS['Cache-Control'],
      Connection: SSE_HEADERS.Connection,
      'X-Accel-Buffering': SSE_HEADERS['X-Accel-Buffering'],
      ...headers,
    },
  });

/**
 * A JSON response of a JSON value.
 *
 * @internal
 */
export const jsonResponse = (
  body: Schema.Json,
  options: {
    readonly status: number;
    readonly contentType: string;
    readonly headers?: Record<string, string>;
  }
): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.text(stringifyJson(body), {
    status: options.status,
    contentType: options.contentType,
    headers: options.headers ?? {},
  });

/**
 * Encodes a value to its JSON form, mapping an encoding failure to an
 * `InternalError`.
 *
 * @internal
 */
export const encodeJson =
  <T, E extends Schema.Json>(schema: Schema.Codec<T, E>) =>
  (value: T): Effect.Effect<Schema.Json, InternalError> =>
    Schema.encodeEffect(schema)(value).pipe(
      Effect.mapError(
        (error) =>
          new InternalError({
            message: `Cannot encode the response: ${error.message}`,
          })
      )
    );

/**
 * Decodes request parameters, mapping a decoding failure to a
 * `RequestMalformedError`.
 *
 * @internal
 */
export const decodeParams =
  <T, E>(schema: Schema.Codec<T, E>) =>
  (input: unknown): Effect.Effect<T, RequestMalformedError> =>
    Schema.decodeUnknownEffect(schema)(input).pipe(
      Effect.mapError(
        (error) => new RequestMalformedError({ message: error.message })
      )
    );

/** @internal */
export const isJsonObject = (
  value: Schema.Json
): value is { readonly [key: string]: Schema.Json } =>
  Predicate.isObject(value) && !Array.isArray(value);
