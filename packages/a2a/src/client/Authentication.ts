/**
 * Authentication of client requests, with one retry when the server asks
 * for other credentials.
 *
 * @since 0.1.0
 */
import { Effect, Option } from 'effect';
import {
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from 'effect/http';

/**
 * HTTP headers.
 *
 * @since 0.1.0
 */
export type HttpHeaders = { readonly [name: string]: string };

/**
 * Supplies the credentials of requests.
 *
 * @since 0.1.0
 */
export interface AuthenticationHandler {
  /** The headers to add to every request. */
  readonly headers: Effect.Effect<HttpHeaders>;
  /**
   * Inspects a response; returns the headers to retry the request with, or
   * `Option.none()` to keep the response.
   */
  readonly shouldRetryWithHeaders: (
    request: HttpClientRequest.HttpClientRequest,
    response: HttpClientResponse.HttpClientResponse
  ) => Effect.Effect<Option.Option<HttpHeaders>>;
  /** Called with the retry headers after a successful retry. */
  readonly onSuccessfulRetry?: (headers: HttpHeaders) => Effect.Effect<void>;
}

const withAuthHeaders = (
  request: HttpClientRequest.HttpClientRequest,
  auth: HttpHeaders
) =>
  // The caller's headers win over the authentication headers.
  HttpClientRequest.setHeaders(request, { ...auth, ...request.headers });

/**
 * Wraps an HTTP client so that every request carries the handler's headers
 * and is retried once with the headers that the handler asks for.
 *
 * @since 0.1.0
 */
export const withAuthentication =
  (handler: AuthenticationHandler) =>
  <E, R>(
    client: HttpClient.HttpClient.With<E, R>
  ): HttpClient.HttpClient.With<E, R> =>
    HttpClient.transform(client, (_effect, request) =>
      Effect.gen(function* () {
        const authenticated = withAuthHeaders(request, yield* handler.headers);
        const response = yield* client.execute(authenticated);
        const retry = yield* handler.shouldRetryWithHeaders(
          authenticated,
          response
        );
        if (Option.isNone(retry)) return response;
        const retried = yield* client.execute(
          withAuthHeaders(request, retry.value)
        );
        if (
          retried.status >= 200 &&
          retried.status < 300 &&
          handler.onSuccessfulRetry !== undefined
        ) {
          yield* handler.onSuccessfulRetry(retry.value);
        }
        return retried;
      })
    );

/**
 * A layer-friendly form: replaces the `HttpClient` of an effect with an
 * authenticating one.
 *
 * @since 0.1.0
 */
export const createAuthenticatingHttpClient = (
  handler: AuthenticationHandler
): Effect.Effect<HttpClient.HttpClient, never, HttpClient.HttpClient> =>
  Effect.map(HttpClient.HttpClient, withAuthentication(handler));
