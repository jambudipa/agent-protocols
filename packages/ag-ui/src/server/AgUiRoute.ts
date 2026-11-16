/**
 * The AG-UI HTTP endpoint: `POST` a `RunAgentInput`, receive the run as a
 * stream of events.
 *
 * The agent is a plain function from the input to a `Stream` of events, so
 * any loop (an `effect/ai` chat, a state machine, a fixed script) can drive
 * it. The route decodes the body, answers 400 when it is not a valid
 * `RunAgentInput`, and otherwise streams the agent's events with status 200:
 * as SSE, or as length-prefixed protobuf when the `Accept` header prefers
 * `application/vnd.ag-ui.event+proto` and `AgUiProto.layer` is provided. A
 * failure of the agent, or an event that does not encode, ends the stream
 * with a `RUN_ERROR` event; the status stays 200.
 *
 * ```ts
 * const echo = (input: RunAgentInput) =>
 *   Stream.make(
 *     { type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId },
 *     { type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId }
 *   )
 *
 * HttpRouter.serve(AgUiRoute.layer(echo, { path: '/agent' }))
 * ```
 *
 * @since 0.1.0
 */
import type { Context } from 'effect';
import { Cause, Effect, Layer, Option, Predicate, Schema, Stream } from 'effect';
import {
  Headers,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/http';
import type { AgUiEncodeError } from '../Errors.js';
import {
  type AgUiEvent,
  encodeSse,
  SSE_CONTENT_TYPE,
  SSE_HEADERS,
} from '../Events.js';
import { preferredMediaType } from '../internal/accept.js';
import { formatIssue } from '../internal/issues.js';
import { stripRunAgentInput } from '../internal/tolerance.js';
import { AgUiProtoCodec, PROTO_MEDIA_TYPE } from '../ProtoCodec.js';
import { RunAgentInput } from '../Types.js';

/**
 * An AG-UI agent: runs one request as a stream of events. A failure of the
 * stream becomes a final `RUN_ERROR` event.
 *
 * @since 0.1.0
 */
export type Agent<E = never, R = never> = (
  input: RunAgentInput
) => Stream.Stream<AgUiEvent, E, R>;

/**
 * The options of the route.
 *
 * @since 0.1.0
 */
export interface AgUiRouteOptions {
  /** The path of the endpoint. The default is `/`. */
  readonly path?: HttpRouter.PathInput;
}

/** The codec between JSON text and a JSON value. */
const JsonText = Schema.fromJsonString(Schema.Json);

/** A JSON error response, sent before any event. */
const badRequest = (message: string) =>
  HttpServerResponse.text(Schema.encodeSync(JsonText)({ error: message }), {
    status: 400,
    contentType: 'application/json',
  });

/** Reads and decodes the request body, or gives the 400 response. */
const readInput = (
  request: HttpServerRequest.HttpServerRequest
): Effect.Effect<RunAgentInput, HttpServerResponse.HttpServerResponse> =>
  Effect.gen(function* () {
    const text = yield* Effect.mapError(request.text, () =>
      badRequest('The request body could not be read.')
    );
    const json = yield* Effect.mapError(
      Schema.decodeUnknownEffect(JsonText)(text),
      () => badRequest('The request body is not JSON.')
    );
    const stripped = stripRunAgentInput(json);
    return yield* Effect.mapError(
      Schema.decodeUnknownEffect(RunAgentInput)(stripped),
      (error) =>
        badRequest(
          `The request body is not a valid RunAgentInput: ${formatIssue(error.issue, stripped)}`
        )
    );
  });

/** The text of a failure, for the `RUN_ERROR` that reports it. */
const failureMessage = <E>(cause: Cause.Cause<E>): string =>
  Option.match(Cause.findErrorOption(cause), {
    onSome: (error) =>
      Predicate.hasProperty(error, 'message') && Predicate.isString(error.message)
        ? error.message
        : String(error),
    onNone: () => Cause.pretty(cause),
  });

/** The `RUN_ERROR` event that reports a failure. */
const runError = <E>(cause: Cause.Cause<E>): AgUiEvent => ({
  type: 'RUN_ERROR',
  message: failureMessage(cause),
});

/** One encoding of the event stream: its media type and frame encoder. */
interface Encoding {
  /** The `Content-Type` of the response. */
  readonly contentType: string;
  /** Encodes one event as the bytes of one frame. */
  readonly encode: (event: AgUiEvent) => Effect.Effect<Uint8Array, AgUiEncodeError>;
}

/** The SSE encoding, always available. */
const sse: Encoding = {
  contentType: SSE_CONTENT_TYPE,
  encode: (event) =>
    Effect.map(encodeSse(event), (frame) => new TextEncoder().encode(frame)),
};

/** Picks the encoding that the request's `Accept` header prefers. */
const negotiate = (
  request: HttpServerRequest.HttpServerRequest,
  codec: Option.Option<AgUiProtoCodec['Service']>
): Encoding =>
  Option.match(codec, {
    onNone: () => sse,
    onSome: (proto) =>
      Option.contains(
        preferredMediaType(Headers.get(request.headers, 'accept'), [
          SSE_CONTENT_TYPE,
          PROTO_MEDIA_TYPE,
        ]),
        PROTO_MEDIA_TYPE
      )
        ? { contentType: PROTO_MEDIA_TYPE, encode: proto.encodeFrame }
        : sse,
  });

/**
 * Encodes the agent's events. The first failure, of the agent or of an
 * encoding, becomes a final `RUN_ERROR` frame.
 */
const encodeRun = <E>(
  events: Stream.Stream<AgUiEvent, E>,
  encoding: Encoding
): Stream.Stream<Uint8Array> =>
  events.pipe(
    Stream.mapEffect(encoding.encode),
    Stream.catchCause((cause) =>
      Stream.fromEffect(Effect.orDie(encoding.encode(runError(cause))))
    )
  );

/** Answers one request. */
const respond = <E>(
  request: HttpServerRequest.HttpServerRequest,
  agent: (input: RunAgentInput) => Stream.Stream<AgUiEvent, E>,
  codec: Option.Option<AgUiProtoCodec['Service']>
) =>
  Effect.gen(function* () {
    const input = yield* Effect.result(readInput(request));
    if (input._tag === 'Failure') return input.failure;
    const encoding = negotiate(request, codec);
    const events = Stream.suspend(() => agent(input.success));
    return HttpServerResponse.stream(encodeRun(events, encoding), {
      contentType: encoding.contentType,
      headers: {
        ...SSE_HEADERS,
        ...(Option.isSome(codec) ? { Vary: 'Accept' } : {}),
      },
    });
  });

/**
 * The AG-UI route on the `HttpRouter`. It requires what the agent requires.
 * Provide `AgUiProto.layer` from `@jambudipa/ag-ui/proto` to serve protobuf
 * as well as SSE.
 *
 * @since 0.1.0
 */
export const AgUiRoute = {
  layer: <E, R>(
    agent: Agent<E, R>,
    options: AgUiRouteOptions = {}
  ): Layer.Layer<never, never, HttpRouter.HttpRouter | R> =>
    HttpRouter.use((router) =>
      Effect.gen(function* () {
        const context: Context.Context<R> = yield* Effect.context<R>();
        const codec = yield* Effect.serviceOption(AgUiProtoCodec);
        const run = (input: RunAgentInput) =>
          Stream.provideContext(agent(input), context);
        yield* router.add(
          'POST',
          options.path ?? '/',
          Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
            respond(request, run, codec)
          )
        );
      })
    ),
};
