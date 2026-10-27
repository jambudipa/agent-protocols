/**
 * Agent Card signing and verification (specification §8.4): a JSON Web
 * Signature, flattened form, over the JCS (RFC 8785) canonical form of the
 * card.
 *
 * This module is the `jose` boundary. It imports `jose` lazily, on the first
 * signature or verification, so that importing `@jambudipa/a2a` loads no
 * `jose` code. Every `jose` Promise becomes an Effect right where it is made.
 *
 * @since 0.1.0
 */
import { Effect, Option, Predicate, Schema, Struct } from 'effect';
import type * as Jose from 'jose';
import { canonicalize } from './internal/jcs.js';
import { AgentCard, type AgentCardSignature } from './Types.js';

/**
 * Signing or verifying an Agent Card failed.
 *
 * @since 0.1.0
 */
export class AgentCardSignatureError extends Schema.TaggedError<AgentCardSignatureError>()(
  'AgentCardSignatureError',
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  }
) {}

/**
 * A private key that `jose` can sign with.
 *
 * @since 0.1.0
 */
export type SigningKey = Parameters<Jose.FlattenedSign['sign']>[0];

/**
 * A public key that `jose` can verify with.
 *
 * @since 0.1.0
 */
export type VerificationKey = Parameters<typeof Jose.flattenedVerify>[1];

/**
 * JWS header parameters.
 *
 * @since 0.1.0
 */
export type JWSHeaderParameters = Jose.JWSHeaderParameters;

/**
 * Signs an Agent Card and returns it with the new signature appended to
 * `signatures`.
 *
 * @since 0.1.0
 */
export type AgentCardSignatureGenerator = (
  agentCard: AgentCard
) => Effect.Effect<AgentCard, AgentCardSignatureError>;

/**
 * Verifies the signatures of an Agent Card. It succeeds when one signature
 * verifies.
 *
 * @since 0.1.0
 */
export type AgentCardSignatureVerifier<E = never, R = never> = (
  agentCard: AgentCard
) => Effect.Effect<void, AgentCardSignatureError | E, R>;

/**
 * Imports `jose` on demand, so that only callers that sign or verify pay for
 * it. A failed import becomes an `AgentCardSignatureError`.
 */
const loadJose = Effect.tryPromise({
  try: () => import('jose'),
  catch: (cause) =>
    new AgentCardSignatureError({ message: 'Cannot load jose.', cause }),
});

/**
 * Encodes a card to its wire JSON before canonicalization. It throws when the
 * card does not satisfy the `AgentCard` schema.
 */
const encodeCard = Schema.encodeSync(AgentCard);

/** Any JSON value, as the encoded card and its parts are typed. */
type JsonValue = Schema.Json;

/** A JSON object, the only shape whose members `cleanEmpty` filters. */
type JsonRecord = { readonly [key: string]: JsonValue };

/** Tells a JSON object apart from an array, which is also an `object`. */
const isRecord = (value: JsonValue): value is JsonRecord =>
  Predicate.isObject(value) && !Array.isArray(value);

/**
 * Removes empty strings, `null`, empty arrays and empty objects, at every
 * depth, as the reference SDK does before it canonicalizes a card.
 */
const cleanEmpty = (value: JsonValue): Option.Option<JsonValue> => {
  if (value === '' || Predicate.isNull(value)) return Option.none();
  if (Array.isArray(value)) {
    const items = value.flatMap((item: JsonValue) =>
      Option.toArray(cleanEmpty(item))
    );
    return items.length > 0 ? Option.some(items) : Option.none();
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).flatMap(([key, item]) =>
      Option.match(cleanEmpty(item), {
        onNone: () => [],
        onSome: (cleaned) => [[key, cleaned] as const],
      })
    );
    return entries.length > 0
      ? Option.some(Object.fromEntries(entries))
      : Option.none();
  }
  return Option.some(value);
};

/**
 * Drops the `false` value of the two implicit-presence `bool` fields of a
 * card, which ProtoJSON omits: `AgentExtension.required` and
 * `AuthorizationCodeOAuthFlow.pkceRequired`.
 */
const omitImplicitFalse = (card: AgentCard): AgentCard => {
  const extensions = card.capabilities.extensions?.map((extension) => {
    return extension.required === false
      ? Struct.omit(extension, ['required'])
      : extension;
  });
  const capabilities =
    extensions === undefined
      ? card.capabilities
      : { ...card.capabilities, extensions };
  if (card.securitySchemes === undefined) return { ...card, capabilities };
  const securitySchemes = Object.fromEntries(
    Object.entries(card.securitySchemes).map(([name, scheme]) => {
      if (
        !('oauth2SecurityScheme' in scheme) ||
        !('authorizationCode' in scheme.oauth2SecurityScheme.flows) ||
        scheme.oauth2SecurityScheme.flows.authorizationCode.pkceRequired !==
          false
      ) {
        return [name, scheme];
      }
      const flow = Struct.omit(
        scheme.oauth2SecurityScheme.flows.authorizationCode,
        ['pkceRequired']
      );
      return [
        name,
        {
          oauth2SecurityScheme: {
            ...scheme.oauth2SecurityScheme,
            flows: { authorizationCode: flow },
          },
        },
      ];
    })
  );
  return { ...card, capabilities, securitySchemes };
};

