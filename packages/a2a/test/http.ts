/**
 * Raw HTTP helpers of the binding tests: JSON-RPC calls, REST calls and SSE
 * bodies, read through the test server's `HttpClient`.
 */
import { Effect, Option, Predicate, Schema, Stream } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';

const JsonText = Schema.fromJsonString(Schema.Json);
const decodeJsonText = Schema.decodeUnknownSync(JsonText);
const encodeJsonText = Schema.encodeSync(JsonText);

export { encodeJsonText };

/** A JSON object of a response body. */
export type JsonObject = { readonly [key: string]: Schema.Json };

/** The value that {@link at} returns for a missing key. */
export const MISSING = '<missing>';

/** Reads a nested value by keys, or {@link MISSING}. */
export const at = (
  value: unknown,
  ...path: ReadonlyArray<string | number>
): unknown =>
  path.reduce<unknown>(
    (current, key) =>
      Predicate.hasProperty(current, key) ? current[key] : MISSING,
    value
  );

/** The response of a raw call. */
export interface RawResponse {
  readonly status: number;
  readonly headers: { readonly [name: string]: string };
  readonly text: string;
}

/** Parses a response body as JSON. */
export const json = (response: RawResponse): Schema.Json =>
  decodeJsonText(response.text);

/** One SSE event of a body. */
export interface SseEventJson {
  readonly event: string;
  readonly data: Schema.Json;
}

/** Parses an SSE body into its events. */
export const sse = (text: string): ReadonlyArray<SseEventJson> =>
  text
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const lines = block.split('\n');
      const event =
        lines
          .find((line) => line.startsWith('event: '))
          ?.slice('event: '.length) ?? 'message';
      const data = lines
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice('data: '.length))
        .join('\n');
      return { event, data: decodeJsonText(data) };
    });

/** Sends a request through the test server's client and reads it fully. */
export const send = (request: HttpClientRequest.HttpClientRequest) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const response = yield* http.execute(request);
    return {
      status: response.status,
      headers: response.headers,
      text: yield* response.text,
    } satisfies RawResponse;
  });

/** The headers of a v1.0 call. */
export const v1 = { 'A2A-Version': '1.0' };

/** Posts a JSON-RPC body (any JSON) to `/`. */
export const rpc = (body: Schema.Json, headers: Record<string, string> = v1) =>
  send(
    HttpClientRequest.post('/').pipe(
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.bodyText(encodeJsonText(body), 'application/json')
    )
  );

/** Posts a raw JSON-RPC body text to `/`. */
export const rpcText = (
  body: string,
  contentType = 'application/json',
  headers = v1
) =>
  send(
    HttpClientRequest.post('/').pipe(
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.bodyText(body, contentType)
    )
  );

/** A REST call. */
export const rest = (
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: Schema.Json,
  headers: Record<string, string> = v1
) => {
  const base = HttpClientRequest.make(method)(path).pipe(
    HttpClientRequest.setHeaders(headers)
  );
  return send(
    body === undefined
      ? base
      : base.pipe(
          HttpClientRequest.bodyText(encodeJsonText(body), 'application/json')
        )
  );
};

/** A user message with one text part. */
export const userMessage = (
  messageId: string,
  text: string,
  extra: JsonObject = {}
): JsonObject => ({
  messageId,
  role: 'ROLE_USER',
  parts: [{ text }],
  ...extra,
});

let counter = 0;
/** A fresh message id. */
export const nextId = (prefix = 'm') => `${prefix}-${++counter}`;

/** Sends a streaming request and reads its body up to the first SSE event. */
export const firstEvent = (request: HttpClientRequest.HttpClientRequest) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const response = yield* http.execute(request);
    const chunks = yield* response.stream.pipe(
      Stream.decodeText(),
      Stream.scan(
        () => '',
        (text: string, chunk: string) => text + chunk
      ),
      Stream.takeUntil((text) => text.includes('\n\n')),
      Stream.runLast
    );
    const text = Option.getOrElse(chunks, () => '');
    return sse(text.slice(0, text.indexOf('\n\n') + 2))[0];
  });
