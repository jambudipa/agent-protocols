# @jambudipa/a2a

## 0.2.0

### Minor Changes

- 35b5a13: Require Effect `~4.1.4`. Effect 4.1 removed the `Crypto` service, so the A2A and
  Agent Protocol layers now require `SecureRandom` (for ids) and `Digest` (for the
  Agent Card ETag) from `effect/crypto`. `NodeCrypto.layer` provides both, so the
  `/node` entry points need no change.