/**
 * The canonical form of an Agent Card for signing and verification
 * (specification §8.4.1): the ProtoJSON form without `signatures` and
 * without empty values, serialized with JCS (RFC 8785).
 *
 * Both the signing and the verification path go through this function. A
 * card that still carries `signatures` is fine; they are left out.
 *
 * @since 0.1.0
 */
export const canonicalizeAgentCard = (agentCard: AgentCard): string => {
  const card = Struct.omit(omitImplicitFalse(agentCard), ['signatures']);
  const encoded: JsonValue = encodeCard(card);
  return Option.match(cleanEmpty(encoded), {
    onNone: () => '{}',
    onSome: canonicalize,
  });
};

/** UTF-8 encodes the canonical card, the form that `jose` signs over. */
const toBytes = (text: string) => new TextEncoder().encode(text);

/**
 * Creates a signer that signs an Agent Card with `privateKey`. The
 * `protectedHeader` must name `alg`, `kid` and `typ`.
 *
 * ```ts
 * const sign = generateAgentCardSignature(privateKey, {
 *   alg: 'ES256',
 *   kid: 'my-key-id',
 *   typ: 'JOSE',
 * })
 * const signed = yield* sign(agentCard)
 * ```
 *
 * @since 0.1.0
 */
export const generateAgentCardSignature =
  (
    privateKey: SigningKey,
    protectedHeader: JWSHeaderParameters,
    header?: JWSHeaderParameters
  ): AgentCardSignatureGenerator =>
  (agentCard) =>
    Effect.gen(function* () {
      const jose = yield* loadJose;
      const payload = toBytes(canonicalizeAgentCard(agentCard));
      const builder = new jose.FlattenedSign(payload).setProtectedHeader(
        protectedHeader
      );
      if (header !== undefined) builder.setUnprotectedHeader(header);
      const jws = yield* Effect.tryPromise({
        try: () => builder.sign(privateKey),
        catch: (cause) =>
          new AgentCardSignatureError({
            message: 'Cannot sign the Agent Card.',
            cause,
          }),
      });
      const base = {
        protected: jws.protected ?? '',
        signature: jws.signature,
      };
      const signature: AgentCardSignature =
        jws.header === undefined
          ? base
          : { ...base, header: jws.header as JsonRecord };
      return {
        ...agentCard,
        signatures: [...(agentCard.signatures ?? []), signature],
      };
    });

/**
 * Creates a verifier that succeeds when at least one signature of the card
 * verifies against the key that `retrievePublicKey(kid, jku)` returns. A
 * signature whose protected header lacks `kid`, `typ` or `alg` does not
 * verify.
 *
 * The payload is the canonical form of {@link canonicalizeAgentCard}, so
 * fields outside the v1.0 schema are not covered by the signature.
 *
 * @since 0.1.0
 */
export const verifyAgentCardSignature =
  <E, R>(
    retrievePublicKey: (
      kid: string,
      jku: string | undefined
    ) => Effect.Effect<VerificationKey, E, R>
  ): AgentCardSignatureVerifier<never, R> =>
  (agentCard) =>
    Effect.gen(function* () {
      const signatures = agentCard.signatures ?? [];
      if (signatures.length === 0) {
        return yield* new AgentCardSignatureError({
          message: 'No signatures found on agent card to verify.',
        });
      }
      const jose = yield* loadJose;
      const payload = jose.base64url.encode(
        toBytes(canonicalizeAgentCard(agentCard))
      );
      for (const entry of signatures) {
        const verified = yield* verifyOne(
          jose,
          payload,
          entry,
          retrievePublicKey
        );
        if (verified) return;
      }
      return yield* new AgentCardSignatureError({
        message: 'No valid signatures found on agent card.',
      });
    });

/**
 * Verifies one signature entry against the canonical payload. It succeeds
 * with `false` on any failure, including a failure of `retrievePublicKey`, so
 * that the caller can try the next entry; the failure is logged at debug level.
 */
const verifyOne = <E, R>(
  jose: typeof Jose,
  payload: string,
  entry: AgentCardSignature,
  retrievePublicKey: (
    kid: string,
    jku: string | undefined
  ) => Effect.Effect<VerificationKey, E, R>
): Effect.Effect<boolean, never, R> =>
  Effect.gen(function* () {
    const protectedHeader = yield* Effect.try({
      try: () => jose.decodeProtectedHeader({ protected: entry.protected }),
      catch: (cause) =>
        new AgentCardSignatureError({
          message: 'The protected header does not decode.',
          cause,
        }),
    });
    const { kid, typ, alg, jku } = protectedHeader;
    if (kid === undefined || typ === undefined || alg === undefined) {
      return yield* new AgentCardSignatureError({
        message: 'Missing required header parameters (kid, typ, alg)',
      });
    }
    const key = yield* retrievePublicKey(kid, jku);
    const jws =
      entry.header === undefined
        ? {
            payload,
            protected: entry.protected,
            signature: entry.signature,
          }
        : {
            payload,
            protected: entry.protected,
            signature: entry.signature,
            header: entry.header as JWSHeaderParameters,
          };
    yield* Effect.tryPromise({
      try: () => jose.flattenedVerify(jws, key),
      catch: (cause) =>
        new AgentCardSignatureError({
          message: 'The signature does not verify.',
          cause,
        }),
    });
    return true;
  }).pipe(
    Effect.tapError((error) =>
      Effect.logDebug('Signature verification on entry was not successful', {
        error,
      })
    ),
    Effect.orElseSucceed(() => false)
  );
