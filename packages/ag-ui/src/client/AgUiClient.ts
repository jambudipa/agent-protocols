/**
 * The AG-UI client: `POST` a `RunAgentInput` to an agent and read the run
 * as a `Stream` of events.
 *
 * The stream is decoded, chunk-expanded and verified, so a consumer sees
 * only the bracketed events of a run that follows the protocol rules. A
 * status other than 2xx fails with `AgUiHttpError` before any event; bytes
 * that do not decode fail with `AgUiDecodeError`; a broken ordering rule
 * fails with `AgUiVerifyError`; a network failure fails with
 * `AgUiTransportError`.
 *
 * ```ts
 * const events = Effect.gen(function* () {
 *   const client = yield* AgUiClient
 *   return yield* Stream.runCollect(client.run(input))
 * }).pipe(
 *   Effect.provide(AgUiClient.layer({ url: 'http://localhost:8000/agent' })),
 *   Effect.provide(FetchHttpClient.layer)
 * )
 * ```
 *
 * @since 0.1.0
 */
import { Context, Effect, Layer, Option, Schema, Stream } from 'effect';
import {
  Headers,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from 'effect/http';
import {
  AgUiDecodeError,
  AgUiEncodeError,
  AgUiHttpError,
  AgUiTransportError,
  type AgUiClientError,
} from '../Errors.js';
import { type AgUiEvent, decodeSse, SSE_CONTENT_TYPE } from '../Events.js';
import { formatIssue } from '../internal/issues.js';
import { AgUiProtoCodec, PROTO_MEDIA_TYPE } from '../ProtoCodec.js';
import { RunAgentInput } from '../Types.js';
import { expandChunks, verify } from '../Verify.js';

/**
 * The options of the client.
 *
 * @since 0.1.0
 */
export interface AgUiClientOptions {
  /** The URL of the agent's endpoint. */
  readonly url: string;
  /** Extra request headers, such as `Authorization`. */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * `'sse'` (the default) asks for SSE. `'proto'` asks for protobuf first
   * and SSE second, and needs `AgUiProto.layer` from
   * `@jambudipa/ag-ui/proto`. Either way the response's `Content-Type`
   * decides how it is read.
   */
  readonly encoding?: 'sse' | 'proto';
}

/** The `Accept` header that asks for protobuf, falling back to SSE. */
const PROTO_ACCEPT = `${PROTO_MEDIA_TYPE}, ${SSE_CONTENT_TYPE};q=0.5`;

/** The codec between a `RunAgentInput` and its JSON text. */
const InputJson = Schema.fromJsonString(RunAgentInput);

/** Renders the request body. */
const encodeInput = (
  input: RunAgentInput
): Effect.Effect<string, AgUiEncodeError> =>
  Effect.mapError(
    Schema.encodeEffect(InputJson)(input),
    (error) =>
      new AgUiEncodeError({
        message: `The input is not a valid RunAgentInput: ${formatIssue(error.issue, input)}`,
      })
  );

/** The media type of a response, without parameters, in lower case. */
const mediaTypeOf = (response: HttpClientResponse.HttpClientResponse) =>
  Option.getOrElse(Headers.get(response.headers, 'content-type'), () => '')
    .split(';', 1)[0]
    ?.trim()
    .toLowerCase() ?? '';

/** Maps a failure of the response body to a transport failure. */
const transportFailure = (error: { readonly message: string }) =>
  new AgUiTransportError({
    message: `The response broke off: ${error.message}`,
  });

/** Reads the events of a 2xx response, by its `Content-Type`. */
const readEvents = (
  response: HttpClientResponse.HttpClientResponse,
  codec: Option.Option<AgUiProtoCodec['Service']>
): Stream.Stream<AgUiEvent, AgUiDecodeError | AgUiTransportError> => {
  const body = Stream.mapError(response.stream, transportFailure);
  if (mediaTypeOf(response) !== PROTO_MEDIA_TYPE) return decodeSse(body);
  return Option.match(codec, {
    onSome: (proto) => proto.decodeFrames(body),
    onNone: () =>
      Stream.fail(
        new AgUiDecodeError({
          message: `The agent answered with ${PROTO_MEDIA_TYPE}, but no AgUiProtoCodec is provided.`,
        })
      ),
  });
};

/** Builds the client on an `HttpClient`. */
const make = (
  options: AgUiClientOptions,
  http: HttpClient.HttpClient,
  codec: Option.Option<AgUiProtoCodec['Service']>
) => {
  const accept = options.encoding === 'proto' ? PROTO_ACCEPT : SSE_CONTENT_TYPE;
  const run = (
    input: RunAgentInput
  ): Stream.Stream<AgUiEvent, AgUiClientError> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const body = yield* encodeInput(input);
        const request = HttpClientRequest.post(options.url).pipe(
          HttpClientRequest.setHeaders({ ...options.headers, Accept: accept }),
          HttpClientRequest.bodyText(body, 'application/json')
        );
        const response = yield* Effect.mapError(
          http.execute(request),
          (error) =>
            new AgUiTransportError({
              message: `The request to ${options.url} failed: ${error.message}`,
            })
        );
        if (response.status < 200 || response.status >= 300) {
          const text = yield* Effect.orElseSucceed(response.text, () => '');
          return yield* new AgUiHttpError({
            message: `The agent answered HTTP ${response.status}.`,
            status: response.status,
            body: text,
          });
        }
        return readEvents(response, codec).pipe(expandChunks, verify);
      })
    );
  return AgUiClient.of({ run });
};

/** The layer of a client that asks for protobuf: it needs the codec. */
function layer(
  options: AgUiClientOptions & { readonly encoding: 'proto' }
): Layer.Layer<AgUiClient, never, HttpClient.HttpClient | AgUiProtoCodec>;
/** The layer of a client that asks for SSE. */
function layer(
  options: AgUiClientOptions
): Layer.Layer<AgUiClient, never, HttpClient.HttpClient>;
/** The implementation of both layers. */
function layer(
  options: AgUiClientOptions
): Layer.Layer<AgUiClient, never, HttpClient.HttpClient | AgUiProtoCodec> {
  return Layer.effect(
    AgUiClient,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      const codec =
        options.encoding === 'proto'
          ? Option.some(yield* AgUiProtoCodec)
          : Option.none();
      return make(options, http, codec);
    })
  );
}

/**
 * Runs an AG-UI agent over HTTP. `run` gives the run's events, decoded,
 * with chunks expanded, and verified.
 *
 * @since 0.1.0
 */
export class AgUiClient extends Context.Service<
  AgUiClient,
  {
    /** Posts the input and streams the run. */
    readonly run: (
      input: RunAgentInput
    ) => Stream.Stream<AgUiEvent, AgUiClientError>;
  }
>()('@jambudipa/ag-ui/client/AgUiClient') {
  /**
   * The client on the provided `HttpClient`. With `encoding: 'proto'` it
   * also requires `AgUiProtoCodec`, which `AgUiProto.layer` provides.
   */
  static readonly layer = layer;
}
