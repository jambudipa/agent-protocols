---
'@jambudipa/a2a': minor
'@jambudipa/agent-protocol': minor
'@jambudipa/presentation': minor
---

Require Effect `~4.1.4`. Effect 4.1 removed the `Crypto` service, so the A2A and
Agent Protocol layers now require `SecureRandom` (for ids) and `Digest` (for the
Agent Card ETag) from `effect/crypto`. `NodeCrypto.layer` provides both, so the
`/node` entry points need no change.
