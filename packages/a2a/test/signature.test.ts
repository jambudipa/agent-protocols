/**
 * Agent Card signatures against `@a2a-js/sdk` 1.3.0: each side verifies the
 * other's signature, and both canonicalize a card to the same bytes.
 */
import {
  AgentCard as RefAgentCard,
  canonicalizeAgentCard as refCanonicalize,
  generateAgentCardSignature as refSign,
  verifyAgentCardSignature as refVerify,
} from '@a2a-js/sdk';
import { assert, it } from '@effect/vitest';
import { Data, Effect, Schema } from 'effect';
import { generateKeyPair } from 'jose';
import {
  AgentCard,
  canonicalizeAgentCard,
  generateAgentCardSignature,
  verifyAgentCardSignature,
} from '../src/index.js';
import { echoCard } from './support.js';

const encode = Schema.encodeSync(AgentCard);
const decode = Schema.decodeUnknownSync(AgentCard);

const toReference = (card: AgentCard) => RefAgentCard.fromJSON(encode(card));
const fromReference = (card: RefAgentCard) => decode(RefAgentCard.toJSON(card));

const header = { alg: 'ES256', kid: 'key-1', typ: 'JOSE' };

const card: AgentCard = {
  ...echoCard('https://agent.example.com'),
  provider: { url: 'https://example.com', organization: 'Example' },
  documentationUrl: 'https://example.com/docs',
  capabilities: {
    streaming: true,
    pushNotifications: false,
    extensions: [
      { uri: 'urn:a', description: 'A', required: false },
      {
        uri: 'urn:b',
        required: true,
        params: { depth: 2, mode: 'x', empty: '' },
      },
    ],
  },
};

/** A failure of the reference SDK or of jose, at the Promise boundary. */
class BoundaryError extends Data.TaggedError('BoundaryError')<{
  readonly cause: unknown;
}> {}

const boundary = <A>(evaluate: () => Promise<A>) =>
  Effect.tryPromise({
    try: evaluate,
    catch: (cause) => new BoundaryError({ cause }),
  });

const keys = boundary(() => generateKeyPair('ES256'));

/** A key provider for the reference verifier. */
const provide =
  <K>(key: K) =>
  () =>
    Effect.runPromise(Effect.succeed(key));

it.effect('canonicalizes a card to the bytes of the reference', () =>
  Effect.sync(() => {
    assert.strictEqual(
      canonicalizeAgentCard(card),
      refCanonicalize(toReference(card))
    );
  })
);

it.effect('signs a card that the reference verifies', () =>
  Effect.gen(function* () {
    const { privateKey, publicKey } = yield* keys;
    const signed = yield* generateAgentCardSignature(privateKey, header)(card);
    assert.strictEqual(signed.signatures?.length, 1);
    yield* boundary(() => refVerify(provide(publicKey))(toReference(signed)));
    const tampered = toReference({ ...signed, description: 'Changed.' });
    const failure = yield* Effect.flip(
      boundary(() => refVerify(provide(publicKey))(tampered))
    );
    assert.ok(failure.cause instanceof Error);
  })
);

it.effect('verifies a card that the reference signs', () =>
  Effect.gen(function* () {
    const { privateKey, publicKey } = yield* keys;
    const signed = fromReference(
      yield* boundary(() => refSign(privateKey, header)(toReference(card)))
    );
    const verify = verifyAgentCardSignature(() => Effect.succeed(publicKey));
    yield* verify(signed);
    const failure = yield* Effect.flip(verify({ ...signed, name: 'Other' }));
    assert.strictEqual(failure._tag, 'AgentCardSignatureError');
  })
);

it.effect('rejects a card without signatures', () =>
  Effect.gen(function* () {
    const { publicKey } = yield* keys;
    const failure = yield* Effect.flip(
      verifyAgentCardSignature(() => Effect.succeed(publicKey))(card)
    );
    assert.strictEqual(
      failure.message,
      'No signatures found on agent card to verify.'
    );
  })
);
