/**
 * Plumbing of the HTTP client transports: request execution, JSON and SSE
 * bodies, and failures.
 *
 * @internal
 */
import { Effect, Option, Schema, Stream } from 'effect';
import type { HttpClient, HttpClientResponse } from 'effect/http';
import { HttpClientRequest } from 'effect/http';
import { A2ATransportError, extractErrorMessage } from '../../errors/index.js';
import { parseJsonOption, stringifyJson } from '../../internal/json.js';
import { parseSseStream, type SseEvent } from '../../Sse.js';
import type { CallOptions } from '../Transport.js';

/** @internal */
export const transportError = (
  protocol: string,
  message: string,
  extra: {
    readonly code?: number;
    readonly data?: Schema.Json;
    readonly cause?: unknown;
  } = {}
): A2ATransportError => new A2ATransportError({ message, protocol, ...extra });

/** @internal */
export interface HttpResult {
  readonly status: number;
  readonly statusText: string;
  readonly headers: { readonly [name: string]: string };
  readonly text: string;
}

/**
 * Executes a request and reads its body as text.
 *
 * @internal
 */
export const executeText = (
  client: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
  protocol: string
): Effect.Effect<HttpResult, A2ATransportError> =>
  client.execute(request).pipe(
    Effect.flatMap((response) =>
      Effect.map(response.text, (text) => ({
        status: response.status,
        statusText: '',
        headers: response.headers,
        text,
      }))
    ),
    Effect.mapError((cause) =>
      transportError(protocol, `HTTP request failed: ${cause.message}`, {
        cause,
      })
    )
  );

/**
 * Executes a request whose response is an SSE stream.
 *
 * @internal
 */
export const executeStream = (
  client: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
  protocol: string
): Effect.Effect<HttpClientResponse.HttpClientResponse, A2ATransportError> =>
  client.execute(request).pipe(
    Effect.mapError((cause) =>
      transportError(protocol, `HTTP request failed: ${cause.message}`, {
        cause,
      })
    )
  );

/**
 * Parses the SSE body of a response.
 *
 * @internal
 */
export const sseEvents = (
  response: HttpClientResponse.HttpClientResponse,
  protocol: string
): Stream.Stream<SseEvent, A2ATransportError> =>
  parseSseStream(response.stream).pipe(
    Stream.mapError((cause) =>
      transportError(
        protocol,
        `SSE stream failed: ${extractErrorMessage(cause)}`,
        {
          cause,
        }
      )
    )
  );

/**
 * Parses a JSON text, or fails with a transport error that quotes it.
 *
 * @internal
 */
export const parseBody = (
  text: string,
  protocol: string,
  what: string
): Effect.Effect<Schema.Json, A2ATransportError> =>
  Option.match(parseJsonOption(text), {
    onNone: () =>
      Effect.fail(
        transportError(
          protocol,
          `Failed to parse ${what}: "${text.substring(0, 100)}"`
        )
      ),
    onSome: Effect.succeed,
  });

/**
 * Decodes a response value with a schema, or fails with a transport error.
 *
 * @internal
 */
export const decodeResponse =
  <T, E>(schema: Schema.Codec<T, E>, protocol: string) =>
  (value: unknown): Effect.Effect<T, A2ATransportError> =>
    Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError((cause) =>
        transportError(protocol, `Invalid response: ${cause.message}`, {
          cause,
        })
      )
    );

/**
 * Encodes request parameters, or fails with a transport error.
 *
 * @internal
 */
export const encodeRequest =
  <T, E extends Schema.Json>(schema: Schema.Codec<T, E>, protocol: string) =>
  (value: T): Effect.Effect<Schema.Json, A2ATransportError> =>
    Schema.encodeEffect(schema)(value).pipe(
      Effect.mapError((cause) =>
        transportError(protocol, `Invalid request: ${cause.message}`, {
          cause,
        })
      )
    );

/**
 * Sets the service parameters of a call, then the given headers.
 *
 * @internal
 */
export const withHeaders = (
  request: HttpClientRequest.HttpClientRequest,
  options: CallOptions | undefined,
  headers: { readonly [name: string]: string }
): HttpClientRequest.HttpClientRequest =>
  request.pipe(
    HttpClientRequest.setHeaders({
      ...(options?.serviceParameters ?? {}),
      ...headers,
    })
  );

/**
 * Sets a JSON body.
 *
 * @internal
 */
export const withJsonBody = (
  request: HttpClientRequest.HttpClientRequest,
  body: Schema.Json,
  contentType: string
): HttpClientRequest.HttpClientRequest =>
  request.pipe(HttpClientRequest.bodyText(stringifyJson(body), contentType));

/** @internal */
export const isOk = (status: number): boolean => status >= 200 && status < 300;
